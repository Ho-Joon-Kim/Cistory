import { describe, expect, it } from "vitest";
import { aggregateReturnSnapshots } from "./return-coverage";
import { computeReturns } from "./returns";

const row = (accountId: string, asOfDate: string, value = 1_000_000, deposit = 0) => ({
  accountId,
  asOfDate,
  totalEvalAmount: value,
  deposit,
  totalPurchaseAmount: 1_000_000,
});

describe("aggregateReturnSnapshots", () => {
  it("compares complete endpoints across a missing day without treating it as a withdrawal", () => {
    const result = aggregateReturnSnapshots(
      [
        row("a", "2026-06-01"),
        row("b", "2026-06-01"),
        row("a", "2026-06-02"),
        row("a", "2026-06-03"),
        row("b", "2026-06-03", 1_100_000),
      ],
      ["a", "b"]
    );
    expect(
      computeReturns({ snapshots: result.snapshots, executions: [] }).twr.totalReturn
    ).toBeCloseTo(0.05);
    expect(result.coverage).toEqual({
      accountCount: 2,
      completeDates: 2,
      excludedDates: ["2026-06-02"],
    });
  });
  it("preserves a real deposit over a gap while removing it from market returns", () => {
    const result = aggregateReturnSnapshots(
      [
        row("a", "2026-06-01"),
        row("b", "2026-06-01"),
        row("a", "2026-06-02", 1_500_000, 500_000),
        row("a", "2026-06-03", 1_500_000, 500_000),
        row("b", "2026-06-03"),
      ],
      ["a", "b"]
    );
    const returns = computeReturns({ snapshots: result.snapshots, executions: [] });
    expect(returns.twr.totalReturn).toBe(0);
    expect(returns.cashflows).toEqual([expect.objectContaining({ amount: 500_000 })]);
  });
  it("single-account mode does not depend on other accounts' availability", () => {
    const result = aggregateReturnSnapshots(
      [row("a", "2026-06-01"), row("b", "2026-06-01"), row("a", "2026-06-02")],
      ["a"]
    );
    expect(result.snapshots).toHaveLength(2);
    expect(result.snapshots[0].totalEvalAmount).toBe(1_000_000);
    expect(result.coverage.excludedDates).toEqual([]);
  });
});
