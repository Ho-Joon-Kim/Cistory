/**
 * Transportation Mode Detector — Orchestrator
 *
 * Ported from Dawarich: app/services/transportation_modes/detector.rb
 * Validates track requirements and delegates to MovementAnalyzer.
 */

import { type HealthEvidence, refineSegmentsWithHealth } from "./health-evidence";
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
 * Returns empty array if insufficient data. With `health` evidence (exercise sessions
 * and step counts around the track), segments are refined by refineSegmentsWithHealth.
 */
export function detectTransportModes(
  points: PointInput[],
  health?: HealthEvidence
): TransportSegment[] {
  if (points.length < MIN_POINTS) return [];

  const duration =
    (points[points.length - 1].timestamp.getTime() - points[0].timestamp.getTime()) / 1000;

  if (duration < MIN_TRACK_DURATION_SEC) return [];

  const segments = analyzeMovement(points);
  return health ? refineSegmentsWithHealth(segments, health) : segments;
}

export type { TransportSegment };
