import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { type PeriodSnapshotStatus, type PeriodType, periodSnapshots, users } from "@/db/schema";
import { toLocalDateString } from "@/lib/utils";
import { aggregatePeriod } from "./aggregate";
import { getPeriodKey, getPeriodRange, isPeriodActive, periodTypes } from "./period";
import type { PeriodAggregateInput, PeriodAggregatePayload } from "./types";

export const OVERVIEW_COMPUTE_VERSION = 1;
export const PRECOMPUTE_CLAIM_LIMIT = 5;
export const PRECOMPUTE_MAX_ATTEMPTS = 3;
const LEASE_DURATION_MS = 10 * 60 * 1000;

export interface PrecomputeSnapshot {
  id: string;
  userId: string;
  periodType: PeriodType;
  periodKey: string;
  status: PeriodSnapshotStatus;
  attemptCount: number;
  computeVersion: number;
  finalizedAt: Date | null;
}

export interface ActivePeriodSeed {
  userId: string;
  periodType: PeriodType;
  periodKey: string;
  computeVersion: number;
}

export interface LocationCompletedWindow {
  userId: string;
  /** Latest fully persisted KST day, inclusive (`YYYY-MM-DD`). */
  completedThrough: string;
}

export interface SnapshotPublication {
  status: "ready" | "failed";
  payload: PeriodAggregatePayload;
  computedAt: Date;
  finalizedAt: Date | null;
  computeVersion: number;
  lastError: string | null;
}

export interface PrecomputeStore {
  recoverExpiredLeases(now: Date): Promise<number>;
  listUserIds(): Promise<string[]>;
  seedActivePeriods(seeds: ActivePeriodSeed[], now: Date): Promise<void>;
  claimSnapshots(options: {
    now: Date;
    leaseExpiresAt: Date;
    activePeriods: Pick<ActivePeriodSeed, "periodType" | "periodKey">[];
    computeVersion: number;
    maxAttempts: number;
    limit: number;
  }): Promise<PrecomputeSnapshot[]>;
  publishSnapshot(snapshot: PrecomputeSnapshot, publication: SnapshotPublication): Promise<void>;
  releaseSnapshot(snapshot: PrecomputeSnapshot): Promise<void>;
  failSnapshot(snapshot: PrecomputeSnapshot, error: string, now: Date): Promise<void>;
}

export interface PrecomputeRunOptions {
  now?: Date;
  completedLocationWindows?: LocationCompletedWindow[];
}

export interface PrecomputeRunResult {
  skipped: boolean;
  recovered: number;
  claimed: number;
  published: number;
  failed: number;
  deferredForLocation: number;
}

export interface OverviewPrecomputeDependencies {
  store: PrecomputeStore;
  aggregate(input: PeriodAggregateInput): Promise<PeriodAggregatePayload>;
}

export function toSnapshotDomainColumns(payload: PeriodAggregatePayload) {
  return {
    coding: payload.coding,
    location: payload.location,
    health: payload.health,
    spending: payload.spending,
    assets: payload.portfolio,
  };
}

function activePeriodsAt(now: Date) {
  return periodTypes.map((periodType) => ({
    periodType,
    periodKey: getPeriodKey(periodType, now),
  }));
}

export function getClaimPriority(
  snapshot: PrecomputeSnapshot,
  activePeriods: Pick<ActivePeriodSeed, "periodType" | "periodKey">[],
  computeVersion: number
): number {
  if (
    activePeriods.some(
      (active) =>
        active.periodType === snapshot.periodType && active.periodKey === snapshot.periodKey
    )
  ) {
    return 0;
  }
  if (snapshot.status === "pending") return 1;
  if (snapshot.periodType !== "recent" && snapshot.finalizedAt === null) return 2;
  if (snapshot.computeVersion < computeVersion) return 3;
  return 4;
}

function isCompletedLocationWindow(
  snapshot: PrecomputeSnapshot,
  completed: Map<string, string>
): boolean {
  const range = getPeriodRange(snapshot.periodType, snapshot.periodKey);
  const lastDay = toLocalDateString(new Date(range.toExclusive.getTime() - 1));
  return (completed.get(snapshot.userId) ?? "") >= lastDay;
}

export function createOverviewPrecomputeRunner(dependencies: OverviewPrecomputeDependencies) {
  let running = false;

  return {
    async run(options: PrecomputeRunOptions = {}): Promise<PrecomputeRunResult> {
      if (running) {
        return {
          skipped: true,
          recovered: 0,
          claimed: 0,
          published: 0,
          failed: 0,
          deferredForLocation: 0,
        };
      }

      running = true;
      try {
        return await runPrecomputeTick(dependencies, options);
      } finally {
        running = false;
      }
    },
  };
}

type SnapshotOutcome = "published" | "failed" | "deferred";

