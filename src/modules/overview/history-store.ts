import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { periodSnapshots } from "@/db/schema";
import { ApiError } from "@/lib/api-handler";
import { toKstCalendarDate } from "@/lib/date-key";
import {
  buildOverviewHistory,
  type HistoryPeriodType,
  type HistorySnapshotRow,
  historyPlan,
  type OverviewHistoryResponse,
} from "./history";
import { isCanonicalPeriodKey, type PeriodType } from "./period";

export interface OverviewHistoryStore {
  findHistorySnapshots(
    userId: string,
    keys: { periodType: HistoryPeriodType; periodKeys: string[] }[]
  ): Promise<HistorySnapshotRow[]>;
}

const HISTORY_TYPES: readonly HistoryPeriodType[] = ["week", "month", "year"];

export async function getOverviewHistory(
  store: OverviewHistoryStore,
  userId: string,
  rawPeriodType: string,
  periodKey: string,
  now: Date = new Date()
): Promise<OverviewHistoryResponse> {
  if (!HISTORY_TYPES.includes(rawPeriodType as HistoryPeriodType)) {
    throw new ApiError(400, "유효하지 않은 기간입니다", "INVALID_PERIOD");
  }
  const periodType = rawPeriodType as HistoryPeriodType;
  if (!isCanonicalPeriodKey(periodType, periodKey)) {
    throw new ApiError(400, "유효하지 않은 기간입니다", "INVALID_PERIOD");
  }
  const today = toKstCalendarDate(now);
  const plan = historyPlan(periodType, periodKey, today);
  const rows = await store.findHistorySnapshots(userId, plan.snapshotKeys);
  return buildOverviewHistory({ periodType, periodKey, today, rows });
}

/** Reads only the jsonb paths the history needs, never the heavy location/heatmap payloads. */
export function createDatabaseOverviewHistoryStore(db: Database): OverviewHistoryStore {
  return {
    async findHistorySnapshots(userId, keys) {
      const byType = keys.filter((k) => k.periodKeys.length > 0);
      if (byType.length === 0) return [];
      const rows = await db
        .select({
          periodType: periodSnapshots.periodType,
          periodKey: periodSnapshots.periodKey,
          codingStatus: sql<string | null>`${periodSnapshots.coding}->>'status'`,
          dailyCommits: sql<
            HistorySnapshotRow["dailyCommits"]
          >`${periodSnapshots.coding}->'data'->'dailyCommits'`,
          spendingStatus: sql<string | null>`${periodSnapshots.spending}->>'status'`,
          spendingDaily: sql<
            HistorySnapshotRow["spendingDaily"]
          >`${periodSnapshots.spending}->'data'->'daily'`,
          healthStatus: sql<string | null>`${periodSnapshots.health}->>'status'`,
          healthMetrics: sql<
            HistorySnapshotRow["healthMetrics"]
          >`${periodSnapshots.health}->'data'->'metrics'`,
          weightSeries: sql<
            HistorySnapshotRow["weightSeries"]
          >`${periodSnapshots.health}->'data'->'body'->'weightSeries'`,
        })
        .from(periodSnapshots)
        .where(
          and(
            eq(periodSnapshots.userId, userId),
            inArray(periodSnapshots.status, ["ready", "failed"]),
            or(
              ...byType.map((k) =>
                and(
                  eq(periodSnapshots.periodType, k.periodType),
                  inArray(periodSnapshots.periodKey, k.periodKeys)
                )
              )
            )
          )
        );
      return rows.map((row) => ({ ...row, periodType: row.periodType as PeriodType }));
    },
  };
}
