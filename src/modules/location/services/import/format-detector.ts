/**
 * Import Format Auto-Detector
 *
 * Detects file format from filename extension and content sniffing.
 * Ported from Dawarich: app/services/imports/source_detector.rb
 */

import type { ImportFormat } from "./types";

export function detectFormat(fileName: string, content: string): ImportFormat {
  const ext = fileName.toLowerCase().replace(/\.gz$/, "").split(".").pop();

  // Extension-based detection
  if (ext === "gpx") return "gpx";

  // Content-based detection for XML (GPX without .gpx extension)
  if (content.trimStart().startsWith("<?xml") || content.includes("<gpx")) {
    return "gpx";
  }

  // JSON-based detection
  if (ext === "json" || ext === "geojson") {
    return detectJsonFormat(content);
  }

  // Try JSON parsing for unknown extensions
  try {
    return detectJsonFormat(content);
  } catch {
    return "unknown";
  }
}

function detectJsonFormat(content: string): ImportFormat {
  // The caller passes only a sniffed prefix (first ~4KB), so `JSON.parse`
  // almost always fails on truncated input. Detect the envelope by looking
  // for the top-level key as a substring instead — these are unambiguous
  // signatures for each format.
  if (/"semanticSegments"\s*:/.test(content)) return "google-phone-takeout";
  if (/"rawSignals"\s*:/.test(content)) return "google-phone-takeout";

  if (/"locations"\s*:/.test(content) && /"latitudeE7"\s*:/.test(content)) {
    return "google-records";
  }

  if (/"type"\s*:\s*"FeatureCollection"/.test(content)) return "geojson";
  if (/"type"\s*:\s*"Feature"/.test(content) && /"geometry"\s*:/.test(content)) {
    return "geojson";
  }

  // Fall back to a strict parse for the rare case of a tiny file that fits
  // entirely in the sniff window.
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    if (Array.isArray(data.locations)) {
      const first = data.locations[0] as Record<string, unknown> | undefined;
      if (first?.latitudeE7 != null) return "google-records";
    }
    if (Array.isArray(data.semanticSegments)) return "google-phone-takeout";
    if (Array.isArray(data.rawSignals)) return "google-phone-takeout";
    if (data.type === "FeatureCollection" && Array.isArray(data.features)) return "geojson";
    if (data.type === "Feature" && data.geometry) return "geojson";
  } catch {
    // ignore — substring matchers above are the primary detection path
  }

  return "unknown";
}
