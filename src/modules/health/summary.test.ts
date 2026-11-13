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
});
