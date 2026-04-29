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

import { chainUnchecked } from "stream-chain";
import pickFilter from "stream-json/filters/pick.js";
import jsonParser from "stream-json/parser.js";
import streamValues from "stream-json/streamers/stream-values.js";
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

    const timestamp = parseTimestamp(l.timestamp) ?? parseTimestamp(l.timestampMs);
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
 * Walk a `timelinePath` array, emitting one ParsedPoint per entry.
 * Google has shipped both `{ point, time }` (current Phone Takeout) and
 * `{ point, timestamp }` (older exports) — accept either. If neither is
 * present, fall back to the parent segment's startTime.
 */
function pushTimelinePath(path: unknown[], fallbackStart: unknown, out: ParsedPoint[]): void {
  for (const tp of path) {
    const tpObj = tp as Record<string, unknown>;
    const parsed = parseLatLng(tpObj.point);
    if (!parsed) continue;

    const ts =
      parseTimestamp(tpObj.time) ??
      parseTimestamp(tpObj.timestamp) ??
      parseTimestamp(fallbackStart);
    if (!ts) continue;

    out.push({
      ...parsed,
      altitude: null,
      velocity: null,
      accuracy: null,
      timestamp: ts,
    });
  }
}

/**
 * Parse Phone Takeout semanticSegments format
 */
