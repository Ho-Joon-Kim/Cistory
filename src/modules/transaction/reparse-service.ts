/**
 * Shared Toss notification reparse pipeline.
 *
 * Single source of truth for:
 *   - /api/spending/reparse         (session-triggered, user-visible)
 *   - /api/spending/notifications/cleanup (phase 1 reparse before deletion)
 *   - Daily cron reparseTodayNotifications
 *
 * The three callers previously each implemented nearly identical N+1 DB loops
 * (existingForLog + duplicate-window query per log). This service instead
 * indexes the user's transactions once at the start and does all dedupe / diff
 * checks in-memory.
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Database } from "@/db";
import { notificationLogs, transactions } from "@/db/schema";
import { parseTossNotification } from "@/modules/transaction/parser";

export type ReparseAction = "create" | "update" | "skip";

export interface ReparseItem {
  logId: string;
  title: string;
  text: string;
  receivedAt: string;
  action: ReparseAction;
  reason?: string;
  parsed?: {
    type: string;
    amount: number;
    merchant: string;
    accountName: string;
    isSelfTransfer: boolean;
  };
}

export interface ReparseTotals {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface ReparseProgress extends ReparseTotals {
  processed: number;
}

export interface ReparseOptions {
  dryRun: boolean;
  /** Restrict to logs with receivedAt within [from, to); defaults to all. */
  from?: Date;
  to?: Date;
  /** User's Toss account owner name; used to flag self-transfers. */
  tossMyName: string | null;
  /** Emitted after each log is handled; caller can throttle if it wants. */
  onProgress?: (p: ReparseProgress) => void;
  /** Emitted once per create/update so callers can stream items. */
  onItem?: (item: ReparseItem) => void;
}

interface TxKey {
  ymd: string;
  amount: number;
  merchant: string;
  type: string;
}

function txWindowKey(k: TxKey): string {
  return `${k.ymd}:${k.type}:${k.amount}:${k.merchant}`;
}

function dateToYmd(d: Date): string {
  // Minute granularity is coarse enough to collapse the ±2min dup window;
  // exact ±2min check is still done on the row itself after Map lookup
  // via transactedAt comparison when needed. For now, ymd keys group
  // same-day entries and let us do O(1) candidate lookup.
  return d.toISOString().slice(0, 10);
}

/**
 * Reparse a user's Toss notification logs against the current parser + stored
 * transactions. All heavy DB work runs inside a single pass:
 *
 *   1. One SELECT for all logs in range.
 *   2. One SELECT for all transactions linked to those logs (keyed by logId)
 *      + all transactions in a slightly-wider time window (for the ±2min
 *      duplicate check).
 *   3. Per-log: pure in-memory parse/compare, plus a single upsert on
 *      create/update when !dryRun.
 */
