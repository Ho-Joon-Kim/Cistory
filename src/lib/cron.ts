/**
 * Cistory Cron Service
 *
 * Automatically syncs GitHub commits for all users based on their sync interval settings
 * Runs independently of user sessions - works even if users haven't logged in for months
 */

import { lt, sql } from "drizzle-orm";
import * as cron from "node-cron";
import { getDb, syncJobs, users } from "@/db";
import { maybeRefreshDataUsage } from "@/lib/data-usage";
import { logger } from "@/lib/logger";
import { toLocalDateString } from "@/lib/utils";
import { createHealthSyncService } from "@/modules/health/service";
import { rebuildDailyLocationHeatmap } from "@/modules/overview/aggregate/location";
import { type LocationCompletedWindow, runOverviewPrecompute } from "@/modules/overview/precompute";
import { createPortfolioSyncService } from "@/modules/portfolio/service";
import { createExpenseCategoryService } from "@/modules/spending/category-classifier";
import { refreshAllSubwaySystems, seedSubwaySystemsIfEmpty } from "@/modules/subway/service";
import { createSummaryService, SummaryService } from "@/modules/summary/service";
import { createSyncService } from "@/modules/sync/service";
import { createWakaTimeSyncService } from "@/modules/wakatime/service";
import { createWithingsSyncService } from "@/modules/withings/service";

let isInitialized = false;
let cronTask: cron.ScheduledTask | null = null;
let dailyReparseTask: cron.ScheduledTask | null = null;
let spendingCategoryTask: cron.ScheduledTask | null = null;
let locationProcessingTask: cron.ScheduledTask | null = null;
let locationCatchUpTask: cron.ScheduledTask | null = null;
let subwayRefreshTask: cron.ScheduledTask | null = null;
let tripDetectionTask: cron.ScheduledTask | null = null;
let isSubwayRefreshRunning = false;
let isLocationProcessingRunning = false;
let isTripDetectionRunning = false;
let isSyncAllRunning = false;
let isSpendingCategoryRunning = false;

/**
 * U5 can pass the location pipeline's completed-through watermarks here once
 * that pipeline exposes them. Without a completed window, active periods are
 * refreshed but ended periods are deliberately not finalized.
 */
export async function precomputeOverviewSnapshots(
  completedLocationWindows: LocationCompletedWindow[] = []
) {
  const result = await runOverviewPrecompute(getDb(), { completedLocationWindows });
  if (!result.skipped && (result.published > 0 || result.failed > 0)) {
    logger.info("[Cron] Overview precompute completed", { ...result });
  }
  return result;
}

