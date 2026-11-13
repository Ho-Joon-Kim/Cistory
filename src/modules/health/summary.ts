/**
 * Health summary behind GET /api/fitbit/summary (the /health page) and the MCP
 * health tools: curated daily trends, recent workouts, recent sleep sessions,
 * ECG/IRN results for granted scopes, and connection meta.
 *
 * Without a `period` it reproduces the page's rolling window exactly: daily
 * summaries from 30 KST days back, raw-sample fallbacks and workouts from the
 * last 31 days, the 8 newest workouts and the 10 newest nights (any age). With a
 * `period` every series is bounded to those KST days instead, and up to
 * `PERIOD_LIST_LIMIT` workouts / nights inside it are returned.
 *
 * `rhythm` is sensitive (ECG/IRN) and is always the latest results regardless
 * of `period`; callers that must not expose it drop it.
 */

import { and, asc, desc, eq, gte, inArray, lt, lte, type SQL } from "drizzle-orm";
import { type Database, getDb, healthConnections, healthDailySummaries, healthSamples } from "@/db";
import { hasHealthScope } from "@/lib/adapters/google-health/interface";
import { getKstDateWindow } from "@/lib/date-key";
import { bucketStats } from "./compaction";
import {
  CURATED_METRIC_KEYS,
  CURATED_METRICS,
  mergeDailySeries,
  metricSourceKeys,
} from "./metrics-meta";
import { ECG_METRIC, IRN_METRIC } from "./rhythm";
import { EXERCISE_METRIC, SLEEP_METRIC } from "./service";
import { dedupeSessions } from "./sessions";
import { isNap, stageBreakdown, stageSegments } from "./sleep";
import type { HealthDayPoint, HealthRhythm, HealthSleepSession, HealthWorkout } from "./types";

const TREND_WINDOW_DAYS = 30;
/** How many recent nights the sleep list shows. */
const SLEEP_SESSION_LIMIT = 10;
/**
 * Rows fetched per wanted night, before dedup. One night is stored once per writing
 * source, so fetching exactly SLEEP_SESSION_LIMIT rows would yield fewer distinct
 * nights (with two sources live it returned 7). Over-fetching absorbs that; the
 * dedup, not this number, decides what the page shows.
 */
const SLEEP_ROW_OVERFETCH = 4;

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

const RHYTHM_LIST_LIMIT = 10;

/**
 * Recent ECG / IRN results, only for granted optional scopes (null otherwise, so
 * the /health card stays hidden). Rows are deduped per measurement across
 * sources the same way sessions are. Device classifications are relayed as-is.
 */
async function readRhythm(
  db: Database,
  userId: string,
  scope: string | null
): Promise<HealthRhythm | null> {
  const grants = { ecg: hasHealthScope(scope, "ecg"), irn: hasHealthScope(scope, "irn") };
  if (!grants.ecg && !grants.irn) return null;
  const rows = await db
    .select({
      metric: healthSamples.metric,
      sampleAt: healthSamples.sampleAt,
      source: healthSamples.source,
      value: healthSamples.value,
      valueJson: healthSamples.valueJson,
    })
    .from(healthSamples)
    .where(
      and(eq(healthSamples.userId, userId), inArray(healthSamples.metric, [ECG_METRIC, IRN_METRIC]))
    )
    .orderBy(desc(healthSamples.sampleAt))
    .limit(RHYTHM_LIST_LIMIT * 8);
  const recent = (metric: string) =>
    dedupeSessions(
      rows.filter((r) => r.metric === metric).map((r) => ({ ...r, minutes: 0 }))
    ).slice(0, RHYTHM_LIST_LIMIT);
  const json = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  return {
    ecg: grants.ecg
      ? recent(ECG_METRIC).map((r) => ({
          start: r.sampleAt.toISOString(),
          classification:
            typeof json(r.valueJson).resultClassification === "string"
              ? (json(r.valueJson).resultClassification as string)
              : null,
          bpm: r.value,
        }))
      : null,
    irn: grants.irn
      ? recent(IRN_METRIC).map((r) => {
          const v = json(r.valueJson);
          const windows = Array.isArray(v.alertWindows) ? v.alertWindows.length : 0;
          return {
            start: r.sampleAt.toISOString(),
            end: typeof v.endTime === "string" ? v.endTime : null,
            positiveWindows: r.value ?? 0,
            windows,
          };
        })
      : null,
  };
}

/** Workouts / nights returned at most for an explicit period. */
export const PERIOD_LIST_LIMIT = 100;
const DEFAULT_WORKOUT_LIMIT = 8;

