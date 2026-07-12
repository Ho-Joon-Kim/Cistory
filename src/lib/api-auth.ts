/**
 * Shared authentication and throttling helpers for public ingestion endpoints
 * (OwnTracks, Toss notifications, etc.).
 *
 * Unlike session-based routes (see src/lib/api-handler.ts), these endpoints are
 * reachable from the open internet with only an API key. They need stronger
 * protection against: key-guessing via timing, replay spam, oversized payloads.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb, users } from "@/db";
import { logger } from "@/lib/logger";

/** Maximum body size for ingestion endpoints (bytes). */
export const MAX_INGESTION_BODY_BYTES = 10 * 1024; // 10KB

/** Sliding-window rate limit quota per key+IP. */
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

type ApiKeyColumn = "ownTracksApiKey" | "tossNotificationApiKey" | "healthImportApiKey";

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

  // Compare SHA-256 digests instead of raw bytes: timingSafeEqual requires
  // equal lengths, and a bare length pre-check would leak the stored key's
  // length through response timing. Digests are constant-length by nature.
  const a = createHash("sha256").update(key, "utf8").digest();
  const b = createHash("sha256").update(result[0].storedKey, "utf8").digest();
  if (!timingSafeEqual(a, b)) return null;

  return { id: result[0].id, tossMyName: result[0].tossMyName };
}

// ── Rate limiting (in-memory, single-process) ────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Purge expired buckets when the map grows past this size. */
const BUCKET_SWEEP_THRESHOLD = 10_000;

function clientIp(request: NextRequest): string {
  // X-Forwarded-For is client-appendable: the *first* entry is whatever the
  // caller claims, so keying the rate limit on it lets an attacker rotate
  // fake IPs and mint a fresh bucket per request. The trusted reverse proxy
  // appends the real peer address *last* — use that, or x-real-ip which only
  // the proxy sets.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",");
    const last = parts[parts.length - 1].trim();
    if (last) return last;
  }
  return request.headers.get("x-real-ip") || "unknown";
}

function sweepExpiredBuckets(now: number): void {
  if (buckets.size < BUCKET_SWEEP_THRESHOLD) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Token-bucket style limiter: 60 requests / 60s per (key-prefix, IP).
 *
 * Single-process deployment assumption (production runs one standalone
 * Next.js web container — see CLAUDE.md; adding replicas multiplies the
 * effective quota). Across restarts the bucket resets, which is acceptable.
 * Expired buckets are swept once the map grows large, so a rotating-IP
 * attacker can't grow it without bound.
 */
export function enforceRateLimit(
  request: NextRequest,
  bucketKey: string
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const ip = clientIp(request);
  const key = `${bucketKey}:${ip}`;
  const now = Date.now();

  sweepExpiredBuckets(now);

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
 * Post-read enforcement of the body cap. Content-Length can be omitted or
 * understated, so `checkBodySize` alone is advisory — ingestion routes must
 * call this on the actual text after `request.text()`.
 */
export function bodyExceedsLimit(body: string): boolean {
  return Buffer.byteLength(body, "utf8") > MAX_INGESTION_BODY_BYTES;
}

/**
 * Check that the request's Origin (or Referer) matches one of the configured
 * app URLs. Returns null on pass, NextResponse(403) on reject. Use on
 * destructive same-origin-only endpoints (e.g. account deletion) to harden
 * against cross-site form/fetch attacks beyond SameSite cookies.
 */
export function checkSameOrigin(
  request: NextRequest
): { ok: true } | { ok: false; reason: string } {
  const allowed = [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_APP_URL]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => s.replace(/\/$/, ""));

  if (allowed.length === 0) {
    // Nothing configured — treat as open deployment (dev). Allow.
    return { ok: true };
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  const candidate = origin ?? (referer ? new URL(referer).origin : null);
  if (!candidate) return { ok: false, reason: "missing Origin/Referer" };

  const normalized = candidate.replace(/\/$/, "");
  if (!allowed.some((a) => normalized === a || normalized.startsWith(`${a}/`))) {
    return { ok: false, reason: `origin ${candidate} not allowed` };
  }
  return { ok: true };
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
