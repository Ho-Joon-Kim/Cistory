/**
 * Spending read tools: `spending` (period totals + category breakdown +
 * transactions, offset-cursor paged) and `spending_forecast` (month-end
 * forecast). Transactions go through the shared transaction serializer (R6).
 */

import { z } from "zod";
import { createSpendingTrendService, getSpendingPeriod } from "@/modules/spending/service";
import { accessFromScopes, mask } from "../serialize";
import { defineTool, type McpTool } from "../server";
import {
  cursorField,
  dayRangeFields,
  decodeOffsetCursor,
  encodeOffsetCursor,
  limitField,
  NO_RECORDS,
  PAGE_DEFAULT_LIMIT,
  parseDayRange,
  RANGE_ARG_RULES,
  READ_ANNOTATIONS,
} from "./common";
import { loadTransferEvidence } from "./data";
import { serializeTransactions } from "./transaction-fields";

const BUCKETS = ["spending", "income", "ignore"] as const;
const SPENDING_MAX_DAYS = 366;

export const spendingTool = defineTool({
  name: "spending",
  kind: "read",
  scope: "read",
  title: "지출 기록",
  description:
    "기간(한국 날짜, 기본 최근 30일, 최대 366일)의 지출·수입·제외 합계, 지출 카테고리별 합계, 건별 거래를 " +
    "최근 순으로 돌려줍니다. 거래는 커서 페이지(기본 100건, 최대 500건). bucket으로 지출/수입/제외만 고를 수 있습니다. " +
    "민감 정보 권한이 없으면 계좌명과 개인 송금 상대 이름은 •••로 가려지고 알림 원문은 빠집니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    ...dayRangeFields,
    bucket: z.enum(BUCKETS).optional().describe("spending(지출) | income(수입) | ignore(제외)."),
    limit: limitField(),
    cursor: cursorField,
  }),
  argRules: { ...RANGE_ARG_RULES, bucket: "keep" },
  run: async (ctx, input) => {
    const range = parseDayRange(input, {
      now: ctx.now,
      defaultDays: 30,
      maxDays: SPENDING_MAX_DAYS,
    });
    const limit = input.limit ?? PAGE_DEFAULT_LIMIT;
    const offset = decodeOffsetCursor(input.cursor);
    const access = accessFromScopes(ctx.scopes);

    const result = await getSpendingPeriod(
      ctx.userId,
      { from: range.fromDate, to: range.toDate, bucket: input.bucket ?? null, limit, offset },
      ctx.db
    );
    // The period query doesn't select `isSelfTransfer`; fetch it with the raw text
    // so personal-transfer detection sees every signal.
    const evidence = await loadTransferEvidence(
      ctx.db,
      ctx.userId,
      result.transactions.map((t) => t.id)
    );
    const transactions = serializeTransactions(
      result.transactions.map((t) => ({
        ...t,
        ...(evidence.get(t.id) ?? { isSelfTransfer: true }),
      })),
      access
    );

    const s = result.summary;
    return {
      structured: {
        period: { from: range.fromDate, to: range.toDate },
        summary: {
          totalSpending: s.totalSpending,
          totalIncome: s.totalIncome,
          totalIgnored: s.totalIgnored,
          spendingCount: s.spendingCount,
          incomeCount: s.incomeCount,
          ignoredCount: s.ignoredCount,
          categories: s.categoryBreakdown.map((c) => ({
            category: c.category ?? "uncategorized",
            total: c.total,
            count: c.count,
          })),
          incomeFlow: {
            refundTotal: s.flow.refundTotal,
            refundCount: s.flow.refundCount,
            refundTopMerchant: s.flow.refundTopMerchant,
            inflowTotal: s.flow.inflowTotal,
            inflowCount: s.flow.inflowCount,
            inflowTopAccount: access.sensitive
              ? s.flow.inflowTopAccount
              : mask(s.flow.inflowTopAccount),
          },
        },
        transactions,
        message: transactions.length === 0 && offset === 0 ? NO_RECORDS : null,
        nextCursor: result.hasMore ? encodeOffsetCursor(offset + transactions.length) : null,
      },
      count: transactions.length,
    };
  },
});

export const spendingForecastTool = defineTool({
  name: "spending_forecast",
  kind: "read",
  scope: "read",
  title: "월말 지출 예측",
  description:
    "이번 달(한국 시간) 지출의 현재 합계와 월말 예측(상·하한, 일회성 큰 지출 보정 포함), " +
    "최근 13개월 월별 합계와 카테고리 구성을 돌려줍니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({}),
  argRules: {},
  run: async (ctx) => {
    const trend = await createSpendingTrendService(ctx.db).getSpendingTrend(ctx.userId, ctx.now);
    const f = trend.forecast;
    return {
      structured: {
        forecast: {
          currentMonthActualTotal: f.currentMonthActualTotal,
          predictedTotal: f.predictedTotal,
          lowerBound: f.lowerBound,
          upperBound: f.upperBound,
          todayDayNumber: f.todayDayNumber,
          daysInMonth: f.daysInMonth,
          oneOffTotal: f.oneOffTotal,
          oneOffCount: f.oneOffCount,
          oneOffThreshold: f.oneOffThreshold,
        },
        months: trend.monthlyBars.map((m) => ({
          month: m.key,
          total: m.total,
          isCurrent: m.isCurrent,
          predicted: m.predicted ?? null,
          categories: m.categories,
        })),
      },
      count: trend.monthlyBars.length,
    };
  },
});

export const SPENDING_TOOLS: McpTool[] = [spendingTool, spendingForecastTool];
