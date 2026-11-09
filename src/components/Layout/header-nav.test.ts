import { describe, expect, it } from "vitest";
import { HEADER_NAV_ITEMS, isNavItemActive } from "./header-nav";

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
