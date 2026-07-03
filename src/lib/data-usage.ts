/**
 * Data Usage Calculation Service
 *
 * Calculates estimated data usage per user by querying row counts
 * and text column sizes for each table, then caching results in data_usage_cache.
 */

import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { dataUsageCache } from "@/db/schema";
import { logger } from "@/lib/logger";
import { now } from "@/lib/utils";

export interface UsageRow {
  category: string;
  tableName: string;
  rowCount: number;
  estimatedBytes: number;
  calculatedAt: Date;
}

export interface DataUsageCategory {
  category: string;
  label: string;
  tables: { tableName: string; rowCount: number; estimatedBytes: number }[];
  totalRows: number;
  totalBytes: number;
}

export interface DataUsageResponse {
  categories: DataUsageCategory[];
  grandTotalRows: number;
  grandTotalBytes: number;
  calculatedAt: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  commits: "커밋",
  location: "위치",
  coding: "코딩",
  spending: "소비",
  system: "시스템",
};

interface TableDef {
  category: string;
  table: string;
}

const TABLE_DEFS: TableDef[] = [
  { category: "commits", table: "commits" },
  { category: "commits", table: "commit_summaries" },
  { category: "location", table: "location_points" },
  { category: "location", table: "daily_distances" },
  { category: "location", table: "saved_places" },
  { category: "location", table: "visits" },
  { category: "location", table: "tracks" },
  { category: "location", table: "transportation_segments" },
  { category: "location", table: "trips" },
  { category: "coding", table: "coding_sessions" },
  { category: "coding", table: "coding_daily_stats" },
  { category: "spending", table: "notification_logs" },
  { category: "spending", table: "transactions" },
  { category: "system", table: "sync_jobs" },
];

/**
 * Per-table usage estimate.
 *
 * Bytes come from pg_total_relation_size (heap + indexes + toast) attributed
 * proportionally to the user's row share — replacing the old per-user
 * SUM(LENGTH(text)) scans over every text column of 13 tables plus
 * hand-maintained fixed-bytes-per-row constants. reltuples is the planner's
 * row estimate (refreshed by autovacuum), which is plenty for a usage display
 * and costs nothing.
 *
 * Table names come from the static TABLE_DEFS literal above (trusted
 * identifiers, safe to inline); userId is a bound parameter — never
 * string-interpolate it.
 */
function buildEstimateQuery(tableDef: TableDef, userId: string) {
  const table = sql.raw(`"${tableDef.table}"`);
  const regclass = sql.raw(`to_regclass('"${tableDef.table}"')`);
  return sql`
    SELECT
      (SELECT COUNT(*) FROM ${table} WHERE "user_id" = ${userId})::bigint AS user_rows,
      GREATEST(COALESCE((SELECT reltuples FROM pg_class WHERE oid = ${regclass}), 0), 0)::bigint AS total_rows_est,
      COALESCE(pg_total_relation_size(${regclass}), 0)::bigint AS total_bytes
  `;
}

/**
 * Calculate data usage for a user across all tables and upsert into cache.
 */
export async function calculateDataUsage(db: Database, userId: string): Promise<UsageRow[]> {
  const calculatedAt = now();
  const results: UsageRow[] = [];

  for (const def of TABLE_DEFS) {
    try {
      const rows = await db.execute(buildEstimateQuery(def, userId));
      const row = rows.rows[0] as
        | {
            user_rows: string | number;
            total_rows_est: string | number;
            total_bytes: string | number;
          }
        | undefined;

      const userRows = Number(row?.user_rows ?? 0);
      const totalRowsEst = Number(row?.total_rows_est ?? 0);
      const totalBytes = Number(row?.total_bytes ?? 0);
      // Attribute table size by row share; reltuples can lag behind reality,
      // so never divide by less than the rows we just counted.
      const share = userRows === 0 ? 0 : userRows / Math.max(totalRowsEst, userRows);

      const usageRow: UsageRow = {
        category: def.category,
        tableName: def.table,
        rowCount: userRows,
        estimatedBytes: Math.round(totalBytes * share),
        calculatedAt,
      };

      results.push(usageRow);
    } catch (error) {
      logger.error("data-usage: estimate query failed", {
        table: def.table,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({
        category: def.category,
        tableName: def.table,
        rowCount: 0,
        estimatedBytes: 0,
        calculatedAt,
      });
    }
  }

  // Upsert all results into cache
  for (const r of results) {
    await db
      .insert(dataUsageCache)
      .values({
        userId,
        category: r.category,
        tableName: r.tableName,
        rowCount: r.rowCount,
        estimatedBytes: r.estimatedBytes,
        calculatedAt: r.calculatedAt,
      })
      .onConflictDoUpdate({
        target: [dataUsageCache.userId, dataUsageCache.tableName],
        set: {
          category: r.category,
          rowCount: r.rowCount,
          estimatedBytes: r.estimatedBytes,
          calculatedAt: r.calculatedAt,
        },
      });
  }

  return results;
}

/**
 * Read cached data usage for a user (fast, no recalculation).
 */
export async function getDataUsage(db: Database, userId: string): Promise<UsageRow[]> {
  const rows = await db
    .select({
      category: dataUsageCache.category,
      tableName: dataUsageCache.tableName,
      rowCount: dataUsageCache.rowCount,
      estimatedBytes: dataUsageCache.estimatedBytes,
      calculatedAt: dataUsageCache.calculatedAt,
    })
    .from(dataUsageCache)
    .where(eq(dataUsageCache.userId, userId));

  return rows;
}

/**
 * Format UsageRow[] into the API response shape.
 */
export function formatDataUsageResponse(rows: UsageRow[]): DataUsageResponse {
  if (rows.length === 0) {
    return {
      categories: [],
      grandTotalRows: 0,
      grandTotalBytes: 0,
      calculatedAt: null,
    };
  }

  const categoryMap = new Map<string, DataUsageCategory>();

  for (const row of rows) {
    let cat = categoryMap.get(row.category);
    if (!cat) {
      cat = {
        category: row.category,
        label: CATEGORY_LABELS[row.category] ?? row.category,
        tables: [],
        totalRows: 0,
        totalBytes: 0,
      };
      categoryMap.set(row.category, cat);
    }
    cat.tables.push({
      tableName: row.tableName,
      rowCount: row.rowCount,
      estimatedBytes: row.estimatedBytes,
    });
    cat.totalRows += row.rowCount;
    cat.totalBytes += row.estimatedBytes;
  }

  const categories = Array.from(categoryMap.values()).sort((a, b) => b.totalBytes - a.totalBytes);
  const grandTotalRows = categories.reduce((sum, c) => sum + c.totalRows, 0);
  const grandTotalBytes = categories.reduce((sum, c) => sum + c.totalBytes, 0);
  const calculatedAt = rows[0]?.calculatedAt?.toISOString() ?? null;

  return { categories, grandTotalRows, grandTotalBytes, calculatedAt };
}

/**
 * Refresh data usage cache only if stale (>24h since last calculation).
 * Used by Cron to avoid recalculating every 10 minutes.
 */
export async function maybeRefreshDataUsage(db: Database, userId: string): Promise<void> {
  const cached = await db
    .select({ calculatedAt: dataUsageCache.calculatedAt })
    .from(dataUsageCache)
    .where(eq(dataUsageCache.userId, userId))
    .limit(1);

  if (cached.length > 0 && cached[0].calculatedAt) {
    const ageMs = Date.now() - cached[0].calculatedAt.getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (ageMs < twentyFourHours) {
      return; // Still fresh
    }
  }

  await calculateDataUsage(db, userId);
}
