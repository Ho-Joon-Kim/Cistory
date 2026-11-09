/**
 * Pure view-model helpers for the /portfolio page: the summed asset series, the
 * previous trading day, per-account outcome, target drift and the asset-chart
 * scale. Everything here is deterministic and unit-tested; components only lay
 * the results out.
 */
import { dateKeyToUtcMillis, shiftDateKey } from "@/lib/date-key";

export interface AssetPoint {
  /** KST date key (YYYY-MM-DD). */
  date: string;
  /** Total evaluation incl. cash deposit (tot_evlu_amt summed over accounts). */
  value: number;
  /** Purchase amount (매입금액) summed over accounts. */
  invested: number;
  /**
   * Cash deposit (예수금) summed over accounts, included in `value`. 평가손익 is
   * `value − deposit − invested` — the stock-only figure the hero reports.
   */
  deposit?: number;
}

interface SnapshotLike {
  accountId: string;
  asOfDate: string;
  totalEvalAmount: number;
  totalPurchaseAmount: number;
  deposit?: number;
}

/**
 * Sums every account's snapshot per day. A day missing any expected account is
 * left out rather than summed partially — a missing valuation is unknown, never
 * zero (the same rule the returns API applies).
 */
export function buildAssetSeries(
  snapshots: ReadonlyArray<SnapshotLike>,
  accountIds: ReadonlyArray<string>
): AssetPoint[] {
  const expected = new Set(accountIds);
  if (expected.size === 0) return [];
  const byDate = new Map<string, Map<string, SnapshotLike>>();
  for (const s of snapshots) {
    if (!expected.has(s.accountId)) continue;
    const day = byDate.get(s.asOfDate) ?? new Map<string, SnapshotLike>();
    day.set(s.accountId, s);
    byDate.set(s.asOfDate, day);
  }
  const out: AssetPoint[] = [];
  for (const [date, day] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    if (day.size !== expected.size) continue;
    let value = 0;
    let invested = 0;
    let deposit = 0;
    for (const s of day.values()) {
      value += Number(s.totalEvalAmount);
      invested += Number(s.totalPurchaseAmount);
      deposit += Number(s.deposit ?? 0);
    }
    out.push({ date, value, invested, deposit });
  }
  return out;
}

function weekday(dateKey: string): number {
  const ms = dateKeyToUtcMillis(dateKey);
  return ms === null ? 1 : new Date(ms).getUTCDay();
}

/** The weekday before `dateKey` (Fri for a Mon). Holidays are not known here. */
export function previousWeekday(dateKey: string): string {
  let d = shiftDateKey(dateKey, -1);
  while (weekday(d) === 0 || weekday(d) === 6) d = shiftDateKey(d, -1);
  return d;
}

/**
 * The trading day KIS compares "today" against. Snapshots are taken every day,
 * so weekends/holidays repeat the last close; the previous trading day is the
 * first day of the run whose value equals KIS's 전일 총자산. Falls back to the
 * previous weekday when no day matches.
 */
export function previousTradingDate(
  series: ReadonlyArray<AssetPoint>,
  prevTotal: number | null
): string | null {
  if (series.length === 0) return null;
  const latest = series[series.length - 1].date;
  if (prevTotal !== null && prevTotal > 0) {
    for (let i = series.length - 2; i >= 0; i--) {
      if (Math.abs(series[i].value - prevTotal) > 1) continue;
      let j = i;
      while (j > 0 && Math.abs(series[j - 1].value - prevTotal) <= 1) j--;
      return series[j].date;
    }
  }
  return previousWeekday(latest);
}

/** Points from `days` before the latest point through the latest (inclusive). */
export function sliceSeries(series: ReadonlyArray<AssetPoint>, days: number): AssetPoint[] {
  if (series.length === 0) return [];
  const from = shiftDateKey(series[series.length - 1].date, -days);
  return series.filter((p) => p.date >= from);
}

export interface RangeExtremes {
  /** Index of the highest value. */
  peak: number;
  /** Index of the lowest value after the peak (=== peak when nothing falls after it). */
  lowAfterPeak: number;
  /** Index of the largest single-day fall, or -1. */
  biggestDrop: number;
  /** That fall (negative won), or 0. */
  drop: number;
}

export function rangeExtremes(points: ReadonlyArray<AssetPoint>): RangeExtremes {
  let peak = 0;
  let biggestDrop = -1;
  let drop = 0;
  points.forEach((p, i) => {
    if (p.value > points[peak].value) peak = i;
    if (i > 0) {
      const d = p.value - points[i - 1].value;
      if (d < drop) {
        drop = d;
        biggestDrop = i;
      }
    }
  });
  let lowAfterPeak = peak;
  for (let i = peak; i < points.length; i++) {
    if (points[i].value < points[lowAfterPeak].value) lowAfterPeak = i;
  }
  return { peak, lowAfterPeak, biggestDrop, drop };
}

const STEPS = [1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2e8, 5e8];

