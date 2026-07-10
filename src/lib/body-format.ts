/**
 * Shared display formatters for Withings body-composition metrics. Used by both
 * the insights BodyCard and the report body section so adapter raw values (e.g.
 * 69.754) never leak to the UI unrounded, and both surfaces stay consistent.
 */

const EMPTY = "—";

export function formatKg(v: number | null | undefined): string {
  return v == null ? EMPTY : `${v.toFixed(1)}kg`;
}

export function formatPct(v: number | null | undefined): string {
  return v == null ? EMPTY : `${v.toFixed(1)}%`;
}

export function formatKcal(v: number | null | undefined): string {
  return v == null ? EMPTY : `${Math.round(v).toLocaleString()}kcal`;
}

/** Index-style metrics (visceral fat rating, metabolic age) — a plain number. */
export function formatIndex(v: number | null | undefined, digits = 0): string {
  return v == null ? EMPTY : v.toFixed(digits);
}

/**
 * Direction-only delta label — arrow + magnitude, deliberately NOT colored
 * good/bad. Peer-reviewed work (PMC8485346) links red/green weight-change cues
 * to anxiety/guilt in daily-tracked metrics, so callers render this neutral.
 * Returns "" for a null or zero delta so callers can omit it.
 */
export function formatSignedDelta(v: number | null | undefined, unit: string, digits = 1): string {
  if (v == null || v === 0) return "";
  const arrow = v > 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(v).toFixed(digits)}${unit}`;
}

export interface WeightTrendGeometry {
  /** Raw measured points in SVG coordinates, aligned with the input series. */
  points: { x: number; y: number }[];
  /** SVG path for the smoothed "Trend Weight" line. */
  trendPath: string;
}

/**
 * Map a weight series into SVG geometry: raw point coordinates plus a smoothed
 * "Trend Weight" line (exponential weighted moving average, Withings-style).
 * Shared by the insights and report weight charts, which keep their own
 * (design-system-specific) SVG/JSX but not this math. Callers must pass a
 * series of length >= 2 (a single point can't span the axis).
 */
export function computeWeightTrendGeometry(
  series: { date: string; weight: number }[],
  opts: { width: number; height: number; pad: number; alpha?: number }
): WeightTrendGeometry {
  const { width, height, pad, alpha = 0.25 } = opts;
  const weights = series.map((s) => s.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = max - min || 1;
  const n = series.length;
  const x = (i: number) => pad + (i / (n - 1)) * (width - 2 * pad);
  const y = (w: number) => pad + (1 - (w - min) / span) * (height - 2 * pad);

  const trend: number[] = [];
  for (let i = 0; i < n; i++) {
    trend.push(i === 0 ? weights[0] : alpha * weights[i] + (1 - alpha) * trend[i - 1]);
  }

  return {
    points: series.map((s, i) => ({ x: x(i), y: y(s.weight) })),
    trendPath: trend
      .map((w, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(w).toFixed(1)}`)
      .join(" "),
  };
}
