import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DATABASE_PATH = process.env.DATABASE_URL || "./data/cistory.db";

// Singleton database connection
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!dbInstance) {
    const sqlite = new Database(DATABASE_PATH);
    sqlite.pragma("journal_mode = WAL");
    dbInstance = drizzle(sqlite, { schema });
  }
  return dbInstance;
}

export type Database = ReturnType<typeof getDb>;

// Re-export schema for convenience
export * from "./schema";
