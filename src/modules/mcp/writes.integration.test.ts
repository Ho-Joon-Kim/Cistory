import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import {
  mcpAuditLog,
  mcpIdempotency,
  mcpTokens,
  notificationLogs,
  periodSnapshots,
  savedPlaces,
  transactions,
  trips,
  visits,
} from "@/db/schema";
import { insertTestUser } from "@/db/testing/fixtures";
import { createSavedPlace } from "@/modules/location/saved-places";
import { getPeriodKey } from "@/modules/overview/period";
import { correctTransaction, parseTransactionCorrection } from "@/modules/spending/service";
import { type McpToolContext, runTool, writeAuditHook } from "./server";
import { issueToken, revokeToken } from "./tokens";
import {
  savedPlaceCreateTool,
  transactionCorrectTool,
  tripCreateTool,
  tripDeleteTool,
  tripMarkNotATripTool,
} from "./tools/writes";

// Alerts are U10's concern and would schedule Telegram sends; keep them out.
vi.mock("./alerts-hook", () => ({ onDenied: vi.fn() }));

// Committed rows on a pool: the writes run their own transactions (trip write
// lock, FOR SHARE token re-check), and the revoke race needs two connections.
// Everything is owned by the test users and removed through the users cascade.
describe("MCP write tools against PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  const createdUsers: string[] = [];

  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Use disposable TEST_DATABASE_URL only");
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 8 });
    db = drizzle(pool, { schema }) as unknown as Database;
  });
  afterEach(async () => {
    if (createdUsers.length > 0) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdUsers.splice(0)]);
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  async function setup(overrides: Partial<McpToolContext> = {}): Promise<McpToolContext> {
    const userId = await insertTestUser(db as never);
    createdUsers.push(userId);
    const { token } = await issueToken(db, userId, { name: "agent", scopes: ["write"] });
    return {
      db,
      userId,
      tokenId: token.id,
      tokenName: "agent",
      scopes: ["write"],
      ip: "203.0.113.7",
      country: "KR",
      now: new Date(),
      ...overrides,
    };
  }

  async function seedSnapshots(userId: string, keys: Array<[schema.PeriodType, string]>) {
    await db.insert(periodSnapshots).values(
      keys.map(([periodType, periodKey]) => ({
        userId,
        periodType,
        periodKey,
        status: "ready" as const,
      }))
    );
  }

  async function snapshotStatus(userId: string): Promise<Record<string, string>> {
    const rows = await db
      .select({
        type: periodSnapshots.periodType,
        key: periodSnapshots.periodKey,
        status: periodSnapshots.status,
      })
      .from(periodSnapshots)
      .where(eq(periodSnapshots.userId, userId));
    return Object.fromEntries(rows.map((row) => [`${row.type}:${row.key}`, row.status]));
  }

  async function auditRows(userId: string) {
    return db.select().from(mcpAuditLog).where(eq(mcpAuditLog.userId, userId));
  }

  it("AE5: not-a-trip creates the exclusion place, audits trip + place, re-queues the range", async () => {
    const ctx = await setup();
    const now = new Date();
    await db.insert(savedPlaces).values({
      userId: ctx.userId,
      name: "집",
      lat: 37.5665,
      lon: 126.978,
      radiusM: 100,
      category: "home",
      createdAt: now,
      updatedAt: now,
    });
    const [trip] = await db
      .insert(trips)
      .values({
        userId: ctx.userId,
        name: "부산 여행",
        startDate: "2026-07-15",
        endDate: "2026-07-18",
        notes: "메모는 감사에 남지 않는다",
        isOverseas: false,
        autoDetected: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await db.insert(visits).values({
      userId: ctx.userId,
      centerLat: 35.1796,
      centerLon: 129.0756,
      radiusM: 50,
      startTime: new Date("2026-07-16T01:00:00Z"),
      endTime: new Date("2026-07-16T05:00:00Z"),
      durationSeconds: 4 * 3600,
      placeName: "부산역",
      city: "부산",
      calculatedAt: now,
    });
    const week = getPeriodKey("week", new Date("2026-07-16T12:00:00+09:00"));
    await seedSnapshots(ctx.userId, [
      ["recent", "2026-07-16"],
      ["week", week],
      ["month", "2026-07"],
      ["year", "2026"],
      ["month", "2026-01"],
    ]);

    const result = await runTool(tripMarkNotATripTool, ctx, { tripId: trip.id });

    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { status: string; place: { id: string } };
    expect(out.status).toBe("done");
    expect(await db.select().from(trips).where(eq(trips.id, trip.id))).toHaveLength(0);
    const [place] = await db.select().from(savedPlaces).where(eq(savedPlaces.id, out.place.id));
    expect(place).toMatchObject({ excludeFromTrips: true, tripExclusionRadiusM: 10_000 });

    const audit = await auditRows(ctx.userId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tool: "trip_mark_not_a_trip", outcome: "ok", resultCount: 1 });
    expect(audit[0].writeBefore).toEqual({
      trip: {
        id: trip.id,
        name: "부산 여행",
        startDate: "2026-07-15",
        endDate: "2026-07-18",
        autoDetected: true,
      },
      place: null,
    });
    expect(audit[0].writeAfter).toMatchObject({
      trip: null,
      place: { id: out.place.id, excludeFromTrips: true, tripExclusionRadiusM: 10_000 },
    });
    expect(JSON.stringify(audit[0])).not.toContain("메모는");
    expect(JSON.stringify(audit[0])).not.toContain("129.07");

    expect(await snapshotStatus(ctx.userId)).toEqual({
      "recent:2026-07-16": "pending",
      [`week:${week}`]: "pending",
      "month:2026-07": "pending",
      "year:2026": "pending",
      "month:2026-01": "ready",
    });

    // A second call is a no-op "already processed" and creates no second place.
    const again = await runTool(tripMarkNotATripTool, ctx, { tripId: trip.id });
    expect(again.structuredContent).toMatchObject({ status: "already_processed" });
    const places = await db.select().from(savedPlaces).where(eq(savedPlaces.userId, ctx.userId));
    expect(places).toHaveLength(2);
  });

  it("refuses a manual trip and a trip without visits, changing nothing", async () => {
    const ctx = await setup();
    const now = new Date();
    const [manual, empty] = await db
      .insert(trips)
      .values([
        {
          userId: ctx.userId,
          name: "직접 만든 여행",
          startDate: "2026-05-01",
          endDate: "2026-05-02",
          isOverseas: false,
          autoDetected: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          userId: ctx.userId,
          name: "방문 없는 여행",
          startDate: "2026-06-01",
          endDate: "2026-06-02",
          isOverseas: false,
          autoDetected: true,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .returning();
    await seedSnapshots(ctx.userId, [["month", "2026-06"]]);

    const refused = await runTool(tripMarkNotATripTool, ctx, { tripId: manual.id });
    expect(refused.isError).toBe(true);
    const noVisits = await runTool(tripMarkNotATripTool, ctx, { tripId: empty.id });
    expect(noVisits.isError).toBe(true);
    expect((noVisits.content[0] as { text: string }).text).toContain("방문 기록이 없어요");

    expect(await db.select().from(trips).where(eq(trips.userId, ctx.userId))).toHaveLength(2);
    expect(
      await db.select().from(savedPlaces).where(eq(savedPlaces.userId, ctx.userId))
    ).toHaveLength(0);
    expect(await snapshotStatus(ctx.userId)).toEqual({ "month:2026-06": "ready" });
  });

  it("trip_delete removes any owned trip, audits it and re-queues its range", async () => {
    const ctx = await setup();
    const now = new Date();
    const [trip] = await db
      .insert(trips)
      .values({
        userId: ctx.userId,
        name: "직접 만든 여행",
        startDate: "2026-05-01",
        endDate: "2026-05-02",
        notes: "메모는 감사에 남지 않는다",
        isOverseas: false,
        autoDetected: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await seedSnapshots(ctx.userId, [
      ["month", "2026-05"],
      ["month", "2026-06"],
    ]);

    const conflict = await runTool(tripDeleteTool, ctx, {
      tripId: trip.id,
      expectedCurrent: { name: "다른 이름" },
    });
    expect(conflict.isError).toBe(true);
    expect(await db.select().from(trips).where(eq(trips.id, trip.id))).toHaveLength(1);

    const result = await runTool(tripDeleteTool, ctx, {
      tripId: trip.id,
      expectedCurrent: { name: "직접 만든 여행" },
    });
    expect(result.structuredContent).toMatchObject({ status: "done", trip: { id: trip.id } });
    expect(await db.select().from(trips).where(eq(trips.id, trip.id))).toHaveLength(0);
    expect(await snapshotStatus(ctx.userId)).toEqual({
      "month:2026-05": "pending",
      "month:2026-06": "ready",
    });
    const ok = (await auditRows(ctx.userId)).find((r) => r.outcome === "ok");
    expect(ok).toMatchObject({ tool: "trip_delete", writeAfter: null });
    expect(ok?.writeBefore).toEqual({
      id: trip.id,
      name: "직접 만든 여행",
      startDate: "2026-05-01",
      endDate: "2026-05-02",
      autoDetected: false,
    });

    const again = await runTool(tripDeleteTool, ctx, { tripId: trip.id });
    expect(again.structuredContent).toMatchObject({ status: "already_processed" });
  });

  it("a category correction is manual and re-queues only that KST day's periods", async () => {
    const ctx = await setup();
    const now = new Date();
    const [log] = await db
      .insert(notificationLogs)
      .values({ userId: ctx.userId, rawPayload: "{}", receivedAt: now })
      .returning();
    const [tx] = await db
      .insert(transactions)
      .values({
        userId: ctx.userId,
        notificationLogId: log.id,
        type: "withdrawal",
        amount: 4500,
        merchant: "카페",
        accountName: "통장",
        rawTitle: "토스",
        rawText: "카페 4,500원",
        // 2026-11-12T16:30Z = 2026-11-13 01:30 KST.
        transactedAt: new Date("2026-11-12T16:30:00Z"),
        createdAt: now,
        category: "food",
        categorySource: "ai",
      })
      .returning();
    await seedSnapshots(ctx.userId, [
      ["recent", "2026-11-13"],
      ["recent", "2026-11-01"],
      ["month", "2026-11"],
      ["month", "2026-10"],
    ]);

    const conflict = await runTool(transactionCorrectTool, ctx, {
      transactionId: tx.id,
      category: "cafe",
      expectedCurrent: { category: "shopping" },
    });
    expect(conflict.isError).toBe(true);
    const [unchanged] = await db.select().from(transactions).where(eq(transactions.id, tx.id));
    expect(unchanged).toMatchObject({ category: "food", categorySource: "ai" });
    expect((await snapshotStatus(ctx.userId))["month:2026-11"]).toBe("ready");

    const result = await runTool(transactionCorrectTool, ctx, {
      transactionId: tx.id,
      category: "cafe",
      expectedCurrent: { category: "food" },
    });
    expect(result.isError).toBeFalsy();
    const [row] = await db.select().from(transactions).where(eq(transactions.id, tx.id));
    expect(row).toMatchObject({ category: "cafe", categorySource: "manual" });
    expect(await snapshotStatus(ctx.userId)).toEqual({
      "recent:2026-11-13": "pending",
      // A recent key is the 14-day window ending on it; one that ends before the day is untouched.
      "recent:2026-11-01": "ready",
      "month:2026-11": "pending",
      "month:2026-10": "ready",
    });
    const audit = await auditRows(ctx.userId);
    expect(audit).toHaveLength(2);
    // The rolled-back conflict leaves one error row with only its code (R28).
    const failed = audit.find((r) => r.outcome === "error");
    expect(failed).toMatchObject({
      tool: "transaction_correct",
      errorCode: "conflict",
      writeBefore: null,
      writeAfter: null,
    });
    const ok = audit.find((r) => r.outcome === "ok");
    expect(ok?.writeBefore).toMatchObject({ category: "food", categorySource: "ai" });
    expect(ok?.writeAfter).toMatchObject({ category: "cafe", categorySource: "manual" });
    for (const r of audit) {
      expect(JSON.stringify(r)).not.toContain("통장");
      expect(JSON.stringify(r)).not.toContain("4,500");
    }
  });

  it("concurrent corrections serialize on the row: the second sees the first's value and conflicts", async () => {
    const ctx = await setup();
    const now = new Date();
    const [log] = await db
      .insert(notificationLogs)
      .values({ userId: ctx.userId, rawPayload: "{}", receivedAt: now })
      .returning();
    const [tx] = await db
      .insert(transactions)
      .values({
        userId: ctx.userId,
        notificationLogId: log.id,
        type: "withdrawal",
        amount: 4500,
        merchant: "카페",
        accountName: "통장",
        rawTitle: "토스",
        rawText: "카페 4,500원",
        transactedAt: new Date("2026-11-12T03:00:00Z"),
        createdAt: now,
        category: "food",
        categorySource: "ai",
      })
      .returning();

    const parsed = parseTransactionCorrection({ category: "cafe" });
    if (!("value" in parsed)) throw new Error(parsed.error);
    let reached!: () => void;
    const hookReached = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // First correction: holds its transaction (and the row lock) open after the update.
    const first = correctTransaction(ctx.userId, tx.id, parsed.value, {
      database: db,
      inTx: async () => {
        reached();
        await gate;
      },
    });
    await hookReached;

    // Second correction with the same (now stale) expectedCurrent.
    const second = runTool(transactionCorrectTool, ctx, {
      transactionId: tx.id,
      category: "shopping",
      expectedCurrent: { category: "food" },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const waiting = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE 'select %"transactions"%for update%'`
    );
    expect(waiting.rows[0].n).toBeGreaterThanOrEqual(1);

    release();
    await first;
    const result = await second;

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("expectedCurrent");
    const [row] = await db.select().from(transactions).where(eq(transactions.id, tx.id));
    expect(row).toMatchObject({ category: "cafe", categorySource: "manual" });
  });

  it("the same idempotency key creates one row and replays the first result", async () => {
    const ctx = await setup();
    const input = { name: "회사", lat: 37.5, lon: 127.0, idempotencyKey: "create-1" };

    const first = await runTool(savedPlaceCreateTool, ctx, input);
    const second = await runTool(savedPlaceCreateTool, ctx, input);

    expect(first.isError).toBeFalsy();
    expect(second.structuredContent).toEqual({
      ...(first.structuredContent as object),
      replayed: true,
    });
    expect(
      await db.select().from(savedPlaces).where(eq(savedPlaces.userId, ctx.userId))
    ).toHaveLength(1);
    expect(
      await db.select().from(mcpIdempotency).where(eq(mcpIdempotency.tokenId, ctx.tokenId))
    ).toHaveLength(1);

    // Same key, different arguments → conflict, no write.
    const conflict = await runTool(savedPlaceCreateTool, ctx, { ...input, name: "다른 곳" });
    expect(conflict.isError).toBe(true);
    expect(
      await db.select().from(savedPlaces).where(eq(savedPlaces.userId, ctx.userId))
    ).toHaveLength(1);

    // Concurrent duplicates still produce exactly one trip.
    const tripInput = {
      name: "제주",
      startDate: "2026-12-01",
      endDate: "2026-12-03",
      idempotencyKey: "trip-1",
    };
    const results = await Promise.all([
      runTool(tripCreateTool, ctx, tripInput),
      runTool(tripCreateTool, ctx, tripInput),
    ]);
    for (const result of results) expect(result.isError).toBeFalsy();
    expect(await db.select().from(trips).where(eq(trips.userId, ctx.userId))).toHaveLength(1);
  });

  it("a token revoked before commit rolls the write back and records revoked_midflight", async () => {
    const ctx = await setup();
    await revokeToken(db, ctx.userId, ctx.tokenId);

    const result = await runTool(savedPlaceCreateTool, ctx, {
      name: "회사",
      lat: 37.5,
      lon: 127.0,
      idempotencyKey: "k",
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("토큰이 폐기되어");
    expect(
      await db.select().from(savedPlaces).where(eq(savedPlaces.userId, ctx.userId))
    ).toHaveLength(0);
    expect(
      await db.select().from(mcpIdempotency).where(eq(mcpIdempotency.tokenId, ctx.tokenId))
    ).toHaveLength(0);
    const audit = await auditRows(ctx.userId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      outcome: "denied",
      denyReason: "revoked_midflight",
      tool: "saved_place_create",
    });
  });

  it("an audit insert failure rolls the write back", async () => {
    // A NUL byte is not valid in a Postgres text value: the audit insert fails
    // after the token re-check passed.
    const ctx = await setup({ ip: "203.0.113.7\u0000" });
    const result = await runTool(savedPlaceCreateTool, ctx, { name: "회사", lat: 37.5, lon: 127 });
    expect(result.isError).toBe(true);
    expect(
      await db.select().from(savedPlaces).where(eq(savedPlaces.userId, ctx.userId))
    ).toHaveLength(0);
    expect(await auditRows(ctx.userId)).toHaveLength(0);
  });

  it("a concurrent revoke waits for the FOR SHARE lock until the write commits", async () => {
    const ctx = await setup();
    const audit = writeAuditHook(ctx, {
      tool: "saved_place_create",
      args: {},
      fields: ["id", "name"],
    });
    let reached!: () => void;
    const hookReached = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const write = createSavedPlace(
      ctx.userId,
      { name: "회사", lat: 37.5, lon: 127, radiusM: 100, category: null, address: null },
      {
        database: db,
        inTx: async (tx, change) => {
          await audit(tx, { before: change.before, after: change.after });
          reached();
          await gate; // hold the transaction (and the FOR SHARE lock) open
        },
      }
    );
    await hookReached;

    let revokedAt: number | null = null;
    const revoke = revokeToken(db, ctx.userId, ctx.tokenId).then(() => {
      revokedAt = Date.now();
    });
    // The revoke UPDATE must be blocked on the share lock.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(revokedAt).toBeNull();
    const waiting = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE 'update "mcp_tokens"%'`
    );
    expect(waiting.rows[0].n).toBeGreaterThanOrEqual(1);

    const committedAt = await (async () => {
      release();
      await write;
      return Date.now();
    })();
    await revoke;

    expect(revokedAt).not.toBeNull();
    expect(revokedAt as unknown as number).toBeGreaterThanOrEqual(committedAt - 5);
    expect(
      await db.select().from(savedPlaces).where(eq(savedPlaces.userId, ctx.userId))
    ).toHaveLength(1);
    const [token] = await db
      .select({ revokedAt: mcpTokens.revokedAt })
      .from(mcpTokens)
      .where(and(eq(mcpTokens.id, ctx.tokenId), eq(mcpTokens.userId, ctx.userId)));
    expect(token.revokedAt).not.toBeNull();
    const rows = await auditRows(ctx.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "ok", tool: "saved_place_create" });
  });
});
