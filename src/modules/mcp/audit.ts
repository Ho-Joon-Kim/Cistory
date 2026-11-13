/**
 * MCP audit log (fail-closed).
 *
 *  - Reads are recorded BEFORE the tool runs; if that insert fails, the call
 *    fails and no data is read. The result count is filled in afterwards on a
 *    best-effort basis (the call itself is already on record).
 *  - Writes are recorded inside the caller's transaction, after the change and
 *    before commit, with allowlisted before/after fields — so a failed audit
 *    insert rolls the write back.
 *  - Denials by a recognized token get one row each. Denials of unrecognized
 *    tokens are aggregated into one row per (IP, reason, 15-minute window) whose
 *    `hit_count` increments, so a guessing flood can't grow the table per request.
 *  - A denial whose audit write fails is replaced by one structured log line
 *    (never containing the token).
 *
 * Arguments are stored as a normalized summary (dates, ids, counts kept; free
 * text as {len, sha256 prefix}; coordinates dropped), never raw, and returned
 * data is never stored. DB errors are rethrown as a generic `McpAuditError`
 * because Drizzle errors embed the query parameters.
 *
 * Every timestamp is a JS Date written through the query builder (UTC wall
 * time) — never `now()` in SQL, which would land as KST wall time.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { mcpAuditLog, users } from "@/db/schema";
import { logger } from "@/lib/logger";

export const AUDIT_UNAUTH_WINDOW_MS = 15 * 60 * 1000;
/** Upper bound on a stored args summary (serialized JSON, bytes). */
export const ARGS_SUMMARY_MAX_BYTES = 2048;
const MAX_DEPTH = 3;
const MAX_ARRAY_ITEMS = 20;
const MAX_KEPT_STRING = 80;

export type McpAuditOutcome = "ok" | "error" | "denied";

export type McpDenyReason =
  | "token_unrecognized"
  | "token_revoked"
  | "token_expired"
  | "ip_unknown"
  | "ip_not_allowed"
  | "country_unknown"
  | "country_not_allowed"
  | "scope_denied"
  | "revoked_midflight"
  | "origin_not_allowed";

export class McpAuditError extends Error {
  constructor() {
    super("감사 기록에 실패했습니다.");
    this.name = "McpAuditError";
  }
}

/** Who/where of one MCP request, shared by every audit write it makes. */
export interface McpAuditContext {
  userId: string;
  tokenId: string;
  ip: string | null;
  country: string | null;
}

// ── Argument summarizer ──────────────────────────────────────────────────────

/**
 * Per-field rule. `keep` stores the value (primitives; strings capped),
 * `text` stores {len, sha256} only, `drop` omits the field, `count` stores
 * just an array's length. Unlisted fields follow the default rules below.
 */
export type ArgRule = "keep" | "text" | "drop" | "count";
export type ArgRules = Record<string, ArgRule>;

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COORDINATE_KEY = /^(lat|lon|lng|latitude|longitude|coords?|coordinates?)$/i;

export function textDigest(value: string): { len: number; sha256: string } {
  return {
    len: value.length,
    sha256: createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8),
  };
}

function summarizeString(value: string): unknown {
  // Only dates and UUIDs are kept by default. Any other string may be free
  // text (a one-word search term looks exactly like an enum), so it becomes a
  // digest unless the tool declares the field `keep` (categories, sources, …).
  if (value.length <= MAX_KEPT_STRING && (DATE_LIKE.test(value) || UUID_LIKE.test(value))) {
    return value;
  }
  return textDigest(value);
}

function summarizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return summarizeString(value);
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return { count: value.length };
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarizeValue(item, depth + 1));
    return value.length > MAX_ARRAY_ITEMS ? { count: value.length, items } : items;
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return { keys: Object.keys(value).length };
    return summarizeObject(value as Record<string, unknown>, {}, depth + 1);
  }
  return null;
}

