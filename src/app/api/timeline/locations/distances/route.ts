/**
 * Daily Distance API
 *
 * GET /api/timeline/locations/distances?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns total travel distance per day (in metres) for the given date range.
 * Past dates are cached in DB; today is always calculated on-the-fly.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { locationPoints, dailyDistances } from "@/db/schema";
import { eq, and, gte, lt, lte, asc, or, isNull, inArray } from "drizzle-orm";
import { distanceM } from "@/lib/geo";

const MIN_DISTANCE_M = 100;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Calculate distance for a single day from raw location points */
function calculateDayDistance(
  points: { lat: number; lon: number }[],
): number {
  if (points.length < 2) return 0;

  let total = 0;
  let prev = points[0];

  for (let i = 1; i < points.length; i++) {
    const d = distanceM(prev.lat, prev.lon, points[i].lat, points[i].lon);
    if (d >= MIN_DISTANCE_M) {
      total += d;
      prev = points[i];
    }
  }

  return total;
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
    const includestoday = allDates.includes(today);

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

    // 4. Calculate uncached past dates + today from raw points
    const datesToCalculate = [
      ...uncachedPastDates,
      ...(includestoday ? [today] : []),
    ];

    if (datesToCalculate.length > 0) {
      const calcStart = new Date(`${datesToCalculate[0]}T00:00:00.000Z`);
      const calcEnd = new Date(
        `${datesToCalculate[datesToCalculate.length - 1]}T23:59:59.999Z`,
      );

      const rows = await db
        .select({
          lat: locationPoints.lat,
          lon: locationPoints.lon,
          timestamp: locationPoints.timestamp,
        })
        .from(locationPoints)
        .where(
          and(
            eq(locationPoints.userId, user.id),
            gte(locationPoints.timestamp, calcStart),
            lt(locationPoints.timestamp, calcEnd),
            or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
          ),
        )
        .orderBy(asc(locationPoints.timestamp));

      // Group points by date
      const pointsByDate: Record<string, { lat: number; lon: number }[]> = {};
      for (const row of rows) {
        const dateKey = row.timestamp.toISOString().slice(0, 10);
        if (!pointsByDate[dateKey]) pointsByDate[dateKey] = [];
        pointsByDate[dateKey].push({ lat: row.lat, lon: row.lon });
      }

      // Calculate and store
      const toCache: { userId: string; date: string; distanceMeters: number; calculatedAt: Date }[] = [];

      for (const dateKey of datesToCalculate) {
        const points = pointsByDate[dateKey] ?? [];
        const dist = calculateDayDistance(points);
        distances[dateKey] = dist;

        // Cache past dates only (not today)
        if (dateKey < today) {
          toCache.push({
            userId: user.id,
            date: dateKey,
            distanceMeters: dist,
            calculatedAt: new Date(),
          });
        }
      }

      // Batch insert cache
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
