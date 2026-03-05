/**
 * Notification Logs API (session-authenticated)
 *
 * GET /api/spending/notifications?from=2026-03-01&to=2026-03-31&limit=30&offset=0
 * Returns raw notification logs with their parse status.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { notificationLogs, transactions } from "@/db/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error) return error;

    const params = request.nextUrl.searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const limit = Math.min(Number(params.get("limit")) || 30, 200);
    const offset = Number(params.get("offset")) || 0;

    const conditions = [eq(notificationLogs.userId, user.id)];

    if (from) {
      const [fy, fm, fd] = from.split("-").map(Number);
      conditions.push(gte(notificationLogs.receivedAt, new Date(fy, fm - 1, fd)));
    }
    if (to) {
      const [ty, tm, td] = to.split("-").map(Number);
      conditions.push(lte(notificationLogs.receivedAt, new Date(ty, tm - 1, td + 1)));
    }

    const db = getDb();
    const where = and(...conditions);

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: notificationLogs.id,
          source: notificationLogs.source,
          rawPayload: notificationLogs.rawPayload,
          receivedAt: notificationLogs.receivedAt,
          // LEFT JOIN to check if a transaction exists for this log
          transactionId: transactions.id,
        })
        .from(notificationLogs)
        .leftJoin(transactions, eq(transactions.notificationLogId, notificationLogs.id))
        .where(where)
        .orderBy(desc(notificationLogs.receivedAt))
        .limit(limit + 1)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(notificationLogs)
        .where(where),
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const logs = items.map((row) => {
      let title = "";
      let text = "";
      try {
        const payload = JSON.parse(row.rawPayload);
        title = typeof payload.title === "string" ? payload.title : "";
        text = typeof payload.text === "string" ? payload.text : "";
      } catch {
        // raw payload wasn't valid JSON
      }
      return {
        id: row.id,
        source: row.source,
        title,
        text,
        rawPayload: row.rawPayload,
        receivedAt: row.receivedAt,
        parsed: row.transactionId !== null,
        transactionId: row.transactionId,
      };
    });

    return NextResponse.json({
      logs,
      hasMore,
      total: Number(countResult[0]?.count ?? 0),
      count: logs.length,
      limit,
      offset,
    });
  } catch (error) {
    logger.error("Notification logs fetch error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
