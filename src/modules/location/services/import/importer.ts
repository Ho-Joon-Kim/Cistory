/**
 * Location Data Importer
 *
 * Orchestrates parsing and batch insertion of location points.
 * Uses the same deduplication strategy as OwnTracks ingestion (onConflictDoNothing).
 */

import { getDb, locationPoints } from "@/db";
import type { ParsedPoint, ImportFormat } from "./types";
import { parseGpx } from "./gpx-parser";
import { parseGeoJson } from "./geojson-parser";
import { parseGoogleTakeout } from "./google-takeout-parser";
import { detectFormat } from "./format-detector";

const BATCH_SIZE = 500;

export interface ImportResult {
  imported: number;
  duplicates: number;
  totalParsed: number;
  dateRange: { from: string; to: string } | null;
}

/**
 * Parse file content based on format (or auto-detect).
 */
export function parseFile(
  content: string,
  fileName: string,
  format?: ImportFormat | "auto",
): { points: ParsedPoint[]; detectedFormat: ImportFormat } {
  const detectedFormat =
    format && format !== "auto" ? format : detectFormat(fileName, content);

  let points: ParsedPoint[] = [];

  switch (detectedFormat) {
    case "gpx":
      points = parseGpx(content);
      break;
    case "geojson":
      points = parseGeoJson(JSON.parse(content));
      break;
    case "google-records":
    case "google-phone-takeout":
      points = parseGoogleTakeout(JSON.parse(content));
      break;
    default:
      break;
  }

  return { points, detectedFormat };
}

/**
 * Import parsed points into the database.
 * Uses batch upsert with onConflictDoNothing for deduplication.
 */
export async function importPoints(
  userId: string,
  points: ParsedPoint[],
): Promise<ImportResult> {
  if (points.length === 0) {
    return { imported: 0, duplicates: 0, totalParsed: 0, dateRange: null };
  }

  const db = getDb();
  const now = new Date();
  let imported = 0;

  // Batch insert
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    const values = batch.map((p) => ({
      userId,
      lat: p.lat,
      lon: p.lon,
      accuracy: p.accuracy != null ? Math.round(p.accuracy) : null,
      altitude: p.altitude != null ? Math.round(p.altitude) : null,
      velocity: p.velocity != null ? Math.round(p.velocity) : null,
      battery: null,
      trackerId: null,
      trigger: null,
      timestamp: p.timestamp,
      createdAt: now,
    }));

    const result = await db
      .insert(locationPoints)
      .values(values)
      .onConflictDoNothing({
        target: [
          locationPoints.userId,
          locationPoints.timestamp,
          locationPoints.lat,
          locationPoints.lon,
        ],
      });

    imported += result.rowCount ?? 0;
  }

  // Calculate date range
  const from = points[0].timestamp.toISOString().slice(0, 10);
  const to = points[points.length - 1].timestamp.toISOString().slice(0, 10);

  return {
    imported,
    duplicates: points.length - imported,
    totalParsed: points.length,
    dateRange: { from, to },
  };
}
