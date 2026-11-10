/**
 * The originals stage of a sync tick (runs after events and details):
 *
 *   recovery — hidden rows whose screening failed only because Proton had no
 *              usable thumbnail: download the original (verified, capped),
 *              generate a JPEG thumbnail, run the SAME NSFW screen, and apply
 *              the verdict exactly like ingest (pass stores, block deletes and
 *              writes `photo_blocks`). The EXIF comes from the same bytes.
 *   exif     — exposed image rows not read yet: read just enough of the
 *              original (seekable stream, full download fallback) to parse
 *              EXIF GPS, heading and UTC offset.
 *
 * Bounded three ways so it never starves events or details, which run first:
 * a row limit per part, a per-download timeout, and a tick deadline after
 * which no new original is started.
 *
 * Proton is never called inside a transaction; each photo's result is written
 * in its own transaction that starts with the tick's fence check, so a tick
 * racing a reconnect or disconnect writes nothing. Bytes, coordinates and
 * headings never reach a log or an error message.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { photos } from "@/db/schema";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { isAuthFailure, isRateLimited, isTransientOutage } from "@/lib/adapters/proton/errors";
import { applyIngest, type IngestOutcome, readNodes, screen } from "./ingest";
import type { MappedPhoto } from "./mapper";
import { ClassifierUnavailableError, type PhotoClassifier } from "./nsfw/classifier";
import { type OriginalExif, readOriginalExif } from "./original-exif";
import {
  downloadOriginal,
  memorySource,
  OriginalTooLargeError,
  seekableSource,
  withOriginalDownloader,
} from "./original-source";
import { OriginalUndecodableError, thumbnailFromOriginal } from "./original-thumbnail";
import {
  assertConnectionUnchanged,
  loadBlockedUids,
  ProtonConnectionChangedError,
  type ProtonDbExecutor,
  type ProtonTickFence,
  selectOriginalExifBatch,
  selectThumbnailRecoveryBatch,
} from "./repository";
import { PROTON_ERRORS, PROTON_MAX_ORIGINAL_ATTEMPTS, type ProtonErrorMessage } from "./types";

/**
 * Originals whose EXIF is read per tick. A ranged read costs one 4 MiB block
 * (JPEG, or a HEIC whose Exif item is early) or two (a HEIC > 4 MiB with its
 * Exif item at the end); observed originals are 0.5–9 MB, so worst case
 * ~8 MiB and typically ≤ 4 MiB per photo: ≤ 480 MiB, typically ~150–240 MiB
 * per 10-minute tick. ~8.4k exposed photos then take ~140 ticks (~1 day).
 */
export const ORIGINAL_EXIF_BATCH_LIMIT = 60;
/**
 * Thumbnail recoveries per tick: each is a full verified download (≤ 9 MB
 * observed) plus a decode (HEIC in wasm, ~1–2 s CPU at 12 MP) and an NSFW
 * classification, so ≤ ~90 MB and ~20 s CPU per tick. ~350 hidden rows
 * then take ~35 ticks (~6 h).
 */
export const THUMBNAIL_RECOVERY_BATCH_LIMIT = 10;
/** One original's download (ranged or full) is abandoned after this long. */
export const ORIGINAL_DOWNLOAD_TIMEOUT_MS = 60_000;
/**
 * No new original is started once the tick has run this long, leaving the
 * rest of the 10-minute interval free (an in-flight download can overrun by
 * at most `ORIGINAL_DOWNLOAD_TIMEOUT_MS`).
 */
export const ORIGINAL_STAGE_DEADLINE_MS = 5 * 60_000;

export interface OriginalsResult {
  recovered: number;
  blocked: number;
  exifChecked: number;
  failed: number;
  /** Why the stage stopped before its batches ran out, if it did. */
  stopped: "deadline" | "outage" | "rate_limited" | "classifier_unavailable" | null;
}

interface StageContext {
  db: Database;
  api: ProtonPhotosApi;
  classifier: PhotoClassifier;
  userId: string;
  fence: ProtonTickFence;
  now: Date;
  /** True once the tick's deadline has passed. */
  pastDeadline: () => boolean;
  result: OriginalsResult;
}