export interface HealthSummaryPeriod {
  /** First KST day, `YYYY-MM-DD` (inclusive). */
  from: string;
  /** Last KST day, `YYYY-MM-DD` (inclusive). */
  to: string;
}

export interface HealthSummaryMetric {
  key: string;
  label: string;
  unit: string;
  agg: string;
  scale: number | null;
  decimals: number;
  points: HealthDayPoint[];
}

export interface HealthSummary {
  rhythm: HealthRhythm | null;
  hasConnection: boolean;
  status: string | null;
  backfillCompletedAt: string | null;
  lastSyncedAt: string | null;
  hasAnyHistory: boolean;
  metrics: HealthSummaryMetric[];
  workouts: HealthWorkout[];
  sleepSessions: HealthSleepSession[];
  /**
   * Only with an explicit `period` (never on the /health page's response): how
   * many deduped workouts / nights the period holds before the
   * `PERIOD_LIST_LIMIT` cut, so a caller can tell a capped list from a complete one.
   */
  periodListTotals?: {
    workouts: { total: number; truncated: boolean };
    sleepSessions: { total: number; truncated: boolean };
  };
}

interface SummaryWindow {
  period: HealthSummaryPeriod | null;
  fromDay: string;
  toDay: string | null;
  sampleStart: Date;
  sampleEnd: Date | null;
  workoutLimit: number;
  sleepSessionLimit: number;
}

