import { parseKstDate } from "./utils";

export interface ReturnSnapshot {
  asOfDate: string;
  totalEvalAmount: number;
  deposit: number;
  totalPurchaseAmount: number;
}

export interface ReturnExecution {
  ordDt: string;
  side: "buy" | "sell";
  filledAmount: number;
  cancelled: boolean;
}

export interface CashflowEntry {
  date: string;
  amount: number;
  inferredFrom: {
    totalAssetDelta: number;
    purchaseAmountDelta: number;
    netExecutions: number;
  };
}

export interface TwrPeriodPoint {
  date: string;
  startValue: number;
  endValue: number;
  cashflow: number;
  periodReturn: number;
  cumulativeReturn: number;
}

export interface TwrResult {
  totalReturn: number | null;
  annualizedReturn: number | null;
  days: number;
  periods: TwrPeriodPoint[];
}

const CASHFLOW_NOISE_THRESHOLD = 1000;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;

function aggregateExecutionsByDate(executions: ReturnExecution[]): Map<string, number> {
  const byOrdDt = new Map<string, number>();
  for (const e of executions) {
    if (e.cancelled) continue;
    if (e.filledAmount === 0) continue;
    const signed = e.side === "buy" ? e.filledAmount : -e.filledAmount;
    const ymd = e.ordDt;
    byOrdDt.set(ymd, (byOrdDt.get(ymd) ?? 0) + signed);
  }
  return byOrdDt;
}

function ordDtToIso(ordDt: string): string {
  if (ordDt.length === 8 && !ordDt.includes("-")) {
    return `${ordDt.slice(0, 4)}-${ordDt.slice(4, 6)}-${ordDt.slice(6, 8)}`;
  }
  return ordDt;
}

/**
 * Infer external cashflows from snapshots + executions.
 *
 * The cleanest signal is the TOTAL ASSET = totalEvalAmount + deposit. In a closed
 * account, total asset changes only through (a) market P&L on positions and
 * (b) external cashflows. So:
 *
 *   externalCashflow ≈ ΔtotalAsset - marketReturn
 *
 * We approximate marketReturn as ΔtotalEvalAmount adjusted for the purchase amount
 * change caused by trades on that day (a buy moves money from deposit into eval
 * at cost basis; it shouldn't be counted as a market gain). Concretely:
 *
 *   marketReturn ≈ ΔtotalEvalAmount - ΔtotalPurchaseAmount
 *   externalCashflow ≈ ΔtotalAsset - (ΔtotalEvalAmount - ΔtotalPurchaseAmount)
 *                    = Δdeposit + ΔtotalPurchaseAmount
 *
 * This is more robust than tracking deposit alone because Korean T+2 settlement
 * delays deposit changes, but totalPurchaseAmount updates immediately on fill.
 *
 * Caveat: dividends/interest/taxes flow into deposit and will be mis-detected as
 * external cashflow. The CASHFLOW_NOISE_THRESHOLD filters out small ones.
 */
export function inferCashflows(
  snapshots: ReturnSnapshot[],
  executions: ReturnExecution[]
): CashflowEntry[] {
  if (snapshots.length < 2) return [];

  const sorted = [...snapshots].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  const execByOrdDt = aggregateExecutionsByDate(executions);

  const result: CashflowEntry[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const totalAssetPrev = prev.totalEvalAmount + prev.deposit;
    const totalAssetCurr = curr.totalEvalAmount + curr.deposit;
    const totalAssetDelta = totalAssetCurr - totalAssetPrev;
    const purchaseDelta = curr.totalPurchaseAmount - prev.totalPurchaseAmount;

    let netExec = 0;
    for (const [ord, amount] of execByOrdDt) {
      const iso = ordDtToIso(ord);
      if (iso > prev.asOfDate && iso <= curr.asOfDate) {
        netExec += amount;
      }
    }

    // ΔtotalAsset = marketReturn + externalCashflow
    // marketReturn ≈ ΔtotalEval - ΔtotalPurchase (eval change minus the part caused by trades)
    // So externalCashflow ≈ ΔtotalAsset - (ΔtotalEval - ΔtotalPurchase) = Δdeposit + ΔtotalPurchase
    const depositDelta = curr.deposit - prev.deposit;
    const ext = depositDelta + purchaseDelta;

    if (Math.abs(ext) >= CASHFLOW_NOISE_THRESHOLD) {
      result.push({
        date: curr.asOfDate,
        amount: ext,
        inferredFrom: {
          totalAssetDelta,
          purchaseAmountDelta: purchaseDelta,
          netExecutions: netExec,
        },
      });
    }
  }

  return result;
}

