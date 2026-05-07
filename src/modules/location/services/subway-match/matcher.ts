/**
 * Phase 2: subway track matcher.
 *
 * Walks each transportation_segments row for a (user, date) and decides whether
 * its underlying GPS track lines up with a real subway line. When confident,
 * inserts a row in `subway_trip_matches` and upgrades segment.mode = 'subway'.
 *
 * Two transfer cases handled here:
 *   - Case A (segment-internal): the same segment runs on Line A then Line B
 *     because GPS never broke (continuous underground). We detect via top-2
 *     coverage candidates + per-point closer-line run-length encoding.
 *   - Case B (cross-segment): handled in session-grouper.ts as a post-pass.
 *
 * Scoring weights and thresholds live in config.ts and are seed values pending
 * empirical calibration on labeled data.
 */

import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb, locationPoints, subwayTripMatches, transportationSegments } from "@/db";
import { logger } from "@/lib/logger";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";
import { subwayMatchConfig as cfg, ELIGIBLE_MODES_FOR_MATCHING } from "./config";
import { type ScorerPoint, scoreGpsGaps, scoreSpeedProfile } from "./scorers";

interface SegmentRow {
  id: string;
  trackId: string | null;
  startTime: Date;
  endTime: Date;
  mode: string;
  distanceMeters: number;
}

export interface CandidateLine {
  lineId: string;
  systemId: string;
  ref: string | null;
  lineName: string | null;
  overlapM: number;
  trackM: number;
}

export interface ScoredCandidate extends CandidateLine {
  coverage: number;
  speed: number;
  gap: number;
  station: number;
  total: number;
  startStationId: string | null;
  endStationId: string | null;
}

const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export function pointsToWkt(points: ScorerPoint[]): string {
  return `LINESTRING(${points.map((p) => `${p.lon} ${p.lat}`).join(",")})`;
}

export async function fetchSegmentPoints(
  userId: string,
  startTime: Date,
  endTime: Date
): Promise<ScorerPoint[]> {
  const db = getDb();
  const rows = await db
    .select({
      lat: locationPoints.lat,
      lon: locationPoints.lon,
      velocity: locationPoints.velocity,
      timestamp: locationPoints.timestamp,
    })
    .from(locationPoints)
    .where(
      and(
        eq(locationPoints.userId, userId),
        gte(locationPoints.timestamp, startTime),
        lt(locationPoints.timestamp, endTime),
        or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
        or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false))
      )
    )
    .orderBy(asc(locationPoints.timestamp));
  return rows.map((r) => ({
    lat: r.lat,
    lon: r.lon,
    velocity: r.velocity,
    timestamp: r.timestamp,
  }));
}

export async function fetchCandidateLines(wkt: string): Promise<CandidateLine[]> {
  const db = getDb();
  const buffer = cfg.coverageBufferMeters;
  const res = await db.execute(sql`
    WITH track AS (
      SELECT ST_GeomFromText(${wkt}, 4326) AS g
    )
    SELECT
      l.id::text         AS line_id,
      l.system_id::text  AS system_id,
      l.ref              AS ref,
      l.name             AS line_name,
      ST_Length(
        ST_Intersection(
          ST_Buffer(l.geometry::geography, ${buffer})::geometry,
          track.g
        )::geography
      ) AS overlap_m,
      ST_Length(track.g::geography) AS track_m
    FROM subway_lines l, track
    WHERE ST_DWithin(l.geometry::geography, track.g::geography, ${buffer * 2})
    ORDER BY overlap_m DESC
    LIMIT ${cfg.candidateLimit}
  `);
  return (
    res.rows as unknown as Array<{
      line_id: string;
      system_id: string;
      ref: string | null;
      line_name: string | null;
      overlap_m: number | string;
      track_m: number | string;
    }>
  ).map((r) => ({
    lineId: r.line_id,
    systemId: r.system_id,
    ref: r.ref,
    lineName: r.line_name,
    overlapM: Number(r.overlap_m),
    trackM: Number(r.track_m),
  }));
}

interface NearestStation {
  id: string;
  lat: number;
  lon: number;
  distM: number;
}

