import { describe, expect, it } from "vitest";
import { fillDateRange } from "./utils";

describe("fillDateRange", () => {
  it("anchors today on the KST calendar day, not the runtime's local day", () => {
    // 2026-11-09T15:30Z is 2026-11-10 00:30 KST — still the 9th in UTC.
    const now = new Date("2026-11-09T15:30:00Z");
    const entries = fillDateRange({ "2026-11-10": [] }, now);
    expect(entries.map((e) => e.date)).toEqual(["2026-11-10"]);
  });

  it("fills every day from KST today back to the oldest key, newest first", () => {
    const now = new Date("2026-11-09T15:30:00Z");
    const entries = fillDateRange({ "2026-11-07": [] }, now);
    expect(entries.map((e) => e.date)).toEqual([
      "2026-11-10",
      "2026-11-09",
      "2026-11-08",
      "2026-11-07",
    ]);
    expect(entries.every((e) => e.isEmpty)).toBe(true);
  });

  it("crosses month boundaries", () => {
    const now = new Date("2026-03-01T03:00:00Z");
    const entries = fillDateRange({ "2026-02-27": [] }, now);
    expect(entries.map((e) => e.date)).toEqual(["2026-03-01", "2026-02-28", "2026-02-27"]);
  });

  it("returns nothing when there are no keys", () => {
    expect(fillDateRange({})).toEqual([]);
  });
});
