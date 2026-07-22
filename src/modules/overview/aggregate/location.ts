import { type SQL, sql } from "drizzle-orm";
import {
  locationHeatmapDaily,
  locationPoints,
  tracks,
  transportationSegments,
  visits,
} from "@/db/schema";
import { localDaySql } from "@/db/sql";
import { toLocalDateString } from "@/lib/utils";

export interface LocationReadExecutor {
  execute(query: SQL): Promise<unknown>;
}

export interface LocationQueryExecutor extends LocationReadExecutor {
  transaction<T>(callback: (tx: LocationReadExecutor) => Promise<T>): Promise<T>;
}

export interface LocationPeriodRange {
  userId: string;
  from: Date;
  toExclusive: Date;
}

export interface LocationPlaceAggregate {
  placeName: string;
  centerLat: number;
  centerLon: number;
  visitCount: number;
  durationSeconds: number;
}

export interface LocationTransportModeAggregate {
  mode: string;
  segmentCount: number;
  distanceMeters: number;
  durationSeconds: number;
  sharePercent: number;
}

export interface DerivedLocationAggregate {
  visits: {
    count: number;
    durationSeconds: number;
    uniquePlaceCount: number;
    places: LocationPlaceAggregate[];
  };
  tracks: {
    count: number;
    distanceMeters: number;
    durationSeconds: number;
  };
  transportModes: LocationTransportModeAggregate[];
}

export interface LocationHeatmapPoint {
  lat: number;
  lon: number;
  weight: number;
}

type QueryRows = { rows: unknown[] };

function rowsFrom(result: unknown): unknown[] {
  if (!result || typeof result !== "object" || !("rows" in result)) return [];
  const rows = (result as QueryRows).rows;
  return Array.isArray(rows) ? rows : [];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertRange({ from, toExclusive }: LocationPeriodRange) {
  if (from >= toExclusive) {
    throw new Error("Location period range must end after it starts");
  }
}

function assertLocalDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid local date: ${date}`);

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid local date: ${date}`);
  }
}

/**
 * Aggregates location metrics exclusively from the location pipeline's derived
 * tables. Visits are assigned by start time, so a visit crossing midnight is
 * counted exactly once in the period containing its KST-derived boundary.
 */
export async function aggregateDerivedLocation(
  executor: LocationReadExecutor,
  range: LocationPeriodRange
): Promise<DerivedLocationAggregate> {
  assertRange(range);

  const [visitResult, trackResult, transportResult] = await Promise.all([
    executor.execute(sql`
      SELECT
        COALESCE(
          ${visits.placeName},
          CONCAT(
            ROUND(${visits.centerLat}::numeric, 3),
            ', ',
            ROUND(${visits.centerLon}::numeric, 3)
          )
        ) AS "placeName",
        AVG(${visits.centerLat})::float8 AS "centerLat",
        AVG(${visits.centerLon})::float8 AS "centerLon",
        COUNT(*)::int AS "visitCount",
        COALESCE(SUM(${visits.durationSeconds}), 0)::int AS "durationSeconds"
      FROM ${visits}
      WHERE ${visits.userId} = ${range.userId}
        AND ${visits.startTime} >= ${range.from}
        AND ${visits.startTime} < ${range.toExclusive}
      GROUP BY 1
      ORDER BY "durationSeconds" DESC, "placeName" ASC
    `),
    executor.execute(sql`
      SELECT
        COUNT(*)::int AS "trackCount",
        COALESCE(SUM(${tracks.distanceMeters}), 0)::float8 AS "distanceMeters",
        COALESCE(SUM(${tracks.durationSeconds}), 0)::int AS "durationSeconds"
      FROM ${tracks}
      WHERE ${tracks.userId} = ${range.userId}
        AND ${tracks.startTime} >= ${range.from}
        AND ${tracks.startTime} < ${range.toExclusive}
    `),
    executor.execute(sql`
      SELECT
        COALESCE(NULLIF(TRIM(${transportationSegments.mode}), ''), 'unknown') AS mode,
        COUNT(*)::int AS "segmentCount",
        COALESCE(SUM(${transportationSegments.distanceMeters}), 0)::float8 AS "distanceMeters",
        COALESCE(SUM(${transportationSegments.durationSeconds}), 0)::int AS "durationSeconds"
      FROM ${transportationSegments}
      WHERE ${transportationSegments.userId} = ${range.userId}
        AND ${transportationSegments.startTime} >= ${range.from}
        AND ${transportationSegments.startTime} < ${range.toExclusive}
        AND ${transportationSegments.mode} <> 'stationary'
      GROUP BY 1
      ORDER BY "distanceMeters" DESC, mode ASC
    `),
  ]);

  const places = rowsFrom(visitResult).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      placeName: String(row.placeName),
      centerLat: numberValue(row.centerLat),
      centerLon: numberValue(row.centerLon),
      visitCount: numberValue(row.visitCount),
      durationSeconds: numberValue(row.durationSeconds),
    };
  });
  const visitCount = places.reduce((sum, place) => sum + place.visitCount, 0);
  const visitDuration = places.reduce((sum, place) => sum + place.durationSeconds, 0);

  const trackRow = rowsFrom(trackResult)[0] as Record<string, unknown> | undefined;
  const rawModes = rowsFrom(transportResult).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      mode: String(row.mode || "unknown"),
      segmentCount: numberValue(row.segmentCount),
      distanceMeters: numberValue(row.distanceMeters),
      durationSeconds: numberValue(row.durationSeconds),
    };
  });
  const totalDistance = rawModes.reduce((sum, mode) => sum + mode.distanceMeters, 0);
  const totalDuration = rawModes.reduce((sum, mode) => sum + mode.durationSeconds, 0);
  const shareBasis =
    totalDistance > 0 ? "distanceMeters" : totalDuration > 0 ? "durationSeconds" : "segmentCount";
  const shareTotal = rawModes.reduce((sum, mode) => sum + mode[shareBasis], 0);

  return {
    visits: {
      count: visitCount,
      durationSeconds: visitDuration,
      uniquePlaceCount: places.length,
      places,
    },
    tracks: {
      count: numberValue(trackRow?.trackCount),
      distanceMeters: numberValue(trackRow?.distanceMeters),
      durationSeconds: numberValue(trackRow?.durationSeconds),
    },
    transportModes: rawModes.map((mode) => ({
      ...mode,
      sharePercent: shareTotal > 0 ? (mode[shareBasis] / shareTotal) * 100 : 0,
    })),
  };
}

