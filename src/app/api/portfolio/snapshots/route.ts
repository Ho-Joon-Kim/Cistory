import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { brokerageAccounts, getDb, holdingSnapshots } from "@/db";
import { withAuth } from "@/lib/api-handler";

export const GET = withAuth(async ({ user, request }) => {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const from = url.searchParams.get("from"); // YYYY-MM-DD
  const to = url.searchParams.get("to");

  const db = getDb();

  const userAccountIds = await db
    .select({ id: brokerageAccounts.id })
    .from(brokerageAccounts)
    .where(eq(brokerageAccounts.userId, user.id));
  const ids = userAccountIds.map((r) => r.id);
  if (ids.length === 0) return NextResponse.json({ snapshots: [] });

  const conditions = [];
  conditions.push(
    accountId ? eq(holdingSnapshots.accountId, accountId) : inArray(holdingSnapshots.accountId, ids)
  );
  if (from) conditions.push(gte(holdingSnapshots.asOfDate, from));
  if (to) conditions.push(lte(holdingSnapshots.asOfDate, to));

  const rows = await db
    .select({
      id: holdingSnapshots.id,
      accountId: holdingSnapshots.accountId,
      asOfDate: holdingSnapshots.asOfDate,
      takenAt: holdingSnapshots.takenAt,
      totalEvalAmount: holdingSnapshots.totalEvalAmount,
      securitiesEvalAmount: holdingSnapshots.securitiesEvalAmount,
      deposit: holdingSnapshots.deposit,
      totalPurchaseAmount: holdingSnapshots.totalPurchaseAmount,
      totalPnl: holdingSnapshots.totalPnl,
      totalPnlRate: holdingSnapshots.totalPnlRate,
    })
    .from(holdingSnapshots)
    .where(and(...conditions))
    .orderBy(asc(holdingSnapshots.asOfDate));

  return NextResponse.json({
    snapshots: rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      asOfDate: r.asOfDate,
      takenAt: r.takenAt,
      totalEvalAmount: Number(r.totalEvalAmount),
      securitiesEvalAmount: Number(r.securitiesEvalAmount),
      deposit: Number(r.deposit),
      totalPurchaseAmount: Number(r.totalPurchaseAmount),
      totalPnl: Number(r.totalPnl),
      totalPnlRate: r.totalPnlRate ? Number(r.totalPnlRate) : null,
    })),
  });
});
