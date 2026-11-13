/**
 * Location read tools: `current_location`, `location_history`, `gps_points`.
 *
 * All three are pure reads. `current_location` never runs stay-point
 * detection: today's visits and subway matches are produced by the dashboard
 * and the next night's pipeline, so the last visit is reported with its end
 * time plus `visitDataThrough` (the last day the pipeline completed), and the
 * subway ride is labelled "last processed", never "current".
 */

import { z } from "zod";
import {
  decodeRawPointCursor,
  findNearestPlaceWithinRadius,
  getLatestLocationPoint,
  getLatestSubwayRide,
  getLatestVisit,
  listRawLocationPoints,
  listTracks,
  listVisits,
  type PersistedVisit,
  type TrackView,
} from "@/modules/location/queries";
import { listSavedPlaces } from "@/modules/location/saved-places";
import { McpInputError } from "../errors";
import { type Allowlist, accessFromScopes, serializeRows } from "../serialize";
import { defineTool, type McpTool } from "../server";
import { parseTimeRange, toKstIso } from "../time";
import {
  cursorField,
  decodeCursor,
  encodeCursor,
  kstIso,
  kstTime,
  limitField,
  NO_RECORDS,
  PAGE_DEFAULT_LIMIT,
  RANGE_ARG_RULES,
  READ_ANNOTATIONS,
  rangeFields,
  rangeOutput,
} from "./common";
import { getLocationDataThrough } from "./data";

/** Widen saved-place radii by the fix's accuracy, but never by more than this. */
const MAX_ACCURACY_SLACK_M = 100;
const HISTORY_MAX_DAYS = 92;
const GPS_MAX_DAYS = 31;

const VISIT_ALLOWLIST: Allowlist<PersistedVisit> = {
  id: true,
  startTime: kstTime,
  endTime: kstTime,
  durationMinutes: { from: "durationSeconds", map: (v) => Math.round(Number(v) / 60) },
  placeName: true,
  address: true,
  category: true,
  city: true,
  countryName: true,
  savedPlaceId: true,
  centerLat: true,
  centerLon: true,
  radiusM: true,
};

function serializeTrack(track: TrackView) {
  return {
    id: track.id,
    startTime: kstIso(track.startTime),
    endTime: kstIso(track.endTime),
    durationMinutes: track.durationSeconds == null ? null : Math.round(track.durationSeconds / 60),
    distanceMeters: track.distanceMeters,
    startPlaceName: track.startPlaceName,
    endPlaceName: track.endPlaceName,
    dominantMode: track.dominantMode,
    segments: track.segments.map((segment) => ({
      mode: segment.mode,
      confidence: segment.confidence,
      startTime: kstIso(segment.startTime),
      endTime: kstIso(segment.endTime),
      durationMinutes:
        segment.durationSeconds == null ? null : Math.round(segment.durationSeconds / 60),
      distanceMeters: segment.distanceMeters,
      avgSpeedKmh: segment.avgSpeedKmh,
      subwayLegs: segment.subwayLegs.map((leg) => ({
        lineName: leg.lineName,
        lineRef: leg.lineRef,
        startStationName: leg.startStationName,
        endStationName: leg.endStationName,
        sessionId: leg.sessionId,
        legOrder: leg.legOrder,
        confidence: leg.totalConfidence,
      })),
    })),
  };
}

// ── current_location ─────────────────────────────────────────────────────────

export const currentLocationTool = defineTool({
  name: "current_location",
  kind: "read",
  scope: "read",
  title: "현재 위치",
  description:
    "가장 최근 GPS 위치(시각·정확도·경과 분), 그 좌표가 들어가는 저장 장소, 마지막으로 저장된 방문, " +
    "처리된 마지막 지하철 탑승을 돌려줍니다. 탐지를 새로 돌리지 않는 조회라서, 방문과 지하철은 " +
    "visitDataThrough 날짜까지만 확정되어 있습니다. minutesAgo가 크면 위치가 오래된 것입니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({}),
  argRules: {},
  run: async (ctx) => {
    const db = ctx.db;
    const [point, lastVisit, ride, visitDataThrough] = await Promise.all([
      getLatestLocationPoint(ctx.userId, db),
      getLatestVisit(ctx.userId, db),
      getLatestSubwayRide(ctx.userId, {}, db),
      getLocationDataThrough(db, ctx.userId),
    ]);

    const places = point || lastVisit?.savedPlaceId ? await listSavedPlaces(ctx.userId, db) : [];
    let nearSavedPlace: Record<string, unknown> | null = null;
    if (point) {
      const slack = Math.min(Math.max(point.accuracy ?? 0, 0), MAX_ACCURACY_SLACK_M);
      const nearest = findNearestPlaceWithinRadius(places, point.lat, point.lon, slack);
      if (nearest) {
        nearSavedPlace = {
          id: nearest.place.id,
          name: nearest.place.name,
          category: nearest.place.category,
          distanceM: Math.round(nearest.distanceM),
        };
      }
    }
    const savedNames = new Map(places.map((place) => [place.id, place.name]));

    const structured: Record<string, unknown> = {
      status: point ? "ok" : "no_data",
      message: point ? null : `위치 ${NO_RECORDS}`,
      serverTime: toKstIso(ctx.now),
      latestPoint: point
        ? {
            lat: point.lat,
            lon: point.lon,
            accuracyM: point.accuracy,
            recordedAt: toKstIso(point.timestamp),
            minutesAgo: Math.max(
              0,
              Math.floor((ctx.now.getTime() - point.timestamp.getTime()) / 60_000)
            ),
          }
        : null,
      nearSavedPlace,
      lastVisit: lastVisit
        ? {
            placeName: lastVisit.placeName,
            savedPlaceName: lastVisit.savedPlaceId
              ? (savedNames.get(lastVisit.savedPlaceId) ?? null)
              : null,
            address: lastVisit.address,
            startTime: toKstIso(lastVisit.startTime),
            endTime: toKstIso(lastVisit.endTime),
          }
        : null,
      visitDataThrough,
      lastProcessedSubwayRide: ride
        ? {
            label: "처리된 마지막 탑승 (실시간 아님)",
            lineName: ride.line.name,
            lineRef: ride.line.ref,
            startStationName: ride.startStationName,
            endStationName: ride.endStationName,
            startTime: toKstIso(ride.subStartTime),
            endTime: toKstIso(ride.subEndTime),
          }
        : null,
    };
    return { structured, count: point ? 1 : 0 };
  },
});

