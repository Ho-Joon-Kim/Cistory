/**
 * Anomaly Filter Service
 *
 * Ported from Dawarich: app/services/points/anomaly_filter.rb
 *
 * Two-pass anomaly detection:
 * 1. Accuracy filter: points with accuracy > 100m
 * 2. Speed sandwich test: both incoming AND outgoing speed exceed threshold
 */

import { getDb } from "@/db";
import { locationPoints } from "@/db/schema";
import { sql, eq, and, gte, lt, isNull, or } from "drizzle-orm";
import { logger } from "@/lib/logger";

// Constants ported from Dawarich
const ACCURACY_THRESHOLD = 100; // meters
const MAX_SPEED_KMH = 1000; // km/h floor → 277.78 m/s
const SPEED_FLOOR_MPS = MAX_SPEED_KMH / 3.6; // 277.78 m/s
const SPEED_MULTIPLIER = 3;
const CONTEXT_POINTS = 5;

interface AnomalyResult {
  accuracyMarked: number;
  speedMarked: number;
  total: number;
}

/**
 * Run anomaly detection for a user's location points in a date range.
 * Pass 1: accuracy-based, Pass 2: speed sandwich test (monthly chunks).
 */
export async function runAnomalyDetection(
  userId: string,
  from: Date,
  to: Date,
): Promise<AnomalyResult> {
  const db = getDb();

  // Pass 1: Accuracy filter
  const accuracyResult = await db.execute(sql`
    UPDATE location_points
    SET anomaly = true
    WHERE user_id = ${userId}
      AND timestamp >= ${from}
      AND timestamp < ${to}
      AND accuracy > ${ACCURACY_THRESHOLD}
      AND (anomaly IS NOT TRUE)
  `);
  const accuracyMarked = Number(accuracyResult.rowCount ?? 0);

  // Pass 2: Speed sandwich test — process in monthly chunks
  let speedMarked = 0;
  const cursor = new Date(from);

  while (cursor < to) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCMonth(chunkEnd.getUTCMonth() + 1);
    if (chunkEnd > to) chunkEnd.setTime(to.getTime());

    const marked = await processSpeedChunk(db, userId, cursor, chunkEnd);
    speedMarked += marked;

    cursor.setTime(chunkEnd.getTime());
  }

  return {
    accuracyMarked,
    speedMarked,
    total: accuracyMarked + speedMarked,
  };
}

/**
 * Process a single month chunk for speed-based anomaly detection.
 * Fetches context points before/after the chunk for accurate speed calculation.
 */
async function processSpeedChunk(
  db: ReturnType<typeof getDb>,
  userId: string,
  chunkStart: Date,
  chunkEnd: Date,
): Promise<number> {
  // Get IDs of context points (before chunk) + main points + context points (after chunk)
  // Context points are used for speed calculation but not marked as anomalies
  const contextAndMainPoints = await db.execute<{
    id: string;
    is_main: boolean;
    [key: string]: unknown;
  }>(sql`
    (
      SELECT id, false AS is_main
      FROM location_points
      WHERE user_id = ${userId}
        AND timestamp < ${chunkStart}
        AND (anomaly IS NOT TRUE)
      ORDER BY timestamp DESC, id DESC
      LIMIT ${CONTEXT_POINTS}
    )
    UNION ALL
    (
      SELECT id, true AS is_main
      FROM location_points
      WHERE user_id = ${userId}
        AND timestamp >= ${chunkStart}
        AND timestamp < ${chunkEnd}
        AND (anomaly IS NOT TRUE)
    )
    UNION ALL
    (
      SELECT id, false AS is_main
      FROM location_points
      WHERE user_id = ${userId}
        AND timestamp >= ${chunkEnd}
        AND (anomaly IS NOT TRUE)
      ORDER BY timestamp ASC, id ASC
      LIMIT ${CONTEXT_POINTS}
    )
  `);

  const rows = contextAndMainPoints.rows;
  if (rows.length < 3) return 0; // Need at least 3 points for sandwich test

  const allIds = rows.map((r) => r.id);
  const mainIds = new Set(rows.filter((r) => r.is_main).map((r) => r.id));

  if (mainIds.size === 0) return 0;

  // Calculate speeds between consecutive points using PostGIS
  const speedRows = await db.execute<{
    id: string;
    prev_id: string;
    speed_mps: number | null;
    [key: string]: unknown;
  }>(sql`
    WITH ordered_points AS (
      SELECT
        id, lonlat, timestamp,
        LAG(id) OVER (ORDER BY timestamp, id) AS prev_id,
        LAG(lonlat) OVER (ORDER BY timestamp, id) AS prev_lonlat,
        LAG(timestamp) OVER (ORDER BY timestamp, id) AS prev_timestamp
      FROM location_points
      WHERE id = ANY(${allIds}::uuid[])
    )
    SELECT
      id, prev_id,
      CASE
        WHEN prev_id IS NOT NULL
          AND EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) > 0
        THEN ST_Distance(lonlat, prev_lonlat) / EXTRACT(EPOCH FROM (timestamp - prev_timestamp))
        ELSE NULL
      END AS speed_mps
    FROM ordered_points
    WHERE prev_id IS NOT NULL
  `);

  // Build speed maps: incoming and outgoing for each point
  const incomingSpeed = new Map<string, number>(); // point id -> speed TO this point
  const outgoingSpeed = new Map<string, number>(); // point id -> speed FROM this point

  for (const row of speedRows.rows) {
    if (row.speed_mps != null) {
      incomingSpeed.set(row.id, row.speed_mps);
      outgoingSpeed.set(row.prev_id, row.speed_mps);
    }
  }

  // Calculate median of normal speeds (below floor) for threshold
  const normalSpeeds = [...incomingSpeed.values()].filter(
    (s) => s <= SPEED_FLOOR_MPS,
  );
  const median = calculateMedian(normalSpeeds);
  const threshold = Math.max(SPEED_FLOOR_MPS, median * SPEED_MULTIPLIER);

  // Sandwich test: mark as anomaly if BOTH incoming AND outgoing speeds exceed threshold
  const anomalyIds: string[] = [];

  for (const pointId of mainIds) {
    const incoming = incomingSpeed.get(pointId);
    const outgoing = outgoingSpeed.get(pointId);

    if (
      incoming != null &&
      outgoing != null &&
      incoming > threshold &&
      outgoing > threshold
    ) {
      anomalyIds.push(pointId);
    }
  }

  if (anomalyIds.length === 0) return 0;

  // Batch update anomalies
  await db.execute(sql`
    UPDATE location_points
    SET anomaly = true
    WHERE id = ANY(${anomalyIds}::uuid[])
      AND (anomaly IS NOT TRUE)
  `);

  return anomalyIds.length;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
