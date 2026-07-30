-- Make autovacuum keep up with location_points, which the location pipeline
-- rewrites about as often as OwnTracks appends to it.
--
-- Measured 2026-07-30: 715,870 inserts against 778,620 updates, and only 25 of those
-- updates were HOT. `anomaly-filter.ts` stamps `SET anomaly = true/false` over each
-- day's points, and `anomaly` sits in the predicate of the partial index
-- `idx_location_points_not_anomaly`, so the update can never be heap-only — every one
-- writes a new heap tuple plus fresh entries in all five indexes. Lowering fillfactor
-- would NOT help for that reason.
--
-- With the global 0.2 scale factor the vacuum threshold on a 2.57M-row table is
-- ~515k dead tuples, which the table had never once reached in the direction that
-- matters: autovacuum had run exactly once, and 395,410 dead tuples (15.3%, ~205 MB)
-- were sitting unreclaimed. At ~13k dead tuples/day, 0.02 puts the threshold near
-- 51k, so vacuum runs every few days and bloat stays around 2% instead of 15%+.
--
-- Storage cost is nil — VACUUM (not FULL) returns space for reuse inside the table
-- rather than to the OS, so this bounds growth rather than shrinking the file.
--
-- The deeper fix is to stop the daily rewrite altogether: the partial index predicate
-- is `anomaly IS NOT TRUE`, which already matches NULL, so `SET anomaly = false`
-- earns nothing for the index and exists only as the "day processed" marker for the
-- `anomaly IS NULL` scan. Migration 0032 added `location_processing_days`, which
-- tracks exactly that. Retiring the marker would remove roughly half these updates,
-- but it changes pipeline correctness and is deliberately left out of this migration.
ALTER TABLE "location_points" SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.05
);