/**
 * Daily TWR over total account value (eval + deposit).
 *
 * Each period spans [snapshot_{i-1}, snapshot_i]. We measure the FULL account
 * (eval + deposit), not just eval, because money sitting in deposit before a
 * monthly buy is still your money — we want the return on it to be zero, not
 * to dilute the calc.
 *
 * Cashflow detected at snapshot_i is treated as arriving at the end of the
 * period, so we subtract it from V_end to isolate market return:
 *
 *   periodReturn = (V_end - CF) / V_start
 *
 * Days with V_start <= 0 are skipped.
 */
export function computeTWR(snapshots: ReturnSnapshot[], cashflows: CashflowEntry[]): TwrResult {
  const sorted = [...snapshots].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));

  if (sorted.length < 2) {
    return { totalReturn: null, annualizedReturn: null, days: 0, periods: [] };
  }

  const cfByDate = new Map<string, number>();
  for (const cf of cashflows) {
    cfByDate.set(cf.date, (cfByDate.get(cf.date) ?? 0) + cf.amount);
  }

  let cumulative = 1;
  const periods: TwrPeriodPoint[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const start = sorted[i - 1];
    const end = sorted[i];
    const cf = cfByDate.get(end.asOfDate) ?? 0;
    const startValue = start.totalEvalAmount + start.deposit;
    const endValue = end.totalEvalAmount + end.deposit;

    if (startValue <= 0) {
      continue;
    }

    const periodReturn = (endValue - cf) / startValue;
    cumulative *= periodReturn;

    periods.push({
      date: end.asOfDate,
      startValue,
      endValue,
      cashflow: cf,
      periodReturn: periodReturn - 1,
      cumulativeReturn: cumulative - 1,
    });
  }

  if (periods.length === 0) {
    return { totalReturn: null, annualizedReturn: null, days: 0, periods: [] };
  }

  const totalReturn = cumulative - 1;
  const startDate = parseKstDate(sorted[0].asOfDate).getTime();
  const endDate = parseKstDate(sorted[sorted.length - 1].asOfDate).getTime();
  const days = Math.max(1, (endDate - startDate) / MS_PER_DAY);

  const annualizedReturn = days >= 1 ? (1 + totalReturn) ** (DAYS_PER_YEAR / days) - 1 : null;

  return { totalReturn, annualizedReturn, days, periods };
}

interface XirrCashflow {
  date: string;
  amount: number;
}

function npv(rate: number, flows: XirrCashflow[], baseMs: number): number {
  let sum = 0;
  for (const f of flows) {
    const t = (parseKstDate(f.date).getTime() - baseMs) / MS_PER_DAY / DAYS_PER_YEAR;
    sum += f.amount / (1 + rate) ** t;
  }
  return sum;
}

function npvDerivative(rate: number, flows: XirrCashflow[], baseMs: number): number {
  let sum = 0;
  for (const f of flows) {
    const t = (parseKstDate(f.date).getTime() - baseMs) / MS_PER_DAY / DAYS_PER_YEAR;
    sum += (-t * f.amount) / (1 + rate) ** (t + 1);
  }
  return sum;
}

/**
 * Newton-Raphson + bisection fallback. Returns annualized IRR or null if no solution found.
 *
 * Cashflow convention: from the investor's perspective.
 *   - deposit into portfolio: NEGATIVE (cash leaving wallet)
 *   - withdrawal from portfolio: POSITIVE
 *   - final portfolio value: POSITIVE
 */
