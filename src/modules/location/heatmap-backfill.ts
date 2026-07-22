import { type SQL, sql } from "drizzle-orm";
import type { LocationQueryExecutor } from "@/modules/overview/aggregate/location";
import { rebuildDailyLocationHeatmap } from "@/modules/overview/aggregate/location";

export const DEFAULT_HEATMAP_BACKFILL_LIMIT = 250;
export const MAX_HEATMAP_BACKFILL_LIMIT = 5_000;
export const DEFAULT_HEATMAP_BACKFILL_BATCH_SIZE = 25;
export const MAX_HEATMAP_BACKFILL_BATCH_SIZE = 100;

export interface HeatmapBackfillCandidate {
  userId: string;
  date: string;
}

export interface HeatmapBackfillOptions {
  apply: boolean;
  limit: number;
  batchSize: number;
  userId?: string;
  from?: string;
  to?: string;
}

export interface HeatmapBackfillResult {
  mode: "dry-run" | "apply";
  candidates: HeatmapBackfillCandidate[];
  rebuilt: number;
}

interface QueryResult {
  rows?: unknown[];
}

interface HeatmapBackfillDependencies {
  loadCandidates?: (
    executor: LocationQueryExecutor,
    options: HeatmapBackfillOptions,
    limit: number
  ) => Promise<HeatmapBackfillCandidate[]>;
  rebuildDay?: (
    executor: LocationQueryExecutor,
    userId: string,
    date: string,
    calculatedAt?: Date
  ) => Promise<void>;
  now?: () => Date;
  onRebuilt?: (candidate: HeatmapBackfillCandidate, rebuilt: number) => void;
}

function parseBoundedInteger(
  value: string | true | undefined,
  name: string,
  fallback: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  if (value === true || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function assertLocalDate(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error(`${name} is not a valid calendar date`);
  }
}

function parseArgumentMap(args: string[]): Map<string, string | true> {
  const values = new Map<string, string | true>();
  const allowed = new Set(["--apply", "--limit", "--batch-size", "--user", "--from", "--to"]);
  for (const arg of args) {
    const [key, ...rest] = arg.split("=");
    if (!allowed.has(key)) throw new Error(`Unknown option: ${key}`);
    if (values.has(key)) throw new Error(`Duplicate option: ${key}`);
    values.set(key, rest.length === 0 ? true : rest.join("="));
  }
  return values;
}

function optionalString(values: Map<string, string | true>, key: string): string | undefined {
  const value = values.get(key);
  if (value === true) throw new Error(`${key} requires a value`);
  return value;
}

function validateDateRange(from: string | undefined, to: string | undefined): void {
  if (from) assertLocalDate(from, "--from");
  if (to) assertLocalDate(to, "--to");
  if (from && to && from > to) throw new Error("--from must not be after --to");
}

export function parseHeatmapBackfillOptions(args: string[]): HeatmapBackfillOptions {
  const values = parseArgumentMap(args);

  if (values.get("--apply") !== undefined && values.get("--apply") !== true) {
    throw new Error("--apply does not accept a value");
  }

  const limit = parseBoundedInteger(
    values.get("--limit"),
    "--limit",
    DEFAULT_HEATMAP_BACKFILL_LIMIT,
    MAX_HEATMAP_BACKFILL_LIMIT
  );
  const batchSize = parseBoundedInteger(
    values.get("--batch-size"),
    "--batch-size",
    DEFAULT_HEATMAP_BACKFILL_BATCH_SIZE,
    MAX_HEATMAP_BACKFILL_BATCH_SIZE
  );
  const userId = optionalString(values, "--user");
  const from = optionalString(values, "--from");
  const to = optionalString(values, "--to");
  validateDateRange(from, to);

  return {
    apply: values.has("--apply"),
    limit,
    batchSize: Math.min(batchSize, limit),
    ...(userId ? { userId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

function candidateRows(result: unknown): HeatmapBackfillCandidate[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return { userId: String(row.userId), date: String(row.date) };
  });
}

/**
 * Finds raw-point KST days with no rollup cells. A raw day cannot be a valid
 * zero-cell day: location_points.lat/lon are NOT NULL and the canonical daily
 * rebuild groups every raw row into exactly one rounded grid cell.
 */
export async function loadMissingLocationHeatmapDays(
  executor: LocationQueryExecutor,
  options: HeatmapBackfillOptions,
  limit: number
): Promise<HeatmapBackfillCandidate[]> {
  const localDay = sql`(${sql.raw("location_points.timestamp")} at time zone 'UTC' at time zone 'Asia/Seoul')::date`;
  const userFilter: SQL = options.userId
    ? sql`AND location_points.user_id = ${options.userId}`
    : sql``;
  const fromFilter: SQL = options.from ? sql`AND ${localDay} >= ${options.from}::date` : sql``;
  const toFilter: SQL = options.to ? sql`AND ${localDay} <= ${options.to}::date` : sql``;
  const result = await executor.execute(sql`
    WITH raw_days AS (
      SELECT location_points.user_id, ${localDay} AS date
      FROM location_points
      WHERE 1 = 1 ${userFilter} ${fromFilter} ${toFilter}
      GROUP BY location_points.user_id, ${localDay}
    )
    SELECT raw_days.user_id AS "userId", to_char(raw_days.date, 'YYYY-MM-DD') AS date
    FROM raw_days
    WHERE NOT EXISTS (
      SELECT 1
      FROM location_heatmap_daily rollup
      WHERE rollup.user_id = raw_days.user_id
        AND rollup.date = to_char(raw_days.date, 'YYYY-MM-DD')
    )
    ORDER BY raw_days.date ASC, raw_days.user_id ASC
    LIMIT ${Math.min(Math.max(limit, 1), MAX_HEATMAP_BACKFILL_LIMIT)}
  `);
  return candidateRows(result);
}

export async function backfillMissingLocationHeatmaps(
  executor: LocationQueryExecutor,
  options: HeatmapBackfillOptions,
  dependencies: HeatmapBackfillDependencies = {}
): Promise<HeatmapBackfillResult> {
  const loadCandidates = dependencies.loadCandidates ?? loadMissingLocationHeatmapDays;
  const rebuildDay = dependencies.rebuildDay ?? rebuildDailyLocationHeatmap;
  const now = dependencies.now ?? (() => new Date());

  if (!options.apply) {
    const candidates = await loadCandidates(executor, options, options.limit);
    return { mode: "dry-run", candidates, rebuilt: 0 };
  }

  const candidates: HeatmapBackfillCandidate[] = [];
  while (candidates.length < options.limit) {
    const queryLimit = Math.min(options.batchSize, options.limit - candidates.length);
    const batch = await loadCandidates(executor, options, queryLimit);
    if (batch.length === 0) break;

    for (const candidate of batch) {
      await rebuildDay(executor, candidate.userId, candidate.date, now());
      candidates.push(candidate);
      dependencies.onRebuilt?.(candidate, candidates.length);
    }
    if (batch.length < queryLimit) break;
  }

  return { mode: "apply", candidates, rebuilt: candidates.length };
}
