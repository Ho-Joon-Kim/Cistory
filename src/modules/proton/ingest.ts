/**
 * Details ingest with NSFW pre-blocking, fail-closed (spec 3.4a).
 *
 * Two phases so no network call ever runs inside a transaction:
 *   1. `prepareIngest` — nodes, thumbnails and classification, no DB access.
 *   2. `applyIngest` — the writes, in the caller's transaction.
 *
 * A photo row becomes exposed (`details_synced_at` set) and gets a thumbnail
 * only after a passing verdict. A blocked photo leaves nothing behind but
 * `photo_blocks(node_uid)`. Anything without a verdict — undecryptable node,
 * missing thumbnail, unclassifiable image — is a `fail`: attempts go up and no
 * image is stored. An unavailable classifier is an infrastructure fault:
 * `prepareIngest` rejects with `ClassifierUnavailableError` and returns no
 * outcomes at all, so no per-photo attempt is consumed.
 *
 * Thumbnail bytes, scores, coordinates and claimed metadata never reach a
 * logger or an error message.
 */
import type { MaybeMissingPhotoNode, PhotoNode } from "@protontech/drive-sdk";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { photoBlocks, photos, photoThumbnails } from "@/db/schema";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { type MappedPhoto, mapPhotoNode } from "./mapper";
import {
  ClassifierUnavailableError,
  ClassifyInputError,
  isBlocked,
  type NsfwScores,
  type PhotoClassifier,
} from "./nsfw/classifier";
import type { OriginalExif } from "./original-exif";
import { markNodesDeleted, type ProtonDbExecutor } from "./repository";
import { PROTON_ERRORS, type ProtonErrorMessage } from "./types";

export type IngestOutcome =
  | {
      kind: "pass";
      photo: MappedPhoto;
      thumbnail: Uint8Array;
      /** Set when the thumbnail was generated from the original, whose EXIF was read with it. */
      original?: OriginalExif;
    }
  | { kind: "block"; nodeUid: string; relatedUids: string[] }
  | { kind: "missing"; nodeUid: string }
  | { kind: "skip"; nodeUid: string } // not a photo
  | {
      kind: "fail";
      nodeUid: string;
      error: ProtonErrorMessage;
      thumbnailFailed: boolean;
      /** Best-known capture time, for the hidden placeholder an absent row gets (ruling C4). */
      capturedAt?: Date;
    };

/** Nodes and thumbnails are requested from Proton in chunks of this size. */
export const INGEST_CHUNK = 50;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function isMissing(node: MaybeMissingPhotoNode): node is { missingUid: string } {
  return "missingUid" in node;
}

function bestCaptureTime(node: PhotoNode): Date | undefined {
  const t = node.photo?.captureTime;
  return t instanceof Date && !Number.isNaN(t.getTime()) ? t : undefined;
}

function fail(
  nodeUid: string,
  error: ProtonErrorMessage,
  thumbnailFailed: boolean,
  capturedAt: Date | undefined
): IngestOutcome {
  return capturedAt
    ? { kind: "fail", nodeUid, error, thumbnailFailed, capturedAt }
    : { kind: "fail", nodeUid, error, thumbnailFailed };
}

/** Classifies one thumbnail; anything but a per-image input error is an infrastructure fault. */
async function classifyOrThrow(
  classifier: PhotoClassifier,
  image: Uint8Array
): Promise<NsfwScores | "unclassifiable"> {
  try {
    return await classifier.classify(image);
  } catch (error) {
    if (error instanceof ClassifyInputError) return "unclassifiable";
    if (error instanceof ClassifierUnavailableError) throw error;
    // Fail closed without burning attempts; the cause is a runtime fault, not this photo.
    throw new ClassifierUnavailableError(undefined, { cause: error });
  }
}

