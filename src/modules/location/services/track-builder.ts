/**
 * Track Builder Service
 *
 * Splits location points into movement tracks by time gaps.
 * Ported from Dawarich: app/services/tracks/track_builder.rb
 *
 * A "track" represents a single journey (e.g., home → office).
 * Each track is further split into transportation segments.
 */

import { distanceM } from "@/lib/geo";

// ── Constants ────────────────────────────────────────────────────────────────

const TRACK_GAP_SEC = 1800; // 30 minutes — split threshold between tracks
const MIN_TRACK_POINTS = 3;
const MIN_TRACK_DISTANCE_M = 100;

// ── Types ────────────────────────────────────────────────────────────────────

export interface TrackPoint {
  lat: number;
  lon: number;
  altitude: number | null;
  velocity: number | null;
  timestamp: Date;
}

export interface BuiltTrack {
  startTime: Date;
  endTime: Date;
  distanceMeters: number;
  durationSeconds: number;
  pointCount: number;
  elevationGain: number;
  elevationLoss: number;
  points: TrackPoint[];
}

// ── Elevation Calculation (Dawarich: track_builder.rb L105-139) ──────────────

function calculateElevation(points: TrackPoint[]): {
  gain: number;
  loss: number;
} {
  const altitudes: number[] = [];
  for (const p of points) {
    if (p.altitude != null) altitudes.push(p.altitude);
  }

  let gain = 0;
  let loss = 0;
  for (let i = 1; i < altitudes.length; i++) {
    const delta = altitudes[i] - altitudes[i - 1];
    if (delta > 0) gain += delta;
    else loss += Math.abs(delta);
  }

  return { gain: Math.round(gain), loss: Math.round(loss) };
}

// ── Track Builder ────────────────────────────────────────────────────────────

/**
 * Split sorted location points into tracks by time gap threshold.
 *
 * Points within 30 minutes of each other belong to the same track.
 * Short tracks (< 3 points or < 100m) are discarded.
 */
export function buildTracks(points: TrackPoint[]): BuiltTrack[] {
  if (points.length < MIN_TRACK_POINTS) return [];

  const groups: TrackPoint[][] = [];
  let current: TrackPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = current[current.length - 1];
    const gapSec =
      (points[i].timestamp.getTime() - prev.timestamp.getTime()) / 1000;

    if (gapSec > TRACK_GAP_SEC) {
      groups.push(current);
      current = [points[i]];
    } else {
      current.push(points[i]);
    }
  }
  groups.push(current);

  // Build tracks from groups, filtering by min constraints
  const tracks: BuiltTrack[] = [];

  for (const group of groups) {
    if (group.length < MIN_TRACK_POINTS) continue;

    // Calculate total distance via Haversine summation
    let distance = 0;
    for (let i = 1; i < group.length; i++) {
      distance += distanceM(
        group[i - 1].lat,
        group[i - 1].lon,
        group[i].lat,
        group[i].lon,
      );
    }

    if (distance < MIN_TRACK_DISTANCE_M) continue;

    const startTime = group[0].timestamp;
    const endTime = group[group.length - 1].timestamp;
    const durationSeconds = Math.round(
      (endTime.getTime() - startTime.getTime()) / 1000,
    );

    const { gain, loss } = calculateElevation(group);

    tracks.push({
      startTime,
      endTime,
      distanceMeters: Math.round(distance),
      durationSeconds,
      pointCount: group.length,
      elevationGain: gain,
      elevationLoss: loss,
      points: group,
    });
  }

  return tracks;
}
