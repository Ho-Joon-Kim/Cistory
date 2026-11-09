/**
 * Google Health webhook queue: enqueue (web container) and consume (cron container).
 *
 * The route only verifies and enqueues — it never calls Google or aggregates, so
 * the web event loop is never blocked (CLAUDE.md "Cron Initialization"). The cron
 * consumer claims rows with SKIP LOCKED + a lease token, merges each
 * (user, dataType)'s pending intervals into one window, re-reads exactly that
 * window through the regular sync path, and recomputes the touched KST days.
 * The forward watermark is never moved (webhook windows are not contiguous); the
 * 24h polling sync and backfill remain the safety net.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { type HealthConnection, type HealthWebhookEvent, healthWebhookEvents } from "@/db/schema";
import { GoogleHealthAuthError } from "@/lib/adapters/google-health/interface";
import { toKstCalendarDate } from "@/lib/date-key";
import { logger } from "@/lib/logger";
import { invalidateRecoveredPeriods } from "@/modules/data-status/recovery";
import { createHealthSyncService, type HealthSyncService, SYNCED_METRICS } from "./service";

export const WEBHOOK_LEASE_MS = 5 * 60_000;
export const WEBHOOK_MAX_ATTEMPTS = 3;
const CLAIM_LIMIT = 200;
/** One consumer read never spans more than this (rollup/list request bounds). */
export const WEBHOOK_MAX_WINDOW_MS = 14 * 24 * 3600_000;
/** Padding around the merged notification window (late/edge points). */
const WINDOW_PAD_MS = 3600_000;
const MAX_TYPES_PER_USER_PER_TICK = 20;
const DONE_RETENTION_MS = 7 * 24 * 3600_000;
const FAILED_RETENTION_MS = 30 * 24 * 3600_000;
/** A `weight` burst triggers at most one Withings run per this window per user. */
export const WITHINGS_WEBHOOK_DEBOUNCE_MS = 15 * 60_000;

const ERR_INACTIVE = "건강 연동이 활성 상태가 아니어서 처리하지 못했습니다";
const ERR_FETCH = "Google Health에서 해당 구간을 다시 읽지 못했습니다";
const ERR_ABANDONED = "처리가 반복해서 중단되었습니다";

export interface WebhookEventInput {
  userId: string;
  dataType: string;
  operation: string;
  rangeStart: Date;
  rangeEnd: Date;
  recordId: string;
}

/**
 * Insert notification rows. A re-delivery of the same (user, type, op, interval,
 * record) never duplicates a row; if that row was already done/failed it is
 * re-armed to `pending` (a daily interval is re-notified as the day grows), and
 * if it is mid-processing its bumped `receivedAt` makes the consumer re-queue it.
 */
export async function enqueueWebhookEvents(
  db: Pick<Database, "insert">,
  rows: WebhookEventInput[],
  now: Date
): Promise<number> {
  // ON CONFLICT DO UPDATE may not touch one row twice in a statement, and a
  // batch can legitimately repeat an interval — dedup first.
  const unique = new Map<string, WebhookEventInput>();
  for (const r of rows) {
    unique.set(
      JSON.stringify([
        r.userId,
        r.dataType,
        r.operation,
        r.rangeStart.toISOString(),
        r.rangeEnd.toISOString(),
        r.recordId,
      ]),
      r
    );
  }
  if (unique.size === 0) return 0;
  const t = healthWebhookEvents;
  const rearm = sql`${t.status} IN ('done', 'failed')`;
  await db
    .insert(t)
    .values([...unique.values()].map((r) => ({ ...r, receivedAt: now, status: "pending" })))
    .onConflictDoUpdate({
      target: [t.userId, t.dataType, t.operation, t.rangeStart, t.rangeEnd, t.recordId],
      set: {
        receivedAt: sql`excluded.received_at`,
        status: sql`CASE WHEN ${rearm} THEN 'pending' ELSE ${t.status} END`,
        attempts: sql`CASE WHEN ${rearm} THEN 0 ELSE ${t.attempts} END`,
        lastError: sql`CASE WHEN ${rearm} THEN NULL ELSE ${t.lastError} END`,
      },
    });
  return unique.size;
}

export type WebhookClaim = HealthWebhookEvent & { leaseToken: string; claimedAt: Date };

/**
 * Claim up to `limit` pending (or lease-expired) events. Expired rows that
 * already used every attempt are failed first so a poison event can't loop.
 */
