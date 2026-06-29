import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logger } from "@/lib/logger";
import * as schema from "./schema";

// Singleton database connection
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let poolInstance: Pool | null = null;

export function getPool() {
  if (!poolInstance) {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    // Tailscale/CGNAT and many cloud NATs silently drop long-idle TCP
    // connections. Without TCP keepalive the pool happily hands out a dead
    // socket on the next query, which surfaces as `Failed query: ... params:`
    // (Drizzle's wrapper) with no Postgres error code attached. The cron's
    // `*/10` schedule was hitting this on roughly one tick per hour while
    // other code paths (recently-active connections) stayed healthy.
    poolInstance = new Pool({
      connectionString: DATABASE_URL,
      // Headroom so foreground requests — notably Better Auth session reads,
      // which share this pool (see src/lib/auth.ts) — aren't starved when the
      // cron's boot/daily catch-up fires a burst of heavy queries. DB
      // max_connections is 100 and baseline usage is ~2, so 40 is safe for the
      // single app instance.
      max: 40,
      idleTimeoutMillis: 30000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      connectionTimeoutMillis: 10000,
      // Bound any single query so a stuck connection trips fast instead of
      // hanging the cron until the next tick. Migration paths set their own
      // longer timeouts via scripts/migrate.ts.
      statement_timeout: 60000,
      query_timeout: 60000,
    });

    poolInstance.on("error", (err) => {
      // pg.Pool emits 'error' for idle-client failures (e.g. server-side
      // termination, network drop). Without a listener the process crashes.
      // The pool removes the bad client automatically; we just log it.
      logger.error("[DB] Idle client error", {
        message: err.message,
        code: (err as NodeJS.ErrnoException).code,
      });
    });
  }
  return poolInstance;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

export type Database = ReturnType<typeof getDb>;

// Re-export schema for convenience
export * from "./schema";
