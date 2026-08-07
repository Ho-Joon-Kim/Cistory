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
  ValhallaUnreachableError,
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
  tooShort: number;
  failed: number;
  notApplicable: number;
  skipped: number;
  /**
   * True when Valhalla was unreachable partway through this day and the run gave up without
   * writing anything — not even for segments that matched earlier in this same call. Every other
   * count is zero in that case. Without this flag an aborted day and a day with nothing to do
   * both come back as an all-zero summary, and callers (the nightly cron hook, the backfill
   * script) need to tell those apart: one is fine to ignore, the other means the engine is down.
   * `segmentsConsidered` still reports how many segments were queued, so a log line can say how
   * much work was abandoned.
   */
  aborted: boolean;
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

/**
 * Minimum GPS points a segment needs before it is worth sending to Valhalla. A full backfill
 * measured this directly rather than guessing it, counted with the exact predicate
 * `loadDayPointsBySegment` below applies (accuracy ≤200 or null, anomaly filtered out, half-open
 * `[startTime, endTime)` window) — an unfiltered point count reads higher and understates how
 * sharp the boundary really is. Under that predicate, segments with exactly 1 point matched
 * 0/286 times (a single point cannot define a path), while segments with exactly 2 points
 * matched 430/498 (~86%) of the time. The cut sits at 1, not higher — raising it would discard
 * hundreds of two-point segments that already match successfully today. (Re-measure with the
 * same predicate before changing this comment — the dev DB is live, so exact counts drift.)
 *
 * This is a domain judgement about which segments are worth attempting, not a transport-client
 * concern, so it lives here rather than in the Valhalla adapter (`valhalla.ts`).
 */
export const MIN_POINTS_TO_MATCH = 2;

function emptySummary(): RouteMatchSummary {
  return {
    segmentsConsidered: 0,
    matched: 0,
    lowConfidence: 0,
    noRoadMatch: 0,
    tooShort: 0,
    failed: 0,
    notApplicable: 0,
    skipped: 0,
    aborted: false,
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
 * Adapter failures are normally isolated to this segment, since route matching is best-effort —
 * except `ValhallaUnreachableError`, which is not a fact about this segment at all (see its doc
 * comment in valhalla.ts) and is rethrown so the caller can abort the whole day instead of
 * recording a fabricated `failed` for every segment it happens to reach before giving up.
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
  // Zero and one point are folded into the same too_short status rather than split further.
  // Both fail the identical test this threshold checks — "does this segment have the 2+ points
  // a path needs" — and a single point cannot define a path any more than no points can.
  // Distinguishing *why* there are zero points (every point filtered as anomalous vs. no GPS
  // fix at all vs. something else) would mean asserting a cause from data this function does
  // not have, which is the exact mistake `no_road_match` was introduced to stop making (see the
  // `MatchStatus` comment in src/db/schema.ts). So: same observation, same status.
  if (points.length < MIN_POINTS_TO_MATCH) {
    return { ...base, matchStatus: "too_short", costing: decision.costing };
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
    // Not this segment's problem to swallow — the caller decides what an unreachable engine
    // means for the whole day (matchRoutesForDay), and it does its own single consolidated log.
    if (error instanceof ValhallaUnreachableError) throw error;
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
    tooShort: counts.get("too_short") ?? 0,
    failed: counts.get("failed") ?? 0,
    notApplicable: counts.get("not_applicable") ?? 0,
    skipped: segmentsConsidered - rows.length,
    aborted: false,
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

/**
 * Match and atomically replace one user's segment-route rows for a KST date.
 *
 * If Valhalla is unreachable partway through, this writes nothing at all for the day — not even
 * for segments it matched before the engine dropped out — and returns a summary with
 * `aborted: true` instead of throwing. The invariant the rest of this pipeline relies on is "no
 * row means not yet processed" (see the `segment_route_matches` schema comment); a partially
 * written day would look processed and would never be picked up again. Rows are only ever
 * written once, in the single transaction at the end, after every segment in the day has been
 * attempted — so an early return here (before that transaction) is what "write nothing" reduces
 * to. Database failures from the point loader are a different case and are not caught here: see
 * `buildRowForSegment`'s doc comment for why those must still abort the process rather than
 * return a summary.
 */
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
  try {
    for (const segment of segments) {
      const row = await buildRowForSegment(segment, loadPoints, adapter, tileVersion, matchedAt);
      if (row) rows.push(row);
    }
  } catch (error) {
    if (!(error instanceof ValhallaUnreachableError)) throw error;
    // No transaction has run yet — rows accumulated in `rows` above never touch the database,
    // so returning here before that transaction is the entire "write nothing" behavior. Segments
    // matched earlier in this same loop are discarded along with it.
    logger.warn("[RouteMatch] Valhalla unreachable — aborting day, writing nothing", {
      userId,
      date,
      segmentsConsidered: segments.length,
      error: error.message,
    });
    return { ...emptySummary(), segmentsConsidered: segments.length, aborted: true };
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