function unmappedOutcome(
  node: PhotoNode,
  reason: "not_photo" | "degraded" | "invalid"
): IngestOutcome {
  if (reason === "not_photo") return { kind: "skip", nodeUid: node.uid };
  return fail(node.uid, PROTON_ERRORS.detailsUndecryptable, false, bestCaptureTime(node));
}

/** Reads one chunk of nodes: verdict-free outcomes plus the photos still to screen. */
export async function readNodes(
  api: ProtonPhotosApi,
  chunk: string[]
): Promise<{ outcomes: IngestOutcome[]; candidates: MappedPhoto[] }> {
  const requested = new Set(chunk);
  const seen = new Set<string>();
  const outcomes: IngestOutcome[] = [];
  const candidates: MappedPhoto[] = [];

  for await (const node of api.iterateNodes(chunk)) {
    const uid = isMissing(node) ? node.missingUid : node.uid;
    if (!requested.has(uid) || seen.has(uid)) continue;
    seen.add(uid);
    if (isMissing(node)) {
      outcomes.push({ kind: "missing", nodeUid: uid });
      continue;
    }
    const mapped = mapPhotoNode(node);
    if (mapped.ok) candidates.push(mapped.photo);
    else outcomes.push(unmappedOutcome(node, mapped.reason));
  }
  // A uid the SDK neither returned nor reported missing has no verdict.
  for (const uid of chunk) {
    if (!seen.has(uid)) {
      outcomes.push(fail(uid, PROTON_ERRORS.detailsUndecryptable, false, undefined));
    }
  }
  return { outcomes, candidates };
}

/** Type1 thumbnails by uid; an `ok: false` or absent result simply has no entry. */
async function fetchThumbnails(
  api: ProtonPhotosApi,
  uids: string[]
): Promise<Map<string, Uint8Array>> {
  const thumbnails = new Map<string, Uint8Array>();
  if (uids.length === 0) return thumbnails;
  const wanted = new Set(uids);
  for await (const result of api.iterateThumbnails(uids)) {
    if (result.ok && wanted.has(result.nodeUid)) thumbnails.set(result.nodeUid, result.thumbnail);
  }
  return thumbnails;
}

/** The verdict for one fetched thumbnail; records newly blocked uids in `known`. */
export async function screen(
  classifier: PhotoClassifier,
  photo: MappedPhoto,
  image: Uint8Array,
  known: Set<string>
): Promise<IngestOutcome> {
  const uid = photo.nodeUid;
  const verdict = await classifyOrThrow(classifier, image);
  if (verdict === "unclassifiable") {
    return fail(uid, PROTON_ERRORS.thumbnailUnclassifiable, true, photo.capturedAt);
  }
  if (!isBlocked(verdict)) return { kind: "pass", photo, thumbnail: image };
  const relatedUids = [...new Set(photo.relatedPhotoNodeUids)].filter((r) => r !== uid);
  known.add(uid);
  for (const r of relatedUids) known.add(r);
  return { kind: "block", nodeUid: uid, relatedUids };
}

/**
 * One chunk: nodes → thumbnails → sequential classification. `known` holds
 * every blocked uid so far (pre-existing and newly blocked) and is updated.
 */
async function prepareChunk(
  api: ProtonPhotosApi,
  classifier: PhotoClassifier,
  chunk: string[],
  known: Set<string>
): Promise<IngestOutcome[]> {
  const { outcomes, candidates } = await readNodes(api, chunk);

  // Mains first, so a related photo of a main blocked in this chunk is never classified.
  candidates.sort(
    (a, b) => Number(a.mainPhotoNodeUid !== null) - Number(b.mainPhotoNodeUid !== null)
  );
  const mainBlocked = (photo: MappedPhoto) =>
    photo.mainPhotoNodeUid !== null && known.has(photo.mainPhotoNodeUid);
  const thumbnails = await fetchThumbnails(
    api,
    candidates.filter((p) => !mainBlocked(p)).map((p) => p.nodeUid)
  );

  let classified = 0;
  for (const photo of candidates) {
    const uid = photo.nodeUid;
    const image = thumbnails.get(uid);
    if (mainBlocked(photo)) {
      known.add(uid);
      outcomes.push({ kind: "block", nodeUid: uid, relatedUids: [] });
    } else if (!image) {
      outcomes.push(fail(uid, PROTON_ERRORS.thumbnailMissing, true, photo.capturedAt));
    } else {
      // Inference is synchronous CPU work; let queued I/O run between images.
      if (classified > 0) await yieldToEventLoop();
      classified += 1;
      outcomes.push(await screen(classifier, photo, image, known));
    }
  }
  return outcomes;
}

