import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import * as schema from "@/db/schema";

export type TestDb = NodePgDatabase<typeof schema>;

/**
 * Per-test isolation for *.integration.test.ts: one dedicated `pg.Client`
 * (not the app's pooled singleton) per test file, wrapped in
 * `BEGIN`/`ROLLBACK` around every test.
 *
 * Chosen over the alternatives:
 *   - A fresh database (or schema) per test would be the strongest
 *     isolation, but re-running 42 migrations per test is far too slow for
 *     a suite meant to be run routinely, not just in CI.
 *   - Sharing one long-lived connection across tests with manual per-table
 *     DELETEs after each test is what this repo does NOT want: it's easy to
 *     forget a table, and a forgotten cleanup silently leaks state into the
 *     next test rather than failing loudly.
 *   - Transaction-per-test gets both: full isolation (nothing a test does
 *     is ever visible to another test or another connection, since it's
 *     never committed) and speed (no schema work, just BEGIN/ROLLBACK).
 *     Sequence-backed defaults (`gen_random_uuid()`) aren't a concern either
 *     way, so a rolled-back transaction leaves literally nothing behind.
 *
 * A single client/transaction per test file also means the session-level
 * settings that make this whole harness meaningful — the server's
 * `TimeZone` GUC, in particular — are identical for every statement a test
 * issues, exactly as they would be for one real request in production.
 *
 * Multiple test files opening their own client concurrently is safe: each
 * gets its own transaction, and tests build their own fixture rows (fresh
 * `crypto.randomUUID()`s) rather than relying on any shared seed data, so
 * concurrent transactions never contend on the same rows.
 */
export function useTransactionalDb() {
  let client: Client;
  let db: TestDb;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "TEST_DATABASE_URL is not set. Run `yarn test:integration` rather than invoking " +
          "vitest on *.integration.test.ts files directly — see CLAUDE.md's Testing section."
      );
    }
    client = new Client({ connectionString: url });
    await client.connect();
    db = drizzle(client, { schema });
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query("BEGIN");
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  return {
    /** The Drizzle instance bound to this test's transaction. */
    db: () => db,
    /** The underlying `pg.Client`, for raw queries the query builder can't express. */
    client: () => client,
  };
}
