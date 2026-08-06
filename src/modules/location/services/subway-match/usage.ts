/**
 * Subway usage aggregation for monthly / yearly reports.
 *
 * Reads subway_trip_matches plus its joined subway_lines/stations and produces
 * a small summary object: total sessions, leg count, transfer count, distance,
 * top lines/stations.
 */

import { sql } from "drizzle-orm";
import { type Database, getDb } from "@/db";
import { resolveLineColor } from "@/lib/subway-color";

export interface SubwayUsageTopLine {
  lineId: string;
  ref: string | null;
  name: string | null;
  color: string;
  rideCount: number;
}

export interface SubwayUsageTopStation {
  stationName: string;
  count: number;
}

export interface SubwayUsageData {
  totalSessions: number;
  totalLegs: number;
  /** Number of transfer events (legs that aren't the first leg of their session). */
  transferCount: number;
  /** Approximate total subway distance in meters. */
  totalDistanceMeters: number;
  topLines: SubwayUsageTopLine[];
  /** Most-touched stations (counts each leg's start + end). */
  topStations: SubwayUsageTopStation[];
  /** Stations that are the link point in multi-leg sessions. */
  topTransferStations: SubwayUsageTopStation[];
}

interface AggRow {
  total_sessions: number | string;
  total_legs: number | string;
  transfer_count: number | string;
  total_distance: number | string | null;
}

interface LineRow {
  line_id: string;
  ref: string | null;
  name: string | null;
  colour: string | null;
  network: string | null;
  fallback_idx: number | string;
  ride_count: number | string;
}

interface StationRow {
  name: string;
  count: number | string;
}

export interface SubwayLineFrequency {
  lineId: string;
  ref: string | null;
  name: string | null;
  color: string;
  rideCount: number;
  totalDistanceMeters: number;
}

export interface SubwayTransferPair {
  fromLineRef: string | null;
  fromLineName: string | null;
  fromLineColor: string;
  toLineRef: string | null;
  toLineName: string | null;
  toLineColor: string;
  stationName: string;
  count: number;
}

export interface SubwayInsightsData {
  totalSessions: number;
  totalLegs: number;
  lineFrequency: SubwayLineFrequency[];
  transferPairs: SubwayTransferPair[];
}

interface InsightLineRow {
  line_id: string;
  ref: string | null;
  name: string | null;
  colour: string | null;
  network: string | null;
  fallback_idx: number | string;
  ride_count: number | string;
  total_distance: number | string | null;
}

interface TransferPairRow {
  from_ref: string | null;
  from_name: string | null;
  from_colour: string | null;
  from_network: string | null;
  from_fb: number | string;
  to_ref: string | null;
  to_name: string | null;
  to_colour: string | null;
  to_network: string | null;
  to_fb: number | string;
  station_name: string | null;
  pair_count: number | string;
}

interface InsightAggRow {
  total_sessions: number | string;
  total_legs: number | string;
}

