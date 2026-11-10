process.env.TZ = "Asia/Seoul";

import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { type PeriodType, periodSnapshots } from "@/db/schema";
import {
  type ActivePeriodSeed,
  createDatabasePrecomputeStore,
  createOverviewPrecomputeRunner,
  getClaimPriority,
  OVERVIEW_COMPUTE_VERSION,
  PRECOMPUTE_CLAIM_LIMIT,
  PRECOMPUTE_MAX_ATTEMPTS,
  PRECOMPUTE_USER_BATCH_LIMIT,
  type PrecomputeSnapshot,
  type PrecomputeStore,
  periodEndKey,
  type SnapshotPublication,
  toSnapshotDomainColumns,
} from "./precompute";
import type { PeriodAggregatePayload, PeriodDomainEnvelope } from "./types";

const NOW = new Date("2026-07-22T03:00:00.000Z");
const LEASE_EXPIRES_AT = new Date("2026-07-22T03:10:00.000Z");

function ready<T>(data: T): PeriodDomainEnvelope<T> {
  return {
    data,
    status: "ready",
    computedAt: NOW.toISOString(),
    computeVersion: OVERVIEW_COMPUTE_VERSION,
    errorCode: null,
  };
}

function payload(overrides: Partial<PeriodAggregatePayload> = {}): PeriodAggregatePayload {
  return {
    coding: ready({ totalCommits: 1 } as never),
    location: ready({ heatmap: [] } as never),
    health: ready({ metrics: [] } as never),
    spending: ready({ netSpend: 0 } as never),
    portfolio: ready({ hasAccounts: false, evaluationTrend: [] } as never),
    ...overrides,
  };
}

interface SnapshotState extends PrecomputeSnapshot {
  leaseExpiresAt: Date | null;
  computedAt: Date | null;
  updatedAt: Date;
  publication?: SnapshotPublication;
}

function snapshot(
  id: string,
  periodType: PeriodType,
  periodKey: string,
  overrides: Partial<SnapshotState> = {}
): SnapshotState {
  return {
    id,
    userId: "user-1",
    periodType,
    periodKey,
    status: "ready",
    attemptCount: 0,
    computeVersion: OVERVIEW_COMPUTE_VERSION,
    finalizedAt: null,
    computeStartedAt: new Date("2026-07-22T01:00:00.000Z"),
    leaseExpiresAt: null,
    computedAt: new Date("2026-07-22T02:00:00.000Z"),
    updatedAt: new Date("2026-07-22T02:00:00.000Z"),
    ...overrides,
  };
}

class MemoryStore implements PrecomputeStore {
  readonly snapshots: SnapshotState[];
  readonly userIds: string[];
  claimedIds: string[] = [];
  claimBatches: string[][] = [];
  seedBatchSizes: number[] = [];
  userPageCalls = 0;

  constructor(snapshots: SnapshotState[] = [], userIds: string[] = []) {
    this.snapshots = snapshots;
    this.userIds = userIds;
  }

  async recoverExpiredLeases(now: Date, maxAttempts: number) {
    let recovered = 0;
    for (const item of this.snapshots) {
      if (
        item.status === "computing" &&
        item.leaseExpiresAt !== null &&
        item.leaseExpiresAt <= now
      ) {
        item.status = item.attemptCount >= maxAttempts ? "failed" : "pending";
        item.leaseExpiresAt = null;
        recovered += 1;
      }
    }
    return recovered;
  }

  async listUserIdsPage(afterUserId: string | null, limit: number) {
    this.userPageCalls += 1;
    const start = afterUserId === null ? 0 : this.userIds.indexOf(afterUserId) + 1;
    return this.userIds.slice(start, start + limit);
  }

  async seedActivePeriods(seeds: ActivePeriodSeed[]) {
    this.seedBatchSizes.push(seeds.length);
    for (const seed of seeds) {
      if (
        this.snapshots.some(
          (item) =>
            item.userId === seed.userId &&
            item.periodType === seed.periodType &&
            item.periodKey === seed.periodKey
        )
      ) {
        continue;
      }
      this.snapshots.push(
        snapshot(`seed-${this.snapshots.length}`, seed.periodType, seed.periodKey, {
          userId: seed.userId,
          status: "pending",
          computedAt: null,
          computeVersion: seed.computeVersion,
        })
      );
    }
  }

