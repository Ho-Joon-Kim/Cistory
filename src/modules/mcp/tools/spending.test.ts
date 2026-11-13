import { beforeEach, describe, expect, it, vi } from "vitest";
import { MASK } from "../serialize";
import { spendingForecastTool, spendingTool } from "./spending";
import { callTool, TEST_USER_ID, toolContext } from "./test-context";

const mocks = vi.hoisted(() => ({
  getSpendingPeriod: vi.fn(),
  getSpendingTrend: vi.fn(),
  loadTransferEvidence: vi.fn(),
}));

vi.mock("@/modules/spending/service", () => ({
  getSpendingPeriod: mocks.getSpendingPeriod,
  createSpendingTrendService: () => ({ getSpendingTrend: mocks.getSpendingTrend }),
}));
vi.mock("./data", () => ({ loadTransferEvidence: mocks.loadTransferEvidence }));

const at = new Date("2026-11-12T03:00:00Z");
const rows = [
  {
    id: "t-card",
    type: "withdrawal",
    amount: 13900,
    merchant: "스타벅스",
    accountName: "토스뱅크 체크카드",
    rawTitle: "13,900원 결제",
    rawText: "토스뱅크 체크카드 | 스타벅스",
    transactedAt: at,
    bucket: "spending",
    isRefund: false,
    category: "cafe",
  },
  {
    id: "t-in",
    type: "deposit",
    amount: 50000,
    merchant: "홍길동",
    accountName: "내 토스뱅크 통장",
    rawTitle: "50,000원 입금",
    rawText: "홍길동 → 내 토스뱅크 통장",
    transactedAt: at,
    bucket: "income",
    isRefund: false,
    category: null,
  },
];

function periodResult(hasMore = false) {
  return {
    transactions: rows,
    hasMore,
    summary: {
      totalSpending: 13900,
      totalIncome: 50000,
      totalIgnored: 0,
      spendingCount: 1,
      incomeCount: 1,
      ignoredCount: 0,
      categoryBreakdown: [{ category: "cafe", total: 13900, count: 1 }],
      flow: {
        refundTotal: 0,
        refundCount: 0,
        refundTopMerchant: null,
        inflowTotal: 50000,
        inflowCount: 1,
        inflowTopAccount: "내 토스뱅크 통장",
      },
    },
  };
}

beforeEach(() => {
  mocks.getSpendingPeriod.mockResolvedValue(periodResult(true));
  mocks.loadTransferEvidence.mockImplementation(async () => {
    return new Map(rows.map((r) => [r.id, { ...r, isSelfTransfer: false }]));
  });
});

describe("spending tool", () => {
  it("AE1: read token sees card merchants but not transfer counterparties or accounts", async () => {
    const out = await callTool(spendingTool, { from: "2026-11-01", to: "2026-11-13" });
    const txs = out.structured.transactions as Record<string, unknown>[];
    expect(txs[0].merchant).toBe("스타벅스");
    expect(txs[1].merchant).toBe(MASK);
    expect(txs.every((t) => t.accountName === MASK)).toBe(true);
    expect(JSON.stringify(out.structured)).not.toContain("rawText");
    expect(JSON.stringify(out.structured)).not.toContain("홍길동");
    expect(JSON.stringify(out.structured)).not.toContain("내 토스뱅크 통장");
    expect(
      (out.structured.summary as { incomeFlow: { inflowTopAccount: unknown } }).incomeFlow
        .inflowTopAccount
    ).toBe(MASK);
  });

  it("sensitive-read token sees counterparties, accounts and raw text", async () => {
    const out = await callTool(spendingTool, {}, toolContext(["read", "sensitive-read"]));
    const txs = out.structured.transactions as Record<string, unknown>[];
    expect(txs[1].merchant).toBe("홍길동");
    expect(txs[1].accountName).toBe("내 토스뱅크 통장");
    expect(txs[1].rawText).toBe("홍길동 → 내 토스뱅크 통장");
  });

  it("passes KST day keys, the owner and an offset cursor through", async () => {
    const first = await callTool(spendingTool, { from: "2026-11-01", to: "2026-11-13", limit: 2 });
    expect(mocks.getSpendingPeriod).toHaveBeenCalledWith(
      TEST_USER_ID,
      { from: "2026-11-01", to: "2026-11-13", bucket: null, limit: 2, offset: 0 },
      expect.anything()
    );
    const cursor = first.structured.nextCursor as string;
    expect(cursor).toBeTruthy();
    await callTool(spendingTool, { from: "2026-11-01", to: "2026-11-13", limit: 2, cursor });
    expect(mocks.getSpendingPeriod.mock.calls[1][1]).toMatchObject({ offset: 2 });
  });

  it("rejects instants (date-only tool), limits over 500 and a bad cursor", async () => {
    await expect(callTool(spendingTool, { from: "2026-11-01T00:00:00+09:00" })).rejects.toThrow(
      /날짜만/
    );
    expect(spendingTool.inputSchema.safeParse({ limit: 501 }).success).toBe(false);
    await expect(callTool(spendingTool, { cursor: "garbage" })).rejects.toThrow(/cursor/);
  });

  it("masks a row whose evidence is missing", async () => {
    mocks.loadTransferEvidence.mockResolvedValue(new Map());
    const out = await callTool(spendingTool, {});
    const txs = out.structured.transactions as Record<string, unknown>[];
    expect(txs[0].merchant).toBe(MASK);
  });
});

describe("spending_forecast tool", () => {
  it("returns the forecast and monthly bars", async () => {
    mocks.getSpendingTrend.mockResolvedValue({
      forecast: {
        predictedTotal: 1_000_000,
        upperBound: 1_200_000,
        lowerBound: 900_000,
        todayDayNumber: 13,
        daysInMonth: 30,
        currentMonthActualTotal: 400_000,
        oneOffTotal: 0,
        oneOffCount: 0,
        oneOffThreshold: null,
      },
      monthlyBars: [
        { month: "11", key: "2026-11", total: 400_000, isCurrent: true, categories: {} },
      ],
      cumulativeCurve: [],
    });
    const ctx = toolContext();
    const out = await callTool(spendingForecastTool, {}, ctx);
    expect(mocks.getSpendingTrend).toHaveBeenCalledWith(TEST_USER_ID, ctx.now);
    expect(out.structured.forecast).toMatchObject({ predictedTotal: 1_000_000 });
    expect(out.structured.months).toEqual([
      { month: "2026-11", total: 400_000, isCurrent: true, predicted: null, categories: {} },
    ]);
  });
});