function applyRule(rule: ArgRule, value: unknown, depth: number): unknown {
  switch (rule) {
    case "drop":
      return undefined;
    case "count":
      return Array.isArray(value) ? { count: value.length } : null;
    case "text":
      return typeof value === "string" ? textDigest(value) : summarizeValue(value, depth);
    case "keep":
      if (typeof value === "string") {
        return value.length > MAX_KEPT_STRING ? textDigest(value) : value;
      }
      return summarizeValue(value, depth);
  }
}

function summarizeObject(
  args: Record<string, unknown>,
  rules: ArgRules,
  depth: number
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const rule = rules[key] ?? (COORDINATE_KEY.test(key) ? "drop" : undefined);
    const summarized = rule ? applyRule(rule, value, depth) : summarizeValue(value, depth);
    if (summarized !== undefined) out[key] = summarized;
  }
  return out;
}

/**
 * Normalize tool arguments for the audit log. Never throws; anything that
 * isn't a plain object summarizes to `{}`. The result is capped at
 * ARGS_SUMMARY_MAX_BYTES — beyond that only the key names survive.
 */
export function summarizeArgs(args: unknown, rules: ArgRules = {}): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const summary = summarizeObject(args as Record<string, unknown>, rules, 0);
  const bytes = Buffer.byteLength(JSON.stringify(summary), "utf8");
  if (bytes <= ARGS_SUMMARY_MAX_BYTES) return summary;
  const keys: string[] = [];
  let used = 64;
  for (const key of Object.keys(summary)) {
    used += Buffer.byteLength(key, "utf8") + 3;
    if (used > ARGS_SUMMARY_MAX_BYTES) break;
    keys.push(key.slice(0, 64));
  }
  return { truncated: true, bytes, keys };
}

/** Keep only allowlisted fields of a before/after write snapshot. */
export function pickFields(
  row: Record<string, unknown> | null | undefined,
  fields: readonly string[]
): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in row)) continue;
    const value = row[field];
    out[field] = value instanceof Date ? value.toISOString() : (value ?? null);
  }
  return out;
}

// ── Writers ──────────────────────────────────────────────────────────────────

type Inserter = Pick<Database, "insert">;

/** The Postgres SQLSTATE of a (possibly Drizzle-wrapped) error — safe to log. */
function pgCode(error: unknown): string | null {
  const err = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const value = typeof err?.code === "string" ? err.code : err?.cause?.code;
  return typeof value === "string" ? value : null;
}

/**
 * Record a read call before it runs. Returns the row id for the later count
 * update. Throws McpAuditError (generic, parameter-free) on any DB failure.
 */
export async function recordReadCall(
  db: Inserter,
  ctx: McpAuditContext,
  call: { tool: string; argsSummary: Record<string, unknown>; at?: Date }
): Promise<string> {
  try {
    const [row] = await db
      .insert(mcpAuditLog)
      .values({
        userId: ctx.userId,
        tokenId: ctx.tokenId,
        at: call.at ?? new Date(),
        tool: call.tool,
        outcome: "ok",
        argsSummary: call.argsSummary,
        ip: ctx.ip,
        country: ctx.country,
      })
      .returning({ id: mcpAuditLog.id });
    return row.id;
  } catch (error) {
    logger.error("[MCP] audit insert failed", { tool: call.tool, code: pgCode(error) });
    throw new McpAuditError();
  }
}

/** Fill in the result count (or mark an error) after a read. Never throws. */
export async function completeReadCall(
  db: Pick<Database, "update">,
  auditId: string,
  result: { resultCount?: number | null; errorCode?: string | null }
): Promise<void> {
  try {
    await db
      .update(mcpAuditLog)
      .set({
        resultCount: result.resultCount ?? null,
        ...(result.errorCode ? { outcome: "error" as const, errorCode: result.errorCode } : {}),
      })
      .where(eq(mcpAuditLog.id, auditId));
  } catch (error) {
    logger.warn("[MCP] audit result update failed", { auditId, code: pgCode(error) });
  }
}

