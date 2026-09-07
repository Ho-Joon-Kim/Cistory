import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BodyCard } from "@/modules/insights/components/BodyCard";
import { CorrelationCard } from "./components/CorrelationCard";
import { activityObservation } from "./observation";

const inverse = [
  { day: "2026-09-01", steps: 1000, visits: 8, codingMin: 0 },
  { day: "2026-09-02", steps: 12000, visits: 1, codingMin: 400 },
  { day: "2026-09-03", steps: 4000, visits: 3, codingMin: 10 },
];

describe("health observations and request states", () => {
  it("describes inverse observations without claiming positive correlation or coding consistency", () => {
    const sentence = activityObservation(inverse);
    expect(sentence).toContain("2026-09-01에는 8곳 방문·1,000보");
    expect(sentence).toContain("2026-09-02에는 1곳 방문·12,000보");
    expect(sentence).not.toContain("늘어납니다");
    expect(sentence).not.toContain("꾸준");
    expect(sentence).toContain("판단할 수 없습니다");
  });
  it("does not invent measurements when steps are missing or visits identical", () => {
    expect(activityObservation(inverse.map((day) => ({ ...day, steps: null })))).toBeNull();
    expect(activityObservation(inverse.map((day) => ({ ...day, visits: 1 })))).toBeNull();
  });
  it("stops the body skeleton after a successful empty response", () => {
    const markup = renderToStaticMarkup(createElement(BodyCard, { data: null, isLoading: false }));
    expect(markup).toContain("측정 기록이 아직 없습니다");
    expect(markup).not.toContain("animate-pulse");
  });
  it("distinguishes body and activity request failures from empty data", () => {
    const body = renderToStaticMarkup(
      createElement(BodyCard, { data: null, isLoading: false, error: "요청 실패" })
    );
    const activity = renderToStaticMarkup(
      createElement(CorrelationCard, { days: null, isLoading: false, error: "요청 실패" })
    );
    for (const markup of [body, activity]) {
      expect(markup).toContain('role="alert"');
      expect(markup).toContain("다시 시도");
      expect(markup).not.toContain("아직 없습니다");
    }
  });
});
