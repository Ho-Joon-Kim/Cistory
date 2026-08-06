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

import { and, asc, eq, gt, gte, lt } from "drizzle-orm";
import { getDb, savedPlaces, tracks, visits } from "@/db";
import { isInKorea } from "@/lib/adapters/geocoding";
import { shiftDateKey } from "@/lib/date-key";
import { distanceM } from "@/lib/geo";
import { resolveTripHomeLocation, TRIP_HOME_DISTANCE_THRESHOLD_M } from "./trip-home";
import { createTripName } from "./trip-naming";
import {
  createTripExclusionRevision,
  reconcileDetectedTrips,
  regenerateDetectedTrips,
  StaleTripDetectionError,
} from "./trip-writer";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TRIP_EXCLUSION_RADIUS_M = 10_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
// Earliest visit in the data. Exported so callers building a full-history
// range (e.g. scripts/detect-trips.ts) can default `from` to it directly —
// starting any earlier loses nothing and only makes isValidTripDateRange
// reject the request.
export const TRIP_DATA_HORIZON = "2025-03-08";
const TRIP_DATE_RANGE_FUTURE_HEADROOM_DAYS = 366;

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
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string | null;
  excludeFromTrips: boolean;
  tripExclusionRadiusM: number | null;
  updatedAt: Date;
}

async function getSavedPlaceLocations(userId: string): Promise<SavedPlaceLocation[]> {
  const db = getDb();
  return db
    .select({
      id: savedPlaces.id,
      name: savedPlaces.name,
      lat: savedPlaces.lat,
      lon: savedPlaces.lon,
      category: savedPlaces.category,
      excludeFromTrips: savedPlaces.excludeFromTrips,
      tripExclusionRadiusM: savedPlaces.tripExclusionRadiusM,
      updatedAt: savedPlaces.updatedAt,
    })
    .from(savedPlaces)
    .where(eq(savedPlaces.userId, userId));
}

// ── Trip Detection ───────────────────────────────────────────────────────────

export async function detectTrips(
  userId: string,
  from: string,
  to: string
): Promise<DetectedTrip[]> {
  return (await detectTripsSnapshot(userId, from, to)).trips;
}

export interface TripDetectionSnapshot {
  trips: DetectedTrip[];
  exclusionRevision: string;
}

export async function detectTripsSnapshot(
  userId: string,
  from: string,
  to: string
): Promise<TripDetectionSnapshot> {
  // The exclusion revision is computed unconditionally, before the range is
  // even validated. Both real callers (detectAndPersistTrips, regenerateTrips)
  // now validate the range up front and never reach this function with a bad
  // one — but this used to short-circuit with a fabricated exclusionRevision
  // of "[]" instead, which can never equal the real revision once the user has
  // any saved place. A caller that skipped validation would pass that
  // fabricated value into the optimistic-concurrency check in trip-writer.ts,
  // get a guaranteed StaleTripDetectionError, and retry three times against a
  // problem retrying can't fix. Computing the real revision here — the same
  // thing the "home can't be resolved" branch below already does — means any
  // future caller gets a value that's simply correct, never a trap.
  const placeLocations = await getSavedPlaceLocations(userId);
  const exclusionRevision = createTripExclusionRevision(placeLocations);
  if (!isValidTripDateRange(from, to)) return { trips: [], exclusionRevision };

  const home = await resolveTripHomeLocation(userId, placeLocations);
  if (!home) return { trips: [], exclusionRevision }; // Can't determine home → can't detect trips

  const excludedPlaces = placeLocations.filter((place) => place.excludeFromTrips);
  const visitsByDate = groupVisitsByDate(await getVisitsInRange(userId, from, to));

  const classifiedDays = calendarDates(from, to).map((date) =>
    classifyDay(date, visitsByDate.get(date) ?? [], home, excludedPlaces)
  );
  const groups = groupCandidateDays(classifiedDays);
  if (groups.length === 0) return { trips: [], exclusionRevision };

  const tripTracks = await getTracksInRange(userId, from, to);
  return {
    trips: groups.map((group) => toDetectedTrip(group, tripTracks)),
    exclusionRevision,
  };
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
        lt(visits.startTime, parseKstDateStart(shiftDateKey(to, 1)))
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
  const rangeEnd = parseKstDateStart(shiftDateKey(to, 1));
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
  const rangeEnd = parseKstDateStart(shiftDateKey(endDate, 1));
  const overlappingTracks = allTracks.filter(
    (track) => track.startTime < rangeEnd && track.endTime > rangeStart
  );
  if (overlappingTracks.length === 0) return null;
  return overlappingTracks.reduce((sum, track) => sum + track.distanceMeters, 0);
}

