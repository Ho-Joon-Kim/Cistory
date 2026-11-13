/**
 * Personal travel time between two places, from the owner's own recorded
 * journeys — never an estimate.
 *
 * A `tracks` row has no endpoint coordinates of its own, so each track's
 * endpoints come from the persisted visits next to it:
 *  - origin      = the visit whose `end_time` is nearest `track.start_time`
 *                  within ±ADJACENT_VISIT_TOLERANCE_SEC
 *  - destination = the visit whose `start_time` is nearest `track.end_time`
 *                  within the same tolerance
 * A track missing either neighbour is excluded (counted, not guessed).
 *
 * A journey matches when its origin visit lies within the radius of the
 * requested origin and its destination visit within the radius of the
 * requested destination (or the visit is pinned to the requested saved
 * place). A journey whose track has any `subway_trip_matches` leg is grouped
 * as `subway` whatever its `tracks.dominant_mode` — the walks to and from the
 * stations often outlast the ride, so a subway commute is frequently
 * dominant-mode walking. Every other journey is grouped by
 * `tracks.dominant_mode`. Per mode we report count, median and p80 (linear
 * interpolation, R-7), and the subway lines the group rode. Under
 * MIN_SAMPLES a mode only lists its raw durations. A mode with zero matches
 * is "기록 없음".
 *
 * Bounded work: one range scan of `tracks` on idx_track_user_start and one of
 * `visits` on idx_visit_user_start over at most TRAVEL_TIME_LOOKBACK_DAYS,
 * then in-memory matching. Timestamps are read through the query builder, so
 * the UTC-wall-time columns come back as correct instants; the KST hour
 * window is applied to those instants in memory.
 */

import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  type Database,
  getDb,
  locationProcessingDays,
  savedPlaces,
  subwayLines,
  subwayTripMatches,
  tracks,
  transportationSegments,
  visits,
} from "@/db";
import { distanceM } from "@/lib/geo";

/**
 * Temporary until scripts/calibrate-travel-time-radius.ts has been run on real
 * data (plan U8: "결정 전 임시값은 반경 300m, 최소 표본 3건").
 */
export const TRAVEL_TIME_RADIUS_M = 300;
export const TRAVEL_TIME_MIN_RADIUS_M = 50;
export const TRAVEL_TIME_MAX_RADIUS_M = 2_000;
/** Below this many journeys a mode lists raw durations only (temporary, see above). */
export const TRAVEL_TIME_MIN_SAMPLES = 3;
export const TRAVEL_TIME_LOOKBACK_DAYS = 365;
/**
 * How far a visit's end/start may sit from the track's start/end and still
 * count as adjacent. Tracks come from stay-detector (60 m / 450 s) while
 * visits come from visit-detector (dynamic radius, 180 s), so the two
 * boundaries differ by a few minutes; the calibration script prints the gap
 * distribution.
 */
export const ADJACENT_VISIT_TOLERANCE_SEC = 900;
/** Hard cap on scanned tracks (≈ 27/day for a year). */
export const TRAVEL_TIME_MAX_TRACKS = 10_000;
/** Visits that start this long before the window can still be a first track's origin. */
const VISIT_LOOKBACK_MARGIN_MS = 2 * 86_400_000;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** Modes always reported, so "no walking records" is explicit (AE4). */
export const TRAVEL_TIME_BASE_MODES = [
  "walking",
  "cycling",
  "driving",
  "bus",
  "subway",
  "train",
] as const;

/** Group for journeys whose track matched a subway line (see the header). */
export const SUBWAY_MODE = "subway";

export const TRAVEL_MODE_LABELS: Record<string, string> = {
  walking: "도보",
  running: "달리기",
  cycling: "자전거",
  driving: "자동차",
  motorcycle: "오토바이",
  bus: "버스",
  subway: "지하철",
  // A train-mode track with no subway match: a train, or a subway ride the
  // matcher couldn't place (no line data for that city, too few points).
  train: "지하철·기차",
  boat: "배",
  flying: "비행기",
  stationary: "정지",
  unknown: "미분류",
};

