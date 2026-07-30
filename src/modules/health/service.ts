import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  type HealthConnection,
  healthConnections,
  healthDailySummaries,
  healthRawPages,
  healthSamples,
  healthSyncState,
  type NewHealthSample,
} from "@/db/schema";
import { localDayRawSql, timestampParam } from "@/db/sql";
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
// chunks backward until no data at all remains below the cursor (verified by a
// presence probe, so it's robust to arbitrarily long mid-history gaps — real data
// has 80+ day gaps for sparse metrics like SpO2/VO2max), with a deep floor only as
// an absolute backstop. Bounded chunks/run so one cron tick never pages unbounded
// history in a single event-loop stretch.
const BACKFILL_SAFETY_FLOOR_MS = 5 * 365 * 24 * 3600_000; // ~5y backstop (>> Health Connect retention)
const BACKFILL_CHUNK_MS = 14 * 24 * 3600_000;
const BACKFILL_CHUNKS_PER_RUN = 4;

// ── Metric config (ground-truthed by the U1 live spike) ──────────────────────
// The Google Health `list` payload wraps each point under a camelCase key
// (`heart-rate` → `heartRate`), carries its timestamp under `interval.startTime`
// (accumulating metrics), `sampleTime.physicalTime` (instantaneous metrics), or a
// civil `date` (the pre-aggregated `daily-*` metrics), and the `list` `filter` param
// addresses those fields in snake_case (`heart_rate.sample_time.physical_time`).
// Values arrive as strings OR numbers.
//
// Only metrics whose exact shape a live probe verified are enabled. The original
// U1 spike ran before the Fitbit Air wrote to Health Connect, so sleep / resting HR
// / HRV / AZM / active energy / the daily-* family were all empty then; the
// 2026-07-26 re-probe ground-truthed them and they are enabled below (see
// docs/health/google-health-spike-findings.md §6).
export type MetricAgg = "sum" | "avg";
type MetricTimeShape = "interval" | "sampleTime" | "date";

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
  /**
   * The API revises this point after we first read it (true for every `daily-*`
   * metric: today's rollup keeps changing until the day closes). Such samples
   * upsert with DO UPDATE instead of DO NOTHING, since their identity
   * (user, metric, sampleAt, source) is stable while the value is not.
   */
  revisable?: boolean;
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
  {
    key: "active_energy",
    dataType: "active-energy-burned",
    wrapper: "activeEnergyBurned",
    timeShape: "interval",
    filterField: "active_energy_burned.interval.start_time",
    valueKey: "kcal",
    agg: "sum",
  },
  {
    // One point per minute spent in a heart-rate zone; `heartRateZone` (FAT_BURN /
    // CARDIO / PEAK) rides along in the raw page, the scalar is the minute count.
    key: "active_zone_minutes",
    dataType: "active-zone-minutes",
    wrapper: "activeZoneMinutes",
    timeShape: "interval",
    filterField: "active_zone_minutes.interval.start_time",
    valueKey: "activeZoneMinutes",
    agg: "sum",
  },
  {
    // Intraday RMSSD samples (Fitbit emits these through the night).
    key: "hrv",
    dataType: "heart-rate-variability",
    wrapper: "heartRateVariability",
    timeShape: "sampleTime",
    filterField: "heart_rate_variability.sample_time.physical_time",
    valueKey: "rootMeanSquareOfSuccessiveDifferencesMilliseconds",
    agg: "avg",
  },
  // ── daily-* : server-side rollups keyed by a civil date, not a timestamp ────
  // Same key space as the on-device import writes (resting_heart_rate / hrv), so
  // cloud and imported rows coexist under one metric and dedup by source.
  {
    key: "resting_heart_rate",
    dataType: "daily-resting-heart-rate",
    wrapper: "dailyRestingHeartRate",
    timeShape: "date",
    filterField: "daily_resting_heart_rate.date",
    valueKey: "beatsPerMinute",
    agg: "avg",
    revisable: true,
  },
  {
    key: "daily_hrv",
    dataType: "daily-heart-rate-variability",
    wrapper: "dailyHeartRateVariability",
    timeShape: "date",
    filterField: "daily_heart_rate_variability.date",
    valueKey: "averageHeartRateVariabilityMilliseconds",
    agg: "avg",
    revisable: true,
  },
  {
    key: "daily_spo2",
    dataType: "daily-oxygen-saturation",
    wrapper: "dailyOxygenSaturation",
    timeShape: "date",
    filterField: "daily_oxygen_saturation.date",
    valueKey: "averagePercentage",
    agg: "avg",
    revisable: true,
  },
  {
    key: "respiratory_rate",
    dataType: "daily-respiratory-rate",
    wrapper: "dailyRespiratoryRate",
    timeShape: "date",
    filterField: "daily_respiratory_rate.date",
    valueKey: "breathsPerMinute",
    agg: "avg",
    revisable: true,
  },
  {
    // Nightly skin temperature. `baselineTemperatureCelsius` /
    // `relativeNightlyStddev30dCelsius` arrive as the STRING "NaN" until Fitbit has
    // 30 nights of baseline, so the absolute nightly reading is the scalar.
    key: "skin_temperature",
    dataType: "daily-sleep-temperature-derivations",
    wrapper: "dailySleepTemperatureDerivations",
    timeShape: "date",
    filterField: "daily_sleep_temperature_derivations.date",
    valueKey: "nightlyTemperatureCelsius",
    agg: "avg",
    revisable: true,
  },
  // `exercise` and `sleep` are synced SEPARATELY (syncSessions), not here: both are
  // structured (not scalars) and both have their `list` filter rejected 400
  // (INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER), so they can't be time-windowed.
];