async function processClaimedSnapshot(
  dependencies: OverviewPrecomputeDependencies,
  snapshot: PrecomputeSnapshot,
  now: Date,
  completed: Map<string, string>
): Promise<SnapshotOutcome> {
  const active = isPeriodActive(snapshot.periodType, snapshot.periodKey, now);
  const needsFinalization =
    snapshot.periodType !== "recent" && !active && snapshot.finalizedAt === null;
  if (needsFinalization && !isCompletedLocationWindow(snapshot, completed)) {
    await dependencies.store.releaseSnapshot(snapshot);
    return "deferred";
  }

  try {
    const payload = await dependencies.aggregate({
      userId: snapshot.userId,
      periodType: snapshot.periodType,
      periodKey: snapshot.periodKey,
      computedAt: now,
      computeVersion: OVERVIEW_COMPUTE_VERSION,
    });
    const completedLocationFailed = needsFinalization && payload.location.status === "failed";
    await dependencies.store.publishSnapshot(snapshot, {
      status: completedLocationFailed ? "failed" : "ready",
      payload,
      computedAt: now,
      finalizedAt:
        snapshot.periodType === "recent"
          ? null
          : (snapshot.finalizedAt ?? (needsFinalization && !completedLocationFailed ? now : null)),
      computeVersion: OVERVIEW_COMPUTE_VERSION,
      lastError: completedLocationFailed ? "LOCATION_AGGREGATION_FAILED" : null,
    });
    return completedLocationFailed ? "failed" : "published";
  } catch (error) {
    await dependencies.store.failSnapshot(
      snapshot,
      error instanceof Error ? error.message : String(error),
      now
    );
    return "failed";
  }
}

export async function runPrecomputeTick(
  dependencies: OverviewPrecomputeDependencies,
  options: PrecomputeRunOptions = {}
): Promise<PrecomputeRunResult> {
  const now = options.now ?? new Date();
  const activePeriods = activePeriodsAt(now);
  const recovered = await dependencies.store.recoverExpiredLeases(now);
  const userIds = await dependencies.store.listUserIds();
  await dependencies.store.seedActivePeriods(
    userIds.flatMap((userId) =>
      activePeriods.map((period) => ({
        userId,
        ...period,
        computeVersion: OVERVIEW_COMPUTE_VERSION,
      }))
    ),
    now
  );

  const claimed = await dependencies.store.claimSnapshots({
    now,
    leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
    activePeriods,
    computeVersion: OVERVIEW_COMPUTE_VERSION,
    maxAttempts: PRECOMPUTE_MAX_ATTEMPTS,
    limit: PRECOMPUTE_CLAIM_LIMIT,
  });
  const completed = new Map(
    (options.completedLocationWindows ?? []).map((window) => [
      window.userId,
      window.completedThrough,
    ])
  );
  let published = 0;
  let failed = 0;
  let deferredForLocation = 0;

  for (const snapshot of claimed) {
    const outcome = await processClaimedSnapshot(dependencies, snapshot, now, completed);
    if (outcome === "published") published += 1;
    if (outcome === "failed") failed += 1;
    if (outcome === "deferred") deferredForLocation += 1;
  }

  return {
    skipped: false,
    recovered,
    claimed: claimed.length,
    published,
    failed,
    deferredForLocation,
  };
}

function resultRows(result: unknown): Record<string, unknown>[] {
  const value = result as { rows?: unknown[] } | null;
  return Array.isArray(value?.rows) ? (value.rows as Record<string, unknown>[]) : [];
}

