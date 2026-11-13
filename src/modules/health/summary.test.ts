import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";
import { getHealthSummary } from "./summary";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T03:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("getHealthSummary", () => {
  it("defaults to the rolling 30-day window with no upper bound", async () => {
    const fake = createMockDb([[], [], [], [], []]);
    await getHealthSummary("user-1", {}, fake.db);
    const [, summaries, samples, exercise, sleep] = fake.whereParams();
    expect(summaries).toEqual(["user-1", ...summaries.slice(1, -1), "2026-10-14"]);
    expect(samples.at(-1)).toEqual(new Date("2026-10-13T03:00:00Z").toISOString());
    expect(exercise).toHaveLength(3);
    // sleep: newest nights of any age
    expect(sleep).toEqual(["user-1", "sleep"]);
    const sleepLimit = fake.calls[4].chain.find((s) => s.method === "limit")?.args[0];
    expect(sleepLimit).toBe(40);
  });

  it("bounds every series to the requested KST days", async () => {
    const fake = createMockDb([[], [], [], [], []]);
    await getHealthSummary("user-1", { period: { from: "2026-09-01", to: "2026-09-30" } }, fake.db);
    const [, summaries, samples, exercise, sleep] = fake.whereParams();
    expect(summaries.slice(-2)).toEqual(["2026-09-01", "2026-09-30"]);
    const start = new Date("2026-08-31T15:00:00Z").toISOString();
    const end = new Date("2026-09-30T15:00:00Z").toISOString();
    expect(samples.slice(-2)).toEqual([start, end]);
    expect(exercise.slice(-2)).toEqual([start, end]);
    expect(sleep.slice(-2)).toEqual([start, end]);
    for (const params of fake.whereParams()) expect(params[0]).toBe("user-1");
  });

  it("reports pre-cut totals for a period's workout and night lists", async () => {
    const at = (i: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, i));
    const exercise = Array.from({ length: 105 }, (_, i) => ({
      sampleAt: at(i),
      source: "FITBIT",
      value: 30,
      valueJson: {},
    }));
    const nights = Array.from({ length: 120 }, (_, i) => ({
      sampleAt: at(i),
      source: "FITBIT",
      minutes: 400,
    }));
    const sleepList = nights.slice(0, 2).map((n) => ({ ...n, valueJson: null }));
    const fake = createMockDb([[], [], [], exercise, sleepList, nights]);
    const out = await getHealthSummary(
      "user-1",
      { period: { from: "2026-09-01", to: "2026-09-30" } },
      fake.db
    );
    expect(out.workouts).toHaveLength(100);
    expect(out.periodListTotals).toEqual({
      workouts: { total: 105, truncated: true },
      sleepSessions: { total: 120, truncated: true },
    });
  });

  it("leaves the /health page response without list totals", async () => {
    const fake = createMockDb([[], [], [], [], []]);
    const out = await getHealthSummary("user-1", {}, fake.db);
    expect(out).not.toHaveProperty("periodListTotals");
  });
});
