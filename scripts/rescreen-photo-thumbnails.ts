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
 * Fail closed: a stored thumbnail that can no longer be decoded counts as
 * blocked. An unavailable classifier aborts the run (nothing is half-written;
 * earlier batches stay committed and a re-run is idempotent).
 *
 * Thumbnail bytes, scores and node uids are never logged.
 *
 * Usage:
 *   npx tsx scripts/rescreen-photo-thumbnails.ts <userId> [--apply]
 */

import { argv } from "node:process";
import { and, asc, eq, gt } from "drizzle-orm";
import { type Database, getDb, getPool, photos, photoThumbnails } from "../src/db";
import { applyIngest, type IngestOutcome } from "../src/modules/proton/ingest";
import {
  ClassifyInputError,
  isBlocked,
  type PhotoClassifier,
} from "../src/modules/proton/nsfw/classifier";
import { photoIsExposed } from "../src/modules/proton/repository";

/** Thumbnails read (and classified) per page / per write transaction. */
export const RESCREEN_BATCH = 50;

export interface RescreenResult {
  scanned: number;
  blocked: number;
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

async function wouldBlock(classifier: PhotoClassifier, jpeg: Uint8Array): Promise<boolean> {
  try {
    return isBlocked(await classifier.classify(jpeg));
  } catch (error) {
    if (error instanceof ClassifyInputError) return true;
    throw error; // ClassifierUnavailableError or a runtime fault: abort, do not block.
  }
}

export async function rescreenUser(
  db: Database,
  userId: string,
  classifier: PhotoClassifier,
  opts: { dryRun: boolean }
): Promise<RescreenResult> {
  let scanned = 0;
  let blocked = 0;
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
    for (const row of page) {
      scanned += 1;
      if (await wouldBlock(classifier, row.bytes)) {
        blocked += 1;
        outcomes.push({ kind: "block", nodeUid: row.nodeUid, relatedUids: [] });
      }
    }

    if (!opts.dryRun && outcomes.length > 0) {
      const now = new Date();
      await db.transaction(async (tx) => {
        await applyIngest(tx, userId, outcomes, classifier.modelVersion, now);
      });
    }

    cursor = page[page.length - 1].id;
    if (page.length < RESCREEN_BATCH) break;
  }
  return { scanned, blocked };
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
  const { scanned, blocked } = await rescreenUser(getDb(), parsed.userId, classifier, { dryRun });
  console.log(
    `Done: scanned=${scanned}, ${dryRun ? "would block" : "blocked"}=${blocked}` +
      (dryRun && blocked > 0 ? " (re-run with --apply to write)" : "")
  );
}

const isMainModule = import.meta.url === `file://${argv[1]}`;
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
