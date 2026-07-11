import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  type HealthConnection,
  healthConnections,
  healthRawPages,
  healthSamples,
  healthSyncState,
  type NewHealthSample,
} from "@/db/schema";
import { localDayRawSql } from "@/db/sql";
import {
  createGoogleHealthAdapter,
  type GoogleHealthAdapter,
  GoogleHealthApiError,
  GoogleHealthAuthError,
  type GoogleHealthDataPoint,
  type ListResult,
} from "@/lib/adapters/google-health/interface";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";

// ── Tuning constants ─────────────────────────────────────────────────────────
const TOKEN_REFRESH_GRACE_MS = 60_000;
const FORWARD_FALLBACK_MS = 7 * 24 * 3600_000; // first forward sync reaches back 7d
const LIST_PAGE_SIZE = 1000;
const MAX_PAGES_PER_WINDOW = 200; // backstop against a malformed never-empty pageToken
// Historical backfill reaches back over ALL available history: it walks fixed
// chunks backward until a metric's data runs out — detected by a run of empty
// windows (older windows return no points) — with a deep floor only as an absolute
// backstop. Bounded chunks/run so one cron tick never pages unbounded history in a
// single event-loop stretch.
const BACKFILL_SAFETY_FLOOR_MS = 5 * 365 * 24 * 3600_000; // ~5y backstop (>> Health Connect retention)
const BACKFILL_CHUNK_MS = 14 * 24 * 3600_000;
const BACKFILL_CHUNKS_PER_RUN = 4;
// Consecutive empty 14d windows that mark "history has ended" and stop the walk.
// 3 = ~42d of zero data across all sources; a tunable completeness/efficiency knob
// (higher survives longer real gaps in history, lower finishes sooner).
const EMPTY_BACKFILL_CHUNKS_TO_STOP = 3;

// ── Metric config (ground-truthed by the U1 live spike) ──────────────────────
// The Google Health `list` payload wraps each point under a camelCase key
// (`heart-rate` → `heartRate`), carries its timestamp under `interval.startTime`
// (accumulating metrics) or `sampleTime.physicalTime` (instantaneous metrics),
// and the `list` `filter` param addresses those fields in snake_case
// (`heart_rate.sample_time.physical_time`). Values arrive as strings OR numbers.
// Only metrics whose exact shape the spike verified are enabled; sleep / resting
// HR / HRV are valid dataTypes that return empty today (they populate once Fitbit
// writes to Health Connect) and are added when their value shape is ground-truthed.
export type MetricAgg = "sum" | "avg";
type MetricTimeShape = "interval" | "sampleTime";

export interface MetricConfig {
  /** internal key stored in health_samples.metric */
  key: string;
  /** Google Health API dataType path segment */
  dataType: string;
  /** camelCase wrapper key inside each dataPoint */
  wrapper: string;
  /** where the point's timestamp lives */
  timeShape: MetricTimeShape;
  /** snake_case field the `list` filter param compares against */
  filterField: string;
  /** scalar value key inside the wrapper; null = structured (→ valueJson) */
  valueKey: string | null;
  /** daily-summary aggregation: sum (accumulating) → valueSum; avg (instant) → null */
  agg: MetricAgg;
}

