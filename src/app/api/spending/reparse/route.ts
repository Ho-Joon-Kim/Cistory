/**
 * Reparse API (session-authenticated, streaming progress)
 *
 * POST /api/spending/reparse
 * Body: { "dryRun": true } — preview only (default)
 * Body: { "dryRun": false } — actually apply changes
 *
 * Streams NDJSON progress events:
 *   { "type": "start", "total": 150 }
 *   { "type": "progress", "processed": 10, "total": 150, "created": 2, "updated": 1, "skipped": 7, "failed": 0 }
 *   { "type": "item", ... }  (only for create/update actions)
 *   { "type": "done", "dryRun": true, "total": 150, "created": ..., "items": [...] }
 */

import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { notificationLogs, transactions, users } from "@/db/schema";
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
  const userId = user.id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
      };

      try {
        // Load user's tossMyName for self-transfer filtering
        const [userRow] = await db
          .select({ tossMyName: users.tossMyName })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const tossMyName = userRow?.tossMyName ?? null;

        // Fetch all notification logs
        const logs = await db
          .select({
            id: notificationLogs.id,
            rawPayload: notificationLogs.rawPayload,
            receivedAt: notificationLogs.receivedAt,
          })
          .from(notificationLogs)
          .where(eq(notificationLogs.userId, userId))
          .orderBy(desc(notificationLogs.receivedAt));

        send({ type: "start", total: logs.length });

        const items: ReparseItem[] = [];
        let createCount = 0;
        let updateCount = 0;
        let skipCount = 0;
        let failCount = 0;

        // Send progress every N items to avoid flooding
        const progressInterval = Math.max(1, Math.floor(logs.length / 50));

        for (let i = 0; i < logs.length; i++) {
          const log = logs[i];
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
            if ((i + 1) % progressInterval === 0) {
              send({
                type: "progress",
                processed: i + 1,
                total: logs.length,
                created: createCount,
                updated: updateCount,
                skipped: skipCount,
                failed: failCount,
              });
            }
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
            if ((i + 1) % progressInterval === 0) {
              send({
                type: "progress",
                processed: i + 1,
                total: logs.length,
                created: createCount,
                updated: updateCount,
                skipped: skipCount,
                failed: failCount,
              });
            }
            continue;
          }

          const parsed = parseTossNotification(title, text, { myName: tossMyName });
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
            if ((i + 1) % progressInterval === 0) {
              send({
                type: "progress",
                processed: i + 1,
                total: logs.length,
                created: createCount,
                updated: updateCount,
                skipped: skipCount,
                failed: failCount,
              });
            }
            continue;
          }

          // Check for existing transaction for this exact log
          const existingForLog = await db
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(eq(transactions.userId, userId), eq(transactions.notificationLogId, log.id)),
            )
            .limit(1);

          const hasExistingForLog = existingForLog.length > 0;

          // Check for duplicate transactions within ±2 minutes
          const windowMs = 2 * 60 * 1000;
          const receivedAt = new Date(log.receivedAt);
          const windowStart = new Date(receivedAt.getTime() - windowMs);
          const windowEnd = new Date(receivedAt.getTime() + windowMs);

          const duplicates = await db
            .select({ id: transactions.id, notificationLogId: transactions.notificationLogId })
            .from(transactions)
            .where(
              and(
                eq(transactions.userId, userId),
                eq(transactions.amount, parsed.amount),
                eq(transactions.merchant, parsed.merchant),
                eq(transactions.type, parsed.type),
                gte(transactions.transactedAt, windowStart),
                lte(transactions.transactedAt, windowEnd),
              ),
            )
            .limit(1);

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
            if ((i + 1) % progressInterval === 0) {
              send({
                type: "progress",
                processed: i + 1,
                total: logs.length,
                created: createCount,
                updated: updateCount,
                skipped: skipCount,
                failed: failCount,
              });
            }
            continue;
          }

          const action = hasExistingForLog ? "update" : "create";
          if (action === "create") createCount++;
          else updateCount++;

          const item: ReparseItem = {
            logId: log.id,
            title,
            text,
            receivedAt: log.receivedAt.toISOString(),
            action,
            parsed,
          };
          items.push(item);

          // Stream actionable items immediately
          send({ type: "item", ...item });

          // Apply if not dry-run
          if (!dryRun) {
            try {
              await db
                .insert(transactions)
                .values({
                  userId,
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

          // Send progress update
          if ((i + 1) % progressInterval === 0) {
            send({
              type: "progress",
              processed: i + 1,
              total: logs.length,
              created: createCount,
              updated: updateCount,
              skipped: skipCount,
              failed: failCount,
            });
          }
        }

        logger.info(`Reparse ${dryRun ? "dry-run" : "applied"}`, {
          userId,
          total: logs.length,
          created: createCount,
          updated: updateCount,
          skipped: skipCount,
          failed: failCount,
        });

        send({
          type: "done",
          dryRun,
          total: logs.length,
          created: createCount,
          updated: updateCount,
          skipped: skipCount,
          failed: failCount,
          items: items.filter((i) => i.action !== "skip"),
        });
      } catch (err) {
        logger.error("Reparse error", {
          error: err instanceof Error ? err.message : String(err),
        });
        send({ type: "error", error: "재파싱 실패" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
