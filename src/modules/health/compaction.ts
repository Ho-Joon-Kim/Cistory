/**
 * Minute-bucket compaction for high-frequency scalar health metrics.
 *
 * The Fitbit writes heart rate roughly every 2.3 seconds — ~37k rows/day, which alone
 * accounted for 98.7% of health_samples (287 MB of 291 MB) and projected to ~3.2 GB/yr.
 * The verbatim API responses are already archived in `health_raw_pages` (the same
 * 786,336 HR points compress to 11 MB there), so health_samples does not need to be
 * the system of record for every individual beat — it needs to be a queryable series.
 *
 * ── Why compaction rather than bucketing at ingest ──────────────────────────
 * Aggregating during sync looks simpler but is subtly wrong: a sync window can end
 * mid-minute, so one bucket gets built twice from partial data. `DO NOTHING` then
 * freezes the half-filled bucket, `DO UPDATE` discards the earlier half, and an
 * associative merge (least/greatest/n+n) breaks idempotency because a re-fetched
 * window double-counts `n`. Making it correct means aligning every forward and
 * backfill window to minute boundaries.
 *
 * Compacting *closed* ranges out of already-stored rows avoids all of it: the bucket
 * is computed from every sample it contains, in one pass, and re-running finds
 * nothing left to compact. It also handles pre-existing history through the same code
 * path, and leaves a recent raw window intact for detail views.
 *
 * ── Storage shape ───────────────────────────────────────────────────────────
 * A bucket reuses the ordinary sample row: `sample_at` is the minute, `value` is the
 * mean, and `value_json` carries `{ min, max, n }`. `value_json IS NULL` is therefore
 * the discriminator between a raw sample and a bucket for these metrics — which is
 * what makes compaction idempotent and what `recomputeDailySummaries` reads so daily
 * min/max stay exact (the /health trend card draws a per-day range bar).
 */

import { sql } from "drizzle-orm";
import type { Database } from "@/db";
import { logger } from "@/lib/logger";

/** Metrics dense enough to be worth compacting. Everything else stays raw. */
export const COMPACTED_METRICS = ["heart_rate"] as const;

/**
 * Raw samples younger than this stay raw, so recent data is still available at full
 * resolution and compaction only ever touches ranges the sync has finished with.
 */
export const RAW_RETENTION_DAYS = 3;

export interface RawScalarSample {
  sampleAt: Date;
  source: string;
  value: number;
}

export interface MinuteBucket {
  /** start of the containing minute, in UTC */
  minuteAt: Date;
  source: string;
  /** arithmetic mean of the bucket's samples */
  mean: number;
  min: number;
  max: number;
  /** how many raw samples this bucket replaces — the weight for any re-aggregation */
  n: number;
}

/**
 * Bucket key: a source's samples within one minute. Sources never blend.
 *
 * The separator is an escaped U+0000 rather than a literal one — a raw NUL byte in a
 * source file makes git treat it as binary — and rather than a printable character,
 * which a package name could in principle contain and so collide across buckets.
 */
function bucketKey(sampleAt: Date, source: string): string {
  return `${Math.floor(sampleAt.getTime() / 60_000)}\u0000${source}`;
}

/**
 * Group raw scalar samples into per-minute, per-source buckets, chronologically.
 *
 * Keeping `min`/`max`/`n` alongside the mean makes the reduction lossless for every
 * aggregate the app actually computes: daily extremes come from the bounds, and a
 * daily mean weighted by `n` equals the mean over the raw samples exactly.
 */
export function bucketByMinute(rows: RawScalarSample[]): MinuteBucket[] {
  const acc = new Map<
    string,
    { minuteAt: Date; source: string; sum: number; min: number; max: number; n: number }
  >();
  for (const r of rows) {
    const key = bucketKey(r.sampleAt, r.source);
    const cur = acc.get(key);
    if (cur) {
      cur.sum += r.value;
      cur.n += 1;
      if (r.value < cur.min) cur.min = r.value;
      if (r.value > cur.max) cur.max = r.value;
      continue;
    }
    acc.set(key, {
      minuteAt: new Date(Math.floor(r.sampleAt.getTime() / 60_000) * 60_000),
      source: r.source,
      sum: r.value,
      min: r.value,
      max: r.value,
      n: 1,
    });
  }
  return [...acc.values()]
    .map((b) => ({
      minuteAt: b.minuteAt,
      source: b.source,
      mean: b.sum / b.n,
      min: b.min,
      max: b.max,
      n: b.n,
    }))
    .sort((a, b) => a.minuteAt.getTime() - b.minuteAt.getTime());
}

/**
 * Read a stored row's bucket stats: the bounds it covers and how many raw samples it
 * stands for. A raw sample answers `{ min: value, max: value, n: 1 }`, so callers can
 * aggregate raw rows and buckets in one pass without branching.
 *
 * Any reader that aggregates health_samples itself must go through this, or a bucket
 * silently counts as one sample and contributes only its mean — understating daily
 * ranges and skewing means toward sparse minutes.
 */
export function bucketStats(
  valueJson: unknown,
  value: number
): { min: number; max: number; n: number } {
  const j = valueJson as { min?: unknown; max?: unknown; n?: unknown } | null | undefined;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    min: num(j?.min, value),
    max: num(j?.max, value),
    // Never below 1: a bucket claiming n=0 would drop out of a weighted mean entirely.
    n: Math.max(1, num(j?.n, 1)),
  };
}