export function createDatabasePrecomputeStore(db: Database): PrecomputeStore {
  return {
    async recoverExpiredLeases(now) {
      const result = await db.execute(sql`
        UPDATE ${periodSnapshots}
        SET ${periodSnapshots.status} = 'pending',
          ${periodSnapshots.computeStartedAt} = NULL,
          ${periodSnapshots.leaseExpiresAt} = NULL,
          ${periodSnapshots.updatedAt} = ${now}
        WHERE ${periodSnapshots.status} = 'computing'
          AND ${periodSnapshots.leaseExpiresAt} <= ${now}
        RETURNING ${periodSnapshots.id}
      `);
      return resultRows(result).length;
    },

    async listUserIds() {
      const rows = await db.select({ id: users.id }).from(users);
      return rows.map((user) => user.id);
    },

    async seedActivePeriods(seeds, now) {
      if (seeds.length === 0) return;
      await db
        .insert(periodSnapshots)
        .values(seeds.map((seed) => ({ ...seed, status: "pending" as const, updatedAt: now })))
        .onConflictDoNothing();
    },

    async claimSnapshots(options) {
      const activePredicate = sql.join(
        options.activePeriods.map(
          (active) =>
            sql`(${periodSnapshots.periodType} = ${active.periodType} AND ${periodSnapshots.periodKey} = ${active.periodKey})`
        ),
        sql` OR `
      );
      const result = await db.execute(sql`
        WITH candidates AS (
          SELECT ${periodSnapshots.id}
          FROM ${periodSnapshots}
          WHERE ${periodSnapshots.status} <> 'computing'
            AND (${periodSnapshots.status} <> 'failed' OR ${periodSnapshots.attemptCount} < ${options.maxAttempts})
            AND (
              (${activePredicate})
              OR ${periodSnapshots.status} IN ('pending', 'failed')
              OR (${periodSnapshots.periodType} <> 'recent' AND ${periodSnapshots.finalizedAt} IS NULL)
              OR ${periodSnapshots.computeVersion} < ${options.computeVersion}
            )
          ORDER BY
            CASE
              WHEN (${activePredicate}) THEN 0
              WHEN ${periodSnapshots.status} = 'pending' THEN 1
              WHEN ${periodSnapshots.periodType} <> 'recent' AND ${periodSnapshots.finalizedAt} IS NULL THEN 2
              WHEN ${periodSnapshots.computeVersion} < ${options.computeVersion} THEN 3
              ELSE 4
            END,
            ${periodSnapshots.updatedAt} DESC,
            ${periodSnapshots.id}
          FOR UPDATE SKIP LOCKED
          LIMIT ${options.limit}
        )
        UPDATE ${periodSnapshots}
        SET ${periodSnapshots.status} = 'computing',
          ${periodSnapshots.computeStartedAt} = ${options.now},
          ${periodSnapshots.leaseExpiresAt} = ${options.leaseExpiresAt},
          ${periodSnapshots.attemptCount} = ${periodSnapshots.attemptCount} + 1,
          ${periodSnapshots.updatedAt} = ${options.now}
        FROM candidates
        WHERE ${periodSnapshots.id} = candidates.id
        RETURNING ${periodSnapshots.id} AS id, ${periodSnapshots.userId} AS "userId",
          ${periodSnapshots.periodType} AS "periodType",
          ${periodSnapshots.periodKey} AS "periodKey",
          ${periodSnapshots.status} AS status,
          ${periodSnapshots.attemptCount} AS "attemptCount",
          ${periodSnapshots.computeVersion} AS "computeVersion",
          ${periodSnapshots.finalizedAt} AS "finalizedAt"
      `);
      return resultRows(result).map((row) => ({
        id: String(row.id),
        userId: String(row.userId),
        periodType: row.periodType as PeriodType,
        periodKey: String(row.periodKey),
        status: row.status as PeriodSnapshotStatus,
        attemptCount: Number(row.attemptCount),
        computeVersion: Number(row.computeVersion),
        finalizedAt: row.finalizedAt == null ? null : new Date(row.finalizedAt as string | Date),
      }));
    },

    async publishSnapshot(snapshot, publication) {
      await db.transaction(async (tx) => {
        const domains = toSnapshotDomainColumns(publication.payload);
        await tx
          .update(periodSnapshots)
          .set({
            status: publication.status,
            ...domains,
            computeStartedAt: null,
            leaseExpiresAt: null,
            attemptCount: publication.status === "ready" ? 0 : snapshot.attemptCount,
            lastError: publication.lastError,
            finalizedAt: publication.finalizedAt,
            computeVersion: publication.computeVersion,
            updatedAt: publication.computedAt,
          })
          .where(and(eq(periodSnapshots.id, snapshot.id), eq(periodSnapshots.status, "computing")));
      });
    },

    async releaseSnapshot(snapshot) {
      await db
        .update(periodSnapshots)
        .set({
          status: "pending",
          computeStartedAt: null,
          leaseExpiresAt: null,
          attemptCount: Math.max(0, snapshot.attemptCount - 1),
        })
        .where(and(eq(periodSnapshots.id, snapshot.id), eq(periodSnapshots.status, "computing")));
    },

    async failSnapshot(snapshot, error, now) {
      await db
        .update(periodSnapshots)
        .set({
          status: "failed",
          computeStartedAt: null,
          leaseExpiresAt: null,
          lastError: error.slice(0, 1_000),
          updatedAt: now,
        })
        .where(and(eq(periodSnapshots.id, snapshot.id), eq(periodSnapshots.status, "computing")));
    },
  };
}

let productionRunner: ReturnType<typeof createOverviewPrecomputeRunner> | null = null;

export async function runOverviewPrecompute(
  db: Database,
  options: PrecomputeRunOptions = {}
): Promise<PrecomputeRunResult> {
  productionRunner ??= createOverviewPrecomputeRunner({
    store: createDatabasePrecomputeStore(db),
    aggregate: (input) => aggregatePeriod(db, input),
  });
  return productionRunner.run(options);
}
