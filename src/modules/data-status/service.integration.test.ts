import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import type { ListResult } from "@/lib/adapters/google-health/interface";
import { compactPendingSamples } from "@/modules/health/compaction";
import { HealthSyncService, type MetricConfig } from "@/modules/health/service";
import {
  claimRecoveryDay,
  enqueueRecovery,
  finishRecoveryDay,
  processRecoveryQueue,
} from "./recovery";
import { getDataStatus } from "./service";
import { trackSourceSync } from "./telemetry";

vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: vi.fn() }));

// Real independent transactions are necessary to exercise row/advisory locks.
// Clone table definitions into a private schema so global queue claims cannot
// touch another test's jobs. Better Auth's account table is not in migrations.
describe("data collection status and recovery against PostgreSQL", () => {
  const namespace = `recovery_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let pool: Pool;
  let db: Database;
  let tables: string[] = [];
  const now = new Date("2026-09-07T03:00:00Z");

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    const result = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    tables = result.rows.map((row) => row.tablename);
    for (const table of tables) {
      const escaped = table.replaceAll('"', '""');
      await admin.query(
        `CREATE TABLE "${namespace}"."${escaped}" (LIKE public."${escaped}" INCLUDING ALL)`
      );
    }
    if (!tables.includes("account")) {
      await admin.query(
        `CREATE TABLE "${namespace}"."account" ("userId" text, "providerId" text, "accessToken" text)`
      );
      tables.push("account");
    }
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 8,
      options: `-c search_path=${namespace},public -c timezone=Asia/Seoul`,
    });
    db = drizzle(pool, { schema });
  });

  afterEach(async () => {
    const names = tables.map((name) => `"${namespace}"."${name.replaceAll('"', '""')}"`);
    await admin.query(`TRUNCATE ${names.join(", ")}`);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await admin.end();
    }
  });

  const user = () => insertTestUser(db, { wakatimeApiKey: "fixture-key" });
  const enqueue = (userId: string, to = "2026-09-02") =>
    enqueueRecovery(db, userId, "wakatime", "2026-09-01", to, now);

  it("serializes duplicate enqueue requests and claims a day only once", async () => {
    const id = await user();
    const results = await Promise.allSettled([enqueue(id), enqueue(id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: "RECOVERY_ACTIVE" });
    const claims = await Promise.all([claimRecoveryDay(db, now), claimRecoveryDay(db, now)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("resumes the persisted date after a restart and fences expired owners", async () => {
    const id = await user();
    await enqueue(id);
    const first = (await claimRecoveryDay(db, now))!;
    expect(await finishRecoveryDay(db, first, null, now)).toBe(true);
    const second = (await claimRecoveryDay(db, now))!;
    expect(second.nextDate).toBe("2026-09-02");
    const later = new Date(now.getTime() + 6 * 60_000);
    const replacement = (await claimRecoveryDay(db, later))!;
    expect(replacement.id).toBe(second.id);
    expect(replacement.leaseToken).not.toBe(second.leaseToken);
    expect(replacement.nextDate).toBe(second.nextDate);
    expect(await finishRecoveryDay(db, second, null, later)).toBe(false);
    expect(await finishRecoveryDay(db, replacement, null, later)).toBe(true);
    const [job] = await db.select().from(schema.dataRecoveryJobs);
    expect(job).toMatchObject({ status: "completed", nextDate: "2026-09-03", attempts: 0 });
  });

  it("fails a repeatedly abandoned lease without skipping its date", async () => {
    const id = await user();
    await enqueue(id);
    await db.insert(schema.periodSnapshots).values({
      userId: id,
      periodType: "month",
      periodKey: "2026-09",
      status: "ready",
      attemptCount: 3,
    });
    await db.insert(schema.periodNarratives).values({
      userId: id,
      periodType: "month",
      periodKey: "2026-09",
      status: "ready",
      content: "old",
    });
    for (let i = 0; i < 3; i++) {
      const claim = await claimRecoveryDay(db, new Date(now.getTime() + i * 6 * 60_000));
      expect(claim?.attempts).toBe(i + 1);
      expect(claim?.nextDate).toBe("2026-09-01");
    }
    expect(await claimRecoveryDay(db, new Date(now.getTime() + 18 * 60_000))).toBeNull();
    const [job] = await db.select().from(schema.dataRecoveryJobs);
    expect(job.status).toBe("failed");
    expect((await db.select().from(schema.periodSnapshots))[0]).toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
    expect((await db.select().from(schema.periodNarratives))[0]).toMatchObject({
      status: "pending",
      content: null,
    });
  });

  it("aggregates the requested user's KST days and distinguishes checked empty days", async () => {
    const id = await user();
    const other = await user();
    await db.insert(schema.codingSessions).values([
      {
        userId: id,
        project: "app",
        startedAt: new Date("2026-08-31T14:59:59Z"),
        durationSeconds: 1,
        createdAt: now,
      },
      {
        userId: id,
        project: "app",
        startedAt: new Date("2026-08-31T15:00:00Z"),
        durationSeconds: 1,
        createdAt: now,
      },
      {
        userId: id,
        project: "app",
        startedAt: new Date("2026-09-01T14:59:59Z"),
        durationSeconds: 1,
        createdAt: now,
      },
      {
        userId: id,
        project: "app",
        startedAt: new Date("2026-09-03T15:00:00Z"),
        durationSeconds: 1,
        createdAt: now,
      },
      {
        userId: other,
        project: "app",
        startedAt: new Date("2026-09-01T15:00:00Z"),
        durationSeconds: 1,
        createdAt: now,
      },
    ]);
    await enqueue(id);
    await processRecoveryQueue(db, async () => {}, 2);
    await enqueueRecovery(db, other, "wakatime", "2026-09-03", "2026-09-03", now);
    const result = await getDataStatus(db, id, "2026-09-01", "2026-09-03", now);
    expect(result.jobs).toHaveLength(1);
    const waka = result.sources.find((s) => s.id === "wakatime")!;
    expect(waka.days).toEqual([
      { date: "2026-09-01", count: 2, state: "observed" },
      { date: "2026-09-02", count: 0, state: "checked" },
      { date: "2026-09-03", count: 0, state: "unknown" },
    ]);
    expect(waka.lastRecordAt).toBe("2026-09-01T14:59:59.000Z");
  });

  it("invalidates only the owner's affected periods, including in-flight results", async () => {
    const id = await user();
    const other = await user();
    const rows = [
      { userId: id, periodType: "month" as const, periodKey: "2026-09" },
      { userId: id, periodType: "month" as const, periodKey: "2026-08" },
      { userId: other, periodType: "month" as const, periodKey: "2026-09" },
    ];
    await db.insert(schema.periodSnapshots).values(
      rows.map((row) => ({
        ...row,
        status: "computing" as const,
        attemptCount: 3,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
      }))
    );
    await db.insert(schema.periodNarratives).values(
      rows.map((row) => ({
        ...row,
        status: "generating" as const,
        content: "old",
        generationStartedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        attemptCount: 2,
      }))
    );
    await enqueue(id, "2026-09-01");
    const claim = (await claimRecoveryDay(db, now))!;
    await finishRecoveryDay(db, claim, null, now);
    const snapshots = await db.select().from(schema.periodSnapshots);
    const narratives = await db.select().from(schema.periodNarratives);
    expect(
      snapshots.find((row) => row.userId === id && row.periodKey === "2026-09")?.attemptCount
    ).toBe(0);
    for (const row of snapshots) {
      expect(row.status).toBe(
        row.userId === id && row.periodKey === "2026-09" ? "pending" : "computing"
      );
    }
    for (const row of narratives) {
      if (row.userId === id && row.periodKey === "2026-09")
        expect(row).toMatchObject({
          status: "pending",
          content: null,
          generationStartedAt: null,
          leaseExpiresAt: null,
          attemptCount: 0,
        });
      else expect(row).toMatchObject({ status: "generating", content: "old" });
    }
  });

  async function healthFixture() {
    const id = await user();
    await db
      .insert(schema.healthConnections)
      .values({ userId: id, accessTokenEnc: "fixture", refreshTokenEnc: "fixture" });
    await db.insert(schema.healthSamples).values([
      {
        userId: id,
        metric: "heart_rate",
        source: "FITBIT",
        sampleAt: new Date("2026-09-01T03:00:00Z"),
        value: 80,
        valueJson: { min: 60, max: 100, n: 2 },
      },
      {
        userId: id,
        metric: "heart_rate",
        source: "com.sec.android.app.shealth",
        sampleAt: new Date("2026-09-01T03:01:00Z"),
        value: 150,
      },
    ]);
    const service = new HealthSyncService(db);
    const inner = service as unknown as {
      listPageWithAuth: (
        connection: unknown,
        config: MetricConfig,
        filter: string,
        token?: string
      ) => Promise<ListResult>;
      recomputeDailySummaries: (...args: unknown[]) => Promise<void>;
    };
    const points = [60, 120].map((value, index) => ({
      dataSource: { platform: "FITBIT" },
      heartRate: {
        sampleTime: { physicalTime: `2026-09-01T03:00:${index === 0 ? "02" : "04"}Z` },
        beatsPerMinute: value,
      },
    }));
    const upstream = vi
      .spyOn(inner, "listPageWithAuth")
      .mockImplementation(async (_connection, config) => ({
        dataPoints: config.key === "heart_rate" ? points : [],
      }));
    return { id, service, inner, upstream, points };
  }

  it("replaces compacted cloud samples idempotently and retains separate device sources", async () => {
    const { id, service } = await healthFixture();
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await service.recoverDay(id, "2026-09-01")).toBe(2);
      const summary = (await db.select().from(schema.healthDailySummaries))[0];
      expect(summary).toMatchObject({
        metric: "heart_rate",
        count: 2,
        valueAvg: 90,
        valueMin: 60,
        valueMax: 120,
      });
      await compactPendingSamples(db, id);
      const rows = await db.select().from(schema.healthSamples);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.source === "FITBIT")).toMatchObject({
        value: 90,
        valueJson: { min: 60, max: 120, n: 2 },
      });
      expect(rows.find((row) => row.source === "com.sec.android.app.shealth")?.value).toBe(150);
    }
    expect(await db.select().from(schema.healthSyncState)).toEqual([]);
  });

  it("keeps old health records when pagination, cap, or atomic summary update fails", async () => {
    const { id, service, inner, upstream, points } = await healthFixture();
    const original = await db.select().from(schema.healthSamples);
    upstream.mockImplementation(async (_connection, config, _filter, token) => {
      if (config.key !== "heart_rate") return { dataPoints: [] };
      if (token) throw new Error("page failed");
      return { dataPoints: points, nextPageToken: "next" };
    });
    await expect(service.recoverDay(id, "2026-09-01")).rejects.toThrow("page failed");
    expect(await db.select().from(schema.healthSamples)).toEqual(original);
    upstream.mockImplementation(async (_connection, config) => ({
      dataPoints: config.key === "heart_rate" ? points : [],
      ...(config.key === "heart_rate" ? { nextPageToken: "never-ending" } : {}),
    }));
    await expect(service.recoverDay(id, "2026-09-01")).rejects.toThrow("완료되지");
    expect(await db.select().from(schema.healthSamples)).toEqual(original);
    upstream.mockImplementation(async (_connection, config) => ({
      dataPoints: config.key === "heart_rate" ? points : [],
    }));
    const rollup = inner.recomputeDailySummaries.bind(service);
    vi.spyOn(inner, "recomputeDailySummaries").mockImplementation(async (...args) => {
      if ((args[1] as MetricConfig).key === "heart_rate") throw new Error("rollup failed");
      await rollup(...args);
    });
    await expect(service.recoverDay(id, "2026-09-01")).rejects.toThrow("rollup failed");
    expect(await db.select().from(schema.healthSamples)).toEqual(original);
    expect(await db.select().from(schema.healthRawPages)).toEqual([]);
  });

  it("does not let an older concurrent failure overwrite a newer success in the same millisecond", async () => {
    const id = await user();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      const older = trackSourceSync(db, id, "wakatime", async () => {
        entered();
        await blocked;
        throw new Error("older failure");
      }).catch(() => undefined);
      await started;
      await trackSourceSync(db, id, "wakatime", async () => "newer success");
      release();
      await older;
      const [state] = await db
        .select()
        .from(schema.sourceSyncStates)
        .where(eq(schema.sourceSyncStates.userId, id));
      expect(state.error).toBeNull();
      expect(state.lastSuccessAt).toEqual(now);
    } finally {
      release();
      vi.useRealTimers();
    }
  });

  it("stores sanitized provider failures and keeps the failed date retryable", async () => {
    const id = await user();
    await enqueue(id);
    await processRecoveryQueue(
      db,
      async () => {
        throw new Error("token=secret medical payload");
      },
      1
    );
    const [job] = await db.select().from(schema.dataRecoveryJobs);
    expect(job).toMatchObject({ status: "failed", nextDate: "2026-09-01" });
    expect(job.error).not.toMatch(/secret|medical/);
    await enqueue(id); // Failed jobs do not hold the active-source lock.
    await expect(
      trackSourceSync(db, id, "wakatime", async () => {
        throw new Error("token=secret");
      })
    ).rejects.toThrow("token=secret");
    const [failed] = await db
      .select()
      .from(schema.sourceSyncStates)
      .where(eq(schema.sourceSyncStates.userId, id));
    expect(failed.error).not.toContain("secret");
    expect(failed.lastSuccessAt).toBeNull();
    expect(await trackSourceSync(db, id, "wakatime", async () => 7)).toBe(7);
    const [success] = await db
      .select()
      .from(schema.sourceSyncStates)
      .where(eq(schema.sourceSyncStates.userId, id));
    expect(success.error).toBeNull();
    expect(success.lastSuccessAt).toBeInstanceOf(Date);
  });
});