async function nearestStationOnLine(
  systemId: string,
  lineRef: string | null,
  lat: number,
  lon: number
): Promise<NearestStation | null> {
  if (!lineRef) return null;
  const db = getDb();
  const radius = cfg.stationProximityMeters;
  const res = await db.execute(sql`
    SELECT
      id::text AS id,
      ST_Y(location) AS lat,
      ST_X(location) AS lon,
      ST_Distance(location::geography, ST_MakePoint(${lon}, ${lat})::geography) AS dist_m
    FROM subway_stations
    WHERE system_id = ${systemId}::uuid
      AND line_refs ? ${lineRef}
      AND ST_DWithin(location::geography, ST_MakePoint(${lon}, ${lat})::geography, ${radius})
    ORDER BY dist_m ASC
    LIMIT 1
  `);
  const row = (res.rows[0] ?? null) as unknown as {
    id: string;
    lat: number | string;
    lon: number | string;
    dist_m: number | string;
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    lat: Number(row.lat),
    lon: Number(row.lon),
    distM: Number(row.dist_m),
  };
}

function stationProximityScore(start: NearestStation | null, end: NearestStation | null): number {
  return (start ? 0.5 : 0) + (end ? 0.5 : 0);
}

export async function scoreCandidate(
  cand: CandidateLine,
  points: ScorerPoint[]
): Promise<ScoredCandidate> {
  const coverage = cand.trackM > 0 ? cand.overlapM / cand.trackM : 0;
  const speed = scoreSpeedProfile(points);
  const gap = scoreGpsGaps(points);
  const startStation = await nearestStationOnLine(
    cand.systemId,
    cand.ref,
    points[0].lat,
    points[0].lon
  );
  const endStation = await nearestStationOnLine(
    cand.systemId,
    cand.ref,
    points[points.length - 1].lat,
    points[points.length - 1].lon
  );
  const station = stationProximityScore(startStation, endStation);
  const w = cfg.weights;
  const total = w.coverage * coverage + w.speed * speed + w.gap * gap + w.station * station;
  return {
    ...cand,
    coverage,
    speed,
    gap,
    station,
    total,
    startStationId: startStation?.id ?? null,
    endStationId: endStation?.id ?? null,
  };
}

function passesThresholds(c: ScoredCandidate): boolean {
  return c.coverage >= cfg.minCoverageRatio && c.total >= cfg.minTotalConfidence;
}

async function fetchLineGeometryAsCoords(lineId: string): Promise<number[][]> {
  const db = getDb();
  // Flatten MultiLineString into a single coordinate sequence (good enough for
  // closer-line projection — we just need the projection to nearest line, not
  // the segmented topology).
  const res = await db.execute(sql`
    SELECT ST_AsGeoJSON((ST_Dump(geometry)).geom)::json AS line
    FROM subway_lines
    WHERE id = ${lineId}::uuid
  `);
  const all: number[][] = [];
  for (const row of res.rows as unknown as Array<{ line: GeoJSON.LineString }>) {
    if (row.line?.type === "LineString") {
      for (const c of row.line.coordinates) all.push(c);
    }
  }
  return all;
}

function nearestDistanceToPolyline(lat: number, lon: number, coords: number[][]): number {
  // Approximate (point-to-vertex) — coords are typically dense (every 50-100m
  // on subway lines), so vertex distance ≈ segment distance for our purpose.
  let best = Infinity;
  for (const [vlon, vlat] of coords) {
    const d = haversineMeters(lat, lon, vlat, vlon);
    if (d < best) best = d;
  }
  return best;
}

interface SplitResult {
  transitionIndex: number; // points[0..transitionIndex) on primary, points[transitionIndex..] on secondary
}

