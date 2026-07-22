import { sql } from "drizzle-orm";
import type { ScheduledTask } from "node-cron";
import { getDb } from "@/db";
import { createClaudeAdapter } from "@/lib/adapters/ai/claude";
import { logger } from "@/lib/logger";
import { toLocalDateString } from "@/lib/utils";
import { createDatabaseNarrativeStore, createNarrativeService } from "./narrative";
import { type LocationCompletedWindow, runOverviewPrecompute } from "./precompute";

/** Keep UI-triggered queue work comfortably inside the ten-minute polling window. */
export const OVERVIEW_PRECOMPUTE_INTERVAL_MINUTES = 5;
export const OVERVIEW_PRECOMPUTE_SCHEDULE = `*/${OVERVIEW_PRECOMPUTE_INTERVAL_MINUTES} * * * *`;

async function loadDurableLocationWindows(): Promise<LocationCompletedWindow[]> {
  const today = toLocalDateString(new Date());
  const result = await getDb().execute<{
    userId: string;
    completedThrough: string | null;
    [key: string]: unknown;
  }>(sql`
    SELECT
      app_user.id AS "userId",
      CASE
        WHEN app_user.own_tracks_api_key IS NULL THEN ${today}
        WHEN MAX(processing.date::date) FILTER (
          WHERE processing.status = 'completed'
        ) IS NULL THEN NULL
        ELSE to_char(
          LEAST(
            MAX(processing.date::date) FILTER (WHERE processing.status = 'completed'),
            COALESCE(
              MIN(processing.date::date) FILTER (WHERE processing.status <> 'completed') - 1,
              MAX(processing.date::date) FILTER (WHERE processing.status = 'completed')
            )
          ),
          'YYYY-MM-DD'
        )
      END AS "completedThrough"
    FROM users app_user
    LEFT JOIN location_processing_days processing ON processing.user_id = app_user.id
    GROUP BY app_user.id, app_user.own_tracks_api_key
  `);
  return result.rows.flatMap((row) =>
    row.completedThrough ? [{ userId: row.userId, completedThrough: row.completedThrough }] : []
  );
}

export async function precomputeOverviewSnapshots(
  completedLocationWindows?: LocationCompletedWindow[]
) {
  const windows = completedLocationWindows ?? (await loadDurableLocationWindows());
  const result = await runOverviewPrecompute(getDb(), { completedLocationWindows: windows });
  if (!result.skipped && (result.published > 0 || result.failed > 0)) {
    logger.info("[Cron] Overview precompute completed", { ...result });
  }
  return result;
}

export async function generateOverviewNarratives() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { skipped: true, claimed: 0, generated: 0, failed: 0 };

  try {
    const service = createNarrativeService(
      createDatabaseNarrativeStore(getDb()),
      createClaudeAdapter(apiKey)
    );
    const result = await service.processAutoBatch();
    if (result.claimed > 0) logger.info("[Cron] Overview narratives processed", { ...result });
    return { skipped: false, ...result };
  } catch (error) {
    logger.error("[Cron] Overview narrative generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { skipped: false, claimed: 0, generated: 0, failed: 1 };
  }
}

export async function precomputeAfterLocation(windows: LocationCompletedWindow[]) {
  try {
    await precomputeOverviewSnapshots(windows);
  } catch (error) {
    logger.error("[Cron] Overview precompute after location failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  void generateOverviewNarratives();
}

export function registerOverviewPrecomputeTask(
  schedule: typeof import("node-cron").schedule,
  timezone: string
): ScheduledTask {
  return schedule(
    OVERVIEW_PRECOMPUTE_SCHEDULE,
    () => {
      // Active periods refresh immediately. Ended periods can finalize only
      // when the durable location-day watermark covers their end date.
      precomputeOverviewSnapshots()
        .then(() => generateOverviewNarratives())
        .catch((error) => {
          logger.error("[Cron] Unhandled error in overview precompute", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    { timezone, name: "overview-precompute" }
  );
}
