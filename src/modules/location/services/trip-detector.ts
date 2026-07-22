/**
 * Trip Auto-Detection Service
 *
 * Detects trips by classifying KST calendar days around a user's home.
 * Home = savedPlace with category or name "home"/"집", or most-visited location.
 *
 * Rules:
 * - Core day = every visit is > 100km from home
 * - Boundary day = at least one visit is > 100km from home
 * - Days spent only inside a trip-excluded place can bridge, but not bound, a trip
 * - Home and unobserved days always split trips
 * - Every trip must span at least one calendar night
 * - Name generated from coordinate-derived countries or allow-listed domestic regions
 */

import { and, asc, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { getDb, savedPlaces, tracks, trips, visits } from "@/db";
import { isInKorea } from "@/lib/adapters/geocoding";
import { distanceM } from "@/lib/geo";
import { createTripName } from "./trip-naming";

// ── Constants ────────────────────────────────────────────────────────────────

const HOME_DISTANCE_THRESHOLD_M = 100_000;
const DEFAULT_TRIP_EXCLUSION_RADIUS_M = 10_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

interface SavedPlaceLocation {
  name: string;
  lat: number;
  lon: number;
  category: string | null;
  excludeFromTrips: boolean;
  tripExclusionRadiusM: number | null;
}

interface Location {
  lat: number;
  lon: number;
}

async function getSavedPlaceLocations(userId: string): Promise<SavedPlaceLocation[]> {
  const db = getDb();
  return db
    .select({
      name: savedPlaces.name,
      lat: savedPlaces.lat,
      lon: savedPlaces.lon,
      category: savedPlaces.category,
      excludeFromTrips: savedPlaces.excludeFromTrips,
      tripExclusionRadiusM: savedPlaces.tripExclusionRadiusM,
    })
    .from(savedPlaces)
    .where(eq(savedPlaces.userId, userId));
}

async function getHomeLocation(
  userId: string,
  places: SavedPlaceLocation[]
): Promise<Location | null> {
  const db = getDb();

  const homePlace = places.find((place) => isHomeLabel(place.category) || isHomeLabel(place.name));

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

  if (topVisit && Number.isFinite(topVisit.lat) && Number.isFinite(topVisit.lon)) {
    return { lat: topVisit.lat, lon: topVisit.lon };
  }

  return null;
}

function isHomeLabel(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized === "home" || normalized === "집";
}

// ── Trip Detection ───────────────────────────────────────────────────────────

export async function detectTrips(
  userId: string,
  from: string,
  to: string
): Promise<DetectedTrip[]> {
  if (!isValidDateRange(from, to)) return [];

  const placeLocations = await getSavedPlaceLocations(userId);
  const home = await getHomeLocation(userId, placeLocations);
  if (!home) return []; // Can't determine home → can't detect trips

  const excludedPlaces = placeLocations.filter((place) => place.excludeFromTrips);
  const visitsByDate = groupVisitsByDate(await getVisitsInRange(userId, from, to));

  const classifiedDays = calendarDates(from, to).map((date) =>
    classifyDay(date, visitsByDate.get(date) ?? [], home, excludedPlaces)
  );
  const groups = groupCandidateDays(classifiedDays);
  if (groups.length === 0) return [];

  const tripTracks = await getTracksInRange(userId, from, to);
  return groups.map((group) => toDetectedTrip(group, tripTracks));
}

type VisitRow = {
  centerLat: number;
  centerLon: number;
  startTime: Date;
  city: string | null;
  countryName: string | null;
  durationSeconds: number;
};

type TrackRow = {
  startTime: Date;
  endTime: Date;
  distanceMeters: number;
};

type DayKind = "core" | "boundary" | "excluded" | "home" | "unknown";

interface ClassifiedDay {
  date: string;
  kind: DayKind;
  destinationVisits: VisitRow[];
}

async function getVisitsInRange(userId: string, from: string, to: string): Promise<VisitRow[]> {
  const db = getDb();
  return db
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
      and(
        eq(visits.userId, userId),
        gte(visits.startTime, parseKstDateStart(from)),
        lt(visits.startTime, parseKstDateStart(addCalendarDays(to, 1)))
      )
    )
    .orderBy(asc(visits.startTime));
}

function groupVisitsByDate(allVisits: VisitRow[]): Map<string, VisitRow[]> {
  const visitsByDate = new Map<string, VisitRow[]>();
  for (const visit of allVisits) {
    const date = toKstDateString(visit.startTime);
    const dayVisits = visitsByDate.get(date) ?? [];
    dayVisits.push(visit);
    visitsByDate.set(date, dayVisits);
  }
  return visitsByDate;
}

async function getTracksInRange(userId: string, from: string, to: string): Promise<TrackRow[]> {
  const rangeStart = parseKstDateStart(from);
  const rangeEnd = parseKstDateStart(addCalendarDays(to, 1));
  const db = getDb();
  return db
    .select({
      startTime: tracks.startTime,
      endTime: tracks.endTime,
      distanceMeters: tracks.distanceMeters,
    })
    .from(tracks)
    .where(
      and(eq(tracks.userId, userId), lt(tracks.startTime, rangeEnd), gt(tracks.endTime, rangeStart))
    )
    .orderBy(asc(tracks.startTime));
}