/**
 * The read wrapper's audit sequence: record → run → count. If the record
 * fails, `run` never executes and McpAuditError propagates. If `run` throws,
 * the row is marked `error` (best effort) and the error is rethrown.
 */
export async function auditedRead<T>(
  db: Pick<Database, "insert" | "update">,
  ctx: McpAuditContext,
  call: { tool: string; argsSummary: Record<string, unknown> },
  run: () => Promise<T>,
  countOf: (result: T) => number | null = () => null
): Promise<T> {
  const auditId = await recordReadCall(db, ctx, call);
  let result: T;
  try {
    result = await run();
  } catch (error) {
    // Only our own string codes (ApiError / tool errors) — never a message.
    const code = (error as { code?: unknown } | null)?.code;
    const errorCode = typeof code === "string" ? code.slice(0, 64) : "tool_error";
    await completeReadCall(db, auditId, { errorCode });
    throw error;
  }
  let resultCount: number | null = null;
  try {
    resultCount = countOf(result);
  } catch {
    resultCount = null;
  }
  await completeReadCall(db, auditId, { resultCount });
  return result;
}

/**
 * Record a write inside the caller's transaction (pass `tx`). Only the
 * allowlisted fields of `before`/`after` are stored. Throws McpAuditError on
 * failure so the surrounding transaction rolls back.
 */
export async function recordWriteAudit(
  tx: Inserter,
  ctx: McpAuditContext,
  write: {
    tool: string;
    argsSummary: Record<string, unknown>;
    fields: readonly string[];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    resultCount?: number | null;
    at?: Date;
  }
): Promise<void> {
  try {
    await tx.insert(mcpAuditLog).values({
      userId: ctx.userId,
      tokenId: ctx.tokenId,
      at: write.at ?? new Date(),
      tool: write.tool,
      outcome: "ok",
      argsSummary: write.argsSummary,
      resultCount: write.resultCount ?? null,
      ip: ctx.ip,
      country: ctx.country,
      writeBefore: pickFields(write.before, write.fields),
      writeAfter: pickFields(write.after, write.fields),
    });
  } catch (error) {
    logger.error("[MCP] write audit insert failed", { tool: write.tool, code: pgCode(error) });
    throw new McpAuditError();
  }
}

/**
 * A write tool call that failed (its transaction rolled back, so the
 * in-transaction write audit never landed). Records one `error` row with the
 * summarized args and a code — never the error message. Runs in its own
 * statement and never throws: on failure it logs one structured line instead.
 * Returns whether the row was written.
 */
export async function recordWriteFailure(
  db: Inserter,
  ctx: McpAuditContext,
  failure: {
    tool: string;
    argsSummary: Record<string, unknown>;
    errorCode: string;
    at?: Date;
  }
): Promise<boolean> {
  const errorCode = failure.errorCode.slice(0, 64);
  try {
    await db.insert(mcpAuditLog).values({
      userId: ctx.userId,
      tokenId: ctx.tokenId,
      at: failure.at ?? new Date(),
      tool: failure.tool,
      outcome: "error",
      errorCode,
      argsSummary: failure.argsSummary,
      ip: ctx.ip,
      country: ctx.country,
    });
    return true;
  } catch (error) {
    logger.warn("[MCP] write failed (audit write failed)", {
      tool: failure.tool,
      tokenId: ctx.tokenId,
      errorCode,
      ip: ctx.ip,
      country: ctx.country,
      code: pgCode(error),
    });
    return false;
  }
}

/**
 * Per-request denial by a recognized token (lock, scope, revoked/expired,
 * revoked mid-flight). Never throws: on failure it logs one structured line
 * instead. Returns whether the row was written.
 */
