import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, healthConnections, healthDailySummaries, healthSamples } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { CURATED_METRIC_KEYS, CURATED_METRICS } from "@/modules/health/metrics-meta";
import { EXERCISE_METRIC } from "@/modules/health/service";
import type {
  HealthDayPoint,
  HealthSleepSession,
  HealthWorkout,
  SleepStageKey,
  SleepStageSegment,
} from "@/modules/health/types";

const TREND_WINDOW_DAYS = 30;

const KST_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** KST calendar day ('YYYY-MM-DD') of a UTC instant — the summary day key space. */
function kstDay(d: Date): string {
  return KST_DAY_FMT.format(d);
}
/** 'YYYY-MM-DD' for `days` ago in KST. */
function kstDayNDaysAgo(days: number): string {
  return kstDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

/**
 * Sum a sleep record's `stages` array into minutes per depth. HC stage codes:
 * 1/7 = awake, 2/4 = light, 5 = deep, 6 = rem. Returns null when a session has no
 * stage detail (some records only carry a total). Stage times are epoch millis.
 */
function stageBreakdown(
  valueJson: unknown
): { deep: number; light: number; rem: number; awake: number } | null {
  const stages = (
    valueJson as {
      stages?: Array<{ startTime?: number | string; endTime?: number | string; stage?: unknown }>;
    }
  )?.stages;
  if (!Array.isArray(stages) || stages.length === 0) return null;
  const acc = { deep: 0, light: 0, rem: 0, awake: 0 };
  for (const s of stages) {
    const st = Number(s.startTime);
    const en = Number(s.endTime);
    if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st) continue;
    const min = (en - st) / 60000;
    const code = String(s.stage);
    if (code === "5") acc.deep += min;
    else if (code === "6") acc.rem += min;
    else if (code === "4" || code === "2") acc.light += min;
    else if (code === "1" || code === "7") acc.awake += min;
  }
  return acc;
}

/** HC stage code → depth key (same mapping as stageBreakdown); unknown → null. */
const STAGE_KEY: Record<string, SleepStageKey> = {
  "5": "deep",
  "6": "rem",
  "4": "light",
  "2": "light",
  "1": "awake",
  "7": "awake",
};

/**
 * Ordered stage spans relative to the record's own start, for a hypnogram. Offsets
 * are minutes from `startTime`; returns null when the record carries no stages.
 */
function stageSegments(valueJson: unknown): SleepStageSegment[] | null {
  const wrapper = valueJson as {
    startTime?: number | string;
    stages?: Array<{ startTime?: number | string; endTime?: number | string; stage?: unknown }>;
  } | null;
  const stages = wrapper?.stages;
  if (!Array.isArray(stages) || stages.length === 0) return null;
  const base = Number(wrapper?.startTime ?? stages[0]?.startTime);
  if (!Number.isFinite(base)) return null;
  const out: SleepStageSegment[] = [];
  for (const s of stages) {
    const st = Number(s.startTime);
    const en = Number(s.endTime);
    if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st) continue;
    const stage = STAGE_KEY[String(s.stage)];
    if (!stage) continue;
    out.push({ stage, startMin: (st - base) / 60000, endMin: (en - base) / 60000 });
  }
  return out.length > 0 ? out : null;
}

/**
 * Curated daily health trends + recent workouts + connection meta in one call, so
 * the page picks its state without extra requests. Summaries are returned even with
 * no connection so retained history (R1) still renders after a disconnect.
 */