export const HEALTH_METRICS: MetricConfig[] = [
  {
    key: "steps",
    dataType: "steps",
    wrapper: "steps",
    timeShape: "interval",
    filterField: "steps.interval.start_time",
    valueKey: "count",
    agg: "sum",
  },
  {
    key: "distance",
    dataType: "distance",
    wrapper: "distance",
    timeShape: "interval",
    filterField: "distance.interval.start_time",
    valueKey: "millimeters",
    agg: "sum",
  },
  {
    key: "heart_rate",
    dataType: "heart-rate",
    wrapper: "heartRate",
    timeShape: "sampleTime",
    filterField: "heart_rate.sample_time.physical_time",
    valueKey: "beatsPerMinute",
    agg: "avg",
  },
  {
    key: "spo2",
    dataType: "oxygen-saturation",
    wrapper: "oxygenSaturation",
    timeShape: "sampleTime",
    filterField: "oxygen_saturation.sample_time.physical_time",
    valueKey: "percentage",
    agg: "avg",
  },
  {
    key: "vo2_max",
    dataType: "vo2-max",
    wrapper: "vo2Max",
    timeShape: "sampleTime",
    filterField: "vo2_max.sample_time.physical_time",
    valueKey: "vo2Max",
    agg: "avg",
  },
  // DEFERRED: `exercise` (structured workout sessions). `list` works unfiltered,
  // but every interval `filter` variant is rejected 400
  // (INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER) — the exercise data type isn't
  // time-filterable via the members we can address, so incremental windowing is
  // impossible without a different fetch strategy. It's not shown on /health
  // (absent from CURATED_METRICS), so it's left out until its filter is figured
  // out. The parser already handles structured metrics (valueKey: null → valueJson).
];

// ── Pure helpers (exported for unit tests) ───────────────────────────────────

/** Cached access token is usable if present and not within the refresh grace window. */
export function isHealthTokenFresh(
  expiresAt: Date | null,
  now: number,
  graceMs = TOKEN_REFRESH_GRACE_MS
): boolean {
  return !!expiresAt && expiresAt.getTime() > now + graceMs;
}

function decryptOrNull(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}

export interface ParsedSample {
  sampleAt: Date;
  source: string;
  value: number | null;
  valueJson: unknown | null;
}

/**
 * Normalize one raw Google Health data point into a health_samples row shape, or
 * null when the point is unusable (missing wrapper/timestamp, or a scalar metric
 * whose value is absent/non-numeric). `source` is the writing app's package name
 * — "unknown" when the payload omits it — and is part of the sample identity so
 * multiple Health Connect sources for one metric coexist rather than collide.
 */
export function parseSample(
  config: MetricConfig,
  point: GoogleHealthDataPoint
): ParsedSample | null {
  const wrapper = point[config.wrapper] as Record<string, unknown> | undefined;
  if (!wrapper || typeof wrapper !== "object") return null;

  const iso =
    config.timeShape === "interval"
      ? (wrapper.interval as { startTime?: string } | undefined)?.startTime
      : (wrapper.sampleTime as { physicalTime?: string } | undefined)?.physicalTime;
  if (!iso) return null;
  const sampleAt = new Date(iso);
  if (Number.isNaN(sampleAt.getTime())) return null;

  const dataSource = point.dataSource as { application?: { packageName?: string } } | undefined;
  const source = dataSource?.application?.packageName ?? "unknown";

  // Structured metric: keep the whole wrapper, no scalar.
  if (config.valueKey == null) {
    return { sampleAt, source, value: null, valueJson: wrapper };
  }

  const raw = wrapper[config.valueKey];
  const num = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  if (Number.isNaN(num)) return null; // scalar metric with no usable value → drop
  return { sampleAt, source, value: num, valueJson: null };
}

/**
 * Build the AIP-160 `filter` for a `list` call. `since` is a required lower bound;
 * `until` (backfill windows) adds a closed-open upper bound. Field names are the
 * spike-verified snake_case form — camelCase / hyphenated variants are rejected.
 */
