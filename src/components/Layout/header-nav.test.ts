import { describe, expect, it } from "vitest";
import { HEADER_NAV_ITEMS, isNavItemActive, navScrollLeftFor } from "./header-nav";

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

  it("centres an item in the middle of the strip", () => {
    expect(navScrollLeftFor({ ...strip, scrollWidth: 600, itemLeft: 300, itemWidth: 60 })).toBe(
      135
    );
  });

  it("clamps the last item to the end of the scroll range", () => {
    // 검색 at 434px on a 390px strip (QA: off-screen with scrollLeft 0).
    expect(navScrollLeftFor({ ...strip, itemLeft: 434, itemWidth: 56 })).toBe(130);
  });

  it("never scrolls a strip that fits", () => {
    expect(
      navScrollLeftFor({ itemLeft: 300, itemWidth: 60, viewportWidth: 600, scrollWidth: 520 })
    ).toBe(0);
  });
});
