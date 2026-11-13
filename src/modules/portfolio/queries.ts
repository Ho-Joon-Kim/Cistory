/**
 * Read-only portfolio queries shared by the web routes and the MCP tools:
 * account summary, TWR/XIRR returns, and target allocations. Every function is
 * scoped to `userId`; account-level reads verify ownership first.
 *
 * Credential columns (`appKeyEnc`, `appSecretEnc`, `accessToken`, …) are never
 * part of any result here.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  brokerageAccounts,
  brokerageExecutions,
  brokerageTargetAllocations,
  type Database,
  getDb,
  holdingPositions,
  holdingSnapshots,
} from "@/db";
import { aggregateReturnSnapshots } from "./return-coverage";
import {
  computeReturns,
  RETURNS_EPOCH,
  type ReturnExecution,
  settlementLookbackDate,
} from "./returns";

export { RETURNS_EPOCH };

// ── Summary ─────────────────────────────────────────────────────────────────

/** Accounts, cross-account totals, each account's latest snapshot and its positions. */
export async function getPortfolioSummary(userId: string, database: Database = getDb()) {
  const accounts = await database
    .select()
    .from(brokerageAccounts)
    .where(eq(brokerageAccounts.userId, userId))
    .orderBy(brokerageAccounts.createdAt);

  if (accounts.length === 0) {
    return {
      accounts: [],
      totals: null,
      latestSnapshots: [],
      positions: [],
    };
  }

  const accountIds = accounts.map((a) => a.id);

  // Latest snapshot per account
  const latestSnapshotIds = await database
    .select({
      accountId: holdingSnapshots.accountId,
      maxDate: sql<string>`max(${holdingSnapshots.asOfDate})`.as("max_date"),
    })
    .from(holdingSnapshots)
    .where(inArray(holdingSnapshots.accountId, accountIds))
    .groupBy(holdingSnapshots.accountId);

  const latestSnapshots = await Promise.all(
    latestSnapshotIds.map(async (r) => {
      const rows = await database
        .select()
        .from(holdingSnapshots)
        .where(
          and(eq(holdingSnapshots.accountId, r.accountId), eq(holdingSnapshots.asOfDate, r.maxDate))
        )
        .orderBy(desc(holdingSnapshots.takenAt))
        .limit(1);
      return rows[0] ?? null;
    })
  );

  const validSnapshots = latestSnapshots.filter((s): s is NonNullable<typeof s> => s !== null);
  const snapshotIds = validSnapshots.map((s) => s.id);

  const positions =
    snapshotIds.length > 0
      ? await database
          .select()
          .from(holdingPositions)
          .where(inArray(holdingPositions.snapshotId, snapshotIds))
      : [];

  // Totals across snapshots
  let totalEval = 0;
  let totalDeposit = 0;
  let totalPurchase = 0;
  let totalPnl = 0;
  let totalPrev = 0;
  for (const s of validSnapshots) {
    totalEval += Number(s.totalEvalAmount);
    totalDeposit += Number(s.deposit);
    totalPurchase += Number(s.totalPurchaseAmount);
    totalPnl += Number(s.totalPnl);
    if (s.prevDayTotalAsset) totalPrev += Number(s.prevDayTotalAsset);
  }

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.label,
      cano: a.cano,
      acntPrdtCd: a.acntPrdtCd,
      accountType: a.accountType,
      isActive: a.isActive,
      lastSyncedAt: a.lastSyncedAt,
      lastSyncError: a.lastSyncError,
    })),
    totals: {
      totalEvalAmount: totalEval,
      totalDeposit,
      totalPurchaseAmount: totalPurchase,
      totalPnl,
      totalPnlRate: totalPurchase > 0 ? (totalPnl / totalPurchase) * 100 : 0,
      prevDayTotalAsset: totalPrev || null,
      assetIcdcAmt: totalPrev > 0 ? totalEval - totalPrev : null,
    },
    latestSnapshots: validSnapshots.map((s) => ({
      id: s.id,
      accountId: s.accountId,
      takenAt: s.takenAt,
      asOfDate: s.asOfDate,
      totalEvalAmount: Number(s.totalEvalAmount),
      securitiesEvalAmount: Number(s.securitiesEvalAmount),
      deposit: Number(s.deposit),
      totalPurchaseAmount: Number(s.totalPurchaseAmount),
      totalPnl: Number(s.totalPnl),
      totalPnlRate: s.totalPnlRate ? Number(s.totalPnlRate) : null,
      realizedPnl: s.realizedPnl ? Number(s.realizedPnl) : null,
      prevDayTotalAsset: s.prevDayTotalAsset ? Number(s.prevDayTotalAsset) : null,
      assetIcdcAmt: s.assetIcdcAmt ? Number(s.assetIcdcAmt) : null,
    })),
    positions: positions.map((p) => ({
      id: p.id,
      snapshotId: p.snapshotId,
      ticker: p.ticker,
      name: p.name,
      quantity: Number(p.quantity),
      avgPrice: Number(p.avgPrice),
      currentPrice: Number(p.currentPrice),
      evalAmount: Number(p.evalAmount),
      pnl: Number(p.pnl),
      pnlRate: p.pnlRate ? Number(p.pnlRate) : null,
      weight: Number(p.weight),
    })),
  };
}

