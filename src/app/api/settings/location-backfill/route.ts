/**
 * Location Data Backfill API
 *
 * GET  — Dry run: estimate backfill scope and API call counts
 * POST — Execute backfill for anomaly detection, visits, and transport modes
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb, locationPoints, visits, transportationSegments, placeCache } from "@/db";
import { eq, and, gte, lt, sql, isNull, or } from "drizzle-orm";
import { isInKorea } from "@/lib/adapters/geocoding";

// Rate limits per provider
const RATE_LIMITS = {
  kakao: { daily: 300_000, label: "Kakao (일 30만 건)" },
  mapbox: { monthly: 100_000, label: "Mapbox (월 10만 건)" },
  google: { monthly: 11_000, label: "Google Places (월 ~1.1만 건, $200 크레딧)" },
};

/**
 * GET — Dry run: estimate what backfill would do
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const db = getDb();

    // 1. Date range of location data
    const [dateRange] = await db
      .select({
        earliest: sql<string>`min(timestamp)::date::text`,
        latest: sql<string>`max(timestamp)::date::text`,
        totalDays: sql<number>`(max(timestamp)::date - min(timestamp)::date + 1)::int`,
        totalPoints: sql<number>`count(*)::int`,
      })
      .from(locationPoints)
      .where(eq(locationPoints.userId, user.id));

    if (!dateRange.earliest) {
      return NextResponse.json({ hasData: false });
    }

    // 2. Anomaly status
    const [anomalyStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        scanned: sql<number>`count(*) filter (where anomaly is not null)::int`,
        unscanned: sql<number>`count(*) filter (where anomaly is null)::int`,
        anomalies: sql<number>`count(*) filter (where anomaly = true)::int`,
      })
      .from(locationPoints)
      .where(eq(locationPoints.userId, user.id));

    // 3. Visits status — count days that have visits vs total days
    const [visitStats] = await db
      .select({
        daysWithVisits: sql<number>`count(distinct start_time::date)::int`,
      })
      .from(visits)
      .where(eq(visits.userId, user.id));

    // 4. Transportation segments status
    const [transportStats] = await db
      .select({
        daysWithSegments: sql<number>`count(distinct date)::int`,
      })
      .from(transportationSegments)
      .where(eq(transportationSegments.userId, user.id));

    // 5. Estimate geocoding API calls needed for visits backfill
    // Count unique coordinate grids that aren't in placeCache
    const geocodeEstimate = await db.execute<{
      uncached_total: number;
      uncached_korea: number;
      uncached_overseas: number;
      [key: string]: unknown;
    }>(sql`
      SELECT
        count(*)::int as uncached_total,
        count(*) filter (
          where lat between 33.0 and 38.7 and lon between 124.5 and 132.0
        )::int as uncached_korea,
        count(*) filter (
          where NOT (lat between 33.0 and 38.7 and lon between 124.5 and 132.0)
        )::int as uncached_overseas
      FROM (
        SELECT distinct round(lat::numeric, 3) as lat, round(lon::numeric, 3) as lon
        FROM location_points
        WHERE user_id = ${user.id}
      ) grids
      WHERE NOT EXISTS (
        SELECT 1 FROM place_cache pc
        WHERE pc.lat_key = grids.lat AND pc.lon_key = grids.lon
      )
    `);

    const row = geocodeEstimate.rows[0];
    const uncachedOverseas = row?.uncached_overseas ?? 0;
    const uncachedKorea = row?.uncached_korea ?? 0;
    const uncachedTotal = row?.uncached_total ?? 0;

    // 6. Rate limit warnings
    const warnings: string[] = [];

    const hasGoogleKey = !!process.env.GOOGLE_MAPS_API_KEY;
    if (uncachedOverseas > 0) {
      if (hasGoogleKey && uncachedOverseas > RATE_LIMITS.google.monthly) {
        warnings.push(
          `해외 좌표 ${uncachedOverseas}건이 ${RATE_LIMITS.google.label} 한도를 초과합니다. 초과분은 과금될 수 있습니다.`,
        );
      } else if (!hasGoogleKey && uncachedOverseas > RATE_LIMITS.mapbox.monthly) {
        warnings.push(
          `해외 좌표 ${uncachedOverseas}건이 ${RATE_LIMITS.mapbox.label} 한도를 초과합니다. 초과분은 과금될 수 있습니다.`,
        );
      }
    }

    if (uncachedKorea > RATE_LIMITS.kakao.daily) {
      warnings.push(
        `국내 좌표 ${uncachedKorea}건이 ${RATE_LIMITS.kakao.label} 한도를 초과합니다. 하루에 나눠서 실행하세요.`,
      );
    }

    const daysToBackfill = dateRange.totalDays - visitStats.daysWithVisits;
    const transportDaysToBackfill = dateRange.totalDays - transportStats.daysWithSegments;

    return NextResponse.json({
      hasData: true,
      dateRange: {
        earliest: dateRange.earliest,
        latest: dateRange.latest,
        totalDays: dateRange.totalDays,
      },
      anomaly: {
        totalPoints: anomalyStats.total,
        scanned: anomalyStats.scanned,
        unscanned: anomalyStats.unscanned,
        anomaliesFound: anomalyStats.anomalies,
        needsBackfill: anomalyStats.unscanned > 0,
      },
      visits: {
        totalDays: dateRange.totalDays,
        daysProcessed: visitStats.daysWithVisits,
        daysRemaining: daysToBackfill,
        needsBackfill: daysToBackfill > 0,
      },
      transport: {
        totalDays: dateRange.totalDays,
        daysProcessed: transportStats.daysWithSegments,
        daysRemaining: transportDaysToBackfill,
        needsBackfill: transportDaysToBackfill > 0,
      },
      geocoding: {
        uncachedTotal,
        uncachedKorea,
        uncachedOverseas,
        provider: hasGoogleKey ? "Google Places" : "Mapbox",
      },
      warnings,
    });
  } catch (error) {
    console.error("Backfill dry run error:", error);
    return NextResponse.json(
      { error: "백필 분석에 실패했습니다" },
      { status: 500 },
    );
  }
}

/**
 * POST — Execute backfill
 * Body: { type: "anomaly" | "visits" | "transport" | "all" }
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = await request.json();
    const { type } = body as { type: string };

    if (!["anomaly", "visits", "transport", "all"].includes(type)) {
      return NextResponse.json(
        { error: "type은 anomaly, visits, transport, all 중 하나여야 합니다" },
        { status: 400 },
      );
    }

    const db = getDb();

    // Get date range
    const [dateRange] = await db
      .select({
        earliest: sql<string>`min(timestamp)::date::text`,
        latest: sql<string>`max(timestamp)::date::text`,
      })
      .from(locationPoints)
      .where(eq(locationPoints.userId, user.id));

    if (!dateRange.earliest) {
      return NextResponse.json({ error: "위치 데이터가 없습니다" }, { status: 400 });
    }

    const results: Record<string, unknown> = {};

    // Anomaly detection
    if (type === "anomaly" || type === "all") {
      const { runAnomalyDetection } = await import(
        "@/modules/location/services/anomaly-filter"
      );
      const from = new Date(`${dateRange.earliest}T00:00:00.000Z`);
      const to = new Date(`${dateRange.latest}T23:59:59.999Z`);
      results.anomaly = await runAnomalyDetection(user.id, from, to);
    }

    // Visits detection
    if (type === "visits" || type === "all") {
      const { detectAndPersistVisits } = await import(
        "@/modules/location/services/visit-persister"
      );

      let totalVisits = 0;
      let daysProcessed = 0;

      // Process day by day
      const cursor = new Date(`${dateRange.earliest}T00:00:00.000Z`);
      const end = new Date(`${dateRange.latest}T00:00:00.000Z`);

      while (cursor <= end) {
        const dateStr = cursor.toISOString().slice(0, 10);
        const dayVisits = await detectAndPersistVisits(user.id, dateStr);
        totalVisits += dayVisits.length;
        daysProcessed++;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      results.visits = { daysProcessed, totalVisits };
    }

    // Transportation mode detection
    if (type === "transport" || type === "all") {
      const { detectTransportModes } = await import(
        "@/modules/location/services/transportation/detector"
      );

      let totalSegments = 0;
      let daysProcessed = 0;

      const cursor = new Date(`${dateRange.earliest}T00:00:00.000Z`);
      const end = new Date(`${dateRange.latest}T00:00:00.000Z`);

      while (cursor <= end) {
        const dateStr = cursor.toISOString().slice(0, 10);
        const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
        const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

        const points = await db
          .select({
            lat: locationPoints.lat,
            lon: locationPoints.lon,
            velocity: locationPoints.velocity,
            timestamp: locationPoints.timestamp,
          })
          .from(locationPoints)
          .where(
            and(
              eq(locationPoints.userId, user.id),
              gte(locationPoints.timestamp, dayStart),
              lt(locationPoints.timestamp, dayEnd),
              or(isNull(locationPoints.accuracy), sql`accuracy <= 200`),
              or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false)),
            ),
          )
          .orderBy(locationPoints.timestamp);

        const segments = detectTransportModes(points);

        if (segments.length > 0) {
          const now = new Date();
          await db.delete(transportationSegments).where(
            and(
              eq(transportationSegments.userId, user.id),
              eq(transportationSegments.date, dateStr),
            ),
          );
          await db.insert(transportationSegments).values(
            segments.map((s) => ({
              userId: user.id,
              date: dateStr,
              mode: s.mode,
              confidence: s.confidence,
              startTime: s.startTime,
              endTime: s.endTime,
              distanceMeters: s.distanceMeters,
              durationSeconds: s.durationSeconds,
              avgSpeedKmh: s.avgSpeedKmh,
              maxSpeedKmh: s.maxSpeedKmh,
              avgAcceleration: s.avgAcceleration,
              calculatedAt: now,
            })),
          );
          totalSegments += segments.length;
        }

        daysProcessed++;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      results.transport = { daysProcessed, totalSegments };
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Backfill execution error:", error);
    return NextResponse.json(
      { error: "백필 실행에 실패했습니다" },
      { status: 500 },
    );
  }
}
