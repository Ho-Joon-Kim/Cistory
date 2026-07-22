import { describe, expect, it } from "vitest";
import { mergeTravelTrips, parseTravelTripsPage, type TravelTripListItem } from "./hooks";

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
