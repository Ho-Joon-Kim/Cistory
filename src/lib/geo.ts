/**
 * Canonical coordinate precision used by every ingestion path that writes to
 * `location_points`. The unique index `(user_id, timestamp, lat, lon)` is a
 * float comparison, so different sources of the same physical point (OwnTracks
 * vs Google Takeout) must round to the same number of decimals to dedup
 * correctly. 6 decimals ≈ 11cm, well below GPS accuracy, and matches the
 * resolution Google Takeout already exports.
 */
export const COORD_DECIMALS = 6;

const COORD_FACTOR = 10 ** COORD_DECIMALS;

/** Round a coordinate to the canonical precision used by `location_points`. */
export function roundCoord(value: number): number {
  return Math.round(value * COORD_FACTOR) / COORD_FACTOR;
}

/**
 * Grid-cell precision used by `place_cache.lat_key`/`lon_key` — deliberately
 * coarser than `roundCoord`'s 6-decimal `location_points` precision. 3
 * decimals ≈ 111m, coarse enough that nearby visits share one geocode/cache
 * entry. This constant and `placeCacheCoordKey` must NOT be confused with
 * `COORD_DECIMALS`/`roundCoord` above — using the 6-decimal function against
 * `place_cache` silently matches zero rows (confirmed empirically: sampled
 * `place_cache` rows hold values like `37.522`/`126.924`, i.e. 3 decimal
 * places, not 6).
 */
export const PLACE_CACHE_COORD_DECIMALS = 3;

const PLACE_CACHE_COORD_FACTOR = 10 ** PLACE_CACHE_COORD_DECIMALS;

/**
 * Round a coordinate to the `place_cache` grid-key precision (3 decimals).
 * This is the join key `visit-persister.ts` and `track-persister.ts` use to
 * look up `place_cache` rows by `(lat_key, lon_key)` — distinct from
 * `roundCoord` above, which is 6 decimals for `location_points`. See that
 * function's doc comment and `PLACE_CACHE_COORD_DECIMALS` for why the two
 * must never be swapped.
 */
export function placeCacheCoordKey(value: number): number {
  return Math.round(value * PLACE_CACHE_COORD_FACTOR) / PLACE_CACHE_COORD_FACTOR;
}

/** Haversine distance between two coordinates in metres */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
