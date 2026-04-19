/**
 * Trip Auto-Detection Service
 *
 * Detects trips by finding consecutive days away from home.
 * Home = savedPlace with category "home"/"집", or most-visited location.
 *
 * Rules:
 * - Away = all visits on a day are > 50km from home
 * - Consecutive away days (1-day gap allowed) form a trip
 * - Domestic: must be 2+ days (1+ nights)
 * - Overseas: any duration qualifies
 * - Name auto-generated from primary city/country
 */

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, savedPlaces, trips, visits } from "@/db";
import { isInKorea } from "@/lib/adapters/geocoding";
import { distanceM } from "@/lib/geo";

// ── Constants ────────────────────────────────────────────────────────────────

const HOME_DISTANCE_THRESHOLD_M = 50_000; // 50km — away threshold
const MAX_GAP_DAYS = 1; // allow 1-day gap between away days
const MIN_DOMESTIC_DAYS = 2; // domestic trip: at least 2 days

// ── Types ────────────────────────────────────────────────────────────────────

export interface DetectedTrip {
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  visitedCities: string[];
  visitedCountries: string[];
  isOverseas: boolean;
  totalDistanceMeters: number | null;
}

// ── Home Location Resolution ─────────────────────────────────────────────────

async function getHomeLocation(userId: string): Promise<{ lat: number; lon: number } | null> {
  const db = getDb();

  // 1. Check savedPlaces for "home" or "집" category
  const [homePlace] = await db
    .select({ lat: savedPlaces.lat, lon: savedPlaces.lon })
    .from(savedPlaces)
    .where(
      and(eq(savedPlaces.userId, userId), sql`lower(${savedPlaces.category}) IN ('home', '집')`)
    )
    .limit(1);

  if (homePlace) return { lat: homePlace.lat, lon: homePlace.lon };

  // 2. Fallback: most-visited location in last 90 days by total duration
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [topVisit] = await db
    .select({
      lat: visits.centerLat,
      lon: visits.centerLon,
      totalDuration: sql<number>`sum(${visits.durationSeconds})`,
    })
    .from(visits)
    .where(and(eq(visits.userId, userId), gte(visits.startTime, ninetyDaysAgo)))
    .groupBy(
      sql`round(${visits.centerLat}::numeric, 3)`,
      sql`round(${visits.centerLon}::numeric, 3)`,
      visits.centerLat,
      visits.centerLon
    )
    .orderBy(desc(sql`sum(${visits.durationSeconds})`))
    .limit(1);

  if (topVisit) return { lat: topVisit.lat, lon: topVisit.lon };

  return null;
}

// ── Trip Detection ───────────────────────────────────────────────────────────

export async function detectTrips(
  userId: string,
  from: string,
  to: string
): Promise<DetectedTrip[]> {
  const home = await getHomeLocation(userId);
  if (!home) return []; // Can't determine home → can't detect trips

  const db = getDb();
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);
  toDate.setDate(toDate.getDate() + 1); // exclusive end

  // Fetch all visits in range with city/country
  const allVisits = await db
    .select({
      centerLat: visits.centerLat,
      centerLon: visits.centerLon,
      startTime: visits.startTime,
      city: visits.city,
      countryName: visits.countryName,
      durationSeconds: visits.durationSeconds,
    })
    .from(visits)
    .where(
      and(eq(visits.userId, userId), gte(visits.startTime, fromDate), lt(visits.startTime, toDate))
    )
    .orderBy(asc(visits.startTime));

  // Group visits by date
  const dateVisits = new Map<
    string,
    {
      cities: Set<string>;
      countries: Set<string>;
      allAway: boolean;
      isOverseas: boolean;
    }
  >();

  for (const v of allVisits) {
    const dateStr = v.startTime.toISOString().slice(0, 10);

    if (!dateVisits.has(dateStr)) {
      dateVisits.set(dateStr, {
        cities: new Set(),
        countries: new Set(),
        allAway: true,
        isOverseas: false,
      });
    }

    const day = dateVisits.get(dateStr)!;

    const dist = distanceM(home.lat, home.lon, v.centerLat, v.centerLon);
    if (dist < HOME_DISTANCE_THRESHOLD_M) {
      day.allAway = false;
    }

    if (v.city) day.cities.add(v.city);
    if (v.countryName) day.countries.add(v.countryName);

    if (!isInKorea(v.centerLat, v.centerLon)) {
      day.isOverseas = true;
    }
  }

  // Find consecutive away days
  const awayDates = [...dateVisits.entries()]
    .filter(([, d]) => d.allAway)
    .sort(([a], [b]) => a.localeCompare(b));

  if (awayDates.length === 0) return [];

  // Group into trips (allow MAX_GAP_DAYS gap)
  const tripGroups: (typeof awayDates)[] = [];
  let currentGroup = [awayDates[0]];

  for (let i = 1; i < awayDates.length; i++) {
    const prevDate = parseLocalDate(currentGroup[currentGroup.length - 1][0]);
    const currDate = parseLocalDate(awayDates[i][0]);
    const gapDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

    if (gapDays <= MAX_GAP_DAYS + 1) {
      currentGroup.push(awayDates[i]);
    } else {
      tripGroups.push(currentGroup);
      currentGroup = [awayDates[i]];
    }
  }
  tripGroups.push(currentGroup);

  // Build detected trips
  const detectedTrips: DetectedTrip[] = [];

  for (const group of tripGroups) {
    const startDate = group[0][0];
    const endDate = group[group.length - 1][0];
    const dayCount = group.length;

    const allCities = new Set<string>();
    const allCountries = new Set<string>();
    let isOverseas = false;

    for (const [, dayData] of group) {
      for (const c of dayData.cities) allCities.add(c);
      for (const c of dayData.countries) allCountries.add(c);
      if (dayData.isOverseas) isOverseas = true;
    }

    // Filter: domestic trips need 2+ days, overseas any duration
    if (!isOverseas && dayCount < MIN_DOMESTIC_DAYS) continue;

    // Auto-generate name
    const primaryCity = [...allCities][0];
    const primaryCountry = [...allCountries][0];
    let name: string;
    if (isOverseas && primaryCountry) {
      name = primaryCity ? `${primaryCity} 여행` : `${primaryCountry} 여행`;
    } else {
      name = primaryCity ? `${primaryCity} 방문` : "여행";
    }

    detectedTrips.push({
      name,
      startDate,
      endDate,
      visitedCities: [...allCities],
      visitedCountries: [...allCountries],
      isOverseas,
      totalDistanceMeters: null, // can be enriched later from dailyDistances
    });
  }

  return detectedTrips;
}

// ── Trip Persistence ─────────────────────────────────────────────────────────

export async function persistTrips(userId: string, detectedTrips: DetectedTrip[]): Promise<number> {
  if (detectedTrips.length === 0) return 0;

  const db = getDb();
  const now = new Date();

  await db.insert(trips).values(
    detectedTrips.map((t) => ({
      userId,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      totalDistanceMeters: t.totalDistanceMeters,
      visitedCities: JSON.stringify(t.visitedCities),
      visitedCountries: JSON.stringify(t.visitedCountries),
      isOverseas: t.isOverseas,
      autoDetected: true,
      createdAt: now,
      updatedAt: now,
    }))
  );

  return detectedTrips.length;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}
