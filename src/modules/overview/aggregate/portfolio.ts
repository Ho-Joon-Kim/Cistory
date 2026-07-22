import { sql } from "drizzle-orm";
import { brokerageAccounts, brokerageExecutions, holdingSnapshots } from "@/db/schema";
import { toLocalDateString } from "@/lib/utils";
import {
  computeReturns,
  type ReturnExecution,
  type ReturnSnapshot,
} from "@/modules/portfolio/returns";
import type { PeriodAggregateInput, PortfolioAggregate } from "../types";
import type { LocationReadExecutor } from "./location";

function rows(result: unknown): Record<string, unknown>[] {
  const value = result as { rows?: unknown[] } | null;
  return Array.isArray(value?.rows) ? (value.rows as Record<string, unknown>[]) : [];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function aggregatePortfolio(
  executor: LocationReadExecutor,
  input: PeriodAggregateInput & { from: Date; toExclusive: Date }
): Promise<PortfolioAggregate> {
  const fromDay = toLocalDateString(input.from);
  const toDay = toLocalDateString(input.toExclusive);
  const accountResult = await executor.execute(sql`
    SELECT COUNT(*)::int AS count FROM ${brokerageAccounts}
    WHERE ${brokerageAccounts.userId} = ${input.userId}
  `);
  if (numberValue(rows(accountResult)[0]?.count) === 0) {
    return {
      hasAccounts: false,
      evaluationTrend: [],
      twr: { totalReturn: null, annualizedReturn: null, days: 0 },
    };
  }

  const [snapshotResult, executionResult] = await Promise.all([
    executor.execute(sql`
      SELECT ${holdingSnapshots.asOfDate} AS date,
        COALESCE(SUM(${holdingSnapshots.totalEvalAmount}), 0)::float8 AS "totalEvalAmount",
        COALESCE(SUM(${holdingSnapshots.deposit}), 0)::float8 AS deposit,
        COALESCE(SUM(${holdingSnapshots.totalPurchaseAmount}), 0)::float8 AS "totalPurchaseAmount"
      FROM ${holdingSnapshots}
      INNER JOIN ${brokerageAccounts} ON ${brokerageAccounts.id} = ${holdingSnapshots.accountId}
      WHERE ${brokerageAccounts.userId} = ${input.userId}
        AND ${holdingSnapshots.asOfDate} >= ${fromDay}
        AND ${holdingSnapshots.asOfDate} < ${toDay}
      GROUP BY ${holdingSnapshots.asOfDate}
      ORDER BY ${holdingSnapshots.asOfDate}
    `),
    executor.execute(sql`
      SELECT ${brokerageExecutions.ordDt} AS "ordDt",
        ${brokerageExecutions.side} AS side,
        ${brokerageExecutions.filledAmount}::float8 AS "filledAmount",
        ${brokerageExecutions.cancelled} AS cancelled
      FROM ${brokerageExecutions}
      INNER JOIN ${brokerageAccounts} ON ${brokerageAccounts.id} = ${brokerageExecutions.accountId}
      WHERE ${brokerageAccounts.userId} = ${input.userId}
        AND ${brokerageExecutions.ordDt} >= ${fromDay}
        AND ${brokerageExecutions.ordDt} < ${toDay}
      ORDER BY ${brokerageExecutions.ordDt}, ${brokerageExecutions.odno}
    `),
  ]);

  const snapshots: ReturnSnapshot[] = rows(snapshotResult).map((row) => ({
    asOfDate: String(row.date),
    totalEvalAmount: numberValue(row.totalEvalAmount),
    deposit: numberValue(row.deposit),
    totalPurchaseAmount: numberValue(row.totalPurchaseAmount),
  }));
  if (snapshots.length === 0) {
    return {
      hasAccounts: true,
      evaluationTrend: [],
      twr: { totalReturn: null, annualizedReturn: null, days: 0 },
    };
  }

  const executions: ReturnExecution[] = rows(executionResult).map((row) => ({
    ordDt: String(row.ordDt),
    side: row.side === "sell" ? "sell" : "buy",
    filledAmount: numberValue(row.filledAmount),
    cancelled: Boolean(row.cancelled),
  }));
  const returns = computeReturns({ snapshots, executions });
  return {
    hasAccounts: true,
    evaluationTrend: snapshots.map((snapshot) => ({
      date: snapshot.asOfDate,
      value: snapshot.totalEvalAmount,
    })),
    twr: {
      totalReturn: returns.twr.totalReturn,
      annualizedReturn: returns.twr.annualizedReturn,
      days: returns.twr.days,
    },
  };
}
