/**
 * Owner alerts for MCP denials (plan U10), sent to a Telegram bot.
 *
 * Flow: `alerts-hook.ts#onDenied` → `scheduleMcpAlert(event)`, which defers the
 * work to a later macrotask and never lets it reject, so the request path
 * neither waits for nor fails on it. The deferred work claims a debounce slot
 * in `mcp_alert_state` and sends one fixed Korean message when the slot says so.
 *
 * Debounce and cap — the exact rule, evaluated under a per-user
 * `pg_advisory_xact_lock('mcp-alert:<userId>')` in one transaction:
 *   1. Window claim. Key = (user, token_key, reason, ip, 15-minute window start)
 *      where token_key is the token id or '' and ip is the client IP or ''.
 *      `INSERT … ON CONFLICT DO UPDATE SET hit_count = hit_count + 1` claims it
 *      atomically; only the statement that INSERTED the row may send. Every
 *      later event in the window only bumps `hit_count`.
 *   2. Daily cap (KST day). If fewer than `MCP_ALERT_DAILY_CAP` (50) alert rows
 *      of this user have `sent_at` today, the alert is sent.
 *   3. Cap bypass. Over the cap, the alert is still sent when it is the FIRST
 *      alert today for its (token_key, reason) — so a real new lock violation on
 *      another token, or a new kind of denial, is never drowned out by noise
 *      that varies its IP to open fresh windows. Bounded: tokens × reasons.
 *   4. Cap notice. Otherwise the alert is suppressed, and the first suppression
 *      of the day sends one "알림 상한 도달" message (claimed through its own
 *      `mcp_alert_state` row, reason `cap_reached`, which is excluded from the
 *      count in step 2).
 * `sent_at` is set when the slot is claimed for sending, before the HTTP call:
 * a failed Telegram request is not retried (alerts are best-effort and must
 * never amplify a flood).
 *
 * Privacy: the message carries only the reason label, the token's display
 * name, IP, country and the window count. Never arguments, data or secrets.
 * The bot token sits in the Telegram URL path, so a send failure logs only the
 * HTTP status or the error's name — never the URL or the error object.
 *
 * Timestamps are JS Dates written by Drizzle (UTC wall time); nothing here
 * relies on a DB `DEFAULT now()`.
 */

import { and, count, eq, gte, lt, ne, sql } from "drizzle-orm";
import { type Database, getDb } from "@/db";
import { mcpAlertState } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { McpDeniedEvent } from "./alerts-hook";
import type { McpDenyReason } from "./audit";

export const MCP_ALERT_WINDOW_MS = 15 * 60 * 1000;
export const MCP_ALERT_DAILY_CAP = 50;
export const MCP_ALERT_SEND_TIMEOUT_MS = 5_000;
/** Rows older than this are pruned by the next claim of the same user. */
const RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const CAP_REASON = "cap_reached";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FIELD_LENGTH = 64;

const REASON_LABELS: Record<McpDenyReason, string> = {
  token_unrecognized: "확인되지 않은 토큰",
  token_revoked: "폐기된 토큰 사용",
  token_expired: "만료된 토큰 사용",
  ip_unknown: "IP 확인 불가 (IP 잠금)",
  ip_not_allowed: "허용되지 않은 IP (IP 잠금 위반)",
  country_unknown: "국가 확인 불가 (국가 잠금)",
  country_not_allowed: "허용되지 않은 국가 (국가 잠금 위반)",
  scope_denied: "권한 범위 밖 도구 호출",
  revoked_midflight: "실행 중 토큰 폐기",
  origin_not_allowed: "허용되지 않은 출처",
};

export function reasonLabel(reason: McpDenyReason): string {
  return REASON_LABELS[reason] ?? "접근 거부";
}

/** Start of the 15-minute window containing `now`. */
export function alertWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / MCP_ALERT_WINDOW_MS) * MCP_ALERT_WINDOW_MS);
}

/** Instant at which the KST calendar day containing `now` began. */
export function kstDayStart(now: Date): Date {
  return new Date(Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS);
}

function field(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.replace(/[\r\n\t]+/g, " ").trim();
  if (!trimmed) return fallback;
  return trimmed.length > MAX_FIELD_LENGTH ? `${trimmed.slice(0, MAX_FIELD_LENGTH)}…` : trimmed;
}

