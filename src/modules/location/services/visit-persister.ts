/**
 * Visit Persister Service
 *
 * Detects visits, enriches with geocoding, and persists to the visits table.
 * Used by both the stay-points API (on-demand) and the daily cron (background).
 */

import { getDb, locationPoints, placeCache, savedPlaces, visits } from "@/db";
import { eq, and, gte, lt, lte, asc, or, isNull } from "drizzle-orm";
import { getGeocodingAdapter, isInKorea } from "@/lib/adapters/geocoding";
import { distanceM } from "@/lib/geo";
import { detectAndMergeVisits, type DetectedVisit } from "./visit-detector";
import type { SavedPlace } from "@/db";

function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface EnrichedVisit {
  centerLat: number;
  centerLon: number;
  radiusM: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  pointCount: number;
  placeName: string | null;
  address: string | null;
  category: string | null;
  city: string | null;
  countryName: string | null;
  savedPlaceId?: string;
  icon?: string;
  color?: string;
}

/**
 * Extract city and country from address string.
 * For Kakao: address is like "서울특별시 강남구 역삼동 123"
 * For Mapbox/Google: address varies, but city is usually in the result
 */
function extractCityCountry(
  lat: number,
  lon: number,
  address: string | null,
): { city: string | null; countryName: string | null } {
  if (!address) return { city: null, countryName: null };

  if (isInKorea(lat, lon)) {
    // Korean address: "서울특별시 강남구 ..." → city = first token
    const parts = address.split(" ");
    return { city: parts[0] || null, countryName: "대한민국" };
  }

  // International: best-effort extraction from address
  const parts = address.split(", ");
  if (parts.length >= 2) {
    return { city: parts[parts.length - 2] || null, countryName: parts[parts.length - 1] || null };
  }
  return { city: null, countryName: null };
}

/**
 * Detect, enrich, and persist visits for a user on a given date.
 * Returns enriched visit data for API response.
 */
export async function detectAndPersistVisits(
  userId: string,
  dateParam: string,
): Promise<EnrichedVisit[]> {
  const db = getDb();
  const dayStart = new Date(`${dateParam}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateParam}T23:59:59.999Z`);
  const now = new Date();

  // 1. Fetch location points
  const rows = await db
    .select({
      lat: locationPoints.lat,
      lon: locationPoints.lon,
      timestamp: locationPoints.timestamp,
    })
    .from(locationPoints)
    .where(
      and(
        eq(locationPoints.userId, userId),
        gte(locationPoints.timestamp, dayStart),
        lt(locationPoints.timestamp, dayEnd),
        or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
        or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false)),
      ),
    )
    .orderBy(asc(locationPoints.timestamp));

  if (rows.length === 0) return [];

  // 2. Detect visits
  const detectedVisits = detectAndMergeVisits(rows);
  if (detectedVisits.length === 0) return [];

  // 3. Load saved places
  const userSavedPlaces: SavedPlace[] = await db
    .select()
    .from(savedPlaces)
    .where(eq(savedPlaces.userId, userId));

  // 4. Enrich each visit and build persist records
  const enrichedVisits: EnrichedVisit[] = [];
  const visitRows: (typeof visits.$inferInsert)[] = [];

  for (const visit of detectedVisits) {
    let placeName: string | null = null;
    let address: string | null = null;
    let category: string | null = null;
    let savedPlaceId: string | undefined;
    let icon: string | undefined;
    let color: string | undefined;

    // Try saved place match
    const matched = userSavedPlaces.find(
      (p) => distanceM(visit.centerLat, visit.centerLon, p.lat, p.lon) <= p.radiusM,
    );

    if (matched) {
      placeName = matched.name;
      address = matched.address;
      category = matched.category;
      savedPlaceId = matched.id;
      icon = matched.icon ?? undefined;
      color = matched.color ?? undefined;
    } else {
      const latKey = roundCoord(visit.centerLat);
      const lonKey = roundCoord(visit.centerLon);

      // Try cache
      const cached = await db
        .select()
        .from(placeCache)
        .where(and(eq(placeCache.latKey, latKey), eq(placeCache.lonKey, lonKey)))
        .limit(1);

      if (cached.length > 0 && !(cached[0].placeName === cached[0].address && !cached[0].category)) {
        placeName = cached[0].placeName;
        address = cached[0].address;
        category = cached[0].category;
      } else {
        // Stale cache — delete
        if (cached.length > 0) {
          await db.delete(placeCache).where(and(eq(placeCache.latKey, latKey), eq(placeCache.lonKey, lonKey)));
        }

        // Geocode
        try {
          const adapter = getGeocodingAdapter(visit.centerLat, visit.centerLon);
          const result = await adapter.reverseGeocode(visit.centerLat, visit.centerLon);
          if (result) {
            placeName = result.placeName;
            address = result.address;
            category = result.category ?? null;
            await db
              .insert(placeCache)
              .values({ latKey, lonKey, placeName: result.placeName, address: result.address, category: result.category ?? null, provider: result.provider, resolvedAt: now })
              .onConflictDoNothing();
          }
        } catch (e) {
          console.error("Geocoding error:", e);
        }
      }
    }

    const { city, countryName } = extractCityCountry(visit.centerLat, visit.centerLon, address);

    enrichedVisits.push({
      centerLat: visit.centerLat,
      centerLon: visit.centerLon,
      radiusM: visit.radiusM,
      startTime: visit.startTime.toISOString(),
      endTime: visit.endTime.toISOString(),
      durationMinutes: Math.round(visit.durationSeconds / 60),
      pointCount: visit.pointCount,
      placeName,
      address,
      category,
      city,
      countryName,
      savedPlaceId,
      icon,
      color,
    });

    visitRows.push({
      userId,
      centerLat: visit.centerLat,
      centerLon: visit.centerLon,
      radiusM: visit.radiusM,
      startTime: visit.startTime,
      endTime: visit.endTime,
      durationSeconds: visit.durationSeconds,
      placeName,
      address,
      category,
      city,
      countryName,
      savedPlaceId: savedPlaceId ?? null,
      calculatedAt: now,
    });
  }

  // 5. Persist: delete existing visits for this date, then insert fresh
  await db.delete(visits).where(
    and(
      eq(visits.userId, userId),
      gte(visits.startTime, dayStart),
      lt(visits.startTime, dayEnd),
    ),
  );

  if (visitRows.length > 0) {
    await db.insert(visits).values(visitRows);
  }

  return enrichedVisits;
}
