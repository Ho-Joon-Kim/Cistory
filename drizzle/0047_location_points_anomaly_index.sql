-- Partial index for the per-user anomaly count on /settings (location-summary).
-- Without it that count is a parallel seq scan of all of location_points
-- (~260 ms at 4M rows). Only ~1.5% of rows match, so the index is small, and
-- `anomaly` already sits in idx_location_points_not_anomaly's predicate, so the
-- daily anomaly UPDATE loses no HOT eligibility it had. Built non-concurrently
-- (migrations run in a transaction): a one-off scan that briefly blocks writes.
CREATE INDEX "idx_location_points_anomaly" ON "location_points" USING btree ("user_id") WHERE "location_points"."anomaly" = true;