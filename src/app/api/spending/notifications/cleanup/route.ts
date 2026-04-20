/**
 * Notification Cleanup API (session-authenticated, streaming progress)
 *
 * POST /api/spending/notifications/cleanup
 * Body: { "dryRun": true }  — preview only (default)
 * Body: { "dryRun": false } — reparse + delete unparseable logs
 *
 * Phase 1: Reparse all logs (always applied, via shared reparse-service)
 * Phase 2: Identify deletable logs (no transaction + unparseable)
 * Phase 3: Batch delete (only when dryRun=false)
 *
 * NDJSON event shape preserved for client compatibility:
 *   { "type": "reparse-start", "total": N }
 *   { "type": "reparse-progress", "processed", "total", "created", "updated" }
 *   { "type": "reparse-done", "created", "updated", "skipped" }
 *   { "type": "cleanup-start", "deletable", "estimatedBytes", "items" }
 *   { "type": "cleanup-progress", "deleted", "total" }
 *   { "type": "cleanup-done", "deleted", "freedBytes" }
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/db";
import { notificationLogs, transactions, users } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { parseTossNotification } from "@/modules/transaction/parser";
import { type ReparseProgress, reparseNotifications } from "@/modules/transaction/reparse-service";

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error) return error;

  let dryRun = true;
  try {
    const body = await request.json();
    if (body.dryRun === false) dryRun = false;
  } catch {
    // Default dryRun
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
        const [userRow] = await db
          .select({ tossMyName: users.tossMyName })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const tossMyName = userRow?.tossMyName ?? null;

        // ===== Phase 1: Reparse =====
        let startSent = false;
        let progressThrottle = 1;
        const onProgress = (p: ReparseProgress) => {
          if (!startSent) {
            send({ type: "reparse-start", total: p.total });
            progressThrottle = Math.max(1, Math.floor(p.total / 50));
            startSent = true;
          }
          if (p.processed % progressThrottle === 0 || p.processed === p.total) {
            send({
              type: "reparse-progress",
              processed: p.processed,
              total: p.total,
              created: p.created,
              updated: p.updated,
            });
          }
        };

        const totals = await reparseNotifications(db, userId, {
          dryRun, // When dryRun=true we still don't write; when false we apply.
          tossMyName,
          onProgress,
        });

        if (!startSent) send({ type: "reparse-start", total: 0 });

        send({
          type: "reparse-done",
          created: totals.created,
          updated: totals.updated,
          skipped: totals.skipped,
        });

        // ===== Phase 2: Identify deletable logs =====
        const orphanLogs = await db
          .select({
            id: notificationLogs.id,
            rawPayload: notificationLogs.rawPayload,
            headers: notificationLogs.headers,
            receivedAt: notificationLogs.receivedAt,
          })
          .from(notificationLogs)
          .leftJoin(transactions, eq(transactions.notificationLogId, notificationLogs.id))
          .where(and(eq(notificationLogs.userId, userId), isNull(transactions.id)));

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

          if (title && text) {
            const parsed = parseTossNotification(title, text, { myName: tossMyName });
            if (parsed) continue; // Shouldn't happen after reparse, but safety
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
              .where(and(eq(notificationLogs.userId, userId), inArray(notificationLogs.id, ids)));

            totalDeleted += batch.length;
            send({
              type: "cleanup-progress",
              deleted: totalDeleted,
              total: deletableItems.length,
            });
          }

          send({ type: "cleanup-done", deleted: totalDeleted, freedBytes: estimatedBytes });

          logger.info("Notification cleanup applied", {
            userId,
            reparsed: {
              created: totals.created,
              updated: totals.updated,
              skipped: totals.skipped,
            },
            deleted: totalDeleted,
            freedBytes: estimatedBytes,
          });
        } else {
          logger.info("Notification cleanup dry-run", {
            userId,
            reparsed: {
              created: totals.created,
              updated: totals.updated,
              skipped: totals.skipped,
            },
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
