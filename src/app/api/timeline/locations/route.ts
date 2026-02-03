/**
 * Location Data Query API
 *
 * GET /api/timeline/locations?date=YYYY-MM-DD
 * Returns location points for a given date, ordered by timestamp.
 * Filters out low-accuracy points (>200m) and downsamples if >500 points.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { getDb } from "@/db";
import { locationPoints } from "@/db/schema";
import { eq, and, gte, lt, lte, asc, or, isNull } from "drizzle-orm";

const MAX_POINTS = 500;
const MIN_DISTANCE_M = 100;

/** Haversine distance between two coordinates in metres */
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    const dayStart = new Date(`${dateParam}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateParam}T23:59:59.999Z`);

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
      .where(
        and(
          eq(locationPoints.userId, user.id),
          gte(locationPoints.timestamp, dayStart),
          lt(locationPoints.timestamp, dayEnd),
          or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200))
        )
      )
      .orderBy(asc(locationPoints.timestamp));

    // Filter out points within 50m of the previous accepted point
    const filtered: typeof rows = [];
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
    if (locations.length > MAX_POINTS) {
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
    return NextResponse.json(
      { error: "위치 데이터 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}
