/**
 * MCP access tokens: issue, verify, rotate, revoke.
 *
 * Format: `cmcp_<lookupId>_<secret>` where `lookupId` is 12 lower-case hex
 * chars (row lookup, unique index) and `secret` is 64 lower-case hex chars
 * (32 CSPRNG bytes). Neither part can contain `_`, so the split is unambiguous.
 * Only SHA-256(secret) is stored; the raw token is returned once at issue/rotate
 * time and never persisted or logged. This is a hash, not encryption — so
 * `src/lib/crypto.ts` is deliberately not used.
 *
 * Verification always runs the lookup query, even for malformed input, so the
 * response time doesn't reveal whether a token shape or lookup id exists (the
 * same posture as `verifyApiKey` in src/lib/api-auth.ts). Token state is never
 * cached: revocation and scope changes apply from the next request.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { Database } from "@/db";
import { type McpScope, type McpToken, mcpTokens } from "@/db/schema";
import { ApiError } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { normalizeCountryCode } from "./countries";
import { isCatchAllCidr, normalizeCidr } from "./ip";

export const MCP_SCOPES = [
  "read",
  "sensitive-read",
  "write",
] as const satisfies readonly McpScope[];
export const TOKEN_PREFIX = "cmcp_";
const LOOKUP_ID_HEX = 12;
const SECRET_BYTES = 32;
const TOKEN_PATTERN = /^cmcp_([0-9a-f]{12})_([0-9a-f]{64})$/;
/** `last_used_at` is written at most once per this interval per token. */
export const LAST_USED_THROTTLE_MS = 60 * 1000;
const MAX_NAME_LENGTH = 60;
const MAX_LOCK_ENTRIES = 32;

// Guaranteed-no-match probe values for malformed input (valid shape, never issued:
// a real lookup id is random hex, and this one is outside the hex alphabet).
const PROBE_LOOKUP_ID = "zzzzzzzzzzzz";
const PROBE_SECRET = "0".repeat(64);
const DUMMY_HASH = createHash("sha256").update("cmcp-no-such-token", "utf8").digest("hex");

export type McpTokenValidationCode =
  | "MCP_TOKEN_NAME_INVALID"
  | "MCP_TOKEN_SCOPES_INVALID"
  | "MCP_TOKEN_CIDR_INVALID"
  | "MCP_TOKEN_COUNTRY_INVALID"
  | "MCP_TOKEN_EXPIRY_INVALID";

export class McpTokenValidationError extends ApiError {
  constructor(message: string, code: McpTokenValidationCode) {
    super(400, message, code);
    this.name = "McpTokenValidationError";
  }
}

export class McpTokenNotFoundError extends ApiError {
  constructor() {
    super(404, "토큰을 찾을 수 없습니다.", "MCP_TOKEN_NOT_FOUND");
    this.name = "McpTokenNotFoundError";
  }
}

export interface McpTokenSettingsInput {
  name: string;
  scopes: readonly string[];
  allowedCidrs?: readonly string[];
  allowedCountries?: readonly string[];
  expiresAt?: Date | null;
}

export interface McpTokenSettings {
  name: string;
  scopes: McpScope[];
  allowedCidrs: string[];
  allowedCountries: string[];
  expiresAt: Date | null;
}

/** Owner-facing token view — never contains the secret or its hash. */
export interface McpTokenSummary {
  id: string;
  name: string;
  /** `cmcp_<lookupId>_…` — enough to recognize a token, useless to replay it. */
  prefix: string;
  scopes: McpScope[];
  allowedCidrs: string[];
  allowedCountries: string[];
  /** True when the IP lock is only a catch-all (0.0.0.0/0, ::/0) — UI warning. */
  cidrLockIsCatchAll: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  status: "active" | "revoked" | "expired";
}

export interface IssuedMcpToken {
  /** The raw token. Show it once; it is not recoverable. */
  raw: string;
  token: McpTokenSummary;
}

export interface VerifiedMcpToken {
  tokenId: string;
  userId: string;
  name: string;
  scopes: McpScope[];
  cidrs: string[];
  countries: string[];
}

export type McpTokenRejectReason = "token_unrecognized" | "token_revoked" | "token_expired";

export type VerifyMcpTokenResult =
  | { ok: true; token: VerifiedMcpToken }
  | {
      ok: false;
      reason: McpTokenRejectReason;
      /** Set for revoked/expired (a recognized token) so the denial can be audited per token. */
      tokenId?: string;
      userId?: string;
    };

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateRawToken(): { raw: string; lookupId: string; secret: string } {
  const lookupId = randomBytes(LOOKUP_ID_HEX / 2).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("hex");
  return { raw: `${TOKEN_PREFIX}${lookupId}_${secret}`, lookupId, secret };
}

