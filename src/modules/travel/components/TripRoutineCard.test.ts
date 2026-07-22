import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TravelTripDetail } from "../hooks";
import { TripRoutineCard } from "./TripRoutineCard";

function render(routine: TravelTripDetail["routine"]): string {
  return renderToStaticMarkup(createElement(TripRoutineCard, { routine }));
}

describe("TripRoutineCard", () => {
  it("비교 구간이 없으면 절대값만 표시하고 비교 문구나 0%를 만들지 않는다", () => {
    const markup = render({ codingSeconds: 5400, commitCount: 3, comparison: null });

    expect(markup).toContain("1시간 30분");
    expect(markup).toContain("3개");
    expect(markup).not.toContain("직전 동일 기간");
    expect(markup).not.toContain("0%");
  });

  it("이전 동일 기간과 비교한 증감 방향과 값을 표시한다", () => {
    const markup = render({
      codingSeconds: 1800,
      commitCount: 6,
      comparison: {
        codingSeconds: 3600,
        commitCount: 4,
        codingPercentChange: -50,
        commitPercentChange: 50,
      },
    });

    expect(markup).toContain("50% 감소");
    expect(markup).toContain("50% 증가");
    expect(markup).toContain("이전 1시간");
    expect(markup).toContain("이전 4개");
  });
});
