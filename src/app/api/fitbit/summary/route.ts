import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, healthConnections, healthDailySummaries, healthSamples } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { bucketStats } from "@/modules/health/compaction";
import { CURATED_METRIC_KEYS, CURATED_METRICS } from "@/modules/health/metrics-meta";
import { EXERCISE_METRIC, SLEEP_METRIC } from "@/modules/health/service";
import { dedupeSessions } from "@/modules/health/sessions";
import { isNap, stageBreakdown, stageSegments } from "@/modules/health/sleep";
import type { HealthDayPoint, HealthSleepSession, HealthWorkout } from "@/modules/health/types";

const TREND_WINDOW_DAYS = 30;
/** How many recent nights the sleep list shows. */
const SLEEP_SESSION_LIMIT = 10;
/**
 * Rows fetched before dedup. One night is stored once per writing source, so
 * fetching exactly SLEEP_SESSION_LIMIT rows would yield fewer distinct nights (with
 * two sources live it returned 7). Over-fetching absorbs that; the dedup, not this
 * number, decides what the page shows.
 */
const SLEEP_ROW_FETCH_LIMIT = SLEEP_SESSION_LIMIT * 4;

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

  // ── Fallback: metrics present only as raw samples ───────────────────────────
  // The on-device import endpoint writes health_samples WITHOUT recomputing daily
  // summaries, so a metric sourced only from an import (or one whose cloud backfill
  // hasn't reached these days yet) would render empty. Aggregate its samples live
  // for exactly those metrics — one extra query, and only when something is missing.
  const uncovered = metrics.filter((m) => m.points.length === 0).map((m) => m.key);
  if (uncovered.length > 0) {
    const cutoff = new Date(Date.now() - (TREND_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    const sampleRows = await db
      .select({
        metric: healthSamples.metric,
        sampleAt: healthSamples.sampleAt,
        value: healthSamples.value,
        valueJson: healthSamples.valueJson,
      })
      .from(healthSamples)
      .where(
        and(
          eq(healthSamples.userId, user.id),
          inArray(healthSamples.metric, uncovered),
          gte(healthSamples.sampleAt, cutoff)
        )
      );
    const acc = new Map<
      string,
      Map<string, { sum: number; n: number; min: number; max: number }>
    >();
    for (const r of sampleRows) {
      if (r.value == null) continue;
      // A row is either a raw sample or a compacted minute bucket carrying
      // { min, max, n } (modules/health/compaction.ts). Weighting by n keeps the mean
      // equal to the mean over raw samples, and reading the stored bounds keeps the
      // day's range bar honest — bucket means alone would narrow it.
      const b = bucketStats(r.valueJson, r.value);
      const days = acc.get(r.metric) ?? new Map();
      const day = kstDay(r.sampleAt);
      const cur = days.get(day) ?? { sum: 0, n: 0, min: b.min, max: b.max };
      cur.sum += r.value * b.n;
      cur.n += b.n;
      cur.min = Math.min(cur.min, b.min);
      cur.max = Math.max(cur.max, b.max);
      days.set(day, cur);
      acc.set(r.metric, days);
    }
    for (const m of metrics) {
      const days = acc.get(m.key);
      if (!days) continue;
      m.points = [...days.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([day, v]) => ({
          day,
          avg: v.sum / v.n,
          min: v.min,
          max: v.max,
          sum: m.agg === "sum" ? v.sum : null,
          count: v.n,
        }));
    }
  }

  // ── Exercise: structured workouts, computed live from health_samples ────────
  // (not in health_daily_summaries — synced unfiltered, deduped here per workout).
  const exCutoff = new Date(Date.now() - (TREND_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
  const exRows = await db
    .select({
      sampleAt: healthSamples.sampleAt,
      source: healthSamples.source,
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

  // One workout lands as several rows (several writing apps, and one of them
  // republishing the same start a few hundred ms apart) — dedup before ANY total is
  // computed, or a single workout is counted twice. See modules/health/sessions.ts.
  const dedupedWorkouts = dedupeSessions(
    exRows.map((r) => ({
      sampleAt: r.sampleAt,
      source: r.source,
      minutes: r.value ?? 0,
      wrapper: (r.valueJson as Record<string, unknown>) ?? {},
    }))
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

  // ── Sleep: one session per night, so a list of the most recent nights rather
  // than a 30-day trend. Two payload shapes coexist (cloud sync vs on-device
  // import) — modules/health/sleep.ts normalizes both. ────────────────────────
  const sleepRows = await db
    .select({
      sampleAt: healthSamples.sampleAt,
      source: healthSamples.source,
      minutes: healthSamples.value,
      valueJson: healthSamples.valueJson,
    })
    .from(healthSamples)
    .where(and(eq(healthSamples.userId, user.id), eq(healthSamples.metric, SLEEP_METRIC)))
    .orderBy(desc(healthSamples.sampleAt))
    .limit(SLEEP_ROW_FETCH_LIMIT);
  // A night is stored once per writing source, so dedup by session — otherwise the
  // same night renders twice at different stage granularity and eats a list slot.
  const sleepSessions: HealthSleepSession[] = dedupeSessions(
    sleepRows.map((r) => ({
      sampleAt: r.sampleAt,
      source: r.source,
      minutes: r.minutes ?? 0,
      valueJson: r.valueJson,
    }))
  )
    .slice(0, SLEEP_SESSION_LIMIT)
    .map((r) => ({
      start: r.sampleAt.toISOString(),
      minutes: Math.round(r.minutes),
      stages: stageBreakdown(r.valueJson),
      segments: stageSegments(r.valueJson),
      nap: isNap(r.valueJson),
    }));

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
