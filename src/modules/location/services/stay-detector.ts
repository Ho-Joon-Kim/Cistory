/**
 * Stay Detector
 *
 * Finds intervals where the traveller stayed put, using a FIXED anchor: a stay
 * starts at point i and continues while later points remain within `radiusM`
 * of point i — not of a running centroid.
 *
 * The fixed anchor is the whole point. `visit-detector.ts` compares each new
 * point against a centroid recomputed as points are appended, so the centre
 * drifts along with a slow walker and the cluster never breaks — a 28-minute
 * walk down 강남대로 was emitted as four separate "visits" 103m, 147m and 820m
 * apart. An anchor cannot drift, so walking always escapes it: at 4 km/h a 50m
 * radius is crossed in ~45s, far below any sane `minDurationSec`. Standing
 * still produces only GPS drift, which stays inside the radius indefinitely.
 */

import { distanceM } from "@/lib/geo";

export interface StayPoint {
  lat: number;
  lon: number;
  timestamp: Date;
}

export interface StayInterval {
  /** Index of the first point of the stay (inclusive). */
  startIndex: number;
  /** Index of the last point of the stay (inclusive). */
  endIndex: number;
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
}

export interface StayOptions {
  /** A stay holds while points remain within this distance of the anchor. */
  radiusM: number;
  /** Shorter dwells are movement, not stays. */
  minDurationSec: number;
}

// Calibrated 2026-08-06 over 2026-02-01…2026-08-06 with
// scripts/calibrate-track-splitting.ts. Chosen for stability rather than the
// lowest stationary-segment share: at radiusM 30 the anchor sits inside GPS
// noise, so stays never form and sitting still leaks into tracks, where the
// mode detector labels the drift as walking/cycling rather than stationary —
// which made the worse configuration score better on that metric. Real modes
// (driving, bus, train, flying) are unchanged across the grid; only the
// drift-mimicking low-speed modes move. See
// docs/superpowers/specs/2026-08-06-track-splitting-design.md.
export const DEFAULT_STAY_OPTIONS: StayOptions = {
  radiusM: 60,
  minDurationSec: 450,
};

export function findStays(
  points: StayPoint[],
  options: StayOptions = DEFAULT_STAY_OPTIONS
): StayInterval[] {
  const { radiusM, minDurationSec } = options;
  const stays: StayInterval[] = [];

  let i = 0;
  while (i < points.length) {
    const anchor = points[i];

    let j = i + 1;
    while (
      j < points.length &&
      distanceM(anchor.lat, anchor.lon, points[j].lat, points[j].lon) <= radiusM
    ) {
      j++;
    }

    const lastIndex = j - 1;
    const durationSeconds =
      (points[lastIndex].timestamp.getTime() - anchor.timestamp.getTime()) / 1000;

    if (durationSeconds >= minDurationSec) {
      stays.push({
        startIndex: i,
        endIndex: lastIndex,
        startTime: anchor.timestamp,
        endTime: points[lastIndex].timestamp,
        durationSeconds: Math.round(durationSeconds),
      });
      i = j; // resume scanning after the stay
    } else {
      i++; // slide the anchor forward one point
    }
  }

  return stays;
}
