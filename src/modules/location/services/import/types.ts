/**
 * Shared types for location import parsers
 */

export interface ParsedPoint {
  lat: number;
  lon: number;
  altitude: number | null;
  velocity: number | null; // m/s
  accuracy: number | null;
  timestamp: Date;
}

export type ImportFormat =
  | "gpx"
  | "geojson"
  | "google-records"
  | "google-phone-takeout"
  | "unknown";