/** Thrown out of a photo's preparation to stop the stage for this tick (no attempt charged). */
class StopStage extends Error {
  constructor(readonly reason: NonNullable<OriginalsResult["stopped"]>) {
    super(reason);
    this.name = "StopStage";
  }
}

/** A per-photo failure: `permanent` ones will not change on retry (format, size). */
interface OriginalFailure {
  error: ProtonErrorMessage;
  permanent: boolean;
}

/**
 * Sorts an error from reading or decoding one original. Session-level errors
 * propagate to the tick (it maps auth, rate limits and fence changes); an
 * outage or an unavailable decoder stops the stage without charging the
 * photo; anything else is this photo's failure.
 */
function classifyFailure(error: unknown): OriginalFailure {
  if (isAuthFailure(error) || error instanceof ProtonConnectionChangedError) {
    throw error;
  }
  // Throttling here must not cost the tick its location fill and success stamp:
  // this stage is optional, so it stops and the next tick tries again.
  if (isRateLimited(error)) throw new StopStage("rate_limited");
  if (isTransientOutage(error)) throw new StopStage("outage");
  if (error instanceof ClassifierUnavailableError) throw new StopStage("classifier_unavailable");
  if (error instanceof OriginalTooLargeError) {
    return { error: PROTON_ERRORS.originalTooLarge, permanent: true };
  }
  if (error instanceof OriginalUndecodableError) {
    return { error: PROTON_ERRORS.originalUndecodable, permanent: true };
  }
  // Timeouts, decryption/integrity failures, a node gone meanwhile (404).
  return { error: PROTON_ERRORS.originalUnavailable, permanent: false };
}

/** Records one failed read; only a row whose original is still unread is touched. */
async function applyOriginalFailure(
  tx: ProtonDbExecutor,
  userId: string,
  nodeUid: string,
  failure: OriginalFailure,
  now: Date
): Promise<void> {
  await tx
    .update(photos)
    .set({
      originalAttempts: failure.permanent
        ? PROTON_MAX_ORIGINAL_ATTEMPTS
        : sql`${photos.originalAttempts} + 1`,
      originalError: failure.error,
      updatedAt: now,
    })
    .where(
      and(eq(photos.userId, userId), eq(photos.nodeUid, nodeUid), isNull(photos.originalCheckedAt))
    );
}

/**
 * Stores the EXIF read from an exposed photo's original. Original GPS beats
 * whatever location the row had (Proton attribute GPS or an OwnTracks
 * estimate) and is final; without GPS the location is left alone. Only an
 * exposed, live row whose original is still unread is written.
 */
export async function applyOriginalExif(
  tx: ProtonDbExecutor,
  userId: string,
  nodeUid: string,
  exif: OriginalExif,
  now: Date
): Promise<boolean> {
  const hasGps = exif.lat !== null && exif.lon !== null;
  const rows = await tx
    .update(photos)
    .set({
      originalCheckedAt: now,
      originalError: null,
      imageDirection: exif.direction,
      imageDirectionRef: exif.directionRef,
      captureUtcOffsetMin: exif.utcOffsetMin,
      ...(hasGps
        ? {
            lat: exif.lat,
            lon: exif.lon,
            locationSource: "exif_original" as const,
            locationGapSec: null,
            locationCheckedAt: now,
          }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(photos.userId, userId),
        eq(photos.nodeUid, nodeUid),
        isNotNull(photos.detailsSyncedAt),
        isNull(photos.deletedAt),
        isNull(photos.originalCheckedAt)
      )
    )
    .returning({ id: photos.id });
  return rows.length > 0;
}

async function inFencedTx(
  ctx: StageContext,
  write: (tx: ProtonDbExecutor) => Promise<void>
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await assertConnectionUnchanged(tx, ctx.userId, ctx.fence);
    await write(tx);
  });
}