export async function claimWebhookEvents(
  db: Database,
  now: Date,
  limit = CLAIM_LIMIT
): Promise<WebhookClaim[]> {
  const t = healthWebhookEvents;
  return db.transaction(async (tx) => {
    await tx
      .update(t)
      .set({
        status: "failed",
        leaseToken: null,
        leaseExpiresAt: null,
        processedAt: now,
        lastError: ERR_ABANDONED,
      })
      .where(
        and(
          eq(t.status, "processing"),
          lte(t.leaseExpiresAt, now),
          gte(t.attempts, WEBHOOK_MAX_ATTEMPTS)
        )
      );
    const rows = await tx
      .select()
      .from(t)
      .where(
        and(
          lt(t.attempts, WEBHOOK_MAX_ATTEMPTS),
          or(eq(t.status, "pending"), and(eq(t.status, "processing"), lte(t.leaseExpiresAt, now)))
        )
      )
      .orderBy(asc(t.receivedAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return [];
    const leaseToken = randomUUID();
    await tx
      .update(t)
      .set({
        status: "processing",
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + WEBHOOK_LEASE_MS),
        claimedAt: now,
        attempts: sql`${t.attempts} + 1`,
      })
      .where(
        inArray(
          t.id,
          rows.map((r) => r.id)
        )
      );
    return rows.map((r) => ({ ...r, attempts: r.attempts + 1, leaseToken, claimedAt: now }));
  });
}

function heldBy(claims: WebhookClaim[]) {
  const t = healthWebhookEvents;
  return and(
    inArray(
      t.id,
      claims.map((c) => c.id)
    ),
    eq(t.status, "processing"),
    eq(t.leaseToken, claims[0].leaseToken)
  );
}

/** Done — unless a re-delivery arrived after the claim, which re-queues it. */
export async function completeWebhookEvents(db: Database, claims: WebhookClaim[], now: Date) {
  if (claims.length === 0) return;
  const t = healthWebhookEvents;
  const redelivered = sql`${t.receivedAt} > ${t.claimedAt}`;
  await db
    .update(t)
    .set({
      status: sql`CASE WHEN ${redelivered} THEN 'pending' ELSE 'done' END`,
      attempts: sql`CASE WHEN ${redelivered} THEN 0 ELSE ${t.attempts} END`,
      leaseToken: null,
      leaseExpiresAt: null,
      processedAt: now,
      lastError: null,
    })
    .where(heldBy(claims));
}

/** Retryable failure (back to pending until attempts run out) or terminal. */
export async function failWebhookEvents(
  db: Database,
  claims: WebhookClaim[],
  message: string,
  now: Date,
  terminal = false
) {
  if (claims.length === 0) return;
  const t = healthWebhookEvents;
  await db
    .update(t)
    .set({
      status: terminal
        ? "failed"
        : sql`CASE WHEN ${t.attempts} >= ${WEBHOOK_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
      leaseToken: null,
      leaseExpiresAt: null,
      processedAt: now,
      lastError: message,
    })
    .where(heldBy(claims));
}

/** Not processed this tick by choice (window/type caps) — no attempt is spent. */
export async function releaseWebhookEvents(db: Database, claims: WebhookClaim[]) {
  if (claims.length === 0) return;
  const t = healthWebhookEvents;
  await db
    .update(t)
    .set({
      status: "pending",
      attempts: sql`GREATEST(${t.attempts} - 1, 0)`,
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(heldBy(claims));
}

/** Drop done rows after 7 days and failed rows after 30 (kept for diagnosis). */
export async function pruneWebhookEvents(db: Database, now: Date): Promise<void> {
  const t = healthWebhookEvents;
  await db
    .delete(t)
    .where(
      or(
        and(eq(t.status, "done"), lt(t.processedAt, new Date(now.getTime() - DONE_RETENTION_MS))),
        and(
          eq(t.status, "failed"),
          lt(t.processedAt, new Date(now.getTime() - FAILED_RETENTION_MS))
        )
      )
    );
}

/**
 * Split a type's events (sorted by start) into the prefix whose merged span fits
 * one read and the rest, which waits for the next tick.
 */
export function planWindow(events: WebhookClaim[]): {
  take: WebhookClaim[];
  defer: WebhookClaim[];
  start: Date;
  end: Date;
} {
  const sorted = [...events].sort((a, b) => a.rangeStart.getTime() - b.rangeStart.getTime());
  const first = sorted[0].rangeStart.getTime();
  const take: WebhookClaim[] = [];
  const defer: WebhookClaim[] = [];
  let maxEnd = first;
  for (const e of sorted) {
    const end = Math.max(maxEnd, e.rangeEnd.getTime());
    if (take.length === 0 || end - first <= WEBHOOK_MAX_WINDOW_MS) {
      take.push(e);
      maxEnd = end;
    } else defer.push(e);
  }
  // A single interval longer than the cap (not seen in practice) reads its most
  // recent 14 days; older history is the polling backfill's job.
  const start = Math.max(first, maxEnd - WEBHOOK_MAX_WINDOW_MS);
  return {
    take,
    defer,
    start: new Date(start - WINDOW_PAD_MS),
    end: new Date(maxEnd + WINDOW_PAD_MS),
  };
}

export interface WebhookConsumerDeps {
  service: HealthSyncService;
  /** Early Withings sync for a `weight` notification (debounced by the callee). */
  withingsSync(userId: string): Promise<void>;
  now(): Date;
}

export interface WebhookRunResult {
  claimed: number;
  done: number;
  failed: number;
  deferred: number;
  ignored: number;
}

function defaultDeps(db: Database): WebhookConsumerDeps {
  return {
    service: createHealthSyncService(db),
    withingsSync: async (userId) => {
      const { createWithingsSyncService } = await import("@/modules/withings/service");
      await createWithingsSyncService(db).syncUser(userId, {
        skipIfSyncedWithinMs: WITHINGS_WEBHOOK_DEBOUNCE_MS,
      });
    },
    now: () => new Date(),
  };
}

/** One consumer tick. Bounded: ≤ CLAIM_LIMIT events, ≤ 20 data types per user. */
export async function processHealthWebhookQueue(
  db: Database,
  deps: WebhookConsumerDeps = defaultDeps(db)
): Promise<WebhookRunResult> {
  const now = deps.now();
  const result: WebhookRunResult = { claimed: 0, done: 0, failed: 0, deferred: 0, ignored: 0 };
  await pruneWebhookEvents(db, now);
  const claims = await claimWebhookEvents(db, now);
  result.claimed = claims.length;
  if (claims.length === 0) return result;

  const byUser = new Map<string, Map<string, WebhookClaim[]>>();
  for (const c of claims) {
    const types = byUser.get(c.userId) ?? new Map<string, WebhookClaim[]>();
    types.set(c.dataType, [...(types.get(c.dataType) ?? []), c]);
    byUser.set(c.userId, types);
  }

  for (const [userId, types] of byUser) {
    const entries = [...types.entries()];
    for (const [, deferred] of entries.slice(MAX_TYPES_PER_USER_PER_TICK)) {
      await releaseWebhookEvents(db, deferred);
      result.deferred += deferred.length;
    }
    const connection = await deps.service.getConnection(userId);
    for (const [dataType, events] of entries.slice(0, MAX_TYPES_PER_USER_PER_TICK)) {
      await handleType(db, deps, connection, userId, dataType, events, now, result);
    }
  }

  logger.info("[HealthWebhook] queue tick", { ...result });
  return result;
}

async function handleType(
  db: Database,
  deps: WebhookConsumerDeps,
  connection: HealthConnection | null,
  userId: string,
  dataType: string,
  events: WebhookClaim[],
  now: Date,
  result: WebhookRunResult
): Promise<void> {
  const upserts = events.filter((e) => e.operation === "UPSERT");
  const others = events.filter((e) => e.operation !== "UPSERT");
  if (others.length) {
    // DELETE is never enqueued by the route (decision: ignore + log); this only
    // guards rows that predate that rule.
    await completeWebhookEvents(db, others, now);
    result.ignored += others.length;
  }
  if (upserts.length === 0) return;

  try {
    if (dataType === "weight") {
      // Withings owns body composition: a Google `weight` notification (the scale
      // app re-publishing through Health Connect) just pulls Withings forward.
      await deps.withingsSync(userId);
      await completeWebhookEvents(db, upserts, now);
      result.done += upserts.length;
      return;
    }
    if (connection?.status !== "active") {
      await failWebhookEvents(db, upserts, ERR_INACTIVE, now, true);
      result.failed += upserts.length;
      return;
    }
    // SYNCED_METRICS covers scalars, rollups and the time-windowed sleep/exercise
    // sessions (#55), so every stored type re-reads exactly the notified window.
    const config = SYNCED_METRICS.find((c) => c.dataType === dataType);
    if (!config) {
      // Subscribed but not synced here (e.g. a type the subscriber config lists
      // that we never store) — nothing to read.
      await completeWebhookEvents(db, upserts, now);
      result.ignored += upserts.length;
      return;
    }
    const plan = planWindow(upserts);
    await releaseWebhookEvents(db, plan.defer);
    result.deferred += plan.defer.length;
    const out = await deps.service.refreshMetricWindow(connection, config, plan.start, plan.end);
    if (out.truncated) {
      await failWebhookEvents(db, plan.take, ERR_FETCH, now);
      result.failed += plan.take.length;
      return;
    }
    await completeWebhookEvents(db, plan.take, now);
    result.done += plan.take.length;
    await invalidateTouchedPeriods(db, userId, plan.start, plan.end, now);
  } catch (err) {
    const terminal = err instanceof GoogleHealthAuthError;
    const pending = events.filter((e) => e.operation === "UPSERT");
    await failWebhookEvents(db, pending, terminal ? ERR_INACTIVE : ERR_FETCH, now, terminal);
    result.failed += pending.length;
    logger.warn("[HealthWebhook] window refresh failed", {
      userId,
      dataType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Late data for a PAST KST day can change an already-finalized /overview
 * period, so its snapshots are re-queued (same helper and ranges as data-status
 * recovery). Data for today only touches active periods, which the precompute
 * refreshes on its own — skipping those keeps a heart-rate stream from
 * re-queuing the year snapshot every minute. Narratives are left alone.
 */
async function invalidateTouchedPeriods(
  db: Database,
  userId: string,
  start: Date,
  end: Date,
  now: Date
): Promise<void> {
  const today = toKstCalendarDate(now);
  const fromDay = toKstCalendarDate(start);
  if (fromDay >= today) return;
  const lastDay = toKstCalendarDate(new Date(end.getTime() - 1));
  const toDay = lastDay > today ? today : lastDay;
  try {
    await invalidateRecoveredPeriods(db, userId, fromDay, toDay, now, { narratives: false });
  } catch (err) {
    logger.warn("[HealthWebhook] overview invalidation failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
