/**
 * Anomaly Filter Service
 *
 * Ported from Dawarich: app/services/points/anomaly_filter.rb
 *
 * Two-pass anomaly detection:
 * 1. Accuracy filter: points with accuracy > 100m
 * 2. Speed sandwich test: both incoming AND outgoing speed exceed threshold
 *
 * Uses pure SQL subqueries instead of passing ID arrays to avoid stack overflow
 * when processing large datasets (780k+ points).
 */

import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

// Constants ported from Dawarich
const ACCURACY_THRESHOLD = 100; // meters
const MAX_SPEED_KMH = 1000; // km/h floor → 277.78 m/s
const SPEED_FLOOR_MPS = MAX_SPEED_KMH / 3.6; // 277.78 m/s
const SPEED_MULTIPLIER = 3;

interface AnomalyResult {
  accuracyMarked: number;
  speedMarked: number;
  total: number;
}

/**
 * Run anomaly detection for a user's location points in a date range.
 * Processes day-by-day to keep memory bounded.
 */
export async function runAnomalyDetection(
  userId: string,
  from: Date,
  to: Date,
): Promise<AnomalyResult> {
  const db = getDb();

  // Pass 1: Accuracy filter — single bulk UPDATE
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

  // Pass 2: Speed sandwich test — process day by day
  let speedMarked = 0;
  const cursor = new Date(from);

  while (cursor < to) {
    const dayEnd = new Date(cursor);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    if (dayEnd > to) dayEnd.setTime(to.getTime());

    const marked = await processSpeedDay(db, userId, cursor, dayEnd);
    speedMarked += marked;

    cursor.setTime(dayEnd.getTime());
  }

  return {
    accuracyMarked,
    speedMarked,
    total: accuracyMarked + speedMarked,
  };
}

/**
 * Process a single day for speed-based anomaly detection.
 * All logic runs in SQL — no large arrays passed from JS.
 */
async function processSpeedDay(
  db: ReturnType<typeof getDb>,
  userId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<number> {
  // Single SQL query that:
  // 1. Selects day's points + 5 context points before/after
  // 2. Computes speeds between consecutive points via PostGIS
  // 3. Computes median of normal speeds
  // 4. Applies sandwich test
  // 5. Returns anomaly IDs
  //
  // Then we UPDATE those IDs.

  const result = await db.execute<{
    anomaly_id: string;
    [key: string]: unknown;
  }>(sql`
    WITH
    -- Context + main points for this day
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
    -- Compute speed to/from each point
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
    -- Median of normal speeds (≤ floor)
    speed_stats AS (
      SELECT
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY incoming_speed), 0) AS median_speed
      FROM with_speeds
      WHERE incoming_speed IS NOT NULL
        AND incoming_speed <= ${SPEED_FLOOR_MPS}
    )
    -- Sandwich test: both incoming AND outgoing exceed threshold
    SELECT ws.id AS anomaly_id
    FROM with_speeds ws, speed_stats ss
    WHERE ws.is_main = true
      AND ws.incoming_speed IS NOT NULL
      AND ws.outgoing_speed IS NOT NULL
      AND ws.incoming_speed > GREATEST(${SPEED_FLOOR_MPS}, ss.median_speed * ${SPEED_MULTIPLIER})
      AND ws.outgoing_speed > GREATEST(${SPEED_FLOOR_MPS}, ss.median_speed * ${SPEED_MULTIPLIER})
  `);

  const anomalyIds = result.rows.map((r) => r.anomaly_id);
  if (anomalyIds.length === 0) return 0;

  // Batch update in chunks of 500 to avoid parameter limits
  for (let i = 0; i < anomalyIds.length; i += 500) {
    const chunk = anomalyIds.slice(i, i + 500);
    await db.execute(sql`
      UPDATE location_points
      SET anomaly = true
      WHERE id = ANY(${chunk}::uuid[])
        AND (anomaly IS NOT TRUE)
    `);
  }

  return anomalyIds.length;
}
