/**
 * `travel_time`: the owner's own past journey durations between two places,
 * per transport mode (count, median, p80, main subway lines). A journey whose
 * track matched a subway line is grouped as `subway` even when its dominant
 * mode is walking (long station walks); others by dominant mode. Never an
 * estimate: a pair or mode without records is reported as "기록 없음" so the
 * agent falls back to its own routing tool.
 *
 * Coordinates are dropped from the audit summary (argRules) and never echoed
 * in the output.
 */

import { z } from "zod";
import {
  computeTravelTimes,
  type EndpointInput,
  type ModeTravelTime,
  type ResolvedEndpoint,
  TRAVEL_TIME_LOOKBACK_DAYS,
  TRAVEL_TIME_MAX_RADIUS_M,
  TRAVEL_TIME_MIN_RADIUS_M,
  TRAVEL_TIME_MIN_SAMPLES,
  TRAVEL_TIME_RADIUS_M,
  TravelTimeInputError,
} from "@/modules/location/travel-time";
import { McpInputError, McpToolError } from "../errors";
import { defineTool, type McpTool } from "../server";

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const placeId = z.string().uuid();

export function endpointFromInput(
  which: "origin" | "destination",
  placeIdValue: string | undefined,
  latValue: number | undefined,
  lonValue: number | undefined
): EndpointInput {
  const label = which === "origin" ? "출발지" : "도착지";
  const hasCoords = latValue !== undefined || lonValue !== undefined;
  if (placeIdValue && hasCoords) {
    throw new McpInputError(
      `${label}는 저장 장소 id와 좌표 중 하나만 주세요.`,
      "ambiguous_endpoint"
    );
  }
  if (placeIdValue) return { kind: "saved_place", savedPlaceId: placeIdValue };
  if (latValue !== undefined && lonValue !== undefined) {
    return { kind: "coordinates", lat: latValue, lon: lonValue };
  }
  throw new McpInputError(
    `${label}: 저장 장소 id 또는 위도·경도 두 값을 모두 주세요.`,
    "missing_endpoint"
  );
}

function endpointOutput(endpoint: ResolvedEndpoint) {
  return {
    kind: endpoint.savedPlaceId ? "saved_place" : "coordinates",
    savedPlaceId: endpoint.savedPlaceId,
    name: endpoint.name,
    radiusM: endpoint.radiusM,
  };
}

function modeOutput(mode: ModeTravelTime) {
  return {
    mode: mode.mode,
    label: mode.label,
    count: mode.count,
    status: mode.status,
    message: mode.message,
    medianMinutes: mode.medianMinutes,
    p80Minutes: mode.p80Minutes,
    minMinutes: mode.minMinutes,
    maxMinutes: mode.maxMinutes,
    durationsMinutes: mode.durationsMinutes,
    latestDepartureAt: mode.latestDepartureAt,
    mainLines: mode.mainLines.map((line) => ({
      ref: line.ref,
      name: line.name,
      journeys: line.journeys,
    })),
  };
}

