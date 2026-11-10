import { prefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

/**
 * Camera animation length that honours `prefers-reduced-motion`: a reduced-motion
 * user gets an instant jump instead of a fly/ease across the map. Read at call
 * time so every camera move sees the current OS setting.
 */
export function cameraDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

export type LngLatBounds = [[number, number], [number, number]];

/** The box around every `[lon, lat]` point, or null when there are none. */
export function boundsOf(points: readonly (readonly [number, number])[]): LngLatBounds | null {
  if (points.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

/**
 * Identity of a framing: the camera is re-fitted only when this changes, so a
 * refetch that returns the same day (or a new point inside the current box)
 * never moves the map. ~1 m precision keeps float noise from counting as change.
 */
export function boundsKey(date: string, bounds: LngLatBounds | null): string | null {
  if (!bounds) return null;
  return `${date}:${bounds
    .flat()
    .map((n) => n.toFixed(5))
    .join(",")}`;
}