/**
 * Fetches, screens and classifies `uids` without touching the database.
 * Throws `ClassifierUnavailableError` (and any network error) without
 * returning partial outcomes, so the caller writes nothing for the batch.
 */
export async function prepareIngest(
  api: ProtonPhotosApi,
  classifier: PhotoClassifier,
  uids: string[],
  blocked: ReadonlySet<string>
): Promise<IngestOutcome[]> {
  const known = new Set(blocked);
  const outcomes: IngestOutcome[] = [];
  const toFetch: string[] = [];
  for (const uid of new Set(uids)) {
    // Already blocked: no network call. Re-asserting the block is idempotent
    // and removes any row that should not exist.
    if (known.has(uid)) outcomes.push({ kind: "block", nodeUid: uid, relatedUids: [] });
    else toFetch.push(uid);
  }

  for (let i = 0; i < toFetch.length; i += INGEST_CHUNK) {
    if (i > 0) await yieldToEventLoop();
    outcomes.push(
      ...(await prepareChunk(api, classifier, toFetch.slice(i, i + INGEST_CHUNK), known))
    );
  }

  // A related photo screened before its main was blocked must not be stored.
  const blockedNow = new Set<string>();
  for (const o of outcomes) {
    if (o.kind !== "block") continue;
    blockedNow.add(o.nodeUid);
    for (const r of o.relatedUids) blockedNow.add(r);
  }
  return outcomes.filter(
    (o) => o.kind === "block" || !blockedNow.has(o.kind === "pass" ? o.photo.nodeUid : o.nodeUid)
  );
}

function intOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

async function applyPass(
  tx: ProtonDbExecutor,
  userId: string,
  outcome: Extract<IngestOutcome, { kind: "pass" }>,
  now: Date
): Promise<void> {
  const p = outcome.photo;
  const o = outcome.original;
  const originalGps = o !== undefined && o.lat !== null && o.lon !== null;
  const hasGps = p.lat !== null && p.lon !== null;
  // Precedence: the original's own EXIF GPS, then Proton's attribute GPS,
  // then (later, in location.ts) an OwnTracks estimate.
  const location = originalGps
    ? { lat: o.lat, lon: o.lon, locationSource: "exif_original" as const }
    : hasGps
      ? { lat: p.lat, lon: p.lon, locationSource: "exif" as const }
      : { lat: null, lon: null, locationSource: null };
  // A pass without original data is a (re-)ingest of the node: whatever was
  // read from the previous revision's original is forgotten and read again.
  const original = {
    originalCheckedAt: o ? now : null,
    originalAttempts: 0,
    originalError: null,
    imageDirection: o?.direction ?? null,
    imageDirectionRef: o?.directionRef ?? null,
    captureUtcOffsetMin: o?.utcOffsetMin ?? null,
  };
  const fields = {
    mainPhotoNodeUid: p.mainPhotoNodeUid,
    contentHash: p.contentHash,
    capturedAt: p.capturedAt,
    mediaType: p.mediaType,
    width: intOrNull(p.width),
    height: intOrNull(p.height),
    durationSec: p.durationSec,
    device: p.device,
    tags: p.tags,
    claimedMetadata: p.claimedMetadata,
    trashedAt: p.trashedAt,
    // GPS wins and is final; without it every location field clears so the
    // OwnTracks fill recomputes rather than keeping a stale estimate (C5).
    ...location,
    locationGapSec: null,
    locationCheckedAt: location.locationSource ? now : null,
    ...original,
    deletedAt: null,
    detailsSyncedAt: now,
    detailsError: null,
    updatedAt: now,
  };
  const [row] = await tx
    .insert(photos)
    .values({ userId, nodeUid: p.nodeUid, ...fields, createdAt: now })
    .onConflictDoUpdate({ target: [photos.userId, photos.nodeUid], set: fields })
    .returning({ id: photos.id });
  const bytes = Buffer.from(
    outcome.thumbnail.buffer,
    outcome.thumbnail.byteOffset,
    outcome.thumbnail.byteLength
  );
  await tx
    .insert(photoThumbnails)
    .values({ photoId: row.id, bytes, fetchedAt: now })
    .onConflictDoUpdate({ target: photoThumbnails.photoId, set: { bytes, fetchedAt: now } });
}