function toDetectedTrip(group: ClassifiedDay[], allTracks: TrackRow[]): DetectedTrip {
  const destinationVisits = group.flatMap((day) => day.destinationVisits);
  const visitedCities = uniqueStrings(destinationVisits.map((visit) => visit.city));
  const visitedCountries = uniqueStrings(destinationVisits.map((visit) => visit.countryName));
  const isOverseas = destinationVisits.some(
    (visit) => !isInKorea(visit.centerLat, visit.centerLon)
  );

  return {
    name: createTripName(destinationVisits),
    startDate: group[0].date,
    endDate: group[group.length - 1].date,
    visitedCities,
    visitedCountries,
    isOverseas,
    totalDistanceMeters: sumOverlappingTrackDistance(
      allTracks,
      group[0].date,
      group[group.length - 1].date
    ),
  };
}

function uniqueStrings(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function sumOverlappingTrackDistance(
  allTracks: TrackRow[],
  startDate: string,
  endDate: string
): number | null {
  const rangeStart = parseKstDateStart(startDate);
  const rangeEnd = parseKstDateStart(addCalendarDays(endDate, 1));
  const overlappingTracks = allTracks.filter(
    (track) => track.startTime < rangeEnd && track.endTime > rangeStart
  );
  if (overlappingTracks.length === 0) return null;
  return overlappingTracks.reduce((sum, track) => sum + track.distanceMeters, 0);
}

function classifyDay(
  date: string,
  dayVisits: VisitRow[],
  home: Location,
  excludedPlaces: SavedPlaceLocation[]
): ClassifiedDay {
  if (dayVisits.length === 0) return { date, kind: "unknown", destinationVisits: [] };

  const farVisits = dayVisits.filter(
    (visit) =>
      distanceM(home.lat, home.lon, visit.centerLat, visit.centerLon) > HOME_DISTANCE_THRESHOLD_M
  );
  if (farVisits.length === 0) return { date, kind: "home", destinationVisits: [] };

  const destinationVisits = farVisits.filter(
    (visit) => !isInsideExcludedPlace(visit, excludedPlaces)
  );
  if (destinationVisits.length === 0) return { date, kind: "excluded", destinationVisits: [] };

  return {
    date,
    kind: farVisits.length === dayVisits.length ? "core" : "boundary",
    destinationVisits,
  };
}

function isInsideExcludedPlace(
  visit: Pick<VisitRow, "centerLat" | "centerLon">,
  places: SavedPlaceLocation[]
): boolean {
  return places.some(
    (place) =>
      distanceM(place.lat, place.lon, visit.centerLat, visit.centerLon) <=
      (place.tripExclusionRadiusM ?? DEFAULT_TRIP_EXCLUSION_RADIUS_M)
  );
}

function groupCandidateDays(days: ClassifiedDay[]): ClassifiedDay[][] {
  const groups: ClassifiedDay[][] = [];
  let current: ClassifiedDay[] = [];

  const finishCurrent = () => {
    while (current[0]?.kind === "excluded") current.shift();
    while (current.at(-1)?.kind === "excluded") current.pop();

    if (
      current.some((day) => day.kind === "core") &&
      current.length > 0 &&
      calendarDayDifference(current[0].date, current[current.length - 1].date) >= 1
    ) {
      groups.push(current);
    }
    current = [];
  };

  for (const day of days) {
    if (day.kind === "home" || day.kind === "unknown") {
      finishCurrent();
    } else {
      current.push(day);
    }
  }
  finishCurrent();

  return groups;
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

// ── Idempotent Detect + Persist ──────────────────────────────────────────────

/**
 * Detect trips over [from, to] and persist only those that don't overlap an
 * existing trip. Idempotent — safe to re-run over a rolling window (e.g. from a
 * weekly cron) or to backfill the full history more than once.
 *
 * Overlap is decided purely on date ranges; since dates are "YYYY-MM-DD" strings
 * they compare lexicographically, so the standard interval-overlap test works
 * directly without parsing.
 */
export async function detectAndPersistTrips(
  userId: string,
  from: string,
  to: string
): Promise<{ detected: number; inserted: number; skipped: number }> {
  const detected = await detectTrips(userId, from, to);
  if (detected.length === 0) return { detected: 0, inserted: 0, skipped: 0 };

  const db = getDb();
  const existing = await db
    .select({ startDate: trips.startDate, endDate: trips.endDate })
    .from(trips)
    .where(eq(trips.userId, userId));

  // A detected trip is new only if its date range overlaps no existing trip.
  const fresh = detected.filter(
    (t) => !existing.some((e) => t.startDate <= e.endDate && e.startDate <= t.endDate)
  );

  const inserted = await persistTrips(userId, fresh);
  return { detected: detected.length, inserted, skipped: detected.length - inserted };
}

function parseKstDateStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+09:00`);
}

function toKstDateString(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function addCalendarDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function calendarDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let current = from; current <= to; current = addCalendarDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

function calendarDayDifference(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return (
    (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000
  );
}

function isValidDateRange(from: string, to: string): boolean {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(from) || !datePattern.test(to) || from > to) return false;
  return addCalendarDays(from, 0) === from && addCalendarDays(to, 0) === to;
}
