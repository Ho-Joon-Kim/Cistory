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
          measuredAt: "2026-07-20 00:00:00",
          day: "2026-07-20",
          weightKg: "72.4",
          fatRatioPct: "18.4",
          muscleMassKg: "55.1",
        },
        {
          measuredAt: "2026-07-20 12:00:00",
          day: "2026-07-20",
          weightKg: "72.1",
          fatRatioPct: "18.2",
          muscleMassKg: "55.2",
        },
        {
          measuredAt: "2026-07-22 00:00:00",
          day: "2026-07-22",
          weightKg: "71.8",
          fatRatioPct: "17.9",
          muscleMassKg: "55.4",
        },
      ],
      // 2026-07-19 22:00 KST bedtime, 420 min asleep → wakes 2026-07-20 KST
      [{ sampleAt: "2026-07-19 13:00:00", source: "FITBIT", minutes: 420 }],
    ]);

    const result = await aggregateHealth(executor, input);

    expect(result.metrics).toEqual([
      {
        metric: "steps",
        total: 18_000,
        average: 9_000,
        min: 8_000,
        max: 10_000,
        days: [
          { date: "2026-07-20", value: 8_000 },
          { date: "2026-07-21", value: 10_000 },
        ],
      },
      {
        metric: "sleep",
        total: 420,
        average: 420,
        min: 420,
        max: 420,
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

    expect(executor.execute).toHaveBeenCalledTimes(3);
    const statements = queries.map((query) => dialect.sqlToQuery(query));
    expect(statements[0].sql).toContain("health_daily_summaries");
    expect(statements[0].params).toContain("2026-07-20");
    expect(statements[0].params).toContain("2026-07-27");
    expect(statements[1].sql).toContain("body_measurements");
    expect(statements[1].sql).toContain("Asia/Seoul");
    expect(statements[1].params).toContain(input.from.toISOString());
    expect(statements[1].params).toContain(input.toExclusive.toISOString());
  });
});

describe("aggregateHealth — month snapshot regressions", () => {
  const month = {
    ...input,
    periodType: "month" as const,
    periodKey: "2026-10",
    from: new Date("2026-09-30T15:00:00.000Z"),
    toExclusive: new Date("2026-10-31T15:00:00.000Z"),
  };

  it("reports steps average/min/max per day, not per raw sample", async () => {
    // Real 2026-10 rows: value_avg/min/max are per-sample (one Fitbit minute).
    const { executor } = createExecutor([
      [
        { day: "2026-10-01", metric: "steps", average: 22.99, min: 2, max: 88, total: 2414 },
        { day: "2026-10-02", metric: "steps", average: 44.82, min: 1, max: 111, total: 5782 },
        { day: "2026-10-03", metric: "steps", average: 29.88, min: 2, max: 113, total: 5408 },
      ],
      [],
      [],
    ]);
    const result = await aggregateHealth(executor, month);
    const steps = result.metrics.find((m) => m.metric === "steps");
    expect(steps).toMatchObject({ total: 13_604, min: 2414, max: 5782 });
    expect(steps?.average).toBeCloseTo(13_604 / 3);
  });

  it("reads sleep from deduped sessions and attributes each night to its KST wake day", async () => {
    const { executor, queries } = createExecutor([
      [],
      [],
      [
        // 10/27 17:47Z = 10/28 02:47 KST; the same night written twice (Withings re-publish)
        { sampleAt: "2026-10-27 17:47:00", source: "FITBIT", minutes: 354 },
        { sampleAt: "2026-10-27 17:47:00", source: "com.withings.wiscale2", minutes: 354 },
        // 10/28 18:07Z = 10/29 03:07 KST
        { sampleAt: "2026-10-28 18:07:00", source: "FITBIT", minutes: 348 },
        // 10/30 13:00Z = 10/30 22:00 KST bedtime → wakes 10/31 KST
        { sampleAt: "2026-10-30 13:00:00", source: "FITBIT", minutes: 480 },
      ],
    ]);
    const result = await aggregateHealth(executor, month);
    expect(result.metrics.find((m) => m.metric === "sleep")).toEqual({
      metric: "sleep",
      total: 354 + 348 + 480,
      average: (354 + 348 + 480) / 3,
      min: 348,
      max: 480,
      days: [
        { date: "2026-10-28", value: 354 },
        { date: "2026-10-29", value: 348 },
        { date: "2026-10-31", value: 480 },
      ],
    });
    const statements = queries.map((query) => dialect.sqlToQuery(query));
    expect(statements[0].sql).not.toContain("'sleep'");
    expect(statements[2].sql).toContain("health_samples");
  });

  it("drops a session whose wake day falls outside the period", async () => {
    const { executor } = createExecutor([
      [],
      [],
      [
        // 9/30 22:00 KST bedtime, 8h → wakes 10/01 KST (inside)
        { sampleAt: "2026-09-30 13:00:00", source: "FITBIT", minutes: 480 },
        // 10/31 23:00 KST bedtime, 7h → wakes 11/01 KST (outside)
        { sampleAt: "2026-10-31 14:00:00", source: "FITBIT", minutes: 420 },
      ],
    ]);
    const result = await aggregateHealth(executor, month);
    expect(result.metrics.find((m) => m.metric === "sleep")?.days).toEqual([
      { date: "2026-10-01", value: 480 },
    ]);
  });

  it("ignores weight-less measurement rows for weight, change and latest instant", async () => {
    // Real 2026-10 shape: every Withings group is paired with a weight-less row
    // at the same instant, in arbitrary order. Raw driver values are UTC wall time.
    const blank = { weightKg: null, fatRatioPct: null, muscleMassKg: null };
    const { executor, queries } = createExecutor([
      [],
      [
        { measuredAt: "2026-10-04 00:28:27", day: "2026-10-04", ...blank },
        {
          measuredAt: "2026-10-04 00:28:27",
          day: "2026-10-04",
          weightKg: "87.577",
          fatRatioPct: "23.945",
          muscleMassKg: "62.1",
        },
        {
          measuredAt: "2026-10-29 00:02:59",
          day: "2026-10-29",
          weightKg: "86.314",
          fatRatioPct: "23.53",
          muscleMassKg: "62.5",
        },
        { measuredAt: "2026-10-29 00:02:59", day: "2026-10-29", ...blank },
      ],
      [],
    ]);
    const result = await aggregateHealth(executor, month);
    expect(result.body.weightKg).toBe(86.314);
    expect(result.body.fatRatioPct).toBe(23.53);
    expect(result.body.muscleMassKg).toBe(62.5);
    expect(result.body.weightChangeKg).toBeCloseTo(86.314 - 87.577);
    expect(result.body.latestMeasuredAt).toBe("2026-10-29T00:02:59.000Z");
    expect(result.body.weightSeries).toEqual([
      { date: "2026-10-04", weight: 87.577 },
      { date: "2026-10-29", weight: 86.314 },
    ]);
    // A bare Date is serialized by pg in process-local time and its offset is
    // dropped against a naive column — the window would land 9h late.
    const statements = queries.map((query) => dialect.sqlToQuery(query));
    expect(statements[1].params).toContain("2026-09-30T15:00:00.000Z");
    expect(statements[1].params).toContain("2026-10-31T15:00:00.000Z");
    expect(statements[1].params).not.toContainEqual(month.from);
  });
});