export async function recordDenial(
  db: Inserter,
  denial: {
    userId: string;
    tokenId: string | null;
    reason: McpDenyReason;
    ip: string | null;
    country: string | null;
    tool?: string | null;
    argsSummary?: Record<string, unknown> | null;
    at?: Date;
  }
): Promise<boolean> {
  try {
    await db.insert(mcpAuditLog).values({
      userId: denial.userId,
      tokenId: denial.tokenId,
      at: denial.at ?? new Date(),
      tool: denial.tool ?? null,
      outcome: "denied",
      denyReason: denial.reason,
      argsSummary: denial.argsSummary ?? null,
      ip: denial.ip,
      country: denial.country,
    });
    return true;
  } catch (error) {
    logger.warn("[MCP] denied (audit write failed)", {
      reason: denial.reason,
      tokenId: denial.tokenId,
      tool: denial.tool ?? null,
      ip: denial.ip,
      country: denial.country,
      code: pgCode(error),
    });
    return false;
  }
}

export function auditWindowStart(at: Date, windowMs: number = AUDIT_UNAUTH_WINDOW_MS): Date {
  return new Date(Math.floor(at.getTime() / windowMs) * windowMs);
}

/**
 * The single owner when the app has exactly one user (always, today), else
 * null — unrecognized-token denials can't be attributed any other way.
 */