// ── Returns ─────────────────────────────────────────────────────────────────

export class PortfolioAccountNotFoundError extends Error {
  constructor() {
    super("계좌를 찾을 수 없어요");
    this.name = "PortfolioAccountNotFoundError";
  }
}

/** A real `YYYY-MM-DD` calendar date. */
export function isDateKey(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function ymdToOrdDt(ymd: string): string {
  return ymd.replaceAll("-", "");
}

export interface PortfolioReturnsQuery {
  /** One account, or every account of the user when omitted. */
  accountId?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * TWR / XIRR over the user's accounts (or one), from `RETURNS_EPOCH` at the
 * earliest. Throws `PortfolioAccountNotFoundError` for an account the user
 * doesn't own.
 */
export async function getPortfolioReturns(
  userId: string,
  query: PortfolioReturnsQuery = {},
  database: Database = getDb()
) {
  const { accountId, from, to } = query;
  const userAccounts = await database
    .select({ id: brokerageAccounts.id })
    .from(brokerageAccounts)
    .where(eq(brokerageAccounts.userId, userId));
  const ids = userAccounts.map((a) => a.id);
  if (accountId && !ids.includes(accountId)) {
    throw new PortfolioAccountNotFoundError();
  }
  if (ids.length === 0) {
    return {
      twr: { totalReturn: null, annualizedReturn: null, days: 0, periods: [] },
      xirr: null,
      cashflows: [],
      startDate: null,
      endDate: null,
      startValue: 0,
      endValue: 0,
      coverage: { accountCount: 0, completeDates: 0, excludedDates: [] as string[] },
    };
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

  const snapRows = await database
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

  const execRows = await database
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

  return { ...computeReturns({ snapshots, executions }), coverage };
}

// ── Target allocations ──────────────────────────────────────────────────────

export async function isAccountOwned(
  userId: string,
  accountId: string,
  database: Database = getDb()
): Promise<boolean> {
  const rows = await database
    .select({ id: brokerageAccounts.id })
    .from(brokerageAccounts)
    .where(and(eq(brokerageAccounts.id, accountId), eq(brokerageAccounts.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export interface TargetAllocations {
  targets: { ticker: string; name: string; targetWeight: number }[];
  updatedAt: string | null;
}

/** An owned account's target weights (0..1), or null when the account isn't the user's. */
export async function getTargetAllocations(
  userId: string,
  accountId: string,
  database: Database = getDb()
): Promise<TargetAllocations | null> {
  if (!(await isAccountOwned(userId, accountId, database))) return null;

  const rows = await database
    .select({
      ticker: brokerageTargetAllocations.ticker,
      name: brokerageTargetAllocations.name,
      targetWeight: brokerageTargetAllocations.targetWeight,
      updatedAt: brokerageTargetAllocations.updatedAt,
    })
    .from(brokerageTargetAllocations)
    .where(eq(brokerageTargetAllocations.accountId, accountId));

  const updatedAt =
    rows.length > 0
      ? rows.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), rows[0].updatedAt)
      : null;

  return {
    targets: rows.map((r) => ({
      ticker: r.ticker,
      name: r.name,
      targetWeight: Number(r.targetWeight),
    })),
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}
