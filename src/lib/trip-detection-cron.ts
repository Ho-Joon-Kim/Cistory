import { sql } from "drizzle-orm";
import { getDb, users } from "@/db";
import { shiftDateKey } from "@/lib/date-key";
import { logger } from "@/lib/logger";

const TRIP_HISTORY_START = "2025-03-08";

let isTripDetectionRunning = false;

type DetectAndPersistTrips = (
  userId: string,
  from: string,
  to: string,
  options: { watermarkThrough: string }
) => Promise<{ detected: number; inserted: number; replaced: number; skipped: number }>;

export interface BootCatchUpJobs {
  overview: () => Promise<void>;
  sync: () => Promise<void>;
  spending: () => Promise<void>;
  location: () => Promise<void>;
  trips: () => Promise<void>;
  subway: () => Promise<void>;
}

/**
 * Run boot-time repair jobs sequentially so they do not saturate the shared DB
 * pool. A failed job is logged without preventing the remaining repairs.
 */
export async function runBootCatchUp(jobs: BootCatchUpJobs): Promise<void> {
  const steps: Array<[keyof BootCatchUpJobs, () => Promise<void>]> = [
    ["overview", jobs.overview],
    ["sync", jobs.sync],
    ["spending", jobs.spending],
    ["location", jobs.location],
    ["trips", jobs.trips],
    ["subway", jobs.subway],
  ];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      logger.error(`[Cron] Boot-time ${name} catch-up failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Detect multi-day trips from visits. The detector advances its durable
 * watermark atomically with reconciliation, so a failure is retried next run.
 */
export async function runTripDetection(reason: string): Promise<void> {
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
      .select({ id: users.id, tripDetectionLastThrough: users.tripDetectionLastThrough })
      .from(users)
      .where(sql`${users.ownTracksApiKey} IS NOT NULL`);

    if (allUsers.length === 0) {
      logger.info("[Cron] No users with OwnTracks configured. Skipping trip detection.");
      return;
    }

    const { detectAndPersistTrips } = await import("@/modules/location/services/trip-detector");
    const to = toKstCalendarDate(new Date());

    for (const user of allUsers) {
      await runTripDetectionForUser(user, to, detectAndPersistTrips);
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

export async function runTripDetectionForUser(
  user: { id: string; tripDetectionLastThrough: string | null },
  to: string,
  detectAndPersist: DetectAndPersistTrips
): Promise<void> {
  try {
    const watermarkStart = user.tripDetectionLastThrough
      ? shiftDateKey(user.tripDetectionLastThrough, -2)
      : TRIP_HISTORY_START;
    const boundedStart = watermarkStart < TRIP_HISTORY_START ? TRIP_HISTORY_START : watermarkStart;
    const from = await extendThroughOverlappingAutoTrips(user.id, boundedStart);
    const result = await detectAndPersist(user.id, from, to, { watermarkThrough: to });
    if (result.inserted > 0) {
      logger.info(
        `[Cron] Trip detection for ${user.id}: ${result.inserted} trip(s) written (${result.detected} detected, ${result.replaced} replaced, ${result.skipped} manual overlap)`
      );
    }
  } catch (error) {
    logger.error(`[Cron] Trip detection failed for user ${user.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A two-day lookbehind can land in the middle of an existing long trip. Walk
 * backward through auto-detected trips crossing each boundary so reconciliation
 * sees the complete trip instead of replacing it with a truncated candidate.
 * Manual trips are deliberately excluded from this expansion.
 */
async function extendThroughOverlappingAutoTrips(userId: string, initialFrom: string) {
  const db = getDb();
  let from = initialFrom;

  while (from > TRIP_HISTORY_START) {
    const result = await db.execute(sql`
      SELECT start_date
      FROM trips
      WHERE user_id = ${userId}
        AND auto_detected = true
        AND start_date < ${from}
        AND end_date >= ${from}
      ORDER BY start_date ASC
      LIMIT 1
    `);
    const priorStart = (result.rows[0] as { start_date?: string } | undefined)?.start_date;
    if (!priorStart || priorStart >= from) break;
    from = priorStart < TRIP_HISTORY_START ? TRIP_HISTORY_START : priorStart;
  }

  return from;
}

export function toKstCalendarDate(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
