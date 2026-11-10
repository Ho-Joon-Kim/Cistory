/**
 * Re-screens the stored Proton photo thumbnails with the current NSFW model
 * and thresholds (spec 3.4a) — run it after bumping NSFW_MODEL_VERSION or the
 * block thresholds in `src/modules/proton/nsfw/classifier.ts`.
 *
 * Works only on thumbnails already in `photo_thumbnails`: no Proton call is
 * made. Defaults to a dry run; `--apply` writes. A photo that is now blocked
 * goes through the same block path as ingest (`applyIngest`'s block outcome:
 * the row and its related rows are deleted, the thumbnail cascades, and
 * `photo_blocks` is inserted). Each batch is its own transaction.
 *
 * Fail closed: a stored thumbnail that can no longer be decoded is hidden
 * (bytes dropped, details marker cleared) so the details stage re-screens it;
 * it is never blocked, since a decoder regression must not block photos forever. An unavailable classifier aborts the run (nothing is half-written;
 * earlier batches stay committed and a re-run is idempotent).
 *
 * The run holds the same per-user session lock the cron sync takes
 * (`pg_try_advisory_lock` on `proton-sync:<userId>`), so it never interleaves
 * with a live sync tick for that user; it aborts if a tick holds it.
 *
 * Thumbnail bytes, scores and node uids are never logged.
 *
 * Usage:
 *   npx tsx scripts/rescreen-photo-thumbnails.ts <userId> [--apply]
 */

import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Pool } from "pg";
import { type Database, getDb, getPool, photos, photoThumbnails } from "../src/db";
import { applyIngest, type IngestOutcome } from "../src/modules/proton/ingest";
import {
  ClassifyInputError,
  isBlocked,
  type PhotoClassifier,
} from "../src/modules/proton/nsfw/classifier";
import { photoIsExposed } from "../src/modules/proton/repository";
import { PROTON_ERRORS } from "../src/modules/proton/types";

/** Thumbnails read (and classified) per page / per write transaction. */
export const RESCREEN_BATCH = 50;

export interface RescreenResult {
  scanned: number;
  blocked: number;
  /** Undecodable stored thumbnails: hidden for a re-fetch, not blocked. */
  hidden: number;
}

export type RescreenArgs = { userId: string; apply: boolean } | { error: string };

const USAGE = "Usage: npx tsx scripts/rescreen-photo-thumbnails.ts <userId> [--apply]";

/** Strict: anything but a single userId and an exact `--apply` is an error, never a silent write. */
export function parseRescreenArgs(rawArgs: string[]): RescreenArgs {
  const flags = rawArgs.filter((a) => a.startsWith("-"));
  const positionals = rawArgs.filter((a) => !a.startsWith("-"));
  const unknown = flags.filter((f) => f !== "--apply");
  if (unknown.length > 0) return { error: `Unknown flag ${unknown.join(", ")}. ${USAGE}` };
  if (positionals.length !== 1) return { error: USAGE };
  return { userId: positionals[0], apply: flags.includes("--apply") };
}

export class RescreenLockedError extends Error {
  constructor() {
    super(
      "A Proton sync for this user is running (proton-sync lock held). Re-run once it finishes."
    );
    this.name = "RescreenLockedError";
  }
}

/**
 * Runs `fn` under the user's `proton-sync:<userId>` session lock, on a
 * dedicated pool client, mirroring `syncProtonPhotosForUser`. Throws
 * `RescreenLockedError` without running `fn` when the lock is held. The unlock
 * runs on the same client; a client whose unlock (or lock query) failed is
 * destroyed rather than returned to the pool still holding the lock.
 */
export async function withRescreenLock<T>(
  pool: Pick<Pool, "connect">,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = `proton-sync:${userId}`;
  const client = await pool.connect();
  let locked = false;
  let releaseError: Error | undefined;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [lockKey]
    );
    locked = rows[0]?.locked === true;
    if (!locked) throw new RescreenLockedError();
    return await fn();
  } catch (error) {
    if (!locked && !(error instanceof RescreenLockedError)) {
      releaseError = error instanceof Error ? error : new Error("advisory lock failed");
    }
    throw error;
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]);
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error("advisory unlock failed");
      }
    }
    client.release(releaseError);
  }
}

