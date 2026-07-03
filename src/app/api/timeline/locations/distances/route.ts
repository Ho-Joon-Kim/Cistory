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

import { and, eq, inArray, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { dailyDistances } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { endOfLocalDay, startOfLocalDay, toLocalDateString } from "@/lib/utils";

function todayLocal(): string {
  return toLocalDateString(new Date());
}

/**
 * Calculate daily distances using PostGIS window function.
 * Returns Record<"YYYY-MM-DD", distance_meters>.
 */
async function calculateDistancesPostGIS(
  db: ReturnType<typeof getDb>,
  userId: string,
  from: Date,
  to: Date
): Promise<Record<string, number>> {
  const rows = await db.execute<{
    day_date: string;
    distance_meters: number;
    [key: string]: unknown;
  }>(sql`
    WITH points_with_distances AS (
      SELECT
        to_char(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day_date,
        CASE
          WHEN LAG(lonlat) OVER (
            PARTITION BY to_char(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
            ORDER BY timestamp
          ) IS NOT NULL THEN
            ST_Distance(
              lonlat,
              LAG(lonlat) OVER (
                PARTITION BY to_char(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
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
        { status: 400 }
      );
    }

    const db = getDb();
    const today = todayLocal();
    const distances: Record<string, number> = {};

    // 1. Build list of all dates in range (local-day iteration)
    const allDates: string[] = [];
    const cursor = startOfLocalDay(fromParam);
    const end = startOfLocalDay(toParam);
    while (cursor <= end) {
      allDates.push(toLocalDateString(cursor));
      cursor.setDate(cursor.getDate() + 1);
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
        .where(and(eq(dailyDistances.userId, user.id), inArray(dailyDistances.date, pastDates)));

      for (const row of cached) {
        distances[row.date] = row.distanceMeters;
      }

      const cachedSet = new Set(cached.map((r) => r.date));
      uncachedPastDates = pastDates.filter((d) => !cachedSet.has(d));
    }

    // 4. Calculate uncached past dates + today via PostGIS.
    // Compute per contiguous run of dates — a single min..max window would
    // re-scan every already-cached day sitting between two scattered cache
    // misses (e.g. missing 2026-01-03 and 2026-06-28 → 6 months of points).
    const datesToCalculate = [...uncachedPastDates, ...(includesToday ? [today] : [])].sort();

    if (datesToCalculate.length > 0) {
      const runs: string[][] = [];
      for (const d of datesToCalculate) {
        const lastRun = runs[runs.length - 1];
        const next = lastRun && startOfLocalDay(lastRun[lastRun.length - 1]);
        if (next) next.setDate(next.getDate() + 1);
        if (next && toLocalDateString(next) === d) {
          lastRun.push(d);
        } else {
          runs.push([d]);
        }
      }

      const calculated: Record<string, number> = {};
      for (const run of runs) {
        const runResult = await calculateDistancesPostGIS(
          db,
          user.id,
          startOfLocalDay(run[0]),
          endOfLocalDay(run[run.length - 1])
        );
        Object.assign(calculated, runResult);
      }

      // Merge results and prepare cache entries
      const toCache: {
        userId: string;
        date: string;
        distanceMeters: number;
        calculatedAt: Date;
      }[] = [];

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
        await db.insert(dailyDistances).values(toCache).onConflictDoNothing();
      }
    }

    return NextResponse.json({ distances });
  } catch (error) {
    console.error("Get distances error:", error);
    return NextResponse.json({ error: "이동 거리 조회에 실패했습니다" }, { status: 500 });
  }
}
