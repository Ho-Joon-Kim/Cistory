/**
 * Read-only location queries shared by the web routes and the MCP tools.
 *
 * Every function takes the owner's `userId` and scopes each query to it. None
 * of them runs detection or writes anything — the daily pipeline (and the
 * dashboard's today-only stay-point detection) produces the rows read here.
 */

import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  type Database,
  getDb,
  locationPoints,
  subwayTripMatches,
  tracks,
  transportationSegments,
  visits,
} from "@/db";
import { distanceM } from "@/lib/geo";
import { resolveLineColor } from "@/lib/subway-color";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";
import type { EnrichedVisit } from "./services/visit-persister";

export interface TimeRange {
  /** Inclusive lower bound (instant). */
  start: Date;
  /** Exclusive upper bound (instant). */
  end: Date;
}

/** The KST (server-local) day window for a `YYYY-MM-DD` key. */
export function localDayRange(date: string): TimeRange {
  return { start: startOfLocalDay(date), end: endOfLocalDay(date) };
}

// ── Day points (dashboard map) ──────────────────────────────────────────────

const MAX_DAY_POINTS = 500;
const MIN_POINT_DISTANCE_M = 100;

export interface DayLocationPointOptions {
  /** Drop points with accuracy worse than 200m (default true). */
  accuracy?: boolean;
  /** Drop points within 100m of the previous accepted point (default true). */
  minDistance?: boolean;
  /** Uniformly sample down to 500 points, keeping the last (default true). */
  downsample?: boolean;
}

export interface DayLocationPoint {
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  velocity: number | null;
  battery: number | null;
  timestamp: string;
}

/** Non-anomalous points of one KST day, filtered for map display. */
export async function getDayLocationPoints(
  userId: string,
  date: string,
  options: DayLocationPointOptions = {},
  database: Database = getDb()
): Promise<DayLocationPoint[]> {
  const { accuracy = true, minDistance = true, downsample = true } = options;
  const { start, end } = localDayRange(date);

  const conditions = [
    eq(locationPoints.userId, userId),
    gte(locationPoints.timestamp, start),
    lt(locationPoints.timestamp, end),
    or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false)),
  ];
  if (accuracy) {
    conditions.push(or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200))!);
  }

  const rows = await database
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

  let filtered: typeof rows;
  if (minDistance) {
    filtered = [];
    for (const row of rows) {
      const prev = filtered[filtered.length - 1];
      if (!prev || distanceM(prev.lat, prev.lon, row.lat, row.lon) >= MIN_POINT_DISTANCE_M) {
        filtered.push(row);
      }
    }
  } else {
    filtered = rows;
  }

  let points: DayLocationPoint[] = filtered.map((r) => ({
    lat: r.lat,
    lon: r.lon,
    accuracy: r.accuracy,
    altitude: r.altitude,
    velocity: r.velocity,
    battery: r.battery,
    timestamp: r.timestamp.toISOString(),
  }));

  if (downsample && points.length > MAX_DAY_POINTS) {
    const step = points.length / MAX_DAY_POINTS;
    const sampled: DayLocationPoint[] = [];
    for (let i = 0; i < MAX_DAY_POINTS; i++) {
      sampled.push(points[Math.floor(i * step)]);
    }
    sampled[sampled.length - 1] = points[points.length - 1];
    points = sampled;
  }

  return points;
}

// ── Latest point ────────────────────────────────────────────────────────────

export interface LatestLocationPoint {
  lat: number;
  lon: number;
  accuracy: number | null;
  timestamp: Date;
}

/** The most recent non-anomalous point, or null when there is none. */
export async function getLatestLocationPoint(
  userId: string,
  database: Database = getDb()
): Promise<LatestLocationPoint | null> {
  const [row] = await database
    .select({
      lat: locationPoints.lat,
      lon: locationPoints.lon,
      accuracy: locationPoints.accuracy,
      timestamp: locationPoints.timestamp,
    })
    .from(locationPoints)
    .where(and(eq(locationPoints.userId, userId), sql`${locationPoints.anomaly} IS NOT TRUE`))
    .orderBy(desc(locationPoints.timestamp))
    .limit(1);
  return row ?? null;
}

