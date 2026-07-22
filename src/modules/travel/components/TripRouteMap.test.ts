import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TravelTripVisit } from "../hooks";
import { calculateTripMapViewport, TripRouteMap } from "./TripRouteMap";

const visit: TravelTripVisit = {
  id: "visit-1",
  centerLat: 33.556,
  centerLon: 126.795,
  startTime: "2026-07-16T00:00:00.000Z",
  endTime: "2026-07-16T01:00:00.000Z",
  durationSeconds: 3600,
  placeName: "협재해수욕장",
  address: null,
  category: null,
  city: "제주",
  countryName: "대한민국",
};

describe("calculateTripMapViewport", () => {
  it("좌표가 하나뿐이어도 안전한 중심과 zoom을 만든다", () => {
    expect(calculateTripMapViewport([], [visit])).toEqual({
      center: { latitude: 33.556, longitude: 126.795 },
      zoom: 13,
      bounds: null,
    });
  });
});

describe("TripRouteMap", () => {
  it("Mapbox 토큰이 없으면 안내 문구를 SSR에서도 안전하게 렌더한다", () => {
    const markup = renderToStaticMarkup(
      createElement(TripRouteMap, { points: [], visits: [visit], accessToken: "" })
    );

    expect(markup).toContain("Mapbox 토큰이 설정되지 않았습니다");
  });
});
