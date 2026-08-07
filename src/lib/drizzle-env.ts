/** Fallback used when no DATABASE_URL is available from any layer below. */
export const DRIZZLE_FALLBACK_DATABASE_URL = "postgresql://cistory:cistory@localhost:5432/cistory";

/**
 * Decides which DATABASE_URL drizzle-kit should use, given the environment after
 * `drizzle.config.ts` has already loaded `.env.local` (with `override: true`, so
 * `env.DATABASE_URL` here already reflects `.env.local` winning over `.env` when both
 * define it).
 *
 * `DRIZZLE_DATABASE_URL` is the explicit escape hatch and always wins when set: it is the
 * only signal that can't be confused with `.env`/`.env.local`, so it's how you point a
 * one-off `drizzle-kit` invocation at a different database without that override clobbering
 * an intentional shell export of `DATABASE_URL`.
 */
export function resolveDrizzleDatabaseUrl(env: {
  DRIZZLE_DATABASE_URL?: string;
  DATABASE_URL?: string;
}): string {
  return env.DRIZZLE_DATABASE_URL || env.DATABASE_URL || DRIZZLE_FALLBACK_DATABASE_URL;
}
