import { describe, expect, it } from "vitest";
import { summarizeArgs } from "../audit";
import { toolsForScopes } from "../server";
import { HEALTH_TOOLS } from "./health";
import { LOCATION_TOOLS } from "./location";
import { OVERVIEW_SEARCH_TOOLS } from "./overview-search";
import { PHOTOS_TOOLS } from "./photos";
import { PLACES_TRIPS_TOOLS } from "./places-trips";
import { PORTFOLIO_TOOLS } from "./portfolio";
import { SPENDING_TOOLS } from "./spending";
import { WORK_TOOLS } from "./work";

const READ_TOOLS = [
  ...LOCATION_TOOLS,
  ...PLACES_TRIPS_TOOLS,
  ...SPENDING_TOOLS,
  ...HEALTH_TOOLS,
  ...WORK_TOOLS,
  ...PORTFOLIO_TOOLS,
  ...OVERVIEW_SEARCH_TOOLS,
  ...PHOTOS_TOOLS,
];

describe("U7 read tool set", () => {
  it("pins the tool names", () => {
    expect(READ_TOOLS.map((t) => t.name)).toEqual([
      "current_location",
      "location_history",
      "gps_points",
      "saved_places",
      "trips",
      "trip_detail",
      "spending",
      "spending_forecast",
      "health",
      "health_rhythm",
      "work",
      "portfolio",
      "overview",
      "search",
      "photos",
      "photo_thumbnails",
    ]);
  });

  it("are all read-only, and only health_rhythm needs sensitive-read", () => {
    for (const tool of READ_TOOLS) {
      expect(tool.kind).toBe("read");
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.argRules).toBeDefined();
    }
    expect(READ_TOOLS.filter((t) => t.scope === "sensitive-read").map((t) => t.name)).toEqual([
      "health_rhythm",
    ]);
    expect(toolsForScopes(READ_TOOLS, ["read"])).toHaveLength(READ_TOOLS.length - 1);
  });

  it("audits search text and photo coordinates only as digests/absent", () => {
    const search = OVERVIEW_SEARCH_TOOLS.find((t) => t.name === "search")!;
    const summary = summarizeArgs({ q: "김철수", source: "spending" }, search.argRules);
    expect(summary.q).toEqual({ len: 3, sha256: expect.any(String) });
    expect(summary.source).toBe("spending");
    const photos = PHOTOS_TOOLS.find((t) => t.name === "photos")!;
    expect(summarizeArgs({ near: { lat: 37.5, lon: 127, radiusM: 100 } }, photos.argRules)).toEqual(
      {}
    );
  });
});
