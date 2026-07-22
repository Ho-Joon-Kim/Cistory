import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TravelTripVisit } from "../hooks";
import { buildTripTimeline, TripTimeline } from "./TripTimeline";

function visit(overrides: Partial<TravelTripVisit> = {}): TravelTripVisit {
  return {
    id: "visit-1",
    centerLat: 33.556,
    centerLon: 126.795,
    startTime: "2026-07-15T23:30:00.000Z",
    endTime: "2026-07-16T00:30:00.000Z",
    durationSeconds: 3660,
    placeName: "협재해수욕장",
    address: "제주시 한림읍",
    category: null,
    city: "제주",
    countryName: "대한민국",
    ...overrides,
  };
}

describe("buildTripTimeline", () => {
  it("방문이 없는 날짜를 포함해 4일 여행을 4개 KST 날짜 그룹으로 만든다", () => {
    const groups = buildTripTimeline("2026-07-15", "2026-07-18", [visit()]);

    expect(groups.map((group) => group.dateKey)).toEqual([
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
    expect(groups[1]?.visits[0]?.arrivalTime).toBe("08:30");
  });
});

describe("TripTimeline", () => {
  it("상호명이 없으면 주소를 표시하고 체류 시간을 읽기 쉽게 표시한다", () => {
    const markup = renderToStaticMarkup(
      createElement(TripTimeline, {
        startDate: "2026-07-15",
        endDate: "2026-07-18",
        visits: [visit({ placeName: null, address: "제주시 구좌읍" })],
      })
    );

    expect(markup).toContain("제주시 구좌읍");
    expect(markup).toContain("1시간 1분");
    expect(markup).toContain("방문 기록이 없습니다");
  });
});
