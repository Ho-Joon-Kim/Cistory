/**
 * Spending API (session-authenticated)
 *
 * GET /api/spending?from=2026-03-01&to=2026-03-31&type=withdrawal&limit=30&offset=0
 * Returns parsed transaction records with summary stats for the logged-in user.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { users, transactions } from "@/db/schema";
import { eq, desc, and, gte, lte, sql, ne } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error) return error;

    const params = request.nextUrl.searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const type = params.get("type"); // 'withdrawal' | 'deposit' | null
    const limit = Math.min(Number(params.get("limit")) || 30, 200);
    const offset = Number(params.get("offset")) || 0;

    // Build filters
    const conditions = [eq(transactions.userId, user.id)];

    // Exclude self-transfers if tossMyName is set
    const db = getDb();
    const [userRow] = await db
      .select({ tossMyName: users.tossMyName })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (userRow?.tossMyName) {
      conditions.push(ne(transactions.merchant, userRow.tossMyName));
    }

    if (from) {
      // "2026-03-04" → local midnight 2026-03-04T00:00:00+09:00
      const [fy, fm, fd] = from.split("-").map(Number);
      conditions.push(gte(transactions.transactedAt, new Date(fy, fm - 1, fd)));
    }
    if (to) {
      // Include the entire "to" day → local midnight of next day
      const [ty, tm, td] = to.split("-").map(Number);
      conditions.push(lte(transactions.transactedAt, new Date(ty, tm - 1, td + 1)));
    }
    if (type === "withdrawal" || type === "deposit") {
      conditions.push(eq(transactions.type, type));
    }

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
        .limit(limit + 1) // fetch one extra to determine hasMore
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

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

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
      transactions: items,
      summary,
      hasMore,
      count: items.length,
      limit,
      offset,
    });
  } catch (error) {
    logger.error("Spending fetch error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
