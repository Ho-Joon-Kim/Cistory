/**
 * Write idempotency keys (`mcp_idempotency`). A retried create with the same
 * (token, key) returns the first result instead of writing twice. Keys live
 * 24 hours: reads ignore older rows and the cron's syncAllUsers loop prunes them.
 *
 * U1 only ships the retention constant and the prune; the lookup/store helpers
 * used by the write tools are U9's.
 */

import { lt } from "drizzle-orm";
import type { Database } from "@/db";
import { mcpIdempotency } from "@/db/schema";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Oldest `created_at` a key may have and still be honored. */
export function idempotencyCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - IDEMPOTENCY_TTL_MS);
}

/** Delete expired keys. Returns how many were removed. */
export async function pruneExpiredIdempotencyKeys(
  db: Pick<Database, "delete">,
  now: Date = new Date()
): Promise<number> {
  const deleted = await db
    .delete(mcpIdempotency)
    .where(lt(mcpIdempotency.createdAt, idempotencyCutoff(now)))
    .returning({ id: mcpIdempotency.id });
  return deleted.length;
}
