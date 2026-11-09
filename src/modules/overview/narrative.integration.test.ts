import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { type PeriodDomainEnvelope, periodNarratives, periodSnapshots } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { createDatabaseNarrativeStore, NARRATIVE_MAX_ATTEMPTS } from "./narrative";

// claimAutoBatch is a global queue (no user filter), so it runs against a
// private schema rather than the shared transactional harness — otherwise it
// could claim rows another concurrently running test file inserted.
describe("narrative regeneration against PostgreSQL", () => {
  const namespace = `narrative_test_${randomUUID().replaceAll("-", "")}`;
  const tables = ["users", "period_snapshots", "period_narratives"];
  let admin: Pool;
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    for (const table of tables) {
      await admin.query(
        `CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING ALL)`
      );
    }
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${namespace},public`,
    });
    db = drizzle(pool, { schema });
  });

  afterEach(async () => {
    await admin.query(`TRUNCATE ${tables.map((table) => `"${namespace}"."${table}"`).join(", ")}`);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await admin.end();
    }
  });

  function envelope(data: unknown, computedAt: Date, computeVersion: number): PeriodDomainEnvelope {
    return {
      status: "ready",
      computedAt: computedAt.toISOString(),
      computeVersion,
      errorCode: null,
      data,
    };
  }

  async function finalizedMonth(
    userId: string,
    commits: number,
    computedAt: Date,
    version: number
  ) {
    await db.insert(periodSnapshots).values({
      userId,
      periodType: "month",
      periodKey: "2026-10",
      status: "ready",
      finalizedAt: new Date("2026-10-31T15:00:00Z"),
      computeVersion: version,
      coding: envelope({ commits }, computedAt, version),
      location: null,
      health: envelope({ steps: { days: 31 } }, computedAt, version),
      spending: null,
      assets: null,
    });
  }

  async function recompute(userId: string, commits: number, computedAt: Date, version: number) {
    await db
      .update(periodSnapshots)
      .set({
        computeVersion: version,
        coding: envelope({ commits }, computedAt, version),
        health: envelope({ steps: { days: 31 } }, computedAt, version),
        updatedAt: computedAt,
      })
      .where(eq(periodSnapshots.userId, userId));
  }

  async function narrative(userId: string) {
    const [row] = await db
      .select()
      .from(periodNarratives)
      .where(and(eq(periodNarratives.userId, userId), eq(periodNarratives.periodKey, "2026-10")));
    return row;
  }

  it("regenerates only when a recompute actually changed the snapshot input", async () => {
    const store = createDatabaseNarrativeStore(db);
    const userId = await insertTestUser(db);
    const t0 = new Date("2026-11-01T00:00:00Z");
    await finalizedMonth(userId, 4673, t0, 4);

    const [first] = await store.claimAutoBatch(t0, 5);
    expect(first?.periodKey).toBe("2026-10");
    expect(await store.complete(first, "옛 회고", "model-a", t0)).toBe(true);
    expect(await store.claimAutoBatch(new Date("2026-11-01T00:05:00Z"), 5)).toEqual([]);

    // A version bump that leaves this period's numbers unchanged only moves
    // computedAt/computeVersion — no paid regeneration.
    await recompute(userId, 4673, new Date("2026-11-05T00:00:00Z"), 5);
    expect(await store.claimAutoBatch(new Date("2026-11-05T00:05:00Z"), 5)).toEqual([]);

    // A bump that moved the numbers re-queues the settled narrative.
    await recompute(userId, 4678, new Date("2026-11-06T00:00:00Z"), 6);
    const at = new Date("2026-11-06T00:05:00Z");
    const [second] = await store.claimAutoBatch(at, 5);
    expect(second?.snapshot.coding?.data).toEqual({ commits: 4678 });
    const generating = await narrative(userId);
    expect(generating).toMatchObject({ status: "generating", attemptCount: 1, content: "옛 회고" });

    expect(await store.complete(second, "새 회고", "model-b", at)).toBe(true);
    expect(await narrative(userId)).toMatchObject({ status: "ready", content: "새 회고" });
    expect(await store.claimAutoBatch(new Date("2026-11-06T00:10:00Z"), 5)).toEqual([]);
  });

  it("re-queues a pre-migration narrative with no recorded input exactly once", async () => {
    const store = createDatabaseNarrativeStore(db);
    const userId = await insertTestUser(db);
    const t0 = new Date("2026-11-01T00:00:00Z");
    await finalizedMonth(userId, 4673, t0, 4);
    await db.insert(periodNarratives).values({
      userId,
      periodType: "month",
      periodKey: "2026-10",
      status: "ready",
      content: "절단된 회고, 이",
      attemptCount: NARRATIVE_MAX_ATTEMPTS,
      generatedAt: t0,
    });

    const [claim] = await store.claimAutoBatch(new Date("2026-11-10T00:00:00Z"), 5);
    expect(claim?.periodKey).toBe("2026-10");
    expect(await narrative(userId)).toMatchObject({ attemptCount: 1 });
  });

  it("retries a re-queued narrative after a failed attempt instead of freezing the stale text", async () => {
    const store = createDatabaseNarrativeStore(db);
    const userId = await insertTestUser(db);
    const t0 = new Date("2026-11-01T00:00:00Z");
    await finalizedMonth(userId, 4673, t0, 4);
    const [first] = await store.claimAutoBatch(t0, 5);
    await store.complete(first, "옛 회고", "model-a", t0);
    await recompute(userId, 4678, new Date("2026-11-06T00:00:00Z"), 5);

    for (let attempt = 1; attempt <= NARRATIVE_MAX_ATTEMPTS; attempt++) {
      const at = new Date(Date.UTC(2026, 10, 6, attempt));
      const [claim] = await store.claimAutoBatch(at, 5);
      expect(claim, `attempt ${attempt} should be claimed`).toBeDefined();
      await store.fail(claim, "AI narrative did not finish cleanly (stop_reason: max_tokens)", at);
      const row = await narrative(userId);
      expect(row.content).toBe("옛 회고");
      expect(row.status).toBe(attempt < NARRATIVE_MAX_ATTEMPTS ? "pending" : "ready");
    }
    // Attempts exhausted for this input: no further paid calls until it changes.
    expect(await store.claimAutoBatch(new Date("2026-11-07T00:00:00Z"), 5)).toEqual([]);
  });
});
