/**
 * MCP request gate: everything that can reject a request after token
 * verification and before any tool runs — client location from Cloudflare
 * headers, the token's IP/country lock, rate limiting, and the Origin check.
 *
 * Client IP and country come ONLY from `CF-Connecting-IP` / `CF-IPCountry`.
 * The request path is Cloudflare Tunnel, so `clientIp()` in api-auth.ts (the
 * X-Forwarded-For tail) can be the cloudflared address. That trust rests on the
 * web container's port not being reachable except through the Tunnel — an
 * operational check, not something this module can verify.
 *
 * The lock decision is a pure function returning a reason code; callers do
 * the auditing and alerting.
 */

import type { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api-auth";
import { normalizeCountryCode } from "./countries";
import { ipInAnyCidr, normalizeIp } from "./ip";

export type McpLockDenyReason =
  | "ip_unknown"
  | "ip_not_allowed"
  | "country_unknown"
  | "country_not_allowed";

export interface ClientLocation {
  /** Canonical IP text (IPv4-mapped IPv6 folded to IPv4), or null when unknown. */
  ip: string | null;
  /** ISO alpha-2, or null when absent / `XX` / `T1` / unrecognized. */
  country: string | null;
}

export interface McpTokenLock {
  cidrs: readonly string[];
  countries: readonly string[];
}

export type LockDecision = { allowed: true } | { allowed: false; reason: McpLockDenyReason };

/** Cloudflare's "can't tell" country values; `T1` is Tor. */
const UNKNOWN_COUNTRY_VALUES = new Set(["", "XX", "T1"]);

export function readClientLocation(headers: Headers): ClientLocation {
  const rawIp = headers.get("cf-connecting-ip");
  const ip = rawIp ? normalizeIp(rawIp) : null;

  const rawCountry = (headers.get("cf-ipcountry") ?? "").trim().toUpperCase();
  const country = UNKNOWN_COUNTRY_VALUES.has(rawCountry) ? null : normalizeCountryCode(rawCountry);

  return { ip, country };
}

/**
 * No lock → allow. CIDR lock → the IP must be known and inside a range.
 * Country lock → the country must be known and listed. Both → both must hold
 * (the IP is checked first, so its reason wins when both fail).
 */
export function evaluateLock(lock: McpTokenLock, location: ClientLocation): LockDecision {
  if (lock.cidrs.length > 0) {
    if (!location.ip) return { allowed: false, reason: "ip_unknown" };
    if (!ipInAnyCidr(location.ip, lock.cidrs)) return { allowed: false, reason: "ip_not_allowed" };
  }
  if (lock.countries.length > 0) {
    if (!location.country) return { allowed: false, reason: "country_unknown" };
    if (!lock.countries.includes(location.country)) {
      return { allowed: false, reason: "country_not_allowed" };
    }
  }
  return { allowed: true };
}

// ── Rate limiting ────────────────────────────────────────────────────────────

/** Authenticated calls that passed the lock: one bucket per token. */
export const MCP_TOKEN_BUCKET = "mcp-token";
/**
 * Rejected/unrecognized tokens and lock-denied requests: one bucket per
 * CF-Connecting-IP, so a flood from outside a token's lock never drains it.
 */
export const MCP_UNAUTH_BUCKET = "mcp-unauth";
export const MCP_RATE_LIMIT_MAX = 60;

export type McpRateLimitResult = { allowed: true } | { allowed: false; retryAfterSec: number };

function toResult(result: ReturnType<typeof enforceRateLimit>): McpRateLimitResult {
  if (result.allowed) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(result.retryAfterMs / 1000)) };
}

export function limitTokenRequest(request: NextRequest, tokenId: string): McpRateLimitResult {
  return toResult(enforceRateLimit(request, MCP_TOKEN_BUCKET, MCP_RATE_LIMIT_MAX, tokenId));
}

export function limitUnauthenticatedRequest(
  request: NextRequest,
  location: ClientLocation
): McpRateLimitResult {
  return toResult(
    enforceRateLimit(request, MCP_UNAUTH_BUCKET, MCP_RATE_LIMIT_MAX, location.ip ?? "unknown")
  );
}

/** 429 with Retry-After, the shape every rate-limited MCP answer uses. */
export function rateLimitedResponse(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSec),
      "Cache-Control": "private, no-store",
    },
  });
}

// ── Origin ───────────────────────────────────────────────────────────────────

/** The app's own origins (BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL). */
export function appOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.BETTER_AUTH_URL, env.NEXT_PUBLIC_APP_URL]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });
}

/**
 * DNS-rebinding guard from the MCP transport spec: a request carrying an
 * Origin header must come from an allowed origin. Agents are non-browser
 * clients and send no Origin, so a missing header passes. (U5 may swap this
 * for the SDK's `originValidationResponse`; the rule is the same.)
 */
export function isAllowedOrigin(
  originHeader: string | null,
  allowed: readonly string[] = appOrigins()
): boolean {
  if (originHeader === null) return true;
  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return false;
  }
  return allowed.includes(origin);
}
