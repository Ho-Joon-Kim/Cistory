import { describe, expect, it } from "vitest";
import { isNap, stageBreakdown, stageSegments } from "./sleep";

// Cloud shape — captured verbatim from the 2026-07-26 Google Health live re-probe
// (platform: FITBIT): ISO stage times, string `type`, start under interval.startTime.
const cloudNight = {
  interval: { startTime: "2026-07-26T07:24:00Z", endTime: "2026-07-26T08:25:00Z" },
  type: "STAGES",
  stages: [
    { startTime: "2026-07-26T07:24:00Z", endTime: "2026-07-26T07:38:30Z", type: "AWAKE" },
    { startTime: "2026-07-26T07:38:30Z", endTime: "2026-07-26T07:57:30Z", type: "LIGHT" },
    { startTime: "2026-07-26T07:57:30Z", endTime: "2026-07-26T08:09:00Z", type: "DEEP" },
    { startTime: "2026-07-26T08:09:00Z", endTime: "2026-07-26T08:25:00Z", type: "REM" },
  ],
  metadata: { stagesStatus: "OK", processed: true, nap: false },
};

// Import shape — raw Health Connect records from the on-device importer: epoch
// millis and numeric stage codes, start at the record's top level.
const base = Date.UTC(2026, 2, 25, 14, 0, 0);
const importedNight = {
  startTime: base,
  endTime: base + 60 * 60_000,
  stages: [
    { startTime: base, endTime: base + 10 * 60_000, stage: 1 }, // awake
    { startTime: base + 10 * 60_000, endTime: base + 30 * 60_000, stage: 4 }, // light
    { startTime: base + 30 * 60_000, endTime: base + 45 * 60_000, stage: 5 }, // deep
    { startTime: base + 45 * 60_000, endTime: base + 60 * 60_000, stage: 6 }, // rem
  ],
};

describe("stageBreakdown", () => {
  it("sums the cloud shape's ISO spans by string stage type", () => {
    expect(stageBreakdown(cloudNight)).toEqual({
      awake: 14.5,
      light: 19,
      deep: 11.5,
      rem: 16,
    });
  });

  it("sums the on-device import shape's epoch-millis spans by numeric code", () => {
    expect(stageBreakdown(importedNight)).toEqual({ awake: 10, light: 20, deep: 15, rem: 15 });
  });

  it("returns null when the record carries no usable stages", () => {
    expect(stageBreakdown(null)).toBeNull();
    expect(stageBreakdown({ interval: { startTime: "2026-07-26T07:24:00Z" } })).toBeNull();
    expect(stageBreakdown({ stages: [] })).toBeNull();
    // Present but unrecognizable (unknown enum, zero-length span) → still null.
    expect(
      stageBreakdown({
        stages: [
          { startTime: "2026-07-26T07:24:00Z", endTime: "2026-07-26T07:30:00Z", type: "UNKNOWN" },
          { startTime: "2026-07-26T07:30:00Z", endTime: "2026-07-26T07:30:00Z", type: "DEEP" },
        ],
      })
    ).toBeNull();
  });
});

describe("stageSegments", () => {
  it("offsets the cloud shape from interval.startTime", () => {
    const segs = stageSegments(cloudNight);
    expect(segs).toEqual([
      { stage: "awake", startMin: 0, endMin: 14.5 },
      { stage: "light", startMin: 14.5, endMin: 33.5 },
      { stage: "deep", startMin: 33.5, endMin: 45 },
      { stage: "rem", startMin: 45, endMin: 61 },
    ]);
  });

  it("offsets the import shape from the record's top-level startTime", () => {
    const segs = stageSegments(importedNight);
    expect(segs?.[0]).toEqual({ stage: "awake", startMin: 0, endMin: 10 });
    expect(segs?.at(-1)).toEqual({ stage: "rem", startMin: 45, endMin: 60 });
  });

  it("falls back to the first stage's start when the session start is missing", () => {
    const segs = stageSegments({ stages: cloudNight.stages });
    expect(segs?.[0].startMin).toBe(0);
  });

  it("returns null when nothing is usable", () => {
    expect(stageSegments({ stages: [{ type: "DEEP" }] })).toBeNull();
    expect(stageSegments(undefined)).toBeNull();
  });
});

describe("isNap", () => {
  it("reads the cloud record's metadata flag", () => {
    expect(isNap(cloudNight)).toBe(false);
    expect(isNap({ ...cloudNight, metadata: { nap: true } })).toBe(true);
    expect(isNap(importedNight)).toBe(false);
  });
});
