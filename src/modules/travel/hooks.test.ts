import { describe, expect, it } from "vitest";
import {
  mergeTravelTrips,
  parseTravelDetail,
  parseTravelRoute,
  parseTravelTripsPage,
  type TravelTripListItem,
} from "./hooks";

function trip(id: string, endDate: string): TravelTripListItem {
  return {
    id,
    userId: "user-1",
    name: `여행 ${id}`,
    startDate: endDate,
    endDate,
    totalDistanceMeters: null,
    visitedCities: [],
    visitedCountries: [],
    isOverseas: false,
    autoDetected: true,
    notes: null,
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    totalSpending: 0,
    visitCount: 0,
  };
}

describe("mergeTravelTrips", () => {
  it("서버의 최근순을 유지하면서 겹친 페이지의 ID를 중복 추가하지 않는다", () => {
    const current = [trip("recent", "2026-07-20"), trip("middle", "2026-07-10")];
    const next = [
      trip("middle", "2026-07-10"),
      trip("old", "2026-06-01"),
      trip("old", "2026-06-01"),
    ];

    expect(mergeTravelTrips(current, next).map((item) => item.id)).toEqual([
      "recent",
      "middle",
      "old",
    ]);
  });
});

describe("parseTravelTripsPage", () => {
  it("API의 날짜 필드를 string으로 유지한다", () => {
    const item = trip("trip-1", "2026-07-20");
    const result = parseTravelTripsPage({ trips: [item], nextCursor: "cursor-2" });

    expect(result).toEqual({ trips: [item], nextCursor: "cursor-2" });
    expect(typeof result.trips[0]?.createdAt).toBe("string");
    expect(typeof result.trips[0]?.startDate).toBe("string");
  });

  it("필수 필드가 잘못된 응답을 거부한다", () => {
    expect(() =>
      parseTravelTripsPage({
        trips: [{ ...trip("trip-1", "2026-07-20"), visitCount: "1" }],
        nextCursor: null,
      })
    ).toThrow("여행 목록 응답 형식이 올바르지 않습니다");
  });
});

describe("parseTravelDetail", () => {
  const detail = {
    trip: {
      ...trip("trip-1", "2026-07-20"),
      totalSpending: undefined,
      visitCount: undefined,
    },
    visits: [
      {
        id: "visit-1",
        centerLat: 33.556,
        centerLon: 126.795,
        startTime: "2026-07-19T23:30:00.000Z",
        endTime: "2026-07-20T00:30:00.000Z",
        durationSeconds: 3600,
        placeName: null,
        address: "제주시 구좌읍",
        category: null,
        city: "제주",
        countryName: "대한민국",
      },
    ],
    spending: {
      total: 12000,
      dailyAverage: 6000,
      categories: [{ category: "식비", total: 12000, count: 1 }],
      transactions: [
        {
          id: "transaction-1",
          amount: 12000,
          merchant: "해녀식당",
          accountName: "카드",
          category: "식비",
          transactedAt: "2026-07-20T03:00:00.000Z",
        },
      ],
    },
    transport: { totalDistanceMeters: 1000, modes: [] },
    routine: { codingSeconds: 0, commitCount: 0, comparison: null },
    health: [],
  };

  it("직렬화된 timestamp 필드를 string으로 검증하고 유지한다", () => {
    const parsed = parseTravelDetail(detail);

    expect(typeof parsed.trip.createdAt).toBe("string");
    expect(typeof parsed.visits[0]?.startTime).toBe("string");
    expect(typeof parsed.spending.transactions[0]?.transactedAt).toBe("string");
  });

  it("Date 객체나 잘못된 timestamp를 거부한다", () => {
    expect(() =>
      parseTravelDetail({
        ...detail,
        visits: [{ ...detail.visits[0], startTime: new Date() }],
      })
    ).toThrow("여행 상세 응답 형식이 올바르지 않습니다");
  });
});

describe("parseTravelRoute", () => {
  it("경로 timestamp를 string으로 유지한다", () => {
    const route = parseTravelRoute({
      points: [
        {
          lat: 33.5,
          lon: 126.5,
          accuracy: 5,
          timestamp: "2026-07-20T00:00:00.000Z",
        },
      ],
      count: 1,
      rawSampledCount: 1,
      maxPoints: 1000,
    });

    expect(route.points[0]?.timestamp).toBe("2026-07-20T00:00:00.000Z");
  });
});
