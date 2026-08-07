import { and, asc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import {
  getDb,
  locationPoints,
  type MatchStatus,
  segmentRouteMatches,
  transportationSegments,
} from "@/db";
import {
  createValhallaAdapter,
  type MapMatchingAdapter,
  type MatchPoint,
  type MatchResult,
  type ValhallaCosting,
} from "@/lib/adapters/map-matching/valhalla";
import { toKstCalendarDate } from "@/lib/date-key";
import { logger } from "@/lib/logger";
import { extractsFingerprint } from "@/lib/map-extracts";
import { costingForMode } from "./costing";

export interface RouteMatchSummary {
  segmentsConsidered: number;
  matched: number;
  lowConfidence: number;
  noRoadMatch: number;
  failed: number;
  notApplicable: number;
  skipped: number;
}

interface RouteMatchSegment {
  id: string;
  userId: string;
  mode: string;
  startTime: Date;
  endTime: Date;
}

interface RouteMatchRow {
  userId: string;
  segmentId: string;
  matchStatus: MatchStatus;
  shape: MatchResult["shape"];
  roadNames: string[];
  roadClasses: string[];
  confidence: number | null;
  costing: ValhallaCosting | null;
  tileVersion: string;
  matchedAt: Date;
}

interface MatchRoutesForDayOptions {
  adapter?: MapMatchingAdapter;
  now?: Date;
}

type PointsLoader = (segment: RouteMatchSegment) => Promise<MatchPoint[]>;
type LocationDb = ReturnType<typeof getDb>;

let warnedAboutMissingValhallaUrl = false;

function emptySummary(): RouteMatchSummary {
  return {
    segmentsConsidered: 0,
    matched: 0,
    lowConfidence: 0,
    noRoadMatch: 0,
    failed: 0,
    notApplicable: 0,
    skipped: 0,
  };
}

function baseRow(
  segment: RouteMatchSegment,
  tileVersion: string,
  matchedAt: Date
): Omit<RouteMatchRow, "matchStatus"> {
  return {
    userId: segment.userId,
    segmentId: segment.id,
    shape: null,
    roadNames: [],
    roadClasses: [],
    confidence: null,
    costing: null,
    tileVersion,
    matchedAt,
  };
}

/**
 * Turns one segment into its persisted result without performing SQL.
 *
 * Point-loader failures are intentionally not caught: they are database failures, so the
 * caller must abort instead of replacing previously persisted rows with fabricated failures.
 * Adapter failures are isolated to this segment because route matching is best-effort.
 */
export async function buildRowForSegment(
  segment: RouteMatchSegment,
  loadPoints: PointsLoader,
  adapter: MapMatchingAdapter,
  tileVersion: string,
  matchedAt: Date
): Promise<RouteMatchRow | null> {
  const decision = costingForMode(segment.mode);
  if (decision.kind === "skip") return null;

  const base = baseRow(segment, tileVersion, matchedAt);
  if (decision.kind === "not_applicable") {
    return { ...base, matchStatus: "not_applicable" };
  }

  const points = await loadPoints(segment);
  if (points.length === 0) {
    return { ...base, matchStatus: "failed", costing: decision.costing };
  }

  try {
    const result = await adapter.match(points, decision.costing);
    return {
      ...base,
      matchStatus: result.status,
      shape: result.shape,
      roadNames: result.roadNames,
      roadClasses: result.roadClasses,
      confidence: result.confidence,
      costing: decision.costing,
    };
  } catch (error) {
    logger.warn("[RouteMatch] segment match failed", {
      segmentId: segment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...base, matchStatus: "failed", costing: decision.costing };
  }
}

export function summarizeRouteMatches(
  rows: ReadonlyArray<{ matchStatus: MatchStatus }>,
  segmentsConsidered: number
): RouteMatchSummary {
  const counts = new Map<MatchStatus, number>();
  for (const row of rows) {
    counts.set(row.matchStatus, (counts.get(row.matchStatus) ?? 0) + 1);
  }

  return {
    segmentsConsidered,
    matched: counts.get("matched") ?? 0,
    lowConfidence: counts.get("low_confidence") ?? 0,
    noRoadMatch: counts.get("no_road_match") ?? 0,
    failed: counts.get("failed") ?? 0,
    notApplicable: counts.get("not_applicable") ?? 0,
    skipped: segmentsConsidered - rows.length,
  };
}

/**
 * Produces the tile-version prefix from the match run's KST calendar date. The Valhalla tile
 * stamp is not mounted into the app container, so the run date is the available build-date
 * marker. Shift before ISO formatting instead of relying on the host process timezone; this
 * stays correct for scripts and tests that run outside the production container.
 */
export function currentTileVersion(now: Date): string {
  return `${toKstCalendarDate(now)}-${extractsFingerprint()}`;
}

async function loadDayPointsBySegment(
  db: LocationDb,
  userId: string,
  segments: RouteMatchSegment[]
): Promise<Map<string, MatchPoint[]>> {
  const segmentIds = segments
    .filter((segment) => costingForMode(segment.mode).kind === "match")
    .map((segment) => segment.id);
  const pointsBySegment = new Map<string, MatchPoint[]>(
    segmentIds.map((segmentId) => [segmentId, []])
  );
  if (segmentIds.length === 0) return pointsBySegment;

  const pointRows = await db
    .select({
      segmentId: transportationSegments.id,
      lat: locationPoints.lat,
      lon: locationPoints.lon,
      timestamp: locationPoints.timestamp,
    })
    .from(transportationSegments)
    .leftJoin(
      locationPoints,
      and(
        eq(locationPoints.userId, userId),
        gte(locationPoints.timestamp, transportationSegments.startTime),
        lt(locationPoints.timestamp, transportationSegments.endTime),
        or(isNull(locationPoints.accuracy), lte(locationPoints.accuracy, 200)),
        or(isNull(locationPoints.anomaly), eq(locationPoints.anomaly, false))
      )
    )
    .where(
      and(eq(transportationSegments.userId, userId), inArray(transportationSegments.id, segmentIds))
    )
    .orderBy(asc(transportationSegments.startTime), asc(locationPoints.timestamp));

  for (const row of pointRows) {
    if (row.lat === null || row.lon === null || row.timestamp === null) continue;
    pointsBySegment.get(row.segmentId)?.push({
      lat: row.lat,
      lon: row.lon,
      timestamp: row.timestamp,
    });
  }
  return pointsBySegment;
}

/** Match and atomically replace one user's segment-route rows for a KST date. */
export async function matchRoutesForDay(
  userId: string,
  date: string,
  options: MatchRoutesForDayOptions = {}
): Promise<RouteMatchSummary> {
  const baseUrl = process.env.VALHALLA_URL;
  const adapter = options.adapter ?? (baseUrl ? createValhallaAdapter(baseUrl) : null);
  if (!adapter) {
    if (!warnedAboutMissingValhallaUrl) {
      logger.warn("[RouteMatch] VALHALLA_URL is unset — skipping route matching");
      warnedAboutMissingValhallaUrl = true;
    }
    return emptySummary();
  }

  const db = getDb();
  const matchedAt = options.now ?? new Date();
  const tileVersion = currentTileVersion(matchedAt);
  const segments: RouteMatchSegment[] = await db
    .select({
      id: transportationSegments.id,
      userId: transportationSegments.userId,
      mode: transportationSegments.mode,
      startTime: transportationSegments.startTime,
      endTime: transportationSegments.endTime,
    })
    .from(transportationSegments)
    .where(and(eq(transportationSegments.userId, userId), eq(transportationSegments.date, date)))
    .orderBy(asc(transportationSegments.startTime));

  const pointsBySegment = await loadDayPointsBySegment(db, userId, segments);
  const loadPoints: PointsLoader = async (segment) => pointsBySegment.get(segment.id) ?? [];

  const rows: RouteMatchRow[] = [];
  for (const segment of segments) {
    const row = await buildRowForSegment(segment, loadPoints, adapter, tileVersion, matchedAt);
    if (row) rows.push(row);
  }

  const segmentIds = segments.map((segment) => segment.id);
  if (segmentIds.length > 0) {
    await db.transaction(async (tx) => {
      await tx
        .delete(segmentRouteMatches)
        .where(
          and(
            eq(segmentRouteMatches.userId, userId),
            inArray(segmentRouteMatches.segmentId, segmentIds)
          )
        );
      if (rows.length > 0) {
        await tx.insert(segmentRouteMatches).values(rows);
      }
    });
  }

  return summarizeRouteMatches(rows, segments.length);
}
