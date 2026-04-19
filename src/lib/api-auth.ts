/**
 * Shared authentication and throttling helpers for public ingestion endpoints
 * (OwnTracks, Toss notifications, etc.).
 *
 * Unlike session-based routes (see src/lib/api-handler.ts), these endpoints are
 * reachable from the open internet with only an API key. They need stronger
 * protection against: key-guessing via timing, replay spam, oversized payloads.
 */

import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb, users } from "@/db";
import { logger } from "@/lib/logger";

/** Maximum body size for ingestion endpoints (bytes). */
export const MAX_INGESTION_BODY_BYTES = 10 * 1024; // 10KB

/** Sliding-window rate limit quota per key+IP. */
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

type ApiKeyColumn = "ownTracksApiKey" | "tossNotificationApiKey";

interface AuthedUser {
  id: string;
  tossMyName: string | null;
}

/**
 * Look up a user by their API key with timing equalization.
 *
 * Returns `null` if the key is missing or no user matches. The DB query always
 * runs (even for an empty key) so attackers cannot distinguish present-vs-absent
 * keys by response time. The match itself uses `timingSafeEqual` after the
 * query so the comparison cost is constant.
 */
export async function verifyApiKey(
  apikey: string | null,
  column: ApiKeyColumn
): Promise<AuthedUser | null> {
  const key = typeof apikey === "string" ? apikey : "";
  const db = getDb();

  // Always query — returning early on empty key would leak "no such key" vs
  // "valid key" via timing. Use a guaranteed-no-match value when empty.
  const probe = key || "__empty__";

  const result = await db
    .select({
      id: users.id,
      storedKey: users[column],
      tossMyName: users.tossMyName,
    })
    .from(users)
    .where(eq(users[column], probe))
    .limit(1);

  if (result.length === 0 || !result[0].storedKey) return null;

  const a = Buffer.from(key, "utf8");
  const b = Buffer.from(result[0].storedKey, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { id: result[0].id, tossMyName: result[0].tossMyName };
}

// ── Rate limiting (in-memory, single-process) ────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Token-bucket style limiter: 60 requests / 60s per (key-prefix, IP).
 *
 * Single-process deployment assumption (production runs one standalone
 * Next.js server). Across restarts the bucket resets, which is acceptable.
 */
export function enforceRateLimit(
  request: NextRequest,
  bucketKey: string
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const ip = clientIp(request);
  const key = `${bucketKey}:${ip}`;
  const now = Date.now();

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true };
}

/**
 * Check Content-Length against MAX_INGESTION_BODY_BYTES.
 * Returns the advertised size, or -1 when absent (caller should still enforce
 * the cap after reading since Content-Length can be omitted or lied about).
 */
export function checkBodySize(request: NextRequest): {
  ok: boolean;
  size: number;
  max: number;
} {
  const raw = request.headers.get("content-length");
  const size = raw ? Number.parseInt(raw, 10) : -1;
  const ok = !Number.isFinite(size) || size < 0 || size <= MAX_INGESTION_BODY_BYTES;
  return { ok, size, max: MAX_INGESTION_BODY_BYTES };
}

/**
 * Log a throttling or auth failure in a structured way without leaking the key.
 */
export function logIngestionFailure(
  endpoint: string,
  reason: "rate_limited" | "body_too_large" | "auth_failed",
  request: NextRequest
) {
  logger.warn(`[ingestion] ${endpoint} rejected`, {
    endpoint,
    reason,
    ip: clientIp(request),
    ua: request.headers.get("user-agent") ?? null,
  });
}
