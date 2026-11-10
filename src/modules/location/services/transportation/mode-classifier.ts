/**
 * Transportation Mode Classifier
 *
 * Ported from Dawarich: app/services/transportation_modes/classifier.rb
 * Classifies a movement segment by speed, acceleration, and traveled distance.
 */

import { isLikelyFlight } from "./flight-calibration";

export type TransportMode =
  | "stationary"
  | "walking"
  | "running"
  | "cycling"
  | "driving"
  | "motorcycle"
  | "bus"
  | "train"
  | "boat"
  | "flying"
  | "unknown";

export type Confidence = "high" | "medium" | "low";

export interface ClassificationResult {
  mode: TransportMode;
  confidence: Confidence;
}

// ── Speed thresholds (km/h) — Dawarich defaults ──────────────────────────────

const STATIONARY_MAX = 1;
// Dawarich uses 7. Calibrated to 9 by scripts/calibrate-mode-vs-health.ts on the
// owner's exercise-session-labelled segments (2026-11-10, train split, whole
// pipeline re-run per value): 7 → 82.0%, 8 → 84.0%, 9 → 85.1%, 10 → 83.1%.
// GPS jitter routinely pushes real walks to 7–9 km/h.
const WALKING_MAX = 9;
const RUNNING_MAX = 20;
/** Upper edge of the 7–20 km/h band where speed alone cannot tell running from cycling. */
export const RUNNING_MAX_KMH = RUNNING_MAX;
const CYCLING_MAX = 45;
const _DRIVING_MAX = 220;
const TRAIN_MIN = 80;
const TRAIN_MAX = 350;
const FLYING_THRESHOLD = 200;
const HIGH_SPEED_BOUNDARY = 130;
const CYCLING_MAX_LIKELY = 35;

// ── Acceleration thresholds (m/s²) ──────────────────────────────────────────

const CYCLING_VS_DRIVING_ACCEL = 0.4;
const TRAIN_ACCEL = 0.2;
const MOTORCYCLE_ACCEL = 0.6;
const BUS_ACCEL_MIN = 0.2;
const BUS_ACCEL_MAX = 0.4;

export function classifyMode(
  avgSpeedKmh: number,
  maxSpeedKmh: number,
  avgAcceleration: number,
  distanceMeters: number
): ClassificationResult {
  // Stationary
  if (avgSpeedKmh <= STATIONARY_MAX) {
    return { mode: "stationary", confidence: "high" };
  }

  // Flying
  if (
    isLikelyFlight({
      averageSpeedKmh: avgSpeedKmh,
      maxSpeedKmh,
      distanceMeters,
    })
  ) {
    return { mode: "flying", confidence: "high" };
  }

  // Train (high speed, low acceleration, low speed variance)
  if (avgSpeedKmh >= TRAIN_MIN && avgSpeedKmh <= TRAIN_MAX && avgAcceleration < TRAIN_ACCEL) {
    const speedVarianceLow = maxSpeedKmh / avgSpeedKmh < 1.3;
    if (speedVarianceLow) {
      return { mode: "train", confidence: "high" };
    }
  }

  // Walking
  if (avgSpeedKmh <= WALKING_MAX) {
    return { mode: "walking", confidence: "high" };
  }

  // Running vs Cycling (9-20 km/h). Speed alone cannot split this band, and the old
  // Dawarich split (avg acceleration > 0.25 m/s² ⇒ running) mostly measured GPS
  // jitter: it labelled ~76% of watch-recorded bike rides running. On the labelled
  // band segments no acceleration threshold beats "always cycling" (77.8% vs 16.0%
  // for 0.25), and the owner has no on-road running at all. Running is now decided
  // only from health evidence (exercise sessions / step cadence) in
  // health-evidence.ts, which also overrides this low-confidence default.
  if (avgSpeedKmh > WALKING_MAX && avgSpeedKmh <= RUNNING_MAX) {
    return { mode: "cycling", confidence: "low" };
  }

  // Cycling vs Driving (20-45 km/h)
  if (avgSpeedKmh > RUNNING_MAX && avgSpeedKmh <= CYCLING_MAX) {
    if (avgAcceleration > CYCLING_VS_DRIVING_ACCEL) {
      return { mode: "driving", confidence: "medium" };
    }
    if (avgAcceleration <= CYCLING_VS_DRIVING_ACCEL && avgSpeedKmh <= CYCLING_MAX_LIKELY) {
      return { mode: "cycling", confidence: "medium" };
    }
    return { mode: "driving", confidence: "low" };
  }

  // Medium-high speed (45-130 km/h)
  if (avgSpeedKmh > CYCLING_MAX && avgSpeedKmh <= HIGH_SPEED_BOUNDARY) {
    if (avgAcceleration >= BUS_ACCEL_MIN && avgAcceleration <= BUS_ACCEL_MAX) {
      return { mode: "bus", confidence: "low" };
    }
    if (avgAcceleration > MOTORCYCLE_ACCEL) {
      return { mode: "motorcycle", confidence: "low" };
    }
    return { mode: "driving", confidence: "medium" };
  }

  // High speed (130-200 km/h)
  if (avgSpeedKmh > HIGH_SPEED_BOUNDARY && avgSpeedKmh < FLYING_THRESHOLD) {
    if (avgAcceleration < TRAIN_ACCEL) {
      return { mode: "train", confidence: "medium" };
    }
    return { mode: "driving", confidence: "low" };
  }

  return { mode: "unknown", confidence: "low" };
}
