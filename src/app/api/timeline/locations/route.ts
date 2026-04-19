/**
 * Location Data Query API
 *
 * GET /api/timeline/locations?date=YYYY-MM-DD
 * Returns location points for a given date, ordered by timestamp.
 * Filters out low-accuracy points (>200m) and downsamples if >500 points.
 */

import { and, asc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { locationPoints } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { distanceM } from "@/lib/geo";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";

const MAX_POINTS = 500;
const MIN_DISTANCE_M = 100;

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

    const useAccuracy = request.nextUrl.searchParams.get("accuracy") !== "false";
    const useMinDistance = request.nextUrl.searchParams.get("minDistance") !== "false";
    const useDownsample = request.nextUrl.searchParams.get("downsample") !== "false";

    const db = getDb();
    const dayStart = startOfLocalDay(dateParam);
    const dayEnd = endOfLocalDay(dateParam);

    const conditions = [
      eq(locationPoints.userId, user.id),
      gte(locationPoints.timestamp, dayStart),
      lt(locationPoints.timestamp, dayEnd),
      or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false)),
    ];

    if (useAccuracy) {
      conditions.push(or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200))!);
    }

    const rows = await db
      .select({
        lat: locationPoints.lat,
        lon: locationPoints.lon,
        accuracy: locationPoints.accuracy,
        altitude: locationPoints.altitude,
        velocity: locationPoints.velocity,
        battery: locationPoints.battery,
        timestamp: locationPoints.timestamp,
      })
      .from(locationPoints)
      .where(and(...conditions))
      .orderBy(asc(locationPoints.timestamp));

    // Filter out points within MIN_DISTANCE_M of the previous accepted point
    let filtered: typeof rows;
    if (useMinDistance) {
      filtered = [];
      for (const row of rows) {
        if (filtered.length === 0) {
          filtered.push(row);
        } else {
          const prev = filtered[filtered.length - 1];
          if (distanceM(prev.lat, prev.lon, row.lat, row.lon) >= MIN_DISTANCE_M) {
            filtered.push(row);
          }
        }
      }
    } else {
      filtered = rows;
    }

    let locations = filtered.map((r) => ({
      lat: r.lat,
      lon: r.lon,
      accuracy: r.accuracy,
      altitude: r.altitude,
      velocity: r.velocity,
      battery: r.battery,
      timestamp: r.timestamp.toISOString(),
    }));

    // Downsample if too many points (time-based uniform sampling)
    if (useDownsample && locations.length > MAX_POINTS) {
      const step = locations.length / MAX_POINTS;
      const sampled = [];
      for (let i = 0; i < MAX_POINTS; i++) {
        sampled.push(locations[Math.floor(i * step)]);
      }
      // Always include the last point
      sampled[sampled.length - 1] = locations[locations.length - 1];
      locations = sampled;
    }

    return NextResponse.json({
      locations,
      count: locations.length,
    });
  } catch (error) {
    console.error("Get locations error:", error);
    return NextResponse.json({ error: "위치 데이터 조회에 실패했습니다" }, { status: 500 });
  }
}
