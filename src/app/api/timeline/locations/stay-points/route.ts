/**
 * Stay Points Detection API
 *
 * GET /api/timeline/locations/stay-points?date=YYYY-MM-DD
 *
 * Uses Dawarich-ported dynamic radius visit detection (50m~500m),
 * then enriches with saved places → geocache → reverse geocoding.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { getDb, locationPoints, placeCache, savedPlaces } from "@/db";
import { eq, and, gte, lt, lte, asc, or, isNull } from "drizzle-orm";
import { getGeocodingAdapter } from "@/lib/adapters/geocoding";
import { distanceM } from "@/lib/geo";
import { detectAndMergeVisits } from "@/modules/location/services/visit-detector";
import type { SavedPlace } from "@/db";

/** Round coordinate to 3 decimal places (~111m cache key) */
function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

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

    // 1. Fetch location points (accuracy ≤ 200m, non-anomaly)
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
          gte(locationPoints.timestamp, dayStart),
          lt(locationPoints.timestamp, dayEnd),
          or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
          or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false)),
        ),
      )
      .orderBy(asc(locationPoints.timestamp));

    // 2. Detect visits using Dawarich-ported algorithm (dynamic radius + merge)
    const detectedVisits = detectAndMergeVisits(rows);

    // 3. Load saved places for matching
    const userSavedPlaces: SavedPlace[] = await db
      .select()
      .from(savedPlaces)
      .where(eq(savedPlaces.userId, user.id));

    // 4. Enrich each visit: saved place → cache → geocoding
    const stayPoints = [];
    for (const visit of detectedVisits) {
      // Try saved place match
      const matched = userSavedPlaces.find(
        (p) => distanceM(visit.centerLat, visit.centerLon, p.lat, p.lon) <= p.radiusM,
      );
      if (matched) {
        stayPoints.push({
          lat: visit.centerLat,
          lon: visit.centerLon,
          placeName: matched.name,
          address: matched.address,
          category: matched.category,
          savedPlaceId: matched.id,
          icon: matched.icon,
          color: matched.color,
          startTime: visit.startTime.toISOString(),
          endTime: visit.endTime.toISOString(),
          durationMinutes: Math.round(visit.durationSeconds / 60),
          radiusM: visit.radiusM,
          pointCount: visit.pointCount,
        });
        continue;
      }

      const latKey = roundCoord(visit.centerLat);
      const lonKey = roundCoord(visit.centerLon);

      // Try cache
      const cached = await db
        .select()
        .from(placeCache)
        .where(and(eq(placeCache.latKey, latKey), eq(placeCache.lonKey, lonKey)))
        .limit(1);

      if (cached.length > 0) {
        const c = cached[0];
        const isStale = c.placeName === c.address && !c.category;
        if (isStale) {
          await db
            .delete(placeCache)
            .where(and(eq(placeCache.latKey, latKey), eq(placeCache.lonKey, lonKey)));
        } else {
          stayPoints.push({
            lat: visit.centerLat,
            lon: visit.centerLon,
            placeName: c.placeName,
            address: c.address,
            category: c.category,
            startTime: visit.startTime.toISOString(),
            endTime: visit.endTime.toISOString(),
            durationMinutes: Math.round(visit.durationSeconds / 60),
            radiusM: visit.radiusM,
            pointCount: visit.pointCount,
          });
          continue;
        }
      }

      // Geocode
      try {
        const adapter = getGeocodingAdapter(visit.centerLat, visit.centerLon);
        const result = await adapter.reverseGeocode(visit.centerLat, visit.centerLon);

        if (result) {
          await db
            .insert(placeCache)
            .values({
              latKey,
              lonKey,
              placeName: result.placeName,
              address: result.address,
              category: result.category ?? null,
              provider: result.provider,
              resolvedAt: new Date(),
            })
            .onConflictDoNothing();

          stayPoints.push({
            lat: visit.centerLat,
            lon: visit.centerLon,
            placeName: result.placeName,
            address: result.address,
            category: result.category,
            startTime: visit.startTime.toISOString(),
            endTime: visit.endTime.toISOString(),
            durationMinutes: Math.round(visit.durationSeconds / 60),
            radiusM: visit.radiusM,
            pointCount: visit.pointCount,
          });
          continue;
        }
      } catch (e) {
        console.error("Geocoding error:", e);
      }

      // Fallback: coordinates only
      stayPoints.push({
        lat: visit.centerLat,
        lon: visit.centerLon,
        placeName: null,
        address: null,
        category: null,
        startTime: visit.startTime.toISOString(),
        endTime: visit.endTime.toISOString(),
        durationMinutes: Math.round(visit.durationSeconds / 60),
        radiusM: visit.radiusM,
        pointCount: visit.pointCount,
      });
    }

    return NextResponse.json({ stayPoints });
  } catch (error) {
    console.error("Stay points error:", error);
    return NextResponse.json(
      { error: "Stay point 조회에 실패했습니다" },
      { status: 500 },
    );
  }
}
