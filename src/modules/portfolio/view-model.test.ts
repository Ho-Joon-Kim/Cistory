import { describe, expect, it } from "vitest";
import {
  buildAssetSeries,
  cashflowsInRange,
  computeDrift,
  driftScale,
  niceScale,
  ordDateKey,
  ordTime,
  pointPnl,
  positionReturn,
  previousTradingDate,
  previousWeekday,
  rangeExtremes,
  shortName,
  sliceSeries,
} from "./view-model";

const snap = (
  accountId: string,
  asOfDate: string,
  totalEvalAmount: number,
  buy = 100,
  deposit = 1
) => ({
  accountId,
  asOfDate,
  totalEvalAmount,
  totalPurchaseAmount: buy,
  deposit,
});

describe("buildAssetSeries", () => {
  it("sums accounts per day and drops days missing an account", () => {
    const series = buildAssetSeries(
      [
        snap("a", "2026-11-02", 10, 5),
        snap("b", "2026-11-02", 20, 7),
        snap("a", "2026-11-01", 9),
        snap("a", "2026-11-03", 11, 5),
        snap("b", "2026-11-03", 21, 7),
        snap("x", "2026-11-03", 999),
      ],
      ["a", "b"]
    );
    expect(series).toEqual([
      { date: "2026-11-02", value: 30, invested: 12, deposit: 2 },
      { date: "2026-11-03", value: 32, invested: 12, deposit: 2 },
    ]);
  });

  it("reports P&L on holdings alone, cash excluded (the hero's definition)", () => {
    expect(pointPnl({ date: "2026-11-09", value: 1000, invested: 700, deposit: 100 })).toBe(200);
  });

  it("returns nothing without accounts", () => {
    expect(buildAssetSeries([snap("a", "2026-11-01", 1)], [])).toEqual([]);
  });
});

describe("previousTradingDate", () => {
  const series = [
    { date: "2026-11-05", value: 51_901_251, invested: 0 },
    { date: "2026-11-06", value: 50_104_496, invested: 0 },
    { date: "2026-11-07", value: 50_104_496, invested: 0 },
    { date: "2026-11-08", value: 50_104_496, invested: 0 },
    { date: "2026-11-09", value: 50_164_726, invested: 0 },
  ];

  it("picks the first day of the run that equals KIS's previous-day total", () => {
    expect(previousTradingDate(series, 50_104_496)).toBe("2026-11-06");
  });

  it("falls back to the previous weekday", () => {
    expect(previousTradingDate(series, 1)).toBe("2026-11-06");
    expect(previousTradingDate(series, null)).toBe("2026-11-06");
    expect(previousWeekday("2026-11-11")).toBe("2026-11-10");
    expect(previousTradingDate([], 1)).toBeNull();
  });
});

describe("sliceSeries / rangeExtremes / cashflowsInRange", () => {
  const pts = [
    { date: "2026-10-01", value: 100, invested: 90 },
    { date: "2026-10-10", value: 120, invested: 90 },
    { date: "2026-10-11", value: 110, invested: 90 },
    { date: "2026-10-20", value: 95, invested: 95 },
    { date: "2026-11-09", value: 105, invested: 95 },
  ];

  it("keeps points within `days` of the latest point", () => {
    expect(sliceSeries(pts, 30).map((p) => p.date)).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-20",
      "2026-11-09",
    ]);
  });

  it("finds the peak, the low after it and the biggest one-day fall", () => {
    expect(rangeExtremes(pts)).toEqual({ peak: 1, lowAfterPeak: 3, biggestDrop: 3, drop: -15 });
  });

  it("counts cashflows after the first point through the last", () => {
    const cfs = [
      { date: "2026-10-01", amount: 1 },
      { date: "2026-10-15", amount: 2 },
      { date: "2026-11-09", amount: 3 },
      { date: "2026-11-10", amount: 4 },
    ];
    expect(cashflowsInRange(cfs, pts).map((c) => c.amount)).toEqual([2, 3]);
  });
});

describe("niceScale", () => {
  it("uses at most four 1·2·5 intervals", () => {
    expect(niceScale(45_000_000, 54_707_055)).toEqual({
      min: 45_000_000,
      max: 55_000_000,
      step: 5_000_000,
    });
    const flat = niceScale(1_000_000, 1_000_000);
    expect(flat.max).toBeGreaterThan(flat.min);
  });
});

describe("shortName", () => {
  it("drops the ETF brand and a trailing parenthetical", () => {
    expect(shortName("ACE 글로벌반도체TOP4 Plus")).toBe("글로벌반도체TOP4 Plus");
    expect(shortName("TIGER 미국MSCI리츠(합성 H)")).toBe("미국MSCI리츠");
    expect(shortName("KODEX 200미국채혼합50")).toBe("200미국채혼합50");
    expect(shortName("삼성전자")).toBe("삼성전자");
  });
});

describe("positionReturn", () => {
  it("prefers KIS's percent and falls back to pnl over cost", () => {
    expect(positionReturn({ pnl: 1, pnlRate: 83.68, quantity: 1, avgPrice: 1 })).toBeCloseTo(
      0.8368
    );
    expect(positionReturn({ pnl: 50, pnlRate: null, quantity: 10, avgPrice: 100 })).toBe(0.05);
  });
});

describe("computeDrift", () => {
  it("measures weight gaps against the securities base, sorted most-over first", () => {
    const rows = computeDrift(
      [
        { ticker: "A", name: "KODEX 미국S&P500", weight: 0.1965, currentPrice: 22_425 },
        { ticker: "B", name: "ACE KRX금현물", weight: 0.0887, currentPrice: 24_875 },
        { ticker: "C", name: "Untargeted", weight: 0.05, currentPrice: 1_000 },
      ],
      [
        { ticker: "A", name: "KODEX 미국S&P500", targetWeight: 0.16 },
        { ticker: "B", name: "ACE KRX금현물", targetWeight: 0.12 },
        { ticker: "D", name: "Not held", targetWeight: 0.1 },
      ],
      37_879_370
    );
    expect(rows.map((r) => r.ticker)).toEqual(["C", "A", "B", "D"]);
    const b = rows.find((r) => r.ticker === "B")!;
    expect(b.over).toBe(false);
    expect(b.short).toBe("KRX금현물");
    expect(Math.round(b.amount)).toBe(1_185_624);
    expect(b.shares).toBe(48);
    expect(rows.find((r) => r.ticker === "D")!.shares).toBe(0);
    expect(driftScale(rows)).toBeCloseTo(0.25);
  });
});

describe("KIS order fields", () => {
  it("formats ord_dt and ord_tmd", () => {
    expect(ordDateKey("20261027")).toBe("2026-10-27");
    expect(ordTime("093015")).toBe("09:30");
    expect(ordTime(null)).toBe("");
  });
});