export async function getSubwayInsights(
  userId: string,
  fromDate: Date,
  toExclusiveDate: Date,
  executor?: Database
): Promise<SubwayInsightsData> {
  const db = executor ?? getDb();

  const aggRes = await db.execute(sql`
    SELECT
      count(DISTINCT m.session_id)::int AS total_sessions,
      count(*)::int                     AS total_legs
    FROM subway_trip_matches m
    WHERE m.user_id = ${userId}::uuid
      AND m.sub_start_time >= ${fromDate}
      AND m.sub_start_time < ${toExclusiveDate}
  `);
  const agg = (aggRes.rows[0] ?? null) as unknown as InsightAggRow | null;

  const lineRes = await db.execute(sql`
    WITH numbered_lines AS (
      SELECT id, system_id, name, ref, colour, network,
             CASE WHEN colour IS NULL
                  THEN (ROW_NUMBER() OVER (PARTITION BY system_id, (colour IS NULL)
                                            ORDER BY ref, name, id) - 1)
                  ELSE 0 END AS fallback_idx
      FROM subway_lines
    )
    SELECT
      l.id::text     AS line_id,
      l.ref          AS ref,
      l.name         AS name,
      l.colour       AS colour,
      l.network      AS network,
      l.fallback_idx AS fallback_idx,
      count(*)::int  AS ride_count,
      sum(
        extract(epoch FROM (m.sub_end_time - m.sub_start_time)) /
        NULLIF(extract(epoch FROM (s.end_time - s.start_time)), 0) * s.distance_meters
      ) AS total_distance
    FROM subway_trip_matches m
    JOIN numbered_lines l ON l.id = m.line_id
    JOIN transportation_segments s ON s.id = m.transportation_segment_id
    WHERE m.user_id = ${userId}::uuid
      AND m.sub_start_time >= ${fromDate}
      AND m.sub_start_time < ${toExclusiveDate}
    GROUP BY l.id, l.ref, l.name, l.colour, l.network, l.fallback_idx
    ORDER BY ride_count DESC
    LIMIT 12
  `);

  // Transfer pairs: for each session, walk consecutive legs.
  //
  // `leg_order` on subway_trip_matches is segment-local (matcher.ts), not
  // session-local — the grouper never renumbers it (see session-grouper.ts's
  // file header for why: renumbering it collided with idx_stm_segment_leg).
  // So session-local adjacency has to be derived here at read time, ranking
  // each session's legs by time.
  //
  // Ties: two legs in one session can share a sub_start_time exactly (GPS
  // timestamps only carry second resolution and a transfer's next leg can
  // start on the same wall-clock second the previous one ends). An
  // unstable/arbitrary tie order would let ROW_NUMBER flip which leg ranks
  // first on repeated runs, silently swapping which line pairs with which
  // in the join below. Break ties with sub_end_time, then id, for a fully
  // deterministic order.
  //
  // Null session_id: a match that was never grouped into a session (or lost
  // its grouping — the exact bug this file's fix addresses) has no known
  // neighbor. `COALESCE(m.session_id, m.id)` puts each such row in its own
  // singleton partition, so it always ranks as leg 1 of "its own session"
  // (never a transfer, per the transfer_count query below) and — because
  // its partition key can't equal any other row's — can never be paired as
  // adjacent to anything here either. Plain `PARTITION BY session_id` would
  // instead lump every unsessioned row of every day into one NULL
  // partition and rank them against each other by time, pairing up
  // completely unrelated trips.
  const pairsRes = await db.execute(sql`
    WITH numbered_lines AS (
      SELECT id, system_id, name, ref, colour, network,
             CASE WHEN colour IS NULL
                  THEN (ROW_NUMBER() OVER (PARTITION BY system_id, (colour IS NULL)
                                            ORDER BY ref, name, id) - 1)
                  ELSE 0 END AS fallback_idx
      FROM subway_lines
    ),
    numbered_matches AS (
      SELECT m.*,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(m.session_id, m.id)
               ORDER BY m.sub_start_time, m.sub_end_time, m.id
             ) AS leg_rn
      FROM subway_trip_matches m
      WHERE m.user_id = ${userId}::uuid
        AND m.sub_start_time >= ${fromDate}
        AND m.sub_start_time < ${toExclusiveDate}
    )
    SELECT
      l1.ref AS from_ref, l1.name AS from_name, l1.colour AS from_colour,
      l1.network AS from_network, l1.fallback_idx AS from_fb,
      l2.ref AS to_ref, l2.name AS to_name, l2.colour AS to_colour,
      l2.network AS to_network, l2.fallback_idx AS to_fb,
      st.name AS station_name,
      count(*)::int AS pair_count
    FROM numbered_matches m1
    JOIN numbered_matches m2
      -- Equality never matches when either side is NULL, so this already
      -- excludes unsessioned rows on its own; the COALESCE above is what
      -- keeps their leg_rn from being computed against unrelated rows.
      ON m2.session_id = m1.session_id
     AND m2.leg_rn = m1.leg_rn + 1
    JOIN numbered_lines l1 ON l1.id = m1.line_id
    JOIN numbered_lines l2 ON l2.id = m2.line_id
    LEFT JOIN subway_stations st ON st.id = m1.end_station_id
    WHERE st.name IS NOT NULL
    GROUP BY l1.ref, l1.name, l1.colour, l1.network, l1.fallback_idx,
             l2.ref, l2.name, l2.colour, l2.network, l2.fallback_idx,
             st.name
    ORDER BY pair_count DESC
    LIMIT 8
  `);

  return {
    totalSessions: Number(agg?.total_sessions ?? 0),
    totalLegs: Number(agg?.total_legs ?? 0),
    lineFrequency: (lineRes.rows as unknown as InsightLineRow[]).map((r) => ({
      lineId: r.line_id,
      ref: r.ref,
      name: r.name,
      color: resolveLineColor({
        colour: r.colour,
        network: r.network,
        ref: r.ref,
        name: r.name,
        fallbackIndex: Number(r.fallback_idx) || 0,
      }),
      rideCount: Number(r.ride_count),
      totalDistanceMeters: Math.round(Number(r.total_distance ?? 0)),
    })),
    transferPairs: (pairsRes.rows as unknown as TransferPairRow[]).map((r) => ({
      fromLineRef: r.from_ref,
      fromLineName: r.from_name,
      fromLineColor: resolveLineColor({
        colour: r.from_colour,
        network: r.from_network,
        ref: r.from_ref,
        name: r.from_name,
        fallbackIndex: Number(r.from_fb) || 0,
      }),
      toLineRef: r.to_ref,
      toLineName: r.to_name,
      toLineColor: resolveLineColor({
        colour: r.to_colour,
        network: r.to_network,
        ref: r.to_ref,
        name: r.to_name,
        fallbackIndex: Number(r.to_fb) || 0,
      }),
      stationName: r.station_name ?? "",
      count: Number(r.pair_count),
    })),
  };
}

