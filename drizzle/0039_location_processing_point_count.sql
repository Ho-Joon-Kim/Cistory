ALTER TABLE "location_processing_days" ADD COLUMN "point_count" integer;--> statement-breakpoint
-- Backfill the days that predate this table so `location_processing_days` becomes the
-- single source of truth for "has this day been through the pipeline?".
--
-- Until now that answer lived in `location_points.anomaly`: NULL meant unscanned,
-- false meant scanned-and-clean. Keeping it meant rewriting ~98% of every day's rows
-- daily (2,523,006 of 2,572,633 points carry `false`), and because `anomaly` sits in
-- the predicate of idx_location_points_not_anomaly those updates can never be
-- heap-only — 25 HOT out of 778,620.
--
-- This table only started recording on 2026-06-07 (migration 0032) and covers 54 of
-- the 497 days that have points, so the marker cannot be retired until the rest is
-- reconstructed. The evidence for reconstruction is the very column being retired,
-- which is why this backfill has to land BEFORE the scans switch over and long before
-- `SET anomaly = false` is removed.
--
-- A day qualifies as completed only when every one of its points was scanned
-- (`count(*) FILTER (WHERE anomaly IS NULL) = 0`). Days with any unscanned point are
-- left absent on purpose, so the pipeline still picks them up.
--
-- `point_count` is recorded from the current count, which is exact for these rows
-- precisely because the day is fully scanned — had points arrived after the pipeline
-- ran, they would carry anomaly IS NULL and the day would not qualify here.
--
-- `completed_at` stays NULL: the real completion time was never recorded for these
-- days, and inventing one would be worse than admitting it is unknown. Nothing reads
-- it; `point_count` is what the freshness check compares.
INSERT INTO "location_processing_days"
  (user_id, date, status, processing_started_at, completed_at, attempt_count, point_count)
SELECT per_day.user_id,
       to_char(per_day.d, 'YYYY-MM-DD'),
       'completed',
       NULL,
       NULL,
       1,
       per_day.total::int
FROM (
  SELECT user_id,
         (timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS d,
         count(*) AS total,
         count(*) FILTER (WHERE anomaly IS NULL) AS unscanned
  FROM location_points
  GROUP BY user_id, (timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
) per_day
WHERE per_day.unscanned = 0
ON CONFLICT (user_id, date) DO NOTHING;--> statement-breakpoint
-- Rows this table already owned have no point_count yet. Fill in the ones that are
-- completed and fully scanned; anything still in flight is left NULL, which the
-- freshness check treats as "unknown, re-examine".
UPDATE "location_processing_days" p
SET point_count = per_day.total::int
FROM (
  SELECT user_id,
         (timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS d,
         count(*) AS total,
         count(*) FILTER (WHERE anomaly IS NULL) AS unscanned
  FROM location_points
  GROUP BY user_id, (timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
) per_day
WHERE p.point_count IS NULL
  AND p.status = 'completed'
  AND p.user_id = per_day.user_id
  AND p.date = to_char(per_day.d, 'YYYY-MM-DD')
  AND per_day.unscanned = 0;
