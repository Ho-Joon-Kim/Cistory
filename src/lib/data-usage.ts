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

// Per-row fixed overhead estimates (bytes)
// uuid=36, integer=8, double=8, timestamp=26, boolean=1, text(id)~36
interface TableDef {
  category: string;
  table: string;
  textColumns: string[];
  fixedBytesPerRow: number;
}

const TABLE_DEFS: TableDef[] = [
  // commits category
  {
    category: "commits",
    table: "commits",
    textColumns: [
      "message",
      "parent_shas",
      "repo_full_name",
      "author_name",
      "author_email",
      "author_avatar_url",
    ],
    // id(text~36) + user_id(36) + sha(40) + committed_at(26) + additions(8) + deletions(8) + changed_files_count(8) + is_merge_commit(1) + repo_id(8) + repo_is_private(1) + created_at(26)
    fixedBytesPerRow: 198,
  },
  {
    category: "commits",
    table: "commit_summaries",
    textColumns: ["summary", "error_message"],
    // id(36) + commit_id(36) + status(~10) + retry_count(8) + created_at(26) + updated_at(26)
    fixedBytesPerRow: 142,
  },
  // location category
  {
    category: "location",
    table: "location_points",
    textColumns: ["tracker_id", "city", "country_name"],
    // uuid(36) + user_id(36) + lat(8) + lon(8) + accuracy(8) + altitude(8) + velocity(8) + battery(8) + timestamp(26) + created_at(26) + anomaly(1) + lonlat geography(~32)
    fixedBytesPerRow: 205,
  },
  {
    category: "location",
    table: "daily_distances",
    textColumns: ["date"],
    // uuid(36) + user_id(36) + distance_meters(8) + calculated_at(26)
    fixedBytesPerRow: 106,
  },
  {
    category: "location",
    table: "saved_places",
    textColumns: ["name", "address", "category"],
    // uuid(36) + user_id(36) + lat(8) + lon(8) + radius_m(8) + created_at(26) + updated_at(26)
    fixedBytesPerRow: 148,
  },
  {
    category: "location",
    table: "visits",
    textColumns: ["place_name", "address", "category", "city", "country_name"],
    // uuid(36) + user_id(36) + center_lat(8) + center_lon(8) + radius_m(8) + start_time(26) + end_time(26) + duration_seconds(8) + saved_place_id(36) + calculated_at(26)
    fixedBytesPerRow: 218,
  },
  {
    category: "location",
    table: "tracks",
    textColumns: ["start_place_name", "end_place_name", "dominant_mode"],
    // uuid(36) + user_id(36) + start_time(26) + end_time(26) + distance_meters(8) + duration_seconds(8) + point_count(8) + elevation_gain(8) + elevation_loss(8) + calculated_at(26)
    fixedBytesPerRow: 190,
  },
  {
    category: "location",
    table: "transportation_segments",
    textColumns: ["date", "mode", "confidence"],
    // uuid(36) + user_id(36) + track_id(36) + start_time(26) + end_time(26) + distance_meters(8) + duration_seconds(8) + avg_speed_kmh(8) + max_speed_kmh(8) + avg_acceleration(8) + calculated_at(26)
    fixedBytesPerRow: 226,
  },
  {
    category: "location",
    table: "trips",
    textColumns: ["name", "start_date", "end_date", "visited_cities", "visited_countries", "notes"],
    // uuid(36) + user_id(36) + total_distance_meters(8) + is_overseas(1) + created_at(26) + updated_at(26)
    fixedBytesPerRow: 133,
  },
  // coding category
  {
    category: "coding",
    table: "coding_sessions",
    textColumns: ["project"],
    // uuid(36) + user_id(36) + started_at(26) + duration_seconds(8) + human_additions(8) + human_deletions(8) + ai_additions(8) + ai_deletions(8) + created_at(26)
    fixedBytesPerRow: 164,
  },
  {
    category: "coding",
    table: "coding_daily_stats",
    textColumns: ["projects", "languages", "editors", "categories"],
    // uuid(36) + user_id(36) + date(10) + total_seconds(8) + calculated_at(26)
    fixedBytesPerRow: 116,
  },
  // spending category
  {
    category: "spending",
    table: "notification_logs",
    textColumns: ["raw_payload", "headers"],
    // uuid(36) + user_id(36) + source(~10) + received_at(26)
    fixedBytesPerRow: 108,
  },
  {
    category: "spending",
    table: "transactions",
    textColumns: ["merchant", "account_name", "raw_title", "raw_text"],
    // uuid(36) + user_id(36) + notification_log_id(36) + type(~10) + amount(8) + transacted_at(26) + created_at(26)
    fixedBytesPerRow: 178,
  },
  // system category
  {
    category: "system",
    table: "sync_jobs",
    textColumns: ["error_message"],
    // id(36) + user_id(36) + sync_type(~10) + status(~12) + trigger_type(~10) + total_commits(8) + processed_commits(8) + started_at(26) + completed_at(26) + created_at(26)
    fixedBytesPerRow: 198,
  },
];

function buildEstimateQuery(tableDef: TableDef, userId: string) {
  const textLenExpr =
    tableDef.textColumns.length > 0
      ? tableDef.textColumns.map((col) => `COALESCE(LENGTH("${col}"), 0)`).join(" + ")
      : "0";

  return sql.raw(`
    SELECT
      COUNT(*)::int AS row_count,
      (COALESCE(SUM(${textLenExpr}), 0) + COUNT(*) * ${tableDef.fixedBytesPerRow})::int AS estimated_bytes
    FROM "${tableDef.table}"
    WHERE "user_id" = '${userId}'
  `);
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
      const row = rows.rows[0] as { row_count: number; estimated_bytes: number } | undefined;

      const usageRow: UsageRow = {
        category: def.category,
        tableName: def.table,
        rowCount: row?.row_count ?? 0,
        estimatedBytes: row?.estimated_bytes ?? 0,
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
