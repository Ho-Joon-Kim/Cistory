/**
 * Small owner-scoped reads the MCP tools need that no shared service offers.
 * Every query filters on `userId`. Kept here (not in a feature module) because
 * only the MCP tools use them; the photo reads apply the Proton exposure rule
 * (`photoIsExposed`) exactly like the thumbnail route.
 */

import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  bodyMeasurements,
  type Database,
  locationProcessingDays,
  photos,
  photoThumbnails,
  transactions,
} from "@/db";
import { photoIsExposed } from "@/modules/proton/repository";
import type { TransferEvidence } from "@/modules/transaction/parser";

/** Last KST day the location pipeline completed (visits/tracks/subway are final through it). */
export async function getLocationDataThrough(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ date: locationProcessingDays.date })
    .from(locationProcessingDays)
    .where(
      and(eq(locationProcessingDays.userId, userId), eq(locationProcessingDays.status, "completed"))
    )
    .orderBy(desc(locationProcessingDays.date))
    .limit(1);
  return row?.date ?? null;
}

/** Raw notification evidence for `isPersonalTransfer`, keyed by transaction id. */
export async function loadTransferEvidence(
  db: Database,
  userId: string,
  ids: readonly string[]
): Promise<Map<string, TransferEvidence>> {
  const out = new Map<string, TransferEvidence>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: transactions.id,
      rawTitle: transactions.rawTitle,
      rawText: transactions.rawText,
      isSelfTransfer: transactions.isSelfTransfer,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, [...ids])));
  for (const row of rows) {
    out.set(row.id, {
      rawTitle: row.rawTitle,
      rawText: row.rawText,
      isSelfTransfer: row.isSelfTransfer,
    });
  }
  return out;
}

export const BODY_MEASUREMENT_LIMIT = 500;

export interface BodyMeasurementView {
  measuredAt: Date;
  weightKg: number | null;
  fatRatioPct: number | null;
  fatMassKg: number | null;
  fatFreeMassKg: number | null;
  muscleMassKg: number | null;
  boneMassKg: number | null;
  hydrationKg: number | null;
  visceralFat: number | null;
  bmrKcal: number | null;
  metabolicAge: number | null;
}

const num = (v: string | null): number | null => (v == null ? null : Number(v));

/** Withings measurements in `[start, end)`, oldest first. `rawMeasures` is never read. */
export async function listBodyMeasurements(
  db: Database,
  userId: string,
  range: { start: Date; end: Date }
): Promise<BodyMeasurementView[]> {
  const rows = await db
    .select({
      measuredAt: bodyMeasurements.measuredAt,
      weightKg: bodyMeasurements.weightKg,
      fatRatioPct: bodyMeasurements.fatRatioPct,
      fatMassKg: bodyMeasurements.fatMassKg,
      fatFreeMassKg: bodyMeasurements.fatFreeMassKg,
      muscleMassKg: bodyMeasurements.muscleMassKg,
      boneMassKg: bodyMeasurements.boneMassKg,
      hydrationKg: bodyMeasurements.hydrationKg,
      visceralFat: bodyMeasurements.visceralFat,
      bmrKcal: bodyMeasurements.bmrKcal,
      metabolicAge: bodyMeasurements.metabolicAge,
    })
    .from(bodyMeasurements)
    .where(
      and(
        eq(bodyMeasurements.userId, userId),
        gte(bodyMeasurements.measuredAt, range.start),
        lt(bodyMeasurements.measuredAt, range.end)
      )
    )
    .orderBy(asc(bodyMeasurements.measuredAt))
    .limit(BODY_MEASUREMENT_LIMIT);
  return rows.map((r) => ({
    measuredAt: r.measuredAt,
    weightKg: num(r.weightKg),
    fatRatioPct: num(r.fatRatioPct),
    fatMassKg: num(r.fatMassKg),
    fatFreeMassKg: num(r.fatFreeMassKg),
    muscleMassKg: num(r.muscleMassKg),
    boneMassKg: num(r.boneMassKg),
    hydrationKg: num(r.hydrationKg),
    visceralFat: num(r.visceralFat),
    bmrKcal: num(r.bmrKcal),
    metabolicAge: r.metabolicAge,
  }));
}

// ── Photos ───────────────────────────────────────────────────────────────────

export interface PhotoCursor {
  capturedAt: string;
  id: string;
}

export interface PhotoBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface PhotoMetadataRow {
  id: string;
  capturedAt: Date;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  lat: number | null;
  lon: number | null;
  locationSource: "exif" | "exif_original" | "owntracks" | null;
  locationGapSec: number | null;
  device: string | null;
  mainPhotoNodeUid: string | null;
  hasThumbnail: boolean;
}

/** The MCP exposure rule: screened, not deleted upstream, and not in the trash. */
function mcpPhotoVisible() {
  return and(photoIsExposed(), isNull(photos.trashedAt));
}

/**
 * Exposed photos captured in `[start, end)`, oldest first, keyset-paginated on
 * `(capturedAt, id)`. `bounds` narrows to a lat/lon box (rows without a
 * position drop out). Returns one extra row so the caller knows there's more.
 */
export async function listExposedPhotos(
  db: Database,
  userId: string,
  options: {
    range: { start: Date; end: Date };
    bounds?: PhotoBounds | null;
    cursor?: PhotoCursor | null;
    limit: number;
  }
): Promise<PhotoMetadataRow[]> {
  const { range, bounds, cursor, limit } = options;
  const conditions = [
    eq(photos.userId, userId),
    mcpPhotoVisible(),
    gte(photos.capturedAt, range.start),
    lt(photos.capturedAt, range.end),
  ];
  if (bounds) {
    conditions.push(
      gte(photos.lat, bounds.minLat),
      lte(photos.lat, bounds.maxLat),
      gte(photos.lon, bounds.minLon),
      lte(photos.lon, bounds.maxLon)
    );
  }
  if (cursor) {
    const at = new Date(cursor.capturedAt);
    conditions.push(
      or(gt(photos.capturedAt, at), and(eq(photos.capturedAt, at), gt(photos.id, cursor.id)))!
    );
  }
  return db
    .select({
      id: photos.id,
      capturedAt: photos.capturedAt,
      mediaType: photos.mediaType,
      width: photos.width,
      height: photos.height,
      durationSec: photos.durationSec,
      lat: photos.lat,
      lon: photos.lon,
      locationSource: photos.locationSource,
      locationGapSec: photos.locationGapSec,
      device: photos.device,
      mainPhotoNodeUid: photos.mainPhotoNodeUid,
      hasThumbnail: sql<boolean>`EXISTS (SELECT 1 FROM ${photoThumbnails} WHERE ${photoThumbnails.photoId} = ${photos.id})`,
    })
    .from(photos)
    .where(and(...conditions))
    .orderBy(asc(photos.capturedAt), asc(photos.id))
    .limit(limit + 1);
}

/** Stored thumbnail bytes of the given exposed photos (absent ids are simply missing). */
export async function loadExposedThumbnails(
  db: Database,
  userId: string,
  photoIds: readonly string[]
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  if (photoIds.length === 0) return out;
  const rows = await db
    .select({ id: photos.id, bytes: photoThumbnails.bytes })
    .from(photoThumbnails)
    .innerJoin(photos, eq(photos.id, photoThumbnails.photoId))
    .where(and(eq(photos.userId, userId), inArray(photos.id, [...photoIds]), mcpPhotoVisible()));
  for (const row of rows) out.set(row.id, new Uint8Array(row.bytes));
  return out;
}
