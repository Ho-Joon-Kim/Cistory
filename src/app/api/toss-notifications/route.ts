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

/**
 * MacroDroid forwards Toss notification text with literal LF/CR/TAB inside
 * JSON string values (e.g. multi-line receipts: "체크카드 | 가게\n..."), which
 * makes the payload invalid JSON. JSON.parse throws on the first 0x0a and the
 * caller's silent catch block was dropping every transaction since 4/20. This
 * scanner walks the raw bytes and escapes control chars only while inside a
 * JSON string, leaving structure ("`{`/`}`/`,`/whitespace) untouched. Cheap
 * (single pass) and never makes valid input invalid.
 */
function sanitizeMacrodroidJson(raw: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      out += c;
      inString = !inString;
      continue;
    }
    if (inString) {
      if (c === "\n") {
        out += "\\n";
        continue;
      }
      if (c === "\r") {
        out += "\\r";
        continue;
      }
      if (c === "\t") {
        out += "\\t";
        continue;
      }
    }
    out += c;
  }
  return out;
}

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

    // Try parsing as a transaction (출금/입금/결제/송금수신)
    let parsed = null;
    let parseSkipReason: string | null = null;
    let parseTitleLen = 0;
    let parseTextLen = 0;
    let parseError: string | null = null;
    try {
      const payload = JSON.parse(sanitizeMacrodroidJson(rawPayload));
      const title = typeof payload.title === "string" ? payload.title : "";
      const text = typeof payload.text === "string" ? payload.text : "";
      parseTitleLen = title.length;
      parseTextLen = text.length;

      // Title-only patterns (e.g. "OOO님이 N원을 보냈어요") are valid even when
      // notification text is empty — gating on `title && text` was silently
      // dropping every transfer-received notification, which is what broke
      // transactions parsing after 4/20 when Toss started shipping a few of
      // those without text bodies.
      if (!title) {
        parseSkipReason = "no_title";
      } else {
        parsed = parseTossNotification(title, text, { myName: tossMyName });
        if (!parsed) {
          parseSkipReason = "no_pattern_match";
        } else {
          await db.insert(transactions).values({
            userId,
            notificationLogId: inserted.id,
            type: parsed.type,
            amount: parsed.amount,
            merchant: parsed.merchant,
            accountName: parsed.accountName,
            isSelfTransfer: parsed.isSelfTransfer,
            rawTitle: title,
            rawText: text,
            transactedAt: now,
            createdAt: now,
          });
        }
      }
    } catch (err) {
      // Raw log is already saved; surface the failure reason to logging so
      // the parser regression that caused the 4/20 outage is visible next
      // time instead of dying silently.
      parseError = err instanceof Error ? err.message : String(err);
      parseSkipReason = "exception";
    }

    if (parsed) {
      logger.info("Toss notification parsed", { userId, type: parsed.type });
    } else {
      logger.warn("Toss notification parse skipped", {
        userId,
        reason: parseSkipReason,
        titleLen: parseTitleLen,
        textLen: parseTextLen,
        error: parseError,
      });
    }

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