export async function resolveSoleOwner(db: Pick<Database, "select">): Promise<string | null> {
  const rows = await db.select({ id: users.id }).from(users).limit(2);
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * Aggregate an unrecognized-token denial into its (IP, reason, 15-minute
 * window) row: insert with hit_count 1, or increment and bump `at` to the
 * latest hit. Never throws (falls back to a log line).
 */
export async function recordUnauthenticatedDenial(
  db: Pick<Database, "insert" | "select">,
  denial: {
    reason: McpDenyReason;
    ip: string | null;
    country: string | null;
    at?: Date;
    /** Override the owner lookup (tests, or a caller that already resolved it). */
    ownerId?: string | null;
  }
): Promise<boolean> {
  const at = denial.at ?? new Date();
  const ip = denial.ip ?? "unknown";
  try {
    const userId = denial.ownerId !== undefined ? denial.ownerId : await resolveSoleOwner(db);
    await db
      .insert(mcpAuditLog)
      .values({
        userId,
        tokenId: null,
        at,
        outcome: "denied",
        denyReason: denial.reason,
        ip,
        country: denial.country,
        hitCount: 1,
        windowStart: auditWindowStart(at),
      })
      .onConflictDoUpdate({
        target: [mcpAuditLog.ip, mcpAuditLog.denyReason, mcpAuditLog.windowStart],
        targetWhere: sql`${mcpAuditLog.windowStart} IS NOT NULL`,
        set: {
          hitCount: sql`${mcpAuditLog.hitCount} + 1`,
          at,
          country: denial.country,
        },
      });
    return true;
  } catch (error) {
    logger.warn("[MCP] unauthenticated request denied (audit write failed)", {
      reason: denial.reason,
      ip,
      country: denial.country,
      code: pgCode(error),
    });
    return false;
  }
}

// ── Query / delete (settings UI) ─────────────────────────────────────────────

export interface AuditLogFilters {
  tokenId?: string;
  tool?: string;
  outcome?: McpAuditOutcome;
  /** Inclusive lower bound on `at` (an instant). */
  from?: Date;
  /** Exclusive upper bound on `at` (an instant). */
  to?: Date;
  cursor?: string | null;
  limit?: number;
}

export interface AuditLogEntry {
  id: string;
  at: Date;
  tokenId: string | null;
  tool: string | null;
  outcome: McpAuditOutcome;
  denyReason: string | null;
  errorCode: string | null;
  argsSummary: unknown;
  resultCount: number | null;
  ip: string | null;
  country: string | null;
  writeBefore: unknown;
  writeAfter: unknown;
  hitCount: number;
  windowStart: Date | null;
}

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;

export class McpAuditCursorError extends Error {
  constructor() {
    super("잘못된 커서입니다.");
    this.name = "McpAuditCursorError";
  }
}

export function encodeAuditCursor(entry: { at: Date; id: string }): string {
  return Buffer.from(`${entry.at.toISOString()}|${entry.id}`, "utf8").toString("base64url");
}

export function decodeAuditCursor(cursor: string): { at: Date; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const [iso, id] = decoded.split("|");
  const at = new Date(iso ?? "");
  if (!id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new McpAuditCursorError();
  }
  return { at, id };
}

/** The owner sees their own rows plus unattributed (user_id NULL) denials. */
function ownedBy(userId: string): SQL {
  return or(eq(mcpAuditLog.userId, userId), isNull(mcpAuditLog.userId)) as SQL;
}

function filterConditions(userId: string, filters: AuditLogFilters): SQL[] {
  const conditions: SQL[] = [ownedBy(userId)];
  if (filters.tokenId) conditions.push(eq(mcpAuditLog.tokenId, filters.tokenId));
  if (filters.tool) conditions.push(eq(mcpAuditLog.tool, filters.tool));
  if (filters.outcome) conditions.push(eq(mcpAuditLog.outcome, filters.outcome));
  if (filters.from) conditions.push(gte(mcpAuditLog.at, filters.from));
  if (filters.to) conditions.push(lt(mcpAuditLog.at, filters.to));
  return conditions;
}

/** Newest first, keyset-paginated on (at, id). */
export async function listAuditLog(
  db: Pick<Database, "select">,
  userId: string,
  filters: AuditLogFilters = {}
): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> {
  const limit = Math.min(
    Math.max(1, Math.floor(filters.limit ?? AUDIT_PAGE_DEFAULT)),
    AUDIT_PAGE_MAX
  );
  const conditions = filterConditions(userId, filters);
  if (filters.cursor) {
    const cursor = decodeAuditCursor(filters.cursor);
    conditions.push(
      or(
        lt(mcpAuditLog.at, cursor.at),
        and(eq(mcpAuditLog.at, cursor.at), lt(mcpAuditLog.id, cursor.id))
      ) as SQL
    );
  }
  const rows = await db
    .select()
    .from(mcpAuditLog)
    .where(and(...conditions))
    .orderBy(desc(mcpAuditLog.at), desc(mcpAuditLog.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const items: AuditLogEntry[] = page.map((row) => ({
    id: row.id,
    at: row.at,
    tokenId: row.tokenId,
    tool: row.tool,
    outcome: row.outcome,
    denyReason: row.denyReason,
    errorCode: row.errorCode,
    argsSummary: row.argsSummary,
    resultCount: row.resultCount,
    ip: row.ip,
    country: row.country,
    writeBefore: row.writeBefore,
    writeAfter: row.writeAfter,
    hitCount: row.hitCount,
    windowStart: row.windowStart,
  }));
  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeAuditCursor(last) : null };
}

export class McpAuditDeleteScopeError extends Error {
  constructor() {
    super("삭제할 기간이나 토큰을 지정하세요.");
    this.name = "McpAuditDeleteScopeError";
  }
}

/**
 * Delete audit rows by range and/or token (R33). At least one of
 * from/to/tokenId is required, so an empty filter can't wipe the log.
 * Returns the number of rows deleted.
 */
export async function deleteAuditLog(
  db: Pick<Database, "delete">,
  userId: string,
  filters: Pick<AuditLogFilters, "from" | "to" | "tokenId">
): Promise<number> {
  if (!filters.from && !filters.to && !filters.tokenId) throw new McpAuditDeleteScopeError();
  const deleted = await db
    .delete(mcpAuditLog)
    .where(and(...filterConditions(userId, filters)))
    .returning({ id: mcpAuditLog.id });
  return deleted.length;
}
