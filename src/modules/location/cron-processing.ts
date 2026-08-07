import { sql } from "drizzle-orm";
import { getDb, users } from "@/db";
import { logger } from "@/lib/logger";
import { toLocalDateString } from "@/lib/utils";
import { rebuildDailyLocationHeatmap } from "@/modules/overview/aggregate/location";
import { precomputeAfterLocation } from "@/modules/overview/cron";
import type { LocationCompletedWindow } from "@/modules/overview/precompute";

let isLocationProcessingRunning = false;
let isRouteMatchPostProcessingRunning = false;

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
  // Record how many points the day held at completion. That count is what makes the
  // day "settled": if it later differs, points arrived after the pipeline ran and the
  // day becomes a candidate again. This replaces the old `anomaly IS NULL` marker,
  // which cost a rewrite of ~98% of the day's rows every run. A count is used rather
  // than comparing `location_points.created_at` against `completed_at` because those
  // two columns are on different timezone conventions (UTC wall vs KST wall), so the
  // comparison would be silently 9 hours wrong.
  await db.execute(sql`
    UPDATE location_processing_days
    SET status = 'completed', completed_at = ${now}, last_error = NULL, updated_at = ${now},
      point_count = (
        SELECT count(*)::int FROM location_points
        WHERE user_id = ${userId}
          AND (timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = ${date}::date
      )
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

async function candidateDates(
  db: ReturnType<typeof getDb>,
  userId: string,
  yesterday: string,
  today: string
): Promise<string[]> {
  const result = await db.execute<{ d: string; [key: string]: unknown }>(sql`
    SELECT to_char(candidate_days.d, 'YYYY-MM-DD') AS d FROM (
      SELECT point_days.d FROM (
        SELECT
          (timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date AS d,
          count(*)::int AS point_count
        FROM location_points
        WHERE user_id = ${userId}
          AND timestamp >= (now() at time zone 'UTC') - interval '45 days'
          AND (timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date <= ${today}::date
        GROUP BY 1
      ) point_days
      LEFT JOIN location_processing_days processing
        ON processing.user_id = ${userId}
        AND processing.date = to_char(point_days.d, 'YYYY-MM-DD')
      -- A settled day is one whose recorded point_count still matches what is there.
      -- A NULL point_count means "completed before we tracked it" and is treated as
      -- unknown, so the day gets re-examined once. Replaces the old marker scan,
      -- count(*) FILTER (WHERE anomaly IS NULL) > 0.
      WHERE processing.point_count IS DISTINCT FROM point_days.point_count
        OR point_days.d IN (${yesterday}::date, ${today}::date)
        OR processing.id IS NULL
        OR processing.status = 'failed'
        OR (
          processing.status = 'processing'
          AND processing.processing_started_at <= now() - interval '20 minutes'
        )
      UNION
      SELECT processing.date::date AS d
      FROM location_processing_days processing
      WHERE processing.user_id = ${userId}
        AND processing.date::date >= ${today}::date - 45
        AND processing.date::date <= ${today}::date
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
  return Array.from(new Set(result.rows.map((row) => row.d))).sort();
}

async function runSubwayPostProcessing(userId: string, completedDates: string[]) {
  try {
    const { matchSubwayTrips } = await import("./services/subway-match/matcher");
    const { groupMatchesIntoSessions } = await import("./services/subway-match/session-grouper");
    for (const date of completedDates) {
      const matchResult = await matchSubwayTrips(userId, date);
      if (matchResult.legsInserted > 0) {
        const sessionResult = await groupMatchesIntoSessions(userId, date);
        if (sessionResult.multiLegSessions > 0) {
          logger.info(
            `[Cron] Subway transfers for ${userId} ${date}: ${sessionResult.multiLegSessions} multi-leg sessions`
          );
        }
      }
    }
  } catch (error) {
    logger.warn("[Cron] Subway matching failed (non-fatal)", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runRouteMatchPostProcessing(userId: string, completedDates: string[]) {
  if (isRouteMatchPostProcessingRunning) {
    logger.info("[Cron] Route matching already running, skipping", { userId });
    return;
  }
  isRouteMatchPostProcessingRunning = true;
  try {
    const { matchRoutesForDay } = await import("./services/route-match/matcher");
    for (const date of completedDates) {
      const summary = await matchRoutesForDay(userId, date);
      if (summary.aborted) {
        // Valhalla is unreachable — every other date in this batch would hit the same wall, so
        // stop here instead of repeating the same failed connection attempt per date. Nothing
        // was written for this date (or would be for the rest), so it's still an unprocessed
        // route-match candidate: the hourly catch-up net always re-includes "yesterday"/"today"
        // regardless of completion status, which retries this automatically once the engine is
        // back — no operator action needed, unlike before this behavior existed.
        logger.warn("[Cron] Valhalla unreachable — route matching deferred to the next tick", {
          userId,
          date,
        });
        break;
      }
    }
  } catch (error) {
    logger.warn("[Cron] Route matching failed (non-fatal)", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isRouteMatchPostProcessingRunning = false;
  }
}

async function discoverSubwayCities(userId: string) {
  try {
    const { discoverMissingSubwayCities } = await import("./services/subway-discovery");
    await discoverMissingSubwayCities(userId);
  } catch (error) {
    logger.warn("[Cron] Subway discovery failed (non-fatal)", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

type LocationCoreServices = Parameters<typeof runLocationCoreDay>[3];

async function processLocationDate(
  db: ReturnType<typeof getDb>,
  userId: string,
  date: string,
  services: LocationCoreServices
): Promise<LocationDayProcessingResult> {
  try {
    await runLocationStateWrite(() => markLocationDayProcessing(db, userId, date, new Date()));
    await runLocationCoreDay(db, userId, date, services);
    await runLocationStateWrite(() => markLocationDayCompleted(db, userId, date, new Date()));
    return { userId, date, status: "completed" };
  } catch (error) {
    const result: LocationDayProcessingResult = {
      userId,
      date,
      status: "failed",
      failedStage: coreFailureStage(error),
      error: error instanceof Error ? error.message : String(error),
    };
    try {
      await markLocationDayFailed(db, userId, date, result.error ?? "unknown", new Date());
    } catch (stateError) {
      logger.error(`[Cron] Failed to persist location failure for ${userId} ${date}`, {
        error: stateError instanceof Error ? stateError.message : String(stateError),
      });
    }
    logger.error(`[Cron] Location core pipeline failed for ${userId} ${date}`, { ...result });
    return result;
  }
}

async function processLocationUser(
  db: ReturnType<typeof getDb>,
  userId: string,
  yesterday: string,
  today: string,
  services: LocationCoreServices
): Promise<{
  days: LocationDayProcessingResult[];
  completedWindow: LocationCompletedWindow | null;
}> {
  const dates = await candidateDates(db, userId, yesterday, today);
  if (dates.length > 1) {
    logger.info(
      `[Cron] Location catch-up for ${userId}: ${dates.length} dates (${dates[0]} .. ${dates[dates.length - 1]})`
    );
  }
  const days: LocationDayProcessingResult[] = [];
  for (const date of dates) days.push(await processLocationDate(db, userId, date, services));

  const completedWindow =
    dates.length === 0
      ? { userId, completedThrough: today }
      : completedWindowForUser(userId, dates, days);
  const completedDates = days
    .filter((result) => result.status === "completed")
    .map((result) => result.date);
  await runSubwayPostProcessing(userId, completedDates);
  await runRouteMatchPostProcessing(userId, completedDates);
  await discoverSubwayCities(userId);
  return { days, completedWindow };
}

export async function processYesterdayLocations(reason: string): Promise<LocationProcessingResult> {
  if (isLocationProcessingRunning) {
    logger.info("[Cron] Location processing already running, skipping", { reason });
    return { skipped: true, days: [], completedLocationWindows: [] };
  }
  isLocationProcessingRunning = true;
  const startedAt = Date.now();
  logger.info("[Cron] Starting daily location processing", { reason });

  try {
    const { runAnomalyDetectionForDay } = await import("./services/anomaly-filter");
    const { detectAndPersistVisits } = await import("./services/visit-persister");
    const { detectAndPersistTracks } = await import("./services/track-persister");
    const db = getDb();
    const allUsers = await db
      .select({ id: users.id, ownTracksApiKey: users.ownTracksApiKey })
      .from(users)
      .where(sql`TRUE`);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toLocalDateString(yesterday);
    const todayStr = toLocalDateString(new Date());
    const days: LocationDayProcessingResult[] = [];
    const completedLocationWindows: LocationCompletedWindow[] = [];
    const services = {
      runAnomalyDetectionForDay,
      detectAndPersistVisits,
      detectAndPersistTracks,
    };

    for (const user of allUsers) {
      try {
        if (!user.ownTracksApiKey) {
          completedLocationWindows.push({ userId: user.id, completedThrough: todayStr });
          continue;
        }
        const result = await processLocationUser(db, user.id, yesterdayStr, todayStr, services);
        days.push(...result.days);
        if (result.completedWindow) completedLocationWindows.push(result.completedWindow);
      } catch (error) {
        logger.error(`[Cron] Location processing failed for user ${user.id}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await precomputeAfterLocation(completedLocationWindows);
    logger.info(
      `[Cron] Daily location processing completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      { reason }
    );
    return { skipped: false, days, completedLocationWindows };
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
