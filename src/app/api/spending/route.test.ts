import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: mocks.getDb,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});

const txRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "withdrawal",
  amount: 1000,
  merchant: "카페",
  accountName: "토스뱅크",
  rawTitle: "결제",
  rawText: "카페 1,000원",
  transactedAt: new Date("2026-11-01T03:00:00Z"),
  spendingOverride: null,
  overrideNote: null,
  category: "cafe",
  categorySource: "ai",
  categoryConfidence: 0.9,
  bucket: "spending",
  isRefund: null,
  ...extra,
});

describe("GET /api/spending", () => {
  it("pins the response shape: rows, bucket totals, legacy aliases, flow", async () => {
    const fake = createMockDb([
      [{ tossMyName: "홍길동" }],
      [txRow("t1"), txRow("t2", { isRefund: true }), txRow("t3")],
      [
        { bucket: "spending", total: "3000", count: "3" },
        { bucket: "income", total: "500", count: "1" },
        { bucket: "ignore", total: "10", count: "2" },
      ],
      [{ category: "cafe", total: "3000", count: "3" }],
      [{ isRefund: true, merchant: "카페", accountName: "토스뱅크", total: "500", count: "1" }],
    ]);
    mocks.getDb.mockReturnValue(fake.db);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/spending?from=2026-11-01&to=2026-11-30&limit=2&offset=0&bucket=spending"
      )
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ hasMore: true, count: 2, limit: 2, offset: 0 });
    expect(body.transactions).toEqual([
      { ...txRow("t1"), transactedAt: "2026-11-01T03:00:00.000Z", isRefund: false },
      { ...txRow("t2"), transactedAt: "2026-11-01T03:00:00.000Z", isRefund: true },
    ]);
    expect(body.summary).toMatchObject({
      totalSpending: 3000,
      totalIncome: 500,
      totalIgnored: 10,
      spendingCount: 3,
      incomeCount: 1,
      ignoredCount: 2,
      totalWithdrawal: 3000,
      totalDeposit: 500,
      withdrawalCount: 3,
      depositCount: 1,
      categoryBreakdown: [{ category: "cafe", total: 3000, count: 3 }],
    });
    expect(body.summary.flow).toBeDefined();
    expect(Object.keys(body).sort()).toEqual(
      ["count", "hasMore", "limit", "offset", "summary", "transactions"].sort()
    );
    for (const params of fake.whereParams()) expect(params).toContain("user-1");
    expect(
      fake.calls.find(
        (c) => c.op === "select" && c.chain.some((s) => s.method === "limit" && s.args[0] === 3)
      )
    ).toBeDefined();
  });
});
