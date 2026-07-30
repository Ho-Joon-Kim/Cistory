/**
 * Session identity + multi-source dedup for the structured health metrics
 * (`sleep`, `exercise`).
 *
 * Scalar metrics get their multi-source dedup for free: `recomputeDailySummaries`
 * aggregates per source and keeps the dominant one. The two session metrics skip
 * health_daily_summaries entirely (a night is a hypnogram, not a daily average) and
 * are read straight out of health_samples, so they need the same dedup applied at
 * read time — this module is that step.
 *
 * Why any of this is necessary: `source` is part of the sample identity
 * `(user_id, metric, sample_at, source)`, so one real-world session legitimately
 * lands as several rows. Two distinct causes, both observed in live data:
 *
 *  1. Re-publishing aggregators. `com.withings.wiscale2` reads Health Connect and
 *     writes back its own processed copy — 36 of 39 of its workouts start in the
 *     same second as another source's, and for sleep its DEEP/REM minutes match the
 *     Fitbit copy exactly while it splits the awake span into more arousals. It is
 *     not a second measurement to reconcile, it is the same session re-processed.
 *  2. Sub-second republication. The same writer emitted one workout at both
 *     08:40:03.000 and 08:40:03.389, which an exact-timestamp key reads as two
 *     sessions — double-counting a single 17-minute workout in the daily total.
 *
 * Everything here is pure so it is unit-testable without a DB.
 */

/**
 * Sources that re-publish sessions they read from Health Connect instead of
 * measuring them. Ranked below every other source, so the device that actually
 * recorded the session wins whenever both copies are present.
 */
const AGGREGATOR_SOURCES = new Set(["com.withings.wiscale2"]);

export function isAggregatorSource(source: string): boolean {
  return AGGREGATOR_SOURCES.has(source);
}

/** The fields dedup needs; callers pass their own wider row type through unchanged. */
export interface SessionRow {
  sampleAt: Date;
  source: string;
  minutes: number;
}

/**
 * Session identity: the start instant truncated to the second, which absorbs the
 * sub-second republication above. Two genuinely different sleep sessions or workouts
 * never start inside the same second, so this cannot merge distinct sessions.
 */
function sessionKey(sampleAt: Date): number {
  return Math.floor(sampleAt.getTime() / 1000);
}

/**
 * True when `a` is the better copy of a session than `b`. Provenance outranks
 * duration deliberately: a re-publisher padding the span must not beat the device
 * that measured it.
 */
function outranks(a: SessionRow, b: SessionRow): boolean {
  const aAgg = isAggregatorSource(a.source);
  const bAgg = isAggregatorSource(b.source);
  if (aAgg !== bAgg) return !aAgg;
  if (a.minutes !== b.minutes) return a.minutes > b.minutes;
  // Deterministic last resort, so equal candidates never reorder between requests.
  return a.source < b.source;
}

/**
 * Collapse multi-source duplicates to one row per session, newest first. No values
 * are blended — a single source's copy is chosen whole, matching the dominant-source
 * rule the scalar daily summaries use, so a smarter reconciliation can always be
 * recomputed later from the preserved rows.
 */
export function dedupeSessions<T extends SessionRow>(rows: T[]): T[] {
  const best = new Map<number, T>();
  for (const r of rows) {
    const key = sessionKey(r.sampleAt);
    const current = best.get(key);
    if (!current || outranks(r, current)) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => b.sampleAt.getTime() - a.sampleAt.getTime());
}
