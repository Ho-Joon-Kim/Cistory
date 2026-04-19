/**
 * Anomaly Detection API
 *
 * POST /api/timeline/locations/anomalies — Trigger anomaly detection for a date range
 * GET  /api/timeline/locations/anomalies?date=YYYY-MM-DD — Get anomaly stats for a date
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb, locationPoints } from "@/db";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { endOfLocalDay, startOfLocalDay, toLocalDateString } from "@/lib/utils";
import { runAnomalyDetectionForDay } from "@/modules/location/services/anomaly-filter";

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const body = await request.json();
    const { from, to } = body as { from?: string; to?: string };

    if (!from || !to) {
      return NextResponse.json(
        { error: "from, to 파라미터가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // Process day by day
    let totalMarked = 0;
    const cursor = startOfLocalDay(from);
    const end = startOfLocalDay(to);

    while (cursor <= end) {
      const dateStr = toLocalDateString(cursor);
      const result = await runAnomalyDetectionForDay(user.id, dateStr);
      totalMarked += result.total;
      cursor.setDate(cursor.getDate() + 1);
    }

    return NextResponse.json({ marked: totalMarked });
  } catch (error) {
    console.error("Anomaly detection error:", error);
    return NextResponse.json({ error: "이상치 탐지에 실패했습니다" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const dateParam = request.nextUrl.searchParams.get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { error: "date 파라미터가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const db = getDb();
    const dayStart = startOfLocalDay(dateParam);
    const dayEnd = endOfLocalDay(dateParam);

    const [stats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        anomalies: sql<number>`count(*) filter (where anomaly = true)::int`,
        clean: sql<number>`count(*) filter (where anomaly is not true)::int`,
      })
      .from(locationPoints)
      .where(
        and(
          eq(locationPoints.userId, user.id),
          gte(locationPoints.timestamp, dayStart),
          lt(locationPoints.timestamp, dayEnd)
        )
      );

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Anomaly stats error:", error);
    return NextResponse.json({ error: "이상치 통계 조회에 실패했습니다" }, { status: 500 });
  }
}
