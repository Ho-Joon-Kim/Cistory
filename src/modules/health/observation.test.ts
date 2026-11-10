import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BodyCard } from "@/modules/insights/components/BodyCard";
import { HeroRow } from "./components/HeroRow";

const hero = (props: { bodyError: string | null }) =>
  renderToStaticMarkup(
    createElement(HeroRow, {
      sessions: [],
      rhr: undefined,
      days: ["2026-11-09"],
      today: "2026-11-09",
      body: null,
      bodyLoading: false,
      onBodyRetry: () => {},
      ...props,
    })
  );

describe("health request states", () => {
  it("stops the body skeleton after a successful empty response", () => {
    const markup = renderToStaticMarkup(createElement(BodyCard, { data: null, isLoading: false }));
    expect(markup).toContain("측정 기록이 아직 없습니다");
    expect(markup).not.toContain("animate-pulse");
<<<<<<< ours
    expect(hero({ bodyError: null })).toContain("체성분 측정 기록이 아직 없습니다");
=======
    expect(hero({ bodyError: null })).toContain("체성분 측정 기록이 아직 없어요");
>>>>>>> theirs
  });
  it("distinguishes body request failures from empty data", () => {
    const body = renderToStaticMarkup(
      createElement(BodyCard, { data: null, isLoading: false, error: "요청 실패" })
    );
    for (const markup of [body, hero({ bodyError: "요청 실패" })]) {
      expect(markup).toContain('role="alert"');
      expect(markup).toContain("다시 시도");
    }
    expect(hero({ bodyError: "요청 실패" })).not.toContain("체성분 측정 기록이 아직 없어요");
  });
  it("never draws missing sleep or heart-rate data as zero", () => {
    const markup = hero({ bodyError: null });
    expect(markup).toContain("최근 수면 기록이 없어요");
    expect(markup).toContain("안정시 심박 기록이 없어요");
  });
});
