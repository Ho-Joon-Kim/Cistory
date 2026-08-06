/**
 * Location backfill pipeline.
 *
 * Yields progress events so the API route can pipe them directly to an SSE
 * stream without owning any of the phase logic. Phases:
 *
 *   1. anomaly detection (per day)
 *   2. visit detection + persist (per day)
 *   3. track + transport-mode detection + persist (per day)
 *   4. location_points.city/countryName enrichment from placeCache (bulk SQL)
 *   5. trip auto-detection + persist (bulk)
 *
 * Each phase imports its implementation lazily — the legacy route already
 * does this via \`await import()\`, likely to avoid circular module init cost
 * at cold start.
 */

import { eq, sql } from "drizzle-orm";
import { getDb, locationPoints } from "@/db";

export type BackfillEvent =
  | { phase: "anomaly"; day: string; detail: string; progress: number }
  | { phase: "visits"; day: string; detail: string; progress: number }
  | { phase: "tracks"; day: string; detail: string; progress: number }
  | { phase: "enrich"; detail: string; progress: number }
  | { phase: "trips"; detail: string; progress: number }
  | {
      phase: "done";
      totalAnomalies: number;
      totalVisits: number;
      totalTracks: number;
      totalSegments: number;
      totalTrips: number;
      pointsEnriched: number;
      progress: number;
    }
  | { phase: "error"; error: string };

export interface BackfillPlan {
  dates: string[];
  totalSteps: number;
}

export type BackfillScope = "all" | "past" | "today";

export async function planBackfill(
  userId: string,
  scope: BackfillScope = "all"
): Promise<BackfillPlan | null> {
  const db = getDb();
  const [dateRange] = await db
    .select({
      earliest: sql<string>`min(timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date::text`,
      latest: sql<string>`max(timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date::text`,
    })
    .from(locationPoints)
    .where(eq(locationPoints.userId, userId));

  if (!dateRange.earliest) return null;

  const scopeFilter =
    scope === "past"
      ? sql`AND d < (now() at time zone 'Asia/Seoul')::date`
      : scope === "today"
        ? sql`AND d = (now() at time zone 'Asia/Seoul')::date`
        : sql``;

  // A day needs work when `location_processing_days` has no completed row for it, or
  // the count it completed with no longer matches what the day holds (points arrived
  // late). This replaces a scan for `anomaly IS NULL`, which required the pipeline to
  // stamp every clean point every run — ~98% of the table's write volume.
  const unprocessed = await db.execute<{ d: string; [key: string]: unknown }>(sql`
    SELECT to_char(d, 'YYYY-MM-DD') as d FROM (
      SELECT point_days.d
      FROM (
        SELECT (timestamp at time zone 'UTC' at time zone 'Asia/Seoul')::date as d,
               count(*)::int as point_count
        FROM location_points
        WHERE user_id = ${userId}
        GROUP BY 1
      ) point_days
      LEFT JOIN location_processing_days processing
        ON processing.user_id = ${userId}
        AND processing.date = to_char(point_days.d, 'YYYY-MM-DD')
        AND processing.status = 'completed'
      WHERE processing.id IS NULL
         OR processing.point_count IS DISTINCT FROM point_days.point_count
    ) unprocessed
    WHERE 1=1 ${scopeFilter}
    ORDER BY d
  `);

  const dates = unprocessed.rows.map((r) => r.d);
  return { dates, totalSteps: dates.length * 3 };
}

export async function* runBackfill(
  userId: string,
  plan: BackfillPlan
): AsyncGenerator<BackfillEvent> {
  const db = getDb();
  const { dates, totalSteps } = plan;

  let completed = 0;
  const pctBefore = () => Math.round((completed / totalSteps) * 100);
  const pctAfter = () => {
    completed++;
    return Math.round((completed / totalSteps) * 100);
  };

  try {
    // Phase 1: anomaly detection
    const { runAnomalyDetectionForDay } = await import(
      "@/modules/location/services/anomaly-filter"
    );

    let totalAnomalies = 0;
    for (const day of dates) {
      const result = await runAnomalyDetectionForDay(userId, day);
      totalAnomalies += result.total;
      yield { phase: "anomaly", day, detail: `${result.total}건 감지`, progress: pctAfter() };
    }

    // Phase 2: visit detection
    const { detectAndPersistVisits } = await import("@/modules/location/services/visit-persister");

    let totalVisits = 0;
    for (const day of dates) {
      const dayVisits = await detectAndPersistVisits(userId, day);
      totalVisits += dayVisits.length;
      yield { phase: "visits", day, detail: `${dayVisits.length}개 방문`, progress: pctAfter() };
    }

    // Phase 3: tracks + transport
    const { detectAndPersistTracks } = await import("@/modules/location/services/track-persister");

    let totalTracks = 0;
    let totalSegments = 0;
    for (const day of dates) {
      const result = await detectAndPersistTracks(userId, day);
      totalTracks += result.trackCount;
      totalSegments += result.segmentCount;
      yield {
        phase: "tracks",
        day,
        detail: `${result.trackCount}개 트랙, ${result.segmentCount}개 세그먼트`,
        progress: pctAfter(),
      };
    }

    // Phase 4: location_points enrichment from placeCache
    const enrichResult = await db.execute<{ updated: number; [key: string]: unknown }>(sql`
      WITH updated AS (
        UPDATE location_points lp
        SET
          city = CASE
            WHEN lp.lat BETWEEN 33.0 AND 38.7 AND lp.lon BETWEEN 124.5 AND 132.0
              THEN split_part(pc.address, ' ', 1)
            ELSE (string_to_array(pc.address, ', '))[array_length(string_to_array(pc.address, ', '), 1) - 1]
          END,
          country_name = CASE
            WHEN lp.lat BETWEEN 33.0 AND 38.7 AND lp.lon BETWEEN 124.5 AND 132.0
              THEN '대한민국'
            ELSE (string_to_array(pc.address, ', '))[array_length(string_to_array(pc.address, ', '), 1)]
          END
        FROM place_cache pc
        WHERE round(lp.lat::numeric, 3) = pc.lat_key
          AND round(lp.lon::numeric, 3) = pc.lon_key
          AND lp.user_id = ${userId}
          AND lp.city IS NULL
        RETURNING lp.id
      )
      SELECT count(*)::int AS updated FROM updated
    `);
    const pointsEnriched = enrichResult.rows[0]?.updated ?? 0;
    yield {
      phase: "enrich",
      detail: `${pointsEnriched.toLocaleString()}개 포인트 enriched`,
      progress: 99,
    };

    // Phase 5: trip detection. Idempotent — the overlap-skip prevents
    // duplicating trips already detected for these dates by a prior backfill,
    // a re-import of the same range, or the weekly cron.
    let totalTrips = 0;
    try {
      const { detectAndPersistTrips } = await import("@/modules/location/services/trip-detector");
      const result = await detectAndPersistTrips(userId, dates[0], dates[dates.length - 1]);
      totalTrips = result.inserted;
      yield { phase: "trips", detail: `${totalTrips}개 여행 감지`, progress: 99 };
    } catch (tripError) {
      console.error("Trip detection error (non-fatal):", tripError);
    }

    yield {
      phase: "done",
      totalAnomalies,
      totalVisits,
      totalTracks,
      totalSegments,
      totalTrips,
      pointsEnriched,
      progress: 100,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Backfill orchestrator error:", error);
    yield { phase: "error", error: errMsg };
  }

  // Reference pctBefore to satisfy lint; it's useful for future pre-step events
  void pctBefore;
}
