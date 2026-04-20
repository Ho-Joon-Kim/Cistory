/**
 * Reparse API (session-authenticated, streaming progress)
 *
 * POST /api/spending/reparse
 * Body: { "dryRun": true } — preview only (default)
 * Body: { "dryRun": false } — actually apply changes
 *
 * Streams NDJSON progress events. The heavy lifting lives in
 * modules/transaction/reparse-service — this route is a thin SSE wrapper.
 */

import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import {
  type ReparseItem,
  type ReparseProgress,
  reparseNotifications,
} from "@/modules/transaction/reparse-service";

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
        const [userRow] = await db
          .select({ tossMyName: users.tossMyName })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const tossMyName = userRow?.tossMyName ?? null;

        const items: ReparseItem[] = [];
        let startSent = false;
        let progressThrottle = 1;
        const onProgress = (p: ReparseProgress) => {
          if (!startSent) {
            send({ type: "start", total: p.total });
            // Throttle so we emit ~50 progress events across the batch.
            progressThrottle = Math.max(1, Math.floor(p.total / 50));
            startSent = true;
          }
          if (p.processed % progressThrottle === 0 || p.processed === p.total) {
            send({
              type: "progress",
              processed: p.processed,
              total: p.total,
              created: p.created,
              updated: p.updated,
              skipped: p.skipped,
              failed: p.failed,
            });
          }
        };

        const onItem = (item: ReparseItem) => {
          items.push(item);
          if (item.action !== "skip") send({ type: "item", ...item });
        };

        const totals = await reparseNotifications(db, userId, {
          dryRun,
          tossMyName,
          onProgress,
          onItem,
        });

        if (!startSent) send({ type: "start", total: 0 });

        logger.info(`Reparse ${dryRun ? "dry-run" : "applied"}`, {
          userId,
          total: totals.total,
          created: totals.created,
          updated: totals.updated,
          skipped: totals.skipped,
          failed: totals.failed,
        });

        send({
          type: "done",
          dryRun,
          total: totals.total,
          created: totals.created,
          updated: totals.updated,
          skipped: totals.skipped,
          failed: totals.failed,
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
