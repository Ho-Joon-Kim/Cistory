/**
 * Write idempotency keys (`mcp_idempotency`). A retried create with the same
 * (token, key) returns the first result instead of writing twice. Keys live
 * 24 hours: reads ignore older rows and the cron's syncAllUsers loop prunes them.
 *
 * The write tools (tools/writes.ts) look the key up before writing and store
 * the result inside the write's own transaction, so a stored key always
 * belongs to a committed write.
 */

import { createHash } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import type { Database } from "@/db";
import { mcpIdempotency } from "@/db/schema";
import { McpToolError } from "./errors";

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

// ── Lookup / store (U9) ──────────────────────────────────────────────────────

/** Same key reused with different arguments. */
export class IdempotencyConflictError extends McpToolError {
  constructor() {
    super(
      "같은 멱등 키가 다른 인자로 이미 쓰였습니다. 새 작업에는 새 키를 쓰세요.",
      "idempotency_conflict"
    );
    this.name = "IdempotencyConflictError";
  }
}

/**
 * A concurrent call stored the same (token, key) first. Thrown inside the
 * write's transaction so it rolls back; the caller then re-reads the winner.
 */
export class IdempotencyRaceError extends Error {
  constructor() {
    super("idempotency key stored concurrently");
    this.name = "IdempotencyRaceError";
  }
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** SHA-256 over the tool name and the canonical arguments (key itself excluded). */
export function idempotencyArgsHash(tool: string, args: Record<string, unknown>): string {
  const { idempotencyKey: _key, ...rest } = args;
  return createHash("sha256")
    .update(`${tool}\n${stableStringify(rest)}`, "utf8")
    .digest("hex");
}

export interface IdempotencyHit {
  result: Record<string, unknown>;
}

/**
 * The stored result for (token, key), or null when there is none younger than
 * 24h. Throws IdempotencyConflictError when the key was used for a different
 * tool or different arguments.
 */
export async function lookupIdempotency(
  db: Pick<Database, "select">,
  call: { tokenId: string; key: string; tool: string; argsHash: string },
  now: Date = new Date()
): Promise<IdempotencyHit | null> {
  const [row] = await db
    .select({
      tool: mcpIdempotency.tool,
      argsHash: mcpIdempotency.argsHash,
      result: mcpIdempotency.result,
    })
    .from(mcpIdempotency)
    .where(
      and(
        eq(mcpIdempotency.tokenId, call.tokenId),
        eq(mcpIdempotency.key, call.key),
        gte(mcpIdempotency.createdAt, idempotencyCutoff(now))
      )
    );
  if (!row) return null;
  if (row.tool !== call.tool || row.argsHash !== call.argsHash) {
    throw new IdempotencyConflictError();
  }
  return { result: row.result as Record<string, unknown> };
}

/**
 * Store the first result inside the write's transaction. An expired row for
 * the same key (not yet pruned) is overwritten; a live one means another call
 * won the race → IdempotencyRaceError (rolls this write back).
 */
export async function storeIdempotency(
  tx: Pick<Database, "insert">,
  call: {
    userId: string;
    tokenId: string;
    key: string;
    tool: string;
    argsHash: string;
    result: Record<string, unknown>;
  },
  now: Date = new Date()
): Promise<void> {
  const values = {
    userId: call.userId,
    tokenId: call.tokenId,
    key: call.key,
    tool: call.tool,
    argsHash: call.argsHash,
    result: call.result,
    createdAt: now,
  };
  const stored = await tx
    .insert(mcpIdempotency)
    .values(values)
    .onConflictDoUpdate({
      target: [mcpIdempotency.tokenId, mcpIdempotency.key],
      set: {
        tool: values.tool,
        argsHash: values.argsHash,
        result: values.result,
        createdAt: values.createdAt,
        userId: values.userId,
      },
      setWhere: lt(mcpIdempotency.createdAt, idempotencyCutoff(now)),
    })
    .returning({ id: mcpIdempotency.id });
  if (stored.length === 0) throw new IdempotencyRaceError();
}
