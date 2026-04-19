/**
 * GPX File Parser
 *
 * Parses GPX XML trackpoints into ParsedPoint[].
 * Handles multiple <trk>/<trkseg> elements.
 * Speed extraction from two paths (Dawarich: gpx/track_importer.rb L67-75).
 */

import { XMLParser } from "fast-xml-parser";
import type { ParsedPoint } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
});

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * Extract speed from trackpoint extensions (Dawarich multi-path approach).
 * Checks extensions.speed and extensions.TrackPointExtension.speed.
 */
function extractSpeed(trkpt: Record<string, unknown>): number | null {
  const ext = trkpt.extensions as Record<string, unknown> | undefined;
  if (!ext) return null;

  // Path 1: extensions.speed
  if (ext.speed != null) {
    const s = Number(ext.speed);
    if (!Number.isNaN(s)) return s;
  }

  // Path 2: extensions.TrackPointExtension.speed
  const tpExt = ext.TrackPointExtension as Record<string, unknown> | undefined;
  if (tpExt?.speed != null) {
    const s = Number(tpExt.speed);
    if (!Number.isNaN(s)) return s;
  }

  return null;
}

export function parseGpx(xml: string): ParsedPoint[] {
  const parsed = parser.parse(xml);
  const gpx = parsed.gpx;
  if (!gpx) return [];

  const points: ParsedPoint[] = [];
  const trks = ensureArray(gpx.trk);

  for (const trk of trks) {
    const trksegs = ensureArray(trk.trkseg);
    for (const seg of trksegs) {
      const trkpts = ensureArray(seg.trkpt);
      for (const pt of trkpts) {
        const lat = Number(pt["@_lat"]);
        const lon = Number(pt["@_lon"]);
        const timeStr = pt.time;

        if (Number.isNaN(lat) || Number.isNaN(lon) || !timeStr) continue;

        const timestamp = new Date(String(timeStr));
        if (Number.isNaN(timestamp.getTime())) continue;

        points.push({
          lat,
          lon,
          altitude: pt.ele != null ? Number(pt.ele) : null,
          velocity: extractSpeed(pt),
          accuracy: null,
          timestamp,
        });
      }
    }
  }

  // Sort by timestamp
  points.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return points;
}
