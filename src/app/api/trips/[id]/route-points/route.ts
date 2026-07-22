import { and, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, trips } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getKstDateWindow } from "@/lib/date-key";
import { distanceM } from "@/lib/geo";
import { logger } from "@/lib/logger";

export const MAX_ROUTE_POINTS = 1000;
const MIN_ROUTE_DISTANCE_M = 50;
const MAX_ACCURACY_M = 200;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export interface RoutePointRow {
  lat: number;
  lon: number;
  accuracy: number | null;
  timestamp: Date;
}

/** Mirrors the SQL window predicate, kept pure so the 84k-point bound is testable. */
export function getSampledRowNumbers(totalCount: number, cap: number): number[] {
  if (totalCount <= 0 || cap <= 0) return [];
  if (totalCount <= cap) return Array.from({ length: totalCount }, (_, index) => index + 1);
  if (cap === 1) return [1];
  if (cap === 2) return [1, totalCount];

  const step = Math.max(1, Math.ceil((totalCount - 2) / (cap - 2)));
  const sampled = [1];
  for (let rowNumber = 2; rowNumber < totalCount; rowNumber += step) {
    sampled.push(rowNumber);
  }
  sampled.push(totalCount);
  return sampled;
}

export function simplifyRoutePoints(rows: RoutePointRow[], minDistanceM: number): RoutePointRow[] {
  if (rows.length <= 2) return rows;
  const simplified: RoutePointRow[] = [rows[0]];
  for (const row of rows.slice(1, -1)) {
    const previous = simplified[simplified.length - 1];
    if (distanceM(previous.lat, previous.lon, row.lat, row.lon) >= minDistanceM) {
      simplified.push(row);
    }
  }
  simplified.push(rows[rows.length - 1]);
  return simplified;
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
    // Sampling happens inside PostgreSQL. Only this bounded result is decoded in JS.
    // The first/last rows are explicit exceptions; the stride allows at most cap-2 middles.
    const result = await db.execute(sql`
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
          AND timestamp >= ${window.start}
          AND timestamp < ${window.end}
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
    const sampledRows = result.rows as unknown as RoutePointRow[];
    const points = simplifyRoutePoints(sampledRows, MIN_ROUTE_DISTANCE_M).map((row) => ({
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
