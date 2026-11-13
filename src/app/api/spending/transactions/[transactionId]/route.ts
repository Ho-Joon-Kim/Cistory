/**
 * Transaction Detail API
 *
 * DELETE /api/spending/transactions/:transactionId
 * Deletes a specific transaction record. The original notification log is preserved.
 *
 * PATCH /api/spending/transactions/:transactionId
 * Body: { spendingOverride?: 'include' | 'exclude' | null, overrideNote?: string | null }
 * Updates the per-transaction spending override flag (kept across reparse).
 */

import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { transactions } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { correctTransaction, parseTransactionCorrection } from "@/modules/spending/service";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> }
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
    return NextResponse.json(
      { error: "거래를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> }
) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error) return error;

    const { transactionId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      spendingOverride?: string | null;
      overrideNote?: string | null;
      category?: string | null;
    };

    const parsed = parseTransactionCorrection(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const update = parsed.value;

    const updated = await correctTransaction(user.id, transactionId, update);
    if (!updated) {
      return NextResponse.json({ error: "거래를 찾을 수 없습니다" }, { status: 404 });
    }

    logger.info("Transaction override updated", {
      userId: user.id,
      transactionId,
      ...update,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Transaction patch error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "거래를 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