/** A y-axis with ≤ 4 gridline intervals on a 1·2·5 step that covers [lo, hi]. */
export function niceScale(lo: number, hi: number): { min: number; max: number; step: number } {
  if (!(hi > lo)) {
    const pad = Math.max(1e5, Math.abs(lo) * 0.01);
    return niceScale(lo - pad, hi + pad);
  }
  let step = STEPS[STEPS.length - 1];
  for (const s of STEPS) {
    if (Math.ceil(hi / s) - Math.floor(lo / s) <= 4) {
      step = s;
      break;
    }
  }
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

export interface Cashflow {
  date: string;
  amount: number;
}

/** Cashflows strictly after the first point and up to the last (they move the range). */
export function cashflowsInRange(
  cashflows: ReadonlyArray<Cashflow>,
  points: ReadonlyArray<AssetPoint>
): Cashflow[] {
  if (points.length === 0) return [];
  const first = points[0].date;
  const last = points[points.length - 1].date;
  return cashflows.filter((c) => c.date > first && c.date <= last);
}

// ── holdings ────────────────────────────────────────────────────────────────

const BRAND_PREFIX =
  /^(KODEX|TIGER|ACE|KBSTAR|RISE|SOL|PLUS|HANARO|ARIRANG|KOSEF|KIWOOM|TIMEFOLIO|WON|1Q|HK|BNK|파워|마이티|에셋플러스)\s+/i;

/** `ACE 글로벌반도체TOP4 Plus` → `글로벌반도체TOP4 Plus`; `TIGER 미국MSCI리츠(합성 H)` → `미국MSCI리츠`. */
export function shortName(name: string): string {
  const trimmed = name.trim();
  const short = trimmed
    .replace(BRAND_PREFIX, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  return short || trimmed;
}

/** Position return as a ratio: KIS `pnlRate` is a percent; fall back to pnl / cost. */
export function positionReturn(p: {
  pnl: number;
  pnlRate: number | null;
  quantity: number;
  avgPrice: number;
}): number {
  if (p.pnlRate !== null && Number.isFinite(p.pnlRate)) return p.pnlRate / 100;
  const cost = p.quantity * p.avgPrice;
  return cost > 0 ? p.pnl / cost : 0;
}

// ── target drift ────────────────────────────────────────────────────────────

export interface DriftRow {
  ticker: string;
  name: string;
  short: string;
  /** Current weight within the account's securities (0..1). */
  current: number;
  /** Target weight (0..1). */
  target: number;
  /** current − target (ratio; ×100 = %p). */
  diff: number;
  /** |diff| × base, in won. */
  amount: number;
  /** Shares that close the gap at the current price (0 when price unknown). */
  shares: number;
  over: boolean;
}

export function computeDrift(
  positions: ReadonlyArray<{ ticker: string; name: string; weight: number; currentPrice: number }>,
  targets: ReadonlyArray<{ ticker: string; name: string; targetWeight: number }>,
  base: number
): DriftRow[] {
  const held = new Map(positions.map((p) => [p.ticker, p]));
  const tickers = [
    ...new Set([...targets.map((t) => t.ticker), ...positions.map((p) => p.ticker)]),
  ];
  const targetBy = new Map(targets.map((t) => [t.ticker, t]));
  return tickers
    .map((ticker) => {
      const p = held.get(ticker);
      const t = targetBy.get(ticker);
      const current = p?.weight ?? 0;
      const target = t?.targetWeight ?? 0;
      const diff = current - target;
      const amount = Math.abs(diff) * base;
      const price = p?.currentPrice ?? 0;
      const name = p?.name || t?.name || ticker;
      return {
        ticker,
        name,
        short: shortName(name),
        current,
        target,
        diff,
        amount,
        shares: price > 0 ? Math.round(amount / price) : 0,
        over: diff > 0,
      };
    })
    .sort((a, b) => b.diff - a.diff);
}

/** Bar scale for drift rows: the largest weight plus headroom, on a 5% grid. */
export function driftScale(rows: ReadonlyArray<DriftRow>): number {
  const max = Math.max(0.05, ...rows.map((r) => Math.max(r.current, r.target)));
  return Math.min(1, Math.ceil((max * 1.12) / 0.05) * 0.05);
}

/** `YYYYMMDD` (KIS ord_dt) → `YYYY-MM-DD`. */
export function ordDateKey(ordDt: string): string {
  return `${ordDt.slice(0, 4)}-${ordDt.slice(4, 6)}-${ordDt.slice(6, 8)}`;
}

/** `HHMMSS` → `HH:MM`, or "" when absent. */
export function ordTime(ordTm: string | null): string {
  if (!ordTm || ordTm.length < 4) return "";
  return `${ordTm.slice(0, 2)}:${ordTm.slice(2, 4)}`;
}

/** Unrealized P&L on the holdings alone (cash excluded), as the hero defines it. */
export function pointPnl(p: AssetPoint): number {
  return p.value - (p.deposit ?? 0) - p.invested;
}
