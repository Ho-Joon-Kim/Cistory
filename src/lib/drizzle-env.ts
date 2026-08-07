/** Fallback used when no DATABASE_URL is available from any layer below. */
export const DRIZZLE_FALLBACK_DATABASE_URL = "postgresql://cistory:cistory@localhost:5432/cistory";

/**
 * Picks the DATABASE_URL drizzle-kit should use: DRIZZLE_DATABASE_URL > DATABASE_URL >
 * the localhost fallback. See the comment above the `config()` call in drizzle.config.ts
 * (the sole caller) for why DRIZZLE_DATABASE_URL exists and what DATABASE_URL already
 * reflects by the time it's read here.
 */
export function resolveDrizzleDatabaseUrl(env: {
  DRIZZLE_DATABASE_URL?: string;
  DATABASE_URL?: string;
}): string {
  return env.DRIZZLE_DATABASE_URL || env.DATABASE_URL || DRIZZLE_FALLBACK_DATABASE_URL;
}
