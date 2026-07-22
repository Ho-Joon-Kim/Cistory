process.env.TZ = "Asia/Seoul";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import type { ApiError } from "@/lib/api-handler";
import {
  createDatabaseOverviewStore,
  createOverviewService,
  OVERVIEW_OUTSTANDING_LIMIT,
  OVERVIEW_RETENTION_PERIODS,
  type OverviewStore,
} from "./service";

const NOW = new Date("2026-07-22T03:00:00.000Z");

function databaseWithResults(results: Array<{ rows: unknown[] }>) {
  const statements: string[] = [];
  const dialect = new PgDialect();
  const execute = vi.fn(async (query: SQL) => {
    statements.push(dialect.sqlToQuery(query).sql.replace(/\s+/g, " ").trim());
    const result = results.shift();
    if (!result) throw new Error("Missing fake database result");
    return result;
  });
  const db = {
    transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) =>
      callback({ execute }),
  } as unknown as Database;

  return { db, statements };
}

function store(overrides: Partial<OverviewStore> = {}): OverviewStore {
  return {
    findSnapshot: vi.fn(async () => null),
    enqueueSnapshot: vi.fn(async () => "pending"),
    ...overrides,
  };
}

describe("overview service", () => {
  it("returns missing without writing or invoking aggregation", async () => {
    const repository = store();
    const service = createOverviewService(repository);

    await expect(service.getSnapshot("user-1", "month", "2026-07")).resolves.toEqual({
      status: "missing",
      periodType: "month",
      periodKey: "2026-07",
    });

    expect(repository.findSnapshot).toHaveBeenCalledWith("user-1", "month", "2026-07");
    expect(repository.enqueueSnapshot).not.toHaveBeenCalled();
  });

  it("returns ready domain envelopes and their computed time", async () => {
    const updatedAt = new Date("2026-07-22T02:00:00.000Z");
    const coding = {
      data: { totalCommits: 4 },
      status: "ready" as const,
      computedAt: "2026-07-22T01:59:00.000Z",
      computeVersion: 1,
      errorCode: null,
    } as never;
    const repository = store({
      findSnapshot: vi.fn(async () => ({
        status: "ready",
        updatedAt,
        coding,
        location: null,
        health: null,
        spending: null,
        assets: null,
      })),
    });

    const result = await createOverviewService(repository).getSnapshot(
      "user-1",
      "month",
      "2026-07"
    );

    expect(result).toMatchObject({
      status: "ready",
      computedAt: updatedAt.toISOString(),
      domains: { coding },
    });
  });

  it.each([
    ["quarter", "2026-Q3"],
    ["month", "2026-7"],
    ["week", "2026-W54"],
    ["recent", "2026-02-30"],
  ])("rejects noncanonical period %s/%s", async (periodType, periodKey) => {
    const service = createOverviewService(store());

    await expect(service.getSnapshot("user-1", periodType, periodKey)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_PERIOD",
    } satisfies Partial<ApiError>);
  });

  it.each([
    ["recent", "2026-07-23"],
    ["week", "2026-W31"],
    ["month", "2026-08"],
    ["year", "2027"],
  ])("rejects future %s periods", async (periodType, periodKey) => {
    await expect(
      createOverviewService(store()).requestRecompute("user-1", periodType, periodKey, NOW)
    ).rejects.toMatchObject({ status: 400, code: "FUTURE_PERIOD" } satisfies Partial<ApiError>);
  });

  it.each([
    ["recent", "2026-06-07"],
    ["week", "2024-W29"],
    ["month", "2021-07"],
    ["year", "2016"],
  ])("rejects out-of-retention %s periods", async (periodType, periodKey) => {
    await expect(
      createOverviewService(store()).requestRecompute("user-1", periodType, periodKey, NOW)
    ).rejects.toMatchObject({
      status: 400,
      code: "PERIOD_OUT_OF_RANGE",
    } satisfies Partial<ApiError>);
  });

  it("publishes explicit retention and outstanding policies", () => {
    expect(OVERVIEW_RETENTION_PERIODS).toEqual({ recent: 45, week: 104, month: 60, year: 10 });
    expect(OVERVIEW_OUTSTANDING_LIMIT).toBe(5);
  });

  it("enqueues a valid period idempotently through the user-scoped store", async () => {
    const repository = store();
    const service = createOverviewService(repository);

    await expect(service.requestRecompute("user-1", "month", "2026-06", NOW)).resolves.toEqual({
      status: "pending",
      periodType: "month",
      periodKey: "2026-06",
    });
    await service.requestRecompute("user-1", "month", "2026-06", NOW);

    expect(repository.enqueueSnapshot).toHaveBeenCalledTimes(2);
    expect(repository.enqueueSnapshot).toHaveBeenCalledWith({
      userId: "user-1",
      periodType: "month",
      periodKey: "2026-06",
      now: NOW,
      outstandingLimit: OVERVIEW_OUTSTANDING_LIMIT,
    });
  });

  it.each([
    ["computing", 409, "PERIOD_COMPUTING"],
    ["limit", 429, "OUTSTANDING_LIMIT"],
  ] as const)("maps %s enqueue conflicts to ApiError", async (outcome, status, code) => {
    const repository = store({ enqueueSnapshot: vi.fn(async () => outcome) });

    await expect(
      createOverviewService(repository).requestRecompute("user-1", "month", "2026-06", NOW)
    ).rejects.toMatchObject({ status, code });
  });

  it("serializes the user-scoped limit check and duplicate-safe enqueue in one transaction", async () => {
    const { db, statements } = databaseWithResults([
      { rows: [] },
      { rows: [] },
      { rows: [{ count: 1 }] },
      { rows: [{ status: "pending" }] },
    ]);

    await expect(
      createDatabaseOverviewStore(db).enqueueSnapshot({
        userId: "user-1",
        periodType: "month",
        periodKey: "2026-07",
        now: NOW,
        outstandingLimit: 5,
      })
    ).resolves.toBe("pending");

    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements[1]).toMatch(/WHERE user_id = \$1.*FOR UPDATE/);
    expect(statements[2]).toMatch(/WHERE user_id = \$1.*status IN \('pending', 'computing'\)/);
    expect(statements[3]).toContain("ON CONFLICT (user_id, period_type, period_key) DO UPDATE");
    expect(statements[3]).toContain("WHERE period_snapshots.status <> 'computing'");
  });

  it("returns computing under the row lock without counting or upserting", async () => {
    const { db, statements } = databaseWithResults([
      { rows: [] },
      { rows: [{ status: "computing" }] },
    ]);

    await expect(
      createDatabaseOverviewStore(db).enqueueSnapshot({
        userId: "user-1",
        periodType: "month",
        periodKey: "2026-07",
        now: NOW,
        outstandingLimit: 5,
      })
    ).resolves.toBe("computing");

    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain("FOR UPDATE");
  });

  it("returns limit before upsert when the user has too many outstanding jobs", async () => {
    const { db, statements } = databaseWithResults([
      { rows: [] },
      { rows: [] },
      { rows: [{ count: 5 }] },
    ]);

    await expect(
      createDatabaseOverviewStore(db).enqueueSnapshot({
        userId: "user-1",
        periodType: "month",
        periodKey: "2026-07",
        now: NOW,
        outstandingLimit: 5,
      })
    ).resolves.toBe("limit");

    expect(statements).toHaveLength(3);
    expect(statements.some((statement) => statement.startsWith("INSERT"))).toBe(false);
  });
});
