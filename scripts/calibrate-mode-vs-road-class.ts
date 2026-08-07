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

interface StatusDistributionRow {
  status: string;
  segments: number;
  centroidLat: number | null;
  centroidLon: number | null;
  [key: string]: unknown;
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

    const statusDistribution = await db.execute<StatusDistributionRow>(sql`
      WITH segment_centroids AS (
        SELECT
          ${segmentRouteMatches.id} AS match_id,
          ${segmentRouteMatches.matchStatus} AS status,
          avg(${locationPoints.lat}) AS centroid_lat,
          avg(${locationPoints.lon}) AS centroid_lon
        FROM ${segmentRouteMatches}
        INNER JOIN ${transportationSegments}
          ON ${transportationSegments.id} = ${segmentRouteMatches.segmentId}
        LEFT JOIN ${locationPoints}
          ON ${locationPoints.userId} = ${transportationSegments.userId}
          AND ${locationPoints.timestamp} >= ${transportationSegments.startTime}
          AND ${locationPoints.timestamp} <= ${transportationSegments.endTime}
        GROUP BY ${segmentRouteMatches.id}, ${segmentRouteMatches.matchStatus}
      )
      SELECT
        status,
        count(*)::integer AS segments,
        round(centroid_lat::numeric, 1)::double precision AS "centroidLat",
        round(centroid_lon::numeric, 1)::double precision AS "centroidLon"
      FROM segment_centroids
      GROUP BY
        status,
        round(centroid_lat::numeric, 1),
        round(centroid_lon::numeric, 1)
      ORDER BY status, segments DESC, "centroidLat", "centroidLon"
    `);
    printTable("4. Status distribution with approximate centroid", statusDistribution.rows);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
