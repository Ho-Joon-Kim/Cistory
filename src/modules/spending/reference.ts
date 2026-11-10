import type { SpendingCategoryKey } from "./categories";
import type { DailySpending, ReferenceCurve, SpendingReferences } from "./types";

/** How many settled months the "평균" reference line averages. */
export const REFERENCE_AVERAGE_MONTHS = 3;

function daysIn(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "YYYY-MM" shifted by `delta` months. */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Per-day cumulative totals of one settled month, indexed day-1 over `length`
 * days. A day past the month's own end carries its final total, so a 30-day
 * month still has a value to compare on the current month's 31st.
 */
function monthCurve(
  days: DailySpending[],
  monthKey: string,
  length: number,
  split: SpendingCategoryKey
): { total: number[]; split: number[] } {
  const own = daysIn(monthKey);
  const dailyTotal = new Array<number>(own).fill(0);
  const dailySplit = new Array<number>(own).fill(0);
  for (const d of days) {
    const day = Number(d.date.slice(8, 10));
    if (day < 1 || day > own) continue;
    dailyTotal[day - 1] += d.total;
    dailySplit[day - 1] += d.categories?.[split] ?? 0;
  }
  const total: number[] = [];
  const splitCum: number[] = [];
  let t = 0;
  let s = 0;
  for (let i = 0; i < length; i++) {
    if (i < own) {
      t += dailyTotal[i];
      s += dailySplit[i];
    }
    total.push(t);
    splitCum.push(s);
  }
  return { total, split: splitCum };
}

/**
 * The reference lines the cumulative chart draws behind this month: last
 * month's cumulative day by day, and the average of the last three settled
 * months that have any spending (a month before logging began would only drag
 * the average down). Both carry the 의료·건강 part separately so the chart and
 * the hero sentence can compare "의료·건강 제외" on the same basis.
 */
export function buildReferenceCurves(
  history: DailySpending[],
  currentMonthKey: string,
  daysInMonth: number,
  split: SpendingCategoryKey = "health"
): SpendingReferences {
  const byMonth = new Map<string, DailySpending[]>();
  for (const d of history) {
    const key = d.date.slice(0, 7);
    if (key >= currentMonthKey) continue;
    const list = byMonth.get(key) ?? [];
    list.push(d);
    byMonth.set(key, list);
  }
  const curveOf = (key: string): ReferenceCurve | null => {
    const days = byMonth.get(key);
    if (!days || days.length === 0) return null;
    const c = monthCurve(days, key, daysInMonth, split);
    return { months: [key], total: c.total, split: c.split };
  };

  const previous = curveOf(shiftMonthKey(currentMonthKey, -1));
  const settled: ReferenceCurve[] = [];
  for (let i = 1; i <= REFERENCE_AVERAGE_MONTHS; i++) {
    const c = curveOf(shiftMonthKey(currentMonthKey, -i));
    if (c) settled.push(c);
  }
  // One month is just "last month" again — an average needs at least two.
  const average: ReferenceCurve | null =
    settled.length >= 2
      ? {
          months: settled.map((c) => c.months[0]).sort(),
          total: Array.from({ length: daysInMonth }, (_, i) =>
            Math.round(settled.reduce((s, c) => s + c.total[i], 0) / settled.length)
          ),
          split: Array.from({ length: daysInMonth }, (_, i) =>
            Math.round(settled.reduce((s, c) => s + c.split[i], 0) / settled.length)
          ),
        }
      : null;
  return { previous, average };
}
