/**
 * Reparse API (session-authenticated)
 *
 * POST /api/spending/reparse
 * Body: { "dryRun": true } — preview only (default)
 * Body: { "dryRun": false } — actually apply changes
 *
 * Re-parses all notification logs through the current parser.
 * Dry-run: returns what would be created/updated/skipped without writing.
 * Apply: upserts transactions using (userId, notificationLogId) unique constraint.
 * Skips if same amount + merchant + type already exists within ±2 minutes (duplicate guard).
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { notificationLogs, transactions } from "@/db/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { logger } from "@/lib/logger";
import { parseTossNotification } from "@/modules/transaction/parser";

interface ReparseItem {
  logId: string;
  title: string;
  text: string;
  receivedAt: string;
  action: "create" | "update" | "skip";
  reason?: string;
  parsed?: {
    type: string;
    amount: number;
    merchant: string;
    accountName: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error) return error;

    let dryRun = true;
    try {
      const body = await request.json();
      if (body.dryRun === false) dryRun = false;
    } catch {
      // No body or invalid JSON → default to dryRun
    }

    const db = getDb();

    // Fetch all notification logs for this user
    const logs = await db
      .select({
        id: notificationLogs.id,
        rawPayload: notificationLogs.rawPayload,
        receivedAt: notificationLogs.receivedAt,
      })
      .from(notificationLogs)
      .where(eq(notificationLogs.userId, user.id))
      .orderBy(desc(notificationLogs.receivedAt));

    const items: ReparseItem[] = [];
    let createCount = 0;
    let updateCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const log of logs) {
      let title = "";
      let text = "";
      try {
        const payload = JSON.parse(log.rawPayload);
        title = typeof payload.title === "string" ? payload.title : "";
        text = typeof payload.text === "string" ? payload.text : "";
      } catch {
        skipCount++;
        items.push({
          logId: log.id,
          title: "",
          text: "",
          receivedAt: log.receivedAt.toISOString(),
          action: "skip",
          reason: "유효하지 않은 JSON",
        });
        continue;
      }

      if (!title || !text) {
        skipCount++;
        items.push({
          logId: log.id,
          title,
          text,
          receivedAt: log.receivedAt.toISOString(),
          action: "skip",
          reason: "title 또는 text 누락",
        });
        continue;
      }

      const parsed = parseTossNotification(title, text);
      if (!parsed) {
        skipCount++;
        items.push({
          logId: log.id,
          title,
          text,
          receivedAt: log.receivedAt.toISOString(),
          action: "skip",
          reason: "파싱 실패 (패턴 불일치)",
        });
        continue;
      }

      // Check for existing transaction for this exact log
      const existingForLog = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, user.id),
            eq(transactions.notificationLogId, log.id),
          ),
        )
        .limit(1);

      const hasExistingForLog = existingForLog.length > 0;

      // Check for duplicate transactions within ±2 minutes with same amount & merchant & type
      // (different notification log but same real-world transaction)
      const windowMs = 2 * 60 * 1000;
      const receivedAt = new Date(log.receivedAt);
      const windowStart = new Date(receivedAt.getTime() - windowMs);
      const windowEnd = new Date(receivedAt.getTime() + windowMs);

      const duplicates = await db
        .select({ id: transactions.id, notificationLogId: transactions.notificationLogId })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, user.id),
            eq(transactions.amount, parsed.amount),
            eq(transactions.merchant, parsed.merchant),
            eq(transactions.type, parsed.type),
            gte(transactions.transactedAt, windowStart),
            lte(transactions.transactedAt, windowEnd),
          ),
        )
        .limit(1);

      // If a duplicate exists for a DIFFERENT log, skip (same real-world transaction)
      if (duplicates.length > 0 && duplicates[0].notificationLogId !== log.id) {
        skipCount++;
        items.push({
          logId: log.id,
          title,
          text,
          receivedAt: log.receivedAt.toISOString(),
          action: "skip",
          reason: "중복 거래 (±2분 내 동일 금액/가맹점)",
          parsed,
        });
        continue;
      }

      const action = hasExistingForLog ? "update" : "create";
      if (action === "create") createCount++;
      else updateCount++;

      items.push({
        logId: log.id,
        title,
        text,
        receivedAt: log.receivedAt.toISOString(),
        action,
        parsed,
      });

      // Apply if not dry-run
      if (!dryRun) {
        try {
          await db
            .insert(transactions)
            .values({
              userId: user.id,
              notificationLogId: log.id,
              type: parsed.type,
              amount: parsed.amount,
              merchant: parsed.merchant,
              accountName: parsed.accountName,
              rawTitle: title,
              rawText: text,
              transactedAt: receivedAt,
              createdAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [transactions.userId, transactions.notificationLogId],
              set: {
                type: sql`excluded.type`,
                amount: sql`excluded.amount`,
                merchant: sql`excluded.merchant`,
                accountName: sql`excluded.account_name`,
                rawTitle: sql`excluded.raw_title`,
                rawText: sql`excluded.raw_text`,
              },
            });
        } catch {
          failCount++;
        }
      }
    }

    logger.info(`Reparse ${dryRun ? "dry-run" : "applied"}`, {
      userId: user.id,
      total: logs.length,
      created: createCount,
      updated: updateCount,
      skipped: skipCount,
      failed: failCount,
    });

    return NextResponse.json({
      dryRun,
      total: logs.length,
      created: createCount,
      updated: updateCount,
      skipped: skipCount,
      failed: failCount,
      items,
    });
  } catch (error) {
    logger.error("Reparse error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "재파싱 실패" }, { status: 500 });
  }
}
