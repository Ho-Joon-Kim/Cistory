/**
 * Transportation Mode Detector — Orchestrator
 *
 * Ported from Dawarich: app/services/transportation_modes/detector.rb
 * Validates track requirements and delegates to MovementAnalyzer.
 */

import { analyzeMovement, type TransportSegment } from "./movement-analyzer";

const MIN_TRACK_DURATION_SEC = 30;
const MIN_POINTS = 2;

interface PointInput {
  lat: number;
  lon: number;
  velocity: number | null;
  timestamp: Date;
}

/**
 * Detect transportation modes for a set of chronologically sorted points.
 * Returns empty array if insufficient data.
 */
export function detectTransportModes(
  points: PointInput[],
): TransportSegment[] {
  if (points.length < MIN_POINTS) return [];

  const duration =
    (points[points.length - 1].timestamp.getTime() -
      points[0].timestamp.getTime()) /
    1000;

  if (duration < MIN_TRACK_DURATION_SEC) return [];

  return analyzeMovement(points);
}

export type { TransportSegment };
