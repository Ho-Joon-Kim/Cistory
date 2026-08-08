/**
 * Compare detected transportation modes with Valhalla road-match results.
 *
 * Usage:
 *   npx tsx scripts/calibrate-mode-vs-road-class.ts
 *
 * This script is deliberately read-only. It prints evidence for manually deciding whether
 * road class or match confidence should influence transportation classification; it never
 * changes classifier configuration or database rows.
 */

import { config as loadEnv } from "dotenv";
import { sql } from "drizzle-orm";

loadEnv({ path: ".env.local" });

import {
  getDb,
  getPool,
  locationPoints,
  segmentRouteMatches,
  transportationSegments,
} from "../src/db";
import { coveringExtract } from "../src/lib/map-extracts";

interface ModeRoadClassRow {
  mode: string;
  roadClass: string;
  samples: number;
  [key: string]: unknown;
}

interface SpeedDistributionRow extends ModeRoadClassRow {
  avgSpeedMeanKmh: number;
  avgSpeedMedianKmh: number;
  avgSpeedMaxKmh: number;
  maxSpeedMeanKmh: number;
  maxSpeedMedianKmh: number;
  maxSpeedMaxKmh: number;
}

interface ConfidenceDecileRow {
  decile: number;
  samples: number;
  minConfidence: number;
  meanConfidence: number;
  maxConfidence: number;
  [key: string]: unknown;
}

interface SegmentCentroidRow {
  status: string;
  centroidLat: number | null;
  centroidLon: number | null;
  [key: string]: unknown;
}

interface StatusRegionRow {
  status: string;
  region: string;
  segments: number;
  [key: string]: unknown;
}

// The only row that means "we're missing an OSM extract for this area" — always printed,
// even at zero, so a clean result reads as an answer rather than as a missing row.
const OUTSIDE_EVERY_EXTRACT = "outside every extract";
// A segment's centroid is the average of its location points; a segment with none of its own
// points on record (rare, but possible) has no coordinate to place on the map at all. Surfacing
// it as its own bucket keeps the per-status total honest instead of silently dropping rows.
const NO_COORDINATE = "no coordinate";

function regionFor(lat: number | null, lon: number | null): string {
  if (lat === null || lon === null) return NO_COORDINATE;
  return coveringExtract(lat, lon) ?? OUTSIDE_EVERY_EXTRACT;
}

function printTable(title: string, rows: unknown[]): void {
  console.log(`\n${title}`);
  console.table(rows);
}

