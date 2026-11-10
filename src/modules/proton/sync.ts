/**
 * One Proton Photos sync tick per user (spec 3.4), run by the cron container.
 *
 * A per-user session advisory lock (`pg_try_advisory_lock` on a dedicated pool
 * client) keeps exactly one tick per user running across processes, because
 * the SDK allows one event subscriber per session. It covers the whole tick.
 *
 * Tick order: events → the backfill step (while backfilling) → the details
 * stage for rows events reset → the originals stage (thumbnail recovery and
 * original EXIF, deadline-bounded) → location fill → `last_synced_at`.
 *
 * Every write is fenced (`assertConnectionUnchanged`) against the connection
 * the tick started with; a reconnect or disconnect mid-tick
 * (`ProtonConnectionChangedError`), or a refresh that returns a different
 * session, aborts the tick unwritten — that is not a failure. Proton is never
 * called inside a transaction or under the token lock: the stages already
 * separate network work from their fenced write transactions.
 */
import { and, eq, isNull } from "drizzle-orm";
import { type Database, getPool } from "@/db";
import { type ProtonConnection, protonConnections } from "@/db/schema";
import type { ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { isAuthFailure, isRateLimited } from "@/lib/adapters/proton/errors";
import { logger } from "@/lib/logger";
import { trackSourceSync } from "@/modules/data-status/telemetry";
import {
  completeBackfill,
  nextBackfillStep,
  runBaselineStage,
  runDetailsStage,
  runTimelineListing,
} from "./backfill";
import { ProtonConnectionService } from "./connection";
import { processEvents } from "./events";
import { fillPhotoLocations } from "./location";
import { ClassifierUnavailableError, type PhotoClassifier } from "./nsfw/classifier";
import { createNsfwjsClassifier } from "./nsfw/nsfwjs";
import { ORIGINAL_STAGE_DEADLINE_MS, runOriginalsStage } from "./originals";
import {
  assertConnectionUnchanged,
  connectionFence,
  countPendingDetails,
  ProtonConnectionChangedError,
  type ProtonTickFence,
} from "./repository";
import { openProtonPhotos, type ProtonSessionGuard } from "./session";
import { PROTON_ERRORS } from "./types";

export interface ProtonSyncDeps {
  open: (db: Database, c: ProtonConnection, guard: ProtonSessionGuard) => Promise<ProtonPhotosApi>;
  classifier: PhotoClassifier;
  now: () => Date;
  /** Monotonic milliseconds, for the originals stage's tick deadline. */
  clock?: () => number;
}

/**
 * `aborted`: the connection changed (or stopped being active) under the tick,
 * which wrote nothing; not a failure. Any other error is rethrown after
 * `last_error` is set.
 */
export type ProtonSyncOutcome =
  | "skipped_locked"
  | "synced"
  | "rate_limited"
  | "needs_reauth"
  | "aborted";

/** The volume is gone; `processEvents` already flagged `needs_reauth`. */
class TreeRemovedError extends Error {
  constructor() {
    super("Proton photos volume removed");
    this.name = "TreeRemovedError";
  }
}

async function readConnection(db: Database, userId: string): Promise<ProtonConnection | null> {
  const [row] = await db
    .select()
    .from(protonConnections)
    .where(eq(protonConnections.userId, userId));
  return row ?? null;
}

/** Fenced write on the connection row; throws `ProtonConnectionChangedError` if it changed. */
async function writeConnectionState(
  db: Database,
  userId: string,
  fence: ProtonTickFence,
  values: Partial<Pick<ProtonConnection, "lastSyncedAt" | "lastError">>,
  now: Date
): Promise<void> {
  await db.transaction(async (tx) => {
    await assertConnectionUnchanged(tx, userId, fence);
    await tx
      .update(protonConnections)
      .set({ ...values, updatedAt: now })
      .where(eq(protonConnections.userId, userId));
  });
}

interface TickContext {
  db: Database;
  api: ProtonPhotosApi;
  classifier: PhotoClassifier;
  userId: string;
  fence: ProtonTickFence;
  now: Date;
  /** True once the tick has run past `ORIGINAL_STAGE_DEADLINE_MS`. */
  pastDeadline: () => boolean;
}

/** Runs the details stage; false when the classifier is unavailable (C6). */
async function runDetails(ctx: TickContext): Promise<boolean> {
  try {
    await runDetailsStage(ctx.db, ctx.api, ctx.classifier, ctx.userId, ctx.fence, ctx.now);
    return true;
  } catch (error) {
    if (error instanceof ClassifierUnavailableError) return false;
    throw error;
  }
}

/**
 * Events, the backfill step, details for event-reset rows, location fill and
 * the success stamp. Returns whether the classifier was available all tick.
 */
async function runTick(ctx: TickContext, conn: ProtonConnection): Promise<boolean> {
  const { db, api, classifier, userId, fence, now } = ctx;

  const events = await processEvents(db, api, classifier, conn, fence, now);
  if (events.stopped === "tree_removed") throw new TreeRemovedError();
  let classifierUp = !events.classifierUnavailable;

  // Events may have moved the cursor or reset the listing.
  const current = await readConnection(db, userId);
  if (!current) throw new ProtonConnectionChangedError();
  const pending = current.backfillCompletedAt ? 0 : await countPendingDetails(db, userId);
  const step = nextBackfillStep(current, pending);
  switch (step) {
    case "baseline":
      await runBaselineStage(db, api, userId, fence, now);
      break;
    case "list":
      await runTimelineListing(db, api, userId, fence, now);
      break;
    case "details":
      if (classifierUp) classifierUp = await runDetails(ctx);
      break;
    case "complete":
      await completeBackfill(db, userId, fence, now);
      break;
    case "done":
      break;
  }
  // Rows an event reset (or a failed node_created placeholder) need details
  // even after the backfill completed.
  if (step !== "details" && classifierUp) classifierUp = await runDetails(ctx);

  // After events and details, so it only ever uses the time they leave.
  const originals = await runOriginalsStage(db, api, classifier, userId, fence, now, {
    recovery: classifierUp,
    pastDeadline: ctx.pastDeadline,
  });
  if (originals.stopped || originals.failed > 0) {
    logger.info("[Proton] originals stage", { userId, ...originals });
  }

  // After the originals stage, so a photo whose original has GPS is never estimated.
  await fillPhotoLocations(db, userId, now);

  await writeConnectionState(
    db,
    userId,
    fence,
    {
      lastSyncedAt: now,
      lastError: classifierUp ? null : PROTON_ERRORS.classifierUnavailable,
    },
    now
  );
  return classifierUp;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/** Records `PROTON_ERRORS.syncFailed`; never masks the tick's own error. */
async function recordSyncFailure(
  db: Database,
  userId: string,
  fence: ProtonTickFence,
  now: Date
): Promise<void> {
  try {
    await writeConnectionState(db, userId, fence, { lastError: PROTON_ERRORS.syncFailed }, now);
  } catch (writeError) {
    // A changed connection keeps its own state.
    if (writeError instanceof ProtonConnectionChangedError) return;
    logger.warn("[Proton] could not record the sync failure", {
      userId,
      error: errorName(writeError),
    });
  }
}

/** Maps a failed tick to its outcome, or records `syncFailed` and rethrows. */
async function outcomeOfError(
  db: Database,
  userId: string,
  fence: ProtonTickFence,
  error: unknown,
  sessionChanged: boolean,
  now: Date
): Promise<ProtonSyncOutcome> {
  if (sessionChanged || error instanceof ProtonConnectionChangedError) {
    logger.info("[Proton] connection changed during sync; tick aborted", { userId });
    return "aborted";
  }
  if (error instanceof TreeRemovedError) return "needs_reauth";
  if (isRateLimited(error)) {
    logger.warn("[Proton] rate limited; skipping this tick", { userId });
    return "rate_limited";
  }
  // Only a rejection the refresher confirmed flags the connection; it has
  // already written `needs_reauth`. A 401 it could not confirm is transient.
  if (isAuthFailure(error) && (await readConnection(db, userId))?.status === "needs_reauth") {
    return "needs_reauth";
  }
  await recordSyncFailure(db, userId, fence, now);
  throw error;
}

/** An active connection whose stored session cannot be read. */
class ProtonSessionUnreadableError extends Error {
  constructor() {
    super("Proton connection session is unreadable");
    this.name = "ProtonSessionUnreadableError";
  }
}

/**
 * Records a failed attempt and `syncFailed` for an active row the tick could
 * not build a fence for. No fence exists, so the write is conditioned on the
 * row still being the one read (same status and encrypted uid) instead.
 */
async function failUnreadableConnection(
  db: Database,
  conn: ProtonConnection,
  now: Date
): Promise<void> {
  logger.warn("[Proton] stored session unreadable; sync failed", {
    userId: conn.userId,
    error: "ProtonSessionUnreadableError",
  });
  try {
    await trackSourceSync(db, conn.userId, "proton", async () => {
      throw new ProtonSessionUnreadableError();
    });
  } catch {
    // Expected: the attempt is recorded as failed.
  }
  await db
    .update(protonConnections)
    .set({ lastError: PROTON_ERRORS.syncFailed, updatedAt: now })
    .where(
      and(
        eq(protonConnections.userId, conn.userId),
        eq(protonConnections.status, "active"),
        conn.uidEnc === null
          ? isNull(protonConnections.uidEnc)
          : eq(protonConnections.uidEnc, conn.uidEnc)
      )
    );
}

/** The tick body, run while holding the per-user session lock. */
async function syncLocked(
  db: Database,
  userId: string,
  deps: ProtonSyncDeps
): Promise<ProtonSyncOutcome> {
  const conn = await readConnection(db, userId);
  // Missing or not active: nothing to sync, and nothing went wrong.
  if (conn?.status !== "active") return "aborted";
  let fence: ProtonTickFence;
  try {
    fence = connectionFence(conn);
  } catch {
    // An active row whose session can't be read (uid undecryptable after a
    // KIS_ENCRYPTION_KEY rotation, or no volume): a visible failure, not a skip.
    await failUnreadableConnection(db, conn, deps.now());
    throw new ProtonSessionUnreadableError();
  }

  let sessionChanged = false;
  const guard: ProtonSessionGuard = {
    expectedUid: fence.uid,
    onSessionChanged: () => {
      sessionChanged = true;
    },
  };

  try {
    await trackSourceSync(db, userId, "proton", async () => {
      const clock = deps.clock ?? (() => performance.now());
      const startedAt = clock();
      const api = await deps.open(db, conn, guard);
      const ctx: TickContext = {
        db,
        api,
        classifier: deps.classifier,
        userId,
        fence,
        now: deps.now(),
        pastDeadline: () => clock() - startedAt >= ORIGINAL_STAGE_DEADLINE_MS,
      };
      const classifierUp = await runTick(ctx, conn);
      if (!classifierUp) {
        logger.warn("[Proton] classifier unavailable; details deferred", { userId });
      }
    });
    return "synced";
  } catch (error) {
    return outcomeOfError(db, userId, fence, error, sessionChanged, deps.now());
  }
}

/**
 * One tick for one user. Skips (`skipped_locked`) when another process holds
 * the user's session lock. Rethrows unexpected errors after recording
 * `PROTON_ERRORS.syncFailed`.
 */
export async function syncProtonPhotosForUser(
  db: Database,
  userId: string,
  deps: ProtonSyncDeps
): Promise<ProtonSyncOutcome> {
  const lockKey = `proton-sync:${userId}`;
  const client = await getPool().connect();
  let locked = false;
  let releaseError: Error | undefined;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [lockKey]
    );
    locked = rows[0]?.locked === true;
    if (!locked) return "skipped_locked";
    return await syncLocked(db, userId, deps);
  } catch (error) {
    // The lock query itself failed: the connection may be broken, so discard it.
    if (!locked) releaseError = error instanceof Error ? error : new Error("advisory lock failed");
    throw error;
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]);
      } catch (error) {
        // A session lock dies with its connection: destroy it rather than
        // return a client that still holds the lock to the pool.
        releaseError = error instanceof Error ? error : new Error("advisory unlock failed");
        logger.warn("[Proton] advisory unlock failed; discarding client", {
          userId,
          error: errorName(error),
        });
      }
    }
    client.release(releaseError);
  }
}

