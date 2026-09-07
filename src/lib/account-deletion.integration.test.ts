import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { deleteAccount } from "./account-deletion";

describe("account deletion against PostgreSQL", () => {
  const namespace = `account_delete_test_${randomUUID().replaceAll("-", "")}`;
  const appTables = ["users", "commits", "commit_summaries", "coding_sessions"];
  const tables = [...appTables, "user", "account", "session"];
  let admin: Pool;
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    for (const table of appTables) {
      await admin.query(
        `CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING ALL)`
      );
    }
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${namespace},public`,
    });
    db = drizzle(pool, { schema });

    // LIKE does not copy foreign keys. Recreate the actual migrated constraints
    // with their original delete actions, pointing only to our private tables.
    const foreignKeys = await admin.query<{ table: string; name: string; definition: string }>(
      `SELECT relation.relname AS table, constraint_row.conname AS name,
        pg_get_constraintdef(constraint_row.oid) AS definition
       FROM pg_constraint constraint_row
       JOIN pg_class relation ON relation.oid = constraint_row.conrelid
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public' AND constraint_row.contype = 'f'
         AND relation.relname = ANY($1::text[])`,
      [appTables]
    );
    expect(foreignKeys.rows.length).toBeGreaterThanOrEqual(3);
    for (const foreignKey of foreignKeys.rows) {
      const definition = foreignKey.definition.replace(
        /REFERENCES (?:public\.)?([^ (]+)/,
        (_, name) => {
          const referencedTable = name.replaceAll('"', "");
          if (!appTables.includes(referencedTable))
            throw new Error("Unexpected external fixture FK");
          return `REFERENCES "${namespace}"."${referencedTable}"`;
        }
      );
      await pool.query(
        `ALTER TABLE "${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${definition}`
      );
    }
    // Better Auth tables are adapter-owned, absent from application migrations.
    // RESTRICT ensures the service itself removes every session/account first.
    await pool.query(`CREATE TABLE "user" (id text PRIMARY KEY, email text NOT NULL)`);
    await pool.query(`CREATE TABLE "session" (
      id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "user"(id), token text NOT NULL
    )`);
    await pool.query(`CREATE TABLE "account" (
      id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "user"(id),
      "providerId" text NOT NULL, "accessToken" text NOT NULL, "refreshToken" text NOT NULL
    )`);
  });

  afterEach(async () => {
    await pool.query('DROP TRIGGER IF EXISTS force_delete_failure ON "user"');
    await pool.query(`TRUNCATE ${tables.map((table) => `"${table}"`).join(", ")}`);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await admin.end();
    }
  });

  async function seedUser() {
    const id = await insertTestUser(db, { wakatimeApiKey: "fixture-app-secret" });
    const now = new Date();
    await pool.query('INSERT INTO "user" (id, email) VALUES ($1, $2)', [id, `${id}@example.test`]);
    for (const device of ["phone", "desktop"]) {
      await pool.query('INSERT INTO "session" VALUES ($1, $2, $3)', [
        `${id}-${device}`,
        id,
        `fixture-session-${device}`,
      ]);
    }
    for (const provider of ["github", "google"]) {
      await pool.query('INSERT INTO "account" VALUES ($1, $2, $3, $4, $5)', [
        `${id}-${provider}`,
        id,
        provider,
        "fixture-access",
        "fixture-refresh",
      ]);
    }
    await db.insert(schema.commits).values({
      id: `commit-${id}`,
      userId: id,
      sha: id,
      message: "private commit",
      authorName: "fixture",
      repoFullName: "fixture/private",
      committedAt: now,
      createdAt: now,
    });
    await db.insert(schema.commitSummaries).values({
      id: `summary-${id}`,
      commitId: `commit-${id}`,
      summary: "private summary",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.codingSessions).values({
      userId: id,
      project: "private project",
      startedAt: now,
      durationSeconds: 60,
      createdAt: now,
    });
    return id;
  }

  async function snapshot() {
    const result: Record<string, unknown[]> = {};
    for (const table of tables) {
      result[table] = (await pool.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
    }
    return result;
  }

  it("cascades private app records, removes all credentials/devices, and preserves the other user", async () => {
    const other = await seedUser();
    const otherRecords = await snapshot();
    const removed = await seedUser();
    expect(removed).not.toBe(other);
    await deleteAccount(db, removed);
    // Full row comparison covers the survivor's tokens and app data, not just counts.
    expect(await snapshot()).toEqual(otherRecords);
    expect(otherRecords.session).toHaveLength(2);
    expect(otherRecords.account).toHaveLength(2);
    expect(otherRecords.commit_summaries).toHaveLength(1);
  });

  it("rolls back sessions, OAuth credentials and cascaded app data if final auth-user deletion fails", async () => {
    const removed = await seedUser();
    await seedUser();
    const before = await snapshot();
    await pool.query(`CREATE OR REPLACE FUNCTION reject_auth_delete() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced auth deletion failure'; END;
    $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER force_delete_failure BEFORE DELETE ON "user"
      FOR EACH ROW EXECUTE FUNCTION reject_auth_delete()`);
    await expect(deleteAccount(db, removed)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
});
