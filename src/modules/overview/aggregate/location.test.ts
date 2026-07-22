process.env.TZ = "Asia/Seoul";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  aggregateDerivedLocation,
  aggregatePeriodHeatmap,
  type LocationQueryExecutor,
  type LocationReadExecutor,
  rebuildDailyLocationHeatmap,
} from "./location";

const dialect = new PgDialect();

function compiled(query: SQL) {
  return dialect.sqlToQuery(query);
}

function createReadExecutor(rowBatches: unknown[][]) {
  const queries: SQL[] = [];
  const execute = vi.fn(async (query: SQL) => {
    queries.push(query);
    return { rows: rowBatches.shift() ?? [] };
  });

  return {
    executor: { execute } satisfies LocationReadExecutor,
    queries,
  };
}

function createTransactionalExecutor() {
  const queries: SQL[] = [];
  const transactionExecute = vi.fn(async (query: SQL) => {
    queries.push(query);
    return { rows: [] };
  });
  const transaction = vi.fn(async <T>(callback: (tx: LocationReadExecutor) => Promise<T>) =>
    callback({ execute: transactionExecute })
  );

  return {
    executor: { execute: transactionExecute, transaction } satisfies LocationQueryExecutor,
    queries,
  };
}

const range = {
  userId: "26d4c50e-42fd-4701-b3cc-1d92d826eabd",
  from: new Date("2026-07-19T15:00:00.000Z"),
  toExclusive: new Date("2026-07-26T15:00:00.000Z"),
};

describe("aggregateDerivedLocation", () => {
  it("aggregates visits, tracks, and transport modes without reading raw points", async () => {
    const { executor, queries } = createReadExecutor([
      [
        {
          placeName: "Office",
          centerLat: 37.5,
          centerLon: 127.03,
          visitCount: 2,
          durationSeconds: 7_200,
        },
      ],
      [{ trackCount: 2, distanceMeters: 12_500, durationSeconds: 1_800 }],
      [
        { mode: "walking", segmentCount: 2, distanceMeters: 1_000, durationSeconds: 900 },
        { mode: "unknown", segmentCount: 1, distanceMeters: 500, durationSeconds: 300 },
      ],
    ]);

    const result = await aggregateDerivedLocation(executor, range);

    expect(result).toEqual({
      visits: {
        count: 2,
        durationSeconds: 7_200,
        uniquePlaceCount: 1,
        places: [
          {
            placeName: "Office",
            centerLat: 37.5,
            centerLon: 127.03,
            visitCount: 2,
            durationSeconds: 7_200,
          },
        ],
      },
      tracks: { count: 2, distanceMeters: 12_500, durationSeconds: 1_800 },
      transportModes: expect.any(Array),
    });
    expect(result.transportModes[0]).toMatchObject({
      mode: "walking",
      segmentCount: 2,
      distanceMeters: 1_000,
      durationSeconds: 900,
    });
    expect(result.transportModes[0].sharePercent).toBeCloseTo(1000 / 15);
    expect(result.transportModes[1]).toMatchObject({
      mode: "unknown",
      segmentCount: 1,
      distanceMeters: 500,
      durationSeconds: 300,
    });
    expect(result.transportModes[1].sharePercent).toBeCloseTo(500 / 15);
    expect(result.transportModes.reduce((sum, mode) => sum + mode.sharePercent, 0)).toBeCloseTo(
      100
    );

    const statements = queries.map((query) => compiled(query).sql).join("\n");
    expect(statements).toContain("visits");
    expect(statements).toContain("tracks");
    expect(statements).toContain("transportation_segments");
    expect(statements).not.toContain("location_points");
  });

  it("returns empty values when no derived rows exist", async () => {
    const { executor } = createReadExecutor([[], [], []]);

    await expect(aggregateDerivedLocation(executor, range)).resolves.toEqual({
      visits: { count: 0, durationSeconds: 0, uniquePlaceCount: 0, places: [] },
      tracks: { count: 0, distanceMeters: 0, durationSeconds: 0 },
      transportModes: [],
    });
  });

  it("keeps transport results when no tracks exist and includes unknown in shares", async () => {
    const { executor } = createReadExecutor([
      [],
      [],
      [{ mode: "unknown", segmentCount: 1, distanceMeters: 0, durationSeconds: 600 }],
    ]);

    const result = await aggregateDerivedLocation(executor, range);

    expect(result.tracks).toEqual({ count: 0, distanceMeters: 0, durationSeconds: 0 });
    expect(result.transportModes).toEqual([
      {
        mode: "unknown",
        segmentCount: 1,
        distanceMeters: 0,
        durationSeconds: 600,
        sharePercent: 100,
      },
    ]);
  });

  it("filters visits by their start time using KST period boundaries", async () => {
    const { executor, queries } = createReadExecutor([[], [], []]);

    await aggregateDerivedLocation(executor, range);

    const visitQuery = compiled(queries[0]);
    expect(visitQuery.sql).toMatch(/start_time[\s\S]*>=[\s\S]*start_time[\s\S]*</);
    expect(visitQuery.params).toContainEqual(range.from);
    expect(visitQuery.params).toContainEqual(range.toExclusive);
  });
});

describe("location heatmap rollups", () => {
  it("aggregates a period from daily rollups without reading location_points", async () => {
    const { executor, queries } = createReadExecutor([
      [
        { lat: 37.5, lon: 127.03, weight: 4 },
        { lat: 37.501, lon: 127.031, weight: 2 },
      ],
    ]);

    await expect(aggregatePeriodHeatmap(executor, range)).resolves.toEqual([
      { lat: 37.5, lon: 127.03, weight: 4 },
      { lat: 37.501, lon: 127.031, weight: 2 },
    ]);

    const statement = compiled(queries[0]);
    expect(statement.sql).toContain("location_heatmap_daily");
    expect(statement.sql).not.toContain("location_points");
    expect(statement.params).toContain("2026-07-20");
    expect(statement.params).toContain("2026-07-27");
  });

  it("delete-and-rebuilds one KST day on every run, preventing duplicate grids", async () => {
    const { executor, queries } = createTransactionalExecutor();
    const calculatedAt = new Date("2026-07-22T03:00:00.000Z");

    await rebuildDailyLocationHeatmap(executor, range.userId, "2026-07-22", calculatedAt);
    await rebuildDailyLocationHeatmap(executor, range.userId, "2026-07-22", calculatedAt);

    expect(queries).toHaveLength(4);
    for (let index = 0; index < queries.length; index += 2) {
      const deletion = compiled(queries[index]);
      const insertion = compiled(queries[index + 1]);
      expect(deletion.sql).toMatch(/delete from .*location_heatmap_daily/i);
      expect(insertion.sql).toMatch(/insert into .*location_heatmap_daily/i);
      expect(insertion.sql).toContain("location_points");
      expect(insertion.sql).toContain("Asia/Seoul");
      expect(deletion.params).toContain("2026-07-22");
      expect(insertion.params).toContain("2026-07-22");
    }
  });

  it("rejects invalid calendar dates before opening a transaction", async () => {
    const { executor } = createTransactionalExecutor();

    await expect(rebuildDailyLocationHeatmap(executor, range.userId, "2026-02-30")).rejects.toThrow(
      "Invalid local date"
    );
    expect(executor.transaction).not.toHaveBeenCalled();
  });
});
