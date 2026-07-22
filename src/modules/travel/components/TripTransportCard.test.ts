import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TravelTripDetail } from "../hooks";
import { TripTransportCard } from "./TripTransportCard";

function render(transport: TravelTripDetail["transport"]): string {
  return renderToStaticMarkup(createElement(TripTransportCard, { transport }));
}

describe("TripTransportCard", () => {
  it("이동 기록이 없으면 합계와 빈 상태를 표시한다", () => {
    const markup = render({ totalDistanceMeters: 0, modes: [] });

    expect(markup).toContain("총 이동 거리");
    expect(markup).toContain("0 m");
    expect(markup).toContain("이동 기록이 없습니다");
  });

  it("항공을 포함한 모드별 거리를 읽기 쉽게 표시한다", () => {
    const markup = render({
      totalDistanceMeters: 501_500,
      modes: [
        { mode: "flying", distanceMeters: 500_000, durationSeconds: 7200, segmentCount: 1 },
        { mode: "walking", distanceMeters: 1500, durationSeconds: 900, segmentCount: 2 },
      ],
    });

    expect(markup).toContain("항공");
    expect(markup).toContain("도보");
    expect(markup).toContain("500 km");
    expect(markup).toContain("1.5 km");
  });
});
