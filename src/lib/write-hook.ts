import type { Database } from "@/db";

/** The transaction handle `Database.transaction` passes to its callback. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Runs inside a service write's transaction, after the change and before
 * commit. Throwing rolls the whole write back. Web routes use it for overview
 * invalidation; the MCP layer adds token re-checks and audit rows.
 */
export type InTxHook<T> = (
  tx: DbTransaction,
  change: { before: T | null; after: T | null }
) => Promise<void>;

export interface WriteOptions<T> {
  inTx?: InTxHook<T>;
  database?: Database;
}
