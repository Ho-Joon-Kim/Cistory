import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Signed, stateless OAuth `state` for the Withings authorize/callback flow.
 *
 * The state binds the initiating session's userId + a nonce + an expiry, signed
 * with HMAC-SHA256. Being stateless (no server-side store) it survives multiple
 * web replicas. The signing key is derived from KIS_ENCRYPTION_KEY with a fixed
 * purpose context so a key leak does not let an attacker BOTH decrypt stored
 * tokens AND forge state — the AES-GCM path uses a different per-secret salt.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const STATE_CONTEXT = "withings-oauth-state";

let cachedKey: Buffer | null = null;

function signingKey(): Buffer {
  if (cachedKey) return cachedKey;
  const master = process.env.KIS_ENCRYPTION_KEY;
  if (!master || master.length < 32) {
    throw new Error("KIS_ENCRYPTION_KEY must be set (>=32 chars) to sign OAuth state");
  }
  cachedKey = scryptSync(master, STATE_CONTEXT, 32);
  return cachedKey;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/** Create a signed state token for the given user. `ttlMs` override is for tests. */
export function createOAuthState(userId: string, ttlMs: number = STATE_TTL_MS): string {
  const nonce = randomBytes(9).toString("base64url");
  const exp = Date.now() + ttlMs;
  const payload = `${userId}.${nonce}.${exp}`;
  const payloadB64 = Buffer.from(payload).toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verify signature + expiry. Returns the bound userId, or null if invalid/expired. */
export function verifyOAuthState(state: string | null): { userId: string } | null {
  if (!state) return null;
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [userId, _nonce, expStr] = payload.split(".");
  const exp = Number(expStr);
  if (!userId || !Number.isFinite(exp) || Date.now() > exp) return null;
  return { userId };
}
