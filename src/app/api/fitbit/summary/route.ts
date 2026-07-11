import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, healthConnections, healthDailySummaries, healthSamples } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { CURATED_METRIC_KEYS, CURATED_METRICS } from "@/modules/health/metrics-meta";
import { EXERCISE_METRIC } from "@/modules/health/service";
import type { HealthDayPoint, HealthWorkout } from "@/modules/health/types";

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

  return NextResponse.json({
    hasConnection: !!conn,
    status: conn?.status ?? null,
    backfillCompletedAt: conn?.backfillCompletedAt?.toISOString() ?? null,
    lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
    hasAnyHistory: metrics.some((m) => m.points.length > 0),
    metrics,
    workouts,
  });
});
