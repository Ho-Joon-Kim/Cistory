/**
 * Location Statistics API
 *
 * GET /api/timeline/locations/stats?yearMonth=YYYY-MM
 * Returns monthly location statistics: countries/cities, total distance, anomaly count.
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, locationPoints } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getCountriesAndCities } from "@/modules/location/services/countries-cities";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const yearMonth = request.nextUrl.searchParams.get("yearMonth");
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json(
        { error: "yearMonth 파라미터가 필요합니다 (YYYY-MM)" },
        { status: 400 }
      );
    }

    const [year, month] = yearMonth.split("-").map(Number);
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);

    const db = getDb();

    // Countries & cities
    const countriesAndCities = await getCountriesAndCities(user.id, from, to);

    // Anomaly count
    const [anomalyStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        anomalies: sql<number>`count(*) filter (where anomaly = true)::int`,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, user.id),
          gte(locationPoints.timestamp, from),
          lt(locationPoints.timestamp, to)
        )
      );

    return NextResponse.json({
      yearMonth,
      countriesAndCities,
      totalPoints: anomalyStats.total,
      anomalyCount: anomalyStats.anomalies,
    });
  } catch (error) {
    console.error("Location stats error:", error);
    return NextResponse.json({ error: "위치 통계 조회에 실패했습니다" }, { status: 500 });
  }
}