async function verdict(
  classifier: PhotoClassifier,
  image: Uint8Array
): Promise<"pass" | "block" | "hide"> {
  try {
    return isBlocked(await classifier.classify(image)) ? "block" : "pass";
  } catch (error) {
    if (error instanceof ClassifyInputError) return "hide";
    throw error; // ClassifierUnavailableError or a runtime fault: abort, do not block.
  }
}

/**
 * Reversible, fail-closed hide: stop serving the bytes and drop the exposure
 * marker so the normal details stage re-fetches and re-screens the photo.
 */
async function hidePhotos(
  tx: Parameters<typeof applyIngest>[0],
  userId: string,
  ids: string[],
  now: Date
): Promise<void> {
  await tx.delete(photoThumbnails).where(inArray(photoThumbnails.photoId, ids));
  await tx
    .update(photos)
    .set({
      detailsSyncedAt: null,
      detailsError: PROTON_ERRORS.thumbnailUnclassifiable,
      detailsAttempts: 0,
      updatedAt: now,
    })
    .where(and(eq(photos.userId, userId), inArray(photos.id, ids)));
}

export async function rescreenUser(
  db: Database,
  userId: string,
  classifier: PhotoClassifier,
  opts: { dryRun: boolean }
): Promise<RescreenResult> {
  let scanned = 0;
  let blocked = 0;
  let hidden = 0;
  let cursor: string | null = null;

  for (;;) {
    const page: {
      id: string;
      nodeUid: string;
      mainPhotoNodeUid: string | null;
      bytes: Buffer;
    }[] = await db
      .select({
        id: photos.id,
        nodeUid: photos.nodeUid,
        mainPhotoNodeUid: photos.mainPhotoNodeUid,
        bytes: photoThumbnails.bytes,
      })
      .from(photoThumbnails)
      .innerJoin(photos, eq(photos.id, photoThumbnails.photoId))
      .where(
        and(eq(photos.userId, userId), photoIsExposed(), cursor ? gt(photos.id, cursor) : undefined)
      )
      .orderBy(asc(photos.id))
      .limit(RESCREEN_BATCH);
    if (page.length === 0) break;

    const outcomes: IngestOutcome[] = [];
    const hideIds: string[] = [];
    for (const row of page) {
      scanned += 1;
      const v = await verdict(classifier, row.bytes);
      if (v === "block") {
        blocked += 1;
        outcomes.push({ kind: "block", nodeUid: row.nodeUid, relatedUids: [] });
      } else if (v === "hide") {
        hidden += 1;
        hideIds.push(row.id);
      }
    }

    if (!opts.dryRun && (outcomes.length > 0 || hideIds.length > 0)) {
      const now = new Date();
      await db.transaction(async (tx) => {
        await applyIngest(tx, userId, outcomes, classifier.modelVersion, now);
        if (hideIds.length > 0) await hidePhotos(tx, userId, hideIds, now);
      });
    }

    cursor = page[page.length - 1].id;
    if (page.length < RESCREEN_BATCH) break;
  }
  return { scanned, blocked, hidden };
}

async function main() {
  const parsed = parseRescreenArgs(argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }
  // Loaded only here so importing this file (tests) never pulls in the TF runtime.
  const { createNsfwjsClassifier } = await import("../src/modules/proton/nsfw/nsfwjs");
  const classifier = createNsfwjsClassifier();
  const dryRun = !parsed.apply;
  console.log(
    `Re-screening stored thumbnails for ${parsed.userId} with ${classifier.modelVersion} (${
      dryRun ? "dry run, nothing written" : "APPLY"
    }) ...`
  );
  const { scanned, blocked, hidden } = await withRescreenLock(getPool(), parsed.userId, () =>
    rescreenUser(getDb(), parsed.userId, classifier, { dryRun })
  );
  console.log(
    `Done: scanned=${scanned}, ${dryRun ? "would block" : "blocked"}=${blocked}, ${
      dryRun ? "would hide" : "hidden"
    }=${hidden}` + (dryRun && blocked + hidden > 0 ? " (re-run with --apply to write)" : "")
  );
}

const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMainModule) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "rescreen failed");
      process.exitCode = 1;
    })
    .finally(async () => {
      await getPool().end();
    });
}
