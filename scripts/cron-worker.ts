#!/usr/bin/env ts-node
/**
 * Cistory Cron Worker
 *
 * Automatically syncs GitHub commits for all users based on their sync interval settings
 * Runs independently of user sessions - works even if users haven't logged in for months
 */

import cron from 'node-cron';
import { getDb, users } from '@/db';
import { createSyncService } from '@/modules/sync/service';
import { sql, or, isNull } from 'drizzle-orm';

async function syncAllUsers() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Cron] Starting sync job at ${timestamp}`);
  console.log(`${'='.repeat(60)}\n`);

  const db = getDb();

  try {
    // Find users who need syncing
    // 1. Users who have never been synced (lastSyncedAt IS NULL)
    // 2. Users whose last sync was longer ago than their sync interval
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
      .where(
        or(
          // Never synced
          isNull(users.lastSyncedAt),
          // Last sync older than interval
          sql`${users.lastSyncedAt} < NOW() - (${users.syncIntervalHours} || ' hours')::INTERVAL`
        )
      );

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

        // Sync commits (uses Search API for initial, Events API for regular)
        await syncService.syncCommits(user.id, 'scheduled');

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

// ============================================================================
// Cron Schedule Configuration
// ============================================================================

// Schedule: Run every hour at :00
// Cron format: minute hour day month weekday
// "0 * * * *" = Every hour at minute 0
const CRON_SCHEDULE = '0 * * * *';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║         Cistory Cron Worker - Starting                    ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`Schedule:  ${CRON_SCHEDULE} (Every hour at :00)`);
console.log(`Timezone:  ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
console.log(`Started:   ${new Date().toISOString()}`);
console.log('');
console.log('Worker is running. Press Ctrl+C to stop.');
console.log('');

// Set up cron job
cron.schedule(CRON_SCHEDULE, () => {
  syncAllUsers().catch(error => {
    console.error('[Cron] Unhandled error in sync job:');
    console.error(error);
  });
});

// Run immediately on start if environment variable is set
if (process.env.RUN_ON_START === 'true') {
  console.log('[Cron] RUN_ON_START=true detected. Running sync immediately...\n');
  syncAllUsers().catch(error => {
    console.error('[Cron] Initial sync failed:');
    console.error(error);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Cron] Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Cron] Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});
