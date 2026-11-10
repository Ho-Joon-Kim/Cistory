import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { type PeriodSnapshotStatus, type PeriodType, periodSnapshots, users } from "@/db/schema";
import { timestampFromDriver, timestampParam } from "@/db/sql";
import { toLocalDateString } from "@/lib/utils";
import { aggregatePeriod } from "./aggregate";
import { resultRows } from "./aggregate/query-values";
import { getPeriodKey, getPeriodRange, isPeriodActive, periodTypes } from "./period";
import type { PeriodAggregateInput, PeriodAggregatePayload } from "./types";

// Bump whenever aggregation semantics change so finalized snapshots recompute
// instead of freezing stale numbers. v2 (2026-08): fix/track-splitting-stay-detection
// changed what a `tracks` row means (movement-only, split at stays instead of a
// single 24h-per-day track), which aggregate/location.ts sums directly. v3
// (2026-08): fix/geocoding-region-fields changed `visits.city`/`country_name`
// from address-string-split fragments (postal codes, building names) to the
// geocoding adapters' structured region/country fields, which
// aggregate/location.ts's `visitedRegions` reads directly. v4 (2026-10):
// fix/toss-transfer-parsing changed spending's `bucketSql` (pooled-account
// deposits count only the user's own unmirrored ones; cancelled payments drop
// out), which aggregate/spending.ts classifies with. v5 (2026-11): portfolio
// `twr.annualizedReturn` is null for windows under MIN_ANNUALIZE_DAYS (365) —
// a 30-day −2.7% had been stored as a "연환산" −28.1% the narrative could quote;
// aggregate/health.ts reads sleep from deduped sessions, reports steps/sleep
// stats per day rather than per sample, skips weight-less body rows; and
// coding, spending and health body windows were bound as bare JS Dates, which
// Postgres read 9h late against the UTC-wall columns — every snapshot dropped
// 00:00-09:00 KST of its first day and took 00:00-09:00 KST of the day after it.
export const OVERVIEW_COMPUTE_VERSION = 5;
/** Rows claimed per lease batch. Small, so a batch finishes far inside its lease. */
export const PRECOMPUTE_CLAIM_LIMIT = 5;
/**
 * Wall-clock budget for one run: keep claiming batches until it is spent or the
 * queue is empty. One compute measured 0.5 s (week/month) to 2 s (year) against
 * the dev DB over Tailscale, so a 3-minute budget clears ~100+ snapshots per run
 * — a bulk invalidation (a whole history recovery marks ~40 pending) drains in
 * one tick instead of eight. It stays well under the 5-minute schedule, and the
 * in-process single-flight guard plus DB leases keep runs from overlapping.
 */
export const PRECOMPUTE_TIME_BUDGET_MS = 3 * 60 * 1000;
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
    /** Rows already claimed earlier in this run, never reclaimed by it. */
    excludeIds?: string[];
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
  /** Monotonic-enough ms clock for the run's time budget. Default `Date.now`. */
  clock?: () => number;
  timeBudgetMs?: number;
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

function isActiveSnapshot(
  snapshot: Pick<PrecomputeSnapshot, "periodType" | "periodKey">,
  activePeriods: Pick<ActivePeriodSeed, "periodType" | "periodKey">[]
) {
  return activePeriods.some(
    (active) => active.periodType === snapshot.periodType && active.periodKey === snapshot.periodKey
  );
}

/**
 * Claim tier, lowest first — mirrors the `ORDER BY` CASE in `claimSnapshots`:
 *   0  a current period that needs work (pending/failed/old version) — what the
 *      page shows by default, so it never waits behind a backlog
 *   1  any other pending/failed period the page can show (week/month/year)
 *   2  an ended period awaiting finalization (an active one is never finalized)
 *   3  an old compute version
 *   4  routine refresh of an already-ready current period
 *   5  everything else (old rolling `recent` keys, which no page renders)
 * Within a tier rows go round-robin across users, then most recent period first.
 */
