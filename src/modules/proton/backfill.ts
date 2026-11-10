/**
 * Initial backfill (spec 3.4), one step per sync tick:
 *
 *   baseline — store the event cursor first, so changes made while the
 *              backfill runs are picked up by event processing;
 *   list     — read the whole timeline once (only while
 *              `timeline_listed_at IS NULL`), upsert hidden rows and
 *              reconcile deletions;
 *   details  — screen up to 500 pending rows per tick through the ingest
 *              pipeline;
 *   complete — stamp `backfill_completed_at` once nothing is pending.
 *
 * Proton is only ever called outside a transaction. Every write transaction
 * first re-checks the tick's fence (`assertConnectionUnchanged`), so a tick
 * that raced a reconnect or disconnect writes nothing.
 */
import { DriveEventType } from "@protontech/drive-sdk";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { type ProtonConnection, protonConnections } from "@/db/schema";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { applyIngest, INGEST_CHUNK, prepareIngest } from "./ingest";
import type { PhotoClassifier } from "./nsfw/classifier";
import {
  assertConnectionUnchanged,
  countLivePhotos,
  countPendingDetails,
  loadBlockedUids,
  markBackfillComplete,
  markTimelineListed,
  type ProtonTickFence,
  saveBaselineCursor,
  selectDetailsBatch,
  softDeleteUnlisted,
  upsertTimelineItems,
} from "./repository";

export type BackfillStep = "baseline" | "list" | "details" | "complete" | "done";

/** Rows screened per tick, so one tick never holds the cron event loop for long. */
export const DETAILS_BATCH_LIMIT = 500;

export function nextBackfillStep(
  c: Pick<ProtonConnection, "eventCursor" | "timelineListedAt" | "backfillCompletedAt">,
  pendingDetails: number
): BackfillStep {
  if (c.backfillCompletedAt) return "done";
  if (!c.eventCursor) return "baseline";
  if (!c.timelineListedAt) return "list";
  return pendingDetails > 0 ? "details" : "complete";
}

/** The latest event id: without a cursor the SDK yields exactly one `fast_forward`. */
export async function captureBaselineCursor(
  api: ProtonPhotosApi,
  volumeId: string
): Promise<string> {
  for await (const event of api.iterateEvents(volumeId)) {
    if (event.type === DriveEventType.FastForward) return event.eventId;
  }
  throw new Error("Proton returned no baseline event cursor");
}

export async function runBaselineStage(
  db: Database,
  api: ProtonPhotosApi,
  userId: string,
  fence: ProtonTickFence,
  now: Date
): Promise<string> {
  const cursor = await captureBaselineCursor(api, fence.volumeId);
  await db.transaction(async (tx) => {
    await assertConnectionUnchanged(tx, userId, fence);
    await saveBaselineCursor(tx, userId, cursor, now);
  });
  return cursor;
}

type TimelineItem = { nodeUid: string; captureTime: Date; tags: number[] };

/**
 * Reads the full timeline and applies it in one transaction: upsert listed
 * rows (blocked uids skipped, reappearing rows un-deleted), soft-delete what
 * the listing no longer has, then stamp `timeline_listed_at`. Returns the
 * number of distinct listed nodes.
 *
 * Runs only while `timeline_listed_at IS NULL`, re-checked under the fence
 * lock. A listing that throws writes nothing (C12). An empty listing marks
 * the timeline listed only when the user has no live rows (nothing it could
 * wrongly delete); with live rows it may be a partial answer, so it writes
 * nothing and the next tick lists again (C12 refinement).
 */
export async function runTimelineListing(
  db: Database,
  api: ProtonPhotosApi,
  userId: string,
  fence: ProtonTickFence,
  now: Date
): Promise<number> {
  const [conn] = await db
    .select({ timelineListedAt: protonConnections.timelineListedAt })
    .from(protonConnections)
    .where(eq(protonConnections.userId, userId));
  if (!conn || conn.timelineListedAt) return 0;

  // Last occurrence wins; one statement must never upsert the same key twice.
  const items = new Map<string, TimelineItem>();
  for await (const item of api.iterateTimeline()) items.set(item.nodeUid, item);

  const listed = [...items.keys()];
  // A node with an unusable capture time is still listed (so it is not
  // soft-deleted) but has nothing to store yet.
  const storable = [...items.values()].filter((i) => !Number.isNaN(i.captureTime.getTime()));

  await db.transaction(async (tx) => {
    const { timelineListedAt } = await assertConnectionUnchanged(tx, userId, fence);
    if (timelineListedAt) return; // listed meanwhile: list once, never reconcile twice
    if (listed.length === 0) {
      if ((await countLivePhotos(tx, userId)) === 0) await markTimelineListed(tx, userId, now);
      return;
    }
    const blocked = await loadBlockedUids(tx, userId);
    await upsertTimelineItems(tx, userId, storable, blocked, now);
    await softDeleteUnlisted(tx, userId, listed, now);
    await markTimelineListed(tx, userId, now);
  });
  return items.size;
}

/**
 * Screens up to `limit` pending rows. Each 50-uid chunk is prepared with no
 * transaction open (nodes, thumbnails, classification), then its outcomes are
 * applied in order in one fenced transaction. A `ClassifierUnavailableError`
 * or network error propagates; chunks already applied stay applied.
 */
export async function runDetailsStage(
  db: Database,
  api: ProtonPhotosApi,
  classifier: PhotoClassifier,
  userId: string,
  fence: ProtonTickFence,
  now: Date,
  limit: number = DETAILS_BATCH_LIMIT
): Promise<{ processed: number }> {
  const uids = await selectDetailsBatch(db, userId, limit);
  if (uids.length === 0) return { processed: 0 };
  const blocked = await loadBlockedUids(db, userId);

  let processed = 0;
  for (let i = 0; i < uids.length; i += INGEST_CHUNK) {
    const chunk = uids.slice(i, i + INGEST_CHUNK);
    const outcomes = await prepareIngest(api, classifier, chunk, blocked);
    await db.transaction(async (tx) => {
      await assertConnectionUnchanged(tx, userId, fence);
      await applyIngest(tx, userId, outcomes, classifier.modelVersion, now);
    });
    // Later chunks must treat this chunk's blocks as known.
    for (const o of outcomes) {
      if (o.kind !== "block") continue;
      blocked.add(o.nodeUid);
      for (const r of o.relatedUids) blocked.add(r);
    }
    processed += chunk.length;
  }
  return { processed };
}

/** Stamps `backfill_completed_at` if nothing is pending any more; returns whether it did. */
export async function completeBackfill(
  db: Database,
  userId: string,
  fence: ProtonTickFence,
  now: Date
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await assertConnectionUnchanged(tx, userId, fence);
    if ((await countPendingDetails(tx, userId)) > 0) return false;
    await markBackfillComplete(tx, userId, now);
    return true;
  });
}
