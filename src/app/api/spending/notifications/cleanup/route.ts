/**
 * Notification Cleanup API (session-authenticated, streaming progress)
 *
 * POST /api/spending/notifications/cleanup
 * Body: { "dryRun": true }  — preview only (default)
 * Body: { "dryRun": false } — reparse + delete unparseable logs
 *
 * Phase 1: Reparse all logs (always applied, regardless of dryRun)
 * Phase 2: Identify deletable logs (no transaction + unparseable)
 * Phase 3: Batch delete (only when dryRun=false)
 *
 * NDJSON events:
 *   { "type": "reparse-start", "total": N }
 *   { "type": "reparse-progress", "processed": X, "total": N, "created": C, "updated": U }
 *   { "type": "reparse-done", "created": C, "updated": U, "skipped": S }
 *   { "type": "cleanup-start", "deletable": D, "estimatedBytes": B, "items": [...] }
 *   { "type": "cleanup-progress", "deleted": X, "total": D }
 *   { "type": "cleanup-done", "deleted": D, "freedBytes": B }
 */

import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { notificationLogs, transactions } from "@/db/schema";
import { eq, and, gte, lte, desc, sql, isNull, inArray } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";
import { logger } from "@/lib/logger";
import { parseTossNotification } from "@/modules/transaction/parser";

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
        // ===== Phase 1: Reparse (always applied) =====
        const allLogs = await db
          .select({
            id: notificationLogs.id,
            rawPayload: notificationLogs.rawPayload,
            receivedAt: notificationLogs.receivedAt,
          })
          .from(notificationLogs)
          .where(eq(notificationLogs.userId, userId))
          .orderBy(desc(notificationLogs.receivedAt));

        send({ type: "reparse-start", total: allLogs.length });

        let createCount = 0;
        let updateCount = 0;
        let skipCount = 0;
        const progressInterval = Math.max(1, Math.floor(allLogs.length / 50));

        for (let i = 0; i < allLogs.length; i++) {
          const log = allLogs[i];
          let title = "";
          let text = "";
          try {
            const payload = JSON.parse(log.rawPayload);
            title = typeof payload.title === "string" ? payload.title : "";
            text = typeof payload.text === "string" ? payload.text : "";
          } catch {
            skipCount++;
            if ((i + 1) % progressInterval === 0) {
              send({
                type: "reparse-progress",
                processed: i + 1,
                total: allLogs.length,
                created: createCount,
                updated: updateCount,
              });
            }
            continue;
          }

          if (!title || !text) {
            skipCount++;
            if ((i + 1) % progressInterval === 0) {
              send({
                type: "reparse-progress",
                processed: i + 1,
                total: allLogs.length,
                created: createCount,
                updated: updateCount,
              });
            }
            continue;
          }

          const parsed = parseTossNotification(title, text);
          if (!parsed) {
            skipCount++;
            if ((i + 1) % progressInterval === 0) {
              send({
                type: "reparse-progress",
                processed: i + 1,
                total: allLogs.length,
                created: createCount,
                updated: updateCount,
              });
            }
            continue;
          }

          // Check for existing transaction for this log
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
            if ((i + 1) % progressInterval === 0) {
              send({
                type: "reparse-progress",
                processed: i + 1,
                total: allLogs.length,
                created: createCount,
                updated: updateCount,
              });
            }
            continue;
          }

          if (hasExistingForLog) {
            updateCount++;
          } else {
            createCount++;
          }

          // Always apply reparse (regardless of dryRun)
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
            // Ignore individual insert errors
          }

          if ((i + 1) % progressInterval === 0) {
            send({
              type: "reparse-progress",
              processed: i + 1,
              total: allLogs.length,
              created: createCount,
              updated: updateCount,
            });
          }
        }

        send({
          type: "reparse-done",
          created: createCount,
          updated: updateCount,
          skipped: skipCount,
        });

        // ===== Phase 2: Identify deletable logs =====
        // LEFT JOIN to find logs without any transaction
        const orphanLogs = await db
          .select({
            id: notificationLogs.id,
            rawPayload: notificationLogs.rawPayload,
            headers: notificationLogs.headers,
            receivedAt: notificationLogs.receivedAt,
          })
          .from(notificationLogs)
          .leftJoin(transactions, eq(transactions.notificationLogId, notificationLogs.id))
          .where(
            and(eq(notificationLogs.userId, userId), isNull(transactions.id)),
          );

        // Filter: only those that parseTossNotification returns null
        const deletableItems: {
          id: string;
          title: string;
          text: string;
          receivedAt: string;
          reason: string;
          bytes: number;
        }[] = [];

        for (const log of orphanLogs) {
          let title = "";
          let text = "";
          let reason = "파싱 불가";
          try {
            const payload = JSON.parse(log.rawPayload);
            title = typeof payload.title === "string" ? payload.title : "";
            text = typeof payload.text === "string" ? payload.text : "";
          } catch {
            reason = "유효하지 않은 JSON";
          }

          // Double-check: if it's parseable, skip (shouldn't happen after reparse, but safety)
          if (title && text) {
            const parsed = parseTossNotification(title, text);
            if (parsed) continue;
            reason = "패턴 불일치";
          } else if (!title && !text) {
            reason = "title/text 없음";
          }

          const bytes = (log.rawPayload?.length || 0) + (log.headers?.length || 0);
          deletableItems.push({
            id: log.id,
            title,
            text,
            receivedAt: log.receivedAt.toISOString(),
            reason,
            bytes,
          });
        }

        const estimatedBytes = deletableItems.reduce((sum, item) => sum + item.bytes, 0);

        send({
          type: "cleanup-start",
          deletable: deletableItems.length,
          estimatedBytes,
          items: deletableItems.map(({ id, title, text, receivedAt, reason, bytes }) => ({
            logId: id,
            title,
            text,
            receivedAt,
            reason,
            bytes,
          })),
        });

        // ===== Phase 3: Batch delete (only when dryRun=false) =====
        if (!dryRun && deletableItems.length > 0) {
          const BATCH_SIZE = 100;
          let totalDeleted = 0;

          for (let i = 0; i < deletableItems.length; i += BATCH_SIZE) {
            const batch = deletableItems.slice(i, i + BATCH_SIZE);
            const ids = batch.map((item) => item.id);

            await db
              .delete(notificationLogs)
              .where(
                and(eq(notificationLogs.userId, userId), inArray(notificationLogs.id, ids)),
              );

            totalDeleted += batch.length;
            send({
              type: "cleanup-progress",
              deleted: totalDeleted,
              total: deletableItems.length,
            });
          }

          send({
            type: "cleanup-done",
            deleted: totalDeleted,
            freedBytes: estimatedBytes,
          });

          logger.info("Notification cleanup applied", {
            userId,
            reparsed: { created: createCount, updated: updateCount, skipped: skipCount },
            deleted: totalDeleted,
            freedBytes: estimatedBytes,
          });
        } else {
          logger.info("Notification cleanup dry-run", {
            userId,
            reparsed: { created: createCount, updated: updateCount, skipped: skipCount },
            deletable: deletableItems.length,
            estimatedBytes,
          });
        }
      } catch (err) {
        logger.error("Notification cleanup error", {
          error: err instanceof Error ? err.message : String(err),
        });
        send({ type: "error", error: "정리 실패" });
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
