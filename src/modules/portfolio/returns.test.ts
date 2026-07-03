import { describe, expect, it } from "vitest";
import {
  type CashflowEntry,
  computeReturns,
  computeTWR,
  computeXIRR,
  inferCashflows,
  type ReturnExecution,
  type ReturnSnapshot,
} from "./returns";

// Expected values here are derived by hand from the documented mechanics, not
// captured from current output — a snapshot would only prove "changed", not
// "correct". RETURNS_EPOCH (2026-05-12) is applied in the returns route's
// snapshot filter, not in these pure functions, so no epoch offset applies.

function snap(
  asOfDate: string,
  totalEvalAmount: number,
  deposit: number,
  totalPurchaseAmount = 0
): ReturnSnapshot {
  return { asOfDate, totalEvalAmount, deposit, totalPurchaseAmount };
}

describe("computeTWR", () => {
  it("chains period returns over account value (tot_evlu_amt)", () => {
    // V0=1000 -> V1=1100 (r=1.10) -> V2=1045 (r=0.95); cumulative 1.045.
    const result = computeTWR(
      [snap("2026-06-01", 1000, 0), snap("2026-06-02", 1100, 0), snap("2026-06-03", 1045, 0)],
      []
    );
    expect(result.totalReturn).toBeCloseTo(0.045, 6);
    expect(result.periods).toHaveLength(2);
    expect(result.periods[0].periodReturn).toBeCloseTo(0.1, 6);
    expect(result.periods[1].periodReturn).toBeCloseTo(-0.05, 6);
    expect(result.periods[1].cumulativeReturn).toBeCloseTo(0.045, 6);
  });

  it("does not double-count deposit: tot_evlu_amt already includes the cash balance", () => {
    // KIS semantics (verified against live output2): tot_evlu_amt = scts_evlu_amt + deposit.
    // User deposits 500 externally: tot 1000 -> 1500, dnca 0 -> 500, no market movement.
    // Account value must be tot alone; counting tot + deposit would report a fake
    // 50% gain ((1500+500-500)/1000) instead of the correct 0%.
    const cashflows: CashflowEntry[] = [
      {
        date: "2026-06-02",
        amount: 500,
        inferredFrom: {
          totalAssetDelta: 500,
          purchaseAmountDelta: 0,
          netExecutions: 0,
          settledExecutions: 0,
          expectedDepositDelta: 0,
        },
      },
    ];
    const result = computeTWR(
      [snap("2026-06-01", 1000, 0), snap("2026-06-02", 1500, 500)],
      cashflows
    );
    expect(result.totalReturn).toBeCloseTo(0, 6);
    expect(result.periods[0].periodReturn).toBeCloseTo(0, 6);
    expect(result.periods[0].startValue).toBe(1000);
    expect(result.periods[0].endValue).toBe(1500);
  });

  it("skips periods whose start value is <= 0", () => {
    const result = computeTWR([snap("2026-06-01", 0, 0), snap("2026-06-02", 100, 0)], []);
    expect(result.totalReturn).toBeNull();
    expect(result.periods).toHaveLength(0);
  });

  it("returns a null result for fewer than two snapshots", () => {
    expect(computeTWR([snap("2026-06-01", 1000, 0)], []).totalReturn).toBeNull();
  });
});