export function formatAlertMessage(event: McpDeniedEvent, windowCount: number): string {
  return [
    "[Cistory MCP] 접근 거부 알림",
    `사유: ${reasonLabel(event.reason)}`,
    `토큰 이름: ${field(event.tokenName, "알 수 없음")}`,
    `IP: ${field(event.ip, "알 수 없음")}`,
    `국가: ${field(event.country, "알 수 없음")}`,
    `창 내 건수: ${windowCount}건 (15분 단위로 묶어 한 번만 알립니다)`,
  ].join("\n");
}

export function formatCapMessage(): string {
  return [
    "[Cistory MCP] 알림 상한 도달",
    `오늘 보낸 알림이 하루 상한(${MCP_ALERT_DAILY_CAP}건)에 도달했습니다.`,
    "같은 토큰·사유의 추가 알림은 내일까지 보내지 않습니다. 설정의 MCP 감사 로그에서 전체 기록을 확인하세요.",
  ].join("\n");
}

// --- Store ----------------------------------------------------------------

export interface AlertWindowKey {
  userId: string;
  tokenId: string | null;
  tokenKey: string;
  reason: string;
  ip: string;
  windowStart: Date;
}

/** Primitives the decision rule needs, bound to one locked transaction. */
export interface AlertTx {
  claimWindow(
    key: AlertWindowKey,
    now: Date
  ): Promise<{ id: string; inserted: boolean; hitCount: number }>;
  sentAlertCountSince(userId: string, since: Date): Promise<number>;
  sentForTokenReasonSince(
    userId: string,
    tokenKey: string,
    reason: string,
    since: Date
  ): Promise<boolean>;
  markSent(id: string, now: Date): Promise<void>;
  /** True only for the caller that first claims today's cap notice. */
  claimCapNotice(userId: string, dayStart: Date, now: Date): Promise<boolean>;
  pruneBefore(userId: string, before: Date): Promise<void>;
}

export interface AlertStore {
  /** Runs `fn` in one transaction holding the per-user alert lock. */
  withUserLock<T>(userId: string, fn: (tx: AlertTx) => Promise<T>): Promise<T>;
}

export function createDbAlertStore(db: Database): AlertStore {
  return {
    withUserLock(userId, fn) {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp-alert:${userId}`}, 0))`
        );
        return fn({
          async claimWindow(key, now) {
            const [row] = await tx
              .insert(mcpAlertState)
              .values({
                userId: key.userId,
                tokenId: key.tokenId,
                tokenKey: key.tokenKey,
                reason: key.reason,
                ip: key.ip,
                windowStart: key.windowStart,
                hitCount: 1,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: [
                  mcpAlertState.userId,
                  mcpAlertState.tokenKey,
                  mcpAlertState.reason,
                  mcpAlertState.ip,
                  mcpAlertState.windowStart,
                ],
                set: { hitCount: sql`${mcpAlertState.hitCount} + 1`, updatedAt: now },
              })
              .returning({
                id: mcpAlertState.id,
                hitCount: mcpAlertState.hitCount,
                // xmax is 0 only for a row this statement inserted.
                inserted: sql<boolean>`(xmax = 0)`,
              });
            return { id: row.id, hitCount: row.hitCount, inserted: row.inserted === true };
          },
          async sentAlertCountSince(uid, since) {
            const [row] = await tx
              .select({ n: count() })
              .from(mcpAlertState)
              .where(
                and(
                  eq(mcpAlertState.userId, uid),
                  gte(mcpAlertState.sentAt, since),
                  ne(mcpAlertState.reason, CAP_REASON)
                )
              );
            return Number(row?.n ?? 0);
          },
          async sentForTokenReasonSince(uid, tokenKey, reason, since) {
            const rows = await tx
              .select({ id: mcpAlertState.id })
              .from(mcpAlertState)
              .where(
                and(
                  eq(mcpAlertState.userId, uid),
                  eq(mcpAlertState.tokenKey, tokenKey),
                  eq(mcpAlertState.reason, reason),
                  gte(mcpAlertState.sentAt, since)
                )
              )
              .limit(1);
            return rows.length > 0;
          },
          async markSent(id, now) {
            await tx
              .update(mcpAlertState)
              .set({ sentAt: now, updatedAt: now })
              .where(eq(mcpAlertState.id, id));
          },
          async claimCapNotice(uid, dayStart, now) {
            const rows = await tx
              .insert(mcpAlertState)
              .values({
                userId: uid,
                tokenId: null,
                tokenKey: "",
                reason: CAP_REASON,
                ip: "",
                windowStart: dayStart,
                hitCount: 1,
                sentAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing()
              .returning({ id: mcpAlertState.id });
            return rows.length > 0;
          },
          async pruneBefore(uid, before) {
            await tx
              .delete(mcpAlertState)
              .where(and(eq(mcpAlertState.userId, uid), lt(mcpAlertState.windowStart, before)));
          },
        });
      });
    },
  };
}

