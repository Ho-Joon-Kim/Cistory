// TZ pinned: parseKstDate builds local-midnight dates, and production containers
// run with TZ=Asia/Seoul. Must be set before any Date use.
process.env.TZ = "Asia/Seoul";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeInflationAdjusted,
  computeRebalance,
  type RebalanceInputPosition,
  type RebalanceInputTarget,
} from "./utils";

afterEach(() => {
  vi.useRealTimers();
});

// Expected values derived by hand from the documented mechanics, not captured
// from current output.

describe("computeInflationAdjusted", () => {
  it("compounds inflation over an exact 4-year span (1461 days / 365.25)", () => {
    // 2022-01-01 → 2026-01-01 = 1461 days (2024 is a leap year) = exactly 4y.
    // inflated = 10,000 × 1.1^4 = 14,641; current = 10,000 × 1.1^5 = 16,105.1
    // → realGain = 1,464.1, realGainRate = exactly 10%.
    const r = computeInflationAdjusted({
      startPurchase: 10_000,
      startDate: "2022-01-01",
      currentTotal: 16_105.1,
      inflationRate: 0.1,
      endDate: "2026-01-01",
    });
    expect(r.years).toBeCloseTo(4, 10);
    expect(r.inflated).toBeCloseTo(14_641, 6);
    expect(r.realGain).toBeCloseTo(1_464.1, 6);
    expect(r.realGainRate).toBeCloseTo(10, 6);
    expect(r.outperformedInflation).toBe(true);
  });

  it("applies no inflation when start and end dates are the same day", () => {
    const r = computeInflationAdjusted({
      startPurchase: 1_000_000,
      startDate: "2026-06-01",
      currentTotal: 900_000,
      inflationRate: 0.05,
      endDate: "2026-06-01",
    });
    expect(r.years).toBe(0);
    expect(r.inflated).toBe(1_000_000); // (1+r)^0 = 1
    expect(r.realGain).toBe(-100_000);
    expect(r.outperformedInflation).toBe(false);
  });

  it("clamps a start date after the end date to 0 years", () => {
    const r = computeInflationAdjusted({
      startPurchase: 1_000,
      startDate: "2026-06-10",
      currentTotal: 1_100,
      inflationRate: 0.05,
      endDate: "2026-06-01",
    });
    expect(r.years).toBe(0);
    expect(r.inflated).toBe(1_000);
  });

  it("measures a single day as 1/365.25 years", () => {
    const r = computeInflationAdjusted({
      startPurchase: 1_000,
      startDate: "2026-06-01",
      currentTotal: 1_000,
      inflationRate: 0.03,
      endDate: "2026-06-02",
    });
    expect(r.years).toBeCloseTo(1 / 365.25, 12);
  });

  it("returns a null realGainRate when the inflated base is 0", () => {
    const r = computeInflationAdjusted({
      startPurchase: 0,
      startDate: "2026-01-01",
      currentTotal: 500,
      inflationRate: 0.03,
      endDate: "2026-06-01",
    });
    expect(r.inflated).toBe(0);
    expect(r.realGainRate).toBeNull();
    expect(r.realGain).toBe(500);
  });

  it("defaults the end date to today in KST when omitted", () => {
    // 2026-07-01T03:00:00Z = 2026-07-01 12:00 KST → today is 2026-07-01,
    // 30 days after the start date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T03:00:00Z"));
    const r = computeInflationAdjusted({
      startPurchase: 1_000,
      startDate: "2026-06-01",
      currentTotal: 1_000,
      inflationRate: 0.03,
    });
    expect(r.years).toBeCloseTo(30 / 365.25, 12);
  });
});

function pos(ticker: string, evalAmount: number, currentPrice: number): RebalanceInputPosition {
  return {
    ticker,
    name: `${ticker}-name`,
    quantity: currentPrice > 0 ? evalAmount / currentPrice : 0,
    currentPrice,
    evalAmount,
  };
}

function tgt(ticker: string, targetWeight: number): RebalanceInputTarget {
  return { ticker, name: `${ticker}-name`, targetWeight };
}

