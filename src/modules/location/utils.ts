import type { LocationData, StayPointData } from "./hooks";
import { distanceM } from "@/lib/geo";

/** Generate a GeoJSON polygon circle from center + radius in meters */
export function createGeoCircle(
  lon: number,
  lat: number,
  radiusM: number,
  steps = 64,
): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const km = radiusM / 1000;
  const latR = (km / 6371) * (180 / Math.PI);
  const lonR = latR / Math.cos((lat * Math.PI) / 180);

  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    coords.push([lon + lonR * Math.cos(angle), lat + latR * Math.sin(angle)]);
  }

  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

export interface MovingSegment {
  type: "moving";
  coords: [number, number][]; // [lon, lat]
  startTime: string;
  endTime: string;
}

export interface StayingSegment {
  type: "staying";
  stayPoint: StayPointData;
}

export type TimelineSegment = MovingSegment | StayingSegment;

/**
 * Split location points into moving/staying segments based on stay points.
 *
 * 1. Sort stayPoints by startTime
 * 2. Location points within a stayPoint's time range → staying segment
 * 3. Location points outside → moving segment (with coordinates)
 */
export function segmentLocations(
  locations: LocationData[],
  stayPoints: StayPointData[],
): TimelineSegment[] {
  if (locations.length === 0) return [];
  if (stayPoints.length === 0) {
    return [
      {
        type: "moving",
        coords: locations.map((l) => [l.lon, l.lat]),
        startTime: locations[0].timestamp,
        endTime: locations[locations.length - 1].timestamp,
      },
    ];
  }

  const sorted = [...stayPoints].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  const segments: TimelineSegment[] = [];
  let locIdx = 0;

  for (const sp of sorted) {
    const spStart = new Date(sp.startTime).getTime();
    const spEnd = new Date(sp.endTime).getTime();

    // Collect moving points before this stay
    const movingCoords: [number, number][] = [];
    let movingStart: string | null = null;
    let movingEnd: string | null = null;

    while (locIdx < locations.length) {
      const t = new Date(locations[locIdx].timestamp).getTime();
      if (t < spStart) {
        if (!movingStart) movingStart = locations[locIdx].timestamp;
        movingEnd = locations[locIdx].timestamp;
        movingCoords.push([locations[locIdx].lon, locations[locIdx].lat]);
        locIdx++;
      } else {
        break;
      }
    }

    if (movingCoords.length > 0 && movingStart && movingEnd) {
      segments.push({
        type: "moving",
        coords: movingCoords,
        startTime: movingStart,
        endTime: movingEnd,
      });
    }

    // Add the staying segment
    segments.push({ type: "staying", stayPoint: sp });

    // Skip location points within the stay period
    while (locIdx < locations.length) {
      const t = new Date(locations[locIdx].timestamp).getTime();
      if (t <= spEnd) {
        locIdx++;
      } else {
        break;
      }
    }
  }

  // Remaining moving points after last stay
  if (locIdx < locations.length) {
    const movingCoords: [number, number][] = [];
    const movingStart = locations[locIdx].timestamp;
    while (locIdx < locations.length) {
      movingCoords.push([locations[locIdx].lon, locations[locIdx].lat]);
      locIdx++;
    }
    if (movingCoords.length > 0) {
      segments.push({
        type: "moving",
        coords: movingCoords,
        startTime: movingStart,
        endTime: locations[locations.length - 1].timestamp,
      });
    }
  }

  return segments;
}

/** Compute total Haversine distance of a moving segment's coords (metres). coords are [lon, lat]. */
export function computeSegmentDistance(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    // coords are [lon, lat], distanceM expects (lat1, lon1, lat2, lon2)
    total += distanceM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return total;
}

/** Find the segment index matching a given stay point by startTime + coordinates */
export function findSegmentIndexByStayPoint(
  segments: TimelineSegment[],
  sp: StayPointData,
): number {
  return segments.findIndex(
    (seg) =>
      seg.type === "staying" &&
      seg.stayPoint.startTime === sp.startTime &&
      seg.stayPoint.lat === sp.lat &&
      seg.stayPoint.lon === sp.lon,
  );
}