// ── location_history ─────────────────────────────────────────────────────────

const HISTORY_KINDS = ["visits", "tracks"] as const;

function decodeHistoryCursor(value: string | undefined): { v: number; t: number } {
  if (!value) return { v: 0, t: 0 };
  return decodeCursor(value, (raw) => {
    const r = raw as { v?: unknown; t?: unknown };
    const ok = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
    return ok(r?.v) && ok(r?.t) ? { v: r.v as number, t: r.t as number } : null;
  });
}

export const locationHistoryTool = defineTool({
  name: "location_history",
  kind: "read",
  scope: "read",
  title: "위치 기록",
  description:
    "기간 안의 방문(장소·시각·체류 분)과 이동(수단별 구간·소요 분·거리, 지하철 노선과 승하차역)을 " +
    `돌려줍니다. 기간은 최대 ${HISTORY_MAX_DAYS}일, 기본은 최근 7일입니다. 원시 GPS 포인트는 gps_points를 쓰세요.`,
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    ...rangeFields,
    kinds: z
      .array(z.enum(HISTORY_KINDS))
      .min(1)
      .optional()
      .describe("받을 종류 (기본: visits, tracks 둘 다)."),
    limit: limitField(),
    cursor: cursorField,
  }),
  argRules: { ...RANGE_ARG_RULES, kinds: "keep" },
  run: async (ctx, input) => {
    const range = parseTimeRange(input, { now: ctx.now, maxDays: HISTORY_MAX_DAYS });
    const kinds = new Set(input.kinds ?? HISTORY_KINDS);
    const limit = input.limit ?? PAGE_DEFAULT_LIMIT;
    const offsets = decodeHistoryCursor(input.cursor);
    const access = accessFromScopes(ctx.scopes);

    const [visitRows, trackRows] = await Promise.all([
      kinds.has("visits") ? listVisits(ctx.userId, range, ctx.db) : Promise.resolve([]),
      kinds.has("tracks") ? listTracks(ctx.userId, range, ctx.db) : Promise.resolve([]),
    ]);
    const visitPage = visitRows.slice(offsets.v, offsets.v + limit);
    const trackPage = trackRows.slice(offsets.t, offsets.t + limit);
    const next = { v: offsets.v + visitPage.length, t: offsets.t + trackPage.length };
    const hasMore = next.v < visitRows.length || next.t < trackRows.length;

    const visits = serializeRows(visitPage, VISIT_ALLOWLIST, access);
    const tracks = trackPage.map(serializeTrack);
    return {
      structured: {
        range: rangeOutput(range),
        visits: kinds.has("visits") ? visits : null,
        tracks: kinds.has("tracks") ? tracks : null,
        message: visitRows.length + trackRows.length === 0 ? NO_RECORDS : null,
        nextCursor: hasMore ? encodeCursor(next) : null,
      },
      count: visits.length + tracks.length,
    };
  },
});

// ── gps_points ───────────────────────────────────────────────────────────────

export const gpsPointsTool = defineTool({
  name: "gps_points",
  kind: "read",
  scope: "read",
  title: "원시 GPS 포인트",
  description:
    "기간 안의 원시 GPS 포인트(이상치 제외)를 오래된 순으로 돌려줍니다. 커서 페이지(기본 100건, 최대 500건)이며, " +
    `다음 페이지는 같은 from/to와 nextCursor로 요청하세요. 기간은 최대 ${GPS_MAX_DAYS}일, 기본은 오늘 하루입니다.`,
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({ ...rangeFields, limit: limitField(), cursor: cursorField }),
  argRules: RANGE_ARG_RULES,
  run: async (ctx, input) => {
    const range = parseTimeRange(input, { now: ctx.now, defaultDays: 1, maxDays: GPS_MAX_DAYS });
    let cursor = null;
    if (input.cursor) {
      cursor = decodeRawPointCursor(input.cursor);
      if (!cursor) {
        throw new McpInputError(
          "cursor가 올바르지 않습니다. 이전 응답의 nextCursor를 그대로 넘기세요.",
          "invalid_cursor"
        );
      }
    }
    const { points, nextCursor } = await listRawLocationPoints(
      ctx.userId,
      range,
      { cursor, limit: input.limit ?? PAGE_DEFAULT_LIMIT },
      ctx.db
    );
    return {
      structured: {
        range: rangeOutput(range),
        points: points.map((p) => ({
          lat: p.lat,
          lon: p.lon,
          accuracyM: p.accuracy,
          altitudeM: p.altitude,
          velocityKmh: p.velocity,
          recordedAt: toKstIso(p.timestamp),
        })),
        message: points.length === 0 && !cursor ? NO_RECORDS : null,
        nextCursor,
      },
      count: points.length,
    };
  },
});

export const LOCATION_TOOLS: McpTool[] = [currentLocationTool, locationHistoryTool, gpsPointsTool];
