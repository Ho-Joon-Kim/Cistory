import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TravelTripListItem } from "../hooks";
import { getTripDuration, TripCard } from "./TripCard";

function trip(overrides: Partial<TravelTripListItem> = {}): TravelTripListItem {
  return {
    id: "trip-1",
    userId: "user-1",
    name: "제주 여행",
    startDate: "2026-07-15",
    endDate: "2026-07-18",
    totalDistanceMeters: 473_000,
    visitedCities: ["제주"],
    visitedCountries: ["대한민국"],
    isOverseas: false,
    autoDetected: true,
    notes: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    totalSpending: 930_000,
    visitCount: 30,
    ...overrides,
  };
}

describe("getTripDuration", () => {
  it("KST date key를 시간대 변환 없이 정확한 N박 M일로 계산한다", () => {
    expect(getTripDuration("2026-07-15", "2026-07-18")).toEqual({ nights: 3, days: 4 });
    expect(getTripDuration("2026-07-15", "2026-07-15")).toEqual({ nights: 0, days: 1 });
  });
});

describe("TripCard", () => {
  it("상세 링크와 해외 배지를 렌더한다", () => {
    const markup = renderToStaticMarkup(
      createElement(TripCard, {
        trip: trip({ id: "hong-kong", name: "홍콩 여행", isOverseas: true }),
      })
    );

    expect(markup).toContain('href="/travel/hong-kong"');
    expect(markup).toContain("홍콩 여행");
    expect(markup).toContain("해외");
    expect(markup).toContain("3박 4일");
  });

  it("지출과 방문지가 0이어도 안전한 값을 렌더한다", () => {
    const markup = renderToStaticMarkup(
      createElement(TripCard, { trip: trip({ totalSpending: 0, visitCount: 0 }) })
    );

    expect(markup).toContain("0원");
    expect(markup).toContain("방문지 0곳");
    expect(markup).toContain("국내");
  });

  it("상세 링크와 여행 아님 버튼을 중첩하지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(TripCard, { trip: trip(), onMarkNotTrip: async () => true })
    );

    expect(markup).toContain("여행 아님");
    expect(markup).not.toMatch(/<a[^>]*>[\s\S]*<button[^>]*>[\s\S]*<\/button>[\s\S]*<\/a>/);
  });
});
