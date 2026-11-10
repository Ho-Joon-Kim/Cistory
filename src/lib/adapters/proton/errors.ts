import { ConnectionError, RateLimitedError, ServerError } from "@protontech/drive-sdk";

function statusOf(e: unknown): number | undefined {
  return e instanceof ServerError ? e.statusCode : undefined;
}

/** The SDK gave up because Proton throttled us; slow down, do not flag the connection. */
export function isRateLimited(e: unknown): boolean {
  return e instanceof RateLimitedError;
}

/** The session was rejected (expired or revoked tokens). */
export function isAuthFailure(e: unknown): boolean {
  const status = statusOf(e);
  return status === 401 || status === 403;
}

/** The stored event cursor is unknown or no longer valid; a fresh baseline is needed. */
export function isCursorRejection(e: unknown): boolean {
  const status = statusOf(e);
  return status === 404 || status === 422;
}

/**
 * Proton (or the network to it) is failing as a whole, not one file: offline,
 * or a 5xx after the SDK's own retries. Work should stop for this tick
 * without charging any per-item attempt.
 */
export function isTransientOutage(e: unknown): boolean {
  if (e instanceof ConnectionError) return true;
  if (isRateLimited(e)) return false;
  const status = statusOf(e);
  return status !== undefined && status >= 500;
}
