/**
 * Transactions API
 *
 * GET /api/transactions?apikey={key}&from=2026-03-01&to=2026-03-31&type=withdrawal&limit=50&offset=0
 * Returns parsed transaction records with summary stats.
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { transactions, users } from "@/db/schema";
import { logger } from "@/lib/logger";

async function authenticateByApiKey(apikey: string | null) {
  if (!apikey) return null;

  const db = getDb();
  const result = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tossNotificationApiKey, apikey))
    .limit(1);

  return result.length > 0 ? result[0].id : null;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const apikey = params.get("apikey");
    const userId = await authenticateByApiKey(apikey);

    if (!userId) {
      return NextResponse.json({ error: "인증 실패" }, { status: 401 });
    }

    const from = params.get("from");
    const to = params.get("to");
    const type = params.get("type"); // 'withdrawal' | 'deposit' | null
    const limit = Math.min(Number(params.get("limit")) || 50, 200);
    const offset = Number(params.get("offset")) || 0;

    // Build filters
    const conditions = [eq(transactions.userId, userId)];

    if (from) {
      const [fy, fm, fd] = from.split("-").map(Number);
      conditions.push(gte(transactions.transactedAt, new Date(fy, fm - 1, fd)));
    }
    if (to) {
      const [ty, tm, td] = to.split("-").map(Number);
      conditions.push(lte(transactions.transactedAt, new Date(ty, tm - 1, td + 1)));
    }
    if (type === "withdrawal" || type === "deposit") {
      conditions.push(eq(transactions.type, type));
    }

    const db = getDb();
    const where = and(...conditions);

    // Fetch transactions and summary in parallel
    const [rows, summaryRows] = await Promise.all([
      db
        .select({
          id: transactions.id,
          type: transactions.type,
          amount: transactions.amount,
          merchant: transactions.merchant,
          accountName: transactions.accountName,
          rawTitle: transactions.rawTitle,
          rawText: transactions.rawText,
          transactedAt: transactions.transactedAt,
        })
        .from(transactions)
        .where(where)
        .orderBy(desc(transactions.transactedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({
          type: transactions.type,
          total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
          count: sql<number>`count(*)`.as("count"),
        })
        .from(transactions)
        .where(where)
        .groupBy(transactions.type),
    ]);

    const summary = {
      totalWithdrawal: 0,
      totalDeposit: 0,
      withdrawalCount: 0,
      depositCount: 0,
    };

    for (const row of summaryRows) {
      if (row.type === "withdrawal") {
        summary.totalWithdrawal = Number(row.total);
        summary.withdrawalCount = Number(row.count);
      } else if (row.type === "deposit") {
        summary.totalDeposit = Number(row.total);
        summary.depositCount = Number(row.count);
      }
    }

    return NextResponse.json({
      transactions: rows,
      summary,
      count: rows.length,
      limit,
      offset,
    });
  } catch (error) {
    logger.error("Transactions fetch error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
