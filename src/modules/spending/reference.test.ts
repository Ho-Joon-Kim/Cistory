import { describe, expect, it } from "vitest";
import { buildReferenceCurves, shiftMonthKey } from "./reference";
import type { DailySpending } from "./types";

const day = (date: string, total: number, health = 0): DailySpending => ({
  date,
  dayOfWeek: 0,
  total,
  categories: health > 0 ? { health, food: total - health } : { food: total },
});

describe("shiftMonthKey", () => {
  it("crosses year boundaries", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-11", -3)).toBe("2026-08");
  });
});

describe("buildReferenceCurves", () => {
  it("builds last month's cumulative by day, with the split part separate", () => {
    const refs = buildReferenceCurves(
      [day("2026-10-02", 10_000), day("2026-10-05", 50_000, 40_000)],
      "2026-11",
      30
    );
    expect(refs.previous?.months).toEqual(["2026-10"]);
    expect(refs.previous?.total.slice(0, 6)).toEqual([0, 10_000, 10_000, 10_000, 60_000, 60_000]);
    expect(refs.previous?.split[4]).toBe(40_000);
    expect(refs.previous?.total).toHaveLength(30);
    // A single settled month is not an average.
    expect(refs.average).toBeNull();
  });

  it("holds a shorter month's final total past its own end", () => {
    // February 2026 has 28 days; March has 31.
    const refs = buildReferenceCurves([day("2026-02-28", 7_000)], "2026-03", 31);
    expect(refs.previous?.total[27]).toBe(7_000);
    expect(refs.previous?.total[30]).toBe(7_000);
  });

  it("averages the settled months that have spending, ignoring empty ones", () => {
    const refs = buildReferenceCurves(
      [day("2026-10-01", 30_000), day("2026-09-01", 10_000), day("2026-11-01", 999)],
      "2026-11",
      30
    );
    expect(refs.average?.months).toEqual(["2026-09", "2026-10"]);
    expect(refs.average?.total[0]).toBe(20_000);
    // The current month never leaks into a reference.
    expect(refs.previous?.total[0]).toBe(30_000);
  });

  it("has no previous line when last month had no spending", () => {
    const refs = buildReferenceCurves(
      [day("2026-09-01", 10_000), day("2026-08-01", 10_000)],
      "2026-11",
      30
    );
    expect(refs.previous).toBeNull();
    expect(refs.average?.months).toEqual(["2026-08", "2026-09"]);
  });
});
