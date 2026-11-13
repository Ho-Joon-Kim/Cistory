import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";
import { correctTransaction, getSpendingPeriod, parseTransactionCorrection } from "./service";

describe("parseTransactionCorrection", () => {
  it("maps include/exclude/null overrides and trims the note", () => {
    expect(parseTransactionCorrection({ spendingOverride: "include" })).toEqual({
      value: { spendingOverride: "include" },
    });
    expect(parseTransactionCorrection({ overrideNote: "x".repeat(600) })).toEqual({
      value: { overrideNote: "x".repeat(500) },
    });
    expect(parseTransactionCorrection({ spendingOverride: "maybe" })).toEqual({
      error: "잘못된 spendingOverride 값",
    });
    expect(parseTransactionCorrection({})).toEqual({ error: "변경할 필드가 없습니다" });
  });
});

describe("correctTransaction", () => {
  it("passes before/after to inTx inside the transaction", async () => {
    const before = { id: "tx-1", category: null };
    const after = { id: "tx-1", category: "cafe" };
    const fake = createMockDb([[before], [after]]);
    const inTx = vi.fn(async () => {});
    const result = await correctTransaction(
      "user-1",
      "tx-1",
      { category: "cafe" },
      { inTx, database: fake.db }
    );
    expect(result).toEqual(after);
    expect(inTx).toHaveBeenCalledWith(fake.db, { before, after });
    expect(fake.whereParams()).toEqual([
      ["tx-1", "user-1"],
      ["tx-1", "user-1"],
    ]);
  });

  it("does not update or call inTx for a foreign transaction", async () => {
    const fake = createMockDb([[]]);
    const inTx = vi.fn(async () => {});
    expect(
      await correctTransaction("user-2", "tx-1", { category: "cafe" }, { inTx, database: fake.db })
    ).toBeNull();
    expect(inTx).not.toHaveBeenCalled();
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
  });
});

describe("getSpendingPeriod", () => {
  it("scopes every query to the user", async () => {
    const fake = createMockDb([[{ tossMyName: null }], [], [], [], []]);
    const result = await getSpendingPeriod(
      "user-1",
      { from: "2026-11-01", to: null, limit: 30, offset: 0 },
      fake.db
    );
    expect(result).toMatchObject({ transactions: [], hasMore: false, count: 0 });
    for (const params of fake.whereParams()) expect(params).toContain("user-1");
  });
});
