import { distanceM } from "@/lib/geo";

export const MAX_ROUTE_POINTS = 1000;

export interface RoutePointRow {
  lat: number;
  lon: number;
  accuracy: number | null;
  timestamp: Date;
}

/** Mirrors the SQL window predicate, kept pure so large-point bounds are testable. */
export function getSampledRowNumbers(totalCount: number, cap: number): number[] {
  if (totalCount <= 0 || cap <= 0) return [];
  if (totalCount <= cap) return Array.from({ length: totalCount }, (_, index) => index + 1);
  if (cap === 1) return [1];
  if (cap === 2) return [1, totalCount];

  const step = Math.max(1, Math.ceil((totalCount - 2) / (cap - 2)));
  const sampled = [1];
  for (let rowNumber = 2; rowNumber < totalCount; rowNumber += step) {
    sampled.push(rowNumber);
  }
  sampled.push(totalCount);
  return sampled;
}

export function simplifyRoutePoints(rows: RoutePointRow[], minDistanceM: number): RoutePointRow[] {
  if (rows.length <= 2) return rows;
  const simplified: RoutePointRow[] = [rows[0]];
  for (const row of rows.slice(1, -1)) {
    const previous = simplified[simplified.length - 1];
    if (distanceM(previous.lat, previous.lon, row.lat, row.lon) >= minDistanceM) {
      simplified.push(row);
    }
  }
  simplified.push(rows[rows.length - 1]);
  return simplified;
}
