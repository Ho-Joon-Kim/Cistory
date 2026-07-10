import { distanceM } from "@/lib/geo";
import type { LocationData, StayPointData } from "./hooks";
import { segmentLocations } from "./utils";

const MOVING_BUDGET_MS = 42_000;
const MIN_MOVING_SEGMENT_MS = 1_200;
const STAY_DURATION_MS = 1_000;

export type ReplayPhase = "moving" | "staying";

export interface ReplayFrame {
  coord: { lat: number; lon: number };
  timestamp: string;
  recordedTime: number;
  progress: number;
  segmentIndex: number;
  phase: ReplayPhase;
}

interface MovingReplayEvent {
  type: "moving";
  startMs: number;
  durationMs: number;
  segmentIndex: number;
  coords: [number, number][];
  times: number[];
  cumulativeDistances: number[];
  distance: number;
}

interface StayingReplayEvent {
  type: "staying";
  startMs: number;
  durationMs: number;
  segmentIndex: number;
  coord: [number, number];
  startTime: number;
  endTime: number;
}

type ReplayEvent = MovingReplayEvent | StayingReplayEvent;

export interface ReplayTimeline {
  durationMs: number;
  events: ReplayEvent[];
}

function cumulativeDistances(coords: [number, number][]): number[] {
  const result = [0];
  for (let index = 1; index < coords.length; index++) {
    const previous = coords[index - 1];
    const current = coords[index];
    result.push(result[index - 1] + distanceM(previous[1], previous[0], current[1], current[0]));
  }
  return result;
}

/** Build a compact, presentation-oriented timeline from a day's recorded route. */
export function buildReplayTimeline(
  locations: LocationData[],
  stayPoints: StayPointData[]
): ReplayTimeline {
  const sortedLocations = [...locations].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const segments = segmentLocations(sortedLocations, stayPoints);
  const movingMetadata = new Map<
    number,
    { cumulativeDistances: number[]; distance: number; recordedDuration: number }
  >();

  let totalDistance = 0;
  let totalRecordedDuration = 0;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.type !== "moving" || segment.coords.length < 2) continue;
    const distances = cumulativeDistances(segment.coords);
    const distance = distances.at(-1) ?? 0;
    const recordedDuration = Math.max(
      0,
      new Date(segment.endTime).getTime() - new Date(segment.startTime).getTime()
    );
    movingMetadata.set(index, {
      cumulativeDistances: distances,
      distance,
      recordedDuration,
    });
    totalDistance += distance;
    totalRecordedDuration += recordedDuration;
  }

  const events: ReplayEvent[] = [];
  let cursorMs = 0;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.type === "moving") {
      const metadata = movingMetadata.get(index);
      if (!metadata) continue;
      const weight =
        totalDistance > 0
          ? metadata.distance / totalDistance
          : metadata.recordedDuration / Math.max(1, totalRecordedDuration);
      const durationMs = Math.max(MIN_MOVING_SEGMENT_MS, MOVING_BUDGET_MS * weight);
      events.push({
        type: "moving",
        startMs: cursorMs,
        durationMs,
        segmentIndex: index,
        coords: segment.coords,
        times: segment.timestamps.map((timestamp) => new Date(timestamp).getTime()),
        cumulativeDistances: metadata.cumulativeDistances,
        distance: metadata.distance,
      });
      cursorMs += durationMs;
      continue;
    }

    const startTime = new Date(segment.stayPoint.startTime).getTime();
    const endTime = new Date(segment.stayPoint.endTime).getTime();
    events.push({
      type: "staying",
      startMs: cursorMs,
      durationMs: STAY_DURATION_MS,
      segmentIndex: index,
      coord: [segment.stayPoint.lon, segment.stayPoint.lat],
      startTime,
      endTime,
    });
    cursorMs += STAY_DURATION_MS;
  }

  return { durationMs: cursorMs, events };
}

function interpolateMovingEvent(
  event: MovingReplayEvent,
  localProgress: number
): { coord: { lat: number; lon: number }; recordedTime: number } {
  if (event.distance <= 0) {
    const recordedTime =
      event.times[0] + (event.times[event.times.length - 1] - event.times[0]) * localProgress;
    return {
      coord: { lon: event.coords[0][0], lat: event.coords[0][1] },
      recordedTime,
    };
  }

  // Ease only at the boundaries of a movement scene. Distance within the
  // route remains uniform, independent of irregular GPS sampling intervals.
  const eased = localProgress * localProgress * (3 - 2 * localProgress);
  const targetDistance = event.distance * eased;
  let upperIndex = event.cumulativeDistances.findIndex((value) => value >= targetDistance);
  if (upperIndex <= 0) upperIndex = 1;
  if (upperIndex >= event.coords.length) upperIndex = event.coords.length - 1;

  const lowerIndex = upperIndex - 1;
  const lowerDistance = event.cumulativeDistances[lowerIndex];
  const upperDistance = event.cumulativeDistances[upperIndex];
  const ratio =
    upperDistance > lowerDistance
      ? (targetDistance - lowerDistance) / (upperDistance - lowerDistance)
      : 0;
  const lower = event.coords[lowerIndex];
  const upper = event.coords[upperIndex];
  const lowerTime = event.times[lowerIndex];
  const upperTime = event.times[upperIndex];

  return {
    coord: {
      lon: lower[0] + (upper[0] - lower[0]) * ratio,
      lat: lower[1] + (upper[1] - lower[1]) * ratio,
    },
    recordedTime: lowerTime + (upperTime - lowerTime) * ratio,
  };
}

/** Resolve the visual and recorded state at a normalized presentation progress. */
export function getReplayFrame(timeline: ReplayTimeline, progress: number): ReplayFrame | null {
  if (timeline.events.length === 0 || timeline.durationMs <= 0) return null;
  const clamped = Math.min(1, Math.max(0, progress));
  const playheadMs = clamped * timeline.durationMs;
  const event =
    timeline.events.find((candidate) => playheadMs < candidate.startMs + candidate.durationMs) ??
    timeline.events[timeline.events.length - 1];
  const localProgress = Math.min(1, Math.max(0, (playheadMs - event.startMs) / event.durationMs));

  if (event.type === "moving") {
    const { coord, recordedTime } = interpolateMovingEvent(event, localProgress);
    return {
      coord,
      recordedTime,
      timestamp: new Date(recordedTime).toISOString(),
      progress: clamped,
      segmentIndex: event.segmentIndex,
      phase: "moving",
    };
  }

  const recordedTime = event.startTime + (event.endTime - event.startTime) * localProgress;
  return {
    coord: { lon: event.coord[0], lat: event.coord[1] },
    recordedTime,
    timestamp: new Date(recordedTime).toISOString(),
    progress: clamped,
    segmentIndex: event.segmentIndex,
    phase: "staying",
  };
}
