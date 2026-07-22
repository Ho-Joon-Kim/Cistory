import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  type PeriodDomainEnvelope,
  type PeriodSnapshotStatus,
  type PeriodType,
  periodSnapshots,
} from "@/db/schema";
import { ApiError } from "@/lib/api-handler";
import { getPeriodKey, getPeriodRange, periodTypes } from "./period";

export const OVERVIEW_RETENTION_PERIODS = {
  recent: 45,
  week: 104,
  month: 60,
  year: 10,
} as const satisfies Record<PeriodType, number>;

export const OVERVIEW_OUTSTANDING_LIMIT = 5;

export interface OverviewStoredSnapshot {
  status: PeriodSnapshotStatus;
  updatedAt: Date;
  coding: PeriodDomainEnvelope | null;
  location: PeriodDomainEnvelope | null;
  health: PeriodDomainEnvelope | null;
  spending: PeriodDomainEnvelope | null;
  assets: PeriodDomainEnvelope | null;
}

export type EnqueueSnapshotOutcome = "pending" | "computing" | "limit";

export interface OverviewStore {
  findSnapshot(
    userId: string,
    periodType: PeriodType,
    periodKey: string
  ): Promise<OverviewStoredSnapshot | null>;
  enqueueSnapshot(input: {
    userId: string;
    periodType: PeriodType;
    periodKey: string;
    now: Date;
    outstandingLimit: number;
  }): Promise<EnqueueSnapshotOutcome>;
}

export type OverviewSnapshotResponse =
  | { status: "missing"; periodType: PeriodType; periodKey: string }
  | { status: "pending" | "computing"; periodType: PeriodType; periodKey: string }
  | {
      status: "ready" | "failed";
      periodType: PeriodType;
      periodKey: string;
      computedAt: string;
      domains: {
        coding: PeriodDomainEnvelope | null;
        location: PeriodDomainEnvelope | null;
        health: PeriodDomainEnvelope | null;
        spending: PeriodDomainEnvelope | null;
        portfolio: PeriodDomainEnvelope | null;
      };
    };

function parseCanonicalPeriod(periodType: string, periodKey: string): PeriodType {
  if (!periodTypes.includes(periodType as PeriodType)) {
    throw new ApiError(400, "유효하지 않은 기간입니다", "INVALID_PERIOD");
  }

  const type = periodType as PeriodType;
  try {
    const range = getPeriodRange(type, periodKey);
    const reference = type === "recent" ? new Date(range.toExclusive.getTime() - 1) : range.from;
    if (getPeriodKey(type, reference) !== periodKey) {
      throw new Error("Noncanonical period key");
    }
  } catch {
    throw new ApiError(400, "유효하지 않은 기간입니다", "INVALID_PERIOD");
  }

  return type;
}

function retentionBoundary(periodType: PeriodType, now: Date): string {
  const reference = new Date(now);

  switch (periodType) {
    case "recent":
      reference.setDate(reference.getDate() - (OVERVIEW_RETENTION_PERIODS.recent - 1));
      break;
    case "week":
      reference.setDate(reference.getDate() - (OVERVIEW_RETENTION_PERIODS.week - 1) * 7);
      break;
    case "month":
      reference.setMonth(reference.getMonth() - (OVERVIEW_RETENTION_PERIODS.month - 1), 1);
      break;
    case "year":
      reference.setFullYear(reference.getFullYear() - (OVERVIEW_RETENTION_PERIODS.year - 1), 0, 1);
      break;
  }

  return getPeriodKey(periodType, reference);
}

function validateRecomputePeriod(periodType: PeriodType, periodKey: string, now: Date): void {
  const currentKey = getPeriodKey(periodType, now);
  if (periodKey > currentKey) {
    throw new ApiError(400, "미래 기간은 재계산할 수 없습니다", "FUTURE_PERIOD");
  }
  if (periodKey < retentionBoundary(periodType, now)) {
    throw new ApiError(400, "재계산 가능 기간을 벗어났습니다", "PERIOD_OUT_OF_RANGE");
  }
}

