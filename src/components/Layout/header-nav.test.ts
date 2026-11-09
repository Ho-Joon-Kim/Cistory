import { describe, expect, it } from "vitest";
import { HEADER_NAV_ITEMS, isNavItemActive, navEdges, navScrollLeftFor } from "./header-nav";

describe("header navigation", () => {
  it("lists the seven destinations in the app-bar order", () => {
    expect(HEADER_NAV_ITEMS.map((item) => item.label)).toEqual([
      "타임라인",
      "개요",
      "소비",
      "포트폴리오",
      "여행",
      "건강",
      "검색",
    ]);
    expect(HEADER_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/dashboard",
      "/overview",
      "/spending",
      "/portfolio",
      "/travel",
      "/health",
      "/search",
    ]);
  });

  // /insights and /report stayed folded into /overview; /health kept its own
  // page because the overview only carries a five-number summary of it.
  it("keeps insights and report folded into the overview link", () => {
    expect(HEADER_NAV_ITEMS.some((item) => ["/insights", "/report"].includes(item.href))).toBe(
      false
    );
  });

  it("marks nested routes active", () => {
    expect(isNavItemActive("/travel/abc", "/travel")).toBe(true);
    expect(isNavItemActive("/travel", "/travel")).toBe(true);
    expect(isNavItemActive("/travelx", "/travel")).toBe(false);
  });
});

describe("navScrollLeftFor", () => {
  const strip = { viewportWidth: 390, scrollWidth: 520 };

  it("leaves items that already fit at the start flush left", () => {
    expect(navScrollLeftFor({ ...strip, itemLeft: 12, itemWidth: 72 })).toBe(0);
  });

  it("keeps the strip at the first tab when the active pill already shows (mock)", () => {
    // 여행 at 277–326 on a 390px strip: visible, so no scroll (QA: "임라인" clip).
    expect(navScrollLeftFor({ ...strip, itemLeft: 277, itemWidth: 49 })).toBe(0);
  });

  it("nudges a pill out of the right fade without snapping back under it", () => {
    // 건강 at 328–376: 376 + 20 - 390 = 6 (only 타임라인's padding goes under the left fade).
    expect(navScrollLeftFor({ ...strip, itemLeft: 328, itemWidth: 48 })).toBe(6);
  });

  it("scrolls just far enough for an off-screen pill to clear the edge fade", () => {
    // 여행 ends at 400: 400 + 20 - 390 = 30.
    expect(navScrollLeftFor({ ...strip, itemLeft: 352, itemWidth: 48 })).toBe(30);
  });

  it("clamps the last item to the end of the scroll range", () => {
    // 검색 at 434px on a 390px strip (QA: off-screen with scrollLeft 0).
    expect(navScrollLeftFor({ ...strip, itemLeft: 434, itemWidth: 56 })).toBe(130);
  });

  it("scrolls back left for a pill hidden behind the left edge", () => {
    expect(navScrollLeftFor({ ...strip, itemLeft: 60, itemWidth: 50, scrollLeft: 130 })).toBe(40);
  });

  it("never scrolls a strip that fits", () => {
    expect(
      navScrollLeftFor({ itemLeft: 300, itemWidth: 60, viewportWidth: 600, scrollWidth: 520 })
    ).toBe(0);
  });
});

describe("navEdges", () => {
  it("fades only the edges with hidden pills", () => {
    expect(navEdges({ scrollLeft: 0, clientWidth: 390, scrollWidth: 520 })).toEqual({
      left: false,
      right: true,
    });
    expect(navEdges({ scrollLeft: 130, clientWidth: 390, scrollWidth: 520 })).toEqual({
      left: true,
      right: false,
    });
    expect(navEdges({ scrollLeft: 0, clientWidth: 600, scrollWidth: 600 })).toEqual({
      left: false,
      right: false,
    });
  });
});
