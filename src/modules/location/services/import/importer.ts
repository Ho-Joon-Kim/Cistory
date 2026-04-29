/**
 * Location Data Importer
 *
 * Orchestrates parsing and batch insertion of location points.
 * Supports progress callbacks for SSE streaming (Dawarich-inspired).
 * Uses the same deduplication strategy as OwnTracks ingestion (onConflictDoNothing).
 */

import { getDb, locationPoints } from "@/db";
import { roundCoord } from "@/lib/geo";
import type { ParsedPoint } from "./types";

/** Wrap a sync array of points as an AsyncIterable so callers always get the same shape. */
async function* iterArray<T>(arr: T[]): AsyncGenerator<T> {
  for (const x of arr) yield x;
}

const BATCH_SIZE = 1000; // Dawarich default

export interface ImportResult {
  imported: number;
  duplicates: number;
  totalParsed: number;
  dateRange: { from: string; to: string } | null;
}

export interface ImportProgress {
  phase: "parsing" | "inserting" | "done" | "error";
  totalParsed?: number;
  inserted?: number;
  duplicates?: number;
  batchIndex?: number;
  totalBatches?: number;
  progress?: number; // 0-100
  dateRange?: { from: string; to: string } | null;
  format?: string;
  error?: string;
}

/** Accept either an array or any AsyncIterable, normalizing to a streaming source. */
export type PointSource = ParsedPoint[] | AsyncIterable<ParsedPoint>;

function toAsyncIterable(src: PointSource): AsyncIterable<ParsedPoint> {
  return Array.isArray(src) ? iterArray(src) : src;
}

/**
 * Import points streaming into the database with progress reporting. The
 * streaming entry buffers one BATCH_SIZE chunk before each INSERT so memory
 * peak stays bounded regardless of total point count. The total is unknown
 * up-front when streaming, so progress reports running counts instead of a
 * percentage; the SSE client renders a parsing/inserting label without a
 * deterministic bar.
 */
export async function importPoints(
  userId: string,
  source: PointSource,
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const db = getDb();
  const now = new Date();

  let scanned = 0;
  let imported = 0;
  let batchIndex = 0;
  let minTs: Date | null = null;
  let maxTs: Date | null = null;
  let buffer: ParsedPoint[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    batchIndex += 1;

    const values = buffer.map((p) => ({
      userId,
      lat: roundCoord(p.lat),
      lon: roundCoord(p.lon),
      accuracy: p.accuracy != null ? Math.round(p.accuracy) : null,
      altitude: p.altitude != null ? Math.round(p.altitude) : null,
      velocity: p.velocity != null ? Math.round(p.velocity) : null,
      battery: null,
      trackerId: null,
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
    buffer = [];

    onProgress?.({
      phase: "inserting",
      totalParsed: scanned,
      inserted: imported,
      duplicates: scanned - imported,
      batchIndex,
    });
  };

  for await (const p of toAsyncIterable(source)) {
    scanned += 1;
    if (!minTs || p.timestamp < minTs) minTs = p.timestamp;
    if (!maxTs || p.timestamp > maxTs) maxTs = p.timestamp;

    buffer.push(p);
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();

  if (scanned === 0) {
    return { imported: 0, duplicates: 0, totalParsed: 0, dateRange: null };
  }

  return {
    imported,
    duplicates: scanned - imported,
    totalParsed: scanned,
    dateRange: {
      from: (minTs as Date).toISOString().slice(0, 10),
      to: (maxTs as Date).toISOString().slice(0, 10),
    },
  };
}