  async claimSnapshots(options: Parameters<PrecomputeStore["claimSnapshots"]>[0]) {
    const excluded = new Set(options.excludeIds ?? []);
    const tier = (item: SnapshotState) =>
      getClaimPriority(item, options.activePeriods, options.computeVersion);
    const eligible = this.snapshots.filter(
      (item) =>
        item.status !== "computing" &&
        item.attemptCount < options.maxAttempts &&
        !excluded.has(item.id) &&
        // Same candidate predicate as the SQL.
        (options.activePeriods.some(
          (active) => active.periodType === item.periodType && active.periodKey === item.periodKey
        ) ||
          item.status === "pending" ||
          item.status === "failed" ||
          (item.periodType !== "recent" && item.finalizedAt === null) ||
          item.computeVersion < options.computeVersion)
    );
    // Same order as the SQL: tier, per-user round-robin rank, newest period first.
    const byRecency = (a: SnapshotState, b: SnapshotState) =>
      periodEndKey(b.periodType, b.periodKey).localeCompare(
        periodEndKey(a.periodType, a.periodKey)
      ) ||
      a.updatedAt.getTime() - b.updatedAt.getTime() ||
      a.id.localeCompare(b.id);
    const rank = new Map<string, number>();
    for (const item of eligible) {
      const peers = eligible
        .filter((other) => other.userId === item.userId && tier(other) === tier(item))
        .sort(byRecency);
      rank.set(item.id, peers.indexOf(item));
    }
    const claimed = eligible
      .sort(
        (a, b) =>
          tier(a) - tier(b) || (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || byRecency(a, b)
      )
      .slice(0, options.limit);
    for (const item of claimed) {
      item.status = "computing";
      item.attemptCount += 1;
      item.leaseExpiresAt = options.leaseExpiresAt;
      item.computeStartedAt = options.now;
      item.updatedAt = options.now;
    }
    this.claimBatches.push(claimed.map((item) => item.id));
    this.claimedIds = claimed.map((item) => item.id);
    return claimed.map((item) => ({ ...item }));
  }

  /** Every id claimed so far, in claim order, across batches and runs. */
  get claimOrder() {
    return this.claimBatches.flat();
  }

  async publishSnapshot(item: PrecomputeSnapshot, publication: SnapshotPublication) {
    const stored = this.snapshots.find((candidate) => candidate.id === item.id);
    if (!stored) throw new Error("missing snapshot");
    if (
      stored.status !== "computing" ||
      stored.computeStartedAt.getTime() !== item.computeStartedAt.getTime()
    ) {
      return false;
    }
    stored.status = publication.status;
    stored.computedAt = publication.computedAt;
    stored.computeVersion = publication.computeVersion;
    stored.finalizedAt = publication.finalizedAt;
    stored.attemptCount = publication.status === "ready" ? 0 : stored.attemptCount;
    stored.leaseExpiresAt = null;
    stored.publication = publication;
    stored.updatedAt = publication.computedAt;
    return true;
  }

  async releaseSnapshot(item: PrecomputeSnapshot) {
    const stored = this.snapshots.find((candidate) => candidate.id === item.id);
    if (!stored) throw new Error("missing snapshot");
    if (
      stored.status !== "computing" ||
      stored.computeStartedAt.getTime() !== item.computeStartedAt.getTime()
    ) {
      return false;
    }
    stored.status = "pending";
    stored.attemptCount = Math.max(0, stored.attemptCount - 1);
    stored.leaseExpiresAt = null;
    return true;
  }

  async failSnapshot(item: PrecomputeSnapshot) {
    const stored = this.snapshots.find((candidate) => candidate.id === item.id);
    if (!stored) throw new Error("missing snapshot");
    if (
      stored.status !== "computing" ||
      stored.computeStartedAt.getTime() !== item.computeStartedAt.getTime()
    ) {
      return false;
    }
    stored.status = "failed";
    stored.leaseExpiresAt = null;
    return true;
  }
}

function runner(
  store: MemoryStore,
  aggregate = vi.fn(async () => payload()),
  extra: { timeBudgetMs?: number } = {}
) {
  return { aggregate, runner: createOverviewPrecomputeRunner({ store, aggregate, ...extra }) };
}

describe("overview precompute", () => {
  it("seeds and computes all four active periods for a new user", async () => {
    const store = new MemoryStore([], ["new-user"]);
    const { aggregate, runner: precompute } = runner(store);

    const result = await precompute.run({ now: NOW });

    expect(result).toMatchObject({ claimed: 4, published: 4, failed: 0 });
    expect(store.snapshots.map((item) => `${item.periodType}:${item.periodKey}`).sort()).toEqual([
      "month:2026-07",
      "recent:2026-07-22",
      "week:2026-W30",
      "year:2026",
    ]);
    expect(aggregate).toHaveBeenCalledTimes(4);
  });

  it("claims current periods first, then backlog newest-first, then routine refresh", async () => {
    const store = new MemoryStore([
      snapshot("version", "month", "2025-01", {
        finalizedAt: new Date("2025-02-01T00:00:00Z"),
        computeVersion: 0,
      }),
      snapshot("unfinalized", "month", "2026-06"),
      // Re-marked pending long ago vs. just now: recency, not updatedAt, decides.
      snapshot("old-pending", "month", "2025-05", {
        status: "pending",
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      }),
      snapshot("newer-pending", "week", "2026-W20", {
        status: "pending",
        updatedAt: new Date("2026-07-22T02:59:00Z"),
      }),
      snapshot("active-pending", "month", "2026-07", {
        status: "pending",
        updatedAt: new Date("2026-07-22T02:59:59Z"),
      }),
      snapshot("active-ready", "week", "2026-W30"),
      snapshot("old-recent", "recent", "2026-07-01", { status: "pending" }),
      snapshot("finalized", "month", "2026-05", {
        finalizedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ]);
    const { runner: precompute } = runner(store);

    await precompute.run({
      now: NOW,
      completedLocationWindows: [{ userId: "user-1", completedThrough: "2026-06-30" }],
    });

    expect(store.claimOrder).toEqual([
      "active-pending",
      "newer-pending",
      "old-pending",
      "unfinalized",
      "version",
      "active-ready",
      "old-recent",
    ]);
    expect(store.claimBatches[0]).toHaveLength(PRECOMPUTE_CLAIM_LIMIT);
  });

  it("puts a viewed current period ahead of a large invalidated backlog", async () => {
    const backlog = Array.from({ length: 40 }, (_, index) =>
      snapshot(
        `backlog-${index}`,
        "month",
        `20${23 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
        {
          status: "pending",
          updatedAt: new Date("2026-07-22T01:00:00Z"),
        }
      )
    );
    const current = snapshot("current", "month", "2026-07", {
      status: "pending",
      updatedAt: new Date("2026-07-22T02:00:00Z"),
    });
    const store = new MemoryStore([...backlog, current]);
    const { runner: precompute } = runner(store);

    await precompute.run({ now: NOW });

    expect(store.claimOrder[0]).toBe("current");
  });

  it("round-robins users within a tier", async () => {
    const store = new MemoryStore([
      snapshot("a-1", "month", "2025-05", { userId: "user-a", status: "pending" }),
      snapshot("a-2", "month", "2025-04", { userId: "user-a", status: "pending" }),
      snapshot("a-3", "month", "2025-03", { userId: "user-a", status: "pending" }),
      snapshot("b-1", "month", "2024-01", { userId: "user-b", status: "pending" }),
    ]);
    const { runner: precompute } = runner(store);

    await precompute.run({
      now: NOW,
      completedLocationWindows: [
        { userId: "user-a", completedThrough: "2026-07-21" },
        { userId: "user-b", completedThrough: "2026-07-21" },
      ],
    });

    expect(store.claimOrder).toEqual(["a-1", "b-1", "a-2", "a-3"]);
  });

  it("keeps claiming batches within the time budget and claims each row once per run", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      snapshot(`row-${String(index).padStart(2, "0")}`, "month", "2026-07", {
        userId: `user-${index}`,
        status: "pending",
      })
    );
    const store = new MemoryStore(rows);
    const { runner: precompute } = runner(store);

    const result = await precompute.run({ now: NOW });

    expect(result).toMatchObject({ claimed: 12, published: 12 });
    expect(store.claimBatches.map((batch) => batch.length)).toEqual([5, 5, 2, 0]);
    expect(new Set(store.claimOrder).size).toBe(12);
  });

  it("stops claiming new batches once the time budget is spent", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      snapshot(`row-${index}`, "month", "2026-07", { userId: `user-${index}`, status: "pending" })
    );
    const store = new MemoryStore(rows);
    let elapsed = 0;
    const precompute = createOverviewPrecomputeRunner({
      store,
      aggregate: async () => {
        elapsed += 1_000;
        return payload();
      },
      clock: () => elapsed,
      timeBudgetMs: 4_000,
    });

    const result = await precompute.run({ now: NOW });

    // The batch in flight finishes; no new batch starts after the deadline.
    expect(result.claimed).toBe(5);
    expect(store.claimBatches).toHaveLength(1);
  });

  it("does not spin on a deferred finalization within one run", async () => {
    const ended = snapshot("ended", "month", "2026-06", { status: "pending" });
    const store = new MemoryStore([ended]);
    const { aggregate, runner: precompute } = runner(store);

    const result = await precompute.run({ now: NOW });

    expect(result).toMatchObject({ claimed: 1, deferredForLocation: 1 });
    expect(store.claimBatches).toEqual([["ended"], []]);
    expect(aggregate).not.toHaveBeenCalled();
    expect(ended.status).toBe("pending");
  });

  it("refreshes every active row in one run, then again on the next", async () => {
    const activeRows = ["a", "b", "c", "d", "e", "f"].map((id) =>
      snapshot(id, "month", "2026-07", {
        userId: `user-${id}`,
        updatedAt: new Date("2026-07-22T01:00:00.000Z"),
      })
    );
    const store = new MemoryStore(activeRows);
    const { runner: precompute } = runner(store);

    await precompute.run({ now: NOW });
    expect([...store.claimOrder].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);

    await precompute.run({ now: new Date("2026-07-22T03:05:00.000Z") });
    expect(store.claimOrder).toHaveLength(12);
  });

  it("seeds users in bounded pages", async () => {
    const userIds = Array.from(
      { length: PRECOMPUTE_USER_BATCH_LIMIT + 1 },
      (_, index) => `user-${String(index).padStart(3, "0")}`
    );
    const store = new MemoryStore([], userIds);
    // Seeding is what's under test: a zero budget runs exactly one claim batch
    // instead of computing all ~1,000 seeded snapshots (slow on CI hardware).
    const { runner: precompute } = runner(store, undefined, { timeBudgetMs: 0 });

    await precompute.run({ now: NOW });

    expect(store.userPageCalls).toBe(2);
    expect(store.seedBatchSizes).toEqual([PRECOMPUTE_USER_BATCH_LIMIT * 4, 4]);
  });

  it("refreshes active periods but leaves finalized current-version periods immutable", async () => {
    const oldComputedAt = new Date("2026-07-22T01:00:00Z");
    const active = snapshot("active", "month", "2026-07", { computedAt: oldComputedAt });
    const completed = snapshot("completed", "month", "2026-06", {
      computedAt: oldComputedAt,
      finalizedAt: new Date("2026-07-01T00:00:00Z"),
    });
    const store = new MemoryStore([active, completed]);
    const { runner: precompute } = runner(store);

    await precompute.run({ now: NOW });

    expect(active.computedAt).toEqual(NOW);
    expect(completed.computedAt).toEqual(oldComputedAt);
  });

  it("recomputes old versions while preserving their prior finalization", async () => {
    const finalizedAt = new Date("2026-07-01T00:00:00Z");
    const old = snapshot("old", "month", "2026-06", {
      computeVersion: 0,
      finalizedAt,
    });
    const store = new MemoryStore([old]);
    const { runner: precompute } = runner(store);

    await precompute.run({ now: NOW });

    expect(old.computeVersion).toBe(OVERVIEW_COMPUTE_VERSION);
    expect(old.finalizedAt).toEqual(finalizedAt);
  });

  it("defers finalization until the location window succeeds, then finalizes once", async () => {
    const ended = snapshot("ended", "month", "2026-06");
    const store = new MemoryStore([ended]);
    const { aggregate, runner: precompute } = runner(store);

    await expect(precompute.run({ now: NOW })).resolves.toMatchObject({
      deferredForLocation: 1,
      published: 0,
    });
    expect(aggregate).not.toHaveBeenCalled();
    expect(ended.finalizedAt).toBeNull();

    await precompute.run({
      now: NOW,
      completedLocationWindows: [{ userId: "user-1", completedThrough: "2026-06-30" }],
    });
    expect(ended.finalizedAt).toEqual(NOW);
    expect(aggregate).toHaveBeenCalledTimes(1);

    await precompute.run({
      now: new Date("2026-07-22T04:00:00Z"),
      completedLocationWindows: [{ userId: "user-1", completedThrough: "2026-06-30" }],
    });
    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it("never finalizes the rolling recent period", async () => {
    const recent = snapshot("recent", "recent", "2026-07-22");
    const store = new MemoryStore([recent]);
    const { runner: precompute } = runner(store);

    await precompute.run({ now: NOW });

    expect(recent.status).toBe("ready");
    expect(recent.finalizedAt).toBeNull();
  });

  it("recovers expired computing leases before claiming", async () => {
    const expired = snapshot("expired", "month", "2025-05", {
      status: "computing",
      leaseExpiresAt: new Date("2026-07-22T02:59:00Z"),
    });
    const store = new MemoryStore([expired]);
    const { runner: precompute } = runner(store);

    const result = await precompute.run({
      now: NOW,
      completedLocationWindows: [{ userId: "user-1", completedThrough: "2025-05-31" }],
    });

    expect(result.recovered).toBe(1);
    expect(expired.status).toBe("ready");
  });

  it("marks an expired exhausted lease failed instead of reclaiming it", async () => {
    const exhausted = snapshot("exhausted", "month", "2026-07", {
      status: "computing",
      attemptCount: PRECOMPUTE_MAX_ATTEMPTS,
      leaseExpiresAt: new Date("2026-07-22T02:59:00Z"),
    });
    const store = new MemoryStore([exhausted]);
    const { aggregate, runner: precompute } = runner(store);

    const result = await precompute.run({ now: NOW });

    expect(result).toMatchObject({ recovered: 1, claimed: 0 });
    expect(exhausted.status).toBe("failed");
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("does not let a stale worker publish after the row is reclaimed", async () => {
    let finishAggregate: ((value: PeriodAggregatePayload) => void) | undefined;
    const aggregateResult = new Promise<PeriodAggregatePayload>((resolve) => {
      finishAggregate = resolve;
    });
    const claimed = snapshot("claimed", "month", "2026-07");
    const store = new MemoryStore([claimed]);
    const precompute = createOverviewPrecomputeRunner({
      store,
      aggregate: async () => aggregateResult,
    });

    const running = precompute.run({ now: NOW });
    await vi.waitFor(() => expect(store.claimedIds).toEqual(["claimed"]));
    claimed.computeStartedAt = new Date("2026-07-22T03:00:30.000Z");
    claimed.updatedAt = claimed.computeStartedAt;
    finishAggregate?.(payload());

    await expect(running).resolves.toMatchObject({ published: 0, failed: 0 });
    expect(claimed.status).toBe("computing");
    expect(claimed.publication).toBeUndefined();
  });

  it("preserves partial envelopes, maps portfolio to assets, and blocks failed location finalization", async () => {
    const ended = snapshot("ended", "month", "2026-06");
    const store = new MemoryStore([ended]);
    const failedLocation = {
      data: null,
      status: "failed" as const,
      computedAt: NOW.toISOString(),
      computeVersion: 1,
      errorCode: "LOCATION_AGGREGATION_FAILED",
    };
    const periodPayload = payload({ location: failedLocation });
    const { runner: precompute } = runner(
      store,
      vi.fn(async () => periodPayload)
    );

    const result = await precompute.run({
      now: NOW,
      completedLocationWindows: [{ userId: "user-1", completedThrough: "2026-06-30" }],
    });

    expect(result.failed).toBe(1);
    expect(ended.status).toBe("failed");
    expect(ended.finalizedAt).toBeNull();
    expect(ended.publication?.payload.coding.status).toBe("ready");
    expect(toSnapshotDomainColumns(periodPayload)).toEqual({
      coding: periodPayload.coding,
      location: periodPayload.location,
      health: periodPayload.health,
      spending: periodPayload.spending,
      assets: periodPayload.portfolio,
    });
  });

  it("continues with the next user after one aggregate throws", async () => {
    const store = new MemoryStore([
      snapshot("one", "month", "2025-05", { userId: "user-1", status: "pending" }),
      snapshot("two", "month", "2025-05", { userId: "user-2", status: "pending" }),
    ]);
    const aggregate = vi.fn(async (input: { userId: string }) => {
      if (input.userId === "user-1") throw new Error("database unavailable");
      return payload();
    });
    const precompute = createOverviewPrecomputeRunner({ store, aggregate });

    const result = await precompute.run({
      now: NOW,
      completedLocationWindows: [
        { userId: "user-1", completedThrough: "2025-05-31" },
        { userId: "user-2", completedThrough: "2025-05-31" },
      ],
    });

    expect(result).toMatchObject({ failed: 1, published: 1 });
    expect(store.snapshots.map((item) => item.status)).toEqual(["failed", "ready"]);
  });

  it("returns immediately on re-entry while a run is active", async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = new MemoryStore([snapshot("active", "month", "2026-07")]);
    const precompute = createOverviewPrecomputeRunner({
      store,
      aggregate: async () => {
        await wait;
        return payload();
      },
    });

    const first = precompute.run({ now: NOW });
    await vi.waitFor(() => expect(store.claimedIds).toEqual(["active"]));
    await expect(precompute.run({ now: NOW })).resolves.toMatchObject({ skipped: true });
    release?.();
    await first;
  });
});

describe("database precompute store SQL", () => {
  // Postgres rejects `UPDATE t SET "t"."col" = ...` ("SET target columns cannot
  // be qualified with the relation name"). Drizzle renders a Column inside a
  // sql`` template as "table"."column", so interpolating one on the left side
  // of SET produces a statement that fails at runtime on every call.
  const QUALIFIED_SET_TARGET = /(?:set|,)\s*"period_snapshots"\."[a-z_]+"\s*=/i;

  // pg-proxy renders statements through the real Postgres dialect without
  // opening a connection, so it exercises both raw sql`` and query-builder paths.
  function renderExecutedSql(run: (db: Database) => Promise<unknown>) {
    const statements: string[] = [];
    const params: unknown[][] = [];
    const db = drizzle(async (statement: string, values: unknown[]) => {
      statements.push(statement);
      params.push(values);
      return { rows: [] };
    }) as unknown as Database;
    return run(db).then(() => ({ statements, params }));
  }

  const claim = (db: Database) =>
    createDatabasePrecomputeStore(db).claimSnapshots({
      now: NOW,
      leaseExpiresAt: LEASE_EXPIRES_AT,
      activePeriods: [{ periodType: "recent", periodKey: "2026-07-22" }],
      computeVersion: OVERVIEW_COMPUTE_VERSION,
      maxAttempts: PRECOMPUTE_MAX_ATTEMPTS,
      limit: 5,
    });

  it("does not qualify SET targets when recovering expired leases", async () => {
    const { statements } = await renderExecutedSql((db) =>
      createDatabasePrecomputeStore(db).recoverExpiredLeases(NOW, PRECOMPUTE_MAX_ATTEMPTS)
    );

    expect(statements[0]).toMatch(/update\s+"period_snapshots"/i);
    expect(statements[0]).not.toMatch(QUALIFIED_SET_TARGET);
  });

  it("does not qualify SET targets when claiming snapshots", async () => {
    const { statements } = await renderExecutedSql(claim);

    expect(statements[0]).toMatch(/update\s+"period_snapshots"/i);
    expect(statements[0]).not.toMatch(QUALIFIED_SET_TARGET);
  });

  // A Date interpolated into a raw sql`` template reaches node-postgres as a
  // Date and serializes in the process timezone (KST in production), while the
  // query builder writes UTC wall time. Claiming wrote KST timestamps that the
  // builder-based publish/release/fail guards then failed to match, so claimed
  // snapshots never published and leases never looked expired.
  // The mirror of the write path: a raw RETURNING bypasses Drizzle's read
  // mapping, so node-postgres parses the naive timestamp in the process
  // timezone. The resulting Date fed back into publishSnapshot's optimistic
  // lock then missed the stored row by the local offset and every claimed
  // snapshot was discarded as stale.
  it("reads claim timestamps back as the UTC wall time they were stored in", async () => {
    // node-postgres hands back { rows }, with naive timestamps as raw strings.
    const db = {
      execute: async () => ({
        rows: [
          {
            id: "snapshot-1",
            userId: "user-1",
            periodType: "recent",
            periodKey: "2026-07-22",
            status: "computing",
            attemptCount: 1,
            computeVersion: OVERVIEW_COMPUTE_VERSION,
            finalizedAt: null,
            computeStartedAt: "2026-07-26 16:40:00.083",
          },
        ],
      }),
    } as unknown as Database;

    const [claimed] = await claim(db);

    expect(claimed.computeStartedAt.toISOString()).toBe("2026-07-26T16:40:00.083Z");
  });

  it("writes claim timestamps in the same UTC wall time the query builder uses", async () => {
    const { params } = await renderExecutedSql(claim);

    for (const value of [NOW, LEASE_EXPIRES_AT]) {
      const mapped = periodSnapshots.computeStartedAt.mapToDriverValue(value) as string;
      expect(mapped).toBe(value.toISOString());
      expect(params[0]).toContain(mapped);
      // A bare Date would reach the driver and serialize in the process timezone.
      expect(params[0]).not.toContainEqual(value);
    }
  });
});
