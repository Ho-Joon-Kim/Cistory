import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Defense against stuck locks: both timeouts ensure the migrator fails fast
// instead of hanging indefinitely when another session holds a conflicting
// lock on __drizzle_migrations or any schema object. CI (Jenkins) surfaces the
// failure within ~2 minutes and humans can investigate pg_stat_activity.
//
// - lock_timeout: max time to wait for a relation lock before aborting.
// - statement_timeout: safety net for any DDL that somehow starts running but
//   stalls (e.g. a multi-million-row table rewrite).
const LOCK_TIMEOUT_MS = 60_000; // 60s
const STATEMENT_TIMEOUT_MS = 120_000; // 2m

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgresql://cistory:cistory@localhost:5432/cistory",
  // pg applies these as session defaults when each pool connection is opened.
  options: `-c lock_timeout=${LOCK_TIMEOUT_MS} -c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
});

const db = drizzle(pool);

async function main() {
  console.log("Running migrations...");
  console.log(
    `(lock_timeout=${LOCK_TIMEOUT_MS}ms, statement_timeout=${STATEMENT_TIMEOUT_MS}ms)`
  );
  await migrate(db, { migrationsFolder: "./drizzle", migrationsSchema: "drizzle" });
  console.log("Migrations completed successfully");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
