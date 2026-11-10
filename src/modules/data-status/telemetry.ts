import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { sourceSyncStates } from "@/db/schema";
import { logger } from "@/lib/logger";

/** The fixed message stored on a failed sync (never a provider payload). */
export const SOURCE_SYNC_ERROR = "동기화하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.";
/** Rows written before the copy moved to 해요체 still hold this. */
const LEGACY_SOURCE_SYNC_ERROR = "동기화하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.";

/** Stored source error in the current wording (older rows predate the 해요체 copy). */
export function currentSourceError(error: string | null | undefined): string | null {
  if (!error) return null;
  return error === LEGACY_SOURCE_SYNC_ERROR ? SOURCE_SYNC_ERROR : error;
}

import type { SourceId } from "./types";

export async function trackSourceSync<T>(
  db: Database,
  userId: string,
  source: SourceId,
  run: () => Promise<T>
): Promise<T> {
  const at = new Date();
  const [attempt] = await db
    .insert(sourceSyncStates)
    .values({ userId, source, lastAttemptAt: at })
    .onConflictDoUpdate({
      target: [sourceSyncStates.userId, sourceSyncStates.source],
      // Allocate a distinct millisecond even when two workers start together.
      set: {
        lastAttemptAt: sql`greatest(${sourceSyncStates.lastAttemptAt} + interval '1 millisecond', ${at.toISOString()}::timestamp)`,
      },
    })
    .returning({ at: sourceSyncStates.lastAttemptAt });
  const ownAttempt = and(
    eq(sourceSyncStates.userId, userId),
    eq(sourceSyncStates.source, source),
    eq(sourceSyncStates.lastAttemptAt, attempt.at)
  );
  try {
    const result = await run();
    await db
      .update(sourceSyncStates)
      .set({ lastSuccessAt: new Date(), error: null })
      .where(ownAttempt);
    return result;
  } catch (error) {
    // Never persist provider payloads, credentials, or private records in the UI error.
    await db.update(sourceSyncStates).set({ error: SOURCE_SYNC_ERROR }).where(ownAttempt);
    throw error;
  }
}

/** Successful push receipt; delayed writes must not erase newer attempts or failures. */
export async function recordSourceSuccess(
  db: Database,
  userId: string,
  source: SourceId,
  at: Date
): Promise<void> {
  try {
    await db
      .insert(sourceSyncStates)
      .values({
        userId,
        source,
        lastAttemptAt: at,
        lastSuccessAt: at,
        error: null,
      })
      .onConflictDoUpdate({
        target: [sourceSyncStates.userId, sourceSyncStates.source],
        set: {
          lastAttemptAt: sql`greatest(${sourceSyncStates.lastAttemptAt}, ${at.toISOString()}::timestamp)`,
          lastSuccessAt: sql`greatest(${sourceSyncStates.lastSuccessAt}, ${at.toISOString()}::timestamp)`,
          error: sql`CASE WHEN ${sourceSyncStates.lastAttemptAt} IS NULL OR ${sourceSyncStates.lastAttemptAt} <= ${at.toISOString()}::timestamp THEN NULL ELSE ${sourceSyncStates.error} END`,
        },
      });
  } catch {
    // Ingestion already committed; telemetry failure must not cause device retries.
    logger.warn("[Data status] push success telemetry could not be saved", { source });
  }
}
