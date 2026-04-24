/**
 * Cistory Cron Service
 *
 * Automatically syncs GitHub commits for all users based on their sync interval settings
 * Runs independently of user sessions - works even if users haven't logged in for months
 */

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import * as cron from "node-cron";
import { commitSummaries, commits, getDb, syncJobs, users } from "@/db";
import { maybeRefreshDataUsage } from "@/lib/data-usage";
import { logger } from "@/lib/logger";
import { toLocalDateString } from "@/lib/utils";
import { createSummaryService } from "@/modules/summary/service";
import {
  refreshAllSubwaySystems,
  seedSubwaySystemsIfEmpty,
} from "@/modules/subway/service";
import { createSyncService } from "@/modules/sync/service";
import { createWakaTimeSyncService } from "@/modules/wakatime/service";

let isInitialized = false;
let cronTask: cron.ScheduledTask | null = null;
let dailyReparseTask: cron.ScheduledTask | null = null;
let locationProcessingTask: cron.ScheduledTask | null = null;
let subwayRefreshTask: cron.ScheduledTask | null = null;
let isSubwayRefreshRunning = false;

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

async function syncAllUsers() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logger.info(`[Cron] Starting sync job`, { timestamp });

  const db = getDb();

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

        // Process pending summaries for recent commits (last 7 days)
        if (process.env.ANTHROPIC_API_KEY) {
          try {
            const summaryService = createSummaryService(
              db,
              process.env.ANTHROPIC_API_KEY,
              accessToken
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
 * Process un-anomaly-scanned days (location pipeline: anomaly → visits →
 * tracks → fog-cells). Runs daily at 01:00 KST and on container boot.
 *
 * Finds every past date for the user that still has location_points with
 * anomaly IS NULL (the signal that the day hasn't been processed yet) and
 * runs the pipeline for each. Cap at 14 days per invocation so we don't block
 * the event loop on a months-long backlog — subsequent boots catch the rest.
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

    const { detectAndPersistVisits } = await import("@/modules/location/services/visit-persister");
    const { detectAndPersistTracks } = await import("@/modules/location/services/track-persister");

    // Always include yesterday. Adding it explicitly covers the case where
    // yesterday has no points with anomaly IS NULL yet (edge race at 00:00).
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateString(yesterday);
    const todayStr = toLocalDateString(new Date());

    for (const user of allUsers) {
      try {
        // Find unprocessed dates (at most 14, oldest first).
        const unprocessedResult = await db.execute<{ d: string; [key: string]: unknown }>(sql`
          SELECT to_char(d, 'YYYY-MM-DD') AS d FROM (
            SELECT date(timestamp) AS d
            FROM location_points
            WHERE user_id = ${user.id}
              AND date(timestamp) < ${todayStr}::date
            GROUP BY date(timestamp)
            HAVING count(*) FILTER (WHERE anomaly IS NULL) > 0
            ORDER BY date(timestamp) DESC
            LIMIT 14
          ) recent
          ORDER BY d
        `);
        const datesToProcess = new Set<string>(unprocessedResult.rows.map((r) => r.d));
        datesToProcess.add(yesterdayStr);
        const dateList = Array.from(datesToProcess).sort();

        if (dateList.length > 1) {
          logger.info(
            `[Cron] Location catch-up for ${user.id}: ${dateList.length} dates (${dateList[0]} .. ${dateList[dateList.length - 1]})`
          );
        }

        for (const dateStr of dateList) {
          const anomalyResult = await runAnomalyDetectionForDay(user.id, dateStr);
          if (anomalyResult.total > 0) {
            logger.info(
              `[Cron] Anomaly detection for ${user.id} ${dateStr}: ${anomalyResult.total} anomalies marked`
            );
          }

          const detectedVisits = await detectAndPersistVisits(user.id, dateStr);
          if (detectedVisits.length > 0) {
            logger.info(
              `[Cron] Visit detection for ${user.id} ${dateStr}: ${detectedVisits.length} visits persisted`
            );
          }

          const trackResult = await detectAndPersistTracks(user.id, dateStr);
          if (trackResult.trackCount > 0 || trackResult.segmentCount > 0) {
            logger.info(
              `[Cron] Track detection for ${user.id} ${dateStr}: ${trackResult.trackCount} tracks, ${trackResult.segmentCount} segments persisted`
            );
          }
        }

        // P7: refresh fog_cells_cache so the map endpoint doesn't GROUP BY the
        // full location_points table on every user pageview. Recomputes the
        // whole grid (full, not incremental) — the aggregate is cheap once per
        // day and keeps the cache simple to reason about.
        try {
          const fogResult = await db.execute<{ refreshed: number; [key: string]: unknown }>(sql`
            WITH aggregated AS (
              SELECT
                ROUND(lat::numeric * 100) / 100 AS lat,
                ROUND(lon::numeric * 100) / 100 AS lon
              FROM location_points
              WHERE user_id = ${user.id}
              GROUP BY 1, 2
            ),
            deleted AS (
              DELETE FROM fog_cells_cache WHERE user_id = ${user.id}
            ),
            inserted AS (
              INSERT INTO fog_cells_cache (user_id, lat, lon, calculated_at)
              SELECT ${user.id}, lat, lon, NOW() FROM aggregated
              RETURNING id
            )
            SELECT count(*)::int AS refreshed FROM inserted
          `);
          const refreshed = fogResult.rows[0]?.refreshed ?? 0;
          if (refreshed > 0) {
            logger.info(`[Cron] Fog cells refreshed for ${user.id}: ${refreshed} cells`);
          }
        } catch (fogError) {
          logger.error("[Cron] Fog cells refresh error", {
            userId: user.id,
            error: fogError instanceof Error ? fogError.message : String(fogError),
          });
        }
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
          for (const dateStr of dateList) {
            const matchResult = await matchSubwayTrips(user.id, dateStr);
            if (matchResult.legsInserted > 0) {
              const sessionResult = await groupMatchesIntoSessions(user.id, dateStr);
              if (sessionResult.multiLegSessions > 0) {
                logger.info(`[Cron] Subway transfers for ${user.id} ${dateStr}: ${sessionResult.multiLegSessions} multi-leg sessions`);
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
      processYesterdayLocations().catch((error) => {
        logger.error("[Cron] Unhandled error in location processing", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: TZ, name: "location-processing" }
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
  } else {
    // Short delay so the HTTP listener binds first (health checks shouldn't
    // compete with DB-heavy startup work).
    setTimeout(() => {
      logger.info("[Cron] Running boot-time catch-up");
      syncAllUsers().catch((error) => {
        logger.error("[Cron] Boot-time sync failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      processYesterdayLocations().catch((error) => {
        logger.error("[Cron] Boot-time location processing failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      maybeRunSubwayBootCatchUp().catch((error) => {
        logger.error("[Cron] Boot-time subway catch-up failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
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
  if (locationProcessingTask) {
    locationProcessingTask.stop();
    locationProcessingTask = null;
  }
  if (subwayRefreshTask) {
    subwayRefreshTask.stop();
    subwayRefreshTask = null;
  }
  if (isInitialized) {
    await logger.flush();
    logger.info("[Cron] Service stopped.");
    isInitialized = false;
  }
}
