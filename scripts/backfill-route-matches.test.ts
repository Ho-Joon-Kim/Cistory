process.env.TZ = "Asia/Seoul";

import { describe, expect, it, vi } from "vitest";
import { runRouteMatchBackfill } from "./backfill-route-matches";
import { parseArgs, resolveDateRange } from "./lib/backfill-args";

describe("route-match backfill arguments", () => {
  it("parses a valid user and date range", () => {
    expect(parseArgs(["user-1", "2026-07-01", "2026-07-03", "--dry-run"])).toEqual({
      userId: "user-1",
      fromDate: "2026-07-01",
      toDate: "2026-07-03",
      dryRun: true,
    });
    expect(resolveDateRange("2026-07-01", "2026-07-03")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  it.each(["--dryrun", "-dry-run"])("rejects mistyped flag %s", (flag) => {
    const parsed = parseArgs(["user-1", "2026-07-01", "2026-07-03", flag]);

    expect(parsed).toHaveProperty("error");
    expect(parsed).not.toHaveProperty("dryRun", false);
  });
});

describe("runRouteMatchBackfill", () => {
  const dryRunArgs = {
    userId: "user-1",
    fromDate: "2026-07-01",
    toDate: "2026-07-02",
    dryRun: true,
  };
  const dates = ["2026-07-01", "2026-07-02"];

  it("only reads the distribution during a dry run and never invokes the matcher", async () => {
    const matchRoutesForDay = vi.fn();
    const loadModeCounts = vi.fn().mockResolvedValue({ driving: 3, walking: 2 });
    const log = vi.fn();

    const result = await runRouteMatchBackfill(dryRunArgs, dates, {
      loadModeCounts,
      log,
      matchRoutesForDay,
      valhallaUrl: undefined,
    });

    expect(loadModeCounts).toHaveBeenCalledOnce();
    expect(loadModeCounts).toHaveBeenCalledWith("user-1", "2026-07-01", "2026-07-02");
    expect(matchRoutesForDay).not.toHaveBeenCalled();
    expect(result).toEqual({ failedDays: [], dryRun: true });
    expect(log.mock.calls.flat().join("\n")).toContain("driving=3, walking=2");
  });

  it("refuses an apply run when VALHALLA_URL is missing", async () => {
    const matchRoutesForDay = vi.fn();

    await expect(
      runRouteMatchBackfill({ ...dryRunArgs, dryRun: false }, dates, {
        loadModeCounts: vi.fn(),
        log: vi.fn(),
        matchRoutesForDay,
        valhallaUrl: undefined,
      })
    ).rejects.toThrow(/VALHALLA_URL/);
    expect(matchRoutesForDay).not.toHaveBeenCalled();
  });

  it("runs one day at a time, isolates failures, and reports failed dates", async () => {
    let active = 0;
    let maxActive = 0;
    const matchRoutesForDay = vi.fn(async (_userId: string, date: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      if (date === "2026-07-01") throw new Error("Valhalla unavailable");
      return {
        segmentsConsidered: 2,
        matched: 1,
        lowConfidence: 0,
        noRoadMatch: 0,
        tooShort: 0,
        failed: 0,
        notApplicable: 1,
        skipped: 0,
      };
    });

    const result = await runRouteMatchBackfill({ ...dryRunArgs, dryRun: false }, dates, {
      loadModeCounts: vi.fn(),
      log: vi.fn(),
      matchRoutesForDay,
      valhallaUrl: "http://valhalla:8002",
    });

    expect(maxActive).toBe(1);
    expect(matchRoutesForDay).toHaveBeenNthCalledWith(1, "user-1", "2026-07-01");
    expect(matchRoutesForDay).toHaveBeenNthCalledWith(2, "user-1", "2026-07-02");
    expect(result.failedDays.map(({ date }) => date)).toEqual(["2026-07-01"]);
  });
});
