/**
 * Period history for the /overview hero: the same handful of scalars (commits,
 * cash flow, steps, heart rate, weight) for the periods around the one being
 * viewed, read from *stored* snapshots only — reads never aggregate on demand.
 *
 * A period's value comes from its own snapshot when one exists; otherwise from
 * the daily series of any larger stored snapshot that fully covers it (a year
 * snapshot carries every day of its months and weeks). A period nothing covers
 * stays `null` — missing data is never reported as zero.
 */
import { shiftDateKey } from "@/lib/date-key";
import { toLocalDateString } from "@/lib/utils";
import { getPeriodKey, getPeriodRange, type PeriodType } from "./period";
import type { HealthMetricAggregate } from "./types";

/** How many periods the hero's history bars show (the viewed one included). */
export const OVERVIEW_HISTORY_LENGTH = 10;

export type HistoryPeriodType = Exclude<PeriodType, "recent">;

export interface HistorySnapshotRow {
  periodType: PeriodType;
  periodKey: string;
  /**
   * Row status. A `pending`/`computing` row is being (re)computed: its range is
   * unknown for now — never read as data and never reported as empty. Absent = ready.
   */
  status?: string;
  codingStatus: string | null;
  dailyCommits: { date: string; count: number }[] | null;
  spendingStatus: string | null;
  spendingDaily: { date: string; spending: number; income: number }[] | null;
  healthStatus: string | null;
  healthMetrics: Pick<HealthMetricAggregate, "metric" | "days">[] | null;
  weightSeries: { date: string; weight: number }[] | null;
}

export interface OverviewHistoryPeriod {
  periodType: HistoryPeriodType;
  periodKey: string;
  /** Inclusive KST date keys. */
  from: string;
  to: string;
  /** `today` falls inside the period. */
  inProgress: boolean;
  commits: number | null;
  activeDays: number | null;
  spending: number | null;
  income: number | null;
  /** Step total over the days that have a step record, and how many such days. */
  steps: { total: number; days: number } | null;
  /** Mean of the daily resting/average heart-rate values. */
  heartRate: number | null;
  /** Last weigh-in inside the period. */
  weight: { date: string; weight: number } | null;
  /**
   * A domain is null only because its snapshot is still being computed — the
   * period is unknown for now, not empty. Copy says "계산 중", and facts that
   * rank or share across periods skip the window rather than drop it silently.
   */
  pending: boolean;
}

export interface OverviewHistoryResponse {
  periodType: HistoryPeriodType;
  periodKey: string;
  /** The period immediately before the viewed one (same type). */
  previous: OverviewHistoryPeriod | null;
  /**
   * While the viewed period is in progress: the previous period cut to the same
   * elapsed span (11/1–11/10 → 10/1–10/10; `to` is the span's last day). A partial
   * period is compared with this, never with the whole previous period. Null for
   * an ended period or when nothing covers that span.
   */
  previousToDate?: OverviewHistoryPeriod | null;
  /**
   * Bars for the hero: the last {@link OVERVIEW_HISTORY_LENGTH} weeks/months
   * ending at the viewed one; for a year, its months up to the current one.
   */
  series: OverviewHistoryPeriod[];
  /** Every weigh-in across the series window, oldest first. */
  weight: { date: string; weight: number }[];
}

interface DateRange {
  from: string;
  /** Inclusive. */
  to: string;
}

export function periodDateRange(periodType: PeriodType, periodKey: string): DateRange {
  const range = getPeriodRange(periodType, periodKey);
  const end = new Date(range.toExclusive);
  end.setDate(end.getDate() - 1);
  return { from: toLocalDateString(range.from), to: toLocalDateString(end) };
}

/** The key `steps` periods before/after `periodKey` (negative = earlier). */
export function shiftPeriodKey(periodType: PeriodType, periodKey: string, steps: number): string {
  let key = periodKey;
  const direction = steps < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(steps); i++) {
    const range = periodDateRange(periodType, key);
    const reference = direction < 0 ? shiftDateKey(range.from, -1) : shiftDateKey(range.to, 1);
    key = getPeriodKey(periodType, new Date(`${reference}T12:00:00`));
  }
  return key;
}

/**
 * Which snapshots the history needs: the series periods + the previous period
 * (same type, or months for a year), plus every year snapshot overlapping them
 * as the fallback source.
 */
