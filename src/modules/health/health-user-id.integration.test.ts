import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Deterministic token (de)encryption — no KIS_ENCRYPTION_KEY in the test env.
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => v.slice(4),
}));
// api-handler → auth-helpers → auth.ts builds the app pool from DATABASE_URL at
// import time; this suite only ever talks to TEST_DATABASE_URL.
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: vi.fn() },
}));

import type { Database } from "@/db";
import { healthConnections, healthDailySummaries, healthSamples } from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { type TestDb, useTransactionalDb } from "@/db/testing/transactional-db";
import { HEALTH_METRICS, HealthSyncService } from "./service";

async function insertConnection(db: TestDb, userId: string, healthUserId: string | null = null) {
  const [row] = await db
    .insert(healthConnections)
    .values({
      userId,
      accessTokenEnc: "enc:at",
      refreshTokenEnc: "enc:rt",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      status: "active",
      healthUserId,
    })
    .returning();
  return row;
}

function serviceWith(db: TestDb, adapter: Record<string, unknown>) {
  const svc = new HealthSyncService(db as unknown as Database);
  (svc as unknown as { adapter: unknown }).adapter = adapter;
  return svc;
}

// Random so concurrent, uncommitted transactions in other files never contend
// on the partial unique index.
const randomHealthUserId = () => String(randomInt(1, 2 ** 47)).padStart(19, "1");

describe("health_connections.health_user_id (0045)", () => {
  const ctx = useTransactionalDb();

  it("lets many connections hold NULL but only one hold a given id", async () => {
    const db = ctx.db();
    const id = randomHealthUserId();
    await insertConnection(db, await insertTestUser(db));
    await insertConnection(db, await insertTestUser(db)); // second NULL is fine
    await insertConnection(db, await insertTestUser(db), id);
    await ctx.client().query("SAVEPOINT clash");
    await expect(insertConnection(db, await insertTestUser(db), id)).rejects.toThrow();
    await ctx.client().query("ROLLBACK TO SAVEPOINT clash");
  });

  it("ensureHealthUserId stores the identity and maps it back to the user", async () => {
    const db = ctx.db();
    const userId = await insertTestUser(db);
    const conn = await insertConnection(db, userId);
    const id = randomHealthUserId();
    const getIdentity = vi.fn().mockResolvedValue({ healthUserId: id });
    await serviceWith(db, { getIdentity }).ensureHealthUserId(conn);
    expect(getIdentity).toHaveBeenCalledWith("at");
    const [mapped] = await db
      .select({ userId: healthConnections.userId })
      .from(healthConnections)
      .where(eq(healthConnections.healthUserId, id));
    expect(mapped?.userId).toBe(userId);
  });

  it("a clashing id is swallowed (logged) and leaves the row NULL", async () => {
    const db = ctx.db();
    const id = randomHealthUserId();
    await insertConnection(db, await insertTestUser(db), id);
    const victimUser = await insertTestUser(db);
    const victim = await insertConnection(db, victimUser);
    await ctx.client().query("SAVEPOINT clash");
    await expect(
      serviceWith(db, {
        getIdentity: vi.fn().mockResolvedValue({ healthUserId: id }),
      }).ensureHealthUserId(victim)
    ).resolves.toBeUndefined();
    await ctx.client().query("ROLLBACK TO SAVEPOINT clash");
    const [row] = await db
      .select({ healthUserId: healthConnections.healthUserId })
      .from(healthConnections)
      .where(eq(healthConnections.userId, victimUser));
    expect(row.healthUserId).toBeNull();
  });
});

describe("rollup persistence buckets into the KST day", () => {
  const ctx = useTransactionalDb();

  it("stores total_calories at 12:00 KST and rolls it into that KST day's summary", async () => {
    const db = ctx.db();
    const userId = await insertTestUser(db);
    const conn = await insertConnection(db, userId);
    const config = HEALTH_METRICS.find((c) => c.key === "total_calories")!;
    const dailyRollUp = vi.fn().mockResolvedValue({
      rollupDataPoints: [
        {
          civilStartTime: { date: { year: 2026, month: 11, day: 9 }, time: {} },
          civilEndTime: { date: { year: 2026, month: 11, day: 10 }, time: {} },
          totalCalories: { kcalSum: 2100 },
        },
      ],
    });
    const out = await serviceWith(db, { dailyRollUp }).fetchRollupWindowAndPersist(
      conn,
      config,
      new Date("2026-11-08T15:00:00Z"), // 11-09 00:00 KST
      new Date("2026-11-09T15:00:00Z") // 11-10 00:00 KST
    );
    expect(out).toEqual({ upserted: 1, truncated: false });
    const [sample] = await db
      .select()
      .from(healthSamples)
      .where(and(eq(healthSamples.userId, userId), eq(healthSamples.metric, "total_calories")));
    expect(sample.sampleAt.toISOString()).toBe("2026-11-09T03:00:00.000Z");
    expect(sample.source).toBe("rollup:google-wearables");
    const [summary] = await db
      .select()
      .from(healthDailySummaries)
      .where(
        and(
          eq(healthDailySummaries.userId, userId),
          eq(healthDailySummaries.metric, "total_calories")
        )
      );
    expect(summary).toMatchObject({ day: "2026-11-09", valueSum: 2100, count: 1 });

    // Revisable: a later read of the same day overwrites rather than duplicating.
    dailyRollUp.mockResolvedValueOnce({
      rollupDataPoints: [
        {
          civilStartTime: { date: { year: 2026, month: 11, day: 9 }, time: {} },
          totalCalories: { kcalSum: 2400 },
        },
      ],
    });
    await serviceWith(db, { dailyRollUp }).fetchRollupWindowAndPersist(
      conn,
      config,
      new Date("2026-11-08T15:00:00Z"),
      new Date("2026-11-09T15:00:00Z")
    );
    const rows = await db
      .select()
      .from(healthSamples)
      .where(and(eq(healthSamples.userId, userId), eq(healthSamples.metric, "total_calories")));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(2400);
  });
});
