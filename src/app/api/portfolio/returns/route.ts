import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { brokerageAccounts, brokerageExecutions, getDb, holdingSnapshots } from "@/db";
import { withAuth } from "@/lib/api-handler";
import {
  computeReturns,
  type ReturnExecution,
  type ReturnSnapshot,
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

  const db = getDb();

  const userAccounts = await db
    .select({ id: brokerageAccounts.id })
    .from(brokerageAccounts)
    .where(eq(brokerageAccounts.userId, user.id));
  const ids = userAccounts.map((a) => a.id);
  if (ids.length === 0) {
    return NextResponse.json({
      twr: { totalReturn: null, annualizedReturn: null, days: 0, periods: [] },
      xirr: null,
      cashflows: [],
      startDate: null,
      endDate: null,
      startValue: 0,
      endValue: 0,
    });
  }

  if (accountId && !ids.includes(accountId)) {
    return NextResponse.json({ error: "계좌를 찾을 수 없습니다" }, { status: 404 });
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

  const execConditions = [...execAccountFilter];
  execConditions.push(gte(brokerageExecutions.ordDt, ymdToOrdDt(effectiveFrom)));
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

  // When accountId is null we aggregate across all user accounts by date.
  const byDate = new Map<
    string,
    { totalEvalAmount: number; deposit: number; totalPurchaseAmount: number }
  >();
  for (const r of snapRows) {
    const cur = byDate.get(r.asOfDate) ?? {
      totalEvalAmount: 0,
      deposit: 0,
      totalPurchaseAmount: 0,
    };
    cur.totalEvalAmount += Number(r.totalEvalAmount);
    cur.deposit += Number(r.deposit);
    cur.totalPurchaseAmount += Number(r.totalPurchaseAmount);
    byDate.set(r.asOfDate, cur);
  }

  const snapshots: ReturnSnapshot[] = Array.from(byDate.entries())
    .map(([asOfDate, v]) => ({
      asOfDate,
      totalEvalAmount: v.totalEvalAmount,
      deposit: v.deposit,
      totalPurchaseAmount: v.totalPurchaseAmount,
    }))
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));

  const executions: ReturnExecution[] = execRows.map((e) => ({
    ordDt: e.ordDt,
    side: e.side as "buy" | "sell",
    filledAmount: Number(e.filledAmount),
    cancelled: e.cancelled,
  }));

  const result = computeReturns({ snapshots, executions });

  return NextResponse.json(result);
});
