import { describe, expect, it } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";
import {
  getPortfolioReturns,
  getTargetAllocations,
  isDateKey,
  PortfolioAccountNotFoundError,
  RETURNS_EPOCH,
} from "./queries";

describe("portfolio queries", () => {
  it("rejects an account the user doesn't own", async () => {
    const fake = createMockDb([[{ id: "a1" }]]);
    await expect(
      getPortfolioReturns("user-1", { accountId: "other" }, fake.db)
    ).rejects.toBeInstanceOf(PortfolioAccountNotFoundError);
    expect(fake.whereParams()[0]).toEqual(["user-1"]);
  });

  it("clamps the lower bound to RETURNS_EPOCH", async () => {
    const fake = createMockDb([[{ id: "a1" }], [], []]);
    await getPortfolioReturns("user-1", { from: "2026-01-01" }, fake.db);
    expect(fake.whereParams()[1]).toContain(RETURNS_EPOCH);
  });

  it("returns null targets for a foreign account", async () => {
    const fake = createMockDb([[]]);
    expect(await getTargetAllocations("user-1", "a9", fake.db)).toBeNull();
    expect(fake.whereParams()[0]).toEqual(["a9", "user-1"]);
  });

  it("validates calendar dates", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("20260228")).toBe(false);
  });
});
