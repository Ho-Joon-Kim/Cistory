import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db";
import { accountRoles, transactions, users } from "@/db/schema";
import {
  CLAUDE_MODELS,
  type ClaudeAdapter,
  type ClaudeModel,
  createClaudeAdapter,
} from "@/lib/adapters/ai/claude";
import { logger } from "@/lib/logger";
import { EXPENSE_CATEGORIES, type ExpenseCategory, isExpenseCategory } from "./categories";
import { accountRolesJoinOn, bucketSql } from "./classify";

export const EXPENSE_CLASSIFIER_MODEL = CLAUDE_MODELS.EXPENSE_CLASSIFIER;
const DEFAULT_BATCH_SIZE = 25;

export interface ExpenseClassificationInput {
  id: string;
  merchant: string;
  amount: number;
  rawTitle: string;
  rawText: string;
}

export interface ExpenseClassification {
  id: string;
  category: ExpenseCategory;
  confidence: number;
}

const responseSchema = z.object({
  classifications: z.array(
    z.object({
      id: z.string().min(1),
      category: z.string().refine(isExpenseCategory),
      confidence: z.number().int().min(0).max(100),
    })
  ),
});

/** Sent to the API so the response shape is enforced server-side. The zod
 * schema above still runs on the result — it additionally checks that each
 * category is one of ours, which JSON Schema's enum could express but which we
 * keep in one place. */
const OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: [...EXPENSE_CATEGORIES] },
          confidence: { type: "integer" },
        },
        required: ["id", "category", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["classifications"],
  additionalProperties: false,
} as const;

// Structured outputs make the API enforce this shape server-side, but the
// guarantee isn't a proof: the odds the model still wraps its reply in a
// code fence aren't exactly zero, and what a fallback here costs (a few
// lines) is far less than what losing it costs (a whole 25-item batch
// failing on one stray fence). Keep extractJson as a fallback rather than
// deleting it.
function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse((fenced ?? content).trim());
}

export function buildExpenseClassificationPrompt(items: ExpenseClassificationInput[]): string {
  return `한국의 개인 소비 거래를 분류하세요.

허용 카테고리: ${EXPENSE_CATEGORIES.join(", ")}
- food: 식사, 배달, 식료품
- cafe: 카페, 음료, 디저트
- transport: 대중교통, 택시, 철도, 주유
- shopping: 의류, 전자제품, 온라인 쇼핑
- housing: 월세, 공과금, 통신, 생활용품
- subscription: 정기 구독, 멤버십, 소프트웨어
- health: 병원, 약국, 운동, 건강
- leisure: 문화, 게임, 취미, 공연
- education: 도서, 강의, 학원
- gift: 선물, 경조사, 개인에게 보낸 생활비 외 송금
- finance: 수수료, 보험, 세금, 대출
- travel: 숙박, 항공, 여행
- other: 판단하기 어렵거나 어느 항목에도 속하지 않음

각 입력의 id를 보존하고 JSON만 반환하세요. 형식:
{"classifications":[{"id":"...","category":"food","confidence":90}]}

거래:
${JSON.stringify(items)}`;
}

export async function classifyExpenses(
  ai: Pick<ClaudeAdapter, "generateText">,
  items: ExpenseClassificationInput[]
): Promise<ExpenseClassification[]> {
  if (items.length === 0) return [];

  const result = await ai.generateText({
    system: "당신은 한국 소비 거래 분류기입니다. 설명 없이 유효한 JSON만 출력하세요.",
    prompt: buildExpenseClassificationPrompt(items),
    maxTokens: Math.max(500, items.length * 60),
    temperature: 0,
    outputSchema: OUTPUT_JSON_SCHEMA,
  });
  const parsed = responseSchema.parse(extractJson(result.content));
  const requestedIds = new Set(items.map((item) => item.id));
  const seen = new Set<string>();

  return parsed.classifications.filter((item): item is ExpenseClassification => {
    if (!requestedIds.has(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export class ExpenseCategoryService {
  private ai: ClaudeAdapter;
  private model: ClaudeModel;

  constructor(
    private db: Database,
    anthropicApiKey: string,
    model: ClaudeModel = EXPENSE_CLASSIFIER_MODEL
  ) {
    this.ai = createClaudeAdapter(anthropicApiKey, model);
    this.model = model;
  }

  async processPendingForUser(userId: string, limit = 100): Promise<number> {
    const [user] = await this.db
      .select({ tossMyName: users.tossMyName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return 0;

    const bucket = bucketSql(user.tossMyName);
    const pending = await this.db
      .select({
        id: transactions.id,
        merchant: transactions.merchant,
        amount: transactions.amount,
        rawTitle: transactions.rawTitle,
        rawText: transactions.rawText,
      })
      .from(transactions)
      .leftJoin(accountRoles, accountRolesJoinOn)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.category),
          lt(transactions.categoryAttempts, 3),
          sql`${bucket} = 'spending'`
        )
      )
      .orderBy(asc(transactions.transactedAt))
      .limit(Math.max(1, Math.min(limit, 500)));

    let updated = 0;
    for (let offset = 0; offset < pending.length; offset += DEFAULT_BATCH_SIZE) {
      const batch = pending.slice(offset, offset + DEFAULT_BATCH_SIZE);
      let classifications: ExpenseClassification[];
      try {
        classifications = await classifyExpenses(this.ai, batch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.db
          .update(transactions)
          .set({
            categoryAttempts: sql`${transactions.categoryAttempts} + 1`,
            categoryError: message.slice(0, 1000),
          })
          .where(
            and(
              inArray(
                transactions.id,
                batch.map((item) => item.id)
              ),
              isNull(transactions.category)
            )
          );
        logger.warn("Expense classification batch failed", {
          userId,
          count: batch.length,
          error: message,
        });
        continue;
      }

      for (const classification of classifications) {
        const rows = await this.db
          .update(transactions)
          .set({
            category: classification.category,
            categorySource: "ai",
            categoryConfidence: classification.confidence,
            categoryModel: this.model,
            categoryAttempts: sql`${transactions.categoryAttempts} + 1`,
            categoryError: null,
            categorizedAt: new Date(),
          })
          .where(
            and(
              eq(transactions.id, classification.id),
              eq(transactions.userId, userId),
              isNull(transactions.category)
            )
          )
          .returning({ id: transactions.id });
        updated += rows.length;
      }

      const classifiedIds = new Set(classifications.map((item) => item.id));
      const missingIds = batch.filter((item) => !classifiedIds.has(item.id)).map((item) => item.id);
      if (missingIds.length > 0) {
        await this.db
          .update(transactions)
          .set({
            categoryAttempts: sql`${transactions.categoryAttempts} + 1`,
            categoryError: "AI 응답에 거래 ID가 누락됨",
          })
          .where(and(inArray(transactions.id, missingIds), isNull(transactions.category)));
      }
    }

    if (updated !== pending.length) {
      logger.warn("Expense classifier returned an incomplete batch", {
        userId,
        requested: pending.length,
        updated,
      });
    }
    return updated;
  }
}

export function createExpenseCategoryService(
  db: Database,
  anthropicApiKey: string,
  model?: ClaudeModel
): ExpenseCategoryService {
  return new ExpenseCategoryService(db, anthropicApiKey, model);
}
