import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/facts/template";
import { chartFact, driftFact, euro, heroFact, holdingsFact, pp } from "./facts";
import { computeDrift } from "./view-model";

const asOf = { from: "2026-11-09", to: "2026-11-09", label: "11월\u00A09일" };
const text = (f: ReturnType<typeof heroFact>) => (f ? renderTemplate(f).text : null);

describe("particles", () => {
  it("picks (으)로 with the ㄹ exception", () => {
    expect(euro("KRX금현물")).toBe("로");
    expect(euro("+2,504,540원")).toBe("으로");
    expect(euro("미국S&P500")).toBe("으로");
    expect(euro("미국리츠")).toBe("로");
  });
  it("formats percentage points", () => {
    expect(pp(0.0365)).toBe("+3.65%p");
    expect(pp(-0.0224)).toBe("−2.24%p");
    expect(pp(0)).toBe("0.00%p");
  });
});

describe("heroFact", () => {
  const accounts = [
    { id: "pen", label: "연금저축", pnl: 3_952_290, rate: 0.4854 },
    { id: "isa", label: "ISA", pnl: -1_330_085, rate: -0.034 },
  ];
  const positions = [
    {
      accountId: "pen",
      accountLabel: "연금저축",
      name: "ACE 글로벌반도체TOP4 Plus",
      pnl: 2_504_540,
    },
    { accountId: "isa", accountLabel: "ISA", name: "KODEX 200미국채혼합50", pnl: -507_507 },
  ];

  it("says which account covered the other's loss and where the gain came from", () => {
    const fact = heroFact({
      accounts,
      positions,
      totalPnl: 2_622_205,
      totalPurchase: 47_350_974,
      asOf,
      syncedAt: null,
    });
    expect(text(fact)).toBe(
      "연금저축이 +3,952,290원을 벌어 ISA 손실을 덮었어요. 그 수익의 96%는 글로벌반도체TOP4 Plus 한 종목(+2,504,540원)에서 나왔어요."
    );
    expect(fact?.evidence).toEqual({ kind: "keys", keys: ["acct:pen", "acct:isa"] });
    expect(fact?.rows?.[0]).toEqual({
      label: "연금저축 평가손익",
      value: "+3,952,290원 (+48.54%)",
    });
  });

  it("stays silent when nothing stands out", () => {
    expect(
      heroFact({
        accounts: [{ id: "a", label: "A", pnl: 100, rate: 0.01 }],
        positions: [
          { accountId: "a", accountLabel: "A", name: "X", pnl: 30 },
          { accountId: "a", accountLabel: "A", name: "Y", pnl: 30 },
        ],
        totalPnl: 100,
        totalPurchase: 1000,
        asOf,
        syncedAt: null,
      })
    ).toBeNull();
  });
});

describe("chartFact", () => {
  const period = { from: "2026-10-10", to: "2026-11-09", label: "30일" };
  it("separates deposits from the market move", () => {
    const fact = chartFact({
      period,
      rangeLabel: "30일",
      startValue: 54_707_055,
      endValue: 50_164_726,
      cashflows: [
        { date: "2026-10-20", amount: 1_000_000 },
        { date: "2026-11-02", amount: 114_238 },
      ],
    });
    expect(fact && renderTemplate(fact).text).toBe(
      "자산은 −4,542,329원이지만 그사이 1,114,238원을 더 넣었어요. 입출금을 빼면 시장에서 −5,656,567원 변했어요."
    );
    expect(fact?.evidence).toEqual({ kind: "keys", keys: ["chart:cashflows"] });
  });
  it("is omitted without cashflows", () => {
    expect(
      chartFact({ period, rangeLabel: "30일", startValue: 1, endValue: 2, cashflows: [] })
    ).toBeNull();
  });
});

