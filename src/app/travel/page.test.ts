import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TravelTripListItem } from "@/modules/travel/hooks";
import { TravelTripsContent } from "./page";

function trip(id: string, name: string): TravelTripListItem {
  return {
    id,
    userId: "user-1",
    name,
    startDate: "2026-07-15",
    endDate: "2026-07-18",
    totalDistanceMeters: null,
    visitedCities: [],
    visitedCountries: [],
    isOverseas: false,
    autoDetected: true,
    notes: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    totalSpending: 0,
    visitCount: 0,
  };
}

function renderContent(trips: TravelTripListItem[]): string {
  return renderToStaticMarkup(
    createElement(TravelTripsContent, {
      trips,
      isLoading: false,
      error: null,
      hasMore: false,
      loadMore: vi.fn(),
      refresh: vi.fn(),
      markNotTrip: vi.fn(),
      markingTripId: null,
    })
  );
}

describe("TravelTripsContent", () => {
  it("여행이 없으면 정상 빈 상태를 렌더한다", () => {
    expect(renderContent([])).toContain("아직 기록된 여행이 없습니다");
  });

  it("서버가 준 최근순 배열 그대로 카드를 렌더한다", () => {
    const markup = renderContent([trip("recent", "최근 여행"), trip("old", "이전 여행")]);

    expect(markup.indexOf("최근 여행")).toBeLessThan(markup.indexOf("이전 여행"));
  });

  it("각 카드에 여행 아님 동작을 연결한다", () => {
    const markup = renderContent([trip("recent", "최근 여행")]);

    expect(markup).toContain("여행 아님");
  });
});
