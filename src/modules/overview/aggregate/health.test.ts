process.env.TZ = "Asia/Seoul";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { aggregateHealth } from "./health";
import type { LocationReadExecutor } from "./location";

const dialect = new PgDialect();

const input = {
  userId: "26d4c50e-42fd-4701-b3cc-1d92d826eabd",
  periodType: "week" as const,
  periodKey: "2026-W30",
  computedAt: new Date("2026-07-22T03:00:00.000Z"),
  computeVersion: 3,
  from: new Date("2026-07-19T15:00:00.000Z"),
  toExclusive: new Date("2026-07-26T15:00:00.000Z"),
};

function createExecutor(rowBatches: unknown[][]) {
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

describe("aggregateHealth", () => {
  it("transforms all four metrics and computes body changes through the query executor", async () => {
    const { executor, queries } = createExecutor([
      [
        {
          day: "2026-07-20",
          metric: "steps",
          average: "4000",
          min: "1000",
          max: "7000",
          total: "8000",
        },
        {
          day: "2026-07-21",
          metric: "steps",
          average: 5_000,
          min: 2_000,
          max: 8_000,
          total: 10_000,
        },
        {
          day: "2026-07-20",
          metric: "sleep",
          average: 420,
          min: 390,
          max: 450,
          total: 420,
        },
        {
          day: "2026-07-21",
          metric: "heart_rate",
          average: 62,
          min: 48,
          max: 121,
          total: null,
        },
        {
          day: "2026-07-22",
          metric: "heart_rate",
          average: 66,
          min: 50,
          max: 128,
          total: null,
        },
        {
          day: "2026-07-22",
          metric: "vo2_max",
          average: 44.5,
          min: 44.5,
          max: 44.5,
          total: null,
        },
      ],
      [
        {
          measuredAt: new Date("2026-07-20T00:00:00.000Z"),
          day: "2026-07-20",
          weightKg: "72.4",
          fatRatioPct: "18.4",
          muscleMassKg: "55.1",
        },
        {
          measuredAt: new Date("2026-07-20T12:00:00.000Z"),
          day: "2026-07-20",
          weightKg: "72.1",
          fatRatioPct: "18.2",
          muscleMassKg: "55.2",
        },
        {
          measuredAt: new Date("2026-07-22T00:00:00.000Z"),
          day: "2026-07-22",
          weightKg: "71.8",
          fatRatioPct: "17.9",
          muscleMassKg: "55.4",
        },
      ],
    ]);

    const result = await aggregateHealth(executor, input);

    expect(result.metrics).toEqual([
      {
        metric: "steps",
        total: 18_000,
        average: 4_500,
        min: 1_000,
        max: 8_000,
        days: [
          { date: "2026-07-20", value: 8_000 },
          { date: "2026-07-21", value: 10_000 },
        ],
      },
      {
        metric: "sleep",
        total: 420,
        average: 420,
        min: 390,
        max: 450,
        days: [{ date: "2026-07-20", value: 420 }],
      },
      {
        metric: "heart_rate",
        total: null,
        average: 64,
        min: 48,
        max: 128,
        days: [
          { date: "2026-07-21", value: 62 },
          { date: "2026-07-22", value: 66 },
        ],
      },
      {
        metric: "vo2_max",
        total: null,
        average: 44.5,
        min: 44.5,
        max: 44.5,
        days: [{ date: "2026-07-22", value: 44.5 }],
      },
    ]);
    expect(result.body).toMatchObject({
      measurementCount: 3,
      latestMeasuredAt: "2026-07-22T00:00:00.000Z",
      weightKg: 71.8,
      fatRatioPct: 17.9,
      muscleMassKg: 55.4,
      weightSeries: [
        { date: "2026-07-20", weight: 72.1 },
        { date: "2026-07-22", weight: 71.8 },
      ],
    });
    expect(result.body.weightChangeKg).toBeCloseTo(-0.6);

    expect(executor.execute).toHaveBeenCalledTimes(2);
    const statements = queries.map((query) => dialect.sqlToQuery(query));
    expect(statements[0].sql).toContain("health_daily_summaries");
    expect(statements[0].params).toContain("2026-07-20");
    expect(statements[0].params).toContain("2026-07-27");
    expect(statements[1].sql).toContain("body_measurements");
    expect(statements[1].sql).toContain("Asia/Seoul");
    expect(statements[1].params).toContainEqual(input.from);
    expect(statements[1].params).toContainEqual(input.toExclusive);
  });
});