function classifyDay(
  date: string,
  dayVisits: VisitRow[],
  home: { lat: number; lon: number },
  excludedPlaces: SavedPlaceLocation[]
): ClassifiedDay {
  if (dayVisits.length === 0) return { date, kind: "unknown", destinationVisits: [] };

  const farVisits = dayVisits.filter(
    (visit) =>
      distanceM(home.lat, home.lon, visit.centerLat, visit.centerLon) >
      TRIP_HOME_DISTANCE_THRESHOLD_M
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

export async function persistTrips(
  userId: string,
  detectedTrips: DetectedTrip[],
  expectedExclusionRevision?: string
): Promise<number> {
  const result = await reconcileDetectedTrips(userId, detectedTrips, {
    expectedExclusionRevision,
  });
  return result.inserted;
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
  to: string,
  options: { watermarkThrough?: string } = {}
): Promise<{ detected: number; inserted: number; replaced: number; skipped: number }> {
  // Mirrors regenerateTrips' up-front check. Without this, an invalid range
  // fell through to detectTripsSnapshot's early return, which used to hand
  // back a fabricated exclusionRevision that could never match — surfacing as
  // StaleTripDetectionError after three retries instead of the real problem.
  if (!isValidTripDateRange(from, to)) {
    throw new Error("유효하지 않은 여행 감지 날짜 범위입니다");
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await detectTripsSnapshot(userId, from, to);
    try {
      const result = await reconcileDetectedTrips(userId, snapshot.trips, {
        ...options,
        expectedExclusionRevision: snapshot.exclusionRevision,
      });
      return { detected: snapshot.trips.length, ...result };
    } catch (error) {
      if (!(error instanceof StaleTripDetectionError) || attempt === 2) throw error;
    }
  }
  throw new Error("여행 후보를 최신 제외 설정으로 계산하지 못했습니다");
}

export async function regenerateTrips(
  userId: string,
  from: string,
  to: string
): Promise<{ detected: number; inserted: number; replaced: number; skipped: number }> {
  if (!isValidTripDateRange(from, to)) {
    throw new Error("유효하지 않은 여행 재생성 날짜 범위입니다");
  }
  // Detection and validation finish before the transaction begins. Existing
  // rows are untouched if candidate calculation fails.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await detectTripsSnapshot(userId, from, to);
    try {
      const result = await regenerateDetectedTrips(userId, snapshot.trips, {
        database: getDb(),
        expectedExclusionRevision: snapshot.exclusionRevision,
      });
      return { detected: snapshot.trips.length, ...result };
    } catch (error) {
      if (!(error instanceof StaleTripDetectionError) || attempt === 2) throw error;
    }
  }
  throw new Error("여행 후보를 최신 제외 설정으로 계산하지 못했습니다");
}

function parseKstDateStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+09:00`);
}

function toKstDateString(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function calendarDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let current = from; current <= to; current = shiftDateKey(current, 1)) {
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

export function isValidTripDateRange(from: string, to: string): boolean {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(from) || !datePattern.test(to) || from > to) return false;
  if (shiftDateKey(from, 0) !== from || shiftDateKey(to, 0) !== to) return false;

  // Keep calendar materialization bounded while allowing a complete rebuild from
  // the product's data horizon through today, plus one year of future headroom.
  const todayKst = toKstDateString(new Date());
  const productHistoryDays = Math.max(0, calendarDayDifference(TRIP_DATA_HORIZON, todayKst));
  return (
    calendarDayDifference(from, to) <= productHistoryDays + TRIP_DATE_RANGE_FUTURE_HEADROOM_DAYS
  );
}
