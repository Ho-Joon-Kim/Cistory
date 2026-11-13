/**
 * Saved places and trips: `saved_places`, `trips`, `trip_detail`.
 * Trip transactions go through the shared transaction serializer (R6).
 */

import { z } from "zod";
import { listSavedPlaces, type SavedPlaceView } from "@/modules/location/saved-places";
import {
  DEFAULT_TRIP_LIST_LIMIT,
  decodeTripCursor,
  MAX_TRIP_LIST_LIMIT,
  TravelService,
  type TripListItem,
  type TripVisit,
} from "@/modules/travel/service";
import { McpInputError, McpToolError } from "../errors";
import { type Allowlist, accessFromScopes, serializeRow, serializeRows } from "../serialize";
import { defineTool, type McpTool } from "../server";
import { cursorField, kstTime, limitField, NO_RECORDS, READ_ANNOTATIONS } from "./common";
import { loadTransferEvidence } from "./data";
import { filterHealthMetricRows } from "./health";
import { serializeTransactions } from "./transaction-fields";

const SAVED_PLACE_ALLOWLIST: Allowlist<SavedPlaceView> = {
  id: true,
  name: true,
  category: true,
  lat: true,
  lon: true,
  radiusM: true,
  address: { from: "displayAddress" },
  excludeFromTrips: true,
  tripExclusionRadiusM: true,
  updatedAt: kstTime,
};

const TRIP_ALLOWLIST: Allowlist<TripListItem> = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  isOverseas: true,
  autoDetected: true,
  visitedCities: true,
  visitedCountries: true,
  totalDistanceMeters: true,
  notes: true,
  totalSpending: true,
  visitCount: true,
  anchorPlaceName: true,
};

const TRIP_VISIT_ALLOWLIST: Allowlist<TripVisit> = {
  id: true,
  startTime: kstTime,
  endTime: kstTime,
  durationMinutes: { from: "durationSeconds", map: (v) => Math.round(Number(v) / 60) },
  placeName: true,
  savedPlaceName: true,
  address: true,
  category: true,
  city: true,
  countryName: true,
  centerLat: true,
  centerLon: true,
};

export const savedPlacesTool = defineTool({
  name: "saved_places",
  kind: "read",
  scope: "read",
  title: "저장 장소",
  description:
    "저장 장소 목록(이름·좌표·반경·분류·주소·여행 제외 설정)을 최근 수정 순으로 돌려줍니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({}),
  argRules: {},
  run: async (ctx) => {
    const places = await listSavedPlaces(ctx.userId, ctx.db);
    return {
      structured: {
        places: serializeRows(places, SAVED_PLACE_ALLOWLIST, accessFromScopes(ctx.scopes)),
        message: places.length === 0 ? NO_RECORDS : null,
      },
      count: places.length,
    };
  },
});

export const tripsTool = defineTool({
  name: "trips",
  kind: "read",
  scope: "read",
  title: "여행 목록",
  description:
    "여행 목록(이름·기간·방문 도시/국가·지출 합계·방문 수)을 최근 순으로 돌려줍니다. " +
    `커서 페이지(기본 ${DEFAULT_TRIP_LIST_LIMIT}건, 최대 ${MAX_TRIP_LIST_LIMIT}건). 상세는 trip_detail을 쓰세요.`,
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({
    limit: limitField(DEFAULT_TRIP_LIST_LIMIT, MAX_TRIP_LIST_LIMIT),
    cursor: cursorField,
  }),
  argRules: { limit: "keep" },
  run: async (ctx, input) => {
    let cursor = null;
    if (input.cursor) {
      cursor = decodeTripCursor(input.cursor);
      if (!cursor) {
        throw new McpInputError(
          "cursor가 올바르지 않습니다. 이전 응답의 nextCursor를 그대로 넘기세요.",
          "invalid_cursor"
        );
      }
    }
    const { trips, nextCursor } = await new TravelService(ctx.db).listTrips(ctx.userId, {
      limit: input.limit ?? DEFAULT_TRIP_LIST_LIMIT,
      cursor,
    });
    return {
      structured: {
        trips: serializeRows(trips, TRIP_ALLOWLIST, accessFromScopes(ctx.scopes)),
        message: trips.length === 0 && !cursor ? NO_RECORDS : null,
        nextCursor,
      },
      count: trips.length,
    };
  },
});

export const tripDetailTool = defineTool({
  name: "trip_detail",
  kind: "read",
  scope: "read",
  title: "여행 상세",
  description:
    "여행 하나의 방문, 지출(카테고리 합계와 건별 거래), 이동 수단, 코딩·커밋, 건강 일별 값을 돌려줍니다.",
  annotations: READ_ANNOTATIONS,
  inputSchema: z.object({ tripId: z.string().uuid().describe("trips가 돌려준 여행 id.") }),
  argRules: { tripId: "keep" },
  run: async (ctx, input) => {
    const detail = await new TravelService(ctx.db).getTripDetail(ctx.userId, input.tripId);
    if (!detail) throw new McpToolError("여행을 찾을 수 없습니다.", "not_found");
    const access = accessFromScopes(ctx.scopes);

    const txs = detail.spending.transactions;
    const evidence = await loadTransferEvidence(
      ctx.db,
      ctx.userId,
      txs.map((t) => t.id)
    );
    const transactions = serializeTransactions(
      txs.map((t) => ({
        ...t,
        // A row whose evidence vanished is treated as a transfer (masked).
        ...(evidence.get(t.id) ?? { isSelfTransfer: true }),
      })),
      access
    );

    return {
      structured: {
        trip: serializeRow(
          {
            ...detail.trip,
            totalSpending: detail.spending.total,
            visitCount: detail.visits.length,
            anchorPlaceName: null,
          },
          TRIP_ALLOWLIST,
          access
        ),
        visits: serializeRows(detail.visits, TRIP_VISIT_ALLOWLIST, access),
        spending: {
          total: detail.spending.total,
          dailyAverage: detail.spending.dailyAverage,
          categories: detail.spending.categories,
          transactions,
          spendingSince: detail.spendingSince,
        },
        transport: detail.transport,
        routine: detail.routine,
        health: filterHealthMetricRows(detail.health),
      },
      count: detail.visits.length + transactions.length,
    };
  },
});

export const PLACES_TRIPS_TOOLS: McpTool[] = [savedPlacesTool, tripsTool, tripDetailTool];
