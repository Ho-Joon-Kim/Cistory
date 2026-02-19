import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Singleton database connection
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: Pool | null = null;

export function getDb() {
  if (!dbInstance) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
    });
    dbInstance = drizzle(pool, { schema });
  }
  return dbInstance;
}

export type Database = ReturnType<typeof getDb>;

// Re-export schema for convenience
export * from "./schema";
