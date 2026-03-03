/**
 * Toss Notification Log API (MacroDroid integration)
 *
 * POST /api/toss-notifications?apikey={key}
 * Receives raw notification data from MacroDroid.
 * Stores everything as-is for later inspection and parsing development.
 *
 * GET /api/toss-notifications?apikey={key}&limit=50&offset=0
 * Returns stored notification logs for inspection.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { users, notificationLogs, transactions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { parseTossNotification } from "@/modules/transaction/parser";

async function authenticateByApiKey(apikey: string | null) {
  if (!apikey) return null;

  const db = getDb();
  const result = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tossNotificationApiKey, apikey))
    .limit(1);

  return result.length > 0 ? result[0].id : null;
}

export async function POST(request: NextRequest) {
  try {
    const apikey = request.nextUrl.searchParams.get("apikey");
    const userId = await authenticateByApiKey(apikey);

    if (!userId) {
      return NextResponse.json({ error: "인증 실패" }, { status: 401 });
    }

    // Always read as text first — MacroDroid may send malformed JSON
    // with control characters (newlines, tabs in notification text)
    const rawPayload = await request.text();

    // Capture useful headers for debugging
    const headerEntries: Record<string, string> = {};
    for (const key of ["content-type", "user-agent", "x-forwarded-for", "x-real-ip"]) {
      const value = request.headers.get(key);
      if (value) headerEntries[key] = value;
    }

    const db = getDb();
    const now = new Date();
    const [inserted] = await db
      .insert(notificationLogs)
      .values({
        userId,
        source: "toss",
        rawPayload,
        headers: JSON.stringify(headerEntries),
        receivedAt: now,
      })
      .returning({ id: notificationLogs.id });

    // Try parsing as a transaction (출금/입금)
    let parsed = null;
    try {
      const payload = JSON.parse(rawPayload);
      const title = typeof payload.title === "string" ? payload.title : "";
      const text = typeof payload.text === "string" ? payload.text : "";

      if (title && text) {
        parsed = parseTossNotification(title, text);
        if (parsed) {
          await db.insert(transactions).values({
            userId,
            notificationLogId: inserted.id,
            type: parsed.type,
            amount: parsed.amount,
            merchant: parsed.merchant,
            accountName: parsed.accountName,
            rawTitle: title,
            rawText: text,
            transactedAt: now,
            createdAt: now,
          });
        }
      }
    } catch {
      // Parse failure is fine — raw log is already saved
    }

    logger.info("Toss notification received", {
      userId,
      transactionParsed: parsed !== null,
    });

    return NextResponse.json({ success: true, transactionParsed: parsed !== null });
  } catch (error) {
    logger.error("Toss notification ingestion error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const apikey = request.nextUrl.searchParams.get("apikey");
    const userId = await authenticateByApiKey(apikey);

    if (!userId) {
      return NextResponse.json({ error: "인증 실패" }, { status: 401 });
    }

    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 50, 200);
    const offset = Number(request.nextUrl.searchParams.get("offset")) || 0;

    const db = getDb();
    const logs = await db
      .select({
        id: notificationLogs.id,
        source: notificationLogs.source,
        rawPayload: notificationLogs.rawPayload,
        headers: notificationLogs.headers,
        receivedAt: notificationLogs.receivedAt,
      })
      .from(notificationLogs)
      .where(eq(notificationLogs.userId, userId))
      .orderBy(desc(notificationLogs.receivedAt))
      .limit(limit)
      .offset(offset);

    // Parse JSON fields for readability
    const parsed = logs.map((log) => ({
      ...log,
      rawPayload: tryParseJson(log.rawPayload),
      headers: log.headers ? tryParseJson(log.headers) : null,
    }));

    return NextResponse.json({ logs: parsed, count: parsed.length, limit, offset });
  } catch (error) {
    logger.error("Toss notification fetch error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}

function tryParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