describe("computeRebalance", () => {
  it("returns an empty result for no positions, no targets, no cash", () => {
    const r = computeRebalance({ positions: [], targets: [], cashToInvest: 0 });
    expect(r.rows).toEqual([]);
    expect(r.totalCurrent).toBe(0);
    expect(r.totalAfter).toBe(0);
    expect(r.totalActualBuy).toBe(0);
    expect(r.remainingCash).toBe(0);
    expect(r.warnings).toEqual([]);
    expect(r.avgDriftBefore).toBe(0);
    expect(r.avgDriftAfter).toBe(0);
  });

  it("distributes cash to reach target weights exactly when deficits equal cash", () => {
    // Current: A 600 (60%), B 400 (40%); targets 50/50; cash 1000 → after 2000.
    // Deficits: A 1000-600=400, B 1000-400=600; sum = cash → full spend.
    const r = computeRebalance({
      positions: [pos("A", 600, 100), pos("B", 400, 50)],
      targets: [tgt("A", 0.5), tgt("B", 0.5)],
      cashToInvest: 1000,
    });
    const a = r.rows.find((row) => row.ticker === "A")!;
    const b = r.rows.find((row) => row.ticker === "B")!;
    expect(r.totalCurrent).toBe(1000);
    expect(a.currentWeight).toBeCloseTo(0.6, 10);
    expect(a.targetEval).toBe(1000);
    expect(a.diffAmount).toBe(400);
    expect(a.buyShares).toBe(4); // floor(400 / 100)
    expect(a.actualBuyAmount).toBe(400);
    expect(a.status).toBe("buy");
    expect(b.buyShares).toBe(12); // floor(600 / 50)
    expect(b.actualBuyAmount).toBe(600);
    expect(a.afterWeight).toBeCloseTo(0.5, 10);
    expect(b.afterWeight).toBeCloseTo(0.5, 10);
    expect(r.totalActualBuy).toBe(1000);
    expect(r.totalAfter).toBe(2000);
    expect(r.remainingCash).toBe(0);
    expect(r.warnings).toEqual([]);
    expect(r.avgDriftBefore).toBeCloseTo(0.1, 10); // (|0.6-0.5| + |0.4-0.5|) / 2
    expect(r.avgDriftAfter).toBeCloseTo(0, 10);
  });

  it("scales deficits proportionally when they exceed the available cash", () => {
    // After = 1200. Targets: A 240, B 480, C 480 → deficits A 0, B 480, C 480.
    // Sum 960 > cash 200 → scale = 200/960, budgets B 100, C 100.
    const r = computeRebalance({
      positions: [pos("A", 1000, 100), pos("B", 0, 50), pos("C", 0, 10)],
      targets: [tgt("A", 0.2), tgt("B", 0.4), tgt("C", 0.4)],
      cashToInvest: 200,
    });
    const a = r.rows.find((row) => row.ticker === "A")!;
    const b = r.rows.find((row) => row.ticker === "B")!;
    const c = r.rows.find((row) => row.ticker === "C")!;
    expect(a.buyAmount).toBe(0); // already over target → no deficit
    expect(a.status).toBe("hold");
    expect(b.buyAmount).toBeCloseTo(100, 10); // 480 × 200/960
    expect(b.buyShares).toBe(2);
    expect(c.buyAmount).toBeCloseTo(100, 10);
    expect(c.buyShares).toBe(10);
    expect(r.totalActualBuy).toBe(200);
    expect(r.remainingCash).toBe(0);
  });

  it("leaves cash idle when target weights sum to less than 100%", () => {
    // Targets sum to 0.6 → deficits total 200 while cash is 1000.
    const r = computeRebalance({
      positions: [pos("A", 500, 10), pos("B", 500, 10)],
      targets: [tgt("A", 0.3), tgt("B", 0.3)],
      cashToInvest: 1000,
    });
    const a = r.rows.find((row) => row.ticker === "A")!;
    expect(a.targetEval).toBe(600); // 2000 × 0.3
    expect(a.buyShares).toBe(10); // floor(100 / 10)
    expect(r.totalActualBuy).toBe(200);
    expect(r.remainingCash).toBe(800);
  });

  it("floors share counts and returns the un-investable remainder as cash", () => {
    // Deficit 500, price 300 → 1 share (300), 200 left over.
    const r = computeRebalance({
      positions: [pos("A", 1000, 300)],
      targets: [tgt("A", 1)],
      cashToInvest: 500,
    });
    const a = r.rows.find((row) => row.ticker === "A")!;
    expect(a.buyAmount).toBeCloseTo(500, 10);
    expect(a.buyShares).toBe(1);
    expect(a.actualBuyAmount).toBe(300);
    expect(a.afterWeight).toBeCloseTo(1, 10); // 1300 / 1300
    expect(r.totalAfter).toBe(1300);
    expect(r.remainingCash).toBe(200);
  });

  it("flags a target-only ticker without a price as missing-price", () => {
    const r = computeRebalance({
      positions: [],
      targets: [tgt("C", 1)],
      cashToInvest: 1000,
    });
    const c = r.rows.find((row) => row.ticker === "C")!;
    expect(c.status).toBe("missing-price");
    expect(c.buyShares).toBe(0);
    expect(c.currentWeight).toBe(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("C");
    expect(r.totalActualBuy).toBe(0);
    expect(r.remainingCash).toBe(1000);
  });

  it("clamps negative cash to 0 and suggests no buys (buy-only)", () => {
    // B has no target (weight 0) so A carries a real deficit, but with no cash
    // nothing is bought and no missing-price warning fires.
    const r = computeRebalance({
      positions: [pos("A", 300, 10), pos("B", 200, 10)],
      targets: [tgt("A", 1)],
      cashToInvest: -100,
    });
    const a = r.rows.find((row) => row.ticker === "A")!;
    const b = r.rows.find((row) => row.ticker === "B")!;
    expect(a.status).toBe("hold");
    expect(a.buyShares).toBe(0);
    expect(b.targetWeight).toBe(0);
    expect(b.diffAmount).toBe(-200); // over-weight, but never sold
    expect(b.status).toBe("hold");
    expect(r.totalActualBuy).toBe(0);
    expect(r.remainingCash).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it("sorts rows by target weight descending", () => {
    const r = computeRebalance({
      positions: [pos("A", 100, 10), pos("B", 100, 10)],
      targets: [tgt("A", 0.3), tgt("B", 0.7)],
      cashToInvest: 0,
    });
    expect(r.rows.map((row) => row.ticker)).toEqual(["B", "A"]);
  });
});
