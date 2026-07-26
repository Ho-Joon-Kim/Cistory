import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { type PeriodSnapshotStatus, type PeriodType, periodSnapshots, users } from "@/db/schema";
import { timestampFromDriver, timestampParam } from "@/db/sql";
import { toLocalDateString } from "@/lib/utils";
import { aggregatePeriod } from "./aggregate";
import { resultRows } from "./aggregate/query-values";
import { getPeriodKey, getPeriodRange, isPeriodActive, periodTypes } from "./period";
import type { PeriodAggregateInput, PeriodAggregatePayload } from "./types";

export const OVERVIEW_COMPUTE_VERSION = 1;
export const PRECOMPUTE_CLAIM_LIMIT = 5;
export const PRECOMPUTE_MAX_ATTEMPTS = 3;
export const PRECOMPUTE_USER_BATCH_LIMIT = 250;
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
  computeStartedAt: Date;
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
  recoverExpiredLeases(now: Date, maxAttempts: number): Promise<number>;
  listUserIdsPage(afterUserId: string | null, limit: number): Promise<string[]>;
  seedActivePeriods(seeds: ActivePeriodSeed[], now: Date): Promise<void>;
  claimSnapshots(options: {
    now: Date;
    leaseExpiresAt: Date;
    activePeriods: Pick<ActivePeriodSeed, "periodType" | "periodKey">[];
    computeVersion: number;
    maxAttempts: number;
    limit: number;
  }): Promise<PrecomputeSnapshot[]>;
  publishSnapshot(snapshot: PrecomputeSnapshot, publication: SnapshotPublication): Promise<boolean>;
  releaseSnapshot(snapshot: PrecomputeSnapshot): Promise<boolean>;
  failSnapshot(snapshot: PrecomputeSnapshot, error: string, now: Date): Promise<boolean>;
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
  if (snapshot.status === "pending") return 0;
  if (
    activePeriods.some(
      (active) =>
        active.periodType === snapshot.periodType && active.periodKey === snapshot.periodKey
    )
  ) {
    return 1;
  }
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

type SnapshotOutcome = "published" | "failed" | "deferred" | "stale";

function createSnapshotPublication(
  snapshot: PrecomputeSnapshot,
  payload: PeriodAggregatePayload,
  now: Date,
  needsFinalization: boolean
): SnapshotPublication {
  const completedLocationFailed = needsFinalization && payload.location.status === "failed";
  const finalizedAt =
    snapshot.periodType === "recent"
      ? null
      : (snapshot.finalizedAt ?? (needsFinalization && !completedLocationFailed ? now : null));
  return {
    status: completedLocationFailed ? "failed" : "ready",
    payload,
    computedAt: now,
    finalizedAt,
    computeVersion: OVERVIEW_COMPUTE_VERSION,
    lastError: completedLocationFailed ? "LOCATION_AGGREGATION_FAILED" : null,
  };
}

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
    return (await dependencies.store.releaseSnapshot(snapshot)) ? "deferred" : "stale";
  }

  try {
    const payload = await dependencies.aggregate({
      userId: snapshot.userId,
      periodType: snapshot.periodType,
      periodKey: snapshot.periodKey,
      computedAt: now,
      computeVersion: OVERVIEW_COMPUTE_VERSION,
    });
    const publication = createSnapshotPublication(snapshot, payload, now, needsFinalization);
    const published = await dependencies.store.publishSnapshot(snapshot, publication);
    if (!published) return "stale";
    return publication.status === "failed" ? "failed" : "published";
  } catch (error) {
    const failed = await dependencies.store.failSnapshot(
      snapshot,
      error instanceof Error ? error.message : String(error),
      now
    );
    return failed ? "failed" : "stale";
  }
}

