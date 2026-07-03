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
    settledExecutions: number;
    expectedDepositDelta: number;
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

// KRX uses T+2 *business-day* settlement. Without a full Korean market holiday
// calendar we approximate by skipping weekends only. (Public holidays will
// shift settlement by an extra day; the residual either gets re-classified as
// noise via CASHFLOW_NOISE_THRESHOLD or washes out across multi-day periods.)
const SETTLEMENT_BUSINESS_DAYS = 2;

function isoToParts(iso: string): { y: number; m: number; d: number } {
  return {
    y: Number(iso.slice(0, 4)),
    m: Number(iso.slice(5, 7)),
    d: Number(iso.slice(8, 10)),
  };
}

function partsToIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addBusinessDaysIso(iso: string, businessDays: number): string {
  const { y, m, d } = isoToParts(iso);
  const date = new Date(y, m - 1, d);
  let remaining = businessDays;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return partsToIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

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
 * Infer external cashflows by reconciling deposit changes against executions.
 *
 * The trick: executions are *facts* (KIS gives us order numbers + filled amounts).
 * deposit changes are an *effect* — but with KRX T+2 settlement they lag the
 * fill by 2 business days. So we shift each execution's deposit impact to its
 * settlement date and check what's *unexplained* by trading activity:
 *
 *   expectedΔDeposit = -Σ(buys settled in this period) + Σ(sells settled in this period)
 *   externalCashflow = actualΔDeposit - expectedΔDeposit
 *
 * Examples:
 *   - User deposits 10M, no trades yet:
 *       Δdeposit=+10M, expected=0  →  external=+10M ✓ (inflow)
 *   - Buy 10M on T, settles T+2:
 *       Period spanning T+2: Δdeposit=-10M, expected=-10M  →  external=0 ✓
 *   - User withdraws 5M:
 *       Δdeposit=-5M, expected=0  →  external=-5M ✓ (outflow)
 *
 * Caveats:
 *   - Dividends/interest/taxes still pass through deposit and will be
 *     mis-classified — filtered by CASHFLOW_NOISE_THRESHOLD when small.
 *   - We approximate "settlement date" as fill date + 2 calendar days; KRX
 *     skips weekends/holidays but we don't have a calendar. Multi-day periods
 *     wash this out; very short periods around weekends may show residual.
 */
export function inferCashflows(
  snapshots: ReturnSnapshot[],
  executions: ReturnExecution[]
): CashflowEntry[] {
  if (snapshots.length < 2) return [];

  const sorted = [...snapshots].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));

  // Build a map of settlement-date → signed amount that deposit *should* change by.
  // Buys reduce deposit (we record them negative); sells increase deposit (positive).
  const settledByDate = new Map<string, number>();
  for (const e of executions) {
    if (e.cancelled || e.filledAmount === 0) continue;
    const fillIso = ordDtToIso(e.ordDt);
    const settleIso = addBusinessDaysIso(fillIso, SETTLEMENT_BUSINESS_DAYS);
    const depositImpact = e.side === "buy" ? -e.filledAmount : e.filledAmount;
    settledByDate.set(settleIso, (settledByDate.get(settleIso) ?? 0) + depositImpact);
  }

  // Also keep raw netExecutions (by fill date) for display/debugging.
  const execByOrdDt = aggregateExecutionsByDate(executions);

  const result: CashflowEntry[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const totalAssetDelta = curr.totalEvalAmount - prev.totalEvalAmount;
    const purchaseDelta = curr.totalPurchaseAmount - prev.totalPurchaseAmount;
    const depositDelta = curr.deposit - prev.deposit;

    // Sum settlement impacts whose settle date falls in (prev.asOfDate, curr.asOfDate].
    let settledExec = 0;
    for (const [settleIso, amount] of settledByDate) {
      if (settleIso > prev.asOfDate && settleIso <= curr.asOfDate) {
        settledExec += amount;
      }
    }

    // For display: raw fill-date executions in this window.
    let netExec = 0;
    for (const [ord, amount] of execByOrdDt) {
      const iso = ordDtToIso(ord);
      if (iso > prev.asOfDate && iso <= curr.asOfDate) {
        netExec += amount;
      }
    }

    // expectedΔDeposit = settled trade impact. unexplained = external cashflow.
    const expectedDepositDelta = settledExec;
    const ext = depositDelta - expectedDepositDelta;

    if (Math.abs(ext) >= CASHFLOW_NOISE_THRESHOLD) {
      result.push({
        date: curr.asOfDate,
        amount: ext,
        inferredFrom: {
          totalAssetDelta,
          purchaseAmountDelta: purchaseDelta,
          netExecutions: netExec,
          settledExecutions: settledExec,
          expectedDepositDelta,
        },
      });
    }
  }

  return result;
}

/**
 * Daily TWR over total account value (tot_evlu_amt).
 *
 * Each period spans [snapshot_{i-1}, snapshot_i]. KIS `tot_evlu_amt` is already
 * the FULL account value — verified against live output2 payloads it equals
 * scts_evlu_amt + deposit (using the D+2 settled deposit when a fill is
 * pending). So cash sitting in deposit is included with zero return, exactly
 * what we want. Adding `deposit` on top double-counts the cash balance: every
 * external deposit shows up twice in V_end but only once in the cashflow
 * adjustment, fabricating gains.
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
    const startValue = start.totalEvalAmount;
    const endValue = end.totalEvalAmount;

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
  const startValue = sorted[0].totalEvalAmount;
  const endValue = sorted[sorted.length - 1].totalEvalAmount;

  // Synthesize a day-0 deposit equal to starting total asset so XIRR has an initial outflow.
  const xirrCashflows: CashflowEntry[] = [
    {
      date: startDate,
      amount: startValue,
      inferredFrom: {
        totalAssetDelta: 0,
        purchaseAmountDelta: 0,
        netExecutions: 0,
        settledExecutions: 0,
        expectedDepositDelta: 0,
      },
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
