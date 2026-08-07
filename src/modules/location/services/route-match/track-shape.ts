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
 * How large a gap between two consecutive shape timestamps can be before it stops looking
 * like ordinary sampling jitter and starts looking like a real hole. OwnTracks samples
 * roughly every 6s, so a healthy matched run's internal gaps sit in that neighborhood — the
 * production case this constant fixes was a single 118s gap in the middle of an otherwise
 * 6-point shape (segment `2cb7d666-5acb-4a4e-beff-1dc206ea3dd9`, 2026-08-01), and three of
 * the ten segments matched so far have an internal gap over 60s. 30s sits five times past
 * normal sampling — comfortably above jitter, comfortably below every observed real hole —
 * so it splits holes apart without fragmenting a healthy run into many one-point "runs",
 * which would reintroduce raw points on top of good snapped geometry and make the line jitter.
 */
const MAX_SHAPE_GAP_MS = 30_000;

/**
 * Combines persisted road-matched geometry with sampled raw GPS points.
 *
 * Coverage is derived from the timestamps actually present in each shape, and split into one
 * window per contiguous run of shape points (see MAX_SHAPE_GAP_MS) rather than one window per
 * segment. A shape is not temporally contiguous just because it spans a segment's full
 * duration: Valhalla drops points it can't snap to a road as `unmatched`, and the adapter's
 * chunk merge drops a failed chunk of a long trace outright — so a shape can have a large hole
 * in the middle while its min/max timestamps still span the whole segment. Treating that whole
 * span as covered suppresses the raw points needed to bridge the hole and draws a straight
 * line across ground the raw GPS actually covered.
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
    const shapePoints = (segment.shape ?? [])
      .filter(
        ([lat, lon, timestamp]) =>
          Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(timestamp)
      )
      .map(([lat, lon, timestamp]) => ({ lat, lon, timestamp }))
      .sort((left, right) => left.timestamp - right.timestamp);

    let runStart: number | null = null;
    let runEnd: number | null = null;
    for (const point of shapePoints) {
      if (runEnd !== null && point.timestamp - runEnd > MAX_SHAPE_GAP_MS) {
        coverage.push({ start: runStart as number, end: runEnd });
        runStart = null;
      }
      if (runStart === null) runStart = point.timestamp;
      runEnd = point.timestamp;

      snappedPoints.push({
        lat: point.lat,
        lon: point.lon,
        accuracy: null,
        timestamp: new Date(point.timestamp),
        epochMillis: point.timestamp,
      });
    }
    if (runStart !== null && runEnd !== null) {
      coverage.push({ start: runStart, end: runEnd });
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
