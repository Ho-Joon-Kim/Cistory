import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, locationPoints, segmentRouteMatches, transportationSegments, trips } from "@/db";
import { timestampFromDriver, timestampParam } from "@/db/sql";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getKstDateWindow } from "@/lib/date-key";
import { logger } from "@/lib/logger";
import { assembleTrackShape } from "@/modules/location/services/route-match/track-shape";
import {
  getSampledRowNumbers,
  MAX_ROUTE_POINTS,
  type RoutePointRow,
  simplifyRoutePoints,
} from "@/modules/travel/route-points";

const MIN_ROUTE_DISTANCE_M = 50;
const MAX_ACCURACY_M = 200;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const { id } = await context.params;
    const db = getDb();
    const [trip] = await db
      .select({ id: trips.id, startDate: trips.startDate, endDate: trips.endDate })
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, user.id)))
      .limit(1);
    if (!trip) {
      return NextResponse.json({ error: "여행을 찾을 수 없습니다" }, { status: 404 });
    }

    const window = getKstDateWindow(trip.startDate, trip.endDate);
    const segmentRowsPromise = db
      .select({
        startTime: transportationSegments.startTime,
        shape: segmentRouteMatches.shape,
      })
      .from(transportationSegments)
      .leftJoin(segmentRouteMatches, eq(segmentRouteMatches.segmentId, transportationSegments.id))
      .where(
        and(
          eq(transportationSegments.userId, user.id),
          gte(transportationSegments.startTime, window.start),
          lt(transportationSegments.startTime, window.end)
        )
      )
      .orderBy(asc(transportationSegments.startTime));

    // Sampling happens inside PostgreSQL. Only this bounded result is decoded in JS.
    // The first/last rows are explicit exceptions; the stride allows at most cap-2 middles.
    const rawPointsPromise = db.execute(sql`
      WITH filtered AS (
        SELECT
          lat,
          lon,
          accuracy,
          timestamp,
          row_number() OVER (ORDER BY timestamp, id) AS row_number,
          count(*) OVER () AS total_count
        FROM location_points
        WHERE user_id = ${user.id}
          AND timestamp >= ${timestampParam(locationPoints.timestamp, window.start)}
          AND timestamp < ${timestampParam(locationPoints.timestamp, window.end)}
          AND (anomaly IS NULL OR anomaly = false)
          AND (accuracy IS NULL OR accuracy <= ${MAX_ACCURACY_M})
      ), sampled AS (
        SELECT lat, lon, accuracy, timestamp
        FROM filtered
        WHERE total_count <= ${MAX_ROUTE_POINTS}
           OR row_number = 1
           OR row_number = total_count
           OR (
             row_number > 1
             AND row_number < total_count
             AND mod(
               row_number - 2,
               greatest(
                 1,
                 ceil((total_count - 2)::numeric / ${MAX_ROUTE_POINTS - 2})::bigint
               )
             ) = 0
           )
      )
      SELECT lat, lon, accuracy, timestamp
      FROM sampled
      ORDER BY timestamp
    `);
    const [segmentRows, result] = await Promise.all([segmentRowsPromise, rawPointsPromise]);
    const sampledRows: RoutePointRow[] = result.rows.map((row) => ({
      lat: Number(row.lat),
      lon: Number(row.lon),
      accuracy: row.accuracy == null ? null : Number(row.accuracy),
      timestamp: timestampFromDriver(locationPoints.timestamp, row.timestamp),
    }));
    const assembledRows = assembleTrackShape(segmentRows, sampledRows);
    const simplifiedRows = simplifyRoutePoints(assembledRows, MIN_ROUTE_DISTANCE_M);
    const boundedRows =
      simplifiedRows.length <= MAX_ROUTE_POINTS
        ? simplifiedRows
        : getSampledRowNumbers(simplifiedRows.length, MAX_ROUTE_POINTS).map(
            (rowNumber) => simplifiedRows[rowNumber - 1]
          );
    const points = boundedRows.map((row) => ({
      lat: Number(row.lat),
      lon: Number(row.lon),
      accuracy: row.accuracy == null ? null : Number(row.accuracy),
      timestamp: new Date(row.timestamp).toISOString(),
    }));

    return NextResponse.json({
      points,
      count: points.length,
      rawSampledCount: sampledRows.length,
      maxPoints: MAX_ROUTE_POINTS,
    });
  } catch (error) {
    logger.error("Trip route points GET error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "여행 경로 조회에 실패했습니다" }, { status: 500 });
  }
}
