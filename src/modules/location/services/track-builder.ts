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
import {
  DEFAULT_STAY_OPTIONS,
  findStays,
  type StayInterval,
  type StayOptions,
} from "./stay-detector";

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

export interface BuildTracksOptions {
  /** Overrides for stay detection; defaults to DEFAULT_STAY_OPTIONS. */
  stay?: StayOptions;
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

/** Index ranges (inclusive) that no stay covers — i.e. the moving parts. */
function movingRanges(total: number, stays: StayInterval[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let cursor = 0;

  for (const stay of stays) {
    if (stay.startIndex > cursor) ranges.push([cursor, stay.startIndex - 1]);
    cursor = stay.endIndex + 1;
  }
  if (cursor < total) ranges.push([cursor, total - 1]);

  return ranges;
}

/** Split a run of points wherever the sampling gap exceeds TRACK_GAP_SEC. */
function splitByGap(points: TrackPoint[]): TrackPoint[][] {
  if (points.length === 0) return [];

  const groups: TrackPoint[][] = [];
  let current: TrackPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = current[current.length - 1];
    const gapSec = (points[i].timestamp.getTime() - prev.timestamp.getTime()) / 1000;

    if (gapSec > TRACK_GAP_SEC) {
      groups.push(current);
      current = [points[i]];
    } else {
      current.push(points[i]);
    }
  }
  groups.push(current);

  return groups;
}

/** Turn a point group into a track, or null when it fails the min filters. */
function finalizeTrack(group: TrackPoint[]): BuiltTrack | null {
  if (group.length < MIN_TRACK_POINTS) return null;

  let distance = 0;
  for (let i = 1; i < group.length; i++) {
    distance += distanceM(group[i - 1].lat, group[i - 1].lon, group[i].lat, group[i].lon);
  }
  if (distance < MIN_TRACK_DISTANCE_M) return null;

  const startTime = group[0].timestamp;
  const endTime = group[group.length - 1].timestamp;
  const { gain, loss } = calculateElevation(group);

  return {
    startTime,
    endTime,
    distanceMeters: Math.round(distance),
    durationSeconds: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
    pointCount: group.length,
    elevationGain: gain,
    elevationLoss: loss,
    points: group,
  };
}

/**
 * Split sorted location points into movement tracks.
 *
 * Points inside a detected stay are excluded — a track is movement. What is
 * left is split further wherever the sampling gap exceeds 30 minutes, which is
 * what carries the low-frequency historical data (one point every ~12 minutes)
 * where stays never register.
 */
export function buildTracks(points: TrackPoint[], options?: BuildTracksOptions): BuiltTrack[] {
  if (points.length < MIN_TRACK_POINTS) return [];

  const stays = findStays(points, options?.stay ?? DEFAULT_STAY_OPTIONS);
  const tracks: BuiltTrack[] = [];

  for (const [from, to] of movingRanges(points.length, stays)) {
    for (const group of splitByGap(points.slice(from, to + 1))) {
      const track = finalizeTrack(group);
      if (track) tracks.push(track);
    }
  }

  return tracks;
}