describe("inferCashflows", () => {
  // Fixtures model real KIS semantics: tot_evlu_amt = scts_evlu_amt + deposit.
  it("flags an external deposit not explained by trading", () => {
    const flows = inferCashflows(
      [snap("2026-06-01", 1000, 0), snap("2026-06-02", 11000, 10000)],
      []
    );
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ date: "2026-06-02", amount: 10000 });
  });

  it("explains a T+2-settled buy as zero external cashflow", () => {
    // Buy 10000 on Mon 2026-06-01 settles Wed 2026-06-03 (+2 business days);
    // deposit drops 20000 -> 10000, exactly matching the settled buy impact.
    const executions: ReturnExecution[] = [
      { ordDt: "20260601", side: "buy", filledAmount: 10000, cancelled: false },
    ];
    const flows = inferCashflows(
      [snap("2026-06-01", 20000, 20000), snap("2026-06-03", 20000, 10000, 10000)],
      executions
    );
    expect(flows).toHaveLength(0);
  });

  it("flags a withdrawal as a negative cashflow", () => {
    const flows = inferCashflows(
      [snap("2026-06-01", 10000, 10000), snap("2026-06-02", 5000, 5000)],
      []
    );
    expect(flows).toHaveLength(1);
    expect(flows[0].amount).toBe(-5000);
  });

  it("ignores sub-threshold deposit noise (< 1000)", () => {
    const flows = inferCashflows(
      [snap("2026-06-01", 10000, 10000), snap("2026-06-02", 10500, 10500)],
      []
    );
    expect(flows).toHaveLength(0);
  });

  it("does not misread a Friday buy as a cashflow before it settles (weekend-aware T+2)", () => {
    // Buy 10000 on Fri 2026-06-05. T+2 business days = Tue 2026-06-09 (skips
    // Sat/Sun). Over the weekend the deposit is untouched. If settlement were
    // computed as +2 *calendar* days (Sun 06-07), the Fri->Mon window would
    // expect a -10000 deposit change that never happened and emit a phantom
    // +10000 external deposit.
    const executions: ReturnExecution[] = [
      { ordDt: "20260605", side: "buy", filledAmount: 10000, cancelled: false },
    ];
    const fridayToMonday = inferCashflows(
      [snap("2026-06-05", 20000, 20000), snap("2026-06-08", 20000, 20000, 10000)],
      executions
    );
    expect(fridayToMonday).toHaveLength(0);

    // ...and the Mon->Tue window, where settlement actually lands, explains the
    // -10000 deposit drop exactly (no external cashflow).
    const mondayToTuesday = inferCashflows(
      [snap("2026-06-08", 20000, 20000, 10000), snap("2026-06-09", 20000, 10000, 10000)],
      executions
    );
    expect(mondayToTuesday).toHaveLength(0);
  });
});

describe("computeXIRR", () => {
  it("returns ~100% for a position that doubles in a year", () => {
    const flows: CashflowEntry[] = [
      {
        date: "2026-01-01",
        amount: 1000,
        inferredFrom: {
          totalAssetDelta: 0,
          purchaseAmountDelta: 0,
          netExecutions: 0,
          settledExecutions: 0,
          expectedDepositDelta: 0,
        },
      },
    ];
    const xirr = computeXIRR(flows, 2000, "2027-01-01");
    expect(xirr).not.toBeNull();
    expect(xirr as number).toBeCloseTo(1.0, 1);
  });

  it("returns null when there is no sign change in the flows", () => {
    const flows: CashflowEntry[] = [
      {
        date: "2026-01-01",
        amount: -1000,
        inferredFrom: {
          totalAssetDelta: 0,
          purchaseAmountDelta: 0,
          netExecutions: 0,
          settledExecutions: 0,
          expectedDepositDelta: 0,
        },
      },
    ];
    expect(computeXIRR(flows, 2000, "2027-01-01")).toBeNull();
  });
});

describe("computeReturns", () => {
  it("computes TWR and XIRR for a one-year 20% gain with no cashflows (Covers AE2)", () => {
    const result = computeReturns({
      snapshots: [snap("2026-01-01", 10000, 0, 10000), snap("2027-01-01", 12000, 0, 10000)],
      executions: [],
    });
    expect(result.cashflows).toHaveLength(0);
    expect(result.twr.totalReturn).toBeCloseTo(0.2, 4);
    expect(result.xirr).not.toBeNull();
    expect(result.xirr as number).toBeCloseTo(0.2, 2);
    expect(result.startValue).toBe(10000);
    expect(result.endValue).toBe(12000);
  });

  it("returns a null result shape for fewer than two snapshots", () => {
    const result = computeReturns({ snapshots: [snap("2026-01-01", 10000, 0)], executions: [] });
    expect(result.twr.totalReturn).toBeNull();
    expect(result.xirr).toBeNull();
  });
});
