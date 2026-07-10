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