// ── Sessions (structured, synced unfiltered) ─────────────────────────────────
// Both `exercise` and `sleep` reject every `list` filter variant, so they can't be
// time-windowed. Both are low-volume (one row per workout / per night), so each run
// re-fetches the whole history newest-first under a page cap and upserts — no
// watermark needed, and idempotent because the identity is stable.
export const EXERCISE_METRIC = "exercise";
export const SLEEP_METRIC = "sleep";
const SESSION_MAX_PAGES = 10; // low volume; a full unfiltered re-fetch is cheap
const EXERCISE_CONFIG: MetricConfig = {
  key: EXERCISE_METRIC,
  dataType: "exercise",
  wrapper: "exercise",
  timeShape: "interval",
  filterField: "exercise.interval.start_time",
  valueKey: null,
  agg: "sum",
};
const SLEEP_CONFIG: MetricConfig = {
  key: SLEEP_METRIC,
  dataType: "sleep",
  wrapper: "sleep",
  timeShape: "interval",
  filterField: "sleep.interval.start_time",
  valueKey: null,
  agg: "sum",
};
export const SESSION_CONFIGS: MetricConfig[] = [EXERCISE_CONFIG, SLEEP_CONFIG];

export interface ParsedWorkout {
  sampleAt: Date;
  source: string;
  activeMinutes: number;
  wrapper: Record<string, unknown>;
}

/**
 * Resolve a data point's `source` — the writing app's package name, else the
 * measuring platform, else "unknown".
 *
 * This is a storage contract, not a label: `source` is part of the sample identity
 * `(userId, metric, sampleAt, source)` and it is what the daily-summary
 * dominant-source dedup and the /health session read paths discriminate on.
 * Fitbit-native points carry NO `application.packageName` (only `platform` +
 * `recordingMethod`), so without the platform fallback every wrist-measured row
 * collapses into one opaque "unknown" bucket shared with genuinely unattributable
 * data — and readers can no longer tell the measuring platform from an aggregator
 * app that re-publishes the same session (com.withings.wiscale2 does exactly this).
 *
 * Non-string attribution is ignored rather than coerced, since `source` is a text
 * column and a stringified object would silently become a distinct identity.
 */
