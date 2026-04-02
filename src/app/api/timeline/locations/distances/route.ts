/**
 * Daily Distance API
 *
 * GET /api/timeline/locations/distances?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns total travel distance per day (in metres) for the given date range.
 * Past dates are cached in DB; today is always calculated on-the-fly.
 *
 * Uses PostGIS ST_Distance with LAG window function for accurate geodesic distance.
 * Ported from Dawarich: app/queries/stats/daily_distance_query.rb
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb } from "@/db";
import { dailyDistances } from "@/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Calculate daily distances using PostGIS window function.
 * Returns Record<"YYYY-MM-DD", distance_meters>.
 */
async function calculateDistancesPostGIS(
  db: ReturnType<typeof getDb>,
  userId: string,
  from: Date,
  to: Date,
): Promise<Record<string, number>> {
  const rows = await db.execute<{ day_date: string; distance_meters: number; [key: string]: unknown }>(sql`
    WITH points_with_distances AS (
      SELECT
        to_char(timestamp AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day_date,
        CASE
          WHEN LAG(lonlat) OVER (
            PARTITION BY to_char(timestamp AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
            ORDER BY timestamp
          ) IS NOT NULL THEN
            ST_Distance(
              lonlat,
              LAG(lonlat) OVER (
                PARTITION BY to_char(timestamp AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
                ORDER BY timestamp
              )
            )
          ELSE 0
        END AS segment_distance
      FROM location_points
      WHERE user_id = ${userId}
        AND timestamp >= ${from}
        AND timestamp < ${to}
        AND (anomaly IS NOT TRUE)
        AND (accuracy IS NULL OR accuracy <= 200)
        AND lonlat IS NOT NULL
    )
    SELECT
      day_date,
      ROUND(COALESCE(SUM(segment_distance), 0))::int AS distance_meters
    FROM points_with_distances
    GROUP BY day_date
    ORDER BY day_date
  `);

  const result: Record<string, number> = {};
  for (const row of rows.rows) {
    result[row.day_date] = row.distance_meters;
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const fromParam = request.nextUrl.searchParams.get("from");
    const toParam = request.nextUrl.searchParams.get("to");
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (!fromParam || !toParam || !datePattern.test(fromParam) || !datePattern.test(toParam)) {
      return NextResponse.json(
        { error: "from, to 파라미터가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const db = getDb();
    const today = todayUTC();
    const distances: Record<string, number> = {};

    // 1. Build list of all dates in range
    const allDates: string[] = [];
    const cursor = new Date(`${fromParam}T00:00:00.000Z`);
    const end = new Date(`${toParam}T00:00:00.000Z`);
    while (cursor <= end) {
      allDates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    // 2. Separate past dates vs today
    const pastDates = allDates.filter((d) => d < today);
    const includesToday = allDates.includes(today);

    // 3. Look up cached past distances
    let uncachedPastDates: string[] = pastDates;
    if (pastDates.length > 0) {
      const cached = await db
        .select({
          date: dailyDistances.date,
          distanceMeters: dailyDistances.distanceMeters,
        })
        .from(dailyDistances)
        .where(
          and(
            eq(dailyDistances.userId, user.id),
            inArray(dailyDistances.date, pastDates),
          ),
        );

      for (const row of cached) {
        distances[row.date] = row.distanceMeters;
      }

      const cachedSet = new Set(cached.map((r) => r.date));
      uncachedPastDates = pastDates.filter((d) => !cachedSet.has(d));
    }

    // 4. Calculate uncached past dates + today via PostGIS
    const datesToCalculate = [
      ...uncachedPastDates,
      ...(includesToday ? [today] : []),
    ];

    if (datesToCalculate.length > 0) {
      const calcStart = new Date(`${datesToCalculate[0]}T00:00:00.000Z`);
      const calcEnd = new Date(
        `${datesToCalculate[datesToCalculate.length - 1]}T23:59:59.999Z`,
      );

      const calculated = await calculateDistancesPostGIS(db, user.id, calcStart, calcEnd);

      // Merge results and prepare cache entries
      const toCache: { userId: string; date: string; distanceMeters: number; calculatedAt: Date }[] = [];

      for (const dateKey of datesToCalculate) {
        const dist = calculated[dateKey] ?? 0;
        distances[dateKey] = dist;

        if (dateKey < today) {
          toCache.push({
            userId: user.id,
            date: dateKey,
            distanceMeters: dist,
            calculatedAt: new Date(),
          });
        }
      }

      if (toCache.length > 0) {
        await db
          .insert(dailyDistances)
          .values(toCache)
          .onConflictDoNothing();
      }
    }

    return NextResponse.json({ distances });
  } catch (error) {
    console.error("Get distances error:", error);
    return NextResponse.json(
      { error: "이동 거리 조회에 실패했습니다" },
      { status: 500 },
    );
  }
}