// ── DB-side compaction ───────────────────────────────────────────────────────
// The aggregation runs in SQL rather than through `bucketByMinute` above: a day of
// heart rate is ~37k rows, and pulling them into Node only to send buckets back would
// put a multi-second synchronous stretch on the cron container's event loop. The pure
// function stays the executable specification of the arithmetic (see compaction.test.ts).

/** Days compacted per run, so one cron tick can't walk unbounded history. */
const MAX_DAYS_PER_RUN = 7;

export interface CompactionResult {
  userId: string;
  rawDeleted: number;
  bucketsWritten: number;
  daysCompacted: number;
}

/**
 * Compact one time range of one metric into minute buckets, transactionally.
 *
 * Order matters: aggregate, then DELETE the raw rows, then INSERT the buckets. Doing
 * the delete first means a bucket landing on an exact :00 second can never collide
 * with the raw sample it replaces.
 *
 * The ON CONFLICT merge handles a minute that was already partly compacted (late data
 * arriving for a range that a previous run closed). The merge is associative, and
 * because the contributing raw rows are deleted in the same transaction they can never
 * be counted twice — the property that makes this safe here but unsafe at ingest time.
 */
async function compactRange(
  db: Database,
  userId: string,
  metric: string,
  from: Date,
  to: Date
): Promise<{ rawDeleted: number; bucketsWritten: number }> {
  return await db.transaction(async (tx) => {
    const scope = sql`
      user_id = ${userId} AND metric = ${metric} AND value_json IS NULL
        AND sample_at >= ${from.toISOString()}::timestamp
        AND sample_at < ${to.toISOString()}::timestamp
    `;

    await tx.execute(sql`
      CREATE TEMP TABLE _hs_buckets ON COMMIT DROP AS
      SELECT date_trunc('minute', sample_at) AS minute_at, source,
             avg(value) AS mean, min(value) AS mn, max(value) AS mx, count(*)::int AS n
      FROM health_samples WHERE ${scope}
      GROUP BY 1, 2
    `);

    const deleted = await tx.execute(sql`DELETE FROM health_samples WHERE ${scope}`);

    const inserted = await tx.execute(sql`
      INSERT INTO health_samples (user_id, metric, sample_at, source, value, value_json)
      SELECT ${userId}, ${metric}, minute_at, source, mean,
             jsonb_build_object('min', mn, 'max', mx, 'n', n)
      FROM _hs_buckets
      ON CONFLICT (user_id, metric, sample_at, source) DO UPDATE SET
        value = (
          health_samples.value * COALESCE((health_samples.value_json->>'n')::double precision, 1)
          + EXCLUDED.value * (EXCLUDED.value_json->>'n')::double precision
        ) / (
          COALESCE((health_samples.value_json->>'n')::double precision, 1)
          + (EXCLUDED.value_json->>'n')::double precision
        ),
        value_json = jsonb_build_object(
          'min', LEAST(
            COALESCE((health_samples.value_json->>'min')::double precision, health_samples.value),
            (EXCLUDED.value_json->>'min')::double precision),
          'max', GREATEST(
            COALESCE((health_samples.value_json->>'max')::double precision, health_samples.value),
            (EXCLUDED.value_json->>'max')::double precision),
          'n', COALESCE((health_samples.value_json->>'n')::int, 1)
               + (EXCLUDED.value_json->>'n')::int)
    `);

    return {
      rawDeleted: deleted.rowCount ?? 0,
      bucketsWritten: inserted.rowCount ?? 0,
    };
  });
}

/**
 * Compact every eligible metric for one user, oldest range first, bounded to
 * MAX_DAYS_PER_RUN days per call. Idempotent: once a range holds only buckets there
 * are no `value_json IS NULL` rows left to find, so a re-run is a no-op.
 */
export async function compactPendingSamples(
  db: Database,
  userId: string
): Promise<CompactionResult> {
  const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 86_400_000);
  const result: CompactionResult = { userId, rawDeleted: 0, bucketsWritten: 0, daysCompacted: 0 };

  for (const metric of COMPACTED_METRICS) {
    for (let i = 0; i < MAX_DAYS_PER_RUN; i++) {
      const oldest = await db.execute(sql`
        SELECT min(sample_at) AS from_at FROM health_samples
        WHERE user_id = ${userId} AND metric = ${metric} AND value_json IS NULL
          AND sample_at < ${cutoff.toISOString()}::timestamp
      `);
      const fromRaw = (oldest.rows[0] as { from_at: string | Date | null } | undefined)?.from_at;
      if (!fromRaw) break; // nothing left older than the retention window

      const from = new Date(fromRaw);
      // One day at a time, never past the retention cutoff. A minute straddling the
      // upper bound is compacted partially and completed by a later run — the ON
      // CONFLICT merge above makes that exact.
      const to = new Date(Math.min(from.getTime() + 86_400_000, cutoff.getTime()));
      const { rawDeleted, bucketsWritten } = await compactRange(db, userId, metric, from, to);
      result.rawDeleted += rawDeleted;
      result.bucketsWritten += bucketsWritten;
      result.daysCompacted += 1;
      // Yield between days so a long backlog can't monopolise the event loop.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  if (result.rawDeleted > 0) {
    logger.info("[Health] compacted raw samples into minute buckets", {
      userId,
      rawDeleted: result.rawDeleted,
      bucketsWritten: result.bucketsWritten,
      daysCompacted: result.daysCompacted,
    });
  }
  return result;
}
