/**
 * Fact builders. Each takes already-aggregated numbers (never raw rows), computes
 * one candidate fact and scores how notable it is (0..1). They return `null` only
 * when the fact can't be computed at all (no baseline, empty series); a computable
 * but unremarkable fact comes back with a low score so `pickNotable` can drop it.
 *
 * Scores are comparable across kinds on purpose — `pickNotable(facts, 0.5)` is
 * the default notability bar for "is this worth a sentence".
 */
import { formatDateRange } from "@/lib/format";
import type { Fact, FactBaseline, FactPeriod, FactUnit } from "./types";

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export interface SeriesPoint {
  /** KST date key (or any ordered key the host also uses for evidence). */
  key: string;
  value: number;
}

interface FactBase {
  id: string;
  metric: string;
  metricLabel: string;
  period: FactPeriod;
  unit: FactUnit;
  unitLabel?: string;
}

// ── delta ────────────────────────────────────────────────────────────────────

export interface DeltaInput extends FactBase {
  current: number;
  previous: number | null | undefined;
  /** "9월", "평소", "목표" … */
  baselineLabel: string;
  baselineKind?: FactBaseline["kind"];
  /** Relative change that scores 1.0. Default 0.5 (±50%). */
  saturateAt?: number;
  /** Words for the default template. Default "많아요" / "적어요". */
  upWord?: string;
  downWord?: string;
}

/** Current vs previous/usual/target. `detail.ratio` is the signed relative change. */
export function deltaVsPrevious(input: DeltaInput): Fact | null {
  const { current, previous } = input;
  if (previous == null || !Number.isFinite(previous) || previous <= 0) return null;
  if (!Number.isFinite(current)) return null;
  const ratio = (current - previous) / previous;
  return {
    id: input.id,
    kind: "delta",
    metric: input.metric,
    metricLabel: input.metricLabel,
    period: input.period,
    unit: input.unit,
    unitLabel: input.unitLabel,
    value: current,
    baseline: {
      value: previous,
      label: input.baselineLabel,
      kind: input.baselineKind ?? "previous",
    },
    score: clamp01(Math.abs(ratio) / (input.saturateAt ?? 0.5)),
    detail: {
      ratio,
      direction: ratio >= 0 ? "up" : "down",
      upWord: input.upWord ?? "많아요",
      downWord: input.downWord ?? "적어요",
    },
  };
}

// ── concentration ────────────────────────────────────────────────────────────

export interface ConcentrationInput extends FactBase {
  series: SeriesPoint[];
  /** Window length in points (e.g. 5 days). Must be smaller than the series. */
  windowSize: number;
  /** Optional reference date for omitting the year in the window label. */
  now?: Date;
}

/**
 * Finds the contiguous window holding the largest share of the total. The value
 * is that share (0..1); the score is `1 − expected/share`, i.e. how much of the
 * share exceeds what an even spread would give (5 of 31 days → expected 16%;
 * a 42% window scores 0.62, an even series scores 0).
 */
export function concentration(input: ConcentrationInput): Fact | null {
  const { series, windowSize } = input;
  const n = series.length;
  if (windowSize < 1 || n <= windowSize) return null;
  const total = series.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  if (total <= 0) return null;

  let windowSum = 0;
  for (let i = 0; i < windowSize; i++) windowSum += Math.max(0, series[i].value);
  let best = windowSum;
  let bestStart = 0;
  for (let i = windowSize; i < n; i++) {
    windowSum += Math.max(0, series[i].value) - Math.max(0, series[i - windowSize].value);
    if (windowSum > best) {
      best = windowSum;
      bestStart = i - windowSize + 1;
    }
  }
  const share = best / total;
  const expected = windowSize / n;
  const from = series[bestStart].key;
  const to = series[bestStart + windowSize - 1].key;
  return {
    id: input.id,
    kind: "concentration",
    metric: input.metric,
    metricLabel: input.metricLabel,
    period: input.period,
    unit: "percent",
    value: share,
    baseline: { value: total, label: `${input.period.label} 합`, kind: "total" },
    score: clamp01(1 - expected / share),
    evidence: { kind: "range", from, to },
    detail: {
      partValue: best,
      partUnit: input.unit,
      partUnitLabel: input.unitLabel ?? "",
      windowFrom: from,
      windowTo: to,
      windowLabel: isDateKey(from)
        ? formatDateRange(from, to, { now: input.now })
        : `${from}–${to}`,
      windowSize,
    },
  };
}

// ── record high / low ────────────────────────────────────────────────────────

export interface RecordInput extends FactBase {
  series: SeriesPoint[];
  direction: "high" | "low";
  /** Key of the point being tested. Default: the last point. */
  targetKey?: string;
  /** Scope words for the sentence: "최근 12개월", "30일". */
  scopeLabel: string;
  /** Minimum series length for a record to mean anything. Default 4. */
  minHistory?: number;
  /** Margin over the runner-up that scores 1.0. Default 0.25 (25%). */
  saturateAt?: number;
}