/** EXIF of one original, reading as little of it as the parser needs. */
export async function readExifOfOriginal(
  api: ProtonPhotosApi,
  nodeUid: string
): Promise<OriginalExif> {
  return withOriginalDownloader(
    (signal) => api.getFileDownloader(nodeUid, signal),
    ORIGINAL_DOWNLOAD_TIMEOUT_MS,
    async (downloader) => {
      const source = seekableSource(downloader) ?? memorySource(await downloadOriginal(downloader));
      return readOriginalExif(source);
    }
  );
}

/** The whole original, verified and capped (thumbnail recovery). */
async function fetchOriginal(api: ProtonPhotosApi, nodeUid: string): Promise<Uint8Array> {
  return withOriginalDownloader(
    (signal) => api.getFileDownloader(nodeUid, signal),
    ORIGINAL_DOWNLOAD_TIMEOUT_MS,
    (downloader) => downloadOriginal(downloader)
  );
}

async function runExifPart(ctx: StageContext, limit: number): Promise<void> {
  const uids = await selectOriginalExifBatch(ctx.db, ctx.userId, limit);
  for (const uid of uids) {
    if (ctx.pastDeadline()) throw new StopStage("deadline");
    let exif: OriginalExif;
    try {
      exif = await readExifOfOriginal(ctx.api, uid);
    } catch (error) {
      const failure = classifyFailure(error);
      await inFencedTx(ctx, (tx) => applyOriginalFailure(tx, ctx.userId, uid, failure, ctx.now));
      ctx.result.failed += 1;
      continue;
    }
    await inFencedTx(ctx, async (tx) => {
      await applyOriginalExif(tx, ctx.userId, uid, exif, ctx.now);
    });
    ctx.result.exifChecked += 1;
  }
}

/**
 * Generates, screens and classifies one photo from its original. Returns an
 * ingest outcome (pass carries the original's EXIF) or a failure.
 */
async function recoverOne(
  ctx: StageContext,
  photo: MappedPhoto,
  known: Set<string>
): Promise<IngestOutcome | OriginalFailure> {
  // Only still images can become a thumbnail; a video is not downloaded at all.
  if (photo.mediaType !== null && !photo.mediaType.startsWith("image/")) {
    return { error: PROTON_ERRORS.originalUndecodable, permanent: true };
  }
  try {
    const bytes = await fetchOriginal(ctx.api, photo.nodeUid);
    const thumbnail = await thumbnailFromOriginal(bytes);
    const exif = await readOriginalExif(memorySource(bytes));
    const outcome = await screen(ctx.classifier, photo, thumbnail, known);
    if (outcome.kind === "fail") {
      // The generated JPEG was unclassifiable: nothing else to try.
      return { error: PROTON_ERRORS.originalUndecodable, permanent: true };
    }
    return outcome.kind === "pass" ? { ...outcome, original: exif } : outcome;
  } catch (error) {
    return classifyFailure(error);
  }
}

function isFailure(o: IngestOutcome | OriginalFailure): o is OriginalFailure {
  return "permanent" in o;
}

/**
 * Writes the verdict-free node outcomes. Missing / not-a-photo apply as in
 * ingest; a node that could not be read charges the original attempt, not
 * the (usually exhausted) details one.
 */
async function applyNodeOutcomes(ctx: StageContext, outcomes: IngestOutcome[]): Promise<void> {
  const writable: IngestOutcome[] = [];
  for (const o of outcomes) {
    if (o.kind !== "fail") {
      writable.push(o);
      continue;
    }
    const failure = { error: o.error, permanent: false };
    await inFencedTx(ctx, (tx) =>
      applyOriginalFailure(tx, ctx.userId, o.nodeUid, failure, ctx.now)
    );
    ctx.result.failed += 1;
  }
  if (writable.length === 0) return;
  await inFencedTx(ctx, (tx) =>
    applyIngest(tx, ctx.userId, writable, ctx.classifier.modelVersion, ctx.now)
  );
}