export async function getSubwayUsage(
  userId: string,
  fromDate: Date,
  toExclusiveDate: Date
): Promise<SubwayUsageData> {
  const db = getDb();

  // transfer_count = "not the first leg of its session", derived from time
  // order rather than the stored (segment-local) leg_order — see the
  // pairsRes query in getSubwayInsights above for the full tie-breaking and
  // null-session_id reasoning, which applies identically here.
  const aggRes = await db.execute(sql`
    WITH numbered_matches AS (
      SELECT m.*,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(m.session_id, m.id)
               ORDER BY m.sub_start_time, m.sub_end_time, m.id
             ) AS leg_rn
      FROM subway_trip_matches m
      WHERE m.user_id = ${userId}::uuid
        AND m.sub_start_time >= ${fromDate}
        AND m.sub_start_time < ${toExclusiveDate}
    )
    SELECT
      count(DISTINCT m.session_id)::int                                AS total_sessions,
      count(*)::int                                                    AS total_legs,
      count(*) FILTER (WHERE m.leg_rn > 1)::int                       AS transfer_count,
      sum(
        extract(epoch FROM (m.sub_end_time - m.sub_start_time)) /
        NULLIF(extract(epoch FROM (s.end_time - s.start_time)), 0) * s.distance_meters
      ) AS total_distance
    FROM numbered_matches m
    JOIN transportation_segments s ON s.id = m.transportation_segment_id
  `);
  const agg = (aggRes.rows[0] ?? null) as unknown as AggRow | null;

  const linesRes = await db.execute(sql`
    WITH numbered_lines AS (
      SELECT id, system_id, name, name_en, ref, colour, network,
             CASE WHEN colour IS NULL
                  THEN (ROW_NUMBER() OVER (PARTITION BY system_id, (colour IS NULL)
                                            ORDER BY ref, name, id) - 1)
                  ELSE 0 END AS fallback_idx
      FROM subway_lines
    )
    SELECT
      l.id::text   AS line_id,
      l.ref        AS ref,
      l.name       AS name,
      l.colour     AS colour,
      l.network    AS network,
      l.fallback_idx AS fallback_idx,
      count(*)::int AS ride_count
    FROM subway_trip_matches m
    JOIN numbered_lines l ON l.id = m.line_id
    WHERE m.user_id = ${userId}::uuid
      AND m.sub_start_time >= ${fromDate}
      AND m.sub_start_time < ${toExclusiveDate}
    GROUP BY l.id, l.ref, l.name, l.colour, l.network, l.fallback_idx
    ORDER BY ride_count DESC
    LIMIT 3
  `);

  const stationsRes = await db.execute(sql`
    WITH legs AS (
      SELECT m.id, m.start_station_id, m.end_station_id
      FROM subway_trip_matches m
      WHERE m.user_id = ${userId}::uuid
        AND m.sub_start_time >= ${fromDate}
        AND m.sub_start_time < ${toExclusiveDate}
    ),
    visited AS (
      SELECT start_station_id AS sid FROM legs WHERE start_station_id IS NOT NULL
      UNION ALL
      SELECT end_station_id FROM legs WHERE end_station_id IS NOT NULL
    )
    SELECT s.name AS name, count(*)::int AS count
    FROM visited v JOIN subway_stations s ON s.id = v.sid
    WHERE s.name IS NOT NULL
    GROUP BY s.name
    ORDER BY count DESC
    LIMIT 5
  `);

  // Transfer stations: end-station of leg N matches start-station of leg N+1
  // within the same session (or the cluster radius — we already used the same
  // station id during grouping, so id-equality is sufficient at this point).
  // Session-local adjacency derived from time order — see the pairsRes query
  // in getSubwayInsights above for the tie-breaking and null-session_id
  // reasoning, which applies identically here.
  const transferRes = await db.execute(sql`
    WITH numbered_matches AS (
      SELECT m.*,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(m.session_id, m.id)
               ORDER BY m.sub_start_time, m.sub_end_time, m.id
             ) AS leg_rn
      FROM subway_trip_matches m
      WHERE m.user_id = ${userId}::uuid
        AND m.sub_start_time >= ${fromDate}
        AND m.sub_start_time < ${toExclusiveDate}
    )
    SELECT s.name AS name, count(*)::int AS count
    FROM numbered_matches m1
    JOIN numbered_matches m2
      ON m2.session_id = m1.session_id
     AND m2.leg_rn = m1.leg_rn + 1
    JOIN subway_stations s ON s.id = m1.end_station_id
    WHERE s.name IS NOT NULL
    GROUP BY s.name
    ORDER BY count DESC
    LIMIT 5
  `);

  return {
    totalSessions: Number(agg?.total_sessions ?? 0),
    totalLegs: Number(agg?.total_legs ?? 0),
    transferCount: Number(agg?.transfer_count ?? 0),
    totalDistanceMeters: Math.round(Number(agg?.total_distance ?? 0)),
    topLines: (linesRes.rows as unknown as LineRow[]).map((r) => ({
      lineId: r.line_id,
      ref: r.ref,
      name: r.name,
      color: resolveLineColor({
        colour: r.colour,
        network: r.network,
        ref: r.ref,
        name: r.name,
        fallbackIndex: Number(r.fallback_idx) || 0,
      }),
      rideCount: Number(r.ride_count),
    })),
    topStations: (stationsRes.rows as unknown as StationRow[]).map((r) => ({
      stationName: r.name,
      count: Number(r.count),
    })),
    topTransferStations: (transferRes.rows as unknown as StationRow[]).map((r) => ({
      stationName: r.name,
      count: Number(r.count),
    })),
  };
}
