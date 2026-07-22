import { type SQL, sql } from "drizzle-orm";
import {
  codingSessions,
  commits,
  locationHeatmapDaily,
  locationPoints,
  subwayLines,
  subwayTripMatches,
  tracks,
  transportationSegments,
  trips,
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
  subway: {
    tripCount: number;
    sessionCount: number;
    lines: { name: string; ref: string | null; tripCount: number }[];
  };
  trips: {
    name: string;
    startDate: string;
    endDate: string;
    isOverseas: boolean;
    visitedCities: string[];
    visitedCountries: string[];
  }[];
  visitedRegions: {
    city: string;
    countryName: string;
    centerLat: number;
    centerLon: number;
    firstVisitDate: string;
    isFirstVisit: boolean;
  }[];
  placeProductivity: {
    placeName: string;
    commitCount: number;
    codingSeconds: number;
    productivityScore: number;
  }[];
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

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
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

  const fromDate = toLocalDateString(range.from);
  const toDateExclusive = toLocalDateString(range.toExclusive);
  const [
    visitResult,
    trackResult,
    transportResult,
    subwayResult,
    tripResult,
    regionResult,
    productivityResult,
  ] = await Promise.all([
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
    executor.execute(sql`
      WITH matched AS (
        SELECT m.transportation_segment_id, m.session_id, m.line_id
        FROM ${subwayTripMatches} m
        WHERE m.user_id = ${range.userId}
          AND m.sub_start_time >= ${range.from}
          AND m.sub_start_time < ${range.toExclusive}
      ), totals AS (
        SELECT COUNT(DISTINCT transportation_segment_id)::int AS "totalTripCount",
          COUNT(DISTINCT COALESCE(session_id::text, transportation_segment_id::text))::int
            AS "totalSessionCount"
        FROM matched
      ), line_counts AS (
        SELECT line_id, COUNT(DISTINCT transportation_segment_id)::int AS "tripCount"
        FROM matched
        GROUP BY line_id
      )
      SELECT COALESCE(${subwayLines.name}, ${subwayLines.nameEn}, ${subwayLines.ref}, 'Unknown') AS name,
        ${subwayLines.ref} AS ref, lc."tripCount", totals."totalTripCount",
        totals."totalSessionCount"
      FROM line_counts lc
      JOIN ${subwayLines} ON ${subwayLines.id} = lc.line_id
      CROSS JOIN totals
      ORDER BY lc."tripCount" DESC, name ASC
      LIMIT 12
    `),
    executor.execute(sql`
      SELECT ${trips.name} AS name, ${trips.startDate} AS "startDate",
        ${trips.endDate} AS "endDate", ${trips.isOverseas} AS "isOverseas",
        ${trips.visitedCities} AS "visitedCities",
        ${trips.visitedCountries} AS "visitedCountries"
      FROM ${trips}
      WHERE ${trips.userId} = ${range.userId}
        AND ${trips.startDate} < ${toDateExclusive}
        AND ${trips.endDate} >= ${fromDate}
      ORDER BY ${trips.startDate} DESC
      LIMIT 20
    `),
    executor.execute(sql`
      WITH period_regions AS (
        SELECT ${visits.city} AS city, COALESCE(${visits.countryName}, '') AS "countryName",
          AVG(${visits.centerLat})::float8 AS "centerLat",
          AVG(${visits.centerLon})::float8 AS "centerLon",
          MIN(${visits.startTime}) AS "periodFirstVisit"
        FROM ${visits}
        WHERE ${visits.userId} = ${range.userId}
          AND ${visits.startTime} >= ${range.from}
          AND ${visits.startTime} < ${range.toExclusive}
          AND ${visits.city} IS NOT NULL
        GROUP BY ${visits.city}, COALESCE(${visits.countryName}, '')
      )
      SELECT pr.*, firsts."firstVisit",
        (firsts."firstVisit" >= ${range.from}) AS "isFirstVisit"
      FROM period_regions pr
      CROSS JOIN LATERAL (
        SELECT MIN(v2.start_time) AS "firstVisit"
        FROM visits v2
        WHERE v2.user_id = ${range.userId}
          AND v2.city = pr.city
          AND COALESCE(v2.country_name, '') = pr."countryName"
      ) firsts
      ORDER BY pr."periodFirstVisit", pr.city
      LIMIT 50
    `),
    executor.execute(sql`
      WITH top_places AS (
        SELECT COALESCE(${visits.placeName}, ${visits.city}, 'Unknown') AS "placeName",
          SUM(${visits.durationSeconds}) AS dwell
        FROM ${visits}
        WHERE ${visits.userId} = ${range.userId}
          AND ${visits.startTime} >= ${range.from}
          AND ${visits.startTime} < ${range.toExclusive}
        GROUP BY 1
        ORDER BY dwell DESC
        LIMIT 5
      ), commit_matches AS (
        SELECT tp."placeName", COUNT(DISTINCT ${commits.id})::int AS "commitCount"
        FROM top_places tp
        JOIN ${visits} v ON COALESCE(v.place_name, v.city, 'Unknown') = tp."placeName"
          AND v.user_id = ${range.userId}
          AND v.start_time >= ${range.from} AND v.start_time < ${range.toExclusive}
        JOIN ${commits} ON ${commits.userId} = ${range.userId}
          AND ${commits.committedAt} >= v.start_time AND ${commits.committedAt} < v.end_time
        GROUP BY tp."placeName"
      ), coding_matches AS (
        SELECT DISTINCT tp."placeName", ${codingSessions.id}, ${codingSessions.durationSeconds}
        FROM top_places tp
        JOIN ${visits} v ON COALESCE(v.place_name, v.city, 'Unknown') = tp."placeName"
          AND v.user_id = ${range.userId}
          AND v.start_time >= ${range.from} AND v.start_time < ${range.toExclusive}
        JOIN ${codingSessions} ON ${codingSessions.userId} = ${range.userId}
          AND ${codingSessions.startedAt} >= v.start_time AND ${codingSessions.startedAt} < v.end_time
      ), coding_totals AS (
        SELECT "placeName", SUM(duration_seconds)::int AS "codingSeconds"
        FROM coding_matches
        GROUP BY "placeName"
      )
      SELECT tp."placeName", COALESCE(cm."commitCount", 0)::int AS "commitCount",
        COALESCE(ct."codingSeconds", 0)::int AS "codingSeconds"
      FROM top_places tp
      LEFT JOIN commit_matches cm ON cm."placeName" = tp."placeName"
      LEFT JOIN coding_totals ct ON ct."placeName" = tp."placeName"
      ORDER BY (COALESCE(cm."commitCount", 0) * 10 + COALESCE(ct."codingSeconds", 0) / 720) DESC,
        tp."placeName"
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
  const subwayLinesResult = rowsFrom(subwayResult).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      name: String(row.name),
      ref: row.ref == null ? null : String(row.ref),
      tripCount: numberValue(row.tripCount),
      totalTripCount: numberValue(row.totalTripCount),
      totalSessionCount: numberValue(row.totalSessionCount),
    };
  });

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
    subway: {
      tripCount: subwayLinesResult[0]?.totalTripCount ?? 0,
      sessionCount: subwayLinesResult[0]?.totalSessionCount ?? 0,
      lines: subwayLinesResult.map((line) => ({
        name: line.name,
        ref: line.ref,
        tripCount: line.tripCount,
      })),
    },
    trips: rowsFrom(tripResult).map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        name: String(row.name),
        startDate: String(row.startDate),
        endDate: String(row.endDate),
        isOverseas: Boolean(row.isOverseas),
        visitedCities: stringArray(row.visitedCities),
        visitedCountries: stringArray(row.visitedCountries),
      };
    }),
    visitedRegions: rowsFrom(regionResult).map((raw) => {
      const row = raw as Record<string, unknown>;
      const firstVisit =
        row.firstVisit instanceof Date ? row.firstVisit : new Date(String(row.firstVisit));
      return {
        city: String(row.city),
        countryName: String(row.countryName),
        centerLat: numberValue(row.centerLat),
        centerLon: numberValue(row.centerLon),
        firstVisitDate: toLocalDateString(firstVisit),
        isFirstVisit: Boolean(row.isFirstVisit),
      };
    }),
    placeProductivity: rowsFrom(productivityResult).map((raw) => {
      const row = raw as Record<string, unknown>;
      const commitCount = numberValue(row.commitCount);
      const codingSeconds = numberValue(row.codingSeconds);
      return {
        placeName: String(row.placeName),
        commitCount,
        codingSeconds,
        productivityScore: Math.min(100, Math.round(commitCount * 10 + codingSeconds / 720)),
      };
    }),
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