/**
 * Cron entry point: expires elapsed connect forks, then syncs every active
 * connection one user at a time. A user's failure is logged by error name
 * only (never a Proton payload) and does not stop the others.
 */
export async function syncAllProtonPhotos(
  db: Database,
  deps: Partial<ProtonSyncDeps> = {}
): Promise<void> {
  const resolved: ProtonSyncDeps = {
    open: openProtonPhotos,
    now: () => new Date(),
    ...deps,
    classifier: deps.classifier ?? createNsfwjsClassifier(),
  };
  const rows = await db
    .select({
      userId: protonConnections.userId,
      status: protonConnections.status,
      pendingForkExpiresAt: protonConnections.pendingForkExpiresAt,
    })
    .from(protonConnections);

  const now = resolved.now();
  const connections = new ProtonConnectionService(db, { now: resolved.now });
  for (const row of rows) {
    // A first-time `pending` row is deleted; a re-connect only loses `pending_*`.
    if (!row.pendingForkExpiresAt || row.pendingForkExpiresAt.getTime() > now.getTime()) continue;
    try {
      await connections.clearExpiredFork(row.userId);
    } catch (error) {
      logger.error("[Proton] clearing an expired fork failed", {
        userId: row.userId,
        error: errorName(error),
      });
    }
  }

  for (const row of rows) {
    if (row.status !== "active") continue;
    try {
      await syncProtonPhotosForUser(db, row.userId, resolved);
    } catch (error) {
      logger.error("[Proton] sync failed", { userId: row.userId, error: errorName(error) });
    }
  }
}
