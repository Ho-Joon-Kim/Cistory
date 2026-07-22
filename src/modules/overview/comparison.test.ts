import { describe, expect, it, vi } from "vitest";
import {
  buildOverviewComparison,
  loadComparisonSnapshots,
  loadStoredOverviewComparison,
  resolveComparisonYears,
} from "./comparison";
import type { OverviewSnapshotResponse } from "./service";

function ready(year: string, commits: number): OverviewSnapshotResponse {
  return {
    status: "ready",
    periodType: "year",
    periodKey: year,
    computedAt: `${year}-12-31T15:00:00.000Z`,
    domains: {
      coding: {
        status: "ready",
        computedAt: `${year}-12-31T15:00:00.000Z`,
        computeVersion: 1,
        errorCode: null,
        data: {
          totalCommits: commits,
          totalAdditions: 0,
          totalDeletions: 0,
          activeDays: 10,
          dailyCommits: [],
          commitTypes: [],
          projects: [],
          totalCodingSeconds: commits * 3600,
          dailyCodingSeconds: [],
          languages: [],
          deepWorkSessions: [],
          contextSwitching: { avgDailyProjects: 0, avgDailyLanguages: 0 },
          weekdayHour: { weekdays: [], hours: [] },
        },
      },
      location: null,
      health: null,
      spending: null,
      portfolio: null,
    },
  };
}

describe("overview comparison", () => {
  it("defaults and canonicalizes two ordered annual keys", () => {
    expect(resolveComparisonYears(null, null, new Date("2026-07-22T03:00:00Z"))).toEqual({
      year1: "2025",
      year2: "2026",
    });
    expect(resolveComparisonYears("2023", "2025", new Date("2026-07-22T03:00:00Z"))).toEqual({
      year1: "2023",
      year2: "2025",
    });
  });

  it("loads both snapshots through GET-only readers", async () => {
    const getSnapshot = vi.fn(async (year: string) => ready(year, year === "2025" ? 10 : 15));
    const result = await loadComparisonSnapshots("2025", "2026", getSnapshot);

    expect(getSnapshot.mock.calls).toEqual([["2025"], ["2026"]]);
    expect(result.every((snapshot) => snapshot.status === "ready")).toBe(true);
  });

  it("uses only GET requests on the comparison hook boundary", async () => {
    const request = vi.fn(async (input: string) => {
      const year = new URL(input, "https://example.com").searchParams.get("periodKey") ?? "";
      return { ok: true, json: async () => ready(year, 1) };
    });
    const controller = new AbortController();

    await loadStoredOverviewComparison("2025", "2026", controller.signal, request);

    expect(request.mock.calls).toEqual([
      ["/api/overview?periodType=year&periodKey=2025", { signal: controller.signal }],
      ["/api/overview?periodType=year&periodKey=2026", { signal: controller.signal }],
    ]);
    expect(request.mock.calls.every(([, init]) => !("method" in init))).toBe(true);
  });

  it("compares stored snapshot values without report aggregation", () => {
    expect(buildOverviewComparison(ready("2025", 10), ready("2026", 15))).toMatchObject({
      year1: "2025",
      year2: "2026",
      metrics: [
        { key: "commits", first: 10, second: 15, delta: 5 },
        { key: "codingSeconds", first: 36000, second: 54000, delta: 18000 },
      ],
    });
  });
});