export function sampleSource(point: GoogleHealthDataPoint): string {
  const ds = point.dataSource as
    | { application?: { packageName?: unknown }; platform?: unknown }
    | undefined;
  const pkg = ds?.application?.packageName;
  if (typeof pkg === "string" && pkg !== "") return pkg;
  const platform = ds?.platform;
  if (typeof platform === "string" && platform !== "") return platform;
  return "unknown";
}

/** Parse a protobuf Duration string ("660s", "660.5s") — or raw seconds — to minutes. */
export function durationToMinutes(raw: unknown): number {
  if (typeof raw === "number") return raw / 60;
  if (typeof raw !== "string") return 0;
  const m = raw.match(/^(\d+(?:\.\d+)?)s?$/);
  return m ? Number(m[1]) / 60 : 0;
}

/**
 * Normalize one raw `exercise` data point into a workout row, or null if unusable.
 * Stored in health_samples with `value` = active minutes (for daily-total rollups)
 * and `valueJson` = the whole workout wrapper (type/name/duration for the list).
 */
export function parseExerciseWorkout(point: GoogleHealthDataPoint): ParsedWorkout | null {
  const wrapper = point.exercise as Record<string, unknown> | undefined;
  if (!wrapper || typeof wrapper !== "object") return null;
  const start = (wrapper.interval as { startTime?: string } | undefined)?.startTime;
  if (!start) return null;
  const sampleAt = new Date(start);
  if (Number.isNaN(sampleAt.getTime())) return null;
  const source = sampleSource(point);
  return { sampleAt, source, activeMinutes: durationToMinutes(wrapper.activeDuration), wrapper };
}

/**
 * Normalize one raw `sleep` data point into a session row, or null if unusable.
 * Unlike exercise there is no `activeDuration` field — the session length is the
 * interval itself. Stored with `value` = duration minutes and `valueJson` = the
 * whole wrapper, whose `stages[]` drives the hypnogram (see modules/health/sleep.ts).
 */
export function parseSleepSession(point: GoogleHealthDataPoint): ParsedWorkout | null {
  const wrapper = point.sleep as Record<string, unknown> | undefined;
  if (!wrapper || typeof wrapper !== "object") return null;
  const interval = wrapper.interval as { startTime?: string; endTime?: string } | undefined;
  if (!interval?.startTime) return null;
  const sampleAt = new Date(interval.startTime);
  if (Number.isNaN(sampleAt.getTime())) return null;
  const end = interval.endTime ? new Date(interval.endTime) : null;
  const minutes =
    end && !Number.isNaN(end.getTime())
      ? Math.max(0, (end.getTime() - sampleAt.getTime()) / 60_000)
      : 0;
  const source = sampleSource(point);
  return { sampleAt, source, activeMinutes: minutes, wrapper };
}

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

