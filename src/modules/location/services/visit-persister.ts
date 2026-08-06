/**
 * Visit Persister Service
 *
 * Detects visits, enriches with geocoding, and persists to the visits table.
 * Used by both the stay-points API (on-demand) and the daily cron (background).
 */

import { and, asc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { SavedPlace } from "@/db";
import { getDb, locationPoints, placeCache, savedPlaces, visits } from "@/db";
import { getGeocodingAdapter } from "@/lib/adapters/geocoding";
import { distanceM, placeCacheCoordKey } from "@/lib/geo";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";
import { detectAndMergeVisits } from "./visit-detector";

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
}

/**
 * Detect, enrich, and persist visits for a user on a given date.
 * Returns enriched visit data for API response.
 */
export async function detectAndPersistVisits(
  userId: string,
  dateParam: string
): Promise<EnrichedVisit[]> {
  const db = getDb();
  const dayStart = startOfLocalDay(dateParam);
  const dayEnd = endOfLocalDay(dateParam);
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
        or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false))
      )
    )
    .orderBy(asc(locationPoints.timestamp));

  // Reprocessing can legitimately yield nothing (e.g. points re-marked as
  // anomalies since the last run). Stale visits from the previous run must
  // still be cleared, or they survive forever and pollute residency/travel
  // stats — so the empty cases delete-and-return instead of just returning.
  if (rows.length === 0) {
    await deleteVisitsInWindow(userId, dayStart, dayEnd);
    return [];
  }

  // 2. Detect visits
  const detectedVisits = detectAndMergeVisits(rows);
  if (detectedVisits.length === 0) {
    await deleteVisitsInWindow(userId, dayStart, dayEnd);
    return [];
  }

  // 3. Load saved places
  const userSavedPlaces: SavedPlace[] = await db
    .select()
    .from(savedPlaces)
    .where(eq(savedPlaces.userId, userId));

  // 4. Enrich each visit. P4: batch the placeCache read across all visits
  // (previously N SELECT-per-visit) and run any remaining geocoding API calls
  // in parallel with a small concurrency cap to respect Kakao's rate limits.

  // 4a. Collect saved-place name overrides, and queue EVERY visit for the
  // region/country lookup — a saved place overrides what a location is called,
  // not the administrative region its coordinate sits in (home is still in
  // 서울), so region/country always come from the cache/geocode pipeline below.
  interface Enrichment {
    placeName: string | null;
    address: string | null;
    category: string | null;
    region: string | null;
    country: string | null;
    savedPlaceId?: string;
  }

  interface SavedPlaceOverride {
    placeName: string;
    address: string | null;
    category: string | null;
    savedPlaceId: string;
  }

  const visitEnrichments = new Map<number, Enrichment>();
  const savedPlaceOverrides = new Map<number, SavedPlaceOverride>();
  const visitsForRegionLookup: { idx: number; latKey: number; lonKey: number }[] = [];

  detectedVisits.forEach((visit, idx) => {
    const matched = userSavedPlaces.find(
      (p) => distanceM(visit.centerLat, visit.centerLon, p.lat, p.lon) <= p.radiusM
    );
    if (matched) {
      savedPlaceOverrides.set(idx, {
        placeName: matched.name,
        address: matched.address,
        category: matched.category,
        savedPlaceId: matched.id,
      });
    }
    visitsForRegionLookup.push({
      idx,
      latKey: placeCacheCoordKey(visit.centerLat),
      lonKey: placeCacheCoordKey(visit.centerLon),
    });
  });

  // 4b. Batch-read placeCache for every visit's coordinate at once.
  let cacheByKey = new Map<string, typeof placeCache.$inferSelect>();
  if (visitsForRegionLookup.length > 0) {
    const latKeys = Array.from(new Set(visitsForRegionLookup.map((v) => v.latKey)));
    const lonKeys = Array.from(new Set(visitsForRegionLookup.map((v) => v.lonKey)));
    const cachedRows = await db
      .select()
      .from(placeCache)
      .where(and(inArray(placeCache.latKey, latKeys), inArray(placeCache.lonKey, lonKeys)));
    cacheByKey = new Map(cachedRows.map((r) => [`${r.latKey}:${r.lonKey}`, r]));
  }

  // 4c. Separate cache hits from misses/stale, delete stale in one batch,
  // then fire geocoding API calls in parallel (concurrency 5).
  const staleKeys: { latKey: number; lonKey: number }[] = [];
  const needsGeocoding: { idx: number; latKey: number; lonKey: number }[] = [];

  for (const v of visitsForRegionLookup) {
    const cached = cacheByKey.get(`${v.latKey}:${v.lonKey}`);
    // A cache row written before migration 0040 added region/country carries
    // both columns null and should refill. A legitimate geocode can ALSO come
    // back with a null region alone (mapbox.ts/google.ts fall back to null
    // when no admin region resolves for that coordinate) while still setting
    // country — so testing region alone would mark that row stale forever:
    // re-geocode -> still-null region -> stale again on every future touch,
    // burning API quota (Kakao always sets country to "대한민국", and
    // Mapbox/Google resolve one for nearly every coordinate). Only treat the
    // row as pre-migration, and thus stale, when BOTH columns are null.
    const isStale =
      cached &&
      ((cached.placeName === cached.address && !cached.category) ||
        (cached.region === null && cached.country === null));
    if (cached && !isStale) {
      visitEnrichments.set(v.idx, {
        placeName: cached.placeName,
        address: cached.address,
        category: cached.category,
        region: cached.region,
        country: cached.country,
      });
    } else {
      if (isStale) staleKeys.push({ latKey: v.latKey, lonKey: v.lonKey });
      needsGeocoding.push(v);
    }
  }

  if (staleKeys.length > 0) {
    await db
      .delete(placeCache)
      .where(
        or(
          ...staleKeys.map((k) =>
            and(eq(placeCache.latKey, k.latKey), eq(placeCache.lonKey, k.lonKey))
          )
        )
      );
  }

  // Parallel geocoding with concurrency cap (matches Kakao free-tier budget).
  const CONCURRENCY = 5;
  const geocodeRows: (typeof placeCache.$inferInsert)[] = [];
  for (let i = 0; i < needsGeocoding.length; i += CONCURRENCY) {
    const batch = needsGeocoding.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ idx, latKey, lonKey }) => {
        const visit = detectedVisits[idx];
        try {
          const adapter = getGeocodingAdapter(visit.centerLat, visit.centerLon);
          const result = await adapter.reverseGeocode(visit.centerLat, visit.centerLon);
          if (result) {
            visitEnrichments.set(idx, {
              placeName: result.placeName,
              address: result.address,
              category: result.category ?? null,
              region: result.region,
              country: result.country,
            });
            geocodeRows.push({
              latKey,
              lonKey,
              placeName: result.placeName,
              address: result.address,
              category: result.category ?? null,
              provider: result.provider,
              region: result.region,
              country: result.country,
              resolvedAt: now,
            });
          }
        } catch (e) {
          console.error("Geocoding error:", e);
        }
      })
    );
  }

  if (geocodeRows.length > 0) {
    await db.insert(placeCache).values(geocodeRows).onConflictDoNothing();
  }

  // 4d. Layer saved-place name overrides on top of the region/country lookup
  // result. Applied last (and independent of whether the lookup produced a
  // hit) so a saved place still gets its name/category/id even if geocoding
  // failed for its coordinate — region/country simply stay null in that case.
  for (const [idx, override] of savedPlaceOverrides) {
    const base = visitEnrichments.get(idx) ?? {
      placeName: null,
      address: null,
      category: null,
      region: null,
      country: null,
    };
    visitEnrichments.set(idx, {
      ...base,
      placeName: override.placeName,
      address: override.address,
      category: override.category,
      savedPlaceId: override.savedPlaceId,
    });
  }

  const enrichedVisits: EnrichedVisit[] = [];
  const visitRows: (typeof visits.$inferInsert)[] = [];

  for (let idx = 0; idx < detectedVisits.length; idx++) {
    const visit = detectedVisits[idx];
    const e = visitEnrichments.get(idx) ?? {
      placeName: null,
      address: null,
      category: null,
      region: null,
      country: null,
    };
    const { placeName, address, category, region, country, savedPlaceId } = e;
    const city = region;
    const countryName = country;

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

  // 5. Persist: delete + insert in a transaction to avoid partial state
  await db.transaction(async (tx) => {
    await tx
      .delete(visits)
      .where(
        and(
          eq(visits.userId, userId),
          gte(visits.startTime, dayStart),
          lt(visits.startTime, dayEnd)
        )
      );
    if (visitRows.length > 0) {
      await tx.insert(visits).values(visitRows);
    }
  });

  return enrichedVisits;
}

async function deleteVisitsInWindow(userId: string, dayStart: Date, dayEnd: Date): Promise<void> {
  const db = getDb();
  await db
    .delete(visits)
    .where(
      and(eq(visits.userId, userId), gte(visits.startTime, dayStart), lt(visits.startTime, dayEnd))
    );
}
