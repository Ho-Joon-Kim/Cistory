import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { Database } from "@/db";
import { aggregateBody, type BodyMeasurementPoint, InsightsService } from "./service";

function pt(
  day: string,
  iso: string,
  over: Partial<BodyMeasurementPoint> = {}
): BodyMeasurementPoint {
  return {
    day,
    measuredAt: new Date(iso),
    weightKg: null,
    fatRatioPct: null,
    muscleMassKg: null,
    boneMassKg: null,
    hydrationKg: null,
    visceralFat: null,
    bmrKcal: null,
    metabolicAge: null,
    heartRateBpm: null,
    ...over,
  };
}

describe("aggregateBody", () => {
  it("summarizes latest/previous/delta/min/max over ascending measurements", () => {
    const rows = [
      pt("2026-03-01", "2026-03-01T00:00:00Z", { weightKg: 70 }),
      pt("2026-03-02", "2026-03-02T00:00:00Z", { weightKg: 69.5 }),
      pt("2026-03-03", "2026-03-03T00:00:00Z", { weightKg: 69.2 }),
    ];

    const r = aggregateBody(rows);

    expect(r.measurementCount).toBe(3);
    expect(r.weight.latest).toBe(69.2);
    expect(r.weight.previous).toBe(69.5);
    expect(r.weight.delta).toBeCloseTo(-0.3, 5);
    expect(r.weight.min).toBe(69.2);
    expect(r.weight.max).toBe(70);
    expect(r.latestMeasuredAt).toBe("2026-03-03T00:00:00.000Z");
    expect(r.weightSeries).toHaveLength(3);
  });

  it("leaves previous/delta null for a single measurement (min=max=latest)", () => {
    const r = aggregateBody([pt("2026-03-01", "2026-03-01T00:00:00Z", { weightKg: 70 })]);

    expect(r.measurementCount).toBe(1);
    expect(r.weight.latest).toBe(70);
    expect(r.weight.previous).toBeNull();
    expect(r.weight.delta).toBeNull();
    expect(r.weight.min).toBe(70);
    expect(r.weight.max).toBe(70);
    expect(r.weightSeries).toEqual([{ date: "2026-03-01", weight: 70 }]);
  });

  it("returns null summaries and an empty series when there are no measurements", () => {
    const r = aggregateBody([]);

    expect(r.measurementCount).toBe(0);
    expect(r.latestMeasuredAt).toBeNull();
    expect(r.weight).toEqual({
      latest: null,
      previous: null,
      delta: null,
      min: null,
      max: null,
    });
    expect(r.weightSeries).toEqual([]);
  });

  it("excludes metrics that are always null (e.g. Body Smart never reports them)", () => {
    const rows = [
      pt("2026-03-01", "2026-03-01T00:00:00Z", { weightKg: 70, visceralFat: null }),
      pt("2026-03-02", "2026-03-02T00:00:00Z", { weightKg: 69.5, visceralFat: null }),
    ];

    const r = aggregateBody(rows);

    expect(r.weight.latest).toBe(69.5);
    expect(r.visceralFat.latest).toBeNull();
    expect(r.visceralFat.min).toBeNull();
    expect(r.visceralFat.delta).toBeNull();
  });

  it("groups the weight series by KST day, honoring 00:00–09:00 KST measurements (AE4)", () => {
    // Two measurements land on KST day 2026-03-04 despite their UTC timestamps
    // reading as 2026-03-03 — the SQL-derived `day` is what the series trusts.
    const rows = [
      pt("2026-03-03", "2026-03-03T10:00:00Z", { weightKg: 72 }), // 2026-03-03 19:00 KST
      pt("2026-03-04", "2026-03-03T15:30:00Z", { weightKg: 71 }), // 2026-03-04 00:30 KST
      pt("2026-03-04", "2026-03-03T22:00:00Z", { weightKg: 70.6 }), // 2026-03-04 07:00 KST
    ];

    const r = aggregateBody(rows);

    // One point per KST day; the day's last measurement wins.
    expect(r.weightSeries).toEqual([
      { date: "2026-03-03", weight: 72 },
      { date: "2026-03-04", weight: 70.6 },
    ]);
    // Delta still follows measurement order, not day grouping.
    expect(r.weight.latest).toBe(70.6);
    expect(r.weight.previous).toBe(71);
    expect(r.weight.delta).toBeCloseTo(-0.4, 5);
  });
});

// ── getCommuteReliability ────────────────────────────────────────────────────

/**
 * getCommuteReliability queries `tracks` directly with `db.select().from().where()`.
 * Rather than reimplementing Postgres semantics in a mock, capture the compiled
 * WHERE clause via drizzle-orm's PgDialect (no live connection needed) and assert
 * on the emitted SQL/params — the same technique used in
 * src/modules/overview/service.test.ts for its raw-SQL statements.
 */
function databaseCapturingTracksWhere() {
  const dialect = new PgDialect();
  let compiled: { sql: string; params: unknown[] } | null = null;
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: SQL) => {
          const result = dialect.sqlToQuery(condition);
          compiled = { sql: result.sql, params: result.params as unknown[] };
          return Promise.resolve([]);
        },
      }),
    }),
  } as unknown as Database;
  return { db, getCompiledWhere: () => compiled };
}

describe("getCommuteReliability", () => {
  it("filters candidate tracks to a minimum 180-second duration", async () => {
    const { db, getCompiledWhere } = databaseCapturingTracksWhere();

    await InsightsService.getCommuteReliability(db, "user-1", 2026);

    const compiled = getCompiledWhere();
    expect(compiled).not.toBeNull();
    // Sub-3-minute tracks are GPS jitter/micro-walks, not commutes (see the
    // MIN_COMMUTE_DURATION_SEC comment in service.ts) — the floor must be
    // pushed into the query's WHERE clause, not filtered in JS afterward.
    expect(compiled?.sql).toContain('"tracks"."duration_seconds" >=');
    expect(compiled?.params).toContain(180);
  });
});
