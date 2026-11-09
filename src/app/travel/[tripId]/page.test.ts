import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildGpx, TravelDetailView } from "@/modules/travel/components/TravelDetailView";
import type { TravelRoute, TravelTripDetail } from "@/modules/travel/hooks";

function detail(over: Partial<TravelTripDetail> = {}): TravelTripDetail {
  return {
    trip: {
      id: "trip-1",
      userId: "user-1",
      name: "제주 여행",
      startDate: "2026-07-15",
      endDate: "2026-07-17",
      totalDistanceMeters: 1_273_000,
      visitedCities: ["제주특별자치도"],
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
    health: [],
    spendingSince: "2026-03-03",
    ...over,
  };
}

const route: TravelRoute = { points: [], count: 0, rawSampledCount: 0, maxPoints: 1000 };

function render(d: TravelTripDetail): string {
  return renderToStaticMarkup(
    createElement(TravelDetailView, { detail: d, route, onRename: vi.fn(), onNotTrip: vi.fn() })
  );
}

describe("TravelDetailView", () => {
  it("labels the distance source and hides health when there is none", () => {
    const markup = render(detail());
    expect(markup).toContain("이동 거리");
    expect(markup).toContain("GPS 경로 전체 합계");
    expect(markup).toContain("일정");
    expect(markup).toContain("지출");
    expect(markup).not.toContain("건강");
  });

  it("limits health to steps, active zone and resting heart rate up front", () => {
    const markup = render(
      detail({
        health: [
          {
            day: "2026-07-16",
            metric: "steps",
            valueAvg: null,
            valueMin: null,
            valueMax: null,
            valueSum: 8000,
            count: 1,
          },
          {
            day: "2026-07-16",
            metric: "spo2",
            valueAvg: 96,
            valueMin: null,
            valueMax: null,
            valueSum: null,
            count: 1,
          },
        ],
      })
    );
    expect(markup).toContain("건강");
    expect(markup).toContain("8,000");
    expect(markup).toContain("다른 지표 1개");
  });

  it("flags transport modes as low-confidence and says 기록 없음 before Toss data", () => {
    const markup = render(
      detail({
        spendingSince: "2026-08-01",
        transport: {
          totalDistanceMeters: 100_000,
          modes: [
            { mode: "driving", distanceMeters: 100_000, durationSeconds: 3600, segmentCount: 2 },
          ],
        },
      })
    );
    expect(markup).toContain("자동 분류 · 정확도 낮음");
    expect(markup).toContain("기록 없음");
  });

  it("exports the route as GPX", () => {
    const gpx = buildGpx("제주 <여행>", {
      ...route,
      points: [{ lat: 33.5, lon: 126.5, accuracy: null, timestamp: "2026-07-15T01:00:00.000Z" }],
    });
    expect(gpx).toContain('<trkpt lat="33.5" lon="126.5">');
    expect(gpx).toContain("제주 &#60;여행&#62;");
  });
});
