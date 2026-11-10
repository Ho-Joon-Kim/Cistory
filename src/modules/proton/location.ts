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
 * that have no EXIF location. `location_checked_at` is only stamped once the photo's
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
  const pointDay = sql.raw(localDayRawSql("lp2.timestamp"));
  const nowParam = timestampParam(photos.locationCheckedAt, now);
  return sql`
    UPDATE photos AS ph
    SET lat = t.lat,
        lon = t.lon,
        location_source = CASE WHEN t.lat IS NULL THEN NULL ELSE 'owntracks' END,
        location_gap_sec = t.gap_sec,
        location_checked_at = CASE WHEN t.settled THEN ${nowParam}::timestamp END,
        updated_at = ${nowParam}::timestamp
    FROM (
      SELECT p.id, n.lat, n.lon, n.gap_sec,
        (
          EXISTS (
            SELECT 1 FROM location_processing_days lpd
            WHERE lpd.user_id = ${userId}::uuid
              AND lpd.date = to_char(${day}, 'YYYY-MM-DD')
              AND lpd.status = 'completed'
              AND lpd.point_count = (
                SELECT count(*) FROM location_points lp2
                WHERE lp2.user_id = ${userId}::uuid AND ${pointDay} = ${day}
              )
          )
          OR ${day} < ${todayKst}::date - (${LOCATION_PIPELINE_WINDOW_DAYS})::int
        ) AS settled
      FROM photos p
      LEFT JOIN LATERAL (
        SELECT lp.lat, lp.lon,
          round(abs(extract(epoch FROM lp.timestamp - p.captured_at)))::int AS gap_sec
        FROM location_points lp
        WHERE lp.user_id = ${userId}::uuid
          AND lp.anomaly IS NOT TRUE
          AND lp.timestamp BETWEEN p.captured_at - interval '15 minutes'
                               AND p.captured_at + interval '15 minutes'
        ORDER BY abs(extract(epoch FROM lp.timestamp - p.captured_at))
        LIMIT 1
      ) n ON true
      WHERE p.user_id = ${userId}::uuid
        AND p.details_synced_at IS NOT NULL
        AND p.deleted_at IS NULL
        AND p.location_checked_at IS NULL
        AND p.location_source IS DISTINCT FROM 'exif'
      ORDER BY p.captured_at
      LIMIT ${limit}
    ) t
    WHERE ph.id = t.id
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
