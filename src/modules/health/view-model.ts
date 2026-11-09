// Pure view-model for the redesigned /health page. Everything the page shows is
// derived here from the existing API payloads (/api/fitbit/summary, the body
// insight section and the activity correlation) so the components stay thin and
// the numbers are unit-tested. Day keys are KST calendar days ('YYYY-MM-DD').

import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { formatDurationMinutes, formatMonthDay, MINUS } from "@/lib/format";
import type {
  HealthMetricSeries,
  HealthSleepSession,
  HealthWorkout,
  SleepStageKey,
  SleepStageSegment,
  SleepStages,
} from "./types";

// ── small numeric helpers ────────────────────────────────────────────────────

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Pearson correlation, or null when either side has no variance / < 3 points. */
export function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = (mean(a.slice(0, n)) ?? 0) as number;
  const mb = (mean(b.slice(0, n)) ?? 0) as number;
  let sab = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  if (sa === 0 || sb === 0) return null;
  return sab / Math.sqrt(sa * sb);
}

const decFmt = (decimals: number) =>
  new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** `4,969` / `3.6` / `−1.8` — grouped, fixed decimals, true minus sign. */
export function fmtNum(value: number, decimals = 0): string {
  const text = decFmt(decimals).format(Math.abs(value));
  return value < 0 && Number(text.replace(/,/g, "")) !== 0 ? `${MINUS}${text}` : text;
}

export function kstToday(now: Date = new Date()): string {
  return toKstCalendarDate(now);
}

/** Inclusive list of day keys from `from` to `to`. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDateKey(d, 1)) out.push(d);
  return out;
}

// ── sleep ────────────────────────────────────────────────────────────────────

export interface Night {
  /** start ISO — stable id */
  id: string;
  start: Date;
  end: Date;
  /** KST day the night ended on (the strip labels nights by it) */
  wakeDay: string;
  /** in-bed minutes (session length) */
  inBed: number;
  /** asleep minutes (in bed − awake) */
  asleep: number;
  stages: SleepStages;
  segments: SleepStageSegment[];
}

export const NIGHT_LIMIT = 10;

/** Main-sleep sessions with stage detail, newest first (naps dropped). */
export function buildNights(sessions: readonly HealthSleepSession[]): Night[] {
  return sessions
    .filter((s) => !s.nap && s.stages && s.segments && s.segments.length > 0 && s.minutes > 0)
    .slice(0, NIGHT_LIMIT)
    .map((s) => {
      const start = new Date(s.start);
      const end = new Date(start.getTime() + s.minutes * 60_000);
      const stages = s.stages as SleepStages;
      return {
        id: s.start,
        start,
        end,
        wakeDay: toKstCalendarDate(end),
        inBed: s.minutes,
        asleep: Math.max(0, s.minutes - stages.awake),
        stages,
        segments: s.segments as SleepStageSegment[],
      };
    });
}

export interface SleepComparison {
  /** "최근 10밤 중 가장 짧음" */
  rank: string;
  /** "중앙값 5시간 54분보다 55분 짧음" */
  diff: string;
  medianAsleep: number;
  efficiency: number;
}

export function sleepComparison(nights: readonly Night[], index: number): SleepComparison | null {
  const night = nights[index];
  if (!night) return null;
  const all = nights.map((n) => n.asleep);
  const med = Math.round(median(all) ?? night.asleep);
  const n = nights.length;
  const shorter = all.filter((v) => v < night.asleep).length;
  const longer = all.filter((v) => v > night.asleep).length;
  let rank: string;
  if (n < 3) rank = `최근 ${n}밤 기록`;
  else if (shorter === 0) rank = `최근 ${n}밤 중 가장 짧음`;
  else if (longer === 0) rank = `최근 ${n}밤 중 가장 긺`;
  else if (shorter < longer) rank = `최근 ${n}밤 중 ${shorter + 1}번째로 짧음`;
  else rank = `최근 ${n}밤 중 ${longer + 1}번째로 긺`;
  const d = night.asleep - med;
  const diff =
    d < 0
      ? `중앙값 ${formatDurationMinutes(med)}보다 ${formatDurationMinutes(-d)} 짧음`
      : d > 0
        ? `중앙값 ${formatDurationMinutes(med)}보다 ${formatDurationMinutes(d)} 긺`
        : "중앙값과 같음";
  return {
    rank,
    diff,
    medianAsleep: med,
    efficiency: night.inBed > 0 ? Math.round((night.asleep / night.inBed) * 100) : 0,
  };
}

/** Lane order of the hypnogram, top → bottom. */
export const STAGE_LANES: SleepStageKey[] = ["awake", "rem", "light", "deep"];
export const STAGE_LABEL: Record<SleepStageKey, string> = {
  deep: "깊은잠",
  rem: "렘",
  light: "얕은잠",
  awake: "각성",
};

