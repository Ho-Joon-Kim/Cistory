process.env.TZ = "Asia/Seoul";

import { describe, expect, it, vi } from "vitest";
import type { PeriodType } from "@/db/schema";
import {
  type ActivePeriodSeed,
  createOverviewPrecomputeRunner,
  getClaimPriority,
  OVERVIEW_COMPUTE_VERSION,
  type PrecomputeSnapshot,
  type PrecomputeStore,
  type SnapshotPublication,
  toSnapshotDomainColumns,
} from "./precompute";
import type { PeriodAggregatePayload, PeriodDomainEnvelope } from "./types";

const NOW = new Date("2026-07-22T03:00:00.000Z");

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
    leaseExpiresAt: null,
    computedAt: new Date("2026-07-22T02:00:00.000Z"),
    ...overrides,
  };
}

class MemoryStore implements PrecomputeStore {
  readonly snapshots: SnapshotState[];
  readonly userIds: string[];
  claimedIds: string[] = [];

  constructor(snapshots: SnapshotState[] = [], userIds: string[] = []) {
    this.snapshots = snapshots;
    this.userIds = userIds;
  }

  async recoverExpiredLeases(now: Date) {
    let recovered = 0;
    for (const item of this.snapshots) {
      if (
        item.status === "computing" &&
        item.leaseExpiresAt !== null &&
        item.leaseExpiresAt <= now
      ) {
        item.status = "pending";
        item.leaseExpiresAt = null;
        recovered += 1;
      }
    }
    return recovered;
  }

  async listUserIds() {
    return this.userIds;
  }

  async seedActivePeriods(seeds: ActivePeriodSeed[]) {
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
    const eligible = this.snapshots
      .filter(
        (item) =>
          item.status !== "computing" &&
          (item.status !== "failed" || item.attemptCount < options.maxAttempts) &&
          (getClaimPriority(item, options.activePeriods, options.computeVersion) < 4 ||
            item.status === "failed")
      )
      .sort(
        (a, b) =>
          getClaimPriority(a, options.activePeriods, options.computeVersion) -
            getClaimPriority(b, options.activePeriods, options.computeVersion) ||
          a.id.localeCompare(b.id)
      )
      .slice(0, options.limit);
    for (const item of eligible) {
      item.status = "computing";
      item.attemptCount += 1;
      item.leaseExpiresAt = options.leaseExpiresAt;
    }
    this.claimedIds = eligible.map((item) => item.id);
    return eligible;
  }

  async publishSnapshot(item: PrecomputeSnapshot, publication: SnapshotPublication) {
    const stored = this.snapshots.find((candidate) => candidate.id === item.id);
    if (!stored) throw new Error("missing snapshot");
    stored.status = publication.status;
    stored.computedAt = publication.computedAt;
    stored.computeVersion = publication.computeVersion;
    stored.finalizedAt = publication.finalizedAt;
    stored.attemptCount = publication.status === "ready" ? 0 : stored.attemptCount;
    stored.leaseExpiresAt = null;
    stored.publication = publication;
  }

  async releaseSnapshot(item: PrecomputeSnapshot) {
    const stored = this.snapshots.find((candidate) => candidate.id === item.id);
    if (!stored) throw new Error("missing snapshot");
    stored.status = "pending";
    stored.attemptCount = Math.max(0, stored.attemptCount - 1);
    stored.leaseExpiresAt = null;
  }

  async failSnapshot(item: PrecomputeSnapshot) {
    const stored = this.snapshots.find((candidate) => candidate.id === item.id);
    if (!stored) throw new Error("missing snapshot");
    stored.status = "failed";
    stored.leaseExpiresAt = null;
  }
}

function runner(store: MemoryStore, aggregate = vi.fn(async () => payload())) {
  return { aggregate, runner: createOverviewPrecomputeRunner({ store, aggregate }) };
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

  it("claims at most five in active, pending, unfinalized, version order", async () => {
    const store = new MemoryStore([
      snapshot("d-version", "month", "2025-01", {
        finalizedAt: new Date("2025-02-01T00:00:00Z"),
        computeVersion: 0,
      }),
      snapshot("c-unfinalized", "month", "2026-06"),
      snapshot("b-pending", "month", "2025-05", { status: "pending" }),
      snapshot("a-active", "month", "2026-07", { finalizedAt: null }),
      snapshot("e-version", "year", "2024", {
        finalizedAt: new Date("2025-01-01T00:00:00Z"),
        computeVersion: 0,
      }),
      snapshot("f-version", "year", "2023", {
        finalizedAt: new Date("2024-01-01T00:00:00Z"),
        computeVersion: 0,
      }),
    ]);
    const { runner: precompute } = runner(store);

    await precompute.run({
      now: NOW,
      completedLocationWindows: [{ userId: "user-1", completedThrough: "2026-06-30" }],
    });

    expect(store.claimedIds).toEqual([
      "a-active",
      "b-pending",
      "c-unfinalized",
      "d-version",
      "e-version",
    ]);
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
