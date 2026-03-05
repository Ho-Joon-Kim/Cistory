/**
 * Transaction Detail API
 *
 * DELETE /api/spending/transactions/:transactionId
 * Deletes a specific transaction record. The original notification log is preserved.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { transactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error) return error;

    const { transactionId } = await params;
    const db = getDb();

    const deleted = await db
      .delete(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, user.id)))
      .returning({ id: transactions.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "거래를 찾을 수 없습니다" }, { status: 404 });
    }

    logger.info("Transaction deleted", { userId: user.id, transactionId });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Transaction delete error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