function detectSplit(
  points: ScorerPoint[],
  primaryCoords: number[][],
  secondaryCoords: number[][]
): SplitResult | null {
  const labels: Array<"A" | "B"> = points.map((p) => {
    const dA = nearestDistanceToPolyline(p.lat, p.lon, primaryCoords);
    const dB = nearestDistanceToPolyline(p.lat, p.lon, secondaryCoords);
    return dA <= dB ? "A" : "B";
  });

  // Find a transition that has run-length >= minRunLength on both sides.
  const minRun = cfg.splitCase.minRunLength;
  for (let i = minRun; i <= labels.length - minRun; i++) {
    const before = labels.slice(Math.max(0, i - minRun), i);
    const after = labels.slice(i, i + minRun);
    if (
      before.every((l) => l === before[0]) &&
      after.every((l) => l === after[0]) &&
      before[0] !== after[0]
    ) {
      return { transitionIndex: i };
    }
  }
  return null;
}

interface MatchInsert {
  lineId: string;
  legOrder: number;
  subStartTime: Date;
  subEndTime: Date;
  startStationId: string | null;
  endStationId: string | null;
  coverageRatio: number;
  speedProfileScore: number;
  gapScore: number;
  stationScore: number;
  totalConfidence: number;
}

async function persistMatches(
  userId: string,
  segmentId: string,
  matches: MatchInsert[]
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Replace any existing matches for this segment so re-runs are idempotent.
    await tx
      .delete(subwayTripMatches)
      .where(eq(subwayTripMatches.transportationSegmentId, segmentId));
    for (const m of matches) {
      await tx.insert(subwayTripMatches).values({
        userId,
        transportationSegmentId: segmentId,
        lineId: m.lineId,
        legOrder: m.legOrder,
        subStartTime: m.subStartTime,
        subEndTime: m.subEndTime,
        startStationId: m.startStationId,
        endStationId: m.endStationId,
        coverageRatio: m.coverageRatio,
        speedProfileScore: m.speedProfileScore,
        gapScore: m.gapScore,
        stationScore: m.stationScore,
        totalConfidence: m.totalConfidence,
      });
    }
    if (matches.length > 0) {
      await tx
        .update(transportationSegments)
        .set({ mode: "subway" })
        .where(eq(transportationSegments.id, segmentId));
    }
  });
}

async function clearExistingMatch(segmentId: string, originalMode: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(subwayTripMatches)
      .where(eq(subwayTripMatches.transportationSegmentId, segmentId));
    // If we had previously upgraded the mode to 'subway' but on re-run no
    // longer pass thresholds, revert to the original detector mode.
    if (originalMode !== "subway") {
      await tx
        .update(transportationSegments)
        .set({ mode: originalMode })
        .where(eq(transportationSegments.id, segmentId));
    }
  });
}