async function precomputeAfterLocation(windows: LocationCompletedWindow[]) {
  try {
    await precomputeOverviewSnapshots(windows);
  } catch (error) {
    logger.error("[Cron] Overview precompute after location failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function categorizePendingSpending(): Promise<void> {
  if (isSpendingCategoryRunning || !process.env.ANTHROPIC_API_KEY) return;
  isSpendingCategoryRunning = true;
  try {
    const db = getDb();
    const allUsers = await db.select({ id: users.id }).from(users);
    const service = createExpenseCategoryService(db, process.env.ANTHROPIC_API_KEY);
    for (const user of allUsers) {
      try {
        const processed = await service.processPendingForUser(user.id, 100);
        if (processed > 0) {
          logger.info("[Cron] Categorized pending spending", { userId: user.id, processed });
        }
      } catch (error) {
        logger.error("[Cron] Spending categorization failed", {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    isSpendingCategoryRunning = false;
  }
}

/**
 * Wraps refreshAllSubwaySystems with a single-flight guard. Yearly cron + boot
 * catch-up could otherwise stack up if a refresh hangs (Overpass slow path).
 */
async function runSubwayRefresh(reason: string): Promise<void> {
  if (isSubwayRefreshRunning) {
    logger.info("[Cron] subway refresh already running, skipping", { reason });
    return;
  }
  isSubwayRefreshRunning = true;
  try {
    logger.info("[Cron] subway refresh starting", { reason });
    await refreshAllSubwaySystems();
    logger.info("[Cron] subway refresh complete", { reason });
  } finally {
    isSubwayRefreshRunning = false;
  }
}

/**
 * Seed (idempotent) and check if any subway_system has never been fetched or is
 * older than 350 days. If so, kick off refreshAllSubwaySystems in the background.
 */
async function maybeRunSubwayBootCatchUp(): Promise<void> {
  try {
    await seedSubwaySystemsIfEmpty();
    const db = getDb();
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM subway_systems
      WHERE last_refreshed_at IS NULL OR last_refreshed_at < now() - interval '350 days'
    `);
    const overdue = Number((res.rows[0] as { c?: number } | undefined)?.c ?? 0);
    if (overdue === 0) {
      logger.info("[Cron] subway data fresh, skipping boot refresh");
      return;
    }
    logger.info("[Cron] subway systems overdue, queueing background refresh", {
      overdue,
    });
    runSubwayRefresh("boot-catch-up").catch((error) => {
      logger.error("[Cron] subway boot refresh failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    logger.error("[Cron] subway boot seed/check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Exported (with the two job bodies below) so the cron smoke test can call the
// job logic directly and assert call-shape — the cron.schedule registrations
// themselves are out of test scope.
export async function syncAllUsers() {
  // Single-flight, like the other cron jobs. Overlapping runs (boot-time
  // catch-up + scheduled tick, or a slow initial sync outliving the 10-min
  // interval) would double-charge the Claude API for the same pending
  // summaries and race the commit dedup window.
  if (isSyncAllRunning) {
    logger.info("[Cron] syncAllUsers already running. Skipping this tick.");
    return;
  }
  isSyncAllRunning = true;
  try {
    await _syncAllUsersInner();
  } finally {
    isSyncAllRunning = false;
  }
}

async function _syncAllUsersInner() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logger.info(`[Cron] Starting sync job`, { timestamp });

  const db = getDb();

  // Revive `processing` rows abandoned by a crashed worker. Without this a
  // SIGTERM mid-call leaves the row stuck out of every queue forever.
  try {
    await SummaryService.reviveStaleProcessing(db);
  } catch (reviveError) {
    logger.error("[Cron] reviveStaleProcessing failed", {
      error: reviveError instanceof Error ? reviveError.message : String(reviveError),
    });
  }

  try {
    // Find all users who have a GitHub OAuth token stored in Better Auth's
    // account table. Phase 9.2 removed the duplicate users.github_access_token
    // column; existence is now determined via EXISTS() against `account`.
    const usersToSync = await db
      .select({
        id: users.id,
        githubLogin: users.githubLogin,
        syncIntervalHours: users.syncIntervalHours,
        lastSyncedAt: users.lastSyncedAt,
        initialSyncCompleted: users.initialSyncCompleted,
        wakatimeApiKey: users.wakatimeApiKey,
        wakatimeLastSyncedAt: users.wakatimeLastSyncedAt,
      })
      .from(users)
      .where(
        sql`EXISTS (SELECT 1 FROM "account" WHERE "account"."userId" = ${users.id} AND "account"."providerId" = 'github' AND "account"."accessToken" IS NOT NULL)`
      );

    logger.info(`[Cron] Found ${usersToSync.length} user(s) requiring sync`);

    if (usersToSync.length === 0) {
      logger.info("[Cron] No users to sync. Exiting.");
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const results: Array<{ user: string; status: string; error?: string }> = [];

    // Sync each user sequentially to avoid rate limits
    for (const user of usersToSync) {
      const userStartTime = Date.now();

      try {
        logger.info(`[Cron] Syncing: ${user.githubLogin}`, {
          userId: user.id,
          githubLogin: user.githubLogin,
          lastSyncedAt: user.lastSyncedAt?.toISOString() ?? null,
          syncIntervalHours: user.syncIntervalHours,
          initialSyncCompleted: user.initialSyncCompleted,
        });

        const { getGitHubToken } = await import("@/lib/auth-helpers");
        const accessToken = await getGitHubToken(user.id);
        if (!accessToken) {
          throw new Error("GitHub access token not found");
        }

        const syncService = createSyncService(db, accessToken);

        // Sync commits (uses Search API for initial and regular)
        if (!user.initialSyncCompleted) {
          await syncService.initialSync(user.id, user.githubLogin);
        } else {
          const intervalHours = user.syncIntervalHours ?? 1;
          const intervalMs = intervalHours * 60 * 60 * 1000;
          const sinceLastSync = user.lastSyncedAt
            ? Date.now() - user.lastSyncedAt.getTime()
            : Number.POSITIVE_INFINITY;

          if (sinceLastSync < intervalMs) {
            const remainingMin = Math.ceil((intervalMs - sinceLastSync) / 60000);
            logger.info(`[Cron] Skipping commit sync: interval not reached`, {
              userId: user.id,
              githubLogin: user.githubLogin,
              syncIntervalHours: intervalHours,
              remainingMinutes: remainingMin,
            });
          } else {
            await syncService.syncUserCommits(user.id, user.githubLogin, "scheduled");
          }
        }

        // Process queued summaries. The previous "last 7 days" filter meant
        // any commit older than a week (e.g. backfilled via Search API) could
        // never reach the AI, even though it was sitting in `pending`. We now
        // hand off to processPendingSummaries which scopes by user, orders by
        // commit date (oldest first so the backlog drains), and respects
        // MAX_RETRY_COUNT so a poison commit stops re-trying forever.
        if (process.env.ANTHROPIC_API_KEY) {
          try {
            const summaryService = createSummaryService(
              db,
              process.env.ANTHROPIC_API_KEY,
              accessToken
            );
            const processed = await summaryService.processPendingSummaries(20, undefined, user.id);
            if (processed > 0) {
              logger.info(`[Cron] Processed ${processed} summaries`, {
                userId: user.id,
                githubLogin: user.githubLogin,
              });
            }
          } catch (summaryError) {
            logger.error(`[Cron] Summary processing error`, {
              userId: user.id,
              githubLogin: user.githubLogin,
              error: summaryError instanceof Error ? summaryError.message : String(summaryError),
            });
          }
        }

        // WakaTime sync
        if (user.wakatimeApiKey) {
          const shouldSync =
            !user.wakatimeLastSyncedAt ||
            Date.now() - user.wakatimeLastSyncedAt.getTime() > 24 * 60 * 60 * 1000;

          if (shouldSync) {
            try {
              const wakatimeService = createWakaTimeSyncService(db, user.wakatimeApiKey);
              await wakatimeService.syncUser(user.id);
            } catch (wakatimeError) {
              logger.error("[Cron] WakaTime sync error", {
                userId: user.id,
                githubLogin: user.githubLogin,
                error:
                  wakatimeError instanceof Error ? wakatimeError.message : String(wakatimeError),
              });
            }
          }
        }

        // KIS Portfolio sync (24h interval, gated per-account by lastSyncedAt)
        try {
          const portfolio = createPortfolioSyncService(db);
          if (await portfolio.hasActiveAccounts(user.id)) {
            const portfolioResults = await portfolio.syncUserAccounts(user.id, {
              skipIfSyncedWithinMs: 24 * 60 * 60 * 1000,
            });
            const failed = portfolioResults.filter((r) => r.error).length;
            if (portfolioResults.length > 0) {
              logger.info("[Cron] Portfolio sync done", {
                userId: user.id,
                githubLogin: user.githubLogin,
                total: portfolioResults.length,
                failed,
              });
            }

            // After the regular incremental sync, pick up any historical
            // gap implied by `openedAt`. Idempotent — does nothing if the
            // backfill watermark already covers the opened-at date.
            const backfillResults = await portfolio.backfillPendingAccounts(user.id);
            if (backfillResults.length > 0) {
              logger.info("[Cron] Portfolio backfill done", {
                userId: user.id,
                githubLogin: user.githubLogin,
                accounts: backfillResults.length,
                executionsInserted: backfillResults.reduce((s, r) => s + r.executionsInserted, 0),
                pnlUpserted: backfillResults.reduce((s, r) => s + r.pnlUpserted, 0),
                failed: backfillResults.filter((r) => r.error).length,
              });
            }
          }
        } catch (portfolioError) {
          logger.error("[Cron] Portfolio sync error", {
            userId: user.id,
            githubLogin: user.githubLogin,
            error:
              portfolioError instanceof Error ? portfolioError.message : String(portfolioError),
          });
        }

        // Withings body-scale sync (24h interval, gated by lastSyncedAt).
        // syncUser self-selects: it no-ops (skipped) when there's no active
        // connection or the 24h gate hasn't elapsed, so no pre-check is needed.
        // Self-heal: if the OAuth-callback backfill never completed
        // (lastMeasureUpdate still null), syncUser runs a full startdate=0 fetch,
        // so a failed initial backfill converges on the next run.
        try {
          const result = await createWithingsSyncService(db).syncUser(user.id, {
            skipIfSyncedWithinMs: 24 * 60 * 60 * 1000,
          });
          if (!result.skipped) {
            logger.info("[Cron] Withings sync done", {
              userId: user.id,
              githubLogin: user.githubLogin,
              measurements: result.measurementsUpserted,
            });
          }
        } catch (withingsError) {
          logger.error("[Cron] Withings sync error", {
            userId: user.id,
            githubLogin: user.githubLogin,
            error: withingsError instanceof Error ? withingsError.message : String(withingsError),
          });
        }

        // Google Health (Fitbit) sync. Forward sync is 24h-gated (syncUser
        // self-skips when synced <24h ago or there's no active connection).
        // Backfill runs EVERY tick, independent of that gate, so a fresh
        // connection's all-time history import advances every ~10 min (not once
        // per day) and finishes in minutes/hours instead of days;
        // backfillPendingConnections self-skips once complete or when idle.
        try {
          const health = createHealthSyncService(db);
          const result = await health.syncUser(user.id, {
            skipIfSyncedWithinMs: 24 * 60 * 60 * 1000,
          });
          if (!result.skipped) {
            logger.info("[Cron] Health sync done", {
              userId: user.id,
              githubLogin: user.githubLogin,
              samples: result.samplesUpserted,
            });
          }
          const backfill = await health.backfillPendingConnections(user.id);
          if (!backfill.skipped) {
            logger.info("[Cron] Health backfill progressed", {
              userId: user.id,
              githubLogin: user.githubLogin,
              samples: backfill.samplesUpserted,
            });
          }
        } catch (healthError) {
          logger.error("[Cron] Health sync error", {
            userId: user.id,
            githubLogin: user.githubLogin,
            error: healthError instanceof Error ? healthError.message : String(healthError),
          });
        }

        // Data usage cache refresh (once per 24h)
        try {
          await maybeRefreshDataUsage(db, user.id);
        } catch (usageError) {
          logger.error("[Cron] Data usage refresh error", {
            userId: user.id,
            githubLogin: user.githubLogin,
            error: usageError instanceof Error ? usageError.message : String(usageError),
          });
        }

        const duration = Date.now() - userStartTime;
        successCount++;

        logger.info(`[Cron] Sync success: ${user.githubLogin}`, {
          userId: user.id,
          githubLogin: user.githubLogin,
          duration,
          status: "success",
        });

        results.push({
          user: user.githubLogin,
          status: "success",
        });
      } catch (error) {
        const duration = Date.now() - userStartTime;
        failCount++;

        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error(`[Cron] Sync failed: ${user.githubLogin}`, {
          userId: user.id,
          githubLogin: user.githubLogin,
          duration,
          status: "failed",
          error: errorMessage,
        });

        results.push({
          user: user.githubLogin,
          status: "failed",
          error: errorMessage,
        });
      }
    }

    // Print summary
    const totalDuration = Date.now() - startTime;

    logger.info("[Cron] Sync job completed", {
      totalUsers: usersToSync.length,
      successCount,
      failCount,
      duration: totalDuration,
      failedUsers: results
        .filter((r) => r.status === "failed")
        .map((r) => ({ user: r.user, error: r.error })),
    });

    // Cleanup old sync jobs (older than 7 days)
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const deleted = await db
        .delete(syncJobs)
        .where(lt(syncJobs.createdAt, sevenDaysAgo))
        .returning({ id: syncJobs.id });

      if (deleted.length > 0) {
        logger.info(`[Cron] Cleaned up ${deleted.length} old sync job(s)`);
      }
    } catch (error) {
      logger.error("[Cron] Failed to cleanup old sync jobs", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    logger.error("[Cron] Fatal error during sync job", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

/**
 * Process un-anomaly-scanned days (location pipeline: anomaly → visits →
 * tracks → transportation → subway). Runs daily at 01:00 KST, hourly as a
 * lightweight catch-up tick, and on container boot.
 *
 * Finds every past date for the user that still has location_points with
 * anomaly IS NULL (the signal that the day hasn't been processed yet) and
 * runs the pipeline for each. Cap at 30 days per invocation so a multi-week
 * outage (e.g. the 3/5 → 4/25 cron downtime that left 25 days unprocessed)
 * recovers in a single boot catch-up rather than dragging on across reboots.
 * Subsequent boots still catch the rest if the backlog exceeds 30 days.
 *
 * A single-flight guard skips re-entrant runs — the hourly catch-up tick + the
 * daily 01:00 schedule + boot catch-up can all overlap if a previous run is
 * still in flight (subway discovery probes Overpass and can be slow).
 */
export interface LocationDayProcessingResult {
  userId: string;
  date: string;
  status: "completed" | "failed";
  failedStage?: "state" | "anomaly" | "visits" | "tracks" | "heatmap";
  error?: string;
}

export interface LocationProcessingResult {
  skipped: boolean;
  days: LocationDayProcessingResult[];
  completedLocationWindows: LocationCompletedWindow[];
}

function coreFailureStage(error: unknown): LocationDayProcessingResult["failedStage"] {
  if (error && typeof error === "object" && "locationStage" in error) {
    return (error as { locationStage: LocationDayProcessingResult["failedStage"] }).locationStage;
  }
  return "anomaly";
}

async function runLocationStateWrite(operation: () => Promise<void>) {
  try {
    await operation();
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      locationStage: "state" satisfies LocationDayProcessingResult["failedStage"],
    });
  }
}

async function markLocationDayProcessing(
  db: ReturnType<typeof getDb>,
  userId: string,
  date: string,
  now: Date
) {
  await db.execute(sql`
    INSERT INTO location_processing_days (
      user_id, date, status, processing_started_at, completed_at,
      attempt_count, last_error, updated_at
    ) VALUES (${userId}, ${date}, 'processing', ${now}, NULL, 1, NULL, ${now})
    ON CONFLICT (user_id, date) DO UPDATE SET
      status = 'processing',
      processing_started_at = EXCLUDED.processing_started_at,
      completed_at = NULL,
      attempt_count = location_processing_days.attempt_count + 1,
      last_error = NULL,
      updated_at = EXCLUDED.updated_at
  `);
}

async function markLocationDayCompleted(
  db: ReturnType<typeof getDb>,
  userId: string,
  date: string,
  now: Date
) {
  await db.execute(sql`
    UPDATE location_processing_days
    SET status = 'completed', completed_at = ${now}, last_error = NULL, updated_at = ${now}
    WHERE user_id = ${userId} AND date = ${date}
  `);
}

async function markLocationDayFailed(
  db: ReturnType<typeof getDb>,
  userId: string,
  date: string,
  error: string,
  now: Date
) {
  await db.execute(sql`
    UPDATE location_processing_days
    SET status = 'failed', completed_at = NULL, last_error = ${error.slice(0, 1_000)},
      updated_at = ${now}
    WHERE user_id = ${userId} AND date = ${date}
  `);
}

async function runLocationCoreDay(
  db: ReturnType<typeof getDb>,
  userId: string,
  date: string,
  services: {
    runAnomalyDetectionForDay(userId: string, date: string): Promise<{ total: number }>;
    detectAndPersistVisits(userId: string, date: string): Promise<unknown[]>;
    detectAndPersistTracks(
      userId: string,
      date: string
    ): Promise<{ trackCount: number; segmentCount: number }>;
  }
): Promise<void> {
  const runStage = async <T>(
    stage: LocationDayProcessingResult["failedStage"],
    operation: () => Promise<T>
  ) => {
    try {
      return await operation();
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        locationStage: stage,
      });
    }
  };

  const anomalyResult = await runStage("anomaly", () =>
    services.runAnomalyDetectionForDay(userId, date)
  );
  if (anomalyResult.total > 0) {
    logger.info(`[Cron] Anomaly detection for ${userId} ${date}: ${anomalyResult.total} marked`);
  }
  const visits = await runStage("visits", () => services.detectAndPersistVisits(userId, date));
  if (visits.length > 0) {
    logger.info(`[Cron] Visit detection for ${userId} ${date}: ${visits.length} persisted`);
  }
  const tracks = await runStage("tracks", () => services.detectAndPersistTracks(userId, date));
  if (tracks.trackCount > 0 || tracks.segmentCount > 0) {
    logger.info(
      `[Cron] Track detection for ${userId} ${date}: ${tracks.trackCount} tracks, ${tracks.segmentCount} segments persisted`
    );
  }
  await runStage("heatmap", () => rebuildDailyLocationHeatmap(db, userId, date, new Date()));
}

function completedWindowForUser(
  userId: string,
  orderedDates: string[],
  results: LocationDayProcessingResult[]
): LocationCompletedWindow | null {
  if (results.some((result) => result.status === "failed")) return null;
  const byDate = new Map(results.map((result) => [result.date, result.status]));
  let completedThrough: string | null = null;
  for (const date of orderedDates) {
    if (byDate.get(date) !== "completed") break;
    completedThrough = date;
  }
  return completedThrough ? { userId, completedThrough } : null;
}

export async function processYesterdayLocations(reason: string): Promise<LocationProcessingResult> {
  if (isLocationProcessingRunning) {
    logger.info("[Cron] Location processing already running, skipping", { reason });
    return { skipped: true, days: [], completedLocationWindows: [] };
  }
  isLocationProcessingRunning = true;
  const startTime = Date.now();
  logger.info("[Cron] Starting daily location processing", { reason });

  try {
    const { runAnomalyDetectionForDay } = await import(
      "@/modules/location/services/anomaly-filter"
    );

    const db = getDb();
    const allUsers = await db
      .select({ id: users.id, ownTracksApiKey: users.ownTracksApiKey })
      .from(users)
      .where(sql`TRUE`);

    if (allUsers.length === 0) {
      logger.info("[Cron] No users. Skipping location processing.");
      await precomputeAfterLocation([]);
      return { skipped: false, days: [], completedLocationWindows: [] };
    }

    const { detectAndPersistVisits } = await import("@/modules/location/services/visit-persister");
    const { detectAndPersistTracks } = await import("@/modules/location/services/track-persister");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateString(yesterday);
    const todayStr = toLocalDateString(new Date());

    const dayResults: LocationDayProcessingResult[] = [];
    const completedLocationWindows: LocationCompletedWindow[] = [];
    for (const user of allUsers) {
      try {
        if (!user.ownTracksApiKey) {
          completedLocationWindows.push({ userId: user.id, completedThrough: todayStr });
          continue;
        }
        // Find unprocessed dates (at most 14, oldest first).
        // KST day of the UTC-wall timestamp — a bare date(timestamp) is the
        // UTC day, which misses days whose only points fall in 00:00–09:00 KST
        // and disagrees with the KST processing window used downstream.
        // The 45-day timestamp bound keeps this hourly query on the
        // (user_id, timestamp) index instead of GROUP BY-scanning the user's
        // entire point history; anything older is the manual backfill's job.
        const unprocessedResult = await db.execute<{ d: string; [key: string]: unknown }>(sql`
          SELECT to_char(candidate_days.d, 'YYYY-MM-DD') AS d FROM (
            SELECT point_days.d FROM (
              SELECT d, count(*) FILTER (WHERE anomaly IS NULL)::int AS pending_count FROM (
                SELECT
                  (timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date AS d,
                  anomaly
                FROM location_points
                WHERE user_id = ${user.id}
                  AND timestamp >= (now() at time zone 'UTC') - interval '45 days'
                  AND (timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date
                    <= ${todayStr}::date
              ) point_candidates
              GROUP BY d
            ) point_days
            LEFT JOIN location_processing_days processing
              ON processing.user_id = ${user.id}
              AND processing.date = to_char(point_days.d, 'YYYY-MM-DD')
            WHERE point_days.pending_count > 0
              OR point_days.d IN (${yesterdayStr}::date, ${todayStr}::date)
              OR processing.id IS NULL
              OR processing.status = 'failed'
              OR (
                processing.status = 'processing'
                AND processing.processing_started_at <= now() - interval '20 minutes'
              )
            UNION
            SELECT processing.date::date AS d
            FROM location_processing_days processing
            WHERE processing.user_id = ${user.id}
              AND processing.date::date >= ${todayStr}::date - 45
              AND processing.date::date <= ${todayStr}::date
              AND (
                processing.status = 'failed'
                OR (
                  processing.status = 'processing'
                  AND processing.processing_started_at <= now() - interval '20 minutes'
                )
              )
            ORDER BY d DESC
            LIMIT 30
          ) candidate_days
          ORDER BY candidate_days.d
        `);
        const dateList = Array.from(new Set(unprocessedResult.rows.map((row) => row.d))).sort();

        if (dateList.length > 1) {
          logger.info(
            `[Cron] Location catch-up for ${user.id}: ${dateList.length} dates (${dateList[0]} .. ${dateList[dateList.length - 1]})`
          );
        }

        const userResults: LocationDayProcessingResult[] = [];
        for (const date of dateList) {
          try {
            await runLocationStateWrite(() =>
              markLocationDayProcessing(db, user.id, date, new Date())
            );
            await runLocationCoreDay(db, user.id, date, {
              runAnomalyDetectionForDay,
              detectAndPersistVisits,
              detectAndPersistTracks,
            });
            await runLocationStateWrite(() =>
              markLocationDayCompleted(db, user.id, date, new Date())
            );
            userResults.push({ userId: user.id, date, status: "completed" });
          } catch (error) {
            const result: LocationDayProcessingResult = {
              userId: user.id,
              date,
              status: "failed",
              failedStage: coreFailureStage(error),
              error: error instanceof Error ? error.message : String(error),
            };
            userResults.push(result);
            try {
              await markLocationDayFailed(db, user.id, date, result.error ?? "unknown", new Date());
            } catch (stateError) {
              logger.error(`[Cron] Failed to persist location failure for ${user.id} ${date}`, {
                error: stateError instanceof Error ? stateError.message : String(stateError),
              });
            }
            logger.error(`[Cron] Location core pipeline failed for ${user.id} ${date}`, {
              ...result,
            });
          }
        }
        dayResults.push(...userResults);
        const completedWindow =
          dateList.length === 0
            ? { userId: user.id, completedThrough: todayStr }
            : completedWindowForUser(user.id, dateList, userResults);
        if (completedWindow) completedLocationWindows.push(completedWindow);
        const completedDates = userResults
          .filter((result) => result.status === "completed")
          .map((result) => result.date);

        // Subway track matching (Phase 2). For each processed date, score the
        // segments against subway_lines geometry and label trips. Then group
        // consecutive matches into transfer sessions. Non-fatal — segments
        // remain in their original mode if matching fails.
        try {
          const { matchSubwayTrips } = await import(
            "@/modules/location/services/subway-match/matcher"
          );
          const { groupMatchesIntoSessions } = await import(
            "@/modules/location/services/subway-match/session-grouper"
          );
          for (const dateStr of completedDates) {
            const matchResult = await matchSubwayTrips(user.id, dateStr);
            if (matchResult.legsInserted > 0) {
              const sessionResult = await groupMatchesIntoSessions(user.id, dateStr);
              if (sessionResult.multiLegSessions > 0) {
                logger.info(
                  `[Cron] Subway transfers for ${user.id} ${dateStr}: ${sessionResult.multiLegSessions} multi-leg sessions`
                );
              }
            }
          }
        } catch (matchErr) {
          logger.warn("[Cron] Subway matching failed (non-fatal)", {
            userId: user.id,
            error: matchErr instanceof Error ? matchErr.message : String(matchErr),
          });
        }

        // Subway discovery: scan visits.city for new cities not yet covered by
        // any subway_systems bbox. Probes Overpass; capped at 3 new cities per
        // run. Failure is non-fatal — the catch-up will retry tomorrow.
        try {
          const { discoverMissingSubwayCities } = await import(
            "@/modules/location/services/subway-discovery"
          );
          await discoverMissingSubwayCities(user.id);
        } catch (discErr) {
          logger.warn("[Cron] Subway discovery failed (non-fatal)", {
            userId: user.id,
            error: discErr instanceof Error ? discErr.message : String(discErr),
          });
        }
      } catch (err) {
        logger.error(`[Cron] Location processing failed for user ${user.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await precomputeAfterLocation(completedLocationWindows);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[Cron] Daily location processing completed in ${elapsed}s`, { reason });
    return { skipped: false, days: dayResults, completedLocationWindows };
  } catch (error) {
    logger.error("[Cron] Daily location processing failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    await precomputeAfterLocation([]);
    return { skipped: false, days: [], completedLocationWindows: [] };
  } finally {
    isLocationProcessingRunning = false;
  }
}

/**
 * Detect multi-day trips from visits. Unlike the daily location pipeline (which
 * processes one day at a time), trip detection is a range operation — it groups
 * consecutive away-from-home days into trips — so it runs on its own weekly
 * schedule rather than inside the per-day loop.
 *
 * Scans a rolling 120-day window so any recent trip falls fully inside it (a
 * trip clipped by the window edge would get a truncated start/end). The
 * overlap-skip in detectAndPersistTrips makes this idempotent: trips already
 * persisted from a previous run (or the historical backfill) are not duplicated.
 * A single-flight guard prevents overlap with a still-running pass.
 */
async function runTripDetection(reason: string) {
  if (isTripDetectionRunning) {
    logger.info("[Cron] Trip detection already running, skipping", { reason });
    return;
  }
  isTripDetectionRunning = true;
  const startTime = Date.now();
  logger.info("[Cron] Starting trip detection", { reason });

  try {
    const db = getDb();
    const allUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.ownTracksApiKey} IS NOT NULL`);

    if (allUsers.length === 0) {
      logger.info("[Cron] No users with OwnTracks configured. Skipping trip detection.");
      return;
    }

    const { detectAndPersistTrips } = await import("@/modules/location/services/trip-detector");

    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 120);
    const fromStr = toLocalDateString(from);
    const toStr = toLocalDateString(to);

    for (const user of allUsers) {
      try {
        const result = await detectAndPersistTrips(user.id, fromStr, toStr);
        if (result.inserted > 0) {
          logger.info(
            `[Cron] Trip detection for ${user.id}: ${result.inserted} new trip(s) (${result.detected} detected, ${result.skipped} existing)`
          );
        }
      } catch (err) {
        logger.error(`[Cron] Trip detection failed for user ${user.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[Cron] Trip detection completed in ${elapsed}s`, { reason });
  } catch (error) {
    logger.error("[Cron] Fatal error during trip detection", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isTripDetectionRunning = false;
  }
}

/**
 * Reparse today's Toss notifications for all users
 * Runs daily — picks up notifications that failed to parse with older parser versions
 */
export async function reparseTodayNotifications() {
  const db = getDb();

  try {
    const tossUsers = await db
      .select({ id: users.id, githubLogin: users.githubLogin, tossMyName: users.tossMyName })
      .from(users)
      .where(sql`${users.tossNotificationApiKey} IS NOT NULL`);

    if (tossUsers.length === 0) return;

    const today = new Date();
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    const { reparseNotifications } = await import("@/modules/transaction/reparse-service");

    for (const user of tossUsers) {
      try {
        const totals = await reparseNotifications(db, user.id, {
          dryRun: false,
          from: dayStart,
          to: dayEnd,
          tossMyName: user.tossMyName,
        });
        totalCreated += totals.created;
        totalUpdated += totals.updated;
        totalSkipped += totals.skipped;
      } catch (error) {
        logger.error("[Cron] Toss reparse error for user", {
          userId: user.id,
          githubLogin: user.githubLogin,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (totalCreated > 0 || totalUpdated > 0) {
      logger.info("[Cron] Daily Toss reparse completed", {
        created: totalCreated,
        updated: totalUpdated,
        skipped: totalSkipped,
      });
    }
  } catch (error) {
    logger.error("[Cron] Fatal error during Toss reparse", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Initialize cron service
 * Should be called once when the server starts
 */
export function initializeCron() {
  if (isInitialized) {
    logger.info("[Cron] Already initialized. Skipping.");
    return;
  }

  const CRON_SCHEDULE = "*/10 * * * *";
  const DAILY_REPARSE_SCHEDULE = "0 23 * * *"; // 매일 23시 (당일 알림 재파싱)

  logger.info("[Cron] Service starting", {
    schedule: CRON_SCHEDULE,
    dailyReparseSchedule: DAILY_REPARSE_SCHEDULE,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  // node-cron v4 options: pass timezone explicitly. Relying on the process-
  // level TZ env is risky because node-cron falls back to Intl lookup which
  // depends on the container having tzdata — alpine images often lack it,
  // which would silently resolve to UTC and make "0 1 * * *" fire at 10:00 KST
  // (during business hours / deploy windows, easy to miss).
  const TZ = "Asia/Seoul";

  cronTask = cron.schedule(
    CRON_SCHEDULE,
    () => {
      syncAllUsers().catch((error) => {
        logger.error("[Cron] Unhandled error in sync job", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: TZ, name: "sync-users" }
  );

  spendingCategoryTask = cron.schedule(
    CRON_SCHEDULE,
    () => {
      categorizePendingSpending().catch((error) => {
        logger.error("[Cron] Unhandled error in spending categorization", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: TZ, name: "spending-categorization" }
  );

  dailyReparseTask = cron.schedule(
    DAILY_REPARSE_SCHEDULE,
    () => {
      reparseTodayNotifications().catch((error) => {
        logger.error("[Cron] Unhandled error in daily reparse", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: TZ, name: "toss-reparse" }
  );

  const LOCATION_PROCESSING_SCHEDULE = "0 1 * * *";
  locationProcessingTask = cron.schedule(
    LOCATION_PROCESSING_SCHEDULE,
    () => {
      processYesterdayLocations("daily-01:00").catch((error) => {
        logger.error("[Cron] Unhandled error in location processing", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: TZ, name: "location-processing" }
  );

  // Hourly safety net. The daily 01:00 schedule only fires if the container is
  // alive at exactly that minute and the run completes. A single missed tick
  // (crash, deploy, DB blip) used to mean 24h of unprocessed location data.
  // The hourly tick re-uses the same anomaly-IS-NULL date scan, so when there
  // is no backlog it is essentially a single empty-set query per OwnTracks
  // user. Single-flight guard prevents overlap with the daily run.
  const LOCATION_CATCHUP_SCHEDULE = "15 * * * *";
  locationCatchUpTask = cron.schedule(
    LOCATION_CATCHUP_SCHEDULE,
    () => {
      processYesterdayLocations("hourly-catchup").catch((error) => {
        logger.error("[Cron] Unhandled error in location catch-up", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: TZ, name: "location-catchup" }
  );

  // Yearly subway data refresh — Jan 1, 03:00 KST. OSM subway data is near-static
  // (new lines/stations open occasionally; line colors and geometry rarely
  // change). The boot catch-up below also re-fetches anything older than 350
  // days so a container that's been down on Jan 1 still gets the update.
  const SUBWAY_REFRESH_SCHEDULE = "0 3 1 1 *";
  subwayRefreshTask = cron.schedule(
    SUBWAY_REFRESH_SCHEDULE,
    () => {
      runSubwayRefresh("yearly-cron").catch((error) => {
        logger.error("[Cron] Unhandled error in yearly subway refresh", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: TZ, name: "subway-refresh" }
  );

  // Weekly trip detection — Sunday 02:00 KST, after the 01:00 location pipeline
  // has persisted the latest visits. Trip detection is a date-range operation
  // (it spans multiple days), so it can't live in the per-day location loop;
  // a weekly cadence is enough since a new trip only needs to surface within a
  // few days. The rolling-window + overlap-skip make every run idempotent.
  const TRIP_DETECTION_SCHEDULE = "0 2 * * 0";
  tripDetectionTask = cron.schedule(
    TRIP_DETECTION_SCHEDULE,
    () => {
      runTripDetection("weekly-cron").catch((error) => {
        logger.error("[Cron] Unhandled error in trip detection", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: TZ, name: "trip-detection" }
  );

  isInitialized = true;

  // Boot-time catch-up. Cron schedules only fire while the process is alive —
  // if the container restarted past 01:00 KST, yesterday's location processing
  // silently skipped. If it was down longer than syncIntervalHours, commit sync
  // is overdue. Run both on boot so a long outage auto-heals.
  //
  // RUN_ON_START=true remains a manual override that forces syncAllUsers
  // regardless of interval.
  if (process.env.RUN_ON_START === "true") {
    logger.info("[Cron] RUN_ON_START=true detected. Running sync immediately...");
    syncAllUsers().catch((error) => {
      logger.error("[Cron] Initial sync failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    categorizePendingSpending().catch((error) => {
      logger.error("[Cron] Initial spending categorization failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    processYesterdayLocations("run-on-start").catch((error) => {
      logger.error("[Cron] RUN_ON_START location processing failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    maybeRunSubwayBootCatchUp().catch((error) => {
      logger.error("[Cron] RUN_ON_START subway catch-up failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } else {
    // Short delay so the HTTP listener binds first (health checks shouldn't
    // compete with DB-heavy startup work).
    setTimeout(() => {
      // Run the three catch-up jobs SEQUENTIALLY, not concurrently. Firing them
      // all at once saturated the shared DB pool for ~25s on every boot (= every
      // deploy), stalling foreground requests like Better Auth session reads
      // ("get-session" infinite loading). Sequencing spreads the burst out; each
      // job's failure stays non-fatal so the chain still continues.
      void (async () => {
        logger.info("[Cron] Running boot-time catch-up");
        await syncAllUsers().catch((error) => {
          logger.error("[Cron] Boot-time sync failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
        await categorizePendingSpending().catch((error) => {
          logger.error("[Cron] Boot-time spending categorization failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
        await processYesterdayLocations("boot-catchup").catch((error) => {
          logger.error("[Cron] Boot-time location processing failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
        await maybeRunSubwayBootCatchUp().catch((error) => {
          logger.error("[Cron] Boot-time subway catch-up failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      })();
    }, 10_000);
  }

  logger.info("[Cron] Service initialized successfully.");
}

/**
 * Stop cron service
 * Used for graceful shutdown
 */
export async function stopCron() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  if (dailyReparseTask) {
    dailyReparseTask.stop();
    dailyReparseTask = null;
  }
  if (spendingCategoryTask) {
    spendingCategoryTask.stop();
    spendingCategoryTask = null;
  }
  if (locationProcessingTask) {
    locationProcessingTask.stop();
    locationProcessingTask = null;
  }
  if (locationCatchUpTask) {
    locationCatchUpTask.stop();
    locationCatchUpTask = null;
  }
  if (subwayRefreshTask) {
    subwayRefreshTask.stop();
    subwayRefreshTask = null;
  }
  if (tripDetectionTask) {
    tripDetectionTask.stop();
    tripDetectionTask = null;
  }
  if (isInitialized) {
    await logger.flush();
    logger.info("[Cron] Service stopped.");
    isInitialized = false;
  }
}