// --- Decision -------------------------------------------------------------

export type AlertDecision =
  | { kind: "alert"; hitCount: number; bypassedCap: boolean }
  | { kind: "cap_notice" }
  | { kind: "debounced"; hitCount: number }
  | { kind: "suppressed" };

/** Applies the debounce + cap rule documented at the top of this file. */
export async function claimAlert(
  store: AlertStore,
  event: McpDeniedEvent,
  now: Date
): Promise<AlertDecision> {
  const tokenKey = event.tokenId ?? "";
  const dayStart = kstDayStart(now);
  return store.withUserLock(event.userId, async (tx) => {
    await tx.pruneBefore(event.userId, new Date(now.getTime() - RETENTION_MS));
    const claim = await tx.claimWindow(
      {
        userId: event.userId,
        tokenId: event.tokenId,
        tokenKey,
        reason: event.reason,
        ip: event.ip ?? "",
        windowStart: alertWindowStart(now),
      },
      now
    );
    if (!claim.inserted) return { kind: "debounced", hitCount: claim.hitCount };

    const sentToday = await tx.sentAlertCountSince(event.userId, dayStart);
    if (sentToday < MCP_ALERT_DAILY_CAP) {
      await tx.markSent(claim.id, now);
      return { kind: "alert", hitCount: claim.hitCount, bypassedCap: false };
    }
    const seenToday = await tx.sentForTokenReasonSince(
      event.userId,
      tokenKey,
      event.reason,
      dayStart
    );
    if (!seenToday) {
      await tx.markSent(claim.id, now);
      return { kind: "alert", hitCount: claim.hitCount, bypassedCap: true };
    }
    if (await tx.claimCapNotice(event.userId, dayStart, now)) return { kind: "cap_notice" };
    return { kind: "suppressed" };
  });
}

// --- Telegram ---------------------------------------------------------------

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

let warnedDisabled = false;

/** Reads the bot config; null (with one warning per process) when unset. */
export function readTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const botToken = env.MCP_ALERT_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.MCP_ALERT_TELEGRAM_CHAT_ID?.trim();
  if (botToken && chatId) return { botToken, chatId };
  if (!warnedDisabled) {
    warnedDisabled = true;
    logger.warn("[MCP] owner alerts disabled: Telegram bot token or chat id is not set");
  }
  return null;
}

/** Test hook: lets the "warn once" behavior be observed again. */
export function resetAlertWarningsForTest(): void {
  warnedDisabled = false;
}

/** Sends one message. Never throws; returns whether Telegram accepted it. */
export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(MCP_ALERT_SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn("[MCP] owner alert send failed", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    // Name only: the error (and its cause) can carry the URL, i.e. the bot token.
    logger.warn("[MCP] owner alert send failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

// --- Entry points -------------------------------------------------------------

export interface McpAlertDeps {
  store?: AlertStore;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/**
 * Claims the debounce slot and sends whatever the rule decided. Never throws.
 * Returns the decision (or "disabled") for tests and logs.
 */
export async function notifyMcpDenied(
  event: McpDeniedEvent,
  deps: McpAlertDeps = {}
): Promise<AlertDecision["kind"] | "disabled" | "error"> {
  const config = readTelegramConfig(deps.env);
  if (!config) return "disabled";
  try {
    const store = deps.store ?? createDbAlertStore(getDb());
    const decision = await claimAlert(store, event, deps.now?.() ?? new Date());
    if (decision.kind === "alert") {
      await sendTelegramMessage(config, formatAlertMessage(event, decision.hitCount), deps.fetch);
    } else if (decision.kind === "cap_notice") {
      await sendTelegramMessage(config, formatCapMessage(), deps.fetch);
    }
    return decision.kind;
  } catch (error) {
    // Name only — DB errors embed query parameters.
    logger.warn("[MCP] owner alert failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return "error";
  }
}

/**
 * Fire-and-forget: defers the alert past the current request's synchronous
 * work and swallows every failure. The caller must not await anything.
 */
export function scheduleMcpAlert(event: McpDeniedEvent, deps: McpAlertDeps = {}): void {
  setImmediate(() => {
    notifyMcpDenied(event, deps).catch(() => {
      // notifyMcpDenied never rejects; this guards against a future change.
    });
  });
}
