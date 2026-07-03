/**
 * Location Data Backfill API
 *
 * GET  — Dry run: estimate backfill scope and API call counts
 * POST — Execute full backfill (anomaly → visits → tracks/transport → enrich → trips) with SSE progress
 */

import { eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, locationPoints, transportationSegments, visits } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";

// Rate limits per provider
const RATE_LIMITS = {
  kakao: { daily: 300_000, label: "Kakao (일 30만 건)" },
  mapbox: { monthly: 100_000, label: "Mapbox (월 10만 건)" },
  google: { monthly: 11_000, label: "Google Places (월 ~1.1만 건, $200 크레딧)" },
};

/**
 * GET — Dry run
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();

    // All date arithmetic uses KST so "today" lines up with the daily 01:00 cron window.
    const [dateRange] = await db
      .select({
        earliest: sql<string>`min(timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date::text`,
        latest: sql<string>`max(timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date::text`,
        totalDays: sql<number>`((max(timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date - min(timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date) + 1)::int`,
        totalPoints: sql<number>`count(*)::int`,
        today: sql<string>`(now() at time zone 'Asia/Seoul')::date::text`,
      })
      .from(locationPoints)
      .where(eq(locationPoints.userId, user.id));

    if (!dateRange.earliest) {
      return NextResponse.json({ hasData: false });
    }

    const [anomalyStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        scanned: sql<number>`count(*) filter (where anomaly is not null)::int`,
        unscanned: sql<number>`count(*) filter (where anomaly is null)::int`,
        anomalies: sql<number>`count(*) filter (where anomaly = true)::int`,
        todayUnscanned: sql<number>`count(*) filter (where anomaly is null and (timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)::int`,
      })
      .from(locationPoints)
      .where(eq(locationPoints.userId, user.id));

    // Days fully scanned = all points on that day have anomaly IS NOT NULL.
    // We exclude today from "past" reporting so the daily 01:00 KST cron isn't
    // mistaken for a backlog the user has to clear manually.
    const scannedDaysResult = await db.execute<{
      past_total_days: number;
      past_scanned_days: number;
      past_unscanned_days: number;
      [key: string]: unknown;
    }>(sql`
      WITH per_day AS (
        SELECT
          (timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date AS d,
          count(*) FILTER (WHERE anomaly IS NULL) AS unscanned
        FROM location_points
        WHERE user_id = ${user.id}
        GROUP BY (timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date
      )
      SELECT
        count(*) FILTER (WHERE d < (now() at time zone 'Asia/Seoul')::date)::int AS past_total_days,
        count(*) FILTER (WHERE d < (now() at time zone 'Asia/Seoul')::date AND unscanned = 0)::int AS past_scanned_days,
        count(*) FILTER (WHERE d < (now() at time zone 'Asia/Seoul')::date AND unscanned > 0)::int AS past_unscanned_days
      FROM per_day
    `);
    const pastTotalDays = scannedDaysResult.rows[0]?.past_total_days ?? 0;
    const pastScannedDays = scannedDaysResult.rows[0]?.past_scanned_days ?? 0;
    const pastDaysRemaining = scannedDaysResult.rows[0]?.past_unscanned_days ?? 0;
    const todayHasUnscanned = (anomalyStats.todayUnscanned ?? 0) > 0;

    const [_visitStats] = await db
      .select({
        daysWithVisits: sql<number>`count(distinct (start_time at time zone 'UTC' at time zone 'Asia/Seoul')::date)::int`,
      })
      .from(visits)
      .where(eq(visits.userId, user.id));

    const [_transportStats] = await db
      .select({ daysWithSegments: sql<number>`count(distinct date)::int` })
      .from(transportationSegments)
      .where(eq(transportationSegments.userId, user.id));

    const geocodeEstimate = await db.execute<{
      uncached_total: number;
      uncached_korea: number;
      uncached_overseas: number;
      [key: string]: unknown;
    }>(sql`
      SELECT
        count(*)::int as uncached_total,
        count(*) filter (where lat between 33.0 and 38.7 and lon between 124.5 and 132.0)::int as uncached_korea,
        count(*) filter (where NOT (lat between 33.0 and 38.7 and lon between 124.5 and 132.0))::int as uncached_overseas
      FROM (
        SELECT distinct round(lat::numeric, 3) as lat, round(lon::numeric, 3) as lon
        FROM location_points WHERE user_id = ${user.id}
      ) grids
      WHERE NOT EXISTS (
        SELECT 1 FROM place_cache pc WHERE pc.lat_key = grids.lat AND pc.lon_key = grids.lon
      )
    `);

    const row = geocodeEstimate.rows[0];
    const uncachedOverseas = row?.uncached_overseas ?? 0;
    const uncachedKorea = row?.uncached_korea ?? 0;
    const uncachedTotal = row?.uncached_total ?? 0;

    const warnings: string[] = [];
    const hasGoogleKey = !!process.env.GOOGLE_MAPS_API_KEY;
    if (uncachedOverseas > 0) {
      if (hasGoogleKey && uncachedOverseas > RATE_LIMITS.google.monthly) {
        warnings.push(
          `해외 좌표 ${uncachedOverseas}건이 ${RATE_LIMITS.google.label} 한도를 초과합니다. 초과분은 과금될 수 있습니다.`
        );
      } else if (!hasGoogleKey && uncachedOverseas > RATE_LIMITS.mapbox.monthly) {
        warnings.push(
          `해외 좌표 ${uncachedOverseas}건이 ${RATE_LIMITS.mapbox.label} 한도를 초과합니다. 초과분은 과금될 수 있습니다.`
        );
      }
    }
    if (uncachedKorea > RATE_LIMITS.kakao.daily) {
      warnings.push(
        `국내 좌표 ${uncachedKorea}건이 ${RATE_LIMITS.kakao.label} 한도를 초과합니다. 하루에 나눠서 실행하세요.`
      );
    }

    // Past-only "needsBackfill" gates the primary action. Today is reported
    // separately as a pending state that the daily cron will pick up.
    const needsPastBackfill = pastDaysRemaining > 0;
    const totalSteps = needsPastBackfill ? pastDaysRemaining * 3 : 0;

    return NextResponse.json({
      hasData: true,
      dateRange: {
        earliest: dateRange.earliest,
        latest: dateRange.latest,
        totalDays: dateRange.totalDays,
        today: dateRange.today,
      },
      past: {
        totalDays: pastTotalDays,
        daysProcessed: pastScannedDays,
        daysRemaining: pastDaysRemaining,
        needsBackfill: needsPastBackfill,
      },
      today: {
        date: dateRange.today,
        unscannedPoints: anomalyStats.todayUnscanned ?? 0,
        pending: todayHasUnscanned,
      },
      anomaly: {
        totalPoints: anomalyStats.total,
        scanned: anomalyStats.scanned,
        unscanned: anomalyStats.unscanned,
        anomaliesFound: anomalyStats.anomalies,
      },
      geocoding: {
        uncachedTotal,
        uncachedKorea,
        uncachedOverseas,
        provider: hasGoogleKey ? "Google Places" : "Mapbox",
      },
      warnings,
      totalSteps,
    });
  } catch (error) {
    console.error("Backfill dry run error:", error);
    return NextResponse.json({ error: "백필 분석에 실패했습니다" }, { status: 500 });
  }
}

/**
 * POST — Execute full backfill with SSE progress streaming
 * Always runs: anomaly → visits → transport (in dependency order)
 */
export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError) return authError;

  const { planBackfill, runBackfill } = await import(
    "@/modules/location/services/backfill-orchestrator"
  );

  const scopeParam = new URL(request.url).searchParams.get("scope");
  const scope: "all" | "past" | "today" =
    scopeParam === "past" || scopeParam === "today" ? scopeParam : "all";

  const plan = await planBackfill(user.id, scope);
  if (!plan) {
    return NextResponse.json({ error: "위치 데이터가 없습니다" }, { status: 400 });
  }
  if (plan.dates.length === 0) {
    return NextResponse.json({ message: "모든 날짜가 이미 처리되었습니다" });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runBackfill(user.id, plan)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
