import { describe, expect, it } from "vitest";
import { forecastMonthEnd, oneOffThreshold } from "./forecast";
import type { DailySpending, MonthlyTotal } from "./types";

// The real November 2026 case: one 1,800,000원 charge on day 4 plus
// 283,890원 of everyday spending over the first 9 days.
const history: MonthlyTotal[] = [
  { month: "2026-03", total: 1_012_969 },
  { month: "2026-04", total: 1_343_950 },
  { month: "2026-05", total: 4_609_453 },
  { month: "2026-06", total: 3_040_140 },
  { month: "2026-07", total: 3_911_341 },
  { month: "2026-08", total: 1_854_140 },
  { month: "2026-09", total: 5_701_099 },
  { month: "2026-10", total: 5_417_390 },
];

function day(date: string, total: number): DailySpending {
  return { date, dayOfWeek: 0, total, categories: {} };
}

const currentMonthDays = [
  day("2026-11-03", 5_940),
  day("2026-11-04", 1_809_280),
  day("2026-11-09", 268_670),
];
const everyday = 2_083_890 - 1_800_000;

describe("forecastMonthEnd", () => {
  it("adds a one-off large charge back once instead of extrapolating it", () => {
    const result = forecastMonthEnd({
      monthlyHistory: history,
      currentMonthDays,
      currentMonthAmounts: [1_800_000, 5_940, 9_280, 100_000, 50_000],
      daysInMonth: 30,
      todayDayNumber: 9,
    });
    expect(result.predictedTotal).toBe(1_800_000 + Math.round((everyday * 30) / 9));
    expect(result.predictedTotal).toBeLessThan(3_000_000);
    expect(result.lowerBound).toBeGreaterThanOrEqual(2_083_890);
    expect(result.dailyPredictions.at(-1)?.mid).toBe(result.predictedTotal);
  });

  it("extrapolates everything when no transaction crosses the threshold", () => {
    const result = forecastMonthEnd({
      monthlyHistory: history,
      currentMonthDays: [day("2026-11-01", 90_000)],
      currentMonthAmounts: [40_000, 50_000],
      daysInMonth: 30,
      todayDayNumber: 3,
    });
    expect(result.predictedTotal).toBe(900_000);
  });

  it("falls back to plain extrapolation without history", () => {
    const result = forecastMonthEnd({
      monthlyHistory: [],
      currentMonthDays: [day("2026-11-01", 1_000_000)],
      currentMonthAmounts: [1_000_000],
      daysInMonth: 30,
      todayDayNumber: 10,
    });
    expect(result.predictedTotal).toBe(3_000_000);
  });
});

describe("oneOffThreshold", () => {
  it("is a fraction of the median past monthly total", () => {
    // median of the 8 months above = (3,040,140 + 3,911,341) / 2
    expect(oneOffThreshold(history)).toBe(Math.round(0.2 * ((3_040_140 + 3_911_341) / 2)));
  });

  it("is null without history", () => {
    expect(oneOffThreshold([])).toBeNull();
  });
});
