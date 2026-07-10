import { describe, expect, it } from "vitest";
import { aggregateReportBody, type ReportBodyPoint } from "./service";

function pt(day: string, over: Partial<ReportBodyPoint> = {}): ReportBodyPoint {
  return {
    day,
    weightKg: null,
    fatRatioPct: null,
    muscleMassKg: null,
    visceralFat: null,
    ...over,
  };
}

describe("aggregateReportBody", () => {
  it("computes period averages, first→last change, range, and count", () => {
    const rows = [
      pt("2026-02-01", { weightKg: 71, fatRatioPct: 20, muscleMassKg: 55 }),
      pt("2026-02-10", { weightKg: 70, fatRatioPct: 19.5, muscleMassKg: 55.5 }),
      pt("2026-02-20", { weightKg: 69, fatRatioPct: 19, muscleMassKg: 56 }),
    ];

    const r = aggregateReportBody(rows);

    expect(r.measurementCount).toBe(3);
    expect(r.avgWeightKg).toBeCloseTo(70, 5);
    expect(r.weightChangeKg).toBeCloseTo(-2, 5); // 69 - 71
    expect(r.fatRatioChangePct).toBeCloseTo(-1, 5);
    expect(r.muscleChangeKg).toBeCloseTo(1, 5);
    expect(r.weightMinKg).toBe(69);
    expect(r.weightMaxKg).toBe(71);
    expect(r.weightSeries).toHaveLength(3);
  });

  it("returns nulls and an empty series when the period has no measurements", () => {
    const r = aggregateReportBody([]);

    expect(r.measurementCount).toBe(0);
    expect(r.avgWeightKg).toBeNull();
    expect(r.weightChangeKg).toBeNull();
    expect(r.weightMinKg).toBeNull();
    expect(r.weightMaxKg).toBeNull();
    expect(r.weightSeries).toEqual([]);
  });

  it("ignores metrics that are always null and needs 2+ points for a change", () => {
    const rows = [pt("2026-02-01", { weightKg: 70, visceralFat: null })];
    const r = aggregateReportBody(rows);

    expect(r.avgWeightKg).toBe(70);
    expect(r.weightChangeKg).toBeNull(); // only one point
    expect(r.avgVisceralFat).toBeNull();
  });

  it("groups the weight series by KST day, keeping the last of each day (AE4)", () => {
    // Both land on KST day 2026-02-28 (month-end boundary) — series keeps them
    // in February, one point, last-of-day.
    const rows = [
      pt("2026-02-27", { weightKg: 70.2 }),
      pt("2026-02-28", { weightKg: 70.0 }),
      pt("2026-02-28", { weightKg: 69.8 }),
    ];

    const r = aggregateReportBody(rows);

    expect(r.weightSeries).toEqual([
      { date: "2026-02-27", weight: 70.2 },
      { date: "2026-02-28", weight: 69.8 },
    ]);
    expect(r.measurementCount).toBe(3);
  });
});