/** Recovers one candidate and writes its outcome in its own fenced transaction. */
async function recoverCandidate(
  ctx: StageContext,
  photo: MappedPhoto,
  known: Set<string>
): Promise<void> {
  // Blocked already: as a related uid of a main blocked earlier in this batch
  // (whatever its own main attribute says), or through its main.
  const mainBlocked =
    known.has(photo.nodeUid) ||
    (photo.mainPhotoNodeUid !== null && known.has(photo.mainPhotoNodeUid));
  const outcome: IngestOutcome | OriginalFailure = mainBlocked
    ? { kind: "block", nodeUid: photo.nodeUid, relatedUids: [] }
    : await recoverOne(ctx, photo, known);

  if (isFailure(outcome)) {
    await inFencedTx(ctx, (tx) =>
      applyOriginalFailure(tx, ctx.userId, photo.nodeUid, outcome, ctx.now)
    );
    ctx.result.failed += 1;
    return;
  }
  await inFencedTx(ctx, (tx) =>
    applyIngest(tx, ctx.userId, [outcome], ctx.classifier.modelVersion, ctx.now)
  );
  if (outcome.kind === "block") {
    known.add(outcome.nodeUid);
    for (const r of outcome.relatedUids) known.add(r);
    ctx.result.blocked += 1;
  } else if (outcome.kind === "pass") {
    ctx.result.recovered += 1;
  }
}

async function runRecoveryPart(ctx: StageContext, limit: number): Promise<void> {
  const uids = await selectThumbnailRecoveryBatch(ctx.db, ctx.userId, limit);
  if (uids.length === 0) return;
  const known = await loadBlockedUids(ctx.db, ctx.userId);

  let read: Awaited<ReturnType<typeof readNodes>>;
  try {
    read = await readNodes(ctx.api, uids);
  } catch (error) {
    classifyFailure(error); // rethrows session errors, stops on an outage
    return; // any other listing failure: retry next tick, no attempt charged
  }
  await applyNodeOutcomes(ctx, read.outcomes);

  // Mains first, so a related photo of a main blocked here is never decoded.
  const candidates = [...read.candidates].sort(
    (a, b) => Number(a.mainPhotoNodeUid !== null) - Number(b.mainPhotoNodeUid !== null)
  );
  for (const photo of candidates) {
    if (ctx.pastDeadline()) throw new StopStage("deadline");
    await recoverCandidate(ctx, photo, known);
  }
}

export interface OriginalsOptions {
  /** False when the classifier is known to be down this tick: recovery is skipped. */
  recovery: boolean;
  pastDeadline: () => boolean;
  exifLimit?: number;
  recoveryLimit?: number;
}

/**
 * Runs recovery (if the classifier is up), then EXIF reads. Session-level
 * errors (auth, rate limit, fence) propagate to the tick; every other stop is
 * reported in the result and leaves already-written photos in place.
 */
export async function runOriginalsStage(
  db: Database,
  api: ProtonPhotosApi,
  classifier: PhotoClassifier,
  userId: string,
  fence: ProtonTickFence,
  now: Date,
  options: OriginalsOptions
): Promise<OriginalsResult> {
  const result: OriginalsResult = {
    recovered: 0,
    blocked: 0,
    exifChecked: 0,
    failed: 0,
    stopped: null,
  };
  const ctx: StageContext = {
    db,
    api,
    classifier,
    userId,
    fence,
    now,
    pastDeadline: options.pastDeadline,
    result,
  };
  const stop = (error: unknown): boolean => {
    if (!(error instanceof StopStage)) return false;
    result.stopped = error.reason;
    return true;
  };

  if (options.recovery) {
    try {
      await runRecoveryPart(ctx, options.recoveryLimit ?? THUMBNAIL_RECOVERY_BATCH_LIMIT);
    } catch (error) {
      if (!stop(error)) throw error;
      // A down classifier or HEIF decoder does not stop EXIF reads; anything else does.
      if (result.stopped !== "classifier_unavailable") return result;
    }
  }
  try {
    await runExifPart(ctx, options.exifLimit ?? ORIGINAL_EXIF_BATCH_LIMIT);
  } catch (error) {
    if (!stop(error)) throw error;
  }
  return result;
}
