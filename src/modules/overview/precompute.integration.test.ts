import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { type PeriodType, periodSnapshots } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import {
  createDatabasePrecomputeStore,
  OVERVIEW_COMPUTE_VERSION,
  PRECOMPUTE_MAX_ATTEMPTS,
} from "./precompute";

// claimSnapshots is a global queue (no user filter), so — like the narrative
// suite — it runs against a private schema instead of the shared transactional
// harness, where it could claim rows another test file inserted.
describe("overview claim order against PostgreSQL", () => {
  const namespace = `precompute_test_${randomUUID().replaceAll("-", "")}`;
  const tables = ["users", "period_snapshots"];
  let admin: Pool;
  let pool: Pool;
  let db: Database;

  const NOW = new Date("2026-11-10T03:00:00Z");
  const ACTIVE: { periodType: PeriodType; periodKey: string }[] = [
    { periodType: "recent", periodKey: "2026-11-10" },
    { periodType: "week", periodKey: "2026-W46" },
    { periodType: "month", periodKey: "2026-11" },
    { periodType: "year", periodKey: "2026" },
  ];

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

  async function row(
    userId: string,
    periodType: PeriodType,
    periodKey: string,
    values: Partial<typeof periodSnapshots.$inferInsert> = {}
  ) {
    const [inserted] = await db
      .insert(periodSnapshots)
      .values({
        userId,
        periodType,
        periodKey,
        status: "ready",
        computeVersion: OVERVIEW_COMPUTE_VERSION,
        updatedAt: new Date("2026-11-10T00:00:00Z"),
        ...values,
      })
      .returning({ id: periodSnapshots.id });
    return inserted.id;
  }

  const claim = (limit: number, excludeIds: string[] = []) =>
    createDatabasePrecomputeStore(db).claimSnapshots({
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
      activePeriods: ACTIVE,
      computeVersion: OVERVIEW_COMPUTE_VERSION,
      maxAttempts: PRECOMPUTE_MAX_ATTEMPTS,
      limit,
      excludeIds,
    });

  const keys = (claimed: { periodType: string; periodKey: string }[]) =>
    claimed.map((item) => `${item.periodType}:${item.periodKey}`);

  it("claims current periods before an older invalidated backlog, newest backlog first", async () => {
    const userId = await insertTestUser(db);
    // The production shape: a history reclassification re-marked ~40 old
    // periods pending first, and the current periods a moment later.
    const early = new Date("2026-11-10T01:00:00Z");
    const later = new Date("2026-11-10T01:00:05Z");
    for (const month of ["2025-03", "2025-11", "2026-09", "2026-10"]) {
      await row(userId, "month", month, { status: "pending", updatedAt: early });
    }
    await row(userId, "week", "2026-W44", { status: "pending", updatedAt: early });
    await row(userId, "year", "2025", { status: "pending", updatedAt: early });
    await row(userId, "recent", "2026-10-01", { status: "pending", updatedAt: early });
    for (const active of ACTIVE) {
      await row(userId, active.periodType, active.periodKey, {
        status: "pending",
        updatedAt: later,
      });
    }
    // Finalized, current version, ended: never a candidate.
    await row(userId, "month", "2026-08", { finalizedAt: new Date("2026-09-01T00:00:00Z") });

    const first = await claim(4);
    expect(new Set(keys(first))).toEqual(
      new Set(["recent:2026-11-10", "week:2026-W46", "month:2026-11", "year:2026"])
    );

    const rest = await claim(20);
    expect(keys(rest)).toEqual([
      // Viewable backlog by period end, newest first (week W44 ends 11-01).
      "week:2026-W44",
      "month:2026-10",
      "month:2026-09",
      "year:2025",
      "month:2025-11",
      "month:2025-03",
      // An old rolling `recent` key no page renders goes last.
      "recent:2026-10-01",
    ]);
    expect(await claim(5)).toEqual([]);
  });

  it("round-robins users, honours excludeIds, and never double-claims across workers", async () => {
    const userA = await insertTestUser(db);
    const userB = await insertTestUser(db);
    const a1 = await row(userA, "month", "2026-10", { status: "pending" });
    await row(userA, "month", "2026-09", { status: "pending" });
    await row(userA, "month", "2026-08", { status: "pending" });
    await row(userB, "month", "2025-01", { status: "pending" });

    const excluded = await claim(10, [a1]);
    expect(
      excluded.map((item) => `${item.userId === userA ? "a" : "b"}:${item.periodKey}`)
    ).toEqual(["a:2026-09", "b:2025-01", "a:2026-08"]);

    // Requeue all four, then race two workers for them.
    await db.update(periodSnapshots).set({ status: "pending" });
    const [left, right] = await Promise.all([claim(2), claim(2)]);
    const ids = [...left, ...right].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
  });

  it("skips exhausted rows and rows already computing", async () => {
    const userId = await insertTestUser(db);
    await row(userId, "month", "2026-10", { status: "computing" });
    await row(userId, "month", "2026-09", {
      status: "failed",
      attemptCount: PRECOMPUTE_MAX_ATTEMPTS,
    });
    await row(userId, "month", "2026-08", { status: "failed", attemptCount: 1 });

    expect(keys(await claim(5))).toEqual(["month:2026-08"]);
  });
});