async function main(): Promise<void> {
  // Resolve the pool before entering the try/finally so a missing DATABASE_URL does not create
  // a second error while attempting to close a pool that was never opened.
  const pool = getPool();

  try {
    const db = getDb();

    const modeRoadClass = await db.execute<ModeRoadClassRow>(sql`
      WITH matched_segments AS (
        SELECT
          ${transportationSegments.mode} AS mode,
          CASE
            WHEN jsonb_typeof(${segmentRouteMatches.roadClasses}) = 'array'
              THEN ${segmentRouteMatches.roadClasses} ->> 0
            ELSE NULL
          END AS road_class
        FROM ${segmentRouteMatches}
        INNER JOIN ${transportationSegments}
          ON ${transportationSegments.id} = ${segmentRouteMatches.segmentId}
      )
      SELECT
        mode,
        road_class AS "roadClass",
        count(*)::integer AS samples
      FROM matched_segments
      WHERE road_class IS NOT NULL
      GROUP BY mode, road_class
      ORDER BY mode, samples DESC, road_class
    `);
    printTable("1. Mode × representative road class", modeRoadClass.rows);

    const speedDistribution = await db.execute<SpeedDistributionRow>(sql`
      WITH matched_segments AS (
        SELECT
          ${transportationSegments.mode} AS mode,
          CASE
            WHEN jsonb_typeof(${segmentRouteMatches.roadClasses}) = 'array'
              THEN ${segmentRouteMatches.roadClasses} ->> 0
            ELSE NULL
          END AS road_class,
          ${transportationSegments.avgSpeedKmh} AS avg_speed_kmh,
          ${transportationSegments.maxSpeedKmh} AS max_speed_kmh
        FROM ${segmentRouteMatches}
        INNER JOIN ${transportationSegments}
          ON ${transportationSegments.id} = ${segmentRouteMatches.segmentId}
      )
      SELECT
        mode,
        road_class AS "roadClass",
        count(*)::integer AS samples,
        round(avg(avg_speed_kmh)::numeric, 2)::double precision AS "avgSpeedMeanKmh",
        round(
          percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_speed_kmh)::numeric,
          2
        )::double precision AS "avgSpeedMedianKmh",
        round(max(avg_speed_kmh)::numeric, 2)::double precision AS "avgSpeedMaxKmh",
        round(avg(max_speed_kmh)::numeric, 2)::double precision AS "maxSpeedMeanKmh",
        round(
          percentile_cont(0.5) WITHIN GROUP (ORDER BY max_speed_kmh)::numeric,
          2
        )::double precision AS "maxSpeedMedianKmh",
        round(max(max_speed_kmh)::numeric, 2)::double precision AS "maxSpeedMaxKmh"
      FROM matched_segments
      WHERE road_class IS NOT NULL
        AND avg_speed_kmh IS NOT NULL
        AND max_speed_kmh IS NOT NULL
      GROUP BY mode, road_class
      HAVING count(*) >= 3
      ORDER BY mode, samples DESC, road_class
    `);
    printTable(
      "2. Speed distribution by mode × road class (minimum 3 samples)",
      speedDistribution.rows
    );

    const confidenceDeciles = await db.execute<ConfidenceDecileRow>(sql`
      WITH ranked AS (
        SELECT
          ${segmentRouteMatches.confidence} AS confidence,
          ntile(10) OVER (ORDER BY ${segmentRouteMatches.confidence}) AS decile
        FROM ${segmentRouteMatches}
        WHERE ${segmentRouteMatches.confidence} IS NOT NULL
      )
      SELECT
        decile,
        count(*)::integer AS samples,
        round(min(confidence)::numeric, 3)::double precision AS "minConfidence",
        round(avg(confidence)::numeric, 3)::double precision AS "meanConfidence",
        round(max(confidence)::numeric, 3)::double precision AS "maxConfidence"
      FROM ranked
      GROUP BY decile
      ORDER BY decile
    `);
    printTable("3. Confidence deciles", confidenceDeciles.rows);

    // One row per segment-match: its status and its centroid (the average of that segment's own
    // location points, NULL when it has none). Deliberately ungrouped by coordinate here — with
    // 0.1°-grid grouping this table used to emit ~300 rows, nearly all `segments = 1`, because a
    // grid cell is the wrong unit for the question it exists to answer ("are these off the road
    // network, or are we just missing an OSM extract for this area?"). Rolling up to "which
    // extract covers this point" instead answers that directly, so the grouping happens in JS
    // via `coveringExtract` rather than in SQL.
    const segmentCentroids = await db.execute<SegmentCentroidRow>(sql`
      SELECT
        ${segmentRouteMatches.matchStatus} AS status,
        avg(${locationPoints.lat}) AS "centroidLat",
        avg(${locationPoints.lon}) AS "centroidLon"
      FROM ${segmentRouteMatches}
      INNER JOIN ${transportationSegments}
        ON ${transportationSegments.id} = ${segmentRouteMatches.segmentId}
      LEFT JOIN ${locationPoints}
        ON ${locationPoints.userId} = ${transportationSegments.userId}
        AND ${locationPoints.timestamp} >= ${transportationSegments.startTime}
        AND ${locationPoints.timestamp} <= ${transportationSegments.endTime}
      GROUP BY ${segmentRouteMatches.id}, ${segmentRouteMatches.matchStatus}
    `);

    const regionCounts = new Map<string, Map<string, number>>();
    for (const row of segmentCentroids.rows) {
      const region = regionFor(row.centroidLat, row.centroidLon);
      const byRegion = regionCounts.get(row.status) ?? new Map<string, number>();
      byRegion.set(region, (byRegion.get(region) ?? 0) + 1);
      regionCounts.set(row.status, byRegion);
    }

    const statusRegionRows: StatusRegionRow[] = [];
    for (const [status, byRegion] of regionCounts) {
      if (!byRegion.has(OUTSIDE_EVERY_EXTRACT)) {
        byRegion.set(OUTSIDE_EVERY_EXTRACT, 0);
      }
      for (const [region, segments] of byRegion) {
        statusRegionRows.push({ status, region, segments });
      }
    }
    statusRegionRows.sort((a, b) => {
      if (a.status !== b.status) return a.status < b.status ? -1 : 1;
      if (a.segments !== b.segments) return b.segments - a.segments;
      return a.region < b.region ? -1 : a.region > b.region ? 1 : 0;
    });
    printTable("4. Status × OSM extract coverage (where no_road_match clusters)", statusRegionRows);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