function summaryWindow(period: HealthSummaryPeriod | undefined): SummaryWindow {
  if (!period) {
    return {
      period: null,
      fromDay: kstDayNDaysAgo(TREND_WINDOW_DAYS),
      toDay: null,
      sampleStart: new Date(Date.now() - (TREND_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000),
      sampleEnd: null,
      workoutLimit: DEFAULT_WORKOUT_LIMIT,
      sleepSessionLimit: SLEEP_SESSION_LIMIT,
    };
  }
  const { start, end } = getKstDateWindow(period.from, period.to);
  return {
    period,
    fromDay: period.from,
    toDay: period.to,
    sampleStart: start,
    sampleEnd: end,
    workoutLimit: PERIOD_LIST_LIMIT,
    sleepSessionLimit: PERIOD_LIST_LIMIT,
  };
}

/**
 * Curated daily health trends + recent workouts + connection meta in one call, so
 * the page picks its state without extra requests. Summaries are returned even with
 * no connection so retained history (R1) still renders after a disconnect.
 */
export async function getHealthSummary(
  userId: string,
  options: { period?: HealthSummaryPeriod } = {},
  database: Database = getDb()
): Promise<HealthSummary> {
  const window = summaryWindow(options.period);
  const sampleRange: SQL[] = [
    gte(healthSamples.sampleAt, window.sampleStart),
    ...(window.sampleEnd ? [lt(healthSamples.sampleAt, window.sampleEnd)] : []),
  ];

  const conn =
    (
      await database
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.userId, userId))
        .limit(1)
    )[0] ?? null;

  // ── Scalar metrics: from the precomputed KST daily summaries ────────────────
  const rows = await database
    .select()
    .from(healthDailySummaries)
    .where(
      and(
        eq(healthDailySummaries.userId, userId),
        inArray(healthDailySummaries.metric, CURATED_METRIC_KEYS),
        gte(healthDailySummaries.day, window.fromDay),
        ...(window.toDay ? [lte(healthDailySummaries.day, window.toDay)] : [])
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

  // A card may merge several stored keys in preference order (VO₂max: Fitbit's
  // daily_vo2_max first, then the Samsung-era vo2_max) — per day, never blended.
  const sourceKeysByCard = new Map(CURATED_METRICS.map((m) => [m.key, metricSourceKeys(m)]));
  const mergedPoints = (cardKey: string, from: Map<string, HealthDayPoint[]>) =>
    mergeDailySeries((sourceKeysByCard.get(cardKey) ?? [cardKey]).map((k) => from.get(k) ?? []));

  const metrics = CURATED_METRICS.map((m) => ({
    key: m.key,
    label: m.label,
    unit: m.unit,
    agg: m.agg,
    scale: m.scale ?? null,
    decimals: m.decimals ?? 0,
    points: mergedPoints(m.key, byMetric),
  }));

  // ── Fallback: metrics present only as raw samples ───────────────────────────
  // The on-device import endpoint writes health_samples WITHOUT recomputing daily
  // summaries, so a metric sourced only from an import (or one whose cloud backfill
  // hasn't reached these days yet) would render empty. Aggregate its samples live
  // for exactly those metrics — one extra query, and only when something is missing.
  const uncoveredCards = metrics.filter((m) => m.points.length === 0).map((m) => m.key);
  const uncovered = uncoveredCards.flatMap((k) => sourceKeysByCard.get(k) ?? [k]);
  if (uncovered.length > 0) {
    const sampleRows = await database
      .select({
        metric: healthSamples.metric,
        sampleAt: healthSamples.sampleAt,
        value: healthSamples.value,
        valueJson: healthSamples.valueJson,
      })
      .from(healthSamples)
      .where(
        and(
          eq(healthSamples.userId, userId),
          inArray(healthSamples.metric, uncovered),
          ...sampleRange
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
    const live = new Map<string, HealthDayPoint[]>();
    for (const m of metrics) {
      if (!uncoveredCards.includes(m.key)) continue;
      for (const key of sourceKeysByCard.get(m.key) ?? [m.key]) {
        const days = acc.get(key);
        if (!days) continue;
        live.set(
          key,
          [...days.entries()].map(([day, v]) => ({
            day,
            avg: v.sum / v.n,
            min: v.min,
            max: v.max,
            sum: m.agg === "sum" ? v.sum : null,
            count: v.n,
          }))
        );
      }
      m.points = mergedPoints(m.key, live);
    }
  }

  // ── Exercise: structured workouts, computed live from health_samples ────────
  // (not in health_daily_summaries — synced unfiltered, deduped here per workout).
  const exRows = await database
    .select({
      sampleAt: healthSamples.sampleAt,
      source: healthSamples.source,
      value: healthSamples.value,
      valueJson: healthSamples.valueJson,
    })
    .from(healthSamples)
    .where(
      and(
        eq(healthSamples.userId, userId),
        eq(healthSamples.metric, EXERCISE_METRIC),
        ...sampleRange
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
  const workouts: HealthWorkout[] = dedupedWorkouts.slice(0, window.workoutLimit).map((w) => ({
    start: w.sampleAt.toISOString(),
    minutes: Math.round(w.minutes),
    name: str(w.wrapper.displayName),
    type: str(w.wrapper.exerciseType),
  }));

  // ── Sleep: one session per night, so a list of the most recent nights rather
  // than a 30-day trend. Two payload shapes coexist (cloud sync vs on-device
  // import) — modules/health/sleep.ts normalizes both. ────────────────────────
  const sleepRows = await database
    .select({
      sampleAt: healthSamples.sampleAt,
      source: healthSamples.source,
      minutes: healthSamples.value,
      valueJson: healthSamples.valueJson,
    })
    .from(healthSamples)
    .where(
      and(
        eq(healthSamples.userId, userId),
        eq(healthSamples.metric, SLEEP_METRIC),
        ...(window.period ? sampleRange : [])
      )
    )
    .orderBy(desc(healthSamples.sampleAt))
    .limit(window.sleepSessionLimit * SLEEP_ROW_OVERFETCH);
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
    .slice(0, window.sleepSessionLimit)
    .map((r) => ({
      start: r.sampleAt.toISOString(),
      minutes: Math.round(r.minutes),
      stages: stageBreakdown(r.valueJson),
      segments: stageSegments(r.valueJson),
      nap: isNap(r.valueJson),
    }));

  // The list query above is row-capped, so count the period's distinct nights
  // separately (no stage payloads) to report how many the cut left out.
  let periodListTotals: HealthSummary["periodListTotals"];
  if (window.period) {
    const nightRows = await database
      .select({
        sampleAt: healthSamples.sampleAt,
        source: healthSamples.source,
        minutes: healthSamples.value,
      })
      .from(healthSamples)
      .where(
        and(
          eq(healthSamples.userId, userId),
          eq(healthSamples.metric, SLEEP_METRIC),
          ...sampleRange
        )
      );
    const nights = dedupeSessions(
      nightRows.map((r) => ({ sampleAt: r.sampleAt, source: r.source, minutes: r.minutes ?? 0 }))
    ).length;
    periodListTotals = {
      workouts: {
        total: dedupedWorkouts.length,
        truncated: dedupedWorkouts.length > workouts.length,
      },
      sleepSessions: {
        total: Math.max(nights, sleepSessions.length),
        truncated: nights > sleepSessions.length,
      },
    };
  }

  const rhythm = await readRhythm(database, userId, conn?.scope ?? null);

  return {
    rhythm,
    hasConnection: !!conn,
    status: conn?.status ?? null,
    backfillCompletedAt: conn?.backfillCompletedAt?.toISOString() ?? null,
    lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
    hasAnyHistory: metrics.some((m) => m.points.length > 0) || sleepSessions.length > 0,
    metrics,
    workouts,
    sleepSessions,
    ...(periodListTotals ? { periodListTotals } : {}),
  };
}
