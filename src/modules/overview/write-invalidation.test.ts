import { describe, expect, it } from "vitest";
import { normalizeDayRanges, transactionDayRange } from "./write-invalidation";

describe("normalizeDayRanges", () => {
  it("swaps reversed bounds and drops non-date values", () => {
    expect(
      normalizeDayRanges([
        { from: "2026-03-05", to: "2026-03-01" },
        { from: "garbage", to: "2026-03-01" },
        { from: "2026-02-30", to: "2026-03-01" },
        { from: undefined, to: undefined },
      ])
    ).toEqual([{ from: "2026-03-01", to: "2026-03-05" }]);
  });

  it("merges overlapping and adjacent ranges, keeps disjoint ones apart", () => {
    expect(
      normalizeDayRanges([
        { from: "2026-03-10", to: "2026-03-12" },
        { from: "2026-03-01", to: "2026-03-03" },
        { from: "2026-03-04", to: "2026-03-05" },
        { from: "2026-03-02", to: "2026-03-02" },
      ])
    ).toEqual([
      { from: "2026-03-01", to: "2026-03-05" },
      { from: "2026-03-10", to: "2026-03-12" },
    ]);
  });
});

describe("transactionDayRange", () => {
  it("uses the KST day of the instant", () => {
    expect(transactionDayRange(new Date("2026-11-12T16:30:00Z"))).toEqual([
      { from: "2026-11-13", to: "2026-11-13" },
    ]);
    expect(transactionDayRange(null)).toEqual([]);
    expect(transactionDayRange(new Date("nope"))).toEqual([]);
  });
});
