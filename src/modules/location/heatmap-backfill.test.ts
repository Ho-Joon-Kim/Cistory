process.env.TZ = "Asia/Seoul";

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  backfillMissingLocationHeatmaps,
  type HeatmapBackfillCandidate,
  loadMissingLocationHeatmapDays,
  parseHeatmapBackfillOptions,
} from "./heatmap-backfill";

const dialect = new PgDialect();

function executorWithRows(rows: unknown[]) {
  const queries: unknown[] = [];
  return {
    executor: {
      execute: vi.fn(async (query) => {
        queries.push(query);
        return { rows };
      }),
      transaction: vi.fn(),
    },
    queries,
  };
}

describe("parseHeatmapBackfillOptions", () => {
  it("is dry-run by default and clamps a batch to the invocation limit", () => {
    expect(parseHeatmapBackfillOptions(["--limit=3", "--batch-size=25"])).toEqual({
      apply: false,
      limit: 3,
      batchSize: 3,
    });
  });

  it("validates bounded options and KST calendar-date filters", () => {
    expect(() => parseHeatmapBackfillOptions(["--limit=5001"])).toThrow("--limit");
    expect(() => parseHeatmapBackfillOptions(["--batch-size=101"])).toThrow("--batch-size");
    expect(() => parseHeatmapBackfillOptions(["--from=2026-02-30"])).toThrow("calendar date");
    expect(() => parseHeatmapBackfillOptions(["--from=2026-07-23", "--to=2026-07-22"])).toThrow(
      "must not be after"
    );
  });
});

describe("loadMissingLocationHeatmapDays", () => {
  it("uses KST raw days, missing rollup rows, filters, ordering, and a bounded limit", async () => {
    const { executor, queries } = executorWithRows([{ userId: "user-1", date: "2026-07-22" }]);
    const options = parseHeatmapBackfillOptions([
      "--user=user-1",
      "--from=2026-07-01",
      "--to=2026-07-22",
    ]);

    await expect(loadMissingLocationHeatmapDays(executor, options, 10_000)).resolves.toEqual([
      { userId: "user-1", date: "2026-07-22" },
    ]);

    const statement = dialect.sqlToQuery(queries[0] as never);
    expect(statement.sql).toContain("at time zone 'UTC' at time zone 'Asia/Seoul'");
    expect(statement.sql).toContain("NOT EXISTS");
    expect(statement.sql).toContain("location_heatmap_daily");
    expect(statement.sql).toContain("ORDER BY raw_days.date ASC, raw_days.user_id ASC");
    expect(statement.params).toContain("user-1");
    expect(statement.params).toContain("2026-07-01");
    expect(statement.params).toContain("2026-07-22");
    expect(statement.params.at(-1)).toBe(5_000);
  });
});

describe("backfillMissingLocationHeatmaps", () => {
  const candidate = (date: string): HeatmapBackfillCandidate => ({ userId: "user-1", date });

  it("does not write in dry-run mode", async () => {
    const loadCandidates = vi.fn(async () => [candidate("2026-07-20")]);
    const rebuildDay = vi.fn();

    const result = await backfillMissingLocationHeatmaps(
      {} as never,
      parseHeatmapBackfillOptions([]),
      { loadCandidates, rebuildDay }
    );

    expect(result).toEqual({
      mode: "dry-run",
      candidates: [candidate("2026-07-20")],
      rebuilt: 0,
    });
    expect(rebuildDay).not.toHaveBeenCalled();
  });

  it("re-queries bounded batches so successful days disappear and a rerun resumes", async () => {
    const loadCandidates = vi
      .fn()
      .mockResolvedValueOnce([candidate("2026-07-20"), candidate("2026-07-21")])
      .mockResolvedValueOnce([candidate("2026-07-22")]);
    const rebuildDay = vi.fn(async () => undefined);
    const options = parseHeatmapBackfillOptions(["--apply", "--limit=3", "--batch-size=2"]);

    const result = await backfillMissingLocationHeatmaps({} as never, options, {
      loadCandidates,
      rebuildDay,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    expect(loadCandidates.mock.calls.map((call) => call[2])).toEqual([2, 1]);
    expect(rebuildDay.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      ["user-1", "2026-07-20"],
      ["user-1", "2026-07-21"],
      ["user-1", "2026-07-22"],
    ]);
    expect(result.rebuilt).toBe(3);
  });

  it("stops immediately on a failed day, leaving it missing for the next invocation", async () => {
    const loadCandidates = vi.fn(async () => [candidate("2026-07-20"), candidate("2026-07-21")]);
    const rebuildDay = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      backfillMissingLocationHeatmaps(
        {} as never,
        parseHeatmapBackfillOptions(["--apply", "--batch-size=2"]),
        { loadCandidates, rebuildDay }
      )
    ).rejects.toThrow("database unavailable");
    expect(rebuildDay).toHaveBeenCalledTimes(2);
  });
});
