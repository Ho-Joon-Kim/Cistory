/**
 * Cistory Cron Service
 *
 * Automatically syncs GitHub commits for all users based on their sync interval settings
 * Runs independently of user sessions - works even if users haven't logged in for months
 */

import * as cron from 'node-cron';
import { getDb, users, commits, commitSummaries } from '@/db';
import { createSyncService } from '@/modules/sync/service';
import { createSummaryService } from '@/modules/summary/service';
import { sql, eq, and, gte, inArray } from 'drizzle-orm';

let isInitialized = false;
let cronTask: cron.ScheduledTask | null = null;

async function syncAllUsers() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Cron] Starting sync job at ${timestamp}`);
  console.log(`${'='.repeat(60)}\n`);

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
      })
      .from(users)
      .where(sql`${users.githubAccessToken} IS NOT NULL`);

    console.log(`[Cron] Found ${usersToSync.length} user(s) requiring sync\n`);

    if (usersToSync.length === 0) {
      console.log('[Cron] No users to sync. Exiting.');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const results: Array<{ user: string; status: string; error?: string }> = [];

    // Sync each user sequentially to avoid rate limits
    for (const user of usersToSync) {
      const userStartTime = Date.now();

      try {
        console.log(`[Cron] ┌─ Syncing: ${user.githubLogin} (${user.id})`);
        console.log(`[Cron] │  Last synced: ${user.lastSyncedAt || 'Never'}`);
        console.log(`[Cron] │  Sync interval: ${user.syncIntervalHours}h`);
        console.log(`[Cron] │  Initial sync: ${user.initialSyncCompleted ? 'Yes' : 'No'}`);

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
              console.log(`[Cron] │  Found ${recentCommitsWithPendingSummaries.length} recent commits needing summaries`);

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
                console.log(`[Cron] │  Processed ${processed} summaries for recent commits`);
              }
            }
          } catch (summaryError) {
            console.error(`[Cron] │  Summary processing error: ${summaryError instanceof Error ? summaryError.message : summaryError}`);
          }
        }

        const duration = Date.now() - userStartTime;
        successCount++;

        console.log(`[Cron] └─ ✓ Success in ${duration}ms\n`);

        results.push({
          user: user.githubLogin,
          status: 'success',
        });
      } catch (error) {
        const duration = Date.now() - userStartTime;
        failCount++;

        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Cron] └─ ✗ Failed in ${duration}ms`);
        console.error(`[Cron]    Error: ${errorMessage}\n`);

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
    console.log(`${'='.repeat(60)}`);
    console.log('[Cron] Sync Job Summary');
    console.log(`${'='.repeat(60)}`);
    console.log(`Total users:     ${usersToSync.length}`);
    console.log(`Successful:      ${successCount}`);
    console.log(`Failed:          ${failCount}`);
    console.log(`Duration:        ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
    console.log(`Completed at:    ${new Date().toISOString()}`);
    console.log(`${'='.repeat(60)}\n`);

    // Detailed results
    if (failCount > 0) {
      console.log('Failed syncs:');
      results
        .filter(r => r.status === 'failed')
        .forEach(r => {
          console.log(`  - ${r.user}: ${r.error}`);
        });
      console.log('');
    }

  } catch (error) {
    console.error('[Cron] Fatal error during sync job:');
    console.error(error);
    console.error('');
  }
}

/**
 * Initialize cron service
 * Should be called once when the server starts
 */
export function initializeCron() {
  if (isInitialized) {
    console.log('[Cron] Already initialized. Skipping.');
    return;
  }

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         Cistory Cron Service - Starting                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // Schedule: Run every 10 minutes
  // Cron format: minute hour day month weekday
  // "*/10 * * * *" = Every 10 minutes
  const CRON_SCHEDULE = '*/10 * * * *';

  console.log(`Schedule:  ${CRON_SCHEDULE} (Every 10 minutes)`);
  console.log(`Timezone:  ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  console.log(`Started:   ${new Date().toISOString()}`);
  console.log('');

  // Set up cron job
  cronTask = cron.schedule(CRON_SCHEDULE, () => {
    syncAllUsers().catch(error => {
      console.error('[Cron] Unhandled error in sync job:');
      console.error(error);
    });
  });

  isInitialized = true;

  // Run immediately on start if environment variable is set
  if (process.env.RUN_ON_START === 'true') {
    console.log('[Cron] RUN_ON_START=true detected. Running sync immediately...\n');
    syncAllUsers().catch(error => {
      console.error('[Cron] Initial sync failed:');
      console.error(error);
    });
  }

  console.log('[Cron] Service initialized successfully.\n');
}

/**
 * Stop cron service
 * Used for graceful shutdown
 */
export function stopCron() {
  if (cronTask) {
    cronTask.stop();
    console.log('[Cron] Service stopped.');
    isInitialized = false;
    cronTask = null;
  }
}
