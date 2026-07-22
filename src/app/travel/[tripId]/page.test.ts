import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TravelDetailContent } from "@/modules/travel/components/TravelDetailContent";
import type { TravelRoute, TravelTripDetail } from "@/modules/travel/hooks";

function detail(health: TravelTripDetail["health"] = []): TravelTripDetail {
  return {
    trip: {
      id: "trip-1",
      userId: "user-1",
      name: "제주 여행",
      startDate: "2026-07-15",
      endDate: "2026-07-18",
      totalDistanceMeters: 0,
      visitedCities: ["제주"],
      visitedCountries: ["대한민국"],
      isOverseas: false,
      autoDetected: true,
      notes: null,
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    },
    visits: [],
    spending: { total: 0, dailyAverage: 0, categories: [], transactions: [] },
    transport: { totalDistanceMeters: 0, modes: [] },
    routine: { codingSeconds: 0, commitCount: 0, comparison: null },
    health,
  };
}

const route: TravelRoute = { points: [], count: 0, rawSampledCount: 0, maxPoints: 500 };

describe("TravelDetailContent", () => {
  it("건강 데이터가 없으면 건강 제목과 카드 자체를 렌더하지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(TravelDetailContent, { detail: detail(), route })
    );

    expect(markup).toContain("여행 경로");
    expect(markup).toContain("일자별 방문지");
    expect(markup).toContain("지출");
    expect(markup).toContain("교통수단");
    expect(markup).toContain("일상 변화");
    expect(markup).not.toContain("건강");
  });

  it("건강 데이터가 있으면 날짜와 메트릭 값을 표시한다", () => {
    const markup = renderToStaticMarkup(
      createElement(TravelDetailContent, {
        detail: detail([
          {
            day: "2026-07-16",
            metric: "steps",
            valueAvg: 1500,
            valueMin: 100,
            valueMax: 900,
            valueSum: 8000,
            count: 10,
          },
        ]),
        route,
      })
    );

    expect(markup).toContain("건강");
    expect(markup).toContain("걸음 수");
    expect(markup).toContain("8,000걸음");
    expect(markup).toContain("7월 16일");
  });
});
