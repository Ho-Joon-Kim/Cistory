/**
 * Anomaly Filter Service
 *
 * Ported from Dawarich: app/services/points/anomaly_filter.rb
 *
 * Two-pass anomaly detection:
 * 1. Accuracy filter: points with accuracy > 100m
 * 2. Speed sandwich test: both incoming AND outgoing speed exceed threshold
 *
 * All logic runs in SQL CTEs to avoid passing large arrays from JS.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";

const ACCURACY_THRESHOLD = 100;
const MAX_SPEED_KMH = 1000;
const SPEED_FLOOR_MPS = MAX_SPEED_KMH / 3.6; // 277.78 m/s
const SPEED_MULTIPLIER = 3;

interface AnomalyResult {
  accuracyMarked: number;
  speedMarked: number;
  total: number;
}

/**
 * Run anomaly detection for a single day.
 */
export async function runAnomalyDetectionForDay(
  userId: string,
  dateStr: string
): Promise<AnomalyResult> {
  const db = getDb();
  const dayStart = startOfLocalDay(dateStr);
  const dayEnd = endOfLocalDay(dateStr);

  // Pass 1: Accuracy filter
  const accuracyResult = await db.execute(sql`
    UPDATE location_points
    SET anomaly = true
    WHERE user_id = ${userId}
      AND timestamp >= ${dayStart}
      AND timestamp < ${dayEnd}
      AND accuracy > ${ACCURACY_THRESHOLD}
      AND (anomaly IS NOT TRUE)
  `);
  const accuracyMarked = Number(accuracyResult.rowCount ?? 0);

  // Pass 2: Speed sandwich test — entirely in SQL
  const speedResult = await db.execute(sql`
    WITH
    day_points AS (
      (
        SELECT id, lonlat, timestamp, false AS is_main
        FROM location_points
        WHERE user_id = ${userId}
          AND timestamp < ${dayStart}
          AND (anomaly IS NOT TRUE)
        ORDER BY timestamp DESC, id DESC
        LIMIT 5
      )
      UNION ALL
      (
        SELECT id, lonlat, timestamp, true AS is_main
        FROM location_points
        WHERE user_id = ${userId}
          AND timestamp >= ${dayStart}
          AND timestamp < ${dayEnd}
          AND (anomaly IS NOT TRUE)
      )
      UNION ALL
      (
        SELECT id, lonlat, timestamp, false AS is_main
        FROM location_points
        WHERE user_id = ${userId}
          AND timestamp >= ${dayEnd}
          AND (anomaly IS NOT TRUE)
        ORDER BY timestamp ASC, id ASC
        LIMIT 5
      )
    ),
    with_speeds AS (
      SELECT
        id, is_main,
        CASE
          WHEN LAG(lonlat) OVER w IS NOT NULL
            AND EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER w)) > 0
          THEN ST_Distance(lonlat, LAG(lonlat) OVER w)
               / EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER w))
          ELSE NULL
        END AS incoming_speed,
        CASE
          WHEN LEAD(lonlat) OVER w IS NOT NULL
            AND EXTRACT(EPOCH FROM (LEAD(timestamp) OVER w - timestamp)) > 0
          THEN ST_Distance(LEAD(lonlat) OVER w, lonlat)
               / EXTRACT(EPOCH FROM (LEAD(timestamp) OVER w - timestamp))
          ELSE NULL
        END AS outgoing_speed
      FROM day_points
      WINDOW w AS (ORDER BY timestamp, id)
    ),
    speed_stats AS (
      SELECT
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY incoming_speed), 0) AS median_speed
      FROM with_speeds
      WHERE incoming_speed IS NOT NULL
        AND incoming_speed <= ${SPEED_FLOOR_MPS}
    ),
    anomalies AS (
      SELECT ws.id
      FROM with_speeds ws, speed_stats ss
      WHERE ws.is_main = true
        AND ws.incoming_speed IS NOT NULL
        AND ws.outgoing_speed IS NOT NULL
        AND ws.incoming_speed > GREATEST(${SPEED_FLOOR_MPS}, ss.median_speed * ${SPEED_MULTIPLIER})
        AND ws.outgoing_speed > GREATEST(${SPEED_FLOOR_MPS}, ss.median_speed * ${SPEED_MULTIPLIER})
    )
    UPDATE location_points lp
    SET anomaly = true
    FROM anomalies a
    WHERE lp.id = a.id
      AND lp.anomaly IS NOT TRUE
  `);
  const speedMarked = Number(speedResult.rowCount ?? 0);

  // Clean points are deliberately left NULL. This used to stamp every one of them
  // `anomaly = false` so that "already scanned" could be read off the column, and it
  // dominated this table's write volume: 2,523,006 of 2,572,633 points carried the
  // false marker, so ~98% of each day's rows were rewritten on every run. Because
  // `anomaly` sits in the predicate of idx_location_points_not_anomaly none of those
  // updates could be heap-only — 25 HOT out of 778,620 — so each one also rewrote
  // every index entry for the row.
  //
  // "Has this day been processed?" now lives in `location_processing_days`, which
  // records the day's point count on completion (see cron-processing.ts). Readers are
  // unaffected: they all test `anomaly IS NOT TRUE` or `NULL OR false`, and the
  // partial index predicate is `anomaly IS NOT TRUE`, which already matches NULL.

  return {
    accuracyMarked,
    speedMarked,
    total: accuracyMarked + speedMarked,
  };
}
