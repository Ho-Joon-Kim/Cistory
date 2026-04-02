-- PostGIS Extension + Geography Column + Trigger
-- This migration must run AFTER 0012 (schema changes for anomaly/city/countryName columns)

-- 1. Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Add geography column to location_points
ALTER TABLE location_points
  ADD COLUMN IF NOT EXISTS lonlat geography(Point, 4326);

-- 3. Backfill existing data
UPDATE location_points
  SET lonlat = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
  WHERE lonlat IS NULL;

-- 4. GiST spatial index for spatial queries
CREATE INDEX IF NOT EXISTS idx_location_points_lonlat
  ON location_points USING gist (lonlat);

-- 5. Partial index for non-anomaly points (optimizes filtered queries)
CREATE INDEX IF NOT EXISTS idx_location_points_not_anomaly
  ON location_points (user_id, timestamp) WHERE anomaly IS NOT TRUE;

-- 6. Trigger to auto-populate lonlat on INSERT/UPDATE
CREATE OR REPLACE FUNCTION set_lonlat() RETURNS trigger AS $$
BEGIN
  NEW.lonlat := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_location_points_lonlat ON location_points;
CREATE TRIGGER trg_location_points_lonlat
  BEFORE INSERT OR UPDATE OF lat, lon ON location_points
  FOR EACH ROW EXECUTE FUNCTION set_lonlat();
