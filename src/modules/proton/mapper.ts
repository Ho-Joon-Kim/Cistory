import { NodeType, type PhotoNode } from "@protontech/drive-sdk";
import { parseAdditionalNodeMetadata } from "@protontech/drive-sdk/dist/additionalNodeMetadata/index.js";

export interface MappedPhoto {
  nodeUid: string;
  capturedAt: Date;
  mainPhotoNodeUid: string | null;
  relatedPhotoNodeUids: string[];
  contentHash: string | null;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  /** Null (never undefined) when the node carries no usable EXIF GPS, so ingest can clear stale values. */
  lat: number | null;
  lon: number | null;
  device: string | null;
  /** Raw Proton tag integers, stored uninterpreted. */
  tags: number[];
  claimedMetadata: { Location?: unknown; Camera?: unknown; Media?: unknown } | null;
  trashedAt: Date | null;
}

export type MapResult =
  | { ok: true; photo: MappedPhoto }
  | { ok: false; reason: "not_photo" | "degraded" | "invalid" };

/** A usable GPS fix: finite, in range, and not the (0,0) "no fix" sentinel. */
export function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return !(lat === 0 && lon === 0);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function pickClaimed(
  parsed: ReturnType<typeof parseAdditionalNodeMetadata>
): MappedPhoto["claimedMetadata"] {
  const { Location, Camera, Media } = parsed;
  const claimed: NonNullable<MappedPhoto["claimedMetadata"]> = {};
  if (Location) claimed.Location = Location;
  if (Camera) claimed.Camera = Camera;
  if (Media) claimed.Media = Media;
  return Object.keys(claimed).length > 0 ? claimed : null;
}

export function mapPhotoNode(node: PhotoNode): MapResult {
  if (node.type !== NodeType.Photo) return { ok: false, reason: "not_photo" };
  if (node.errors && node.errors.length > 0) return { ok: false, reason: "degraded" };

  const attrs = node.photo;
  if (!attrs || !isValidDate(attrs.captureTime)) return { ok: false, reason: "invalid" };

  let parsed: ReturnType<typeof parseAdditionalNodeMetadata>;
  try {
    parsed = parseAdditionalNodeMetadata(node.activeRevision?.claimedAdditionalMetadata);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const { Location, Camera, Media } = parsed;
  const hasGps = isValidCoordinate(Location?.Latitude, Location?.Longitude);

  // `contentHash` is returned at runtime but absent from the public d.ts.
  const contentHash = (attrs as { contentHash?: unknown }).contentHash;

  return {
    ok: true,
    photo: {
      nodeUid: node.uid,
      capturedAt: attrs.captureTime,
      mainPhotoNodeUid: attrs.mainPhotoNodeUid ?? null,
      relatedPhotoNodeUids: attrs.relatedPhotoNodeUids ?? [],
      contentHash: stringOrNull(contentHash),
      mediaType: node.mediaType ?? null,
      width: numberOrNull(Media?.Width),
      height: numberOrNull(Media?.Height),
      durationSec: numberOrNull(Media?.Duration),
      lat: hasGps ? (Location?.Latitude ?? null) : null,
      lon: hasGps ? (Location?.Longitude ?? null) : null,
      device: stringOrNull(Camera?.Device),
      tags: (attrs.tags ?? []).filter((t) => Number.isInteger(t)),
      claimedMetadata: pickClaimed(parsed),
      trashedAt: isValidDate(node.trashTime) ? node.trashTime : null,
    },
  };
}
