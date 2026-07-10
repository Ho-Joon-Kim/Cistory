import { describe, expect, it } from "vitest";
import {
  computeWeightTrendGeometry,
  formatIndex,
  formatKcal,
  formatKg,
  formatPct,
  formatSignedDelta,
} from "./body-format";

describe("body-format formatters", () => {
  it("formats kg/percent/kcal with fixed precision and an em-dash for null", () => {
    expect(formatKg(69.754)).toBe("69.8kg");
    expect(formatKg(null)).toBe("—");
    expect(formatPct(18.42)).toBe("18.4%");
    expect(formatPct(undefined)).toBe("—");
    expect(formatKcal(1523.6)).toBe("1,524kcal");
    expect(formatKcal(null)).toBe("—");
  });

  it("formats index metrics with the requested decimals", () => {
    expect(formatIndex(8)).toBe("8");
    expect(formatIndex(8.24, 1)).toBe("8.2");
    expect(formatIndex(null, 1)).toBe("—");
  });

  it("renders a direction-only delta and omits it for null/zero", () => {
    expect(formatSignedDelta(0.3, "kg")).toBe("▲ 0.3kg");
    expect(formatSignedDelta(-0.3, "kg")).toBe("▼ 0.3kg");
    expect(formatSignedDelta(0, "kg")).toBe("");
    expect(formatSignedDelta(null, "kg")).toBe("");
  });
});

describe("computeWeightTrendGeometry", () => {
  const series = [
    { date: "2026-03-01", weight: 70 },
    { date: "2026-03-02", weight: 69.5 },
    { date: "2026-03-03", weight: 69 },
  ];

  it("maps each point to a coordinate spanning the padded box, ascending in x", () => {
    const { points } = computeWeightTrendGeometry(series, { width: 300, height: 80, pad: 6 });

    expect(points).toHaveLength(3);
    expect(points[0].x).toBeCloseTo(6, 5); // first point sits at the left padding
    expect(points[2].x).toBeCloseTo(294, 5); // last point at width - pad
    expect(points[0].x).toBeLessThan(points[1].x);
    expect(points[1].x).toBeLessThan(points[2].x);
    // Highest weight maps to the top padding, lowest to the bottom.
    expect(points[0].y).toBeCloseTo(6, 5);
    expect(points[2].y).toBeCloseTo(74, 5);
  });

  it("builds a smoothed SVG path beginning with a move command", () => {
    const { trendPath } = computeWeightTrendGeometry(series, { width: 300, height: 80, pad: 6 });
    expect(trendPath.startsWith("M")).toBe(true);
    expect((trendPath.match(/L/g) ?? []).length).toBe(2); // n-1 line segments
  });

  it("handles a flat series without dividing by a zero span", () => {
    const flat = [
      { date: "2026-03-01", weight: 70 },
      { date: "2026-03-02", weight: 70 },
    ];
    const { points } = computeWeightTrendGeometry(flat, { width: 100, height: 40, pad: 4 });
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