async function applyBlock(
  tx: ProtonDbExecutor,
  userId: string,
  outcome: Extract<IngestOutcome, { kind: "block" }>,
  modelVersion: string,
  now: Date
): Promise<void> {
  const listed = [...new Set([outcome.nodeUid, ...outcome.relatedUids])];
  // The thumbnail goes with the row (FK cascade).
  const deleted = await tx
    .delete(photos)
    .where(
      and(
        eq(photos.userId, userId),
        or(inArray(photos.nodeUid, listed), eq(photos.mainPhotoNodeUid, outcome.nodeUid))
      )
    )
    .returning({ nodeUid: photos.nodeUid });
  const all = [...new Set([...listed, ...deleted.map((d) => d.nodeUid)])];
  await tx
    .insert(photoBlocks)
    .values(all.map((nodeUid) => ({ userId, nodeUid, blockedAt: now, modelVersion })))
    .onConflictDoNothing({ target: [photoBlocks.userId, photoBlocks.nodeUid] });
}

async function applyFail(
  tx: ProtonDbExecutor,
  userId: string,
  outcome: Extract<IngestOutcome, { kind: "fail" }>,
  now: Date
): Promise<void> {
  // An absent row gets a hidden placeholder so the attempt is tracked (C4).
  // An existing row only has its counters bumped: a verified row stays
  // exposed with its old thumbnail (C3); a hidden row stays hidden.
  await tx
    .insert(photos)
    .values({
      userId,
      nodeUid: outcome.nodeUid,
      capturedAt: outcome.capturedAt ?? now,
      detailsAttempts: 1,
      detailsError: outcome.error,
      thumbnailAttempts: outcome.thumbnailFailed ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [photos.userId, photos.nodeUid],
      set: {
        detailsAttempts: sql`${photos.detailsAttempts} + 1`,
        detailsError: outcome.error,
        ...(outcome.thumbnailFailed
          ? { thumbnailAttempts: sql`${photos.thumbnailAttempts} + 1` }
          : {}),
        updatedAt: now,
      },
    });
}

/** Writes `prepareIngest` outcomes, in order, inside the caller's transaction. */
export async function applyIngest(
  tx: ProtonDbExecutor,
  userId: string,
  outcomes: IngestOutcome[],
  modelVersion: string,
  now: Date
): Promise<void> {
  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case "pass":
        await applyPass(tx, userId, outcome, now);
        break;
      case "block":
        await applyBlock(tx, userId, outcome, modelVersion, now);
        break;
      case "missing":
        await markNodesDeleted(tx, userId, [outcome.nodeUid], now);
        break;
      case "skip":
        await tx
          .delete(photos)
          .where(and(eq(photos.userId, userId), eq(photos.nodeUid, outcome.nodeUid)));
        break;
      case "fail":
        await applyFail(tx, userId, outcome, now);
        break;
    }
  }
}