/** Aggregates a period from daily rollups. This query cannot access raw points. */
export async function aggregatePeriodHeatmap(
  executor: LocationReadExecutor,
  range: LocationPeriodRange
): Promise<LocationHeatmapPoint[]> {
  assertRange(range);
  const fromDate = toLocalDateString(range.from);
  const toDateExclusive = toLocalDateString(range.toExclusive);
  const result = await executor.execute(sql`
    SELECT
      ${locationHeatmapDaily.lat} AS lat,
      ${locationHeatmapDaily.lon} AS lon,
      SUM(${locationHeatmapDaily.count})::int AS weight
    FROM ${locationHeatmapDaily}
    WHERE ${locationHeatmapDaily.userId} = ${range.userId}
      AND ${locationHeatmapDaily.date} >= ${fromDate}
      AND ${locationHeatmapDaily.date} < ${toDateExclusive}
    GROUP BY ${locationHeatmapDaily.lat}, ${locationHeatmapDaily.lon}
    ORDER BY weight DESC, lat ASC, lon ASC
  `);

  return rowsFrom(result).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      lat: numberValue(row.lat),
      lon: numberValue(row.lon),
      weight: numberValue(row.weight),
    };
  });
}

/**
 * Replaces one processed KST day's heatmap in a transaction. Raw points are
 * intentionally confined to this pipeline-facing daily rollup function.
 */
export async function rebuildDailyLocationHeatmap(
  executor: LocationQueryExecutor,
  userId: string,
  date: string,
  calculatedAt = new Date()
): Promise<void> {
  assertLocalDate(date);

  await executor.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM ${locationHeatmapDaily}
      WHERE ${locationHeatmapDaily.userId} = ${userId}
        AND ${locationHeatmapDaily.date} = ${date}
    `);
    await tx.execute(sql`
      INSERT INTO ${locationHeatmapDaily} (
        ${locationHeatmapDaily.userId},
        ${locationHeatmapDaily.date},
        ${locationHeatmapDaily.lat},
        ${locationHeatmapDaily.lon},
        ${locationHeatmapDaily.count},
        ${locationHeatmapDaily.calculatedAt}
      )
      SELECT
        ${userId},
        ${date},
        ROUND(${locationPoints.lat}::numeric, 3)::float8,
        ROUND(${locationPoints.lon}::numeric, 3)::float8,
        COUNT(*)::int,
        ${calculatedAt}
      FROM ${locationPoints}
      WHERE ${locationPoints.userId} = ${userId}
        AND ${localDaySql(locationPoints.timestamp)} = ${date}::date
      GROUP BY
        ROUND(${locationPoints.lat}::numeric, 3),
        ROUND(${locationPoints.lon}::numeric, 3)
    `);
  });
}
