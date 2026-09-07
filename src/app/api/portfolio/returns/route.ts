import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { brokerageAccounts, brokerageExecutions, getDb, holdingSnapshots } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { aggregateReturnSnapshots } from "@/modules/portfolio/return-coverage";
import {
  computeReturns,
  type ReturnExecution,
  settlementLookbackDate,
} from "@/modules/portfolio/returns";

function ymdToOrdDt(ymd: string): string {
  return ymd.replaceAll("-", "");
}

// Feature launched 2026-05-12. Earlier snapshots (5/7~5/11) have a deposit value
// that includes pre-settlement KIS receivables, which inflates the starting
// total asset and produces misleading TWR. Anchor every account's return
// calculation here so the baseline is a fully settled, steady state.
const RETURNS_EPOCH = "2026-05-12";

export const GET = withAuth(async ({ user, request }) => {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const from = url.searchParams.get("from"); // YYYY-MM-DD
  const to = url.searchParams.get("to");

  const isDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (
    (from !== null && !isDate(from)) ||
    (to !== null && !isDate(to)) ||
    (from && to && from > to)
  ) {
    return NextResponse.json({ error: "올바른 날짜 범위를 입력해 주세요" }, { status: 400 });
  }

  const db = getDb();

  const userAccounts = await db
    .select({ id: brokerageAccounts.id })
    .from(brokerageAccounts)
    .where(eq(brokerageAccounts.userId, user.id));
  const ids = userAccounts.map((a) => a.id);
  if (accountId && !ids.includes(accountId)) {
    return NextResponse.json({ error: "계좌를 찾을 수 없습니다" }, { status: 404 });
  }
  if (ids.length === 0) {
    return NextResponse.json({
      twr: { totalReturn: null, annualizedReturn: null, days: 0, periods: [] },
      xirr: null,
      cashflows: [],
      startDate: null,
      endDate: null,
      startValue: 0,
      endValue: 0,
      coverage: { accountCount: 0, completeDates: 0, excludedDates: [] },
    });
  }

  const accountFilter = accountId
    ? [eq(holdingSnapshots.accountId, accountId)]
    : [inArray(holdingSnapshots.accountId, ids)];
  const execAccountFilter = accountId
    ? [eq(brokerageExecutions.accountId, accountId)]
    : [inArray(brokerageExecutions.accountId, ids)];

  // Always clamp the lower bound to the global epoch. A user-supplied `from`
  // narrower than the epoch is honored; a wider one is silently clamped.
  const effectiveFrom = from && from > RETURNS_EPOCH ? from : RETURNS_EPOCH;

  const snapConditions = [...accountFilter];
  snapConditions.push(gte(holdingSnapshots.asOfDate, effectiveFrom));
  if (to) snapConditions.push(lte(holdingSnapshots.asOfDate, to));

  // Fills before the first valuation can still change deposit through T+2 settlement.
  const execConditions = [...execAccountFilter];
  execConditions.push(
    gte(brokerageExecutions.ordDt, ymdToOrdDt(settlementLookbackDate(effectiveFrom)))
  );
  if (to) execConditions.push(lte(brokerageExecutions.ordDt, ymdToOrdDt(to)));

  const snapRows = await db
    .select({
      accountId: holdingSnapshots.accountId,
      asOfDate: holdingSnapshots.asOfDate,
      totalEvalAmount: holdingSnapshots.totalEvalAmount,
      deposit: holdingSnapshots.deposit,
      totalPurchaseAmount: holdingSnapshots.totalPurchaseAmount,
    })
    .from(holdingSnapshots)
    .where(and(...snapConditions))
    .orderBy(asc(holdingSnapshots.asOfDate));

  const execRows = await db
    .select({
      ordDt: brokerageExecutions.ordDt,
      side: brokerageExecutions.side,
      filledAmount: brokerageExecutions.filledAmount,
      cancelled: brokerageExecutions.cancelled,
    })
    .from(brokerageExecutions)
    .where(and(...execConditions));

  const { snapshots, coverage } = aggregateReturnSnapshots(snapRows, accountId ? [accountId] : ids);

  const executions: ReturnExecution[] = execRows.map((e) => ({
    ordDt: e.ordDt,
    side: e.side as "buy" | "sell",
    filledAmount: Number(e.filledAmount),
    cancelled: e.cancelled,
  }));

  const result = computeReturns({ snapshots, executions });

  return NextResponse.json({ ...result, coverage });
});
