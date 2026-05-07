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
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}

const ALLOWED_OVERRIDES = new Set(["include", "exclude"]);

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
    };

    const update: Partial<typeof transactions.$inferInsert> = {};

    if ("spendingOverride" in body) {
      const v = body.spendingOverride;
      if (v === null) {
        update.spendingOverride = null;
      } else if (typeof v === "string" && ALLOWED_OVERRIDES.has(v)) {
        update.spendingOverride = v;
      } else {
        return NextResponse.json({ error: "잘못된 spendingOverride 값" }, { status: 400 });
      }
    }

    if ("overrideNote" in body) {
      const note = body.overrideNote;
      update.overrideNote = note === null || note === undefined ? null : String(note).slice(0, 500);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "변경할 필드가 없습니다" }, { status: 400 });
    }

    const db = getDb();
    const updated = await db
      .update(transactions)
      .set(update)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, user.id)))
      .returning({ id: transactions.id });

    if (updated.length === 0) {
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
    return NextResponse.json({ error: "수정 실패" }, { status: 500 });
  }
}
