/**
 * Loads the health evidence `refineSegmentsWithHealth` needs for one window (a KST
 * day in the pipeline) in exactly two queries, so the per-segment refinement never
 * goes back to the DB.
 */

import { and, eq, gte, lt } from "drizzle-orm";
import { getDb, healthSamples } from "@/db";
import { dedupeSessions } from "@/modules/health/sessions";
import {
  DEFAULT_HEALTH_REFINE_OPTIONS,
  type ExerciseSessionEvidence,
  type HealthEvidence,
} from "./health-evidence";

/** Sessions are keyed by start; anything that started this long before the window may still overlap it. */
const SESSION_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface ExerciseInterval {
  interval?: { startTime?: string; endTime?: string };
  exerciseType?: string;
}

/** Turn stored exercise rows into deduplicated session intervals. Pure; exported for tests. */
export function toExerciseSessions(
  rows: { sampleAt: Date; source: string; value: number | null; valueJson: unknown }[]
): ExerciseSessionEvidence[] {
  const parsed = rows.flatMap((row) => {
    const json = (row.valueJson ?? {}) as ExerciseInterval;
    const end = json.interval?.endTime ? new Date(json.interval.endTime) : null;
    if (!end || Number.isNaN(end.getTime()) || !json.exerciseType) return [];
    return [
      {
        sampleAt: row.sampleAt,
        source: row.source,
        minutes: row.value ?? 0,
        session: { start: row.sampleAt, end, exerciseType: json.exerciseType },
      },
    ];
  });
  // Withings re-publishes Fitbit/Samsung workouts under its own source (sometimes
  // with a different exerciseType); keep only the measuring device's copy.
  return dedupeSessions(parsed).map((r) => r.session);
}

export async function loadHealthEvidence(
  userId: string,
  windowStart: Date,
  windowEnd: Date
): Promise<HealthEvidence> {
  const db = getDb();
  const margin = DEFAULT_HEALTH_REFINE_OPTIONS.stepCoverageMarginMs;

  const [exerciseRows, stepRows] = await Promise.all([
    db
      .select({
        sampleAt: healthSamples.sampleAt,
        source: healthSamples.source,
        value: healthSamples.value,
        valueJson: healthSamples.valueJson,
      })
      .from(healthSamples)
      .where(
        and(
          eq(healthSamples.userId, userId),
          eq(healthSamples.metric, "exercise"),
          gte(healthSamples.sampleAt, new Date(windowStart.getTime() - SESSION_LOOKBACK_MS)),
          lt(healthSamples.sampleAt, windowEnd)
        )
      ),
    db
      .select({
        at: healthSamples.sampleAt,
        source: healthSamples.source,
        count: healthSamples.value,
      })
      .from(healthSamples)
      .where(
        and(
          eq(healthSamples.userId, userId),
          eq(healthSamples.metric, "steps"),
          gte(healthSamples.sampleAt, new Date(windowStart.getTime() - margin)),
          lt(healthSamples.sampleAt, new Date(windowEnd.getTime() + margin))
        )
      ),
  ]);

  return {
    sessions: toExerciseSessions(exerciseRows).filter(
      (s) => s.end.getTime() > windowStart.getTime()
    ),
    steps: stepRows.flatMap((r) => (r.count == null ? [] : [{ ...r, count: r.count }])),
  };
}
