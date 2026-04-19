/**
 * Cistory Cron Service
 *
 * Automatically syncs GitHub commits for all users based on their sync interval settings
 * Runs independently of user sessions - works even if users haven't logged in for months
 */

import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import * as cron from "node-cron";
import {
  commitSummaries,
  commits,
  getDb,
  notificationLogs,
  syncJobs,
  transactions,
  users,
} from "@/db";
import { maybeRefreshDataUsage } from "@/lib/data-usage";
import { logger } from "@/lib/logger";
import { toLocalDateString } from "@/lib/utils";
import { createSummaryService } from "@/modules/summary/service";
import { createSyncService } from "@/modules/sync/service";
import { parseTossNotification } from "@/modules/transaction/parser";
import { createWakaTimeSyncService } from "@/modules/wakatime/service";

let isInitialized = false;
let cronTask: cron.ScheduledTask | null = null;
let dailyReparseTask: cron.ScheduledTask | null = null;
let locationProcessingTask: cron.ScheduledTask | null = null;

async function syncAllUsers() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logger.info(`[Cron] Starting sync job`, { timestamp });

  const db = getDb();

  try {
    // Find all users with GitHub access token (sync every 10 minutes)
    const usersToSync = await db
      .select({
        id: users.id,
        githubLogin: users.githubLogin,
        githubAccessToken: users.githubAccessToken,
        syncIntervalHours: users.syncIntervalHours,
        lastSyncedAt: users.lastSyncedAt,
        initialSyncCompleted: users.initialSyncCompleted,
        wakatimeApiKey: users.wakatimeApiKey,
        wakatimeLastSyncedAt: users.wakatimeLastSyncedAt,
      })
      .from(users)
      .where(sql`${users.githubAccessToken} IS NOT NULL`);

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

        if (!user.githubAccessToken) {
          throw new Error("GitHub access token not found");
        }

        const syncService = createSyncService(db, user.githubAccessToken);

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

        // Process pending summaries for recent commits (last 7 days)
        if (process.env.ANTHROPIC_API_KEY) {
          try {
            const summaryService = createSummaryService(
              db,
              process.env.ANTHROPIC_API_KEY,
              user.githubAccessToken
            );

            // Find commits from last 7 days with pending/failed summaries
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

            const recentCommitsWithPendingSummaries = await db
              .select({ commitId: commits.id })
              .from(commits)
              .innerJoin(commitSummaries, eq(commits.id, commitSummaries.commitId))
              .where(
                and(
                  eq(commits.userId, user.id),
                  gte(commits.committedAt, oneWeekAgo),
                  inArray(commitSummaries.status, ["pending", "failed"])
                )
              )
              .limit(5);

            if (recentCommitsWithPendingSummaries.length > 0) {
              logger.info(
                `[Cron] Found ${recentCommitsWithPendingSummaries.length} recent commits needing summaries`,
                {
                  userId: user.id,
                  githubLogin: user.githubLogin,
                }
              );

              let processed = 0;
              for (const { commitId } of recentCommitsWithPendingSummaries) {
                try {
                  await summaryService.generateSummary(commitId);
                  processed++;
                } catch (_error) {
                  // Continue with next commit even if one fails
                }
                // Rate limiting
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }

              if (processed > 0) {
                logger.info(`[Cron] Processed ${processed} summaries`, {
                  userId: user.id,
                  githubLogin: user.githubLogin,
                });
              }
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
 * Process yesterday's location data: anomaly detection, visit detection, transport modes.
 * Runs daily at 01:00 KST.
 */
async function processYesterdayLocations() {
  const startTime = Date.now();
  logger.info("[Cron] Starting daily location processing");

  try {
    const { runAnomalyDetectionForDay } = await import(
      "@/modules/location/services/anomaly-filter"
    );

    const db = getDb();
    const allUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.ownTracksApiKey} IS NOT NULL`);

    if (allUsers.length === 0) {
      logger.info("[Cron] No users with OwnTracks configured. Skipping location processing.");
      return;
    }

    // Yesterday in local timezone (KST in production)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateString(yesterday);

    const { detectAndPersistVisits } = await import("@/modules/location/services/visit-persister");
    const { detectAndPersistTracks } = await import("@/modules/location/services/track-persister");

    for (const user of allUsers) {
      try {
        // 1. Anomaly detection
        const anomalyResult = await runAnomalyDetectionForDay(user.id, yesterdayStr);
        if (anomalyResult.total > 0) {
          logger.info(
            `[Cron] Anomaly detection for ${user.id}: ${anomalyResult.total} anomalies marked`
          );
        }

        // 2. Visit detection + persist
        const detectedVisits = await detectAndPersistVisits(user.id, yesterdayStr);
        if (detectedVisits.length > 0) {
          logger.info(
            `[Cron] Visit detection for ${user.id}: ${detectedVisits.length} visits persisted`
          );
        }

        // 3. Track + transport-mode detection + persist.
        // Uses the same track-persister as location-backfill so cron-written
        // days also have rows in `tracks` (not orphan segments with trackId=null).
        const trackResult = await detectAndPersistTracks(user.id, yesterdayStr);
        if (trackResult.trackCount > 0 || trackResult.segmentCount > 0) {
          logger.info(
            `[Cron] Track detection for ${user.id}: ${trackResult.trackCount} tracks, ${trackResult.segmentCount} segments persisted`
          );
        }
      } catch (err) {
        logger.error(`[Cron] Location processing failed for user ${user.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[Cron] Daily location processing completed in ${elapsed}s`);
  } catch (error) {
    logger.error("[Cron] Daily location processing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Reparse today's Toss notifications for all users
 * Runs daily — picks up notifications that failed to parse with older parser versions
 */
async function reparseTodayNotifications() {
  const db = getDb();

  try {
    // Find users with toss notification key
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

    for (const user of tossUsers) {
      try {
        const logs = await db
          .select({
            id: notificationLogs.id,
            rawPayload: notificationLogs.rawPayload,
            receivedAt: notificationLogs.receivedAt,
          })
          .from(notificationLogs)
          .where(
            and(
              eq(notificationLogs.userId, user.id),
              gte(notificationLogs.receivedAt, dayStart),
              lt(notificationLogs.receivedAt, dayEnd)
            )
          )
          .orderBy(desc(notificationLogs.receivedAt));

        if (logs.length === 0) continue;

        for (const log of logs) {
          let title = "";
          let text = "";
          try {
            const payload = JSON.parse(log.rawPayload);
            title = typeof payload.title === "string" ? payload.title : "";
            text = typeof payload.text === "string" ? payload.text : "";
          } catch {
            totalSkipped++;
            continue;
          }

          if (!title || !text) {
            totalSkipped++;
            continue;
          }

          const parsed = parseTossNotification(title, text, { myName: user.tossMyName });
          if (!parsed) {
            totalSkipped++;
            continue;
          }

          // Check if transaction already exists for this log
          const existing = await db
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(eq(transactions.userId, user.id), eq(transactions.notificationLogId, log.id))
            )
            .limit(1);

          const isUpdate = existing.length > 0;

          // Check for duplicate within ±2 minutes
          const windowMs = 2 * 60 * 1000;
          const receivedAt = new Date(log.receivedAt);
          const windowStart = new Date(receivedAt.getTime() - windowMs);
          const windowEnd = new Date(receivedAt.getTime() + windowMs);

          const duplicates = await db
            .select({ id: transactions.id, notificationLogId: transactions.notificationLogId })
            .from(transactions)
            .where(
              and(
                eq(transactions.userId, user.id),
                eq(transactions.amount, parsed.amount),
                eq(transactions.merchant, parsed.merchant),
                eq(transactions.type, parsed.type),
                gte(transactions.transactedAt, windowStart),
                lte(transactions.transactedAt, windowEnd)
              )
            )
            .limit(1);

          if (duplicates.length > 0 && duplicates[0].notificationLogId !== log.id) {
            totalSkipped++;
            continue;
          }

          // Upsert transaction
          await db
            .insert(transactions)
            .values({
              userId: user.id,
              notificationLogId: log.id,
              type: parsed.type,
              amount: parsed.amount,
              merchant: parsed.merchant,
              accountName: parsed.accountName,
              rawTitle: title,
              rawText: text,
              transactedAt: receivedAt,
              createdAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [transactions.userId, transactions.notificationLogId],
              set: {
                type: sql`excluded.type`,
                amount: sql`excluded.amount`,
                merchant: sql`excluded.merchant`,
                accountName: sql`excluded.account_name`,
                rawTitle: sql`excluded.raw_title`,
                rawText: sql`excluded.raw_text`,
              },
            });

          if (isUpdate) totalUpdated++;
          else totalCreated++;
        }
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

  // Set up cron job (every 10 minutes)
  cronTask = cron.schedule(CRON_SCHEDULE, () => {
    syncAllUsers().catch((error) => {
      logger.error("[Cron] Unhandled error in sync job", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  // Daily Toss notification reparse (23:00)
  dailyReparseTask = cron.schedule(DAILY_REPARSE_SCHEDULE, () => {
    reparseTodayNotifications().catch((error) => {
      logger.error("[Cron] Unhandled error in daily reparse", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  // Daily location processing (01:00 — anomaly detection, visit detection, transport modes)
  const LOCATION_PROCESSING_SCHEDULE = "0 1 * * *";
  locationProcessingTask = cron.schedule(LOCATION_PROCESSING_SCHEDULE, () => {
    processYesterdayLocations().catch((error) => {
      logger.error("[Cron] Unhandled error in location processing", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  isInitialized = true;

  // Run immediately on start if environment variable is set
  if (process.env.RUN_ON_START === "true") {
    logger.info("[Cron] RUN_ON_START=true detected. Running sync immediately...");
    syncAllUsers().catch((error) => {
      logger.error("[Cron] Initial sync failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
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
  if (locationProcessingTask) {
    locationProcessingTask.stop();
    locationProcessingTask = null;
  }
  if (isInitialized) {
    await logger.flush();
    logger.info("[Cron] Service stopped.");
    isInitialized = false;
  }
}