export function getClaimPriority(
  snapshot: PrecomputeSnapshot,
  activePeriods: Pick<ActivePeriodSeed, "periodType" | "periodKey">[],
  computeVersion: number
): number {
  const active = isActiveSnapshot(snapshot, activePeriods);
  const needsWork = snapshot.status === "pending" || snapshot.status === "failed";
  const oldVersion = snapshot.computeVersion < computeVersion;
  if (active && (needsWork || oldVersion)) return 0;
  const viewable = snapshot.periodType !== "recent";
  if (viewable && needsWork) return 1;
  if (active) return 4;
  if (viewable && snapshot.finalizedAt === null) return 2;
  if (viewable && oldVersion) return 3;
  return 5;
}

/** Last KST day of a period as `YYYY-MM-DD` — the recency key claims sort on (descending). */
export function periodEndKey(periodType: PeriodType, periodKey: string): string {
  const range = getPeriodRange(periodType, periodKey);
  return toLocalDateString(new Date(range.toExclusive.getTime() - 1));
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

async function seedAllActivePeriods(
  store: PrecomputeStore,
  activePeriods: Pick<ActivePeriodSeed, "periodType" | "periodKey">[],
  now: Date
) {
  let afterUserId: string | null = null;
  while (true) {
    const userIds = await store.listUserIdsPage(afterUserId, PRECOMPUTE_USER_BATCH_LIMIT);
    if (userIds.length === 0) break;
    await store.seedActivePeriods(
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
}

/**
 * Claims and computes lease batches until the time budget is spent or nothing is
 * claimable. Each row is claimed at most once per run (`excludeIds`): an active
 * period stays claimable after publishing and a deferred one goes back to
 * pending, so without the exclusion one run would spin on them.
 */
async function drainClaims(
  dependencies: OverviewPrecomputeDependencies,
  activePeriods: Pick<ActivePeriodSeed, "periodType" | "periodKey">[],
  options: PrecomputeRunOptions
) {
  const completed = new Map(
    (options.completedLocationWindows ?? []).map((window) => [
      window.userId,
      window.completedThrough,
    ])
  );
  const clock = dependencies.clock ?? Date.now;
  const deadline = clock() + (dependencies.timeBudgetMs ?? PRECOMPUTE_TIME_BUDGET_MS);
  const claimedIds: string[] = [];
  const outcomes: SnapshotOutcome[] = [];

  do {
    const batchNow = options.now ?? new Date();
    const claimed = await dependencies.store.claimSnapshots({
      now: batchNow,
      leaseExpiresAt: new Date(batchNow.getTime() + LEASE_DURATION_MS),
      activePeriods,
      computeVersion: OVERVIEW_COMPUTE_VERSION,
      maxAttempts: PRECOMPUTE_MAX_ATTEMPTS,
      limit: PRECOMPUTE_CLAIM_LIMIT,
      excludeIds: [...claimedIds],
    });
    if (claimed.length === 0) break;
    for (const snapshot of claimed) {
      claimedIds.push(snapshot.id);
      outcomes.push(await processClaimedSnapshot(dependencies, snapshot, batchNow, completed));
    }
  } while (clock() < deadline);

  const count = (outcome: SnapshotOutcome) => outcomes.filter((item) => item === outcome).length;
  return {
    claimed: claimedIds.length,
    published: count("published"),
    failed: count("failed"),
    deferredForLocation: count("deferred"),
  };
}

export async function runPrecomputeTick(
  dependencies: OverviewPrecomputeDependencies,
  options: PrecomputeRunOptions = {}
): Promise<PrecomputeRunResult> {
  const now = options.now ?? new Date();
  const activePeriods = activePeriodsAt(now);
  const recovered = await dependencies.store.recoverExpiredLeases(now, PRECOMPUTE_MAX_ATTEMPTS);
  await seedAllActivePeriods(dependencies.store, activePeriods, now);
  return {
    skipped: false,
    recovered,
    ...(await drainClaims(dependencies, activePeriods, options)),
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
      const excluded =
        options.excludeIds && options.excludeIds.length > 0
          ? sql`AND ${periodSnapshots.id} NOT IN (${sql.join(
              options.excludeIds.map((id) => sql`${id}::uuid`),
              sql`, `
            )})`
          : sql``;
      const needsWork = sql`${periodSnapshots.status} IN ('pending', 'failed')`;
      const oldVersion = sql`${periodSnapshots.computeVersion} < ${options.computeVersion}`;
      const viewable = sql`${periodSnapshots.periodType} <> 'recent'`;
      // Last KST day of the period, for "most recent period first". Keys are
      // canonical (validated on every write path), so the casts cannot fail.
      const periodEnd = sql`CASE ${periodSnapshots.periodType}
            WHEN 'recent' THEN ${periodSnapshots.periodKey}::date
            WHEN 'week' THEN to_date(${periodSnapshots.periodKey}, 'IYYY-"W"IW') + 6
            WHEN 'month' THEN (to_date(${periodSnapshots.periodKey}, 'YYYY-MM') + interval '1 month' - interval '1 day')::date
            ELSE to_date(${periodSnapshots.periodKey} || '-12-31', 'YYYY-MM-DD')
          END`;
      // Tiers mirror getClaimPriority. The window function can't share a query
      // level with FOR UPDATE, so ranking happens in its own CTE and the lock is
      // taken (re-checking status under SKIP LOCKED) in the next one.
      const result = await db.execute(sql`
        WITH ranked AS (
          SELECT ${periodSnapshots.id} AS id, tiered.tier, tiered.period_end,
            row_number() OVER (
              PARTITION BY ${periodSnapshots.userId}, tiered.tier
              ORDER BY tiered.period_end DESC, ${periodSnapshots.updatedAt} ASC, ${periodSnapshots.id}
            ) AS user_rank,
            ${periodSnapshots.updatedAt} AS updated_at
          FROM ${periodSnapshots}
          CROSS JOIN LATERAL (
            SELECT
              CASE
                WHEN (${activePredicate}) AND (${needsWork} OR ${oldVersion}) THEN 0
                WHEN ${viewable} AND ${needsWork} THEN 1
                WHEN (${activePredicate}) THEN 4
                WHEN ${viewable} AND ${periodSnapshots.finalizedAt} IS NULL THEN 2
                WHEN ${viewable} AND ${oldVersion} THEN 3
                ELSE 5
              END AS tier,
              ${periodEnd} AS period_end
          ) tiered
          WHERE ${periodSnapshots.status} <> 'computing'
            AND ${periodSnapshots.attemptCount} < ${options.maxAttempts}
            AND (
              (${activePredicate})
              OR ${needsWork}
              OR (${viewable} AND ${periodSnapshots.finalizedAt} IS NULL)
              OR ${oldVersion}
            )
            ${excluded}
        ),
        candidates AS (
          SELECT ${periodSnapshots.id}, ranked.tier, ranked.user_rank, ranked.period_end,
            ranked.updated_at
          FROM ${periodSnapshots}
          JOIN ranked ON ranked.id = ${periodSnapshots.id}
          WHERE ${periodSnapshots.status} <> 'computing'
            AND ${periodSnapshots.attemptCount} < ${options.maxAttempts}
          ORDER BY ranked.tier, ranked.user_rank, ranked.period_end DESC,
            ranked.updated_at ASC, ${periodSnapshots.id}
          FOR UPDATE OF ${periodSnapshots} SKIP LOCKED
          LIMIT ${options.limit}
        ),
        claimed AS (
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
          ${periodSnapshots.computeStartedAt} AS "computeStartedAt",
          candidates.tier, candidates.user_rank, candidates.period_end,
          candidates.updated_at AS previous_updated_at
        )
        -- UPDATE ... RETURNING has no defined order; hand rows back in claim order
        -- so the runner computes the most-wanted snapshot first.
        SELECT * FROM claimed
        ORDER BY tier, user_rank, period_end DESC, previous_updated_at ASC, id
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