export function createOverviewService(store: OverviewStore) {
  return {
    async getSnapshot(
      userId: string,
      rawPeriodType: string,
      periodKey: string,
      _now: Date = new Date()
    ): Promise<OverviewSnapshotResponse> {
      const periodType = parseCanonicalPeriod(rawPeriodType, periodKey);
      const snapshot = await store.findSnapshot(userId, periodType, periodKey);

      if (!snapshot) return { status: "missing", periodType, periodKey };
      if (snapshot.status === "pending" || snapshot.status === "computing") {
        return { status: snapshot.status, periodType, periodKey };
      }

      return {
        status: snapshot.status,
        periodType,
        periodKey,
        computedAt: snapshot.updatedAt.toISOString(),
        domains: {
          coding: snapshot.coding,
          location: snapshot.location,
          health: snapshot.health,
          spending: snapshot.spending,
          portfolio: snapshot.assets,
        },
      };
    },

    async requestRecompute(
      userId: string,
      rawPeriodType: string,
      periodKey: string,
      now: Date = new Date()
    ): Promise<OverviewSnapshotResponse> {
      const periodType = parseCanonicalPeriod(rawPeriodType, periodKey);
      validateRecomputePeriod(periodType, periodKey, now);

      const outcome = await store.enqueueSnapshot({
        userId,
        periodType,
        periodKey,
        now,
        outstandingLimit: OVERVIEW_OUTSTANDING_LIMIT,
      });
      if (outcome === "computing") {
        throw new ApiError(409, "이미 계산 중인 기간입니다", "PERIOD_COMPUTING");
      }
      if (outcome === "limit") {
        throw new ApiError(429, "대기 중인 재계산 요청이 너무 많습니다", "OUTSTANDING_LIMIT");
      }

      return { status: "pending", periodType, periodKey };
    },
  };
}

export function createDatabaseOverviewStore(db: Database): OverviewStore {
  return {
    async findSnapshot(userId, periodType, periodKey) {
      const [snapshot] = await db
        .select({
          status: periodSnapshots.status,
          updatedAt: periodSnapshots.updatedAt,
          coding: periodSnapshots.coding,
          location: periodSnapshots.location,
          health: periodSnapshots.health,
          spending: periodSnapshots.spending,
          assets: periodSnapshots.assets,
        })
        .from(periodSnapshots)
        .where(
          and(
            eq(periodSnapshots.userId, userId),
            eq(periodSnapshots.periodType, periodType),
            eq(periodSnapshots.periodKey, periodKey)
          )
        )
        .limit(1);
      return snapshot ?? null;
    },

    async enqueueSnapshot({ userId, periodType, periodKey, now, outstandingLimit }) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

        const existing = await tx.execute<{ status: PeriodSnapshotStatus }>(sql`
          SELECT status
          FROM period_snapshots
          WHERE user_id = ${userId}
            AND period_type = ${periodType}
            AND period_key = ${periodKey}
          FOR UPDATE
        `);
        const existingStatus = existing.rows[0]?.status;
        if (existingStatus === "pending") return "pending";
        if (existingStatus === "computing") return "computing";

        const outstanding = await tx.execute<{ count: number }>(sql`
          SELECT count(*)::int AS count
          FROM period_snapshots
          WHERE user_id = ${userId}
            AND status IN ('pending', 'computing')
        `);
        if ((outstanding.rows[0]?.count ?? 0) >= outstandingLimit) return "limit";

        const queued = await tx.execute<{ status: PeriodSnapshotStatus }>(sql`
          INSERT INTO period_snapshots (
            user_id, period_type, period_key, status, updated_at
          )
          VALUES (${userId}, ${periodType}, ${periodKey}, 'pending', ${now})
          ON CONFLICT (user_id, period_type, period_key) DO UPDATE SET
            status = 'pending',
            compute_started_at = NULL,
            lease_expires_at = NULL,
            attempt_count = 0,
            last_error = NULL,
            finalized_at = NULL,
            updated_at = EXCLUDED.updated_at
          WHERE period_snapshots.status <> 'computing'
          RETURNING status
        `);

        return queued.rows.length === 0 ? "computing" : "pending";
      });
    },
  };
}