/** Full-hour ticks inside a night, skipping ones too close to either edge. */
export function nightTicks(night: Night): { pct: number; label: string }[] {
  const startMs = night.start.getTime();
  const out: { pct: number; label: string }[] = [];
  const firstHour = Math.ceil(startMs / 3_600_000) * 3_600_000;
  for (let t = firstHour; t < night.end.getTime(); t += 3_600_000) {
    const off = (t - startMs) / 60_000;
    if (off < 18 || night.inBed - off < 18) continue;
    const hh = new Date(t + 9 * 3_600_000).getUTCHours();
    out.push({ pct: (off / night.inBed) * 100, label: `${String(hh).padStart(2, "0")}:00` });
  }
  return out;
}

// ── resting heart rate ───────────────────────────────────────────────────────

export interface RhrView {
  days: string[];
  values: (number | null)[];
  latest: number;
  latestDay: string;
  min: number;
  max: number;
  median: number;
  recorded: number;
  /** "30일 중 최저" / "30일 중 최고" / "" */
  cmp: string;
  /** "중앙값 63보다 4 낮음" */
  diff: string;
  /** non-increasing run ending at the latest value (index into days) */
  runStart: number;
  runFrom: number;
  runDays: number;
}

/** Daily average of a metric, aligned to `days` (null where missing). */
export function alignDaily(
  series: HealthMetricSeries | undefined,
  days: readonly string[],
  pick: "avg" | "sum" = "avg"
): (number | null)[] {
  const by = new Map<string, number>();
  for (const p of series?.points ?? []) {
    const v = pick === "sum" ? p.sum : p.avg;
    if (v != null && Number.isFinite(v)) by.set(p.day, v * (series?.scale ?? 1));
  }
  return days.map((d) => by.get(d) ?? null);
}

export function rhrView(
  series: HealthMetricSeries | undefined,
  days: readonly string[]
): RhrView | null {
  const values = alignDaily(series, days).map((v) => (v == null ? null : Math.round(v)));
  const present = values.flatMap((v, i) => (v == null ? [] : [{ i, v }]));
  if (present.length === 0) return null;
  const last = present[present.length - 1];
  const vals = present.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const med = Math.round(median(vals) ?? last.v);
  let runStart = last.i;
  let prev = last.v;
  for (let k = present.length - 2; k >= 0; k--) {
    if (present[k].v >= prev) {
      runStart = present[k].i;
      prev = present[k].v;
    } else break;
  }
  const runFrom = values[runStart] ?? last.v;
  const d = last.v - med;
  return {
    days: [...days],
    values,
    latest: last.v,
    latestDay: days[last.i],
    min,
    max,
    median: med,
    recorded: present.length,
    cmp:
      present.length >= 5 && last.v === min && min !== max
        ? `${days.length - 1}일 중 최저`
        : present.length >= 5 && last.v === max && min !== max
          ? `${days.length - 1}일 중 최고`
          : "",
    diff:
      d === 0
        ? `중앙값 ${med}과 같음`
        : `중앙값 ${med}보다 ${Math.abs(d)} ${d < 0 ? "낮음" : "높음"}`,
    runStart,
    runFrom,
    runDays: last.i - runStart,
  };
}

// ── weight ───────────────────────────────────────────────────────────────────

export interface WeightPoint {
  date: string;
  weight: number;
}

export interface WeightView {
  points: WeightPoint[];
  latest: WeightPoint;
  peak: WeightPoint;
  low: WeightPoint;
  /** latest − peak (≤ 0) */
  fromPeak: number;
  /** domain of the plot */
  lo: number;
  hi: number;
}

export const WEIGHT_WINDOW_DAYS = 120;

export function weightView(
  series: readonly WeightPoint[] | null | undefined,
  today: string
): WeightView | null {
  const from = shiftDateKey(today, -WEIGHT_WINDOW_DAYS);
  const points = (series ?? []).filter((p) => p.date >= from && p.date <= today);
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  const peak = points.reduce((a, b) => (b.weight > a.weight ? b : a));
  const low = points.reduce((a, b) => (b.weight < a.weight ? b : a));
  const pad = Math.max(0.5, (peak.weight - low.weight) * 0.12);
  return {
    points,
    latest,
    peak,
    low,
    fromPeak: latest.weight - peak.weight,
    lo: low.weight - pad,
    hi: peak.weight + pad,
  };
}

// ── 30-day activity ─────────────────────────────────────────────────────────

export interface ActivityMetricDef {
  key: string;
  label: string;
  unit: string;
  decimals: number;
}

export const ACTIVITY_METRICS: ActivityMetricDef[] = [
  { key: "steps", label: "걸음", unit: "걸음", decimals: 0 },
  { key: "exercise", label: "운동 시간", unit: "분", decimals: 0 },
  { key: "active_energy", label: "활동 칼로리", unit: "kcal", decimals: 0 },
  { key: "distance", label: "이동 거리", unit: "km", decimals: 1 },
  { key: "active_zone_minutes", label: "활동 존 시간", unit: "분", decimals: 0 },
];