async function tryMatchSegment(seg: SegmentRow, userId: string): Promise<number> {
  // Skip too-short segments.
  if (seg.distanceMeters < cfg.minSegmentLengthMeters) return 0;
  const points = await fetchSegmentPoints(userId, seg.startTime, seg.endTime);
  if (points.length < cfg.minSegmentPoints) return 0;

  const wkt = pointsToWkt(points);
  const candidates = await fetchCandidateLines(wkt);
  if (candidates.length === 0) {
    await clearExistingMatch(seg.id, seg.mode === "subway" ? "unknown" : seg.mode);
    return 0;
  }

  // Pre-filter by raw coverage to avoid scoring obviously hopeless candidates.
  const viable = candidates.filter(
    (c) => c.trackM > 0 && c.overlapM / c.trackM >= cfg.splitCase.minSecondaryCoverage
  );
  if (viable.length === 0) {
    await clearExistingMatch(seg.id, seg.mode === "subway" ? "unknown" : seg.mode);
    return 0;
  }

  const scored: ScoredCandidate[] = [];
  for (const c of viable) {
    scored.push(await scoreCandidate(c, points));
  }
  scored.sort((a, b) => b.total - a.total);

  const best = scored[0];
  const second = scored[1];

  // Try Case A split: top-2 both pass minSecondaryCoverage AND best is acceptable
  if (
    second &&
    best.lineId !== second.lineId &&
    best.coverage >= cfg.splitCase.minSecondaryCoverage &&
    second.coverage >= cfg.splitCase.minSecondaryCoverage &&
    passesThresholds(best)
  ) {
    const [primaryCoords, secondaryCoords] = await Promise.all([
      fetchLineGeometryAsCoords(best.lineId),
      fetchLineGeometryAsCoords(second.lineId),
    ]);
    const split =
      primaryCoords.length > 0 && secondaryCoords.length > 0
        ? detectSplit(points, primaryCoords, secondaryCoords)
        : null;
    if (split) {
      const headPoints = points.slice(0, split.transitionIndex);
      const tailPoints = points.slice(split.transitionIndex);
      if (headPoints.length >= cfg.minSegmentPoints && tailPoints.length >= cfg.minSegmentPoints) {
        // Score each leg in isolation against ITS line.
        const headWkt = pointsToWkt(headPoints);
        const tailWkt = pointsToWkt(tailPoints);
        const [headCands, tailCands] = await Promise.all([
          fetchCandidateLines(headWkt),
          fetchCandidateLines(tailWkt),
        ]);
        const headBest = headCands.find((c) => c.lineId === best.lineId);
        const tailBest = tailCands.find((c) => c.lineId === second.lineId);
        if (headBest && tailBest) {
          const headScored = await scoreCandidate(headBest, headPoints);
          const tailScored = await scoreCandidate(tailBest, tailPoints);
          if (passesThresholds(headScored) && passesThresholds(tailScored)) {
            await persistMatches(userId, seg.id, [
              scoredToInsert(
                headScored,
                0,
                headPoints[0].timestamp,
                headPoints[headPoints.length - 1].timestamp
              ),
              scoredToInsert(
                tailScored,
                1,
                tailPoints[0].timestamp,
                tailPoints[tailPoints.length - 1].timestamp
              ),
            ]);
            return 2;
          }
        }
      }
    }
    // Split rejected — fall through to single-leg below.
  }

  if (passesThresholds(best)) {
    await persistMatches(userId, seg.id, [
      scoredToInsert(best, 0, points[0].timestamp, points[points.length - 1].timestamp),
    ]);
    return 1;
  }

  await clearExistingMatch(seg.id, seg.mode === "subway" ? "unknown" : seg.mode);
  return 0;
}

function scoredToInsert(
  s: ScoredCandidate,
  legOrder: number,
  subStartTime: Date,
  subEndTime: Date
): MatchInsert {
  return {
    lineId: s.lineId,
    legOrder,
    subStartTime,
    subEndTime,
    startStationId: s.startStationId,
    endStationId: s.endStationId,
    coverageRatio: s.coverage,
    speedProfileScore: s.speed,
    gapScore: s.gap,
    stationScore: s.station,
    totalConfidence: s.total,
  };
}

export interface MatchSummary {
  segmentsConsidered: number;
  legsInserted: number;
}

/** Run the matcher across all eligible segments for a (user, date). */
export async function matchSubwayTrips(userId: string, dateStr: string): Promise<MatchSummary> {
  const db = getDb();
  const dayStart = startOfLocalDay(dateStr);
  const dayEnd = endOfLocalDay(dateStr);

  const segments = await db
    .select({
      id: transportationSegments.id,
      trackId: transportationSegments.trackId,
      startTime: transportationSegments.startTime,
      endTime: transportationSegments.endTime,
      mode: transportationSegments.mode,
      distanceMeters: transportationSegments.distanceMeters,
    })
    .from(transportationSegments)
    .where(
      and(
        eq(transportationSegments.userId, userId),
        gte(transportationSegments.startTime, dayStart),
        lt(transportationSegments.startTime, dayEnd),
        // 'subway' is included so a re-run can refresh existing matches with
        // tuned weights or repaired data.
        inArray(transportationSegments.mode, [...ELIGIBLE_MODES_FOR_MATCHING, "subway"])
      )
    );

  let legsInserted = 0;
  for (const seg of segments) {
    try {
      const inserted = await tryMatchSegment(seg as SegmentRow, userId);
      legsInserted += inserted;
    } catch (err) {
      logger.error("subway matcher segment failed", {
        segmentId: seg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (legsInserted > 0) {
    logger.info("subway matcher inserted legs", {
      userId,
      dateStr,
      segmentsConsidered: segments.length,
      legsInserted,
    });
  }

  return { segmentsConsidered: segments.length, legsInserted };
}
