export type Bbox = [number, number, number, number];

const WORLD_BOUNDS: Bbox = [-180, -90, 180, 90];

/**
 * Expand a viewport so small pans and zoom changes can reuse the same subway
 * payload instead of replacing the GeoJSON at every exact map boundary.
 */
export function expandBbox(bbox: Bbox, paddingRatio = 0.75): Bbox {
  const [west, south, east, north] = bbox;
  const longitudePadding = (east - west) * paddingRatio;
  const latitudePadding = (north - south) * paddingRatio;

  return [
    Math.max(WORLD_BOUNDS[0], west - longitudePadding),
    Math.max(WORLD_BOUNDS[1], south - latitudePadding),
    Math.min(WORLD_BOUNDS[2], east + longitudePadding),
    Math.min(WORLD_BOUNDS[3], north + latitudePadding),
  ];
}

export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
  );
}