export const travelTimeTool = defineTool({
  name: "travel_time",
  kind: "read",
  scope: "read",
  title: "개인 소요시간",
  description:
    "출발지와 도착지(저장 장소 id 또는 위도·경도)를 받아, 최근 기록된 실제 이동 중 그 구간에 해당하는 " +
    "것만 골라 수단별 횟수·중앙값(medianMinutes)·느린 경우(p80Minutes)·주 이용 지하철 노선을 돌려줍니다. " +
    "각 이동의 출발·도착은 이동 직전·직후의 머문 장소로 판정합니다. 지하철 노선이 확인된 이동은 역까지 걷는 " +
    "구간이 길어도 subway(지하철)로 묶고, 그 밖의 이동은 가장 오래 쓴 수단으로 묶습니다. fromHour/toHour(한국 시간, 출발 시각 " +
    `기준, 22→3처럼 자정을 넘길 수 있음)로 시간대를 좁힐 수 있습니다. 표본이 ${TRAVEL_TIME_MIN_SAMPLES}건 ` +
    "미만인 수단은 개별 소요시간만 줍니다. status가 no_records인 수단은 '기록 없음'이며 추정치가 아닙니다. " +
    "dataThrough 이후의 이동은 아직 처리되지 않았습니다.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: z.object({
    originPlaceId: placeId.optional().describe("출발 저장 장소 id (saved_places 도구)."),
    originLat: lat.optional().describe("출발지 위도 (저장 장소 대신)."),
    originLon: lon.optional().describe("출발지 경도 (저장 장소 대신)."),
    destinationPlaceId: placeId.optional().describe("도착 저장 장소 id."),
    destinationLat: lat.optional().describe("도착지 위도."),
    destinationLon: lon.optional().describe("도착지 경도."),
    fromHour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .optional()
      .describe("출발 시각 범위 시작(한국 시간, 포함). toHour와 함께 주세요."),
    toHour: z
      .number()
      .int()
      .min(1)
      .max(24)
      .optional()
      .describe("출발 시각 범위 끝(한국 시간, 미포함). fromHour보다 작으면 자정을 넘깁니다."),
    radiusM: z
      .number()
      .int()
      .min(TRAVEL_TIME_MIN_RADIUS_M)
      .max(TRAVEL_TIME_MAX_RADIUS_M)
      .optional()
      .describe(`출발·도착 지점 반경(미터, 기본 ${TRAVEL_TIME_RADIUS_M}).`),
    lookbackDays: z
      .number()
      .int()
      .min(1)
      .max(TRAVEL_TIME_LOOKBACK_DAYS)
      .optional()
      .describe(`최근 며칠의 이동을 볼지 (기본·최대 ${TRAVEL_TIME_LOOKBACK_DAYS}).`),
  }),
  argRules: {
    originPlaceId: "keep",
    destinationPlaceId: "keep",
    originLat: "drop",
    originLon: "drop",
    destinationLat: "drop",
    destinationLon: "drop",
    fromHour: "keep",
    toHour: "keep",
    radiusM: "keep",
    lookbackDays: "keep",
  },
  run: async (ctx, input) => {
    const origin = endpointFromInput(
      "origin",
      input.originPlaceId,
      input.originLat,
      input.originLon
    );
    const destination = endpointFromInput(
      "destination",
      input.destinationPlaceId,
      input.destinationLat,
      input.destinationLon
    );
    if ((input.fromHour === undefined) !== (input.toHour === undefined)) {
      throw new McpInputError("fromHour와 toHour는 함께 주세요.", "invalid_hours");
    }
    if (input.fromHour !== undefined && input.fromHour === input.toHour) {
      throw new McpInputError("fromHour와 toHour가 같을 수 없습니다.", "invalid_hours");
    }
    const hours =
      input.fromHour !== undefined && input.toHour !== undefined
        ? { fromHour: input.fromHour, toHour: input.toHour }
        : null;

    let result: Awaited<ReturnType<typeof computeTravelTimes>>;
    try {
      result = await computeTravelTimes(
        ctx.userId,
        {
          origin,
          destination,
          hours,
          radiusM: input.radiusM,
          lookbackDays: input.lookbackDays,
          now: ctx.now,
        },
        ctx.db
      );
    } catch (error) {
      if (error instanceof TravelTimeInputError) throw new McpToolError(error.message, "not_found");
      throw error;
    }

    return {
      structured: {
        status: result.status,
        message: result.message,
        origin: endpointOutput(result.origin),
        destination: endpointOutput(result.destination),
        since: result.since,
        until: result.until,
        hours: result.hours,
        dataThrough: result.dataThrough,
        totalJourneys: result.totalJourneys,
        modes: result.modes.map(modeOutput),
        scannedTracks: result.scannedTracks,
        tracksWithoutAdjacentVisits: result.tracksWithoutAdjacentVisits,
        truncated: result.truncated,
        notes: [
          "소요시간은 이동 시작부터 다음 장소 도착까지의 실측값이며 집을 나서는 시각과 몇 분 다를 수 있습니다.",
          "중간에 한곳에 7~8분 이상 머문 이동은 두 번의 이동으로 나뉘어 이 구간에 잡히지 않을 수 있습니다.",
        ],
      },
      count: result.totalJourneys,
    };
  },
});

export const TRAVEL_TIME_TOOLS: McpTool[] = [travelTimeTool];
