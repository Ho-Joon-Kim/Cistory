/**
 * Spending API (session-authenticated)
 *
 * GET /api/spending?from=2026-03-01&to=2026-03-31&bucket=spending&limit=30&offset=0
 * Returns parsed transaction records with summary stats for the logged-in user.
 *
 * Each row is annotated with `bucket` ('spending' | 'income' | 'ignore') based
 * on per-transaction overrides + the user's account_roles configuration. Pass
 * `?bucket=spending|income|ignore` to filter, or `?type=withdrawal|deposit` for
 * the legacy raw-type filter.
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { accountRoles, transactions, users } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { accountRolesJoinOn, type Bucket, bucketSql } from "@/modules/spending/classify";

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error) return error;

    const params = request.nextUrl.searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const type = params.get("type"); // 'withdrawal' | 'deposit' | null (legacy)
    const bucketFilter = params.get("bucket"); // 'spending' | 'income' | 'ignore' | null
    const limit = Math.min(Number(params.get("limit")) || 30, 200);
    const offset = Number(params.get("offset")) || 0;

    const db = getDb();
    const [userRow] = await db
      .select({ tossMyName: users.tossMyName })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const tossMyName = userRow?.tossMyName ?? null;
    const bucket = bucketSql(tossMyName);

    const conditions = [eq(transactions.userId, user.id)];
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
    const categoryConditions = [...conditions, sql`${bucket} = 'spending'`];
    if (bucketFilter === "spending" || bucketFilter === "income" || bucketFilter === "ignore") {
      conditions.push(sql`${bucket} = ${bucketFilter}`);
    }

    const where = and(...conditions);

    const [rows, summaryRows, categoryRows] = await Promise.all([
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
          spendingOverride: transactions.spendingOverride,
          overrideNote: transactions.overrideNote,
          category: transactions.category,
          categorySource: transactions.categorySource,
          categoryConfidence: transactions.categoryConfidence,
          bucket: bucket.as("bucket"),
        })
        .from(transactions)
        .leftJoin(accountRoles, accountRolesJoinOn)
        .where(where)
        .orderBy(desc(transactions.transactedAt))
        .limit(limit + 1)
        .offset(offset),
      db
        .select({
          bucket: bucket.as("bucket"),
          total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
          count: sql<number>`count(*)`.as("count"),
        })
        .from(transactions)
        .leftJoin(accountRoles, accountRolesJoinOn)
        .where(where)
        .groupBy(sql`"bucket"`),
      db
        .select({
          category: transactions.category,
          total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.as("total"),
          count: sql<number>`count(*)`.as("count"),
        })
        .from(transactions)
        .leftJoin(accountRoles, accountRolesJoinOn)
        .where(and(...categoryConditions))
        .groupBy(transactions.category)
        .orderBy(sql`sum(${transactions.amount}) desc`),
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const summary = {
      // Bucket-based totals
      totalSpending: 0,
      totalIncome: 0,
      totalIgnored: 0,
      spendingCount: 0,
      incomeCount: 0,
      ignoredCount: 0,
      // Legacy aliases (kept so existing UI keeps rendering totals)
      totalWithdrawal: 0,
      totalDeposit: 0,
      withdrawalCount: 0,
      depositCount: 0,
      categoryBreakdown: categoryRows.map((row) => ({
        category: row.category,
        total: Number(row.total),
        count: Number(row.count),
      })),
    };

    for (const row of summaryRows) {
      const b = row.bucket as Bucket;
      const total = Number(row.total);
      const count = Number(row.count);
      if (b === "spending") {
        summary.totalSpending = total;
        summary.spendingCount = count;
      } else if (b === "income") {
        summary.totalIncome = total;
        summary.incomeCount = count;
      } else {
        summary.totalIgnored = total;
        summary.ignoredCount = count;
      }
    }
    summary.totalWithdrawal = summary.totalSpending;
    summary.withdrawalCount = summary.spendingCount;
    summary.totalDeposit = summary.totalIncome;
    summary.depositCount = summary.incomeCount;

    return NextResponse.json({
      transactions: items,
      summary,
      hasMore,
      count: items.length,
      limit,
      offset,
    });
  } catch (error) {
    const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
    const pg = (cause ?? error) as {
      message?: string;
      code?: string;
      detail?: string;
      hint?: string;
      position?: string;
      where?: string;
      schema?: string;
      table?: string;
      column?: string;
      dataType?: string;
      constraint?: string;
    };
    logger.error("Spending fetch error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      pgMessage: pg?.message,
      pgCode: pg?.code,
      pgDetail: pg?.detail,
      pgHint: pg?.hint,
      pgPosition: pg?.position,
      pgWhere: pg?.where,
      pgTable: pg?.table,
      pgColumn: pg?.column,
      pgConstraint: pg?.constraint,
    });
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
