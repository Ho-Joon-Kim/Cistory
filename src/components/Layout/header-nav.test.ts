import { describe, expect, it } from "vitest";
import { HEADER_NAV_ITEMS } from "./header-nav";

describe("header navigation", () => {
  it("has one overview link and retains the primary feature destinations", () => {
    expect(HEADER_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/spending",
      "/portfolio",
      "/travel",
      "/overview",
    ]);
    expect(HEADER_NAV_ITEMS.filter((item) => item.href === "/overview")).toHaveLength(1);
    expect(
      HEADER_NAV_ITEMS.some((item) => ["/insights", "/report", "/health"].includes(item.href))
    ).toBe(false);
  });
});
