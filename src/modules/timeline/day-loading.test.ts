import { describe, expect, it } from "vitest";
import { type DayPending, daySections } from "./day-loading";

const settled: DayPending = {
  locations: false,
  stayPoints: false,
  tracks: false,
  commits: false,
  transactions: false,
  health: false,
  distances: false,
};

describe("daySections", () => {
  it("never calls a day empty while any list source is still loading", () => {
    // Regression: a slow request rendered "이날 남은 기록이 없어요" until it landed.
    for (const key of ["stayPoints", "tracks", "commits", "transactions", "health"] as const) {
      expect(daySections({ ...settled, [key]: true }, 0).list).toBe("loading");
    }
  });

  it("shows rows once the core sources settle, even while health is slow", () => {
    expect(daySections({ ...settled, health: true }, 3).list).toBe("rows");
  });

  it("keeps the list a skeleton while a core source is pending, rows or not", () => {
    expect(daySections({ ...settled, commits: true }, 3).list).toBe("loading");
  });

  it("is empty only after every source settled with nothing", () => {
    expect(daySections(settled, 0).list).toBe("empty");
  });

  it("keeps the map's pill and camera fit back until locations, stays and rides settle", () => {
    expect(daySections({ ...settled, locations: true }, 0).mapLoading).toBe(true);
    expect(daySections({ ...settled, stayPoints: true }, 0).mapLoading).toBe(true);
    // Rides widen the day's bounds: fitting before them meant a second camera jump.
    expect(daySections({ ...settled, tracks: true }, 0).mapLoading).toBe(true);
    expect(daySections({ ...settled, commits: true }, 0).mapLoading).toBe(false);
  });

  it("holds the summary line until every source it reads has settled", () => {
    expect(daySections(settled, 0).summaryReady).toBe(true);
    for (const key of Object.keys(settled) as (keyof DayPending)[]) {
      expect(daySections({ ...settled, [key]: true }, 2).summaryReady).toBe(false);
    }
  });
});