export const NO_RECORDS_MESSAGE = "기록 없음";

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Quantile of an ascending array, linear interpolation (Hyndman–Fan type 7, R's default). */
export function quantileR7(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export interface HourWindow {
  /** 0–23, inclusive. */
  fromHour: number;
  /** 1–24, exclusive. A window with fromHour > toHour wraps past midnight (22–3). */
  toHour: number;
}

export function isInHourWindow(hour: number, window: HourWindow): boolean {
  const { fromHour, toHour } = window;
  if (fromHour < toHour) return hour >= fromHour && hour < toHour;
  return hour >= fromHour || hour < toHour;
}

/** KST hour-of-day (0–23) of an instant, independent of the process TZ. */
export function kstHour(date: Date): number {
  return new Date(date.getTime() + KST_OFFSET_MS).getUTCHours();
}

export interface TrackRow {
  id: string;
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  dominantMode: string | null;
}

export interface VisitRow {
  centerLat: number;
  centerLon: number;
  startTime: Date;
  endTime: Date;
  savedPlaceId: string | null;
}

export interface Journey {
  trackId: string;
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  mode: string;
  origin: VisitRow;
  destination: VisitRow;
}

/** Index of the item whose `key` is nearest `target` within `tol` ms, or -1. Expects ascending keys. */
function nearestWithin(keys: readonly number[], target: number, tol: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < target - tol) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = lo; i < keys.length && keys[i] <= target + tol; i++) {
    const dist = Math.abs(keys[i] - target);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Attach adjacent visits to each track. Tracks without a visit on either side
 * are returned in `unmatched` rather than guessed.
 */
export function deriveJourneys(
  trackRows: readonly TrackRow[],
  visitRows: readonly VisitRow[],
  toleranceSec: number = ADJACENT_VISIT_TOLERANCE_SEC
): { journeys: Journey[]; unmatched: number } {
  const tol = toleranceSec * 1000;
  const byEnd = [...visitRows].sort((a, b) => a.endTime.getTime() - b.endTime.getTime());
  const byStart = [...visitRows].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const endKeys = byEnd.map((v) => v.endTime.getTime());
  const startKeys = byStart.map((v) => v.startTime.getTime());

  const journeys: Journey[] = [];
  let unmatched = 0;
  for (const track of trackRows) {
    const oi = nearestWithin(endKeys, track.startTime.getTime(), tol);
    const di = nearestWithin(startKeys, track.endTime.getTime(), tol);
    if (oi < 0 || di < 0 || byEnd[oi] === byStart[di]) {
      unmatched++;
      continue;
    }
    journeys.push({
      trackId: track.id,
      startTime: track.startTime,
      endTime: track.endTime,
      durationSeconds: track.durationSeconds,
      mode: track.dominantMode ?? "unknown",
      origin: byEnd[oi],
      destination: byStart[di],
    });
  }
  return { journeys, unmatched };
}

export interface ResolvedEndpoint {
  lat: number;
  lon: number;
  radiusM: number;
  savedPlaceId: string | null;
  name: string | null;
}

export function visitMatchesEndpoint(visit: VisitRow, endpoint: ResolvedEndpoint): boolean {
  if (endpoint.savedPlaceId && visit.savedPlaceId === endpoint.savedPlaceId) return true;
  return (
    distanceM(visit.centerLat, visit.centerLon, endpoint.lat, endpoint.lon) <= endpoint.radiusM
  );
}

export interface SubwayLineUse {
  lineId: string;
  ref: string | null;
  name: string | null;
  /** Journeys in the group that rode this line. */
  journeys: number;
}

export interface ModeTravelTime {
  mode: string;
  label: string;
  count: number;
  status: "ok" | "few_samples" | "no_records";
  message: string | null;
  medianMinutes: number | null;
  p80Minutes: number | null;
  minMinutes: number | null;
  maxMinutes: number | null;
  /** Only when count < min samples: each journey's minutes, newest first. */
  durationsMinutes: number[] | null;
  /** Newest matching departure. */
  latestDepartureAt: Date | null;
  mainLines: SubwayLineUse[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

type LinesByTrack = ReadonlyMap<string, readonly Omit<SubwayLineUse, "journeys">[]>;

function noRecords(mode: string): ModeTravelTime {
  return {
    mode,
    label: TRAVEL_MODE_LABELS[mode] ?? mode,
    count: 0,
    status: "no_records",
    message: NO_RECORDS_MESSAGE,
    medianMinutes: null,
    p80Minutes: null,
    minMinutes: null,
    maxMinutes: null,
    durationsMinutes: null,
    latestDepartureAt: null,
    mainLines: [],
  };
}

/** Lines ridden by the group, each counted once per journey, top 3. */
function mainLinesOf(list: readonly Journey[], linesByTrack?: LinesByTrack): SubwayLineUse[] {
  const lineCounts = new Map<string, SubwayLineUse>();
  for (const j of list) {
    const seen = new Set<string>();
    for (const line of linesByTrack?.get(j.trackId) ?? []) {
      if (seen.has(line.lineId)) continue;
      seen.add(line.lineId);
      const entry = lineCounts.get(line.lineId) ?? { ...line, journeys: 0 };
      entry.journeys++;
      lineCounts.set(line.lineId, entry);
    }
  }
  return [...lineCounts.values()]
    .sort((a, b) => b.journeys - a.journeys || (a.ref ?? "").localeCompare(b.ref ?? ""))
    .slice(0, 3);
}

function modeStats(
  mode: string,
  list: readonly Journey[],
  minSamples: number,
  linesByTrack?: LinesByTrack
): ModeTravelTime {
  if (list.length === 0) return noRecords(mode);
  const newestFirst = [...list].sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  const minutes = list.map((j) => j.durationSeconds / 60).sort((a, b) => a - b);
  const base = {
    mode,
    label: TRAVEL_MODE_LABELS[mode] ?? mode,
    count: list.length,
    latestDepartureAt: newestFirst[0].startTime,
    mainLines: mainLinesOf(list, linesByTrack),
  };
  if (list.length < minSamples) {
    return {
      ...base,
      status: "few_samples",
      message: `기록이 ${list.length}건뿐이라 통계 대신 개별 소요시간만 보여줍니다.`,
      medianMinutes: null,
      p80Minutes: null,
      minMinutes: null,
      maxMinutes: null,
      durationsMinutes: newestFirst.map((j) => round1(j.durationSeconds / 60)),
    };
  }
  return {
    ...base,
    status: "ok",
    message: null,
    medianMinutes: round1(quantileR7(minutes, 0.5) ?? 0),
    p80Minutes: round1(quantileR7(minutes, 0.8) ?? 0),
    minMinutes: round1(minutes[0]),
    maxMinutes: round1(minutes[minutes.length - 1]),
    durationsMinutes: null,
  };
}

/** The group a journey is counted under: `subway` when its track rode a matched line. */
export function journeyGroupMode(journey: Journey, linesByTrack?: LinesByTrack): string {
  return (linesByTrack?.get(journey.trackId)?.length ?? 0) > 0 ? SUBWAY_MODE : journey.mode;
}

/**
 * Per-mode statistics. `linesByTrack` maps a track id to the subway lines its
 * segments matched; such a journey counts under `subway` regardless of its
 * dominant mode. Base modes with no journey are listed as "기록 없음".
 */
export function summarizeByMode(
  journeys: readonly Journey[],
  options: { minSamples?: number; linesByTrack?: LinesByTrack; baseModes?: readonly string[] } = {}
): ModeTravelTime[] {
  const groups = new Map<string, Journey[]>();
  for (const mode of options.baseModes ?? TRAVEL_TIME_BASE_MODES) groups.set(mode, []);
  for (const j of journeys) {
    const mode = journeyGroupMode(j, options.linesByTrack);
    const list = groups.get(mode);
    if (list) list.push(j);
    else groups.set(mode, [j]);
  }

  const result = [...groups].map(([mode, list]) =>
    modeStats(mode, list, options.minSamples ?? TRAVEL_TIME_MIN_SAMPLES, options.linesByTrack)
  );
  // Modes with records first (most journeys first), then "기록 없음" in base order.
  return result.sort((a, b) => {
    if ((a.count === 0) !== (b.count === 0)) return a.count === 0 ? 1 : -1;
    return b.count - a.count;
  });
}

// ── DB ───────────────────────────────────────────────────────────────────────

export type EndpointInput =
  | { kind: "coordinates"; lat: number; lon: number }
  | { kind: "saved_place"; savedPlaceId: string };

export class TravelTimeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TravelTimeInputError";
  }
}

export async function resolveEndpoint(
  userId: string,
  input: EndpointInput,
  radiusM: number,
  database: Database = getDb()
): Promise<ResolvedEndpoint> {
  if (input.kind === "coordinates") {
    return { lat: input.lat, lon: input.lon, radiusM, savedPlaceId: null, name: null };
  }
  const [place] = await database
    .select({
      id: savedPlaces.id,
      name: savedPlaces.name,
      lat: savedPlaces.lat,
      lon: savedPlaces.lon,
      radiusM: savedPlaces.radiusM,
    })
    .from(savedPlaces)
    .where(and(eq(savedPlaces.id, input.savedPlaceId), eq(savedPlaces.userId, userId)))
    .limit(1);
  if (!place) throw new TravelTimeInputError("저장 장소를 찾을 수 없습니다.");
  return {
    lat: place.lat,
    lon: place.lon,
    radiusM: Math.max(radiusM, place.radiusM),
    savedPlaceId: place.id,
    name: place.name,
  };
}

/** Last KST day the location pipeline completed, or null. */
export async function getLocationDataThrough(
  userId: string,
  database: Database = getDb()
): Promise<string | null> {
  const [row] = await database
    .select({ date: locationProcessingDays.date })
    .from(locationProcessingDays)
    .where(
      and(eq(locationProcessingDays.userId, userId), eq(locationProcessingDays.status, "completed"))
    )
    .orderBy(desc(locationProcessingDays.date))
    .limit(1);
  return row?.date ?? null;
}

/** Tracks starting in [since, until) and visits around them — two bounded index range scans. */
export async function loadTracksAndVisits(
  userId: string,
  since: Date,
  until: Date,
  database: Database = getDb()
): Promise<{ trackRows: TrackRow[]; visitRows: VisitRow[]; truncated: boolean }> {
  const trackRows = await database
    .select({
      id: tracks.id,
      startTime: tracks.startTime,
      endTime: tracks.endTime,
      durationSeconds: tracks.durationSeconds,
      dominantMode: tracks.dominantMode,
    })
    .from(tracks)
    .where(
      and(eq(tracks.userId, userId), gte(tracks.startTime, since), lt(tracks.startTime, until))
    )
    .orderBy(desc(tracks.startTime))
    .limit(TRAVEL_TIME_MAX_TRACKS + 1);
  const truncated = trackRows.length > TRAVEL_TIME_MAX_TRACKS;
  if (truncated) trackRows.length = TRAVEL_TIME_MAX_TRACKS;

  const visitRows = await database
    .select({
      centerLat: visits.centerLat,
      centerLon: visits.centerLon,
      startTime: visits.startTime,
      endTime: visits.endTime,
      savedPlaceId: visits.savedPlaceId,
    })
    .from(visits)
    .where(
      and(
        eq(visits.userId, userId),
        gte(visits.startTime, new Date(since.getTime() - VISIT_LOOKBACK_MARGIN_MS)),
        lt(visits.startTime, new Date(until.getTime() + DAY_MS))
      )
    );
  return { trackRows, visitRows, truncated };
}

/** Subway lines matched on each track's segments. */
export async function loadSubwayLinesByTrack(
  userId: string,
  trackIds: readonly string[],
  database: Database = getDb()
): Promise<Map<string, Omit<SubwayLineUse, "journeys">[]>> {
  const out = new Map<string, Omit<SubwayLineUse, "journeys">[]>();
  const CHUNK = 1_000;
  for (let i = 0; i < trackIds.length; i += CHUNK) {
    const chunk = trackIds.slice(i, i + CHUNK);
    const rows = await database
      .select({
        trackId: transportationSegments.trackId,
        lineId: subwayLines.id,
        ref: subwayLines.ref,
        name: subwayLines.name,
      })
      .from(subwayTripMatches)
      .innerJoin(
        transportationSegments,
        eq(transportationSegments.id, subwayTripMatches.transportationSegmentId)
      )
      .innerJoin(subwayLines, eq(subwayLines.id, subwayTripMatches.lineId))
      .where(
        and(
          eq(subwayTripMatches.userId, userId),
          eq(transportationSegments.userId, userId),
          inArray(transportationSegments.trackId, chunk)
        )
      );
    for (const row of rows) {
      if (!row.trackId) continue;
      const list = out.get(row.trackId) ?? [];
      list.push({ lineId: row.lineId, ref: row.ref, name: row.name });
      out.set(row.trackId, list);
    }
  }
  return out;
}

export interface TravelTimeQuery {
  origin: EndpointInput;
  destination: EndpointInput;
  /** Defaults to TRAVEL_TIME_RADIUS_M; clamped to [MIN, MAX]. */
  radiusM?: number;
  /** KST departure-hour window. */
  hours?: HourWindow | null;
  /** Defaults to TRAVEL_TIME_LOOKBACK_DAYS; at most that. */
  lookbackDays?: number;
  now?: Date;
}

export interface TravelTimeResult {
  status: "ok" | "no_records";
  message: string | null;
  origin: ResolvedEndpoint;
  destination: ResolvedEndpoint;
  since: Date;
  until: Date;
  hours: HourWindow | null;
  /** Last KST day the location pipeline completed (journeys after it aren't recorded yet). */
  dataThrough: string | null;
  totalJourneys: number;
  modes: ModeTravelTime[];
  scannedTracks: number;
  /** Tracks dropped because a visit was missing on either side. */
  tracksWithoutAdjacentVisits: number;
  truncated: boolean;
}

export async function computeTravelTimes(
  userId: string,
  query: TravelTimeQuery,
  database: Database = getDb()
): Promise<TravelTimeResult> {
  const now = query.now ?? new Date();
  const radius = Math.min(
    TRAVEL_TIME_MAX_RADIUS_M,
    Math.max(TRAVEL_TIME_MIN_RADIUS_M, query.radiusM ?? TRAVEL_TIME_RADIUS_M)
  );
  const lookbackDays = Math.min(
    TRAVEL_TIME_LOOKBACK_DAYS,
    Math.max(1, Math.floor(query.lookbackDays ?? TRAVEL_TIME_LOOKBACK_DAYS))
  );
  const origin = await resolveEndpoint(userId, query.origin, radius, database);
  const destination = await resolveEndpoint(userId, query.destination, radius, database);
  const since = new Date(now.getTime() - lookbackDays * DAY_MS);

  const [{ trackRows, visitRows, truncated }, dataThrough] = await Promise.all([
    loadTracksAndVisits(userId, since, now, database),
    getLocationDataThrough(userId, database),
  ]);

  const { journeys, unmatched } = deriveJourneys(trackRows, visitRows);
  const hours = query.hours ?? null;
  const matched = journeys.filter(
    (j) =>
      visitMatchesEndpoint(j.origin, origin) &&
      visitMatchesEndpoint(j.destination, destination) &&
      (!hours || isInHourWindow(kstHour(j.startTime), hours))
  );

  const linesByTrack =
    matched.length > 0
      ? await loadSubwayLinesByTrack(
          userId,
          matched.map((j) => j.trackId),
          database
        )
      : new Map();

  return {
    status: matched.length > 0 ? "ok" : "no_records",
    message: matched.length > 0 ? null : NO_RECORDS_MESSAGE,
    origin,
    destination,
    since,
    until: now,
    hours,
    dataThrough,
    totalJourneys: matched.length,
    modes: summarizeByMode(matched, { linesByTrack }),
    scannedTracks: trackRows.length,
    tracksWithoutAdjacentVisits: unmatched,
    truncated,
  };
}
