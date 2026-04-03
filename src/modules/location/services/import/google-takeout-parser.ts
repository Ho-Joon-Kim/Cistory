/**
 * Google Takeout Location History Parser
 *
 * Supports two Google formats:
 * 1. Records.json — { locations: [{ latitudeE7, longitudeE7, timestamp, ... }] }
 * 2. Phone Takeout — { semanticSegments: [...] } or { rawSignals: [...] }
 *
 * Ported from Dawarich:
 * - app/services/google_maps/records_importer.rb
 * - app/services/google_maps/phone_takeout_importer.rb
 */

import type { ParsedPoint } from "./types";

function parseTimestamp(val: unknown): Date | null {
  if (typeof val === "string") {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof val === "number") {
    const ms = val < 1e10 ? val * 1000 : val;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Parse Google Records.json (latitudeE7 / longitudeE7 format)
 */
function parseRecords(locations: unknown[]): ParsedPoint[] {
  const points: ParsedPoint[] = [];

  for (const loc of locations) {
    const l = loc as Record<string, unknown>;
    const latE7 = l.latitudeE7 as number | undefined;
    const lonE7 = l.longitudeE7 as number | undefined;

    if (latE7 == null || lonE7 == null) continue;

    const lat = latE7 / 1e7;
    const lon = lonE7 / 1e7;

    const timestamp =
      parseTimestamp(l.timestamp) ?? parseTimestamp(l.timestampMs);
    if (!timestamp) continue;

    points.push({
      lat,
      lon,
      altitude: l.altitude != null ? Number(l.altitude) : null,
      velocity: l.velocity != null ? Number(l.velocity) : null,
      accuracy: l.accuracy != null ? Number(l.accuracy) : null,
      timestamp,
    });
  }

  return points;
}

/**
 * Parse Phone Takeout semanticSegments format
 */
function parseSemanticSegments(segments: unknown[]): ParsedPoint[] {
  const points: ParsedPoint[] = [];

  for (const seg of segments) {
    const s = seg as Record<string, unknown>;

    // Visit type
    const visit = s.visit as Record<string, unknown> | undefined;
    if (visit) {
      const topCandidate = visit.topCandidate as
        | Record<string, unknown>
        | undefined;
      const placeLocation = topCandidate?.placeLocation as
        | Record<string, unknown>
        | undefined;
      if (placeLocation) {
        const parsed = parseLatLng(placeLocation.latLng);
        if (parsed) {
          const ts =
            parseTimestamp(
              (s.startTime as string) ?? (visit.startTime as string),
            );
          if (ts) {
            points.push({
              ...parsed,
              altitude: null,
              velocity: null,
              accuracy: null,
              timestamp: ts,
            });
          }
        }
      }
    }

    // Activity type
    const activity = s.activity as Record<string, unknown> | undefined;
    if (activity) {
      const start = activity.start as Record<string, unknown> | undefined;
      const end = activity.end as Record<string, unknown> | undefined;

      for (const point of [start, end]) {
        if (!point?.latLng) continue;
        const parsed = parseLatLng(point.latLng);
        if (!parsed) continue;

        const ts = parseTimestamp(point.timestamp);
        if (!ts) continue;

        points.push({
          ...parsed,
          altitude: null,
          velocity: null,
          accuracy: null,
          timestamp: ts,
        });
      }

      // Timeline path points
      const timelinePath = activity.timelinePath as unknown[] | undefined;
      if (timelinePath) {
        for (const tp of timelinePath) {
          const tpObj = tp as Record<string, unknown>;
          const parsed = parseLatLng(tpObj.point);
          if (!parsed) continue;

          const ts = parseTimestamp(tpObj.timestamp);
          if (!ts) continue;

          points.push({
            ...parsed,
            altitude: null,
            velocity: null,
            accuracy: null,
            timestamp: ts,
          });
        }
      }
    }
  }

  return points;
}

/**
 * Parse "geo:lat,lng" or "lat°, lng°" coordinate strings
 */
function parseLatLng(
  val: unknown,
): { lat: number; lon: number } | null {
  if (typeof val !== "string") return null;

  // Strip "geo:" prefix and degree symbols
  const cleaned = val.replace(/^geo:/, "").replace(/°/g, "").trim();
  const parts = cleaned.split(",").map((s) => s.trim());
  if (parts.length < 2) return null;

  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  return { lat, lon };
}

export function parseGoogleTakeout(json: unknown): ParsedPoint[] {
  const data = json as Record<string, unknown>;
  if (!data || typeof data !== "object") return [];

  let points: ParsedPoint[] = [];

  // Format 1: Records.json — { locations: [...] }
  if (Array.isArray(data.locations)) {
    points = parseRecords(data.locations);
  }

  // Format 2: Phone Takeout — { semanticSegments: [...] }
  if (Array.isArray(data.semanticSegments)) {
    points = points.concat(parseSemanticSegments(data.semanticSegments));
  }

  // Format 3: rawSignals
  if (Array.isArray(data.rawSignals)) {
    for (const sig of data.rawSignals) {
      const s = sig as Record<string, unknown>;
      const position = s.position as Record<string, unknown> | undefined;
      if (!position?.LatLng) continue;

      const parsed = parseLatLng(position.LatLng);
      if (!parsed) continue;

      const ts = parseTimestamp(s.timestamp);
      if (!ts) continue;

      points.push({
        ...parsed,
        altitude: null,
        velocity: null,
        accuracy:
          position.accuracyMm != null
            ? Number(position.accuracyMm) / 1000
            : null,
        timestamp: ts,
      });
    }
  }

  points.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return points;
}