export function buildTimeFilter(config: MetricConfig, since: Date, until?: Date): string {
  const lower = `${config.filterField} >= "${since.toISOString()}"`;
  if (!until) return lower;
  return `${lower} AND ${config.filterField} < "${until.toISOString()}"`;
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface HealthSyncResult {
  userId: string;
  samplesUpserted: number;
  skipped: boolean;
}

interface ServiceOptions {
  clientId?: string;
  clientSecret?: string;
  /** Forwarded to the adapter (e.g. throttleMs: 0 in tests). */
  adapterOptions?: { throttleMs?: number };
}

export class HealthSyncService {
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly adapterOptions?: { throttleMs?: number };
  /** Memoized so the adapter's self-throttle state persists across pages of a
   *  sync run — re-creating it per call reset the throttle and defeated pacing. */
  private adapter?: GoogleHealthAdapter;

  constructor(
    private db: Database,
    options: ServiceOptions = {}
  ) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.adapterOptions = options.adapterOptions;
  }

  private getAdapter(): GoogleHealthAdapter {
    if (this.adapter) return this.adapter;
    const clientId = this.clientId ?? process.env.FITBIT_CLIENT_ID;
    const clientSecret = this.clientSecret ?? process.env.FITBIT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET is not set");
    }
    this.adapter = createGoogleHealthAdapter(clientId, clientSecret, this.adapterOptions);
    return this.adapter;
  }

  async getConnection(userId: string): Promise<HealthConnection | null> {
    const rows = await this.db
      .select()
      .from(healthConnections)
      .where(eq(healthConnections.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Disconnect: best-effort revoke of the Google grant, then hard-delete the
   * connection row so no decryptable live token survives. Sample/summary history
   * is intentionally retained. The row is deleted REGARDLESS of whether revoke
   * succeeds — a revoke failure (network, already-revoked) must never strand a
   * decryptable token in the DB.
   */
  async disconnect(userId: string): Promise<void> {
    const connection = await this.getConnection(userId);
    if (connection) {
      try {
        const refreshToken = decryptSecret(connection.refreshTokenEnc);
        await this.getAdapter().revokeToken(refreshToken);
      } catch (e) {
        logger.warn("[Health] token revoke failed during disconnect (deleting anyway)", {
          userId,
          error: String(e),
        });
      }
    }
    await this.db.delete(healthConnections).where(eq(healthConnections.userId, userId));
    // Clear the per-metric watermarks too: retained samples/summaries survive, but
    // a later reconnect must re-sync the disconnected gap from scratch rather than
    // resume from stale syncedThrough/backfilledFrom cursors.
    await this.db.delete(healthSyncState).where(eq(healthSyncState.userId, userId));
  }

  private async markNeedsReauth(userId: string, message: string): Promise<void> {
    await this.db
      .update(healthConnections)
      .set({ status: "needs_reauth", lastSyncError: message, updatedAt: new Date() })
      .where(eq(healthConnections.userId, userId));
  }

  /**
   * Return a valid access token, refreshing under a per-user advisory lock when
   * needed. Unlike Withings, Google refresh tokens do NOT rotate — the adapter
   * preserves the stored refresh token when a refresh response omits one, so we
   * re-persist whatever it returns. Pass `forceIfEquals` (a token that just
   * 401'd) to force a refresh unless another writer already rotated it.
   */
  async getValidToken(connection: HealthConnection, forceIfEquals?: string): Promise<string> {
    const cached = decryptOrNull(connection.accessTokenEnc);
    if (
      cached &&
      cached !== forceIfEquals &&
      isHealthTokenFresh(connection.accessTokenExpiresAt, Date.now())
    ) {
      return cached;
    }

    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`health-token:${connection.userId}`}, 0))`
        );

        const fresh = (
          await tx
            .select()
            .from(healthConnections)
            .where(eq(healthConnections.userId, connection.userId))
            .limit(1)
        )[0];
        if (!fresh) {
          throw new Error(`Health connection for ${connection.userId} disappeared during refresh`);
        }

        const freshToken = decryptOrNull(fresh.accessTokenEnc);
        if (
          freshToken &&
          freshToken !== forceIfEquals &&
          isHealthTokenFresh(fresh.accessTokenExpiresAt, Date.now())
        ) {
          return freshToken;
        }

        const refreshToken = decryptSecret(fresh.refreshTokenEnc);
        const tokens = await this.getAdapter().refreshToken(refreshToken);

        await tx
          .update(healthConnections)
          .set({
            accessTokenEnc: encryptSecret(tokens.accessToken),
            // Non-rotation: adapter returns the preserved token when Google omits one.
            refreshTokenEnc: encryptSecret(tokens.refreshToken),
            accessTokenExpiresAt: tokens.expiresAt,
            scope: tokens.scope || fresh.scope,
            googleSub: tokens.googleSub || fresh.googleSub,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(healthConnections.userId, connection.userId));

        return tokens.accessToken;
      });
    } catch (err) {
      // Only a CONFIRMED auth failure (invalid_grant on the refresh call itself)
      // flips needs_reauth. Transient network/5xx never does.
      if (err instanceof GoogleHealthAuthError) {
        await this.markNeedsReauth(connection.userId, err.message);
      }
      throw err;
    }
  }

  /**
   * Incremental forward sync: for each configured metric, pull points newer than
   * its `syncedThrough` watermark (fallback 7d) up to now, upsert samples + raw
   * pages, recompute the touched KST days' summaries, then advance the watermark.
   * Per-metric try/catch isolates a failing metric (AE4) — others still persist.
   */
  async syncUser(
    userId: string,
    opts: { skipIfSyncedWithinMs?: number } = {}
  ): Promise<HealthSyncResult> {
    const connection = await this.getConnection(userId);
    if (!connection || connection.status !== "active") {
      return { userId, samplesUpserted: 0, skipped: true };
    }
    if (
      opts.skipIfSyncedWithinMs &&
      connection.lastSyncedAt &&
      Date.now() - connection.lastSyncedAt.getTime() < opts.skipIfSyncedWithinMs
    ) {
      return { userId, samplesUpserted: 0, skipped: true };
    }

    const now = new Date();
    let total = 0;
    const errors: string[] = [];
    for (const config of HEALTH_METRICS) {
      try {
        total += await this.syncMetricForward(connection, config, now);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${config.key}: ${message}`);
        logger.warn("[Health] metric sync failed (skipping)", {
          userId,
          metric: config.key,
          status: err instanceof GoogleHealthApiError ? err.status : undefined,
        });
      }
    }

    // Advance the sync clock only when at least one metric succeeded. A TOTAL
    // failure (dead token, network down) leaves lastSyncedAt untouched so the
    // skipIfSyncedWithinMs gate doesn't suppress the retry for a full interval.
    const allFailed = errors.length === HEALTH_METRICS.length;
    await this.db
      .update(healthConnections)
      .set({
        ...(allFailed ? {} : { lastSyncedAt: now }),
        lastSyncError: errors.length ? errors.join("; ").slice(0, 500) : null,
        updatedAt: new Date(),
      })
      .where(eq(healthConnections.userId, userId))
      .catch(() => undefined);

    logger.info("[Health] Sync complete", { userId, samples: total, metricErrors: errors.length });
    return { userId, samplesUpserted: total, skipped: false };
  }

  private async syncMetricForward(
    connection: HealthConnection,
    config: MetricConfig,
    now: Date
  ): Promise<number> {
    const state = await this.getSyncState(connection.userId, config.key);
    const since = state?.syncedThrough ?? new Date(now.getTime() - FORWARD_FALLBACK_MS);
    const { upserted, truncated } = await this.fetchWindowAndPersist(
      connection,
      config,
      buildTimeFilter(config, since),
      since,
      now
    );
    // Don't advance the watermark past a window we couldn't fully page — otherwise
    // the unfetched tail is skipped permanently. Leave `since` for the next tick.
    if (!truncated) {
      await this.setSyncState(connection.userId, config.key, { syncedThrough: now });
    }
    return upserted;
  }

  /**
   * Historical backfill: walk each metric's `backfilledFrom` watermark backward
   * over all available history — until the metric's data runs out (a run of empty
   * windows) or the deep `health_connections.backfillFloor` backstop — a bounded
   * number of 14-day chunks per run so a single tick never pages an unbounded
   * history. Resumable + idempotent (samples upsert DO NOTHING). Once every metric
   * is done, stamp `backfillCompletedAt` so the UI can leave the "동기화 중" state (R12).
   */
  async backfillPendingConnections(userId: string): Promise<HealthSyncResult> {
    const connection = await this.getConnection(userId);
    if (!connection || connection.status !== "active" || connection.backfillCompletedAt) {
      return { userId, samplesUpserted: 0, skipped: true };
    }

    const floor = connection.backfillFloor ?? (await this.seedBackfillFloor(connection));
    let total = 0;
    let allComplete = true;
    for (const config of HEALTH_METRICS) {
      try {
        const done = await this.backfillMetric(connection, config, floor);
        total += done.upserted;
        if (!done.reachedFloor) allComplete = false;
      } catch (err) {
        allComplete = false;
        logger.warn("[Health] metric backfill failed (will resume)", {
          userId,
          metric: config.key,
          status: err instanceof GoogleHealthApiError ? err.status : undefined,
        });
      }
    }

    if (allComplete) {
      await this.db
        .update(healthConnections)
        .set({ backfillCompletedAt: new Date(), updatedAt: new Date() })
        .where(eq(healthConnections.userId, userId));
      logger.info("[Health] Backfill complete", { userId });
    }
    return { userId, samplesUpserted: total, skipped: false };
  }

  private async backfillMetric(
    connection: HealthConnection,
    config: MetricConfig,
    floor: Date
  ): Promise<{ upserted: number; reachedFloor: boolean }> {
    const state = await this.getSyncState(connection.userId, config.key);
    // Anchor the backward walk at where forward sync first started (7d ago) when
    // no backfill has run yet, so the two directions meet without a gap.
    let cursor = state?.backfilledFrom ?? new Date(Date.now() - FORWARD_FALLBACK_MS);
    let upserted = 0;
    let emptyStreak = 0;

    for (let chunk = 0; chunk < BACKFILL_CHUNKS_PER_RUN; chunk++) {
      if (cursor.getTime() <= floor.getTime()) break;
      const chunkEnd = cursor;
      const chunkStart = new Date(
        Math.max(floor.getTime(), chunkEnd.getTime() - BACKFILL_CHUNK_MS)
      );
      const { upserted: got, truncated } = await this.fetchWindowAndPersist(
        connection,
        config,
        buildTimeFilter(config, chunkStart, chunkEnd),
        chunkStart,
        chunkEnd
      );
      upserted += got;
      // A truncated chunk left data unfetched — stop without advancing the cursor
      // so the same chunk (not just its unread tail) is retried next run.
      if (truncated) break;
      cursor = chunkStart;
      await this.setSyncState(connection.userId, config.key, { backfilledFrom: cursor });
      // All-time backfill: the metric's history has ended once enough consecutive
      // windows come back empty. Treat that as done (don't grind empty windows all
      // the way to the deep floor).
      emptyStreak = got === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= EMPTY_BACKFILL_CHUNKS_TO_STOP) {
        return { upserted, reachedFloor: true };
      }
    }

    return { upserted, reachedFloor: cursor.getTime() <= floor.getTime() };
  }

  private async seedBackfillFloor(connection: HealthConnection): Promise<Date> {
    const floor = new Date(Date.now() - BACKFILL_SAFETY_FLOOR_MS);
    await this.db
      .update(healthConnections)
      .set({ backfillFloor: floor, updatedAt: new Date() })
      .where(eq(healthConnections.userId, connection.userId));
    return floor;
  }

  /**
   * Page a `list` window, upsert its samples + raw pages, and recompute the KST
   * days it touched. Yields to the event loop between pages so multi-second
   * backfills never stall the (single-process) cron. Shared by forward + backfill.
   */
  private async fetchWindowAndPersist(
    connection: HealthConnection,
    config: MetricConfig,
    filter: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<{ upserted: number; truncated: boolean }> {
    let pageToken: string | undefined;
    let pages = 0;
    let upserted = 0;
    let touchedAny = false;
    let truncated = false;

    try {
      do {
        const page = await this.listPageWithAuth(connection, config, filter, pageToken);
        const rows = await this.persistPage(
          connection.userId,
          config,
          page,
          windowStart,
          windowEnd
        );
        if (rows > 0) {
          upserted += rows;
          touchedAny = true;
        }
        pageToken = page.nextPageToken;
        pages++;
        await new Promise((resolve) => setImmediate(resolve)); // event-loop yield
      } while (pageToken && pages < MAX_PAGES_PER_WINDOW);

      // Still a pageToken after the cap = unfetched data remains. Flag it so the
      // caller does NOT advance its watermark past this window (silent data loss).
      if (pageToken) {
        truncated = true;
        logger.warn("[Health] window hit page cap; not advancing watermark", {
          userId: connection.userId,
          metric: config.key,
          pages,
        });
      }
    } finally {
      // Recompute in `finally` so pages already persisted before a mid-window page
      // error still get their KST-day summaries (the watermark won't have advanced,
      // so a later run re-touches them, but this closes the transient gap now). A
      // recompute failure is logged, never masks the original error.
      if (touchedAny && config.valueKey != null) {
        await this.recomputeDailySummaries(connection.userId, config, windowStart, windowEnd).catch(
          (err) =>
            logger.warn("[Health] daily summary recompute failed", {
              userId: connection.userId,
              metric: config.key,
              error: err instanceof Error ? err.message : String(err),
            })
        );
      }
    }
    return { upserted, truncated };
  }

  /** Store one raw page verbatim and upsert its parsed samples. Returns the row count. */
  private async persistPage(
    userId: string,
    config: MetricConfig,
    page: ListResult,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    if (page.dataPoints.length === 0) return 0;

    await this.db.insert(healthRawPages).values({
      userId,
      dataType: config.dataType,
      method: "list",
      windowStart,
      windowEnd,
      rawJson: page.dataPoints,
    });

    const rows: NewHealthSample[] = [];
    for (const point of page.dataPoints) {
      const parsed = parseSample(config, point);
      if (!parsed) continue;
      rows.push({
        userId,
        metric: config.key,
        sampleAt: parsed.sampleAt,
        source: parsed.source,
        value: parsed.value,
        valueJson: parsed.valueJson,
      });
    }
    if (rows.length === 0) return 0;
    await this.db.insert(healthSamples).values(rows).onConflictDoNothing();
    return rows.length;
  }

  private async listPageWithAuth(
    connection: HealthConnection,
    config: MetricConfig,
    filter: string,
    pageToken?: string
  ): Promise<ListResult> {
    const adapter = this.getAdapter();
    const req = (accessToken: string) =>
      adapter.listDataPoints({
        accessToken,
        dataType: config.dataType,
        filter,
        pageSize: LIST_PAGE_SIZE,
        pageToken,
      });

    let token = await this.getValidToken(connection);
    try {
      return await req(token);
    } catch (err) {
      // A 401 despite an un-expired stored token → force one refresh and retry.
      if (err instanceof GoogleHealthAuthError) {
        token = await this.getValidToken(connection, token);
        try {
          return await req(token);
        } catch (retryErr) {
          // A brand-new token still failing auth is a confirmed re-link situation.
          if (retryErr instanceof GoogleHealthAuthError) {
            await this.markNeedsReauth(connection.userId, "list auth failed after refresh");
          }
          throw retryErr;
        }
      }
      throw err;
    }
  }

  /**
   * Recompute health_daily_summaries for every KST day this window touched.
   * The day boundary is derived in SQL via localDayRawSql (KST, not the UTC day),
   * and each touched day is aggregated FULLY (over all its samples, not just the
   * window's) so summaries stay correct when a day straddles two sync windows.
   *
   * Multi-source: the same metric is written by multiple Health Connect apps
   * (phone pedometer + Samsung Health today, Fitbit later), so summing every row
   * double-counts overlapping sources. Instead we aggregate PER SOURCE per day,
   * then pick the single dominant source (largest daily sum for accumulating
   * metrics, most samples for instantaneous ones) — a lossless, calibration-free
   * dedup: no source's value is blended, and a smarter reconciliation can still be
   * recomputed later from the preserved rows.
   */
  private async recomputeDailySummaries(
    userId: string,
    config: MetricConfig,
    windowStart: Date,
    windowEnd: Date
  ): Promise<void> {
    // The KST day is derived in SQL (localDayRawSql form) — never the UTC day.
    const kstDay = sql.raw(localDayRawSql("sample_at"));
    // Bound the aggregation scan to the touched days' UTC span (window ± 1 day) so
    // it rides the (user_id, metric, sample_at) index instead of scanning the whole
    // (user, metric) partition. KST is a fixed UTC+9, so any KST day the window
    // touched lies entirely within [windowStart − 24h, windowEnd + 24h).
    const scanStart = new Date(windowStart.getTime() - 86_400_000).toISOString();
    const scanEnd = new Date(windowEnd.getTime() + 86_400_000).toISOString();
    // Rank sources within a day: accumulating metrics by total, instantaneous by
    // sample count (both already aggregated in per_source, so reference the column).
    const rankCol = config.agg === "sum" ? sql.raw("s_sum") : sql.raw("s_count");
    // value_sum is populated only for accumulating metrics; instantaneous leave it null.
    const valueSum = config.agg === "sum" ? sql.raw("s_sum") : sql`NULL::double precision`;
    await this.db.execute(sql`
      WITH per_source AS (
        SELECT user_id, metric, ${kstDay} AS day, source,
               avg(value) AS s_avg, min(value) AS s_min, max(value) AS s_max,
               sum(value) AS s_sum, count(*)::int AS s_count
        FROM health_samples
        WHERE user_id = ${userId} AND metric = ${config.key}
          AND sample_at >= ${scanStart}::timestamp
          AND sample_at < ${scanEnd}::timestamp
          AND ${kstDay} IN (
            SELECT DISTINCT ${kstDay} FROM health_samples
            WHERE user_id = ${userId} AND metric = ${config.key}
              AND sample_at >= ${windowStart.toISOString()}::timestamp
              AND sample_at < ${windowEnd.toISOString()}::timestamp
          )
        GROUP BY user_id, metric, ${kstDay}, source
      ),
      picked AS (
        SELECT DISTINCT ON (user_id, metric, day)
               user_id, metric, day, s_avg, s_min, s_max, s_sum, s_count
        FROM per_source
        ORDER BY user_id, metric, day, ${rankCol} DESC NULLS LAST, source
      )
      INSERT INTO health_daily_summaries
        (user_id, metric, day, value_avg, value_min, value_max, value_sum, count, updated_at)
      SELECT user_id, metric, day::text, s_avg, s_min, s_max, ${valueSum}, s_count, now()
      FROM picked
      ON CONFLICT (user_id, metric, day) DO UPDATE SET
        value_avg = EXCLUDED.value_avg,
        value_min = EXCLUDED.value_min,
        value_max = EXCLUDED.value_max,
        value_sum = EXCLUDED.value_sum,
        count = EXCLUDED.count,
        updated_at = now()
    `);
  }

  private async getSyncState(userId: string, metric: string) {
    const rows = await this.db
      .select()
      .from(healthSyncState)
      .where(and(eq(healthSyncState.userId, userId), eq(healthSyncState.metric, metric)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async setSyncState(
    userId: string,
    metric: string,
    patch: { syncedThrough?: Date; backfilledFrom?: Date }
  ): Promise<void> {
    await this.db
      .insert(healthSyncState)
      .values({ userId, metric, ...patch, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [healthSyncState.userId, healthSyncState.metric],
        set: { ...patch, updatedAt: new Date() },
      });
  }
}

export function createHealthSyncService(db: Database, options?: ServiceOptions): HealthSyncService {
  return new HealthSyncService(db, options);
}
