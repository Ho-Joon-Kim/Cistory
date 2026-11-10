import { type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { photos } from "@/db/schema";
import { localDayRawSql, timestampParam } from "@/db/sql";
import { toLocalDateString } from "@/lib/utils";

/** A point only counts if it is within this many seconds of the capture time. */
export const PHOTO_LOCATION_WINDOW_SEC = 900;
/** Days after which an unprocessed location day is never revisited by the pipeline. */
export const LOCATION_PIPELINE_WINDOW_DAYS = 45;
export const LOCATION_FILL_LIMIT = 2000;

/**
 * One UPDATE that fills lat/lon from the nearest OwnTracks point (±15 min) for photos
 * that have no GPS location (neither `exif` nor `exif_original`). `location_checked_at` is only stamped once the photo's
 * KST day can no longer gain points: the day's `location_processing_days` row is
 * `completed` with a `point_count` equal to the current count (late OwnTracks flushes
 * change the count), or the day is past the pipeline's candidate window. Unsettled
 * photos are recomputed every tick, which also lets a fill disappear if its point
 * turns anomalous.
 *
 * `captured_at` and `location_points.timestamp` are both UTC wall time, so they
 * compare directly. `now` is bound as a UTC-wall string; never a bare now().
 */
export function buildLocationFillSql(
  userId: string,
  now: Date,
  todayKst: string,
  limit: number
): SQL {
  const day = sql.raw(localDayRawSql("p.captured_at"));
  const nowParam = timestampParam(photos.locationCheckedAt, now);
  // KST day start/end as UTC wall time, so the count can use (user_id, timestamp).
  const dayStartUtc = sql.raw("(td.d::timestamp at time zone 'Asia/Seoul' at time zone 'UTC')");
  const dayEndUtc = sql.raw("((td.d + 1)::timestamp at time zone 'Asia/Seoul' at time zone 'UTC')");
  return sql`
    WITH targets AS (
      SELECT p.id, p.captured_at, ${day} AS d
      FROM photos p
      WHERE p.user_id = ${userId}::uuid
        AND p.details_synced_at IS NOT NULL
        AND p.deleted_at IS NULL
        AND p.location_checked_at IS NULL
        -- Only estimates are ever (re)computed: GPS from Proton's attributes
        -- ('exif') or the original file ('exif_original') is final.
        AND (p.location_source IS NULL OR p.location_source = 'owntracks')
      ORDER BY p.captured_at
      LIMIT ${limit}
    ),
    -- Today and yesterday are always re-processed by the pipeline's candidate scan, so
    -- they never settle via (a); days past the window settle via (b) without a count.
    day_counts AS (
      SELECT td.d, c.n
      FROM (
        SELECT DISTINCT d FROM targets
        WHERE d < ${todayKst}::date - 1
          AND d >= ${todayKst}::date - (${LOCATION_PIPELINE_WINDOW_DAYS})::int
      ) td
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n FROM location_points lp2
        WHERE lp2.user_id = ${userId}::uuid
          AND lp2.timestamp >= ${dayStartUtc}
          AND lp2.timestamp < ${dayEndUtc}
      ) c
    )
    UPDATE photos AS ph
    SET lat = t.lat,
        lon = t.lon,
        location_source = CASE WHEN t.lat IS NULL THEN NULL ELSE 'owntracks' END,
        location_gap_sec = t.gap_sec,
        location_checked_at = CASE WHEN t.settled THEN ${nowParam}::timestamp END,
        updated_at = ${nowParam}::timestamp
    FROM (
      SELECT tg.id, n.lat, n.lon, n.gap_sec,
        (
          tg.d < ${todayKst}::date - (${LOCATION_PIPELINE_WINDOW_DAYS})::int
          OR EXISTS (
            SELECT 1 FROM day_counts dc
            JOIN location_processing_days lpd
              ON lpd.user_id = ${userId}::uuid
             AND lpd.date = to_char(dc.d, 'YYYY-MM-DD')
            WHERE dc.d = tg.d
              AND lpd.status = 'completed'
              AND lpd.point_count = dc.n
          )
        ) AS settled
      FROM targets tg
      LEFT JOIN LATERAL (
        SELECT lp.lat, lp.lon,
          round(abs(extract(epoch FROM lp.timestamp - tg.captured_at)))::int AS gap_sec
        FROM location_points lp
        WHERE lp.user_id = ${userId}::uuid
          AND lp.anomaly IS NOT TRUE
          AND lp.timestamp BETWEEN tg.captured_at - interval '15 minutes'
                               AND tg.captured_at + interval '15 minutes'
        ORDER BY abs(extract(epoch FROM lp.timestamp - tg.captured_at))
        LIMIT 1
      ) n ON true
    ) t
    WHERE ph.id = t.id
      AND (ph.location_source IS NULL OR ph.location_source = 'owntracks')
      AND ph.details_synced_at IS NOT NULL
      AND ph.location_checked_at IS NULL
    RETURNING (t.lat IS NOT NULL) AS filled, (t.settled) AS settled
  `;
}

export async function fillPhotoLocations(
  db: Database,
  userId: string,
  now: Date = new Date()
): Promise<{ updated: number; settled: number }> {
  const result = await db.execute<{ filled: boolean; settled: boolean }>(
    buildLocationFillSql(userId, now, toLocalDateString(now), LOCATION_FILL_LIMIT)
  );
  return {
    updated: result.rows.filter((r) => r.filled).length,
    settled: result.rows.filter((r) => r.settled).length,
  };
}
