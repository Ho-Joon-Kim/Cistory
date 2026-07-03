/**
 * Track Persister Service
 *
 * Builds tracks from daily location points, detects transport modes per track,
 * resolves place names, and persists to the tracks + transportation_segments tables.
 */

import { and, asc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { getDb, locationPoints, placeCache, tracks, transportationSegments, visits } from "@/db";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";
import { buildTracks, type TrackPoint } from "./track-builder";
import { detectTransportModes } from "./transportation/detector";

// ── Types ────────────────────────────────────────────────────────────────────

interface PersistResult {
  trackCount: number;
  segmentCount: number;
}

// ── Place Name Resolution ────────────────────────────────────────────────────

interface PlaceQuery {
  lat: number;
  lon: number;
  time: Date;
}

/**
 * Resolve place names for many lat/lon/time queries in two batched reads
 * (previously 2 queries per call, called twice per track):
 * 1. Check visits overlapping each time (one query for the whole day window)
 * 2. Fallback to placeCache by rounded coordinates (one inArray batch query)
 * Returns names aligned to the input query order.
 */
async function resolvePlaceNames(
  db: ReturnType<typeof getDb>,
  userId: string,
  queries: PlaceQuery[],
  windowStart: Date,
  windowEnd: Date
): Promise<(string | null)[]> {
  if (queries.length === 0) return [];

  // Batch 1: all visits overlapping the day window
  const dayVisits = await db
    .select({ startTime: visits.startTime, endTime: visits.endTime, placeName: visits.placeName })
    .from(visits)
    .where(
      and(
        eq(visits.userId, userId),
        lte(visits.startTime, windowEnd),
        gte(visits.endTime, windowStart)
      )
    )
    .orderBy(asc(visits.startTime));

  const results: (string | null)[] = new Array(queries.length).fill(null);
  const cacheLookups: { idx: number; latKey: number; lonKey: number }[] = [];

  queries.forEach((q, idx) => {
    const visit = dayVisits.find((v) => v.startTime <= q.time && v.endTime >= q.time);
    if (visit?.placeName) {
      results[idx] = visit.placeName;
    } else {
      cacheLookups.push({
        idx,
        latKey: Math.round(q.lat * 1000) / 1000,
        lonKey: Math.round(q.lon * 1000) / 1000,
      });
    }
  });

  // Batch 2: placeCache fallback for the remaining coordinates
  if (cacheLookups.length > 0) {
    const latKeys = Array.from(new Set(cacheLookups.map((c) => c.latKey)));
    const lonKeys = Array.from(new Set(cacheLookups.map((c) => c.lonKey)));
    const cachedRows = await db
      .select({
        latKey: placeCache.latKey,
        lonKey: placeCache.lonKey,
        placeName: placeCache.placeName,
      })
      .from(placeCache)
      .where(and(inArray(placeCache.latKey, latKeys), inArray(placeCache.lonKey, lonKeys)));
    const cacheByKey = new Map(cachedRows.map((r) => [`${r.latKey}:${r.lonKey}`, r.placeName]));

    for (const c of cacheLookups) {
      results[c.idx] = cacheByKey.get(`${c.latKey}:${c.lonKey}`) ?? null;
    }
  }

  return results;
}

// ── Main Persister ───────────────────────────────────────────────────────────

/**
 * Build tracks for a single day, detect transport modes per track, and persist.
 * Replaces the previous inline transport-only detection in the backfill pipeline.
 */
export async function detectAndPersistTracks(
  userId: string,
  dateStr: string
): Promise<PersistResult> {
  const db = getDb();

  const dayStart = startOfLocalDay(dateStr);
  const dayEnd = endOfLocalDay(dateStr);

  // Fetch clean points for the day
  const points = await db
    .select({
      lat: locationPoints.lat,
      lon: locationPoints.lon,
      altitude: locationPoints.altitude,
      velocity: locationPoints.velocity,
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

  // Build tracks (30-min gap splitting)
  const builtTracks = buildTracks(
    points.map(
      (p): TrackPoint => ({
        lat: p.lat,
        lon: p.lon,
        altitude: p.altitude,
        velocity: p.velocity,
        timestamp: p.timestamp,
      })
    )
  );

  if (builtTracks.length === 0) {
    // No tracks — still clean up old data for this day
    await db.transaction(async (tx) => {
      // Delete segments that belong to tracks on this day
      const dayTracks = await tx
        .select({ id: tracks.id })
        .from(tracks)
        .where(
          and(
            eq(tracks.userId, userId),
            gte(tracks.startTime, dayStart),
            lt(tracks.startTime, dayEnd)
          )
        );

      if (dayTracks.length > 0) {
        const trackIds = dayTracks.map((t) => t.id);
        await tx
          .delete(transportationSegments)
          .where(inArray(transportationSegments.trackId, trackIds));
        await tx
          .delete(tracks)
          .where(
            and(
              eq(tracks.userId, userId),
              gte(tracks.startTime, dayStart),
              lt(tracks.startTime, dayEnd)
            )
          );
      }

      // Also delete orphan segments for this day (no trackId)
      await tx
        .delete(transportationSegments)
        .where(
          and(eq(transportationSegments.userId, userId), eq(transportationSegments.date, dateStr))
        );
    });
    return { trackCount: 0, segmentCount: 0 };
  }

  // Detect transport modes per track (pure computation, no DB)
  const now = new Date();
  const analyzedTracks = builtTracks.map((track) => {
    const segments = detectTransportModes(track.points);

    // Determine dominant mode (mode with longest total duration)
    let dominantMode: string | null = null;
    if (segments.length > 0) {
      const modeDurations = new Map<string, number>();
      for (const s of segments) {
        modeDurations.set(s.mode, (modeDurations.get(s.mode) ?? 0) + s.durationSeconds);
      }
      let maxDuration = 0;
      for (const [mode, dur] of modeDurations) {
        if (dur > maxDuration) {
          maxDuration = dur;
          dominantMode = mode;
        }
      }
    }

    return { track, segments, dominantMode };
  });

  // Batch-resolve start/end place names for all tracks (2 queries total)
  const placeQueries: PlaceQuery[] = builtTracks.flatMap((track) => {
    const first = track.points[0];
    const last = track.points[track.points.length - 1];
    return [
      { lat: first.lat, lon: first.lon, time: track.startTime },
      { lat: last.lat, lon: last.lon, time: track.endTime },
    ];
  });
  const placeNames = await resolvePlaceNames(db, userId, placeQueries, dayStart, dayEnd);

  let totalSegments = 0;

  await db.transaction(async (tx) => {
    // Delete existing tracks and segments for this day
    const existingTracks = await tx
      .select({ id: tracks.id })
      .from(tracks)
      .where(
        and(
          eq(tracks.userId, userId),
          gte(tracks.startTime, dayStart),
          lt(tracks.startTime, dayEnd)
        )
      );

    if (existingTracks.length > 0) {
      await tx.delete(transportationSegments).where(
        inArray(
          transportationSegments.trackId,
          existingTracks.map((et) => et.id)
        )
      );
      await tx
        .delete(tracks)
        .where(
          and(
            eq(tracks.userId, userId),
            gte(tracks.startTime, dayStart),
            lt(tracks.startTime, dayEnd)
          )
        );
    }

    // Also clean up orphan segments
    await tx
      .delete(transportationSegments)
      .where(
        and(eq(transportationSegments.userId, userId), eq(transportationSegments.date, dateStr))
      );

    // Insert all tracks in one statement; RETURNING preserves values order
    const insertedTracks = await tx
      .insert(tracks)
      .values(
        analyzedTracks.map(({ track, dominantMode }, i) => ({
          userId,
          startTime: track.startTime,
          endTime: track.endTime,
          distanceMeters: track.distanceMeters,
          durationSeconds: track.durationSeconds,
          pointCount: track.pointCount,
          startPlaceName: placeNames[i * 2],
          endPlaceName: placeNames[i * 2 + 1],
          dominantMode,
          elevationGain: track.elevationGain,
          elevationLoss: track.elevationLoss,
          calculatedAt: now,
        }))
      )
      .returning({ id: tracks.id });

    // Insert all transport segments in one statement, linked to their tracks
    const segmentRows = analyzedTracks.flatMap(({ segments }, i) =>
      segments.map((s) => ({
        userId,
        trackId: insertedTracks[i].id,
        date: dateStr,
        mode: s.mode,
        confidence: s.confidence,
        startTime: s.startTime,
        endTime: s.endTime,
        distanceMeters: s.distanceMeters,
        durationSeconds: s.durationSeconds,
        avgSpeedKmh: s.avgSpeedKmh,
        maxSpeedKmh: s.maxSpeedKmh,
        avgAcceleration: s.avgAcceleration,
        calculatedAt: now,
      }))
    );
    if (segmentRows.length > 0) {
      await tx.insert(transportationSegments).values(segmentRows);
    }
    totalSegments = segmentRows.length;
  });

  return { trackCount: builtTracks.length, segmentCount: totalSegments };
}
