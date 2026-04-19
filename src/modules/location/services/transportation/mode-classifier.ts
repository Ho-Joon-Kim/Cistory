/**
 * Transportation Mode Classifier
 *
 * Ported from Dawarich: app/services/transportation_modes/classifier.rb
 * Classifies a movement segment by average speed and acceleration.
 */

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
const WALKING_MAX = 7;
const RUNNING_MAX = 20;
const CYCLING_MAX = 45;
const _DRIVING_MAX = 220;
const TRAIN_MIN = 80;
const TRAIN_MAX = 350;
const FLYING_MIN = 150;
const FLYING_THRESHOLD = 200;
const HIGH_SPEED_BOUNDARY = 130;
const CYCLING_MAX_LIKELY = 35;

// ── Acceleration thresholds (m/s²) ──────────────────────────────────────────

const RUNNING_VS_CYCLING_ACCEL = 0.25;
const CYCLING_VS_DRIVING_ACCEL = 0.4;
const TRAIN_ACCEL = 0.2;
const MOTORCYCLE_ACCEL = 0.6;
const BUS_ACCEL_MIN = 0.2;
const BUS_ACCEL_MAX = 0.4;

export function classifyMode(
  avgSpeedKmh: number,
  maxSpeedKmh: number,
  avgAcceleration: number
): ClassificationResult {
  // Stationary
  if (avgSpeedKmh <= STATIONARY_MAX) {
    return { mode: "stationary", confidence: "high" };
  }

  // Flying
  if (avgSpeedKmh >= FLYING_MIN && maxSpeedKmh >= FLYING_THRESHOLD) {
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

  // Running vs Cycling (7-20 km/h)
  if (avgSpeedKmh > WALKING_MAX && avgSpeedKmh <= RUNNING_MAX) {
    if (avgAcceleration > RUNNING_VS_CYCLING_ACCEL) {
      return { mode: "running", confidence: "medium" };
    }
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
