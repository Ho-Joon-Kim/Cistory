/**
 * Incremental sync from the Drive event stream (spec 3.4).
 *
 * Events are read from the stored cursor in batches of `EVENT_BATCH`. Each
 * batch is planned (last event per node wins), its created/updated nodes are
 * prepared through the ingest pipeline with no transaction open, and then the
 * whole batch — attempt resets, ingest outcomes, deletions, tree flags and
 * the new cursor — is written in ONE fenced transaction. The cursor therefore
 * never moves past a change that was not applied: a batch that fails to
 * prepare writes nothing and is re-read on the next tick.
 *
 *   node_created / node_updated → re-ingest (blocked uids skipped)
 *   node_deleted                → soft delete (and its related photos)
 *   fast_forward                → cursor only
 *   tree_refresh                → forget the listing so the backfill re-lists
 *   tree_remove                 → needs_reauth, stop
 *   cursor rejected (404/422)   → fresh baseline cursor + tree_refresh reset
 *
 * Auth failures and rate limits propagate untouched for the tick to handle;
 * an unavailable classifier stops before the failing batch (ruling C6).
 */
import { type DriveEvent, DriveEventType } from "@protontech/drive-sdk";
import type { Database } from "@/db";
import type { ProtonConnection } from "@/db/schema";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { isCursorRejection } from "@/lib/adapters/proton/errors";
import { captureBaselineCursor } from "./backfill";
import { applyIngest, prepareIngest } from "./ingest";
import { ClassifierUnavailableError, type PhotoClassifier } from "./nsfw/classifier";
import {
  assertConnectionUnchanged,
  loadBlockedUids,
  markNodesDeleted,
  type ProtonTickFence,
  resetForReingest,
  saveEventBatchState,
} from "./repository";

export interface EventPlan {
  upsertUids: string[];
  deleteUids: string[];
  treeRefresh: boolean;
  treeRemoved: boolean;
  lastEventId: string | null;
}

/** Events per planned batch, i.e. per write transaction. */
export const EVENT_BATCH = 100;

export type EventsStop = "end" | "tree_removed" | "cursor_reset" | "classifier_unavailable";

export interface EventsResult {
  /** Events whose batch was committed. */
  applied: number;
  stopped: EventsStop;
  classifierUnavailable: boolean;
}

/**
 * Reduces one batch to its writes. Only events of `volumeId`'s scope count
 * (`shared_with_me_updated` lives in the `core` scope); a foreign scope's
 * event id is never taken as this volume's cursor.
 *
 * A `tree_remove` ends the plan: nothing after it is read, and nothing is
 * re-ingested, since the volume's nodes can no longer be fetched (the user
 * re-lists on reconnect). Its `eventId` is the literal `"none"` and never
 * becomes the cursor.
 */
export function planEventBatch(
  events: DriveEvent[],
  volumeId: string,
  blocked: ReadonlySet<string>
): EventPlan {
  const lastAction = new Map<string, "upsert" | "delete">();
  let treeRefresh = false;
  let treeRemoved = false;
  let lastEventId: string | null = null;

  for (const event of events) {
    if (event.treeEventScopeId !== volumeId) continue;
    switch (event.type) {
      case DriveEventType.NodeCreated:
      case DriveEventType.NodeUpdated:
        lastAction.delete(event.nodeUid); // re-insert so iteration order follows the last event
        if (!blocked.has(event.nodeUid)) lastAction.set(event.nodeUid, "upsert");
        break;
      case DriveEventType.NodeDeleted:
        lastAction.delete(event.nodeUid);
        lastAction.set(event.nodeUid, "delete");
        break;
      case DriveEventType.TreeRefresh:
        treeRefresh = true;
        break;
      case DriveEventType.TreeRemove:
        treeRemoved = true;
        break;
      case DriveEventType.FastForward:
        break;
      default:
        continue; // shared_with_me_updated and anything newer: not ours
    }
    if (treeRemoved) break;
    lastEventId = event.eventId;
  }

  const upsertUids: string[] = [];
  const deleteUids: string[] = [];
  for (const [uid, action] of lastAction) {
    if (action === "delete") deleteUids.push(uid);
    else if (!treeRemoved) upsertUids.push(uid);
  }
  return { upsertUids, deleteUids, treeRefresh, treeRemoved, lastEventId };
}

function isEmptyPlan(plan: EventPlan): boolean {
  return (
    plan.upsertUids.length === 0 &&
    plan.deleteUids.length === 0 &&
    !plan.treeRefresh &&
    !plan.treeRemoved &&
    plan.lastEventId === null
  );
}

