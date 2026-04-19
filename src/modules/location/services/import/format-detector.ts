/**
 * Import Format Auto-Detector
 *
 * Detects file format from filename extension and content sniffing.
 * Ported from Dawarich: app/services/imports/source_detector.rb
 */

import type { ImportFormat } from "./types";

export function detectFormat(fileName: string, content: string): ImportFormat {
  const ext = fileName.toLowerCase().split(".").pop();

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
  try {
    // Parse only the first portion for large files
    const data = JSON.parse(content) as Record<string, unknown>;

    // Google Records.json: { locations: [{ latitudeE7, ... }] }
    if (Array.isArray(data.locations)) {
      const first = data.locations[0] as Record<string, unknown> | undefined;
      if (first?.latitudeE7 != null) return "google-records";
    }

    // Google Phone Takeout: { semanticSegments: [...] }
    if (Array.isArray(data.semanticSegments)) return "google-phone-takeout";

    // Google Phone Takeout: { rawSignals: [...] }
    if (Array.isArray(data.rawSignals)) return "google-phone-takeout";

    // GeoJSON: { type: "FeatureCollection", features: [...] }
    if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
      return "geojson";
    }

    // Single GeoJSON Feature
    if (data.type === "Feature" && data.geometry) {
      return "geojson";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}
