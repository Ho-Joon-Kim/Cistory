/**
 * Location Data Backfill API
 *
 * GET  — Dry run: estimate backfill scope and API call counts
 * POST — Execute full backfill (anomaly → visits → transport) with SSE progress
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb, locationPoints, visits, transportationSegments, placeCache } from "@/db";
import { eq, and, gte, lt, sql, or, isNull, lte, asc } from "drizzle-orm";

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

    const [anomalyStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        scanned: sql<number>`count(*) filter (where anomaly is not null)::int`,
        unscanned: sql<number>`count(*) filter (where anomaly is null)::int`,
        anomalies: sql<number>`count(*) filter (where anomaly = true)::int`,
      })
      .from(locationPoints)
      .where(eq(locationPoints.userId, user.id));

    const [visitStats] = await db
      .select({ daysWithVisits: sql<number>`count(distinct start_time::date)::int` })
      .from(visits)
      .where(eq(visits.userId, user.id));

    const [transportStats] = await db
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
        warnings.push(`해외 좌표 ${uncachedOverseas}건이 ${RATE_LIMITS.google.label} 한도를 초과합니다. 초과분은 과금될 수 있습니다.`);
      } else if (!hasGoogleKey && uncachedOverseas > RATE_LIMITS.mapbox.monthly) {
        warnings.push(`해외 좌표 ${uncachedOverseas}건이 ${RATE_LIMITS.mapbox.label} 한도를 초과합니다. 초과분은 과금될 수 있습니다.`);
      }
    }
    if (uncachedKorea > RATE_LIMITS.kakao.daily) {
      warnings.push(`국내 좌표 ${uncachedKorea}건이 ${RATE_LIMITS.kakao.label} 한도를 초과합니다. 하루에 나눠서 실행하세요.`);
    }

    const daysToBackfill = dateRange.totalDays - visitStats.daysWithVisits;
    const transportDaysToBackfill = dateRange.totalDays - transportStats.daysWithSegments;

    // Total steps = anomaly days + visit days + transport days
    const needsAnomaly = anomalyStats.unscanned > 0;
    const needsVisits = daysToBackfill > 0;
    const needsTransport = transportDaysToBackfill > 0;
    const totalSteps =
      (needsAnomaly ? dateRange.totalDays : 0) +
      (needsVisits ? daysToBackfill : 0) +
      (needsTransport ? transportDaysToBackfill : 0);

    return NextResponse.json({
      hasData: true,
      dateRange: { earliest: dateRange.earliest, latest: dateRange.latest, totalDays: dateRange.totalDays },
      anomaly: { totalPoints: anomalyStats.total, scanned: anomalyStats.scanned, unscanned: anomalyStats.unscanned, anomaliesFound: anomalyStats.anomalies, needsBackfill: needsAnomaly },
      visits: { totalDays: dateRange.totalDays, daysProcessed: visitStats.daysWithVisits, daysRemaining: daysToBackfill, needsBackfill: needsVisits },
      transport: { totalDays: dateRange.totalDays, daysProcessed: transportStats.daysWithSegments, daysRemaining: transportDaysToBackfill, needsBackfill: needsTransport },
      geocoding: { uncachedTotal, uncachedKorea, uncachedOverseas, provider: hasGoogleKey ? "Google Places" : "Mapbox" },
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

  // Build date list
  const dates: string[] = [];
  const cursor = new Date(`${dateRange.earliest}T00:00:00.000Z`);
  const end = new Date(`${dateRange.latest}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const totalSteps = dates.length * 3; // anomaly + visits + transport per day
  let completedSteps = 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendProgress(phase: string, day: string, detail?: string) {
        completedSteps++;
        const data = JSON.stringify({
          phase,
          day,
          detail,
          progress: Math.round((completedSteps / totalSteps) * 100),
          completedSteps,
          totalSteps,
        });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      try {
        // Phase 1: Anomaly detection (day by day)
        const { runAnomalyDetectionForDay } = await import(
          "@/modules/location/services/anomaly-filter"
        );

        let totalAnomalies = 0;
        for (const dateStr of dates) {
          const result = await runAnomalyDetectionForDay(user.id, dateStr);
          totalAnomalies += result.total;
          sendProgress("anomaly", dateStr, `${result.total}건 감지`);
        }

        // Phase 2: Visit detection (day by day)
        const { detectAndPersistVisits } = await import(
          "@/modules/location/services/visit-persister"
        );

        let totalVisits = 0;
        for (const dateStr of dates) {
          const dayVisits = await detectAndPersistVisits(user.id, dateStr);
          totalVisits += dayVisits.length;
          sendProgress("visits", dateStr, `${dayVisits.length}개 방문`);
        }

        // Phase 3: Transportation mode detection (day by day)
        const { detectTransportModes } = await import(
          "@/modules/location/services/transportation/detector"
        );

        let totalSegments = 0;
        for (const dateStr of dates) {
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
                or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
                or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false)),
              ),
            )
            .orderBy(asc(locationPoints.timestamp));

          const segments = detectTransportModes(points);

          if (segments.length > 0) {
            const now = new Date();
            await db.transaction(async (tx) => {
              await tx.delete(transportationSegments).where(
                and(eq(transportationSegments.userId, user.id), eq(transportationSegments.date, dateStr)),
              );
              await tx.insert(transportationSegments).values(
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
            });
            totalSegments += segments.length;
          }

          sendProgress("transport", dateStr, `${segments.length}개 세그먼트`);
        }

        // Final summary
        const summary = JSON.stringify({
          phase: "done",
          totalAnomalies,
          totalVisits,
          totalSegments,
          progress: 100,
        });
        controller.enqueue(encoder.encode(`data: ${summary}\n\n`));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("Backfill execution error:", error);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ phase: "error", error: errMsg })}\n\n`),
        );
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
