import { and, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { photoBlocks, photos } from "@/db/schema";
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

/** Listed-only rows still owed a screening attempt, newest capture first. */
export async function selectDetailsBatch(
  db: ProtonDbExecutor,
  userId: string,
  limit: number
): Promise<string[]> {
  const rows = await db
    .select({ nodeUid: photos.nodeUid })
    .from(photos)
    .where(
      and(
        eq(photos.userId, userId),
        isNull(photos.detailsSyncedAt),
        lt(photos.detailsAttempts, PROTON_MAX_DETAILS_ATTEMPTS),
        isNull(photos.deletedAt)
      )
    )
    .orderBy(desc(photos.capturedAt))
    .limit(limit);
  return rows.map((r) => r.nodeUid);
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
  blocked: ReadonlySet<string>
): Promise<void> {
  const now = new Date();
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