// ── Raw points, cursor-paginated ────────────────────────────────────────────

export const RAW_POINTS_DEFAULT_LIMIT = 100;
export const RAW_POINTS_MAX_LIMIT = 500;

export interface RawPointCursor {
  timestamp: string;
  id: string;
}

export interface RawLocationPoint {
  id: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  velocity: number | null;
  timestamp: Date;
}

export function encodeRawPointCursor(cursor: RawPointCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeRawPointCursor(value: string): RawPointCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed?.timestamp === "string" &&
      typeof parsed?.id === "string" &&
      Number.isFinite(Date.parse(parsed.timestamp))
    ) {
      return { timestamp: parsed.timestamp, id: parsed.id };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Non-anomalous raw points in `[start, end)`, oldest first, keyset-paginated on
 * `(timestamp, id)` so consecutive pages neither repeat nor skip a row.
 */
export async function listRawLocationPoints(
  userId: string,
  range: TimeRange,
  page: { cursor?: RawPointCursor | null; limit?: number } = {},
  database: Database = getDb()
): Promise<{ points: RawLocationPoint[]; nextCursor: string | null }> {
  const limit = Math.min(
    Math.max(1, Math.floor(page.limit ?? RAW_POINTS_DEFAULT_LIMIT)),
    RAW_POINTS_MAX_LIMIT
  );
  const conditions = [
    eq(locationPoints.userId, userId),
    gte(locationPoints.timestamp, range.start),
    lt(locationPoints.timestamp, range.end),
    sql`${locationPoints.anomaly} IS NOT TRUE`,
  ];
  if (page.cursor) {
    const at = new Date(page.cursor.timestamp);
    conditions.push(
      or(
        gt(locationPoints.timestamp, at),
        and(eq(locationPoints.timestamp, at), gt(locationPoints.id, page.cursor.id))
      )!
    );
  }
  const rows = await database
    .select({
      id: locationPoints.id,
      lat: locationPoints.lat,
      lon: locationPoints.lon,
      accuracy: locationPoints.accuracy,
      altitude: locationPoints.altitude,
      velocity: locationPoints.velocity,
      timestamp: locationPoints.timestamp,
    })
    .from(locationPoints)
    .where(and(...conditions))
    .orderBy(asc(locationPoints.timestamp), asc(locationPoints.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const points = hasMore ? rows.slice(0, limit) : rows;
  const last = points[points.length - 1];
  return {
    points,
    nextCursor:
      hasMore && last
        ? encodeRawPointCursor({ timestamp: last.timestamp.toISOString(), id: last.id })
        : null,
  };
}

// ── Visits ──────────────────────────────────────────────────────────────────

export type PersistedVisit = typeof visits.$inferSelect;

/** Persisted visits whose start falls in `[start, end)`, oldest first. */
export async function listVisits(
  userId: string,
  range: TimeRange,
  database: Database = getDb()
): Promise<PersistedVisit[]> {
  return database
    .select()
    .from(visits)
    .where(
      and(
        eq(visits.userId, userId),
        gte(visits.startTime, range.start),
        lt(visits.startTime, range.end)
      )
    )
    .orderBy(asc(visits.startTime));
}

/** A persisted visit in the shape the stay-point API has always returned. */
export function toEnrichedVisit(v: PersistedVisit): EnrichedVisit {
  return {
    centerLat: v.centerLat,
    centerLon: v.centerLon,
    radiusM: v.radiusM,
    startTime: v.startTime.toISOString(),
    endTime: v.endTime.toISOString(),
    durationMinutes: Math.round(v.durationSeconds / 60),
    pointCount: 0,
    placeName: v.placeName,
    address: v.address,
    category: v.category,
    city: v.city,
    countryName: v.countryName,
    savedPlaceId: v.savedPlaceId ?? undefined,
  };
}

/** Persisted visits of one KST day (no detection). */
export async function getPersistedDayVisits(
  userId: string,
  date: string,
  database: Database = getDb()
): Promise<EnrichedVisit[]> {
  const rows = await listVisits(userId, localDayRange(date), database);
  return rows.map(toEnrichedVisit);
}

/** The most recently ended persisted visit, or null. */
export async function getLatestVisit(
  userId: string,
  database: Database = getDb()
): Promise<PersistedVisit | null> {
  const [row] = await database
    .select()
    .from(visits)
    .where(eq(visits.userId, userId))
    .orderBy(desc(visits.endTime))
    .limit(1);
  return row ?? null;
}

// ── Tracks with segments and subway legs ────────────────────────────────────

interface SubwayLegRow {
  segment_id: string;
  line_id: string;
  line_ref: string | null;
  line_name: string | null;
  line_colour: string | null;
  line_network: string | null;
  fallback_idx: number | string;
  start_station_name: string | null;
  end_station_name: string | null;
  session_id: string | null;
  leg_order: number | string;
  total_confidence: number | string;
}

export interface SubwayLeg {
  lineId: string;
  lineRef: string | null;
  lineName: string | null;
  lineColor: string;
  startStationName: string | null;
  endStationName: string | null;
  sessionId: string | null;
  legOrder: number;
  totalConfidence: number;
}

export interface TrackSegmentView {
  id: string;
  mode: string;
  confidence: string | null;
  startTime: string;
  endTime: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  subwayLegs: SubwayLeg[];
}

export interface TrackView {
  id: string;
  startTime: string;
  endTime: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  pointCount: number | null;
  startPlaceName: string | null;
  endPlaceName: string | null;
  dominantMode: string | null;
  elevationGain: number | null;
  elevationLoss: number | null;
  segments: TrackSegmentView[];
}

async function loadSubwayLegs(
  database: Database,
  segmentIds: string[]
): Promise<Map<string, SubwayLeg[]>> {
  const legsBySegmentId = new Map<string, SubwayLeg[]>();
  if (segmentIds.length === 0) return legsBySegmentId;
  // Postgres array literal — drizzle's sql template binds JS arrays as a
  // single text param, which fails to cast as uuid[] when the array has
  // exactly one element ("uuid"::uuid[] is malformed; only "{uuid,...}"
  // is valid).
  const segmentIdsLiteral = `{${segmentIds.join(",")}}`;
  const legRes = await database.execute(sql`
    WITH day_matches AS (
      SELECT * FROM subway_trip_matches
      WHERE transportation_segment_id = ANY(${segmentIdsLiteral}::uuid[])
    ),
    -- fallback_idx only depends on lines of the same system, so numbering just
    -- the systems this day touched yields the same indexes. Sorting every
    -- subway_lines row by name took ~170 ms on its own.
    numbered_lines AS (
      SELECT id, system_id, name, name_en, ref, colour, network,
             CASE WHEN colour IS NULL
                  THEN (ROW_NUMBER() OVER (PARTITION BY system_id, (colour IS NULL)
                                            ORDER BY ref, name, id) - 1)
                  ELSE 0 END AS fallback_idx
      FROM subway_lines
      WHERE system_id IN (
        SELECT sl.system_id FROM day_matches dm JOIN subway_lines sl ON sl.id = dm.line_id
      )
    )
    SELECT
      m.transportation_segment_id::text AS segment_id,
      l.id::text                         AS line_id,
      l.ref                              AS line_ref,
      l.name                             AS line_name,
      l.colour                           AS line_colour,
      l.network                          AS line_network,
      l.fallback_idx                     AS fallback_idx,
      ss_start.name                      AS start_station_name,
      ss_end.name                        AS end_station_name,
      m.session_id::text                 AS session_id,
      m.leg_order                        AS leg_order,
      m.total_confidence                 AS total_confidence
    FROM day_matches m
    JOIN numbered_lines l ON l.id = m.line_id
    LEFT JOIN subway_stations ss_start ON ss_start.id = m.start_station_id
    LEFT JOIN subway_stations ss_end ON ss_end.id = m.end_station_id
    ORDER BY m.transportation_segment_id, m.leg_order
  `);
  for (const row of legRes.rows as unknown as SubwayLegRow[]) {
    const leg: SubwayLeg = {
      lineId: row.line_id,
      lineRef: row.line_ref,
      lineName: row.line_name,
      lineColor: resolveLineColor({
        colour: row.line_colour,
        network: row.line_network,
        ref: row.line_ref,
        name: row.line_name,
        fallbackIndex: Number(row.fallback_idx) || 0,
      }),
      startStationName: row.start_station_name,
      endStationName: row.end_station_name,
      sessionId: row.session_id,
      legOrder: Number(row.leg_order),
      totalConfidence: Number(row.total_confidence),
    };
    const bucket = legsBySegmentId.get(row.segment_id);
    if (bucket) bucket.push(leg);
    else legsBySegmentId.set(row.segment_id, [leg]);
  }
  return legsBySegmentId;
}

/**
 * Persisted tracks whose start falls in `[start, end)`, each with its
 * transportation segments and their subway legs embedded.
 */
export async function listTracks(
  userId: string,
  range: TimeRange,
  database: Database = getDb()
): Promise<TrackView[]> {
  const rangeTracks = await database
    .select()
    .from(tracks)
    .where(
      and(
        eq(tracks.userId, userId),
        gte(tracks.startTime, range.start),
        lt(tracks.startTime, range.end)
      )
    )
    .orderBy(asc(tracks.startTime));

  // One query for every track's segments (P6), grouped in memory.
  const trackIds = rangeTracks.map((t) => t.id);
  const allSegments =
    trackIds.length === 0
      ? []
      : await database
          .select()
          .from(transportationSegments)
          .where(inArray(transportationSegments.trackId, trackIds))
          .orderBy(asc(transportationSegments.startTime));

  const segmentsByTrackId = new Map<string, typeof allSegments>();
  for (const s of allSegments) {
    if (!s.trackId) continue;
    const bucket = segmentsByTrackId.get(s.trackId);
    if (bucket) bucket.push(s);
    else segmentsByTrackId.set(s.trackId, [s]);
  }

  const legsBySegmentId = await loadSubwayLegs(
    database,
    allSegments.map((s) => s.id)
  );

  return rangeTracks.map((track) => ({
    id: track.id,
    startTime: track.startTime.toISOString(),
    endTime: track.endTime.toISOString(),
    distanceMeters: track.distanceMeters,
    durationSeconds: track.durationSeconds,
    pointCount: track.pointCount,
    startPlaceName: track.startPlaceName,
    endPlaceName: track.endPlaceName,
    dominantMode: track.dominantMode,
    elevationGain: track.elevationGain,
    elevationLoss: track.elevationLoss,
    segments: (segmentsByTrackId.get(track.id) ?? []).map((s) => ({
      // 렌더 키의 근거. startTime은 유일하지 않다 — 한 track 안에 0초짜리
      // stationary와 이동 세그먼트가 같은 시각에 시작하는 행이 실제로 있다.
      id: s.id,
      mode: s.mode,
      confidence: s.confidence,
      startTime: s.startTime.toISOString(),
      endTime: s.endTime.toISOString(),
      distanceMeters: s.distanceMeters,
      durationSeconds: s.durationSeconds,
      avgSpeedKmh: s.avgSpeedKmh,
      maxSpeedKmh: s.maxSpeedKmh,
      subwayLegs: legsBySegmentId.get(s.id) ?? [],
    })),
  }));
}

/** Tracks of one KST day. */
export function getDayTracks(
  userId: string,
  date: string,
  database: Database = getDb()
): Promise<TrackView[]> {
  return listTracks(userId, localDayRange(date), database);
}

// ── Saved place proximity ───────────────────────────────────────────────────

export interface PlaceLike {
  lat: number;
  lon: number;
  radiusM: number;
}

/**
 * The nearest place whose own radius contains the point (computed in memory),
 * with its distance. `extraRadiusM` widens every radius, e.g. by the fix's
 * accuracy. Null when the point is inside none of them.
 */
export function findNearestPlaceWithinRadius<T extends PlaceLike>(
  places: readonly T[],
  lat: number,
  lon: number,
  extraRadiusM = 0
): { place: T; distanceM: number } | null {
  let best: { place: T; distanceM: number } | null = null;
  for (const place of places) {
    const d = distanceM(lat, lon, place.lat, place.lon);
    if (d > place.radiusM + extraRadiusM) continue;
    if (!best || d < best.distanceM) best = { place, distanceM: d };
  }
  return best;
}

// ── Subway rides ────────────────────────────────────────────────────────────

interface SubwayMatchRow {
  match_id: string;
  sub_start_time: Date | string;
  sub_end_time: Date | string;
  total_confidence: number | string;
  line_id: string;
  line_ref: string | null;
  line_name: string | null;
  line_colour: string | null;
  line_network: string | null;
  fallback_idx: number | string;
  start_station_name: string | null;
  end_station_name: string | null;
}

export interface SubwayRide {
  matchId: string;
  line: { id: string; ref: string | null; name: string | null; color: string };
  startStationName: string | null;
  endStationName: string | null;
  subStartTime: Date;
  subEndTime: Date;
  totalConfidence: number;
}

/**
 * The most recently ended subway ride the matcher has processed, optionally
 * only one that ended at or after `since`. The matcher runs in the daily batch,
 * so this is "last processed ride", not a live inference.
 */
export async function getLatestSubwayRide(
  userId: string,
  options: { since?: Date } = {},
  database: Database = getDb()
): Promise<SubwayRide | null> {
  const { since } = options;
  // Fast path: any match at all? Skip the join if none.
  const recent = await database
    .select({ id: subwayTripMatches.id })
    .from(subwayTripMatches)
    .where(
      since
        ? and(eq(subwayTripMatches.userId, userId), gte(subwayTripMatches.subEndTime, since))
        : eq(subwayTripMatches.userId, userId)
    )
    .orderBy(desc(subwayTripMatches.subEndTime))
    .limit(1);
  if (recent.length === 0) return null;

  const detailRes = await database.execute(sql`
    WITH numbered_lines AS (
      SELECT id, system_id, name, ref, colour, network,
             CASE WHEN colour IS NULL
                  THEN (ROW_NUMBER() OVER (PARTITION BY system_id, (colour IS NULL)
                                            ORDER BY ref, name, id) - 1)
                  ELSE 0 END AS fallback_idx
      FROM subway_lines
    )
    SELECT
      m.id::text                  AS match_id,
      m.sub_start_time             AS sub_start_time,
      m.sub_end_time               AS sub_end_time,
      m.total_confidence           AS total_confidence,
      l.id::text                   AS line_id,
      l.ref                        AS line_ref,
      l.name                       AS line_name,
      l.colour                     AS line_colour,
      l.network                    AS line_network,
      l.fallback_idx               AS fallback_idx,
      ss_start.name                AS start_station_name,
      ss_end.name                  AS end_station_name
    FROM subway_trip_matches m
    JOIN numbered_lines l ON l.id = m.line_id
    LEFT JOIN subway_stations ss_start ON ss_start.id = m.start_station_id
    LEFT JOIN subway_stations ss_end ON ss_end.id = m.end_station_id
    WHERE m.user_id = ${userId}::uuid
      ${since ? sql`AND m.sub_end_time >= ${since}` : sql``}
    ORDER BY m.sub_end_time DESC
    LIMIT 1
  `);

  const row = (detailRes.rows[0] ?? null) as unknown as SubwayMatchRow | null;
  if (!row) return null;

  return {
    matchId: row.match_id,
    line: {
      id: row.line_id,
      ref: row.line_ref,
      name: row.line_name,
      color: resolveLineColor({
        colour: row.line_colour,
        network: row.line_network,
        ref: row.line_ref,
        name: row.line_name,
        fallbackIndex: Number(row.fallback_idx) || 0,
      }),
    },
    startStationName: row.start_station_name,
    endStationName: row.end_station_name,
    subStartTime: new Date(row.sub_start_time),
    subEndTime: new Date(row.sub_end_time),
    totalConfidence: Number(row.total_confidence),
  };
}
