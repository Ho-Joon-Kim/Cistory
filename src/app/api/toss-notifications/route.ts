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

import { desc, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { notificationLogs, transactions } from "@/db/schema";
import { checkBodySize, enforceRateLimit, logIngestionFailure, verifyApiKey } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import { parseTossNotification } from "@/modules/transaction/parser";

export async function POST(request: NextRequest) {
  try {
    const body = checkBodySize(request);
    if (!body.ok) {
      logIngestionFailure("toss-notifications", "body_too_large", request);
      return NextResponse.json({ error: "요청이 너무 큽니다" }, { status: 413 });
    }

    const rate = enforceRateLimit(request, "toss-notifications");
    if (!rate.allowed) {
      logIngestionFailure("toss-notifications", "rate_limited", request);
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    const apikey = request.nextUrl.searchParams.get("apikey");
    const authed = await verifyApiKey(apikey, "tossNotificationApiKey");
    if (!authed) {
      logIngestionFailure("toss-notifications", "auth_failed", request);
      return NextResponse.json({ error: "인증 실패" }, { status: 401 });
    }

    const { id: userId, tossMyName } = authed;

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
        parsed = parseTossNotification(title, text, { myName: tossMyName });
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
    const rate = enforceRateLimit(request, "toss-notifications-get");
    if (!rate.allowed) {
      logIngestionFailure("toss-notifications", "rate_limited", request);
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    const apikey = request.nextUrl.searchParams.get("apikey");
    const authed = await verifyApiKey(apikey, "tossNotificationApiKey");
    if (!authed) {
      logIngestionFailure("toss-notifications", "auth_failed", request);
      return NextResponse.json({ error: "인증 실패" }, { status: 401 });
    }

    const userId = authed.id;

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