export async function reparseNotifications(
  db: Database,
  userId: string,
  options: ReparseOptions
): Promise<ReparseTotals> {
  const { dryRun, from, to, tossMyName, onProgress, onItem } = options;

  // ── Load logs ──
  const logWhere = [eq(notificationLogs.userId, userId)];
  if (from) logWhere.push(gte(notificationLogs.receivedAt, from));
  if (to) logWhere.push(lte(notificationLogs.receivedAt, to));

  const logs = await db
    .select({
      id: notificationLogs.id,
      rawPayload: notificationLogs.rawPayload,
      receivedAt: notificationLogs.receivedAt,
    })
    .from(notificationLogs)
    .where(and(...logWhere))
    .orderBy(desc(notificationLogs.receivedAt));

  // ── Index existing transactions (P5 fix: batched instead of per-log) ──
  const existingTxByLogId = new Map<
    string,
    {
      id: string;
      type: string;
      amount: number;
      merchant: string;
      accountName: string;
      transactedAt: Date;
    }
  >();
  const txByWindowKey = new Map<string, { notificationLogId: string; transactedAt: Date }[]>();

  // Load the user's transactions in the widest range we'll inspect. If the log
  // window is bounded, add ±1 day buffer so ±2min dup checks across boundary
  // still see candidates.
  const txWhere = [eq(transactions.userId, userId)];
  if (from) txWhere.push(gte(transactions.transactedAt, new Date(from.getTime() - 86_400_000)));
  if (to) txWhere.push(lte(transactions.transactedAt, new Date(to.getTime() + 86_400_000)));

  const existingTxs = await db
    .select({
      id: transactions.id,
      notificationLogId: transactions.notificationLogId,
      type: transactions.type,
      amount: transactions.amount,
      merchant: transactions.merchant,
      accountName: transactions.accountName,
      transactedAt: transactions.transactedAt,
    })
    .from(transactions)
    .where(and(...txWhere));

  for (const tx of existingTxs) {
    existingTxByLogId.set(tx.notificationLogId, tx);
    const key = txWindowKey({
      ymd: dateToYmd(tx.transactedAt),
      amount: tx.amount,
      merchant: tx.merchant,
      type: tx.type,
    });
    const arr = txByWindowKey.get(key);
    if (arr) arr.push({ notificationLogId: tx.notificationLogId, transactedAt: tx.transactedAt });
    else
      txByWindowKey.set(key, [
        { notificationLogId: tx.notificationLogId, transactedAt: tx.transactedAt },
      ]);
  }

  // ── Pipeline ──
  const totals: ReparseTotals = {
    total: logs.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  const DUP_WINDOW_MS = 2 * 60 * 1000;

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    let title = "";
    let text = "";

    try {
      const payload = JSON.parse(log.rawPayload);
      title = typeof payload.title === "string" ? payload.title : "";
      text = typeof payload.text === "string" ? payload.text : "";
    } catch {
      totals.skipped++;
      onItem?.({
        logId: log.id,
        title: "",
        text: "",
        receivedAt: log.receivedAt.toISOString(),
        action: "skip",
        reason: "유효하지 않은 JSON",
      });
      onProgress?.({ ...totals, processed: i + 1 });
      continue;
    }

    if (!title || !text) {
      totals.skipped++;
      onItem?.({
        logId: log.id,
        title,
        text,
        receivedAt: log.receivedAt.toISOString(),
        action: "skip",
        reason: "title 또는 text 누락",
      });
      onProgress?.({ ...totals, processed: i + 1 });
      continue;
    }

    const parsed = parseTossNotification(title, text, { myName: tossMyName });
    if (!parsed) {
      totals.skipped++;
      onItem?.({
        logId: log.id,
        title,
        text,
        receivedAt: log.receivedAt.toISOString(),
        action: "skip",
        reason: "파싱 실패 (패턴 불일치)",
      });
      onProgress?.({ ...totals, processed: i + 1 });
      continue;
    }

    // Duplicate check: same-day same-amount same-merchant same-type,
    // received within ±2min, and linked to a *different* log.
    const candidates =
      txByWindowKey.get(
        txWindowKey({
          ymd: dateToYmd(log.receivedAt),
          amount: parsed.amount,
          merchant: parsed.merchant,
          type: parsed.type,
        })
      ) ?? [];
    const dup = candidates.find(
      (c) =>
        c.notificationLogId !== log.id &&
        Math.abs(c.transactedAt.getTime() - log.receivedAt.getTime()) <= DUP_WINDOW_MS
    );
    if (dup) {
      totals.skipped++;
      onItem?.({
        logId: log.id,
        title,
        text,
        receivedAt: log.receivedAt.toISOString(),
        action: "skip",
        reason: "중복 거래 (±2분 내 동일 금액/가맹점)",
        parsed,
      });
      onProgress?.({ ...totals, processed: i + 1 });
      continue;
    }

    const existing = existingTxByLogId.get(log.id) ?? null;

    let action: ReparseAction;
    if (!existing) {
      action = "create";
    } else if (
      existing.type === parsed.type &&
      existing.amount === parsed.amount &&
      existing.merchant === parsed.merchant &&
      existing.accountName === parsed.accountName
    ) {
      action = "skip";
    } else {
      action = "update";
    }

    if (action === "skip") {
      totals.skipped++;
      onItem?.({
        logId: log.id,
        title,
        text,
        receivedAt: log.receivedAt.toISOString(),
        action: "skip",
        reason: "변경 없음",
        parsed,
      });
      onProgress?.({ ...totals, processed: i + 1 });
      continue;
    }

    if (action === "create") totals.created++;
    else totals.updated++;

    onItem?.({
      logId: log.id,
      title,
      text,
      receivedAt: log.receivedAt.toISOString(),
      action,
      parsed,
    });

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
            isSelfTransfer: parsed.isSelfTransfer,
            rawTitle: title,
            rawText: text,
            transactedAt: log.receivedAt,
            createdAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [transactions.userId, transactions.notificationLogId],
            set: {
              type: parsed.type,
              amount: parsed.amount,
              merchant: parsed.merchant,
              accountName: parsed.accountName,
              isSelfTransfer: parsed.isSelfTransfer,
              rawTitle: title,
              rawText: text,
            },
          });
      } catch {
        totals.failed++;
      }
    }

    onProgress?.({ ...totals, processed: i + 1 });
  }

  return totals;
}