export function historyPlan(
  periodType: HistoryPeriodType,
  periodKey: string,
  today: string
): {
  series: { periodType: HistoryPeriodType; periodKey: string }[];
  previous: { periodType: HistoryPeriodType; periodKey: string };
  snapshotKeys: { periodType: HistoryPeriodType; periodKeys: string[] }[];
} {
  const previous = { periodType, periodKey: shiftPeriodKey(periodType, periodKey, -1) };
  let series: { periodType: HistoryPeriodType; periodKey: string }[];
  if (periodType === "year") {
    const lastMonth = today.slice(0, 4) === periodKey ? today.slice(0, 7) : `${periodKey}-12`;
    series = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${periodKey}-${String(m).padStart(2, "0")}`;
      if (key > lastMonth) break;
      series.push({ periodType: "month", periodKey: key });
    }
  } else {
    series = [];
    for (let i = OVERVIEW_HISTORY_LENGTH - 1; i >= 0; i--) {
      series.push({ periodType, periodKey: shiftPeriodKey(periodType, periodKey, -i) });
    }
  }

  const years = new Set<string>();
  for (const period of [...series, previous]) {
    const range = periodDateRange(period.periodType, period.periodKey);
    years.add(range.from.slice(0, 4));
    years.add(range.to.slice(0, 4));
  }
  const exact = new Map<HistoryPeriodType, Set<string>>();
  for (const period of [...series, previous]) {
    if (!exact.has(period.periodType)) exact.set(period.periodType, new Set());
    exact.get(period.periodType)?.add(period.periodKey);
  }
  const yearKeys = exact.get("year") ?? new Set<string>();
  for (const year of years) yearKeys.add(year);
  exact.set("year", yearKeys);

  return {
    series,
    previous,
    snapshotKeys: [...exact].map(([type, keys]) => ({ periodType: type, periodKeys: [...keys] })),
  };
}

type Domain = "coding" | "spending" | "health";

interface DaySources {
  commits: Map<string, number>;
  spending: Map<string, { spending: number; income: number }>;
  steps: Map<string, number>;
  heartRate: Map<string, number>;
  weight: Map<string, number>;
  covered: Record<Domain, DateRange[]>;
  /** Ranges of snapshots still being computed. */
  computing: DateRange[];
}

function ready(status: string | null): boolean {
  return status === "ready";
}

function metricDays(row: HistorySnapshotRow, metric: string) {
  return row.healthMetrics?.find((m) => m.metric === metric)?.days ?? [];
}

function collectDays(rows: HistorySnapshotRow[]): DaySources {
  const sources: DaySources = {
    commits: new Map(),
    spending: new Map(),
    steps: new Map(),
    heartRate: new Map(),
    weight: new Map(),
    covered: { coding: [], spending: [], health: [] },
    computing: [],
  };
  // Larger snapshots first so a period's own (fresher, smaller) snapshot wins on overlap.
  const order: Record<PeriodType, number> = { year: 0, month: 1, week: 2, recent: 3 };
  const sorted = [...rows].sort((a, b) => order[a.periodType] - order[b.periodType]);
  for (const row of sorted) {
    const range = periodDateRange(row.periodType, row.periodKey);
    if (row.status === "pending" || row.status === "computing") {
      sources.computing.push(range);
      continue;
    }
    if (ready(row.codingStatus) && row.dailyCommits) {
      sources.covered.coding.push(range);
      for (let d = range.from; d <= range.to; d = shiftDateKey(d, 1)) sources.commits.delete(d);
      for (const day of row.dailyCommits) sources.commits.set(day.date, Number(day.count) || 0);
    }
    if (ready(row.spendingStatus) && row.spendingDaily) {
      sources.covered.spending.push(range);
      for (let d = range.from; d <= range.to; d = shiftDateKey(d, 1)) sources.spending.delete(d);
      for (const day of row.spendingDaily) {
        sources.spending.set(day.date, {
          spending: Number(day.spending) || 0,
          income: Number(day.income) || 0,
        });
      }
    }
    if (ready(row.healthStatus) && row.healthMetrics) {
      sources.covered.health.push(range);
      for (const day of metricDays(row, "steps")) {
        if (day.value != null && Number.isFinite(Number(day.value))) {
          sources.steps.set(day.date, Number(day.value));
        }
      }
      for (const day of metricDays(row, "heart_rate")) {
        if (day.value != null && Number.isFinite(Number(day.value))) {
          sources.heartRate.set(day.date, Number(day.value));
        }
      }
    }
    for (const point of row.weightSeries ?? []) {
      if (Number.isFinite(Number(point.weight)))
        sources.weight.set(point.date, Number(point.weight));
    }
  }
  return sources;
}

function isCovered(ranges: DateRange[], range: DateRange): boolean {
  for (let d = range.from; d <= range.to; d = shiftDateKey(d, 1)) {
    if (!ranges.some((r) => d >= r.from && d <= r.to)) return false;
  }
  return true;
}

function summarize(
  sources: DaySources,
  periodType: HistoryPeriodType,
  periodKey: string,
  today: string,
  /** Cut the period at this day (inclusive): the same-span comparison base. */
  spanTo?: string
): OverviewHistoryPeriod {
  const full = periodDateRange(periodType, periodKey);
  const inProgress = today >= full.from && today <= full.to;
  // An in-progress period only needs coverage up to today.
  const end = inProgress ? today : full.to;
  const range = { from: full.from, to: spanTo && spanTo < end ? spanTo : end };
  const future = range.from > today;
  const days: string[] = [];
  if (!future) for (let d = range.from; d <= range.to; d = shiftDateKey(d, 1)) days.push(d);

  const codingOk = !future && isCovered(sources.covered.coding, range);
  const spendingOk = !future && isCovered(sources.covered.spending, range);
  const healthOk = !future && isCovered(sources.covered.health, range);
  const awaiting = (domain: Domain) =>
    !future && isCovered([...sources.covered[domain], ...sources.computing], range);
  const pending =
    (!codingOk && awaiting("coding")) ||
    (!spendingOk && awaiting("spending")) ||
    (!healthOk && awaiting("health"));

  let commits = 0;
  let activeDays = 0;
  let spending = 0;
  let income = 0;
  let stepTotal = 0;
  let stepDays = 0;
  let hrSum = 0;
  let hrDays = 0;
  let weight: OverviewHistoryPeriod["weight"] = null;
  for (const day of days) {
    const c = sources.commits.get(day) ?? 0;
    commits += c;
    if (c > 0) activeDays += 1;
    const cash = sources.spending.get(day);
    if (cash) {
      spending += cash.spending;
      income += cash.income;
    }
    const steps = sources.steps.get(day);
    if (steps !== undefined) {
      stepTotal += steps;
      stepDays += 1;
    }
    const hr = sources.heartRate.get(day);
    if (hr !== undefined) {
      hrSum += hr;
      hrDays += 1;
    }
    const w = sources.weight.get(day);
    if (w !== undefined) weight = { date: day, weight: w };
  }

  return {
    periodType,
    periodKey,
    from: full.from,
    to: spanTo ? range.to : full.to,
    inProgress,
    commits: codingOk ? commits : null,
    activeDays: codingOk ? activeDays : null,
    spending: spendingOk ? spending : null,
    income: spendingOk ? income : null,
    steps: healthOk && stepDays > 0 ? { total: stepTotal, days: stepDays } : null,
    heartRate: healthOk && hrDays > 0 ? hrSum / hrDays : null,
    weight,
    pending,
  };
}

export function buildOverviewHistory(input: {
  periodType: HistoryPeriodType;
  periodKey: string;
  today: string;
  rows: HistorySnapshotRow[];
}): OverviewHistoryResponse {
  const plan = historyPlan(input.periodType, input.periodKey, input.today);
  const sources = collectDays(input.rows);
  const series = plan.series.map((p) => summarize(sources, p.periodType, p.periodKey, input.today));
  const previous = summarize(
    sources,
    plan.previous.periodType,
    plan.previous.periodKey,
    input.today
  );
  const windowFrom = periodDateRange(plan.series[0].periodType, plan.series[0].periodKey).from;
  const last = plan.series[plan.series.length - 1];
  const windowTo = periodDateRange(last.periodType, last.periodKey).to;
  const weight = [...sources.weight]
    .filter(([date]) => date >= windowFrom && date <= windowTo)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, w]) => ({ date, weight: w }));
  const hasAny = (p: OverviewHistoryPeriod) =>
    p.commits !== null || p.spending !== null || p.steps !== null || p.weight !== null;

  const viewed = periodDateRange(input.periodType, input.periodKey);
  let previousToDate: OverviewHistoryPeriod | null = null;
  if (input.today >= viewed.from && input.today <= viewed.to) {
    let elapsed = 0;
    for (let d = viewed.from; d <= input.today; d = shiftDateKey(d, 1)) elapsed++;
    const prevRange = periodDateRange(plan.previous.periodType, plan.previous.periodKey);
    const spanTo = shiftDateKey(prevRange.from, elapsed - 1);
    const cut = summarize(
      sources,
      plan.previous.periodType,
      plan.previous.periodKey,
      input.today,
      spanTo < prevRange.to ? spanTo : prevRange.to
    );
    previousToDate = hasAny(cut) ? cut : null;
  }
  return {
    periodType: input.periodType,
    periodKey: input.periodKey,
    previous: hasAny(previous) ? previous : null,
    previousToDate,
    series,
    weight,
  };
}
