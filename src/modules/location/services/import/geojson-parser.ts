/**
 * GeoJSON File Parser
 *
 * Parses GeoJSON FeatureCollection with Point features into ParsedPoint[].
 * Supports various timestamp field names.
 */

import type { ParsedPoint } from "./types";

// Common timestamp field aliases (Dawarich: imports/field_aliases.rb)
const TIMESTAMP_ALIASES = [
  "timestamp",
  "time",
  "date",
  "datetime",
  "when",
  "created_at",
  "recorded_at",
  "fixTime",
  "tst",
];

function findTimestamp(props: Record<string, unknown>): Date | null {
  for (const key of TIMESTAMP_ALIASES) {
    const val = props[key];
    if (val == null) continue;

    if (typeof val === "number") {
      // Unix timestamp — assume seconds if < 10 billion, else milliseconds
      const ms = val < 1e10 ? val * 1000 : val;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d;
    }

    if (typeof val === "string") {
      const d = new Date(val);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

export function parseGeoJson(json: unknown): ParsedPoint[] {
  const data = json as Record<string, unknown>;
  if (!data || typeof data !== "object") return [];

  // Extract features
  let features: Record<string, unknown>[] = [];

  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    features = data.features;
  } else if (data.type === "Feature") {
    features = [data];
  } else {
    return [];
  }

  const points: ParsedPoint[] = [];

  for (const feature of features) {
    const geometry = feature.geometry as Record<string, unknown> | undefined;
    if (!geometry) continue;

    const props = (feature.properties ?? {}) as Record<string, unknown>;

    if (geometry.type === "Point") {
      const coords = geometry.coordinates as number[];
      if (!coords || coords.length < 2) continue;

      const [lon, lat] = coords;
      const timestamp = findTimestamp(props);
      if (!timestamp) continue;

      points.push({
        lat,
        lon,
        altitude: coords.length > 2 ? coords[2] : null,
        velocity: props.speed != null ? Number(props.speed) : null,
        accuracy: props.accuracy != null ? Number(props.accuracy) : null,
        timestamp,
      });
    }
  }

  points.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return points;
}
