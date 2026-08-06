/**
 * Backfill uncategorized spending transactions with Claude Haiku.
 *
 * Preview: yarn spending:backfill-categories
 * Apply:   yarn spending:backfill-categories --apply
 * Options: --limit=100 --batch-size=25 --user=<uuid> --model=claude-haiku-4-5
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import pg from "pg";
import { EXPENSE_CATEGORIES } from "../src/modules/spending/categories.ts";

config({ path: ".env" });
config({ path: ".env.local", override: true });

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.split("=");
    return [key, value.length > 0 ? value.join("=") : true];
  })
);
const apply = args.has("--apply");
const limit = Math.max(1, Math.min(Number(args.get("--limit") ?? 500), 5000));
const batchSize = Math.max(1, Math.min(Number(args.get("--batch-size") ?? 25), 50));
const userId = args.get("--user");
const model = String(args.get("--model") ?? "claude-haiku-4-5");
// Sonnet 5 / Opus 5 reject non-default sampling params (temperature) with a
// 400. This script's default model accepts it and relies on it for
// deterministic classification; only send it for models known to accept it.
const SAMPLING_CAPABLE_MODELS = new Set(["claude-haiku-4-5"]);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 });
const allowed = new Set(EXPENSE_CATEGORIES);

function prompt(items) {
  return `한국의 개인 소비 거래를 분류하세요.
허용 카테고리: ${EXPENSE_CATEGORIES.join(", ")}
food=식사·배달·식료품, cafe=카페·음료, transport=대중교통·택시·철도·주유,
shopping=온라인쇼핑·의류·전자제품, housing=주거·공과금·통신·생활용품,
subscription=정기구독·멤버십, health=의료·약국·운동, leisure=문화·게임·취미,
education=도서·강의·학원, gift=선물·경조·개인송금, finance=수수료·보험·세금·대출,
travel=항공·숙박·여행, other=판단 불가.
id를 보존하고 설명 없이 다음 형식의 JSON만 반환하세요.
{"classifications":[{"id":"...","category":"food","confidence":90}]}
거래: ${JSON.stringify(items)}`;
}

function parseResponse(text, expectedIds) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const value = JSON.parse((fenced ?? text).trim());
  if (!Array.isArray(value.classifications)) throw new Error("classifications 배열 누락");
  const seen = new Set();
  return value.classifications.filter((item) => {
    if (!expectedIds.has(item.id) || seen.has(item.id) || !allowed.has(item.category)) return false;
    if (!Number.isInteger(item.confidence) || item.confidence < 0 || item.confidence > 100) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

async function loadPending() {
  const params = [];
  const userFilter = userId ? `AND t.user_id = $${params.push(userId)}` : "";
  params.push(limit);
  const result = await pool.query(
    `SELECT t.id, t.merchant, t.amount, t.raw_title AS "rawTitle", t.raw_text AS "rawText"
     FROM transactions t
     LEFT JOIN account_roles ar
       ON ar.user_id = t.user_id AND ar.account_name = t.account_name
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.category IS NULL
       AND t.category_attempts < 3
       ${userFilter}
       AND CASE
         WHEN t.spending_override = 'include' THEN 'spending'
         WHEN t.spending_override = 'exclude' THEN 'ignore'
         WHEN COALESCE(ar.role, 'default') = 'ignore' THEN 'ignore'
         WHEN COALESCE(ar.role, 'default') = 'spending'
           THEN CASE WHEN t.type = 'deposit' THEN 'spending' ELSE 'ignore' END
         WHEN t.is_self_transfer = true THEN 'ignore'
         WHEN t.type = 'withdrawal' AND (u.toss_my_name IS NULL OR t.merchant <> u.toss_my_name)
           THEN 'spending'
         WHEN t.type = 'deposit' THEN 'income'
         ELSE 'ignore'
       END = 'spending'
     ORDER BY t.transacted_at, t.id
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

function buildRequestOptions(batch) {
  const options = {
    model,
    max_tokens: Math.max(500, batch.length * 60),
    system: "당신은 한국 소비 거래 분류기입니다. 유효한 JSON만 출력하세요.",
    messages: [{ role: "user", content: prompt(batch) }],
  };
  if (SAMPLING_CAPABLE_MODELS.has(model)) options.temperature = 0;
  return options;
}

async function run() {
  const rows = await loadPending();
  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${rows.length} pending transactions, model=${model}`
  );
  if (!apply || rows.length === 0) return;

  let updated = 0;
  let failed = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    try {
      const response = await anthropic.messages.create(buildRequestOptions(batch));
      // content[0]이 아니라 text 블록을 찾는다 — adaptive thinking이 기본으로
      // 켜진 모델(Sonnet 5/Opus 5)은 첫 블록이 thinking이라 content[0]만
      // 읽으면 빈 문자열이 되어 배치 전체가 조용히 미분류로 남는다.
      const text = response.content.find((block) => block.type === "text")?.text ?? "";
      const classifications = parseResponse(text, new Set(batch.map((item) => item.id)));
      const classifiedIds = new Set(classifications.map((item) => item.id));

      for (const item of classifications) {
        const result = await pool.query(
          `UPDATE transactions SET category = $1, category_source = 'ai',
             category_confidence = $2, category_model = $3,
             category_attempts = category_attempts + 1, category_error = NULL,
             categorized_at = now()
           WHERE id = $4 AND category IS NULL`,
          [item.category, item.confidence, model, item.id]
        );
        updated += result.rowCount;
      }

      const missing = batch.filter((item) => !classifiedIds.has(item.id)).map((item) => item.id);
      if (missing.length > 0) {
        await pool.query(
          `UPDATE transactions SET category_attempts = category_attempts + 1,
             category_error = 'AI 응답에 거래 ID가 누락됨'
           WHERE id = ANY($1::uuid[]) AND category IS NULL`,
          [missing]
        );
        failed += missing.length;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await pool.query(
        `UPDATE transactions SET category_attempts = category_attempts + 1, category_error = $1
         WHERE id = ANY($2::uuid[]) AND category IS NULL`,
        [message.slice(0, 1000), batch.map((item) => item.id)]
      );
      failed += batch.length;
      console.error(`Batch ${offset / batchSize + 1} failed: ${message}`);
    }
    console.log(`Progress: ${Math.min(offset + batchSize, rows.length)}/${rows.length}`);
  }
  console.log(`Completed: updated=${updated}, failed=${failed}`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
