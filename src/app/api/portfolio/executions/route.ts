import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { brokerageAccounts, brokerageExecutions, getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";

export const GET = withAuth(async ({ user, request }) => {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const from = url.searchParams.get("from"); // YYYYMMDD
  const to = url.searchParams.get("to");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  const db = getDb();

  const userAccounts = await db
    .select({ id: brokerageAccounts.id, label: brokerageAccounts.label })
    .from(brokerageAccounts)
    .where(eq(brokerageAccounts.userId, user.id));
  const labelMap = new Map(userAccounts.map((a) => [a.id, a.label]));
  const ids = userAccounts.map((r) => r.id);
  if (ids.length === 0) return NextResponse.json({ executions: [] });

  const conditions = [];
  conditions.push(
    accountId
      ? eq(brokerageExecutions.accountId, accountId)
      : inArray(brokerageExecutions.accountId, ids)
  );
  if (from) conditions.push(gte(brokerageExecutions.ordDt, from));
  if (to) conditions.push(lte(brokerageExecutions.ordDt, to));

  const rows = await db
    .select()
    .from(brokerageExecutions)
    .where(and(...conditions))
    .orderBy(desc(brokerageExecutions.ordDt), desc(brokerageExecutions.ordTime))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({
    executions: rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      accountLabel: labelMap.get(r.accountId) ?? "",
      odno: r.odno,
      ordDt: r.ordDt,
      ordTime: r.ordTime,
      side: r.side,
      ticker: r.ticker,
      name: r.name,
      orderQty: Number(r.orderQty),
      filledQty: Number(r.filledQty),
      filledAmount: Number(r.filledAmount),
      avgPrice: Number(r.avgPrice),
      cancelled: r.cancelled,
    })),
  });
});