export function computeXIRR(
  cashflows: CashflowEntry[],
  currentValue: number,
  currentDate: string,
  startDate?: string
): number | null {
  const flows: XirrCashflow[] = [];

  // External deposits to the account (positive in our cashflow convention) become
  // negative outflows from the investor's wallet.
  for (const cf of cashflows) {
    flows.push({ date: cf.date, amount: -cf.amount });
  }
  flows.push({ date: currentDate, amount: currentValue });

  // Need an initial investment seed if startDate provided and no flow at start.
  if (startDate && !flows.some((f) => f.date === startDate)) {
    // Treat the starting eval as an initial investment to anchor IRR.
    // Caller should pass the first snapshot's totalEvalAmount as a phantom deposit.
    // This branch is intentionally a no-op here; we expect caller to pass the seed
    // via the cashflows list (synthesizing a "day 0" entry).
  }

  // Need at least one positive and one negative for IRR to exist.
  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;
  if (flows.length < 2) return null;

  const baseMs = parseKstDate(flows[0].date).getTime();

  // Newton-Raphson
  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = npv(rate, flows, baseMs);
    if (Math.abs(v) < 1e-6) return rate;
    const d = npvDerivative(rate, flows, baseMs);
    if (Math.abs(d) < 1e-12) break;
    const next = rate - v / d;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
    if (rate <= -0.999999) {
      rate = -0.999;
      break;
    }
  }

  // Bisection fallback. Search in (-0.999, 100).
  let lo = -0.999;
  let hi = 100;
  let vLo = npv(lo, flows, baseMs);
  let vHi = npv(hi, flows, baseMs);
  if (vLo * vHi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const vMid = npv(mid, flows, baseMs);
    if (Math.abs(vMid) < 1e-6 || (hi - lo) / 2 < 1e-9) return mid;
    if (vMid * vLo < 0) {
      hi = mid;
      vHi = vMid;
    } else {
      lo = mid;
      vLo = vMid;
    }
  }
  return (lo + hi) / 2;
}

export interface ComputeReturnsInput {
  snapshots: ReturnSnapshot[];
  executions: ReturnExecution[];
}

export interface ComputeReturnsResult {
  twr: TwrResult;
  xirr: number | null;
  cashflows: CashflowEntry[];
  startDate: string | null;
  endDate: string | null;
  startValue: number;
  endValue: number;
}

/**
 * High-level entry point. Builds cashflows, runs TWR and XIRR.
 * For XIRR, the first snapshot's eval amount is treated as the initial investment
 * (a synthetic deposit on day 0) so IRR has a base to anchor against.
 */
export function computeReturns(input: ComputeReturnsInput): ComputeReturnsResult {
  const sorted = [...input.snapshots].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));

  if (sorted.length < 2) {
    return {
      twr: { totalReturn: null, annualizedReturn: null, days: 0, periods: [] },
      xirr: null,
      cashflows: [],
      startDate: sorted[0]?.asOfDate ?? null,
      endDate: sorted[sorted.length - 1]?.asOfDate ?? null,
      startValue: sorted[0]?.totalEvalAmount ?? 0,
      endValue: sorted[sorted.length - 1]?.totalEvalAmount ?? 0,
    };
  }

  const cashflows = inferCashflows(sorted, input.executions);
  const twr = computeTWR(sorted, cashflows);

  const startDate = sorted[0].asOfDate;
  const endDate = sorted[sorted.length - 1].asOfDate;
  const startValue = sorted[0].totalEvalAmount + sorted[0].deposit;
  const endValue = sorted[sorted.length - 1].totalEvalAmount + sorted[sorted.length - 1].deposit;

  // Synthesize a day-0 deposit equal to starting total asset so XIRR has an initial outflow.
  const xirrCashflows: CashflowEntry[] = [
    {
      date: startDate,
      amount: startValue,
      inferredFrom: { totalAssetDelta: 0, purchaseAmountDelta: 0, netExecutions: 0 },
    },
    ...cashflows,
  ];
  const xirr = computeXIRR(xirrCashflows, endValue, endDate);

  return {
    twr,
    xirr,
    cashflows,
    startDate,
    endDate,
    startValue,
    endValue,
  };
}
