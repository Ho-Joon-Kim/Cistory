/**
 * Phase 2 Case B: post-matcher pass that walks the day's `subway_trip_matches`
 * in time order and groups consecutive legs that look like one trip with a
 * transfer in between (e.g. 2호선 → 3호선 at 교대 with a 2-minute platform walk).
 *
 * Two legs join the same session iff:
 *   1. Time gap between leg-A end and leg-B start is < session.maxGapSeconds
 *   2. AND the end station of A and start station of B are the same physical
 *      interchange (within stationClusterRadiusMeters or sharing a normalized
 *      name — handles "시청"/"City Hall" cross-language pairs).
 *
 * Sessions get a fresh uuid, written here as `session_id` only. `leg_order`
 * is NOT touched by this pass: it is `matcher.ts`'s segment-local numbering
 * (0..n-1 within one `transportation_segment_id`), and `idx_stm_segment_leg`
 * is a unique index scoped to that same column pair. Renumbering `leg_order`
 * to a session-local position here used to collide with that index whenever
 * one segment's legs landed in two different sessions — both could resolve
 * to the same new position (e.g. both "leg 0 of their own session"), which
 * is a permanent collision on the index's *final* values, not just a
 * transient one a reordered UPDATE sequence could dodge. Session-local
 * ordering is instead derived at *read* time in `usage.ts` via
 * `ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY sub_start_time, ...)`.
 */

import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, subwayTripMatches } from "@/db";
import { distanceM } from "@/lib/geo";
import { logger } from "@/lib/logger";
import { endOfLocalDay, startOfLocalDay } from "@/lib/utils";
import { subwayMatchConfig as cfg } from "./config";

interface MatchRow {
  id: string;
  subStartTime: Date;
  subEndTime: Date;
  endStationId: string | null;
  startStationId: string | null;
}

interface StationCoord {
  id: string;
  lat: number;
  lon: number;
  nameNormalized: string;
}

function normalizeStationName(name: string | null): string {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*\([^()]*\)\s*$/u, "")
    .replace(/(역|駅|站)$/u, "")
    .trim();
}

async function loadStationCoords(stationIds: string[]): Promise<Map<string, StationCoord>> {
  const result = new Map<string, StationCoord>();
  if (stationIds.length === 0) return result;
  const db = getDb();
  // Build a Postgres array literal explicitly. Passing a JS array into
  // `ANY(${ids}::uuid[])` via drizzle's sql template would bind it as a single
  // text parameter, which then fails to cast when the array has exactly one
  // element ('uuid'::uuid[] is invalid; only '{uuid,...}'::uuid[] works).
  const arrayLiteral = `{${stationIds.join(",")}}`;
  const res = await db.execute(sql`
    SELECT id::text AS id,
           ST_Y(location) AS lat,
           ST_X(location) AS lon,
           name
    FROM subway_stations
    WHERE id = ANY(${arrayLiteral}::uuid[])
  `);
  for (const row of res.rows as unknown as Array<{
    id: string;
    lat: number | string;
    lon: number | string;
    name: string | null;
  }>) {
    result.set(row.id, {
      id: row.id,
      lat: Number(row.lat),
      lon: Number(row.lon),
      nameNormalized: normalizeStationName(row.name),
    });
  }
  return result;
}

function sameInterchange(a: StationCoord | undefined, b: StationCoord | undefined): boolean {
  if (!a || !b) return false;
  if (a.id === b.id) return true;
  if (a.nameNormalized && b.nameNormalized && a.nameNormalized === b.nameNormalized) {
    return true;
  }
  const dist = distanceM(a.lat, a.lon, b.lat, b.lon);
  return dist <= cfg.session.stationClusterRadiusMeters;
}

export interface GroupingSummary {
  matches: number;
  sessions: number;
  multiLegSessions: number;
}

export interface SessionAssignment {
  id: string;
  sessionId: string;
}

/**
 * Pure grouping decision for persisting session groups: map each match id to
 * the id of the fresh session its group was assigned. This never writes
 * `legOrder` — see the file header for why leg_order stays segment-local and
 * is never renumbered here. `session_id` carries no uniqueness constraint,
 * so there is no ordering hazard to manage: every id in `groups` gets
 * exactly one assignment, in any order. `newSessionId` is injected so the
 * sequence is deterministic in tests.
 */
export function planSessionAssignments(
  groups: { id: string }[][],
  newSessionId: () => string
): SessionAssignment[] {
  const assignments: SessionAssignment[] = [];

  for (const group of groups) {
    const sessionId = newSessionId();
    for (const row of group) {
      assignments.push({ id: row.id, sessionId });
    }
  }

  return assignments;
}

/** Group the day's matches into transfer sessions for one user. */
export async function groupMatchesIntoSessions(
  userId: string,
  dateStr: string
): Promise<GroupingSummary> {
  const db = getDb();
  const dayStart = startOfLocalDay(dateStr);
  const dayEnd = endOfLocalDay(dateStr);

  const rows = await db
    .select({
      id: subwayTripMatches.id,
      subStartTime: subwayTripMatches.subStartTime,
      subEndTime: subwayTripMatches.subEndTime,
      endStationId: subwayTripMatches.endStationId,
      startStationId: subwayTripMatches.startStationId,
    })
    .from(subwayTripMatches)
    .where(
      and(
        eq(subwayTripMatches.userId, userId),
        gte(subwayTripMatches.subStartTime, dayStart),
        lt(subwayTripMatches.subStartTime, dayEnd)
      )
    )
    .orderBy(asc(subwayTripMatches.subStartTime));

  if (rows.length === 0) {
    return { matches: 0, sessions: 0, multiLegSessions: 0 };
  }

  const stationIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.endStationId, r.startStationId])
        .filter((id): id is string => Boolean(id))
    )
  );
  const stations = await loadStationCoords(stationIds);

  // Walk in time order, splitting into sessions on threshold breach.
  const groups: MatchRow[][] = [];
  let current: MatchRow[] = [];
  for (const row of rows) {
    if (current.length === 0) {
      current.push(row);
      continue;
    }
    const prev = current[current.length - 1];
    const gapSeconds = (row.subStartTime.getTime() - prev.subEndTime.getTime()) / 1000;
    const transferOk =
      gapSeconds <= cfg.session.maxGapSeconds &&
      sameInterchange(
        prev.endStationId ? stations.get(prev.endStationId) : undefined,
        row.startStationId ? stations.get(row.startStationId) : undefined
      );
    if (transferOk) {
      current.push(row);
    } else {
      groups.push(current);
      current = [row];
    }
  }
  if (current.length > 0) groups.push(current);

  // Persist session_id only (leg_order is untouched — see file header).
  // Each group gets a fresh uuid via crypto.randomUUID().
  const multiLegSessions = groups.filter((group) => group.length > 1).length;
  await db.transaction(async (tx) => {
    for (const assignment of planSessionAssignments(groups, () => crypto.randomUUID())) {
      await tx
        .update(subwayTripMatches)
        .set({ sessionId: assignment.sessionId })
        .where(eq(subwayTripMatches.id, assignment.id));
    }
  });

  if (multiLegSessions > 0) {
    logger.info("subway session grouper detected transfers", {
      userId,
      dateStr,
      sessions: groups.length,
      multiLegSessions,
    });
  }

  return {
    matches: rows.length,
    sessions: groups.length,
    multiLegSessions,
  };
}
