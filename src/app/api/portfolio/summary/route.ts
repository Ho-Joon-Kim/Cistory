import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { brokerageAccounts, getDb, holdingPositions, holdingSnapshots } from "@/db";
import { withAuth } from "@/lib/api-handler";

export const GET = withAuth(async ({ user }) => {
  const db = getDb();

  const accounts = await db
    .select()
    .from(brokerageAccounts)
    .where(eq(brokerageAccounts.userId, user.id))
    .orderBy(brokerageAccounts.createdAt);

  if (accounts.length === 0) {
    return NextResponse.json({
      accounts: [],
      totals: null,
      latestSnapshots: [],
      positions: [],
    });
  }

  const accountIds = accounts.map((a) => a.id);

  // Latest snapshot per account
  const latestSnapshotIds = await db
    .select({
      accountId: holdingSnapshots.accountId,
      maxDate: sql<string>`max(${holdingSnapshots.asOfDate})`.as("max_date"),
    })
    .from(holdingSnapshots)
    .where(inArray(holdingSnapshots.accountId, accountIds))
    .groupBy(holdingSnapshots.accountId);

  const latestSnapshots = await Promise.all(
    latestSnapshotIds.map(async (r) => {
      const rows = await db
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
      ? await db
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

  return NextResponse.json({
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
  });
});