/** Marks an error thrown by the event stream itself, as opposed to ingest. */
class EventStreamError extends Error {
  constructor(readonly original: unknown) {
    super("Proton event stream failed");
  }
}

/** Yields batches of at most `EVENT_BATCH` events; a `tree_remove` closes its batch. */
async function* eventBatches(stream: AsyncIterable<DriveEvent>): AsyncGenerator<DriveEvent[]> {
  const iterator = stream[Symbol.asyncIterator]();
  let batch: DriveEvent[] = [];
  try {
    while (true) {
      let next: IteratorResult<DriveEvent>;
      try {
        next = await iterator.next();
      } catch (error) {
        throw new EventStreamError(error);
      }
      if (next.done) break;
      batch.push(next.value);
      if (next.value.type === DriveEventType.TreeRemove || batch.length >= EVENT_BATCH) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
  } finally {
    // Stops the SDK generator when the caller stops early (tree_remove, errors).
    await iterator.return?.();
  }
}

interface EventContext {
  db: Database;
  api: ProtonPhotosApi;
  classifier: PhotoClassifier;
  userId: string;
  fence: ProtonTickFence;
  now: Date;
}

/**
 * Prepares (network, no transaction) and then writes one planned batch in one
 * fenced transaction, cursor included. Adds the batch's new blocks to
 * `blocked` so later batches treat them as known.
 */
async function applyEventBatch(
  ctx: EventContext,
  plan: EventPlan,
  blocked: Set<string>
): Promise<void> {
  const { db, api, classifier, userId, fence, now } = ctx;
  const outcomes =
    plan.upsertUids.length > 0
      ? await prepareIngest(api, classifier, plan.upsertUids, blocked)
      : [];

  await db.transaction(async (tx) => {
    await assertConnectionUnchanged(tx, userId, fence);
    await resetForReingest(tx, userId, plan.upsertUids, now);
    await applyIngest(tx, userId, outcomes, classifier.modelVersion, now);
    // After ingest, so a related photo re-ingested here still follows its deleted main.
    await markNodesDeleted(tx, userId, plan.deleteUids, now);
    await saveEventBatchState(
      tx,
      userId,
      { cursor: plan.lastEventId, resetListing: plan.treeRefresh, treeRemoved: plan.treeRemoved },
      now
    );
  });

  for (const o of outcomes) {
    if (o.kind !== "block") continue;
    blocked.add(o.nodeUid);
    for (const r of o.relatedUids) blocked.add(r);
  }
}

/**
 * The stored cursor was rejected: start over from a fresh baseline and let
 * the backfill re-list and reconcile, exactly like a tree_refresh.
 */
async function rebaseline(ctx: EventContext): Promise<void> {
  const { db, api, userId, fence, now } = ctx;
  const baseline = await captureBaselineCursor(api, fence.volumeId);
  await db.transaction(async (tx) => {
    await assertConnectionUnchanged(tx, userId, fence);
    await saveEventBatchState(
      tx,
      userId,
      { cursor: baseline, resetListing: true, treeRemoved: false },
      now
    );
  });
}

/**
 * Applies the event stream from `conn.eventCursor`. Does nothing without a
 * cursor: the backfill's baseline stage stores the first one. Every write
 * transaction starts with the tick's fence check, so a tick racing a
 * reconnect or disconnect throws `ProtonConnectionChangedError` unwritten.
 */
export async function processEvents(
  db: Database,
  api: ProtonPhotosApi,
  classifier: PhotoClassifier,
  conn: Pick<ProtonConnection, "userId" | "eventCursor">,
  fence: ProtonTickFence,
  now: Date
): Promise<EventsResult> {
  const { userId, eventCursor } = conn;
  let applied = 0;
  const result = (stopped: EventsStop): EventsResult => ({
    applied,
    stopped,
    classifierUnavailable: stopped === "classifier_unavailable",
  });
  if (!eventCursor) return result("end");

  const ctx: EventContext = { db, api, classifier, userId, fence, now };
  const blocked = await loadBlockedUids(db, userId);
  try {
    for await (const batch of eventBatches(api.iterateEvents(fence.volumeId, eventCursor))) {
      const plan = planEventBatch(batch, fence.volumeId, blocked);
      // A batch of only foreign-scope events has nothing to write.
      if (!isEmptyPlan(plan)) await applyEventBatch(ctx, plan, blocked);
      applied += batch.length;
      if (plan.treeRemoved) return result("tree_removed");
    }
    return result("end");
  } catch (error) {
    if (error instanceof ClassifierUnavailableError) return result("classifier_unavailable");
    if (!(error instanceof EventStreamError)) throw error;
    if (!isCursorRejection(error.original)) throw error.original;
  }
  await rebaseline(ctx);
  return result("cursor_reset");
}
