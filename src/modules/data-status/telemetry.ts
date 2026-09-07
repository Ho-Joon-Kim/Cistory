import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { sourceSyncStates } from "@/db/schema";
import { logger } from "@/lib/logger";
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
    await db
      .update(sourceSyncStates)
      .set({ error: "동기화에 실패했습니다. 연동 상태를 확인하고 다시 시도해 주세요." })
      .where(ownAttempt);
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