/** Split a raw token, or null when it isn't the exact `cmcp_` shape. */
export function parseRawToken(raw: unknown): { lookupId: string; secret: string } | null {
  if (typeof raw !== "string") return null;
  const match = TOKEN_PATTERN.exec(raw);
  return match ? { lookupId: match[1], secret: match[2] } : null;
}

/** Extract the token from an `Authorization: Bearer …` header value. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function normalizeName(input: unknown): string {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new McpTokenValidationError(
      `토큰 이름은 1~${MAX_NAME_LENGTH}자여야 합니다.`,
      "MCP_TOKEN_NAME_INVALID"
    );
  }
  return name;
}

function normalizeScopes(input: readonly string[] | undefined): McpScope[] {
  const scopes = uniq([...(input ?? [])]);
  const known = scopes.every((scope) => (MCP_SCOPES as readonly string[]).includes(scope));
  if (scopes.length === 0 || !known) {
    throw new McpTokenValidationError(
      "스코프는 read, sensitive-read, write 중 하나 이상이어야 합니다.",
      "MCP_TOKEN_SCOPES_INVALID"
    );
  }
  // Deterministic order regardless of input order.
  return MCP_SCOPES.filter((scope) => scopes.includes(scope));
}

/** Normalize every entry with `normalize`, or throw `error` on the first bad one. */
function normalizeList(
  entries: readonly string[] | undefined,
  normalize: (entry: string) => string | null,
  error: () => McpTokenValidationError
): string[] {
  const list = entries ?? [];
  if (list.length > MAX_LOCK_ENTRIES) throw error();
  return uniq(
    list.map((entry) => {
      const normalized = typeof entry === "string" ? normalize(entry) : null;
      if (!normalized) throw error();
      return normalized;
    })
  );
}

function normalizeExpiry(expiresAt: Date | null | undefined, now: Date): Date | null {
  if (expiresAt === null || expiresAt === undefined) return null;
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new McpTokenValidationError("만료 시각이 올바르지 않습니다.", "MCP_TOKEN_EXPIRY_INVALID");
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new McpTokenValidationError(
      "만료 시각은 현재 이후여야 합니다.",
      "MCP_TOKEN_EXPIRY_INVALID"
    );
  }
  return expiresAt;
}

/**
 * Validate + normalize issue/rotate settings. Throws McpTokenValidationError.
 * Catch-all CIDRs (0.0.0.0/0, ::/0) are stored as given; the settings UI
 * warns that they are not a real lock (see `toTokenSummary`).
 */
export function normalizeTokenSettings(
  input: McpTokenSettingsInput,
  now: Date = new Date()
): McpTokenSettings {
  return {
    name: normalizeName(input.name),
    scopes: normalizeScopes(input.scopes),
    allowedCidrs: normalizeList(
      input.allowedCidrs,
      normalizeCidr,
      () =>
        new McpTokenValidationError(
          `IP 범위는 ${MAX_LOCK_ENTRIES}개까지, 예: 203.0.113.0/24, 2001:db8::/48 형식이어야 합니다.`,
          "MCP_TOKEN_CIDR_INVALID"
        )
    ),
    allowedCountries: normalizeList(
      input.allowedCountries,
      normalizeCountryCode,
      () =>
        new McpTokenValidationError(
          `국가 코드는 ${MAX_LOCK_ENTRIES}개까지, ISO 3166-1 두 글자 코드여야 합니다. 예: KR`,
          "MCP_TOKEN_COUNTRY_INVALID"
        )
    ),
    expiresAt: normalizeExpiry(input.expiresAt, now),
  };
}

function tokenStatus(row: McpToken, now: Date): McpTokenSummary["status"] {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function toTokenSummary(row: McpToken, now: Date = new Date()): McpTokenSummary {
  return {
    id: row.id,
    name: row.name,
    prefix: `${TOKEN_PREFIX}${row.lookupId}_…`,
    scopes: row.scopes,
    allowedCidrs: row.allowedCidrs,
    allowedCountries: row.allowedCountries,
    cidrLockIsCatchAll:
      row.allowedCidrs.length > 0 && row.allowedCidrs.every((cidr) => isCatchAllCidr(cidr)),
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    status: tokenStatus(row, now),
  };
}

type Executor = Pick<Database, "insert" | "select" | "update">;

async function insertToken(
  db: Executor,
  userId: string,
  settings: McpTokenSettings,
  now: Date
): Promise<IssuedMcpToken> {
  const { raw, lookupId, secret } = generateRawToken();
  const [row] = await db
    .insert(mcpTokens)
    .values({
      userId,
      name: settings.name,
      lookupId,
      secretHash: hashSecret(secret),
      scopes: settings.scopes,
      allowedCidrs: settings.allowedCidrs,
      allowedCountries: settings.allowedCountries,
      expiresAt: settings.expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return { raw, token: toTokenSummary(row, now) };
}

export async function issueToken(
  db: Database,
  userId: string,
  input: McpTokenSettingsInput,
  now: Date = new Date()
): Promise<IssuedMcpToken> {
  const settings = normalizeTokenSettings(input, now);
  return insertToken(db, userId, settings, now);
}

/**
 * Replace an active token with a fresh secret carrying the same settings, and
 * revoke the old one in the same transaction. The old token stops working at
 * commit; the new raw token is returned once.
 */
export async function rotateToken(
  db: Database,
  userId: string,
  tokenId: string,
  now: Date = new Date()
): Promise<IssuedMcpToken> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(mcpTokens)
      .where(
        and(eq(mcpTokens.id, tokenId), eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt))
      )
      .for("update");
    if (!current) throw new McpTokenNotFoundError();

    // An expired token is dead; rotating it would mint a token that's already expired.
    if (current.expiresAt && current.expiresAt.getTime() <= now.getTime()) {
      throw new McpTokenNotFoundError();
    }

    const issued = await insertToken(
      tx,
      userId,
      {
        name: current.name,
        scopes: current.scopes,
        allowedCidrs: current.allowedCidrs,
        allowedCountries: current.allowedCountries,
        expiresAt: current.expiresAt,
      },
      now
    );
    await tx
      .update(mcpTokens)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(mcpTokens.id, current.id));
    return issued;
  });
}