export async function runPrecomputeTick(
  dependencies: OverviewPrecomputeDependencies,
  options: PrecomputeRunOptions = {}
): Promise<PrecomputeRunResult> {
  const now = options.now ?? new Date();
  const activePeriods = activePeriodsAt(now);
  const recovered = await dependencies.store.recoverExpiredLeases(now, PRECOMPUTE_MAX_ATTEMPTS);
  let afterUserId: string | null = null;
  while (true) {
    const userIds = await dependencies.store.listUserIdsPage(
      afterUserId,
      PRECOMPUTE_USER_BATCH_LIMIT
    );
    if (userIds.length === 0) break;
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
    afterUserId = userIds.at(-1) ?? null;
    if (userIds.length < PRECOMPUTE_USER_BATCH_LIMIT) break;
  }

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

/**
 * Postgres rejects `UPDATE t SET "t"."col" = ...` ("SET target columns cannot be
 * qualified with the relation name"), but Drizzle renders an interpolated Column
 * inside a sql`` template as `"table"."column"`. Raw UPDATE statements must use
 * the bare column identifier on the left side of SET. Reading a column on the
 * right side, in WHERE, or in RETURNING is fine qualified.
 */
function setTarget(column: { name: string }) {
  return sql.identifier(column.name);
}

export function createDatabasePrecomputeStore(db: Database): PrecomputeStore {
  return {
    async recoverExpiredLeases(now, maxAttempts) {
      const recovered = await db
        .update(periodSnapshots)
        .set({
          status: sql`CASE
            WHEN ${periodSnapshots.attemptCount} >= ${maxAttempts} THEN 'failed'
            ELSE 'pending'
          END`,
          computeStartedAt: null,
          leaseExpiresAt: null,
          lastError: sql`CASE
            WHEN ${periodSnapshots.attemptCount} >= ${maxAttempts}
              THEN 'COMPUTE_LEASE_EXPIRED'
            ELSE ${periodSnapshots.lastError}
          END`,
          updatedAt: now,
        })
        .where(
          and(eq(periodSnapshots.status, "computing"), lte(periodSnapshots.leaseExpiresAt, now))
        )
        .returning({ id: periodSnapshots.id });
      return recovered.length;
    },

    async listUserIdsPage(afterUserId, limit) {
      const query = db.select({ id: users.id }).from(users);
      const rows = await (afterUserId ? query.where(gt(users.id, afterUserId)) : query)
        .orderBy(asc(users.id))
        .limit(limit);
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
            AND ${periodSnapshots.attemptCount} < ${options.maxAttempts}
            AND (
              (${activePredicate})
              OR ${periodSnapshots.status} IN ('pending', 'failed')
              OR (${periodSnapshots.periodType} <> 'recent' AND ${periodSnapshots.finalizedAt} IS NULL)
              OR ${periodSnapshots.computeVersion} < ${options.computeVersion}
            )
          ORDER BY
            CASE
              WHEN ${periodSnapshots.status} = 'pending' THEN 0
              WHEN (${activePredicate}) THEN 1
              WHEN ${periodSnapshots.periodType} <> 'recent' AND ${periodSnapshots.finalizedAt} IS NULL THEN 2
              WHEN ${periodSnapshots.computeVersion} < ${options.computeVersion} THEN 3
              ELSE 4
            END,
            ${periodSnapshots.updatedAt} ASC,
            ${periodSnapshots.id}
          FOR UPDATE SKIP LOCKED
          LIMIT ${options.limit}
        )
        UPDATE ${periodSnapshots}
        SET ${setTarget(periodSnapshots.status)} = 'computing',
          ${setTarget(periodSnapshots.computeStartedAt)} = ${timestampParam(periodSnapshots.computeStartedAt, options.now)},
          ${setTarget(periodSnapshots.leaseExpiresAt)} = ${timestampParam(periodSnapshots.leaseExpiresAt, options.leaseExpiresAt)},
          ${setTarget(periodSnapshots.attemptCount)} = ${periodSnapshots.attemptCount} + 1,
          ${setTarget(periodSnapshots.updatedAt)} = ${timestampParam(periodSnapshots.updatedAt, options.now)}
        FROM candidates
        WHERE ${periodSnapshots.id} = candidates.id
        RETURNING ${periodSnapshots.id} AS id, ${periodSnapshots.userId} AS "userId",
          ${periodSnapshots.periodType} AS "periodType",
          ${periodSnapshots.periodKey} AS "periodKey",
          ${periodSnapshots.status} AS status,
          ${periodSnapshots.attemptCount} AS "attemptCount",
          ${periodSnapshots.computeVersion} AS "computeVersion",
          ${periodSnapshots.finalizedAt} AS "finalizedAt",
          ${periodSnapshots.computeStartedAt} AS "computeStartedAt"
      `);
      return resultRows(result).map((row) => ({
        id: String(row.id),
        userId: String(row.userId),
        periodType: row.periodType as PeriodType,
        periodKey: String(row.periodKey),
        status: row.status as PeriodSnapshotStatus,
        attemptCount: Number(row.attemptCount),
        computeVersion: Number(row.computeVersion),
        finalizedAt:
          row.finalizedAt == null
            ? null
            : timestampFromDriver(periodSnapshots.finalizedAt, row.finalizedAt),
        computeStartedAt: timestampFromDriver(
          periodSnapshots.computeStartedAt,
          row.computeStartedAt
        ),
      }));
    },

    async publishSnapshot(snapshot, publication) {
      return db.transaction(async (tx) => {
        const domains = toSnapshotDomainColumns(publication.payload);
        const updated = await tx
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
          .where(
            and(
              eq(periodSnapshots.id, snapshot.id),
              eq(periodSnapshots.status, "computing"),
              eq(periodSnapshots.computeStartedAt, snapshot.computeStartedAt)
            )
          )
          .returning({ id: periodSnapshots.id });
        return updated.length === 1;
      });
    },

    async releaseSnapshot(snapshot) {
      const updated = await db
        .update(periodSnapshots)
        .set({
          status: "pending",
          computeStartedAt: null,
          leaseExpiresAt: null,
          attemptCount: Math.max(0, snapshot.attemptCount - 1),
        })
        .where(
          and(
            eq(periodSnapshots.id, snapshot.id),
            eq(periodSnapshots.status, "computing"),
            eq(periodSnapshots.computeStartedAt, snapshot.computeStartedAt)
          )
        )
        .returning({ id: periodSnapshots.id });
      return updated.length === 1;
    },

    async failSnapshot(snapshot, error, now) {
      const updated = await db
        .update(periodSnapshots)
        .set({
          status: "failed",
          computeStartedAt: null,
          leaseExpiresAt: null,
          lastError: error.slice(0, 1_000),
          updatedAt: now,
        })
        .where(
          and(
            eq(periodSnapshots.id, snapshot.id),
            eq(periodSnapshots.status, "computing"),
            eq(periodSnapshots.computeStartedAt, snapshot.computeStartedAt)
          )
        )
        .returning({ id: periodSnapshots.id });
      return updated.length === 1;
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
