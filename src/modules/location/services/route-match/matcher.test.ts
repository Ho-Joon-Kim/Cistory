import { describe, expect, it, vi } from "vitest";
import type { MapMatchingAdapter, MatchPoint } from "@/lib/adapters/map-matching/valhalla";
import { logger } from "@/lib/logger";
import {
  buildRowForSegment,
  currentTileVersion,
  matchRoutesForDay,
  summarizeRouteMatches,
} from "./matcher";

const NOW = new Date("2026-08-07T03:00:00.000Z");
const TILE_VERSION = "2026-08-07-testfingerprint";

function segment(mode: string) {
  return {
    id: `segment-${mode}`,
    userId: "user-1",
    mode,
    startTime: new Date("2026-08-07T00:00:00.000Z"),
    endTime: new Date("2026-08-07T00:10:00.000Z"),
  };
}

function point(timestamp = new Date("2026-08-07T00:00:00.000Z")): MatchPoint {
  return { lat: 37.5, lon: 127, timestamp };
}

function adapter(): MapMatchingAdapter {
  return {
    match: vi.fn().mockResolvedValue({
      status: "matched",
      shape: [[37.5, 127, NOW.getTime()]],
      roadNames: ["테스트로"],
      roadClasses: ["residential"],
      confidence: 0.9,
    }),
  };
}

describe("buildRowForSegment", () => {
  it("writes subway as not_applicable without loading points or calling the adapter", async () => {
    const loadPoints = vi.fn<() => Promise<MatchPoint[]>>();
    const matcher = adapter();

    const row = await buildRowForSegment(segment("subway"), loadPoints, matcher, TILE_VERSION, NOW);

    expect(row).toMatchObject({
      matchStatus: "not_applicable",
      shape: null,
      costing: null,
    });
    expect(loadPoints).not.toHaveBeenCalled();
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it("skips stationary segments without loading points or calling the adapter", async () => {
    const loadPoints = vi.fn<() => Promise<MatchPoint[]>>();
    const matcher = adapter();

    const row = await buildRowForSegment(
      segment("stationary"),
      loadPoints,
      matcher,
      TILE_VERSION,
      NOW
    );

    expect(row).toBeNull();
    expect(loadPoints).not.toHaveBeenCalled();
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it("matches cycling with bicycle costing and persists the costing", async () => {
    const points = [point(), point(new Date("2026-08-07T00:01:00.000Z"))];
    const loadPoints = vi.fn().mockResolvedValue(points);
    const matcher = adapter();

    const row = await buildRowForSegment(
      segment("cycling"),
      loadPoints,
      matcher,
      TILE_VERSION,
      NOW
    );

    expect(matcher.match).toHaveBeenCalledWith(points, "bicycle");
    expect(row).toMatchObject({ matchStatus: "matched", costing: "bicycle" });
  });

  it("writes failed without calling the adapter when the segment has no points", async () => {
    const loadPoints = vi.fn().mockResolvedValue([]);
    const matcher = adapter();

    const row = await buildRowForSegment(
      segment("cycling"),
      loadPoints,
      matcher,
      TILE_VERSION,
      NOW
    );

    expect(row).toMatchObject({ matchStatus: "failed", costing: "bicycle" });
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it("turns an adapter exception into a failed row for that segment", async () => {
    const matcher: MapMatchingAdapter = {
      match: vi.fn().mockRejectedValue(new Error("Valhalla unavailable")),
    };

    await expect(
      buildRowForSegment(
        segment("driving"),
        vi.fn().mockResolvedValue([point()]),
        matcher,
        TILE_VERSION,
        NOW
      )
    ).resolves.toMatchObject({ matchStatus: "failed", costing: "auto" });
  });

  it("lets point-loader database failures abort the operation", async () => {
    await expect(
      buildRowForSegment(
        segment("driving"),
        vi.fn().mockRejectedValue(new Error("database unavailable")),
        adapter(),
        TILE_VERSION,
        NOW
      )
    ).rejects.toThrow("database unavailable");
  });
});

describe("summarizeRouteMatches", () => {
  it("counts statuses and derives skipped segments from rows written", () => {
    expect(
      summarizeRouteMatches(
        [
          { matchStatus: "matched" },
          { matchStatus: "matched" },
          { matchStatus: "low_confidence" },
          { matchStatus: "no_road_match" },
          { matchStatus: "failed" },
          { matchStatus: "not_applicable" },
        ],
        8
      )
    ).toEqual({
      segmentsConsidered: 8,
      matched: 2,
      lowConfidence: 1,
      noRoadMatch: 1,
      failed: 1,
      notApplicable: 1,
      skipped: 2,
    });
  });
});

describe("currentTileVersion", () => {
  it("uses the KST build date even when UTC is still on the previous day", () => {
    expect(currentTileVersion(new Date("2026-08-06T15:30:00.000Z"))).toMatch(
      /^2026-08-07-[a-f0-9]{12}$/
    );
  });
});

describe("matchRoutesForDay", () => {
  it("logs only once and returns zero results when VALHALLA_URL is unset", async () => {
    vi.stubEnv("VALHALLA_URL", "");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    const first = await matchRoutesForDay("user-1", "2026-08-07");
    const second = await matchRoutesForDay("user-1", "2026-08-08");

    expect(first).toEqual({
      segmentsConsidered: 0,
      matched: 0,
      lowConfidence: 0,
      noRoadMatch: 0,
      failed: 0,
      notApplicable: 0,
      skipped: 0,
    });
    expect(second).toEqual(first);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});
