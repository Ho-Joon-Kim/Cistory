import type { LocationData, StayPointData } from "./hooks";

/** Generate a GeoJSON polygon circle from center + radius in meters */
export function createGeoCircle(
  lon: number,
  lat: number,
  radiusM: number,
  steps = 64
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
  timestamps: string[];
  startTime: string;
  endTime: string;
}

export interface StayingSegment {
  type: "staying";
  stayPoint: StayPointData;
}

export type TimelineSegment = MovingSegment | StayingSegment;

function takeLocationsBefore(
  locations: LocationData[],
  startIndex: number,
  endTime: number
): { points: LocationData[]; nextIndex: number } {
  let nextIndex = startIndex;
  while (
    nextIndex < locations.length &&
    new Date(locations[nextIndex].timestamp).getTime() < endTime
  ) {
    nextIndex++;
  }
  return { points: locations.slice(startIndex, nextIndex), nextIndex };
}

function takeLocationsThrough(
  locations: LocationData[],
  startIndex: number,
  endTime: number
): { points: LocationData[]; nextIndex: number } {
  let nextIndex = startIndex;
  while (
    nextIndex < locations.length &&
    new Date(locations[nextIndex].timestamp).getTime() <= endTime
  ) {
    nextIndex++;
  }
  return { points: locations.slice(startIndex, nextIndex), nextIndex };
}

function appendMovingSegment(segments: TimelineSegment[], points: LocationData[]): void {
  if (points.length < 2) return;
  segments.push({
    type: "moving",
    coords: points.map((point) => [point.lon, point.lat]),
    timestamps: points.map((point) => point.timestamp),
    startTime: points[0].timestamp,
    endTime: points[points.length - 1].timestamp,
  });
}

/**
 * Split location points into moving/staying segments based on stay points.
 *
 * 1. Sort stayPoints by startTime
 * 2. Location points within a stayPoint's time range → staying segment
 * 3. Location points outside → moving segment (with coordinates)
 */
export function segmentLocations(
  locations: LocationData[],
  stayPoints: StayPointData[]
): TimelineSegment[] {
  if (locations.length === 0) return [];
  if (stayPoints.length === 0) {
    return [
      {
        type: "moving",
        coords: locations.map((l) => [l.lon, l.lat]),
        timestamps: locations.map((location) => location.timestamp),
        startTime: locations[0].timestamp,
        endTime: locations[locations.length - 1].timestamp,
      },
    ];
  }

  const sorted = [...stayPoints].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const segments: TimelineSegment[] = [];
  let locIdx = 0;
  let departureAnchor: LocationData | null = null;

  for (const sp of sorted) {
    const spStart = new Date(sp.startTime).getTime();
    const spEnd = new Date(sp.endTime).getTime();

    // Keep the last point from the previous stay as the departure anchor. This
    // connects the route out of a stay without drawing all stationary points.
    const beforeStay = takeLocationsBefore(locations, locIdx, spStart);
    locIdx = beforeStay.nextIndex;
    const movingPoints = departureAnchor
      ? [departureAnchor, ...beforeStay.points]
      : beforeStay.points;

    // Preserve only the first and last raw points in the stay. The first point
    // completes the arrival line; the last becomes the next departure line's
    // anchor. Interior stationary points remain hidden.
    const withinStay = takeLocationsThrough(locations, locIdx, spEnd);
    locIdx = withinStay.nextIndex;
    const arrivalAnchor = withinStay.points[0];
    departureAnchor = withinStay.points.at(-1) ?? null;
    if (arrivalAnchor) movingPoints.push(arrivalAnchor);
    appendMovingSegment(segments, movingPoints);

    // Add the staying segment
    segments.push({ type: "staying", stayPoint: sp });
  }

  // Remaining moving points after last stay
  const remaining = locations.slice(locIdx);
  appendMovingSegment(segments, departureAnchor ? [departureAnchor, ...remaining] : remaining);

  return segments;
}

interface ClippedMovingSegments {
  lines: [number, number][][];
  segmentIndices: number[];
}

/** Return only the route geometry reached at the supplied replay time. */
export function clipMovingSegmentsAtTime(
  segments: TimelineSegment[],
  replayTime: number
): ClippedMovingSegments {
  const lines: [number, number][][] = [];
  const segmentIndices: number[] = [];

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    if (segment.type !== "moving" || segment.coords.length < 2) continue;

    const startTime = new Date(segment.startTime).getTime();
    const endTime = new Date(segment.endTime).getTime();
    if (replayTime < startTime) break;

    if (replayTime >= endTime) {
      lines.push(segment.coords);
      segmentIndices.push(segmentIndex);
      continue;
    }

    const pointTimes = segment.timestamps.map((timestamp) => new Date(timestamp).getTime());
    const upperIndex = pointTimes.findIndex((time) => time > replayTime);
    if (upperIndex <= 0) break;

    const lowerIndex = upperIndex - 1;
    const lowerTime = pointTimes[lowerIndex];
    const upperTime = pointTimes[upperIndex];
    const ratio = upperTime > lowerTime ? (replayTime - lowerTime) / (upperTime - lowerTime) : 0;
    const lowerCoord = segment.coords[lowerIndex];
    const upperCoord = segment.coords[upperIndex];
    const interpolated: [number, number] = [
      lowerCoord[0] + (upperCoord[0] - lowerCoord[0]) * ratio,
      lowerCoord[1] + (upperCoord[1] - lowerCoord[1]) * ratio,
    ];

    lines.push([...segment.coords.slice(0, upperIndex), interpolated]);
    segmentIndices.push(segmentIndex);
    break;
  }

  return { lines, segmentIndices };
}

/** Find the segment index matching a given stay point by startTime + coordinates */
export function findSegmentIndexByStayPoint(
  segments: TimelineSegment[],
  sp: StayPointData
): number {
  return segments.findIndex(
    (seg) =>
      seg.type === "staying" &&
      seg.stayPoint.startTime === sp.startTime &&
      seg.stayPoint.lat === sp.lat &&
      seg.stayPoint.lon === sp.lon
  );
}