function parseIso(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * `daily-*` points are keyed by a civil date (`{year, month, day}`) with no time —
 * a KST calendar day, since the account's every point carries a +9h offset. Anchor
 * it at 12:00 KST (03:00Z) rather than midnight so the stored UTC instant lands
 * unambiguously inside its own KST day when localDaySql buckets it back
 * ((sample_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date).
 */
function civilDateToInstant(raw: unknown): Date | null {
  const d = raw as { year?: number; month?: number; day?: number } | undefined;
  if (
    !d ||
    typeof d.year !== "number" ||
    typeof d.month !== "number" ||
    typeof d.day !== "number"
  ) {
    return null;
  }
  const ms = Date.UTC(d.year, d.month - 1, d.day, 12 - KST_OFFSET_HOURS, 0, 0);
  return Number.isNaN(ms) ? null : new Date(ms);
}

const KST_OFFSET_HOURS = 9;
const KST_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** KST calendar day ('YYYY-MM-DD') of a UTC instant — the `date` filter's key space. */
function kstDay(d: Date): string {
  return KST_DAY_FMT.format(d);
}

/**
 * Normalize one raw Google Health data point into a health_samples row shape, or
 * null when the point is unusable (missing wrapper/timestamp, or a scalar metric
 * whose value is absent/non-numeric). `source` is resolved by `sampleSource` and is
 * part of the sample identity, so multiple Health Connect sources for one metric
 * coexist rather than collide.
 */
export function parseSample(
  config: MetricConfig,
  point: GoogleHealthDataPoint
): ParsedSample | null {
  const wrapper = point[config.wrapper] as Record<string, unknown> | undefined;
  if (!wrapper || typeof wrapper !== "object") return null;

  const sampleAt =
    config.timeShape === "date"
      ? civilDateToInstant(wrapper.date)
      : parseIso(
          config.timeShape === "interval"
            ? (wrapper.interval as { startTime?: string } | undefined)?.startTime
            : (wrapper.sampleTime as { physicalTime?: string } | undefined)?.physicalTime
        );
  if (!sampleAt) return null;

  const source = sampleSource(point);

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
 *
 * `date`-shaped metrics compare against a bare KST calendar day, not an instant
 * (`… >= "2026-07-26"`; the `.year` sub-field is rejected 400). The window is
 * widened to whole days — floor the lower bound, ceil the upper — so a partial day
 * at either edge is never silently dropped. Re-reading a day is free: those metrics
 * are `revisable`, so the upsert refreshes the value in place.
 */
export function buildTimeFilter(config: MetricConfig, since: Date, until?: Date): string {
  if (config.timeShape === "date") {
    const lower = `${config.filterField} >= "${kstDay(since)}"`;
    if (!until) return lower;
    // Ceil: the upper bound is exclusive, so include the day `until` falls in.
    const end = kstDay(new Date(until.getTime() + 86_400_000));
    return `${lower} AND ${config.filterField} < "${end}"`;
  }
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
    const errors: string[] = [];
    // Scalar metrics take the incremental filtered path; `exercise` / `sleep` are
    // structured and unfilterable, so they re-read unfiltered. Each unit is
    // isolated (AE4) so one failure never drops the rest.
    const units = [
      ...HEALTH_METRICS.map((c) => ({
        key: c.key,
        run: () => this.syncMetricForward(connection, c, now),
      })),
      ...SESSION_CONFIGS.map((c) => ({ key: c.key, run: () => this.syncSessions(connection, c) })),
    ];
    let total = 0;
    for (const unit of units) {
      try {
        total += await unit.run();
      } catch (err) {
        errors.push(`${unit.key}: ${err instanceof Error ? err.message : String(err)}`);
        logger.warn("[Health] metric sync failed (skipping)", {
          userId,
          metric: unit.key,
          status: err instanceof GoogleHealthApiError ? err.status : undefined,
        });
      }
    }

    // Advance the sync clock only when at least one unit succeeded. A TOTAL
    // failure (dead token, network down) leaves lastSyncedAt untouched so the
    // skipIfSyncedWithinMs gate doesn't suppress the retry for a full interval.
    const allFailed = errors.length === units.length;
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
   * Sync structured session metrics (`exercise`, `sleep`). Neither can be
   * time-filtered (their `list` filters 400), so each is fetched unfiltered
   * newest-first, bounded to SESSION_MAX_PAGES, and upserted (onConflictDoNothing
   * dedups by (userId, metric, sampleAt, source)). Low volume — one row per workout
   * / per night — makes a full re-fetch per run cheap + idempotent, so no watermark
   * and no separate backfill: the unfiltered read already reaches all history. Each
   * row carries `value` = duration minutes (daily rollups) + `valueJson` = the
   * wrapper (workout type / sleep stages).
   */
  private async syncSessions(connection: HealthConnection, config: MetricConfig): Promise<number> {
    const parse = config.key === SLEEP_METRIC ? parseSleepSession : parseExerciseWorkout;
    let pageToken: string | undefined;
    let pages = 0;
    const rows: NewHealthSample[] = [];
    do {
      // Empty filter → the adapter omits it → unfiltered (most recent first).
      const page = await this.listPageWithAuth(connection, config, "", pageToken);
      for (const point of page.dataPoints) {
        const s = parse(point);
        if (!s) continue;
        rows.push({
          userId: connection.userId,
          metric: config.key,
          sampleAt: s.sampleAt,
          source: s.source,
          value: s.activeMinutes,
          valueJson: s.wrapper,
        });
      }
      pageToken = page.nextPageToken;
      pages++;
      await new Promise((resolve) => setImmediate(resolve)); // event-loop yield
    } while (pageToken && pages < SESSION_MAX_PAGES);

    if (rows.length === 0) return 0;
    await this.db.insert(healthSamples).values(rows).onConflictDoNothing();
    return rows.length;
  }

  /**
   * Historical backfill: walk each metric's `backfilledFrom` watermark backward
   * over all available history — until no data remains below the cursor (a presence
   * probe, gap-proof) or the deep `health_connections.backfillFloor` backstop — a
   * bounded number of 14-day chunks per run so a single tick never pages an
   * unbounded history. Resumable + idempotent (samples upsert DO NOTHING). Once
   * every metric is done, stamp `backfillCompletedAt` so the UI can leave the
   * "동기화 중" state (R12).
   *
   * Completion is tracked PER METRIC (`backfilledFrom <= floor`), not by the
   * connection-level `backfillCompletedAt` flag — otherwise a metric added to
   * HEALTH_METRICS after a connection finished (sleep, HRV, the daily-* family)
   * would never get its history, since the flag was already stamped. The flag stays
   * as the UI's "first backfill done" hint and is never cleared.
   */
  async backfillPendingConnections(userId: string): Promise<HealthSyncResult> {
    const connection = await this.getConnection(userId);
    if (!connection || connection.status !== "active") {
      return { userId, samplesUpserted: 0, skipped: true };
    }

    const floor = connection.backfillFloor ?? (await this.seedBackfillFloor(connection));
    const pending = await this.pendingBackfillMetrics(userId, floor);
    if (pending.length === 0) return { userId, samplesUpserted: 0, skipped: true };

    let total = 0;
    let allComplete = true;
    for (const config of pending) {
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

    if (allComplete && !connection.backfillCompletedAt) {
      await this.db
        .update(healthConnections)
        .set({ backfillCompletedAt: new Date(), updatedAt: new Date() })
        .where(eq(healthConnections.userId, userId));
      logger.info("[Health] Backfill complete", { userId });
    }
    return { userId, samplesUpserted: total, skipped: false };
  }

  /**
   * Metrics whose backward walk hasn't reached the floor yet. A metric is done once
   * its `backfilledFrom` is stamped AT the floor — backfillMetric stamps it there
   * both when the walk runs out of history (presence probe) and when it hits the
   * floor, so "done" survives a restart without a dedicated column.
   */
  private async pendingBackfillMetrics(userId: string, floor: Date): Promise<MetricConfig[]> {
    const states = await this.db
      .select()
      .from(healthSyncState)
      .where(eq(healthSyncState.userId, userId));
    const byMetric = new Map(states.map((s) => [s.metric, s]));
    return HEALTH_METRICS.filter((config) => {
      const from = byMetric.get(config.key)?.backfilledFrom;
      return !from || from.getTime() > floor.getTime();
    });
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
      // All-time backfill with real gaps: an empty window does NOT mean history
      // ended — older data can sit beyond a months-long gap (verified: SpO2 has an
      // 84d gap; sparse metrics also lead with empty recent windows). Only stop when
      // NO data remains anywhere below the cursor — one presence probe over the whole
      // remaining range, so it's gap-proof regardless of gap length.
      if (got === 0 && !(await this.hasDataBefore(connection, config, cursor, floor))) {
        // Stamp the cursor AT the floor: nothing exists below it, so this metric is
        // done for good. That's what makes completion durable per metric (see
        // pendingBackfillMetrics) rather than only in the connection-level flag.
        await this.setSyncState(connection.userId, config.key, { backfilledFrom: floor });
        return { upserted, reachedFloor: true };
      }
    }

    return { upserted, reachedFloor: cursor.getTime() <= floor.getTime() };
  }

  /**
   * Presence probe: does ANY data exist for this metric in [floor, before)?
   * A single pageSize=1 `list` over the entire remaining range, so backfill can
   * tell "history ended" from "just a gap" no matter how long the gap is.
   */
  private async hasDataBefore(
    connection: HealthConnection,
    config: MetricConfig,
    before: Date,
    floor: Date
  ): Promise<boolean> {
    const page = await this.listPageWithAuth(
      connection,
      config,
      buildTimeFilter(config, floor, before),
      undefined,
      1
    );
    return page.dataPoints.length > 0;
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
    if (config.revisable) {
      // `daily-*` rollups are revised until their day closes (and the current day is
      // re-read every run), so the value must overwrite rather than be discarded.
      await this.db
        .insert(healthSamples)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            healthSamples.userId,
            healthSamples.metric,
            healthSamples.sampleAt,
            healthSamples.source,
          ],
          set: { value: sql`excluded.value`, valueJson: sql`excluded.value_json` },
        });
    } else {
      await this.db.insert(healthSamples).values(rows).onConflictDoNothing();
    }
    return rows.length;
  }

  private async listPageWithAuth(
    connection: HealthConnection,
    config: MetricConfig,
    filter: string,
    pageToken?: string,
    pageSize: number = LIST_PAGE_SIZE
  ): Promise<ListResult> {
    const adapter = this.getAdapter();
    const req = (accessToken: string) =>
      adapter.listDataPoints({
        accessToken,
        dataType: config.dataType,
        filter,
        pageSize,
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
    // NOT a bare `now()`: this is raw SQL, so `now()` would be cast to the column's
    // naive `timestamp` using the SESSION timezone — Asia/Seoul on this server — and
    // store KST wall time, while every timestamp Drizzle writes is UTC wall time.
    // `timestampParam` binds a JS Date through the column's own driver mapping, which
    // is the one thing guaranteed to match the builder. Same fix as 7790bb5.
    const stamp = timestampParam(healthDailySummaries.updatedAt, new Date());
    await this.db.execute(sql`
      WITH per_source AS (
        -- A row is either a raw sample or a compacted minute bucket carrying
        -- { min, max, n } in value_json (see modules/health/compaction.ts). Weighting
        -- by n makes the daily mean identical to the mean over the raw samples, and
        -- reading the stored bounds keeps daily min/max exact — the /health trend card
        -- draws a per-day range bar, which bucket means alone would visibly shrink.
        -- For every uncompacted metric value_json has no 'n'/'min'/'max', so each
        -- COALESCE falls through and this reduces to plain avg/min/max/count.
        SELECT user_id, metric, ${kstDay} AS day, source,
               (sum(value * COALESCE((value_json->>'n')::double precision, 1))
                 / NULLIF(sum(COALESCE((value_json->>'n')::double precision, 1)), 0)
               )::double precision AS s_avg,
               min(LEAST(value, COALESCE((value_json->>'min')::double precision, value))) AS s_min,
               max(GREATEST(value, COALESCE((value_json->>'max')::double precision, value))) AS s_max,
               -- mean * n reconstructs a bucket's true total, so an accumulating
               -- metric would stay correct if it were ever compacted too.
               sum(value * COALESCE((value_json->>'n')::double precision, 1)) AS s_sum,
               sum(COALESCE((value_json->>'n')::int, 1))::int AS s_count
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
      SELECT user_id, metric, day::text, s_avg, s_min, s_max, ${valueSum}, s_count, ${stamp}
      FROM picked
      ON CONFLICT (user_id, metric, day) DO UPDATE SET
        value_avg = EXCLUDED.value_avg,
        value_min = EXCLUDED.value_min,
        value_max = EXCLUDED.value_max,
        value_sum = EXCLUDED.value_sum,
        count = EXCLUDED.count,
        updated_at = EXCLUDED.updated_at
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
