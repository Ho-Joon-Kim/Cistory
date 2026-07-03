/**
 * Movement Analyzer
 *
 * Ported from Dawarich: app/services/transportation_modes/movement_analyzer.rb
 * Calculates movement metrics and detects segment boundaries.
 */

import { distanceM } from "@/lib/geo";
import { type Confidence, classifyMode, type TransportMode } from "./mode-classifier";

// ── Constants (Dawarich defaults) ─────────────────────────────────────────────

const SPEED_CHANGE_THRESHOLD_KMH = 25;
const TIME_GAP_THRESHOLD_SEC = 180;
const SMOOTHING_WINDOW = 5;
const MIN_SEGMENT_DURATION_SEC = 60;
const ACCEL_SPIKE = 3.0; // m/s²
const ACCEL_PREVIOUS = 0.3; // m/s²

// ── Types ─────────────────────────────────────────────────────────────────────

interface PointInput {
  lat: number;
  lon: number;
  velocity: number | null;
  timestamp: Date;
}

interface MovementMetric {
  timeDiffSec: number;
  distanceM: number;
  speedMps: number;
  speedKmh: number;
  acceleration: number;
}

export interface TransportSegment {
  mode: TransportMode;
  confidence: Confidence;
  startTime: Date;
  endTime: Date;
  distanceMeters: number;
  durationSeconds: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  avgAcceleration: number;
}

// ── Movement Metrics ──────────────────────────────────────────────────────────

function calculateMetrics(points: PointInput[]): MovementMetric[] {
  const metrics: MovementMetric[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const timeDiffSec = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
    const dist = distanceM(prev.lat, prev.lon, curr.lat, curr.lon);

    // Prefer GPS velocity if available, otherwise compute from distance/time
    let speedMps: number;
    if (curr.velocity != null && curr.velocity > 0) {
      speedMps = curr.velocity;
    } else if (timeDiffSec > 0) {
      speedMps = dist / timeDiffSec;
    } else {
      speedMps = 0;
    }

    const speedKmh = speedMps * 3.6;
    const prevSpeedMps = i > 1 ? metrics[i - 2].speedMps : 0;
    const acceleration = timeDiffSec > 0 ? (speedMps - prevSpeedMps) / timeDiffSec : 0;

    metrics.push({
      timeDiffSec,
      distanceM: dist,
      speedMps,
      speedKmh,
      acceleration,
    });
  }

  return metrics;
}

// ── Speed Smoothing (5-point moving average) ──────────────────────────────────

function smoothSpeeds(metrics: MovementMetric[]): number[] {
  const smoothed: number[] = [];
  const half = Math.floor(SMOOTHING_WINDOW / 2);

  for (let i = 0; i < metrics.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(metrics.length - 1, i + half);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= end; j++) {
      sum += metrics[j].speedKmh;
      count++;
    }
    smoothed.push(sum / count);
  }

  return smoothed;
}

// ── Segment Boundary Detection ────────────────────────────────────────────────

function detectBoundaries(metrics: MovementMetric[], smoothedSpeeds: number[]): number[] {
  const boundaries: number[] = [0]; // always start with 0

  for (let i = 1; i < metrics.length; i++) {
    // Time gap
    if (metrics[i].timeDiffSec > TIME_GAP_THRESHOLD_SEC) {
      boundaries.push(i);
      continue;
    }

    // Speed change
    const speedDiff = Math.abs(smoothedSpeeds[i] - smoothedSpeeds[i - 1]);
    if (speedDiff > SPEED_CHANGE_THRESHOLD_KMH) {
      boundaries.push(i);
      continue;
    }

    // Acceleration spike
    if (
      Math.abs(metrics[i].acceleration) > ACCEL_SPIKE &&
      i > 1 &&
      Math.abs(metrics[i - 1].acceleration) < ACCEL_PREVIOUS
    ) {
      boundaries.push(i);
    }
  }

  return boundaries;
}

// ── Segment Building & Classification ─────────────────────────────────────────