/** Revoke a token. Returns false when it doesn't exist (or isn't this user's). Idempotent. */
export async function revokeToken(
  db: Database,
  userId: string,
  tokenId: string,
  now: Date = new Date()
): Promise<boolean> {
  const [row] = await db
    .select({ id: mcpTokens.id, revokedAt: mcpTokens.revokedAt })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.id, tokenId), eq(mcpTokens.userId, userId)));
  if (!row) return false;
  if (row.revokedAt) return true;
  await db
    .update(mcpTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(mcpTokens.id, tokenId), isNull(mcpTokens.revokedAt)));
  return true;
}

export async function listTokens(
  db: Database,
  userId: string,
  now: Date = new Date()
): Promise<McpTokenSummary[]> {
  const rows = await db
    .select()
    .from(mcpTokens)
    .where(eq(mcpTokens.userId, userId))
    .orderBy(desc(mcpTokens.createdAt), desc(mcpTokens.id));
  return rows.map((row) => toTokenSummary(row, now));
}

/**
 * Verify a raw bearer token. Malformed, unknown and wrong-secret tokens all
 * return the same `token_unrecognized`; revoked and expired tokens are
 * distinguished (with their ids) for the audit log only — callers must answer
 * every rejection with the same 401.
 */
export async function verifyToken(
  db: Database,
  raw: string | null | undefined,
  now: Date = new Date()
): Promise<VerifyMcpTokenResult> {
  const parsed = parseRawToken(raw);
  const lookupId = parsed?.lookupId ?? PROBE_LOOKUP_ID;
  const secret = parsed?.secret ?? PROBE_SECRET;

  // Always query (see header) — no early return on malformed input.
  const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.lookupId, lookupId)).limit(1);

  // Always compare too, against a dummy hash when there is no row.
  const expected = Buffer.from(row?.secretHash ?? DUMMY_HASH, "hex");
  const actual = Buffer.from(hashSecret(secret), "hex");
  const secretMatches = timingSafeEqual(expected, actual);

  if (!parsed || !row || !secretMatches) return { ok: false, reason: "token_unrecognized" };
  if (row.revokedAt) {
    return { ok: false, reason: "token_revoked", tokenId: row.id, userId: row.userId };
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "token_expired", tokenId: row.id, userId: row.userId };
  }

  await touchLastUsed(db, row, now);

  return {
    ok: true,
    token: {
      tokenId: row.id,
      userId: row.userId,
      name: row.name,
      scopes: row.scopes,
      cidrs: row.allowedCidrs,
      countries: row.allowedCountries,
    },
  };
}

/**
 * Record use at most once per LAST_USED_THROTTLE_MS. The condition lives in the
 * UPDATE's WHERE so concurrent requests can't both write. A failure here is a
 * bookkeeping miss, not an auth failure — logged, never thrown.
 */
async function touchLastUsed(db: Database, row: McpToken, now: Date): Promise<void> {
  if (row.lastUsedAt && now.getTime() - row.lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) return;
  const threshold = new Date(now.getTime() - LAST_USED_THROTTLE_MS);
  try {
    await db
      .update(mcpTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(mcpTokens.id, row.id),
          or(isNull(mcpTokens.lastUsedAt), lt(mcpTokens.lastUsedAt, threshold))
        )
      );
  } catch (error) {
    logger.warn("[MCP] last_used_at update failed", {
      tokenId: row.id,
      code: (error as { code?: string } | null)?.code ?? null,
    });
  }
}

/** True when `scopes` grants `required`. Each scope stands alone (no implication). */
export function hasScope(scopes: readonly McpScope[], required: McpScope): boolean {
  return scopes.includes(required);
}
