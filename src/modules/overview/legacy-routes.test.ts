process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { legacyOverviewRedirect } from "./legacy-routes";

const NOW = new Date("2026-07-22T03:00:00.000Z");

describe("legacy overview redirects", () => {
  it("maps insights to a canonical annual overview and preserves year", () => {
    expect(legacyOverviewRedirect("insights", {}, NOW)).toBe(
      "/overview?periodType=year&periodKey=2026"
    );
    expect(legacyOverviewRedirect("insights", { year: "2025" }, NOW)).toBe(
      "/overview?periodType=year&periodKey=2025"
    );
  });

  it("maps monthly and yearly reports with their selected period", () => {
    expect(legacyOverviewRedirect("report", { type: "monthly", period: "2026-07" }, NOW)).toBe(
      "/overview?periodType=month&periodKey=2026-07"
    );
    expect(legacyOverviewRedirect("report", { period: "monthly", yearMonth: "2025-11" }, NOW)).toBe(
      "/overview?periodType=month&periodKey=2025-11"
    );
    expect(legacyOverviewRedirect("report", { type: "yearly", period: "2025" }, NOW)).toBe(
      "/overview?periodType=year&periodKey=2025"
    );
  });

  it("falls back for invalid report periods and ignores unrelated parameters", () => {
    expect(
      legacyOverviewRedirect(
        "report",
        { type: "monthly", period: "2026-13", yearMonth: "2024-02", next: "/admin" },
        NOW
      )
    ).toBe("/overview?periodType=month&periodKey=2026-07");
    expect(
      legacyOverviewRedirect(
        "report",
        { period: "monthly", yearMonth: "2026-00", year: "2020" },
        NOW
      )
    ).toBe("/overview?periodType=month&periodKey=2026-07");
    expect(legacyOverviewRedirect("report", { type: "yearly", period: "20x5" }, NOW)).toBe(
      "/overview?periodType=year&periodKey=2026"
    );
  });

  it("preserves comparison selections in canonical year state", () => {
    expect(legacyOverviewRedirect("comparison", { year1: "2023", year2: "2025" }, NOW)).toBe(
      "/overview?mode=comparison&periodType=year&periodKey=2025&year1=2023&year2=2025"
    );
  });
});
