import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Database } from "@/db";
import { type ProtonConnection, photoBlocks, photos, protonConnections } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { PROTON_MAX_DETAILS_ATTEMPTS } from "./types";

/**
 * Anything that can run Drizzle statements: the root db or a transaction.
 * The ingest writes always run in the caller's transaction.
 */
export type ProtonDbExecutor = Pick<Database, "select" | "insert" | "update" | "delete">;

/** Rows per multi-row upsert, well under Postgres' 65,535 bind-parameter limit. */
const UPSERT_CHUNK = 1000;

/**
 * The one exposure rule: a photo is counted or served only once its details
 * passed screening and it has not been deleted upstream.
 */
export function photoIsExposed(): SQL {
  return and(isNotNull(photos.detailsSyncedAt), isNull(photos.deletedAt)) as SQL;
}

export async function loadBlockedUids(db: ProtonDbExecutor, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ nodeUid: photoBlocks.nodeUid })
    .from(photoBlocks)
    .where(eq(photoBlocks.userId, userId));
  return new Set(rows.map((r) => r.nodeUid));
}

/**
 * Rows still owed a screening attempt: never verified, live, and under the
 * attempt cap. A row that failed three times drops out, so one bad photo can
 * never hold the backfill open.
 */
function pendingDetails(userId: string): SQL {
  return and(
    eq(photos.userId, userId),
    isNull(photos.detailsSyncedAt),
    lt(photos.detailsAttempts, PROTON_MAX_DETAILS_ATTEMPTS),
    isNull(photos.deletedAt)
  ) as SQL;
}

/** Listed-only rows still owed a screening attempt, newest capture first. */
export async function selectDetailsBatch(
  db: ProtonDbExecutor,
  userId: string,
  limit: number
): Promise<string[]> {
  const rows = await db
    .select({ nodeUid: photos.nodeUid })
    .from(photos)
    .where(pendingDetails(userId))
    .orderBy(desc(photos.capturedAt))
    .limit(limit);
  return rows.map((r) => r.nodeUid);
}

/** How many rows `selectDetailsBatch` could still hand out. */
export async function countPendingDetails(db: ProtonDbExecutor, userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(photos).where(pendingDetails(userId));
  return Number(row?.n ?? 0);
}

/**
 * Upserts timeline listing rows (hidden until screened). Blocked uids are
 * never written. On conflict only the listing fields move and `deleted_at`
 * clears (the node reappeared); screening state and attempt counters are kept.
 */
export async function upsertTimelineItems(
  db: ProtonDbExecutor,
  userId: string,
  items: { nodeUid: string; captureTime: Date; tags: number[] }[],
  blocked: ReadonlySet<string>,
  now: Date
): Promise<void> {
  const rows = items
    .filter((item) => !blocked.has(item.nodeUid))
    .map((item) => ({
      userId,
      nodeUid: item.nodeUid,
      capturedAt: item.captureTime,
      tags: item.tags,
      createdAt: now,
      updatedAt: now,
    }));
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await db
      .insert(photos)
      .values(rows.slice(i, i + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [photos.userId, photos.nodeUid],
        set: {
          capturedAt: sql`excluded.captured_at`,
          tags: sql`excluded.tags`,
          deletedAt: null,
          updatedAt: now,
        },
      });
  }
}

/** Soft-deletes the given nodes and every related photo whose main is among them. */
export async function markNodesDeleted(
  tx: ProtonDbExecutor,
  userId: string,
  uids: string[],
  now: Date
): Promise<void> {
  if (uids.length === 0) return;
  await tx
    .update(photos)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(photos.userId, userId),
        isNull(photos.deletedAt),
        or(inArray(photos.nodeUid, uids), inArray(photos.mainPhotoNodeUid, uids))
      )
    );
}

/**
 * Gives a changed node a fresh screening budget before it is re-ingested.
 *
 * Only never-verified rows are touched: a row that already passed stays
 * exposed (ruling C3) and is overwritten only by a new passing verdict. Absent
 * rows need no placeholder here — a failed ingest inserts its own hidden
 * placeholder (ruling C4).
 */
export async function resetForReingest(
  tx: ProtonDbExecutor,
  userId: string,
  uids: string[],
  now: Date
): Promise<void> {
  if (uids.length === 0) return;
  await tx
    .update(photos)
    .set({ detailsAttempts: 0, detailsError: null, updatedAt: now })
    .where(
      and(eq(photos.userId, userId), isNull(photos.detailsSyncedAt), inArray(photos.nodeUid, uids))
    );
}

