/**
 * Cistory Cron Service
 *
 * Automatically syncs GitHub commits for all users based on their sync interval settings
 * Runs independently of user sessions - works even if users haven't logged in for months
 */

import * as cron from 'node-cron';
import { getDb, users, commits, commitSummaries, syncJobs } from '@/db';
import { createSyncService } from '@/modules/sync/service';
import { createSummaryService } from '@/modules/summary/service';
import { createWakaTimeSyncService } from '@/modules/wakatime/service';
import { sql, eq, and, gte, lt, inArray } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { maybeRefreshDataUsage } from '@/lib/data-usage';

let isInitialized = false;
let cronTask: cron.ScheduledTask | null = null;

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
      logger.info('[Cron] No users to sync. Exiting.');
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
          throw new Error('GitHub access token not found');
        }

        const syncService = createSyncService(db, user.githubAccessToken);

        // Sync commits (uses Search API for initial and regular)
        if (!user.initialSyncCompleted) {
          await syncService.initialSync(user.id, user.githubLogin);
        } else {
          await syncService.syncUserCommits(user.id, user.githubLogin, 'scheduled');
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
                  inArray(commitSummaries.status, ['pending', 'failed'])
                )
              )
              .limit(5);

            if (recentCommitsWithPendingSummaries.length > 0) {
              logger.info(`[Cron] Found ${recentCommitsWithPendingSummaries.length} recent commits needing summaries`, {
                userId: user.id,
                githubLogin: user.githubLogin,
              });

              let processed = 0;
              for (const { commitId } of recentCommitsWithPendingSummaries) {
                try {
                  await summaryService.generateSummary(commitId);
                  processed++;
                } catch (error) {
                  // Continue with next commit even if one fails
                }
                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
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
              logger.error('[Cron] WakaTime sync error', {
                userId: user.id,
                githubLogin: user.githubLogin,
                error: wakatimeError instanceof Error ? wakatimeError.message : String(wakatimeError),
              });
            }
          }
        }

        // Data usage cache refresh (once per 24h)
        try {
          await maybeRefreshDataUsage(db, user.id);
        } catch (usageError) {
          logger.error('[Cron] Data usage refresh error', {
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
          status: 'success',
        });

        results.push({
          user: user.githubLogin,
          status: 'success',
        });
      } catch (error) {
        const duration = Date.now() - userStartTime;
        failCount++;

        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error(`[Cron] Sync failed: ${user.githubLogin}`, {
          userId: user.id,
          githubLogin: user.githubLogin,
          duration,
          status: 'failed',
          error: errorMessage,
        });

        results.push({
          user: user.githubLogin,
          status: 'failed',
          error: errorMessage,
        });

        // Continue with next user even if this one failed
        continue;
      }
    }

    // Print summary
    const totalDuration = Date.now() - startTime;

    logger.info('[Cron] Sync job completed', {
      totalUsers: usersToSync.length,
      successCount,
      failCount,
      duration: totalDuration,
      failedUsers: results.filter(r => r.status === 'failed').map(r => ({ user: r.user, error: r.error })),
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
      logger.error('[Cron] Failed to cleanup old sync jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

  } catch (error) {
    logger.error('[Cron] Fatal error during sync job', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

/**
 * Initialize cron service
 * Should be called once when the server starts
 */
export function initializeCron() {
  if (isInitialized) {
    logger.info('[Cron] Already initialized. Skipping.');
    return;
  }

  const CRON_SCHEDULE = '*/10 * * * *';

  logger.info('[Cron] Service starting', {
    schedule: CRON_SCHEDULE,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  // Set up cron job
  cronTask = cron.schedule(CRON_SCHEDULE, () => {
    syncAllUsers().catch(error => {
      logger.error('[Cron] Unhandled error in sync job', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  isInitialized = true;

  // Run immediately on start if environment variable is set
  if (process.env.RUN_ON_START === 'true') {
    logger.info('[Cron] RUN_ON_START=true detected. Running sync immediately...');
    syncAllUsers().catch(error => {
      logger.error('[Cron] Initial sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  logger.info('[Cron] Service initialized successfully.');
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
  if (isInitialized) {
    await logger.flush();
    logger.info('[Cron] Service stopped.');
    isInitialized = false;
  }
}
