import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, healthConnections, healthDailySummaries } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { CURATED_METRIC_KEYS, CURATED_METRICS } from "@/modules/health/metrics-meta";

const TREND_WINDOW_DAYS = 30;

/** 'YYYY-MM-DD' for `days` ago in KST — the health_daily_summaries.day key space. */
function kstDayNDaysAgo(days: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

interface DayPoint {
  day: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  sum: number | null;
  count: number | null;
}

/**
 * Curated daily health trends + connection meta in one call, so the page picks
 * its state (never-connected / backfilling / connected-no-data / disconnected-
 * with-history) without a second request. Summaries are returned even when there
 * is no connection so retained history (R1) still renders after a disconnect.
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

  const byMetric = new Map<string, DayPoint[]>();
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

  return NextResponse.json({
    hasConnection: !!conn,
    status: conn?.status ?? null,
    backfillCompletedAt: conn?.backfillCompletedAt?.toISOString() ?? null,
    lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
    hasAnyHistory: metrics.some((m) => m.points.length > 0),
    metrics,
  });
});