function buildSegments(
  points: PointInput[],
  metrics: MovementMetric[],
  boundaries: number[]
): TransportSegment[] {
  if (metrics.length === 0) return [];

  const rawSegments: TransportSegment[] = [];

  for (let b = 0; b < boundaries.length; b++) {
    let startIdx = boundaries[b];
    const endIdx = b + 1 < boundaries.length ? boundaries[b + 1] - 1 : metrics.length - 1;

    // Skip leading time-gap metrics (GPS dropouts). detectBoundaries starts a
    // new segment at every gap metric, so gaps only ever appear as a segment's
    // first metric (including metrics[0], which boundary detection never
    // checks). Their timeDiffSec/distance describe the dropout, not movement —
    // including them dilutes the segment's average speed.
    while (startIdx <= endIdx && metrics[startIdx].timeDiffSec > TIME_GAP_THRESHOLD_SEC) {
      startIdx++;
    }

    if (startIdx > endIdx) continue;

    const segMetrics = metrics.slice(startIdx, endIdx + 1);

    let totalDist = 0;
    let totalDuration = 0;
    let maxSpeed = 0;
    let totalAccel = 0;

    for (const m of segMetrics) {
      totalDist += m.distanceM;
      totalDuration += m.timeDiffSec;
      if (m.speedKmh > maxSpeed) maxSpeed = m.speedKmh;
      totalAccel += Math.abs(m.acceleration);
    }

    const avgSpeedKmh = totalDuration > 0 ? (totalDist / totalDuration) * 3.6 : 0;
    const avgAccel = segMetrics.length > 0 ? totalAccel / segMetrics.length : 0;

    const { mode, confidence } = classifyMode(avgSpeedKmh, maxSpeed, avgAccel);

    // Point indices: startIdx maps to points[startIdx], endIdx+1 maps to points[endIdx+1]
    const startPointIdx = startIdx;
    const endPointIdx = Math.min(endIdx + 1, points.length - 1);

    rawSegments.push({
      mode,
      confidence,
      startTime: points[startPointIdx].timestamp,
      endTime: points[endPointIdx].timestamp,
      distanceMeters: Math.round(totalDist),
      durationSeconds: Math.round(totalDuration),
      avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10,
      maxSpeedKmh: Math.round(maxSpeed * 10) / 10,
      avgAcceleration: Math.round(avgAccel * 100) / 100,
    });
  }

  return rawSegments;
}

// ── Merge short segments ──────────────────────────────────────────────────────

function mergeShortSegments(segments: TransportSegment[]): TransportSegment[] {
  if (segments.length <= 1) return segments;

  const merged: TransportSegment[] = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const curr = segments[i];
    if (curr.durationSeconds < MIN_SEGMENT_DURATION_SEC && merged.length > 0) {
      // Merge into previous
      const prev = merged[merged.length - 1];
      merged[merged.length - 1] = mergeTwo(prev, curr);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

// ── Merge consecutive same-mode segments ──────────────────────────────────────

function mergeSameMode(segments: TransportSegment[]): TransportSegment[] {
  if (segments.length <= 1) return segments;

  const merged: TransportSegment[] = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];

    if (prev.mode === curr.mode) {
      merged[merged.length - 1] = mergeTwo(prev, curr);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

function mergeTwo(a: TransportSegment, b: TransportSegment): TransportSegment {
  const totalDist = a.distanceMeters + b.distanceMeters;
  const totalDur = a.durationSeconds + b.durationSeconds;
  const avgSpeed = totalDur > 0 ? (totalDist / totalDur) * 3.6 : 0;

  return {
    mode: a.durationSeconds >= b.durationSeconds ? a.mode : b.mode,
    confidence: a.durationSeconds >= b.durationSeconds ? a.confidence : b.confidence,
    startTime: a.startTime,
    endTime: b.endTime,
    distanceMeters: totalDist,
    durationSeconds: totalDur,
    avgSpeedKmh: Math.round(avgSpeed * 10) / 10,
    maxSpeedKmh: Math.max(a.maxSpeedKmh, b.maxSpeedKmh),
    avgAcceleration:
      Math.round(
        ((a.avgAcceleration * a.durationSeconds + b.avgAcceleration * b.durationSeconds) /
          Math.max(totalDur, 1)) *
          100
      ) / 100,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function analyzeMovement(points: PointInput[]): TransportSegment[] {
  if (points.length < 2) return [];

  const metrics = calculateMetrics(points);
  const smoothedSpeeds = smoothSpeeds(metrics);
  const boundaries = detectBoundaries(metrics, smoothedSpeeds);
  const segments = buildSegments(points, metrics, boundaries);
  const merged = mergeShortSegments(segments);
  return mergeSameMode(merged);
}
