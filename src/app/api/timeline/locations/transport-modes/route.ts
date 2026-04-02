/**
 * Transportation Mode Detection API
 *
 * GET /api/timeline/locations/transport-modes?date=YYYY-MM-DD
 * Returns detected transportation mode segments for a given day.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb, locationPoints } from "@/db";
import { eq, and, gte, lt, lte, asc, or, isNull } from "drizzle-orm";
import { detectTransportModes } from "@/modules/location/services/transportation/detector";

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const dateParam = request.nextUrl.searchParams.get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { error: "date 파라미터가 필요합니다 (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const db = getDb();
    const dayStart = new Date(`${dateParam}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateParam}T23:59:59.999Z`);

    const rows = await db
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

    const segments = detectTransportModes(rows);

    return NextResponse.json({
      segments: segments.map((s) => ({
        mode: s.mode,
        confidence: s.confidence,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        distanceMeters: s.distanceMeters,
        durationSeconds: s.durationSeconds,
        avgSpeedKmh: s.avgSpeedKmh,
        maxSpeedKmh: s.maxSpeedKmh,
      })),
    });
  } catch (error) {
    console.error("Transport modes error:", error);
    return NextResponse.json(
      { error: "교통수단 감지에 실패했습니다" },
      { status: 500 },
    );
  }
}