/**
 * Reconciles the stored rows against one complete timeline listing.
 *
 * Main rows (`main_photo_node_uid IS NULL`) the listing no longer contains
 * are soft-deleted. Related photos (Live Photo parts and the like) may never
 * appear in the listing, so they are not judged by their own presence: they
 * are soft-deleted only when their main is no longer listed.
 *
 * `listed` must be the complete listing; an empty or partial one would
 * delete live photos, so the caller never calls this in that case (C12).
 */
export async function softDeleteUnlisted(
  tx: ProtonDbExecutor,
  userId: string,
  listed: string[],
  now: Date
): Promise<void> {
  if (listed.length === 0) throw new Error("softDeleteUnlisted needs a non-empty listing");
  // One bound text[] parameter, not one parameter per uid.
  const listedParam = sql`${sql.param(listed)}::text[]`;
  await tx
    .update(photos)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(photos.userId, userId),
        isNull(photos.deletedAt),
        isNull(photos.mainPhotoNodeUid),
        sql`${photos.nodeUid} <> ALL(${listedParam})`
      )
    );
  await tx
    .update(photos)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(photos.userId, userId),
        isNull(photos.deletedAt),
        isNotNull(photos.mainPhotoNodeUid),
        sql`${photos.mainPhotoNodeUid} <> ALL(${listedParam})`
      )
    );
}

/** Stores the backfill's baseline event cursor; never overwrites one already stored. */
export async function saveBaselineCursor(
  tx: ProtonDbExecutor,
  userId: string,
  cursor: string,
  now: Date
): Promise<void> {
  await tx
    .update(protonConnections)
    .set({ eventCursor: cursor, updatedAt: now })
    .where(and(eq(protonConnections.userId, userId), isNull(protonConnections.eventCursor)));
}

export async function markTimelineListed(
  tx: ProtonDbExecutor,
  userId: string,
  now: Date
): Promise<void> {
  await tx
    .update(protonConnections)
    .set({ timelineListedAt: now, updatedAt: now })
    .where(eq(protonConnections.userId, userId));
}

/** Records completion; only a listed, not-yet-completed backfill can complete. */
export async function markBackfillComplete(
  tx: ProtonDbExecutor,
  userId: string,
  now: Date
): Promise<void> {
  await tx
    .update(protonConnections)
    .set({ backfillCompletedAt: now, updatedAt: now })
    .where(
      and(
        eq(protonConnections.userId, userId),
        isNotNull(protonConnections.timelineListedAt),
        isNull(protonConnections.backfillCompletedAt)
      )
    );
}

/**
 * What a sync tick started with. Every write batch re-checks it, so a tick
 * that raced a reconnect or disconnect writes nothing into the new state.
 */
export interface ProtonTickFence {
  volumeId: string;
  /** Proton session uid, decrypted: a token refresh re-encrypts the same uid. */
  uid: string;
}

/** Thrown inside a write transaction (rolling it back) when the fence no longer holds. */
export class ProtonConnectionChangedError extends Error {
  constructor() {
    super("Proton connection changed during the sync tick");
    this.name = "ProtonConnectionChangedError";
  }
}

function decryptOrNull(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}

/** The fence for a tick starting from `connection`; throws if it is not syncable. */
export function connectionFence(connection: ProtonConnection): ProtonTickFence {
  const uid = decryptOrNull(connection.uidEnc);
  if (connection.status !== "active" || !connection.volumeId || !uid) {
    throw new ProtonConnectionChangedError();
  }
  return { volumeId: connection.volumeId, uid };
}

/**
 * Locks the connection row for the rest of `tx` and throws
 * `ProtonConnectionChangedError` unless it is still the active connection the
 * tick started with. Call it first in every write transaction.
 */
export async function assertConnectionUnchanged(
  tx: ProtonDbExecutor,
  userId: string,
  fence: ProtonTickFence
): Promise<void> {
  const [row] = await tx
    .select({
      status: protonConnections.status,
      volumeId: protonConnections.volumeId,
      uidEnc: protonConnections.uidEnc,
    })
    .from(protonConnections)
    .where(eq(protonConnections.userId, userId))
    .for("update");
  if (
    row?.status !== "active" ||
    row.volumeId !== fence.volumeId ||
    decryptOrNull(row.uidEnc) !== fence.uid
  ) {
    throw new ProtonConnectionChangedError();
  }
}