export const GET = withAuth(async ({ user }) => {
  const db = getDb();

  const conn =
    (
      await db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.userId, user.id))
        .limit(1)
    )[0] ?? null;

  // ── Scalar metrics: from the precomputed KST daily summaries ────────────────
  const rows = await db
    .select()
    .from(healthDailySummaries)
    .where(
      and(
        eq(healthDailySummaries.userId, user.id),
        inArray(healthDailySummaries.metric, CURATED_METRIC_KEYS),
        gte(healthDailySummaries.day, kstDayNDaysAgo(TREND_WINDOW_DAYS))
      )
    )
    .orderBy(asc(healthDailySummaries.day));

  const byMetric = new Map<string, HealthDayPoint[]>();
  for (const r of rows) {
    const list = byMetric.get(r.metric) ?? [];
    list.push({
      day: r.day,
      avg: r.valueAvg,
      min: r.valueMin,
      max: r.valueMax,
      sum: r.valueSum,
      count: r.count,
    });
    byMetric.set(r.metric, list);
  }

  const metrics = CURATED_METRICS.map((m) => ({
    key: m.key,
    label: m.label,
    unit: m.unit,
    agg: m.agg,
    scale: m.scale ?? null,
    decimals: m.decimals ?? 0,
    points: byMetric.get(m.key) ?? [],
  }));

  // ── Exercise: structured workouts, computed live from health_samples ────────
  // (not in health_daily_summaries — synced unfiltered, deduped here per workout).
  const exCutoff = new Date(Date.now() - (TREND_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
  const exRows = await db
    .select({
      sampleAt: healthSamples.sampleAt,
      value: healthSamples.value,
      valueJson: healthSamples.valueJson,
    })
    .from(healthSamples)
    .where(
      and(
        eq(healthSamples.userId, user.id),
        eq(healthSamples.metric, EXERCISE_METRIC),
        gte(healthSamples.sampleAt, exCutoff)
      )
    )
    .orderBy(desc(healthSamples.sampleAt));

  // Same workout from two sources (Samsung + Google Fit) → dedup by exact start,
  // keeping the longer-duration copy, so daily totals aren't double-counted.
  const byStart = new Map<
    string,
    { sampleAt: Date; minutes: number; wrapper: Record<string, unknown> }
  >();
  for (const r of exRows) {
    const key = r.sampleAt.toISOString();
    const minutes = r.value ?? 0;
    const existing = byStart.get(key);
    if (!existing || minutes > existing.minutes) {
      byStart.set(key, {
        sampleAt: r.sampleAt,
        minutes,
        wrapper: (r.valueJson as Record<string, unknown>) ?? {},
      });
    }
  }
  const dedupedWorkouts = [...byStart.values()].sort(
    (a, b) => b.sampleAt.getTime() - a.sampleAt.getTime()
  );

  const dayTotals = new Map<string, number>();
  for (const w of dedupedWorkouts) {
    const day = kstDay(w.sampleAt);
    dayTotals.set(day, (dayTotals.get(day) ?? 0) + w.minutes);
  }
  const exercisePoints: HealthDayPoint[] = [...dayTotals.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, sum]) => ({ day, avg: null, min: null, max: null, sum, count: null }));

  if (exercisePoints.length > 0) {
    metrics.push({
      key: EXERCISE_METRIC,
      label: "운동 시간",
      unit: "분",
      agg: "sum",
      scale: null,
      decimals: 0,
      points: exercisePoints,
    });
  }

  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const workouts: HealthWorkout[] = dedupedWorkouts.slice(0, 8).map((w) => ({
    start: w.sampleAt.toISOString(),
    minutes: Math.round(w.minutes),
    name: str(w.wrapper.displayName),
    type: str(w.wrapper.exerciseType),
  }));

  // ── Sleep: sparse + historical (latest may be months old), so a list of the
  // most recent sessions rather than a 30-day trend that would render empty. ───
  const sleepRows = await db
    .select({
      sampleAt: healthSamples.sampleAt,
      minutes: healthSamples.value,
      valueJson: healthSamples.valueJson,
    })
    .from(healthSamples)
    .where(and(eq(healthSamples.userId, user.id), eq(healthSamples.metric, "sleep")))
    .orderBy(desc(healthSamples.sampleAt))
    .limit(10);
  const sleepSessions: HealthSleepSession[] = sleepRows.map((r) => ({
    start: r.sampleAt.toISOString(),
    minutes: Math.round(r.minutes ?? 0),
    stages: stageBreakdown(r.valueJson),
    segments: stageSegments(r.valueJson),
  }));

  // ── Resting heart rate: live daily avg from imported samples (not a curated
  // metric — it only exists via the on-device import). ────────────────────────
  const rhrCutoff = new Date(Date.now() - (TREND_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
  const rhrRows = await db
    .select({ sampleAt: healthSamples.sampleAt, value: healthSamples.value })
    .from(healthSamples)
    .where(
      and(
        eq(healthSamples.userId, user.id),
        eq(healthSamples.metric, "resting_heart_rate"),
        gte(healthSamples.sampleAt, rhrCutoff)
      )
    );
  const rhrByDay = new Map<string, { sum: number; n: number; min: number; max: number }>();
  for (const r of rhrRows) {
    if (r.value == null) continue;
    const day = kstDay(r.sampleAt);
    const cur = rhrByDay.get(day) ?? { sum: 0, n: 0, min: r.value, max: r.value };
    cur.sum += r.value;
    cur.n++;
    cur.min = Math.min(cur.min, r.value);
    cur.max = Math.max(cur.max, r.value);
    rhrByDay.set(day, cur);
  }
  const rhrPoints: HealthDayPoint[] = [...rhrByDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, v]) => ({ day, avg: v.sum / v.n, min: v.min, max: v.max, sum: null, count: v.n }));
  if (rhrPoints.length > 0) {
    metrics.push({
      key: "resting_heart_rate",
      label: "안정시 심박",
      unit: "bpm",
      agg: "avg",
      scale: null,
      decimals: 0,
      points: rhrPoints,
    });
  }

  return NextResponse.json({
    hasConnection: !!conn,
    status: conn?.status ?? null,
    backfillCompletedAt: conn?.backfillCompletedAt?.toISOString() ?? null,
    lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
    hasAnyHistory: metrics.some((m) => m.points.length > 0) || sleepSessions.length > 0,
    metrics,
    workouts,
    sleepSessions,
  });
});