/** Whether the target point is the highest (or lowest) in the series, and by how much. */
export function recordLowHigh(input: RecordInput): Fact | null {
  const { series, direction } = input;
  if (series.length < (input.minHistory ?? 4)) return null;
  const target = input.targetKey
    ? series.find((p) => p.key === input.targetKey)
    : series[series.length - 1];
  if (!target) return null;
  const others = series.filter((p) => p !== target).map((p) => p.value);
  const runnerUp = direction === "high" ? Math.max(...others) : Math.min(...others);
  const isRecord = direction === "high" ? target.value > runnerUp : target.value < runnerUp;
  if (!isRecord) return null;
  const margin =
    direction === "high"
      ? runnerUp > 0
        ? (target.value - runnerUp) / runnerUp
        : 1
      : target.value > 0
        ? (runnerUp - target.value) / runnerUp
        : 1;
  return {
    id: input.id,
    kind: "record",
    metric: input.metric,
    metricLabel: input.metricLabel,
    period: input.period,
    unit: input.unit,
    unitLabel: input.unitLabel,
    value: target.value,
    baseline: {
      value: runnerUp,
      label: direction === "high" ? "그다음 최고" : "그다음 최저",
      kind: "second",
    },
    score: clamp01(0.5 + 0.5 * clamp01(margin / (input.saturateAt ?? 0.25))),
    evidence: { kind: "keys", keys: [target.key] },
    detail: { direction, scopeLabel: input.scopeLabel, targetKey: target.key },
  };
}

// ── one-off ──────────────────────────────────────────────────────────────────

export interface OneOffItem {
  key: string;
  value: number;
  label?: string;
}

export interface OneOffInput extends FactBase {
  items: OneOffItem[];
  /** Total the share is measured against. Default: sum of items. */
  total?: number;
}

/**
 * The largest single item and its share of the total. Scores high when one item
 * dominates *and* stands far above the next one (a 1,800,000원 charge in a month
 * whose next-largest is 85,000원).
 */
export function oneOff(input: OneOffInput): Fact | null {
  const items = input.items.filter((i) => Number.isFinite(i.value) && i.value > 0);
  if (items.length < 2) return null;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const [top, second] = sorted;
  const total = input.total ?? items.reduce((sum, i) => sum + i.value, 0);
  if (total <= 0) return null;
  const share = top.value / total;
  return {
    id: input.id,
    kind: "one_off",
    metric: input.metric,
    metricLabel: input.metricLabel,
    period: input.period,
    unit: "percent",
    value: share,
    baseline: { value: total, label: `${input.period.label} ${input.metricLabel}`, kind: "total" },
    score: clamp01(share * (1 - second.value / top.value) * 1.25),
    evidence: { kind: "keys", keys: [top.key] },
    detail: {
      itemKey: top.key,
      itemLabel: top.label ?? top.key,
      itemValue: top.value,
      secondValue: second.value,
      itemUnit: input.unit,
      itemUnitLabel: input.unitLabel ?? "",
    },
  };
}

// ── streak ───────────────────────────────────────────────────────────────────

export interface StreakInput extends Omit<FactBase, "unit" | "unitLabel"> {
  /** Ordered days; `active` = the activity happened that day. */
  days: { key: string; active: boolean }[];
  /** Shortest run worth a sentence. Default 3. */
  minLength?: number;
  /** Run length that scores 1.0. Default 14. */
  saturateAt?: number;
}

/** The run of active days ending at the last day. Being the longest run in the series adds 0.25. */
export function streak(input: StreakInput): Fact | null {
  const { days } = input;
  if (days.length === 0) return null;
  let length = 0;
  for (let i = days.length - 1; i >= 0 && days[i].active; i--) length++;
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d.active ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const minLength = input.minLength ?? 3;
  const base = length < minLength ? 0 : clamp01(length / (input.saturateAt ?? 14));
  const isBest = length >= minLength && length === best;
  return {
    id: input.id,
    kind: "streak",
    metric: input.metric,
    metricLabel: input.metricLabel,
    period: input.period,
    unit: "days",
    value: length,
    baseline: { value: best, label: "가장 긴 연속", kind: "max" },
    score: length < minLength ? 0 : clamp01(base + (isBest ? 0.25 : 0)),
    evidence:
      length > 0
        ? { kind: "range", from: days[days.length - length].key, to: days[days.length - 1].key }
        : undefined,
    detail: { length, best },
  };
}

// ── diagnosis ────────────────────────────────────────────────────────────────

export interface DiagnosisInput {
  id: string;
  /** Source id (e.g. "wakatime") and its label. */
  metric: string;
  metricLabel: string;
  period: FactPeriod;
  /** The cited number (rendered as the trigger). */
  value: number;
  unit: FactUnit;
  unitLabel?: string;
  /** Sentence with exactly one `{fact}` placeholder. */
  template: string;
  rows?: Fact["rows"];
  detail?: Fact["detail"];
  score?: number;
}

/** Status explanations are always notable when present (score 1 by default). */
export function diagnosis(input: DiagnosisInput): Fact {
  return {
    id: input.id,
    kind: "diagnosis",
    metric: input.metric,
    metricLabel: input.metricLabel,
    period: input.period,
    value: input.value,
    unit: input.unit,
    unitLabel: input.unitLabel,
    score: input.score ?? 1,
    template: input.template,
    rows: input.rows,
    detail: input.detail,
  };
}

function isDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}