function parseSemanticSegments(segments: unknown[]): ParsedPoint[] {
  const points: ParsedPoint[] = [];

  for (const seg of segments) {
    const s = seg as Record<string, unknown>;
    const segStart = s.startTime;

    // Top-level timelinePath (current Phone Takeout shape: 2025+ exports)
    const topPath = s.timelinePath as unknown[] | undefined;
    if (topPath) {
      pushTimelinePath(topPath, segStart, points);
    }

    // Visit type
    const visit = s.visit as Record<string, unknown> | undefined;
    if (visit) {
      const topCandidate = visit.topCandidate as Record<string, unknown> | undefined;
      const placeLocation = topCandidate?.placeLocation as Record<string, unknown> | undefined;
      if (placeLocation) {
        const parsed = parseLatLng(placeLocation.latLng);
        if (parsed) {
          const ts = parseTimestamp((s.startTime as string) ?? (visit.startTime as string));
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

        const ts = parseTimestamp(point.timestamp) ?? parseTimestamp(point.time);
        if (!ts) continue;

        points.push({
          ...parsed,
          altitude: null,
          velocity: null,
          accuracy: null,
          timestamp: ts,
        });
      }

      // Activity-level timelinePath (older Phone Takeout shape)
      const timelinePath = activity.timelinePath as unknown[] | undefined;
      if (timelinePath) {
        pushTimelinePath(timelinePath, segStart, points);
      }
    }
  }

  return points;
}

/**
 * Parse "geo:lat,lng" or "lat°, lng°" coordinate strings
 */
function parseLatLng(val: unknown): { lat: number; lon: number } | null {
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

  // Format 3: rawSignals — entries have shape
  //   { position: { LatLng, timestamp, accuracyMeters, altitudeMeters, speedMetersPerSecond } }
  // (also wifiScan / activityRecord entries that we skip)
  if (Array.isArray(data.rawSignals)) {
    for (const sig of data.rawSignals) {
      const s = sig as Record<string, unknown>;
      const position = s.position as Record<string, unknown> | undefined;
      if (!position) continue;

      const latLngRaw = (position.LatLng ?? position.latLng) as unknown;
      const parsed = parseLatLng(latLngRaw);
      if (!parsed) continue;

      const ts = parseTimestamp(position.timestamp) ?? parseTimestamp(s.timestamp);
      if (!ts) continue;

      const accuracy =
        position.accuracyMeters != null
          ? Number(position.accuracyMeters)
          : position.accuracyMm != null
            ? Number(position.accuracyMm) / 1000
            : null;

      const altitude =
        position.altitudeMeters != null
          ? Number(position.altitudeMeters)
          : position.altitude != null
            ? Number(position.altitude)
            : null;

      const velocity =
        position.speedMetersPerSecond != null
          ? Number(position.speedMetersPerSecond)
          : position.velocity != null
            ? Number(position.velocity)
            : null;

      points.push({
        ...parsed,
        altitude,
        velocity,
        accuracy,
        timestamp: ts,
      });
    }
  }

  points.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return points;
}

/** Convert a `locations[]` (Records.json) entry into a single ParsedPoint, or null. */
function recordToPoint(value: Record<string, unknown>): ParsedPoint | null {
  if (value.latitudeE7 == null || value.longitudeE7 == null) return null;
  const ts = parseTimestamp(value.timestamp) ?? parseTimestamp(value.timestampMs);
  if (!ts) return null;
  return {
    lat: (value.latitudeE7 as number) / 1e7,
    lon: (value.longitudeE7 as number) / 1e7,
    altitude: value.altitude != null ? Number(value.altitude) : null,
    velocity: value.velocity != null ? Number(value.velocity) : null,
    accuracy: value.accuracy != null ? Number(value.accuracy) : null,
    timestamp: ts,
  };
}

/** Convert a `rawSignals[]` entry (only `position` shapes carry coords) into a ParsedPoint, or null. */
function rawSignalToPoint(value: Record<string, unknown>): ParsedPoint | null {
  const position = value.position as Record<string, unknown> | undefined;
  if (!position) return null;

  const parsed = parseLatLng((position.LatLng ?? position.latLng) as unknown);
  if (!parsed) return null;

  const ts = parseTimestamp(position.timestamp) ?? parseTimestamp(value.timestamp);
  if (!ts) return null;

  const accuracy =
    position.accuracyMeters != null
      ? Number(position.accuracyMeters)
      : position.accuracyMm != null
        ? Number(position.accuracyMm) / 1000
        : null;
  const altitude =
    position.altitudeMeters != null
      ? Number(position.altitudeMeters)
      : position.altitude != null
        ? Number(position.altitude)
        : null;
  const velocity =
    position.speedMetersPerSecond != null
      ? Number(position.speedMetersPerSecond)
      : position.velocity != null
        ? Number(position.velocity)
        : null;

  return { ...parsed, altitude, velocity, accuracy, timestamp: ts };
}

/** Expand a single `semanticSegments[]` entry into 0..N ParsedPoints. */
function expandSemanticSegment(value: Record<string, unknown>): ParsedPoint[] {
  return parseSemanticSegments([value]);
}

/** Heuristic: which shape is this top-level array element? */
function detectElementShape(value: Record<string, unknown>): "record" | "rawSignal" | "segment" {
  if (value.latitudeE7 != null && value.longitudeE7 != null) return "record";
  if (value.position || value.wifiScan || value.activityRecord) return "rawSignal";
  return "segment";
}

/** Yield 0..N points from a single decoded array element, dispatching by shape. */
function* expandElement(value: Record<string, unknown>): Generator<ParsedPoint> {
  const shape = detectElementShape(value);
  if (shape === "record") {
    const p = recordToPoint(value);
    if (p) yield p;
    return;
  }
  if (shape === "rawSignal") {
    const p = rawSignalToPoint(value);
    if (p) yield p;
    return;
  }
  for (const p of expandSemanticSegment(value)) yield p;
}

/**
 * Stream a Google Takeout JSON document and emit ParsedPoint as soon as each
 * top-level array element is fully assembled. Memory peak is bounded by the
 * largest single element, not the whole file. One pipeline handles all three
 * known shapes — `locations`, `semanticSegments`, `rawSignals`.
 *
 * No global sort is performed; INSERT ordering is irrelevant because
 * `location_points` is queried via the (user_id, timestamp) index.
 */
export async function* streamGoogleTakeout(
  source: NodeJS.ReadableStream
): AsyncGenerator<ParsedPoint> {
  const TOP_LEVEL = new Set(["locations", "semanticSegments", "rawSignals"]);

  const pipeline = chainUnchecked([
    source,
    jsonParser(),
    pickFilter.asStream({
      filter: (stack: (string | number | null)[]) =>
        stack.length === 2 && TOP_LEVEL.has(stack[0] as string),
    }),
    streamValues.asStream(),
  ]);

  try {
    for await (const item of pipeline as AsyncIterable<{ key: number; value: unknown }>) {
      yield* expandElement(item.value as Record<string, unknown>);
    }
  } finally {
    // Ensure upstream is destroyed if the consumer aborts (e.g. SSE client closes)
    pipeline.destroy?.();
  }
}
