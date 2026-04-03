/**
 * Track Persister Service
 *
 * Builds tracks from daily location points, detects transport modes per track,
 * resolves place names, and persists to the tracks + transportation_segments tables.
 */

import {
  getDb,
  locationPoints,
  tracks,
  transportationSegments,
  visits,
  placeCache,
} from "@/db";
import { eq, and, gte, lt, lte, asc, or, isNull, desc } from "drizzle-orm";
import { buildTracks, type TrackPoint } from "./track-builder";
import {
  detectTransportModes,
  type TransportSegment,
} from "./transportation/detector";

// ── Types ────────────────────────────────────────────────────────────────────

interface PersistResult {
  trackCount: number;
  segmentCount: number;
}

// ── Place Name Resolution ────────────────────────────────────────────────────

/**
 * Try to resolve a place name for a lat/lon at a given time.
 * 1. Check visits overlapping that time
 * 2. Fallback to placeCache by rounded coordinates
 */
async function resolvePlaceName(
  db: ReturnType<typeof getDb>,
  userId: string,
  lat: number,
  lon: number,
  time: Date,
): Promise<string | null> {
  // Check visits at this time
  const [visit] = await db
    .select({ placeName: visits.placeName })
    .from(visits)
    .where(
      and(
        eq(visits.userId, userId),
        lte(visits.startTime, time),
        gte(visits.endTime, time),
      ),
    )
    .limit(1);

  if (visit?.placeName) return visit.placeName;

  // Fallback: placeCache lookup
  const latKey = Math.round(lat * 1000) / 1000;
  const lonKey = Math.round(lon * 1000) / 1000;

  const [cached] = await db
    .select({ placeName: placeCache.placeName })
    .from(placeCache)
    .where(
      and(eq(placeCache.latKey, latKey), eq(placeCache.lonKey, lonKey)),
    )
    .limit(1);

  return cached?.placeName ?? null;
}

// ── Main Persister ───────────────────────────────────────────────────────────

/**
 * Build tracks for a single day, detect transport modes per track, and persist.
 * Replaces the previous inline transport-only detection in the backfill pipeline.
 */
export async function detectAndPersistTracks(
  userId: string,
  dateStr: string,
): Promise<PersistResult> {
  const db = getDb();

  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

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
        or(
          isNull(locationPoints.accuracy),
          lte(locationPoints.accuracy, 200),
        ),
        or(
          isNull(locationPoints.anomaly),
          eq(locationPoints.anomaly, false),
        ),
      ),
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
      }),
    ),
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
            lt(tracks.startTime, dayEnd),
          ),
        );

      if (dayTracks.length > 0) {
        const trackIds = dayTracks.map((t) => t.id);
        for (const trackId of trackIds) {
          await tx
            .delete(transportationSegments)
            .where(eq(transportationSegments.trackId, trackId));
        }
        await tx.delete(tracks).where(
          and(
            eq(tracks.userId, userId),
            gte(tracks.startTime, dayStart),
            lt(tracks.startTime, dayEnd),
          ),
        );
      }

      // Also delete orphan segments for this day (no trackId)
      await tx.delete(transportationSegments).where(
        and(
          eq(transportationSegments.userId, userId),
          eq(transportationSegments.date, dateStr),
        ),
      );
    });
    return { trackCount: 0, segmentCount: 0 };
  }

  // Detect transport modes per track and resolve place names
  const now = new Date();
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
          lt(tracks.startTime, dayEnd),
        ),
      );

    if (existingTracks.length > 0) {
      for (const et of existingTracks) {
        await tx
          .delete(transportationSegments)
          .where(eq(transportationSegments.trackId, et.id));
      }
      await tx.delete(tracks).where(
        and(
          eq(tracks.userId, userId),
          gte(tracks.startTime, dayStart),
          lt(tracks.startTime, dayEnd),
        ),
      );
    }

    // Also clean up orphan segments
    await tx.delete(transportationSegments).where(
      and(
        eq(transportationSegments.userId, userId),
        eq(transportationSegments.date, dateStr),
      ),
    );

    // Process each track
    for (const track of builtTracks) {
      // Detect transport segments within this track
      const segments = detectTransportModes(track.points);

      // Determine dominant mode (mode with longest total duration)
      let dominantMode: string | null = null;
      if (segments.length > 0) {
        const modeDurations = new Map<string, number>();
        for (const s of segments) {
          modeDurations.set(
            s.mode,
            (modeDurations.get(s.mode) ?? 0) + s.durationSeconds,
          );
        }
        let maxDuration = 0;
        for (const [mode, dur] of modeDurations) {
          if (dur > maxDuration) {
            maxDuration = dur;
            dominantMode = mode;
          }
        }
      }

      // Resolve start/end place names
      const startPlaceName = await resolvePlaceName(
        db,
        userId,
        track.points[0].lat,
        track.points[0].lon,
        track.startTime,
      );
      const endPlaceName = await resolvePlaceName(
        db,
        userId,
        track.points[track.points.length - 1].lat,
        track.points[track.points.length - 1].lon,
        track.endTime,
      );

      // Insert track
      const [inserted] = await tx
        .insert(tracks)
        .values({
          userId,
          startTime: track.startTime,
          endTime: track.endTime,
          distanceMeters: track.distanceMeters,
          durationSeconds: track.durationSeconds,
          pointCount: track.pointCount,
          startPlaceName,
          endPlaceName,
          dominantMode,
          elevationGain: track.elevationGain,
          elevationLoss: track.elevationLoss,
          calculatedAt: now,
        })
        .returning({ id: tracks.id });

      // Insert transport segments linked to this track
      if (segments.length > 0) {
        await tx.insert(transportationSegments).values(
          segments.map((s) => ({
            userId,
            trackId: inserted.id,
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
          })),
        );
        totalSegments += segments.length;
      }
    }
  });

  return { trackCount: builtTracks.length, segmentCount: totalSegments };
}