/** Space between number and unit for Latin units only (`352 kcal`, `4,969걸음`). */
export function withUnit(text: string, unit: string): string {
  return /^[A-Za-z°]/.test(unit) ? `${text} ${unit}` : `${text}${unit}`;
}

export interface ActivityWindow {
  days: string[];
  /** the still-accumulating day (today, or the day sync last ran) */
  partialDay: string;
  /** the most recent full day */
  fullDay: string;
}

/**
 * The 30-day window ends today. The day the last sync ran on is still partial
 * (anything after it hasn't been collected), so the "latest" value is the day
 * before it — normally yesterday.
 */
export function activityWindow(
  today: string,
  lastSyncedAt: string | null,
  span = 30
): ActivityWindow {
  const syncDay = lastSyncedAt ? toKstCalendarDate(new Date(lastSyncedAt)) : today;
  const partialDay = syncDay < today ? syncDay : today;
  return {
    days: dayRange(shiftDateKey(today, -span), today),
    partialDay,
    fullDay: shiftDateKey(partialDay, -1),
  };
}

export interface ActivityMetricView extends ActivityMetricDef {
  values: (number | null)[];
  /** value of the latest full day */
  latest: number | null;
  /** median over full days that have data */
  median: number | null;
}

export function activityMetric(
  def: ActivityMetricDef,
  series: HealthMetricSeries | undefined,
  win: ActivityWindow
): ActivityMetricView {
  const values = alignDaily(series, win.days, "sum").map((v) =>
    v == null ? null : def.decimals === 0 ? Math.round(v) : v
  );
  const full = values.filter((v, i): v is number => v != null && win.days[i] < win.partialDay);
  const fi = win.days.indexOf(win.fullDay);
  return {
    ...def,
    values,
    latest: fi >= 0 ? values[fi] : null,
    median: median(full),
  };
}

// ── workouts ────────────────────────────────────────────────────────────────

export type WorkoutIcon = "bike" | "walk" | "lift" | "run" | "swim" | "act";

export function workoutIcon(type: string | null): WorkoutIcon {
  const t = (type ?? "").toUpperCase();
  if (t.includes("BIK") || t.includes("CYCL")) return "bike";
  if (t.includes("STRENGTH") || t.includes("WEIGHT")) return "lift";
  if (t.includes("RUN")) return "run";
  if (t.includes("SWIM")) return "swim";
  if (t.includes("WALK") || t.includes("HIK")) return "walk";
  return "act";
}

export interface WorkoutGroup {
  name: string;
  count: number;
  minutes: number;
  share: number;
}

export function workoutName(w: HealthWorkout): string {
  return w.name ?? "운동";
}

export function groupWorkouts(workouts: readonly HealthWorkout[]): WorkoutGroup[] {
  const total = workouts.reduce((a, w) => a + w.minutes, 0);
  const by = new Map<string, WorkoutGroup>();
  for (const w of workouts) {
    const name = workoutName(w);
    const g = by.get(name) ?? { name, count: 0, minutes: 0, share: 0 };
    g.count += 1;
    g.minutes += w.minutes;
    by.set(name, g);
  }
  return [...by.values()]
    .map((g) => ({ ...g, share: total > 0 ? g.minutes / total : 0 }))
    .sort((a, b) => b.minutes - a.minutes || b.count - a.count);
}

// ── details sheet ───────────────────────────────────────────────────────────

export interface DetailRow {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  note?: string;
  values: (number | null)[];
  latest: number;
  latestDay: string;
  median: number;
  min: number;
  max: number;
}

const DETAIL_METRICS: {
  key: string;
  label: string;
  unit: string;
  decimals: number;
  note?: string;
}[] = [
  { key: "hrv", label: "심박 변이도", unit: "ms", decimals: 1 },
  { key: "spo2", label: "산소포화도", unit: "%", decimals: 1 },
  { key: "respiratory_rate", label: "호흡수", unit: "회/분", decimals: 1 },
  { key: "skin_temperature", label: "피부 온도", unit: "°C", decimals: 1 },
  { key: "vo2_max", label: "VO₂max", unit: "mL/kg·min", decimals: 1 },
  {
    key: "heart_rate",
    label: "평균 심박",
    unit: "bpm",
    decimals: 0,
    note: "운동 포함 전체 측정 평균",
  },
];

export function detailRows(
  metrics: readonly HealthMetricSeries[],
  days: readonly string[]
): DetailRow[] {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const rows: DetailRow[] = [];
  for (const def of DETAIL_METRICS) {
    const values = alignDaily(byKey.get(def.key), days);
    const present = values.flatMap((v, i) => (v == null ? [] : [{ i, v }]));
    if (present.length === 0) continue;
    const vals = present.map((p) => p.v);
    const last = present[present.length - 1];
    rows.push({
      ...def,
      values,
      latest: last.v,
      latestDay: days[last.i],
      median: median(vals) as number,
      min: Math.min(...vals),
      max: Math.max(...vals),
    });
  }
  return rows;
}

/** "11월 9일" (helper re-export so components share one formatter). */
export const md = (day: string) => formatMonthDay(day);
