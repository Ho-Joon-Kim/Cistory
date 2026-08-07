import type { TimestampedShape } from "@/lib/adapters/map-matching/valhalla";

interface TrackShapeSegment {
  startTime: Date;
  shape: TimestampedShape | null;
}

interface RawTrackPoint {
  lat: number;
  lon: number;
  accuracy: number | null;
  timestamp: Date;
}

interface AssembledTrackPoint {
  lat: number;
  lon: number;
  accuracy: number | null;
  timestamp: Date;
}

interface CoverageWindow {
  start: number;
  end: number;
}

function mergeCoverageWindows(windows: CoverageWindow[]): CoverageWindow[] {
  const merged: CoverageWindow[] = [];
  for (const window of windows.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (!previous || window.start > previous.end) {
      merged.push({ ...window });
    } else {
      previous.end = Math.max(previous.end, window.end);
    }
  }
  return merged;
}

function isCovered(timestamp: number, windows: CoverageWindow[]): boolean {
  let low = 0;
  let high = windows.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const window = windows[middle];
    if (timestamp < window.start) high = middle - 1;
    else if (timestamp > window.end) low = middle + 1;
    else return true;
  }
  return false;
}

/**
 * Combines persisted road-matched geometry with sampled raw GPS points.
 *
 * Coverage is deliberately derived from the timestamps that are actually present in each
 * shape. A segment may contain only a partial match, so using its database start/end window
 * would suppress the raw points needed to bridge the unmatched part of the journey.
 */
export function assembleTrackShape(
  segments: TrackShapeSegment[],
  rawPoints: RawTrackPoint[]
): AssembledTrackPoint[] {
  const snappedPoints: Array<AssembledTrackPoint & { epochMillis: number }> = [];
  const coverage: CoverageWindow[] = [];

  for (const segment of [...segments].sort(
    (left, right) => left.startTime.getTime() - right.startTime.getTime()
  )) {
    let coverageStart = Number.POSITIVE_INFINITY;
    let coverageEnd = Number.NEGATIVE_INFINITY;
    for (const [lat, lon, timestamp] of segment.shape ?? []) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timestamp)) {
        continue;
      }
      coverageStart = Math.min(coverageStart, timestamp);
      coverageEnd = Math.max(coverageEnd, timestamp);
      snappedPoints.push({
        lat,
        lon,
        accuracy: null,
        timestamp: new Date(timestamp),
        epochMillis: timestamp,
      });
    }
    if (Number.isFinite(coverageStart)) {
      coverage.push({ start: coverageStart, end: coverageEnd });
    }
  }

  const mergedCoverage = mergeCoverageWindows(coverage);
  const uncoveredRawPoints = rawPoints.flatMap((point) => {
    const epochMillis = point.timestamp.getTime();
    if (!Number.isFinite(epochMillis) || isCovered(epochMillis, mergedCoverage)) return [];
    return [{ ...point, epochMillis }];
  });

  return [...snappedPoints, ...uncoveredRawPoints]
    .sort((left, right) => left.epochMillis - right.epochMillis)
    .map(({ epochMillis: _epochMillis, ...point }) => point);
}
