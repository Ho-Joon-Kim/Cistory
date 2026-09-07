import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: mocks.getDb,
}));

import { GET } from "./route";

const snapshot = (accountId: string, asOfDate: string, deposit = 0) => ({
  accountId,
  asOfDate,
  totalEvalAmount: "1000000",
  deposit: String(deposit),
  totalPurchaseAmount: "1000000",
});
function database(snapshots: unknown[], executions: unknown[] = [], ids = ["a", "b"]) {
  const conditions: SQL[] = [];
  const datasets = [ids.map((id) => ({ id })), snapshots, executions];
  const select = vi.fn(() => {
    const rows = datasets.shift() ?? [];
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn((condition: SQL) => {
        conditions.push(condition);
        return builder;
      }),
      orderBy: vi.fn(() => builder),
      // biome-ignore lint/suspicious/noThenProperty: Drizzle queries are thenable.
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return builder;
  });
  mocks.getDb.mockReturnValue({ select });
  return conditions;
}
async function get(query = "") {
  return GET(new NextRequest(`http://localhost/api/portfolio/returns${query}`), undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user" }, error: null });
});
describe("portfolio return coverage", () => {
  it("does not report a loss when an account snapshot is missing", async () => {
    database([
      snapshot("a", "2026-06-01"),
      snapshot("b", "2026-06-01"),
      snapshot("a", "2026-06-02"),
    ]);
    const body = await (await get()).json();
    expect(body.twr.totalReturn).toBeNull();
    expect(body.coverage.excludedDates).toEqual(["2026-06-02"]);
  });
  it("starts at common coverage instead of reporting a gain for a new account", async () => {
    database([
      snapshot("a", "2026-06-01"),
      snapshot("a", "2026-06-02"),
      snapshot("b", "2026-06-02"),
      snapshot("a", "2026-06-03"),
      snapshot("b", "2026-06-03"),
    ]);
    const body = await (await get()).json();
    expect(body.twr.totalReturn).toBe(0);
    expect(body.startDate).toBe("2026-06-02");
  });
  it("does not silently ignore a selected account with no snapshots", async () => {
    database([snapshot("a", "2026-06-01"), snapshot("a", "2026-06-02")]);
    expect((await (await get()).json()).twr.totalReturn).toBeNull();
  });
  it("includes prior-period fills settling in the selected range", async () => {
    const conditions = database(
      [snapshot("a", "2026-06-02", 500000), snapshot("a", "2026-06-03", 0)],
      [{ ordDt: "20260601", side: "buy", filledAmount: "500000", cancelled: false }],
      ["a"]
    );
    const body = await (await get("?from=2026-06-02&to=2026-06-03")).json();
    const executionQuery = new PgDialect().sqlToQuery(conditions[2]);
    const lowerDate = executionQuery.params.find(
      (p) => typeof p === "string" && /^2026\d{4}$/.test(p)
    ) as string;
    expect(lowerDate <= "20260601").toBe(true);
    expect(body.twr.totalReturn).toBe(0);
    expect(body.cashflows).toEqual([]);
  });
  it.each(["?from=2026-02-30", "?to=invalid", "?from=", "?from=2026-06-03&to=2026-06-01"])(
    "rejects invalid range %s",
    async (query) => {
      database([]);
      expect((await get(query)).status).toBe(400);
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );
});
