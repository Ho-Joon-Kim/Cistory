/**
 * Visit Detector Service
 *
 * Ported from Dawarich:
 * - app/services/visits/detector.rb (dynamic radius detection)
 * - app/services/visits/merger.rb (nearby visit merging)
 * - app/services/visits/smart_detect.rb (orchestration)
 */

import { distanceM } from "@/lib/geo";

// ── Constants (Dawarich) ──────────────────────────────────────────────────────

// Detector
const MIN_VISIT_DURATION_SEC = 180; // 3 minutes
const MAX_VISIT_GAP_SEC = 1800; // 30 minutes
const MIN_POINTS_FOR_VISIT = 2;

// Dynamic radius (km)
const BASE_RADIUS_KM = 0.05; // 50m
const MAX_RADIUS_KM = 0.5; // 500m
const MIN_RADIUS_M = 15; // minimum computed radius for a finalized visit

// Merger
const SIGNIFICANT_MOVEMENT_M = 50;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LocationRow {
  lat: number;
  lon: number;
  timestamp: Date;
}

export interface DetectedVisit {
  centerLat: number;
  centerLon: number;
  radiusM: number;
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  pointCount: number;
}

// ── Dynamic Radius ────────────────────────────────────────────────────────────

/**
 * Dawarich formula: min(50m × (1 + log(1 + hours)), 500m)
 * Returns radius in meters.
 */
function dynamicRadiusM(durationSeconds: number): number {
  const hours = durationSeconds / 3600;
  const radiusKm = Math.min(BASE_RADIUS_KM * (1 + Math.log(1 + hours)), MAX_RADIUS_KM);
  return radiusKm * 1000;
}

// ── Detector ──────────────────────────────────────────────────────────────────

/**
 * Detect visits from sorted location points using dynamic radius clustering.
 */
export function detectVisits(rows: LocationRow[]): DetectedVisit[] {
  if (rows.length === 0) return [];

  const visits: DetectedVisit[] = [];

  // P8: track centroid incrementally. Previous code recomputed the mean
  // (O(k) .reduce) on every new point → overall O(n²) when a long visit
  // accumulated thousands of points (e.g. home all night).
  let currentPoints: LocationRow[] = [rows[0]];
  let sumLat = rows[0].lat;
  let sumLon = rows[0].lon;

  function resetCluster(point: LocationRow) {
    currentPoints = [point];
    sumLat = point.lat;
    sumLon = point.lon;
  }

  function finalizeVisit(points: LocationRow[]) {
    if (points.length < MIN_POINTS_FOR_VISIT) return;

    const start = points[0].timestamp;
    const end = points[points.length - 1].timestamp;
    const durationSec = (end.getTime() - start.getTime()) / 1000;
    if (durationSec < MIN_VISIT_DURATION_SEC) return;

    // Recompute centroid for the finalized cluster (linear in cluster size,
    // once — acceptable since we only do it per-cluster, not per-point).
    let latSum = 0;
    let lonSum = 0;
    for (const p of points) {
      latSum += p.lat;
      lonSum += p.lon;
    }
    const centerLat = latSum / points.length;
    const centerLon = lonSum / points.length;

    let maxDist = 0;
    for (const p of points) {
      const d = distanceM(centerLat, centerLon, p.lat, p.lon);
      if (d > maxDist) maxDist = d;
    }

    visits.push({
      centerLat,
      centerLon,
      radiusM: Math.max(maxDist, MIN_RADIUS_M),
      startTime: start,
      endTime: end,
      durationSeconds: Math.round(durationSec),
      pointCount: points.length,
    });
  }

  for (let i = 1; i < rows.length; i++) {
    const point = rows[i];
    const lastPoint = currentPoints[currentPoints.length - 1];

    const gapSec = (point.timestamp.getTime() - lastPoint.timestamp.getTime()) / 1000;
    if (gapSec > MAX_VISIT_GAP_SEC) {
      finalizeVisit(currentPoints);
      resetCluster(point);
      continue;
    }

    const durationSoFar =
      (lastPoint.timestamp.getTime() - currentPoints[0].timestamp.getTime()) / 1000;
    const radius = dynamicRadiusM(durationSoFar);

    const centerLat = sumLat / currentPoints.length;
    const centerLon = sumLon / currentPoints.length;
    const dist = distanceM(centerLat, centerLon, point.lat, point.lon);

    if (dist <= radius) {
      currentPoints.push(point);
      sumLat += point.lat;
      sumLon += point.lon;
    } else {
      finalizeVisit(currentPoints);
      resetCluster(point);
    }
  }

  finalizeVisit(currentPoints);

  return visits;
}

// ── Merger ─────────────────────────────────────────────────────────────────────

/**
 * Merge nearby visits if:
 * 1. Centers are within 50m
 * 2. Time gap is within 30 minutes
 * 3. No significant movement between them (all between-points stay within 50m of center)
 */
export function mergeVisits(visits: DetectedVisit[], allPoints: LocationRow[]): DetectedVisit[] {
  if (visits.length <= 1) return visits;

  const merged: DetectedVisit[] = [visits[0]];

  for (let i = 1; i < visits.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = visits[i];

    const centerDist = distanceM(prev.centerLat, prev.centerLon, curr.centerLat, curr.centerLon);
    const gapSec = (curr.startTime.getTime() - prev.endTime.getTime()) / 1000;

    if (centerDist <= SIGNIFICANT_MOVEMENT_M && gapSec <= MAX_VISIT_GAP_SEC) {
      // Check for significant movement between the visits
      const betweenPoints = allPoints.filter(
        (p) => p.timestamp > prev.endTime && p.timestamp < curr.startTime
      );

      const hasSignificantMovement = betweenPoints.some(
        (p) => distanceM(prev.centerLat, prev.centerLon, p.lat, p.lon) > SIGNIFICANT_MOVEMENT_M
      );

      if (!hasSignificantMovement) {
        // Merge: extend prev to include curr
        const allVisitPoints = allPoints.filter(
          (p) => p.timestamp >= prev.startTime && p.timestamp <= curr.endTime
        );
        const centerLat = allVisitPoints.reduce((s, p) => s + p.lat, 0) / allVisitPoints.length;
        const centerLon = allVisitPoints.reduce((s, p) => s + p.lon, 0) / allVisitPoints.length;

        let maxDist = 0;
        for (const p of allVisitPoints) {
          const d = distanceM(centerLat, centerLon, p.lat, p.lon);
          if (d > maxDist) maxDist = d;
        }

        merged[merged.length - 1] = {
          centerLat,
          centerLon,
          radiusM: Math.max(maxDist, MIN_RADIUS_M),
          startTime: prev.startTime,
          endTime: curr.endTime,
          durationSeconds: Math.round((curr.endTime.getTime() - prev.startTime.getTime()) / 1000),
          pointCount: prev.pointCount + curr.pointCount,
        };
        continue;
      }
    }

    merged.push(curr);
  }

  return merged;
}

/**
 * Full visit detection pipeline: detect → merge.
 */
export function detectAndMergeVisits(rows: LocationRow[]): DetectedVisit[] {
  const detected = detectVisits(rows);
  return mergeVisits(detected, rows);
}
