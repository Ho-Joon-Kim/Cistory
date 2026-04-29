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
