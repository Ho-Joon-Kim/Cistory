export interface TrackShapeSegment {
  startTime: Date;
  endTime: Date;
  shape: Array<[number, number, number]> | null;
}

export interface RawTrackPoint {
  lat: number;
  lon: number;
  accuracy: number | null;
  timestamp: Date;
}

export interface AssembledTrackPoint {
  lat: number;
  lon: number;
  accuracy: number | null;
  timestamp: string;
}

interface CoverageWindow {
  start: number;
  end: number;
}

function isCovered(timestamp: number, windows: CoverageWindow[]): boolean {
  return windows.some((window) => timestamp >= window.start && timestamp <= window.end);
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
        timestamp: new Date(timestamp).toISOString(),
        epochMillis: timestamp,
      });
    }
    if (Number.isFinite(coverageStart)) {
      coverage.push({ start: coverageStart, end: coverageEnd });
    }
  }

  const uncoveredRawPoints = rawPoints.flatMap((point) => {
    const epochMillis = point.timestamp.getTime();
    if (!Number.isFinite(epochMillis) || isCovered(epochMillis, coverage)) return [];
    return [{ ...point, timestamp: point.timestamp.toISOString(), epochMillis }];
  });

  return [...snappedPoints, ...uncoveredRawPoints]
    .sort((left, right) => left.epochMillis - right.epochMillis)
    .map(({ epochMillis: _epochMillis, ...point }) => point);
}
