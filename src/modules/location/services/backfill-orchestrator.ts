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

export async function planBackfill(userId: string): Promise<BackfillPlan | null> {
  const db = getDb();
  const [dateRange] = await db
    .select({
      earliest: sql<string>`min(timestamp)::date::text`,
      latest: sql<string>`max(timestamp)::date::text`,
    })
    .from(locationPoints)
    .where(eq(locationPoints.userId, userId));

  if (!dateRange.earliest) return null;

  const unprocessed = await db.execute<{ d: string; [key: string]: unknown }>(sql`
    SELECT to_char(d, 'YYYY-MM-DD') as d FROM (
      SELECT date(timestamp) as d
      FROM location_points
      WHERE user_id = ${userId}
      GROUP BY date(timestamp)
      HAVING count(*) filter (where anomaly IS NULL) > 0
    ) unprocessed
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

    // Phase 5: trip detection
    let totalTrips = 0;
    try {
      const { detectTrips, persistTrips } = await import(
        "@/modules/location/services/trip-detector"
      );
      const detected = await detectTrips(userId, dates[0], dates[dates.length - 1]);
      if (detected.length > 0) {
        totalTrips = await persistTrips(userId, detected);
      }
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