describe("holdingsFact", () => {
  it("calls out one holding that out-earns the whole portfolio", () => {
    const fact = holdingsFact({
      asOf,
      totalPnl: 2_000_000,
      holdings: [
        {
          accountId: "p",
          ticker: "446770",
          name: "ACE 글로벌반도체TOP4 Plus",
          pnl: 2_504_540,
          rate: 0.8368,
        },
        {
          accountId: "p",
          ticker: "457480",
          name: "ACE 테슬라밸류체인액티브",
          pnl: 1_068_660,
          rate: 0.4476,
        },
        {
          accountId: "i",
          ticker: "284430",
          name: "KODEX 200미국채혼합50",
          pnl: -507_507,
          rate: -0.1206,
        },
        {
          accountId: "i",
          ticker: "379810",
          name: "KODEX 미국나스닥100",
          pnl: -365_424,
          rate: -0.0306,
        },
        { accountId: "i", ticker: "379800", name: "KODEX 미국S&P500", pnl: -17_065, rate: -0.0022 },
      ],
    });
    expect(fact && renderTemplate(fact).text).toBe(
      "5종목 중 2개만 수익이에요. 글로벌반도체TOP4 Plus 하나가 +2,504,540원으로 전체 평가손익(+2,000,000원)보다 크고, 가장 큰 손실은 200미국채혼합50 −507,507원이에요."
    );
    expect(fact?.evidence).toEqual({ kind: "keys", keys: ["pos:p:446770", "pos:i:284430"] });
  });
  it("sums spread-out losses otherwise", () => {
    const fact = holdingsFact({
      asOf,
      totalPnl: 2_622_205,
      holdings: [
        {
          accountId: "p",
          ticker: "1",
          name: "ACE 글로벌반도체TOP4 Plus",
          pnl: 2_504_540,
          rate: 0.8,
        },
        { accountId: "i", ticker: "2", name: "KODEX 200미국채혼합50", pnl: -507_507, rate: -0.12 },
        { accountId: "i", ticker: "3", name: "ACE KRX금현물", pnl: -307_142, rate: -0.08 },
      ],
    });
    expect(fact && renderTemplate(fact).text).toBe(
      "3종목 중 1개만 수익이에요. 손실 난 2종목을 합치면 −814,649원이고, 가장 큰 손실은 200미국채혼합50 −507,507원이에요."
    );
    expect(fact?.evidence).toEqual({ kind: "keys", keys: ["pos:i:2", "pos:i:3"] });
  });
  it("is omitted when gains are spread out", () => {
    expect(
      holdingsFact({
        asOf,
        totalPnl: 300,
        holdings: [1, 2, 3].map((i) => ({
          accountId: "a",
          ticker: String(i),
          name: `N${i}`,
          pnl: 100,
          rate: 0.1,
        })),
      })
    ).toBeNull();
  });
});

describe("driftFact", () => {
  const rows = computeDrift(
    [
      { ticker: "379800", name: "KODEX 미국S&P500", weight: 0.1965, currentPrice: 22_425 },
      { ticker: "490090", name: "TIGER 미국AI빅테크10", weight: 0.1901, currentPrice: 14_345 },
      { ticker: "411060", name: "ACE KRX금현물", weight: 0.0887, currentPrice: 24_875 },
    ],
    [
      { ticker: "379800", name: "", targetWeight: 0.16 },
      { ticker: "490090", name: "", targetWeight: 0.16 },
      { ticker: "411060", name: "", targetWeight: 0.12 },
    ],
    37_879_370
  );

  it("notes a recent buy that went into already-overweight holdings", () => {
    const fact = driftFact({
      accountId: "isa",
      accountLabel: "ISA",
      rows,
      base: 37_879_370,
      targetsSetAt: "5월\u00A011일",
      asOf,
      recentBuys: [
        { date: "2026-10-27", ticker: "490090", amount: 573_800 },
        { date: "2026-10-27", ticker: "379800", amount: 446_340 },
      ],
    });
    expect(fact && renderTemplate(fact).text).toBe(
      "10월\u00A027일 매수 1,020,140원이 이미 목표를 넘은 미국AI빅테크10·미국S&P500에 들어갔어요. 가장 모자란 건 KRX금현물로, 48주(1,185,624원)를 사면 목표에 닿아요."
    );
    expect(fact?.evidence).toEqual({
      kind: "keys",
      keys: ["drift:isa:490090", "drift:isa:379800", "drift:isa:411060"],
    });
  });

  it("falls back to the biggest gap when the last buy wasn't overweight", () => {
    const fact = driftFact({
      accountId: "isa",
      accountLabel: "ISA",
      rows,
      base: 37_879_370,
      targetsSetAt: null,
      asOf,
      recentBuys: [{ date: "2026-10-27", ticker: "411060", amount: 1 }],
    });
    expect(fact && renderTemplate(fact).text).toBe(
      "가장 모자란 건 KRX금현물로, 목표보다 3.13%p 적어요. 48주(1,185,624원)를 사면 목표에 닿아요."
    );
  });
});
