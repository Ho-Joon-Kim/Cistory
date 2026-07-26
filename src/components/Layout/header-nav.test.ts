import { describe, expect, it } from "vitest";
import { HEADER_NAV_ITEMS } from "./header-nav";

describe("header navigation", () => {
  it("has one overview link and retains the primary feature destinations", () => {
    expect(HEADER_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/spending",
      "/portfolio",
      "/travel",
      "/health",
      "/overview",
    ]);
    expect(HEADER_NAV_ITEMS.filter((item) => item.href === "/overview")).toHaveLength(1);
  });

  // /insights and /report stayed folded into /overview; /health kept its own
  // page because the overview only carries a five-number summary of it.
  it("keeps insights and report folded into the overview link", () => {
    expect(HEADER_NAV_ITEMS.some((item) => ["/insights", "/report"].includes(item.href))).toBe(
      false
    );
  });
});
