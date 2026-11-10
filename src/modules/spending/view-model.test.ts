import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/facts/template";
import type { TransactionItem } from "./hooks";
import type { MonthlyBarDataPoint } from "./types";
import {
  averageBaseline,
  chartSplitFact,
  displayNotificationTitle,
  type FlagContext,
  groupLedger,
  type HeroModel,
  heroPaceFact,
  heroSentence,
  monthAnnotations,
  monthMaxCharge,
  monthSpanLabel,
  niceTicks,
  periodRange,
  previousMonth,
  refundFlag,
  rowFlag,
  rowMark,
  signedAmount,
  toMonthBars,
  topMerchantFact,
} from "./view-model";

function tx(partial: Partial<TransactionItem> & Pick<TransactionItem, "id">): TransactionItem {
  return {
    type: "withdrawal",
    amount: 10_000,
    merchant: "가게",
    accountName: "내 토스뱅크 통장",
    rawTitle: "",
    rawText: "",
    transactedAt: "2026-11-09T03:00:00.000Z",
    bucket: "spending",
    spendingOverride: null,
    overrideNote: null,
    category: "food",
    categorySource: "ai",
    categoryConfidence: 95,
    isRefund: false,
    ...partial,
  };
}

// The owner's real 2026 months (총액, 의료·건강).
const RAW: [string, number, number][] = [
  ["2026-03", 1_012_969, 0],
  ["2026-04", 1_343_950, 8_000],
  ["2026-05", 4_609_453, 112_200],
  ["2026-06", 3_040_140, 1_680_000],
  ["2026-07", 3_911_341, 1_300_000],
  ["2026-08", 1_854_140, 0],
  ["2026-09", 5_701_099, 4_580_000],
  ["2026-10", 5_417_390, 2_800_000],
  ["2026-11", 2_083_890, 1_800_000],
];
const monthlyBars: MonthlyBarDataPoint[] = RAW.map(([key, total, health]) => ({
  key,
  month: key.slice(5),
  total,
  isCurrent: key === "2026-11",
  categories: { health, food: total - health },
}));
const NOW = new Date("2026-11-09T12:00:00.000Z");

describe("months", () => {
  const bars = toMonthBars({ monthlyBars }, NOW);

  it("orders bars by month and splits 의료·건강 from the rest", () => {
    expect(bars.map((b) => b.label)).toEqual([
      "3월",
      "4월",
      "5월",
      "6월",
      "7월",
      "8월",
      "9월",
      "10월",
      "11월",
    ]);
    const nov = bars[bars.length - 1];
    expect(nov).toMatchObject({ health: 1_800_000, rest: 283_890, isCurrent: true });
  });

  it("keeps the last 12 months and falls back to the current year without a key", () => {
    const legacy = [{ month: "08", total: 1, isCurrent: true, categories: {} }] as never;
    expect(toMonthBars({ monthlyBars: legacy }, NOW)[0].key).toBe("2026-08");
  });

  it("averages completed months only and labels the span", () => {
    const avg = averageBaseline(bars);
    expect(avg?.label).toBe("3–10월");
    expect(avg?.total).toBe(Math.round(RAW.slice(0, 8).reduce((s, r) => s + r[1], 0) / 8));
    expect(monthSpanLabel(bars.slice(0, 1))).toBe("3월");
  });

  it("labels a span across years by its length", () => {
    const across = toMonthBars(
      {
        monthlyBars: [
          { key: "2025-12", month: "12", total: 1, isCurrent: false, categories: {} },
          { key: "2026-01", month: "01", total: 1, isCurrent: false, categories: {} },
        ],
      },
      NOW
    );
    expect(monthSpanLabel(across)).toBe("최근 2개월");
  });

  it("finds the previous calendar month, across a year boundary too", () => {
    expect(previousMonth(bars, bars[bars.length - 1])?.label).toBe("10월");
    const jan = toMonthBars(
      {
        monthlyBars: [
          { key: "2025-12", month: "12", total: 5, isCurrent: false, categories: {} },
          { key: "2026-01", month: "01", total: 1, isCurrent: true, categories: {} },
        ],
      },
      NOW
    );
    expect(previousMonth(jan, jan[1])?.key).toBe("2025-12");
  });

  it("chooses three nice ticks that cover the maximum", () => {
    expect(niceTicks(5_701_099)).toEqual({
      ticks: [2_000_000, 4_000_000, 6_000_000],
      top: 6_000_000,
    });
    expect(niceTicks(0).top).toBeGreaterThan(0);
  });

  it("annotates above-average months explained by one category", () => {
    const notes = monthAnnotations(bars, averageBaseline(bars)?.total ?? null);
    expect(notes[0]).toMatchObject({ key: "2026-09", category: "health" });
    expect(notes.length).toBeLessThanOrEqual(2);
  });

  it("states how much 의료·건강 explains across the window", () => {
    const fact = chartSplitFact(bars, 600_000);
    expect(fact).not.toBeNull();
    const text = renderTemplate(fact!).text;
    expect(text).toContain("6·7·9·10·11월 다섯 달에 걸쳐 12,160,000원");
    expect(fact?.evidence).toEqual({
      kind: "keys",
      keys: ["split:2026-06", "split:2026-07", "split:2026-09", "split:2026-10", "split:2026-11"],
    });
  });
});

describe("hero", () => {
  const bars = toMonthBars({ monthlyBars }, NOW);
  const hero: HeroModel = {
    monthLabel: "11월",
    day: 9,
    daysInMonth: 30,
    total: 2_083_890,
    health: 1_800_000,
    healthCount: 1,
    healthItem: { merchant: "(주)휴메이크 헬스케어", dayKey: "2026-11-04" },
    rest: 283_890,
    restCount: 17,
    perDay: Math.round(283_890 / 9),
    previous: previousMonth(bars, bars[bars.length - 1]),
    average: averageBaseline(bars),
    sameDay: { previous: null, average: null },
  };

  it("compares the month to date with the average and last month", () => {
    expect(heroSentence(hero, "all")).toBe(
      "9일 만에 3–10월 월평균의 62%, 10월 전체의 38%를 썼어요. 그중 1,800,000원은 의료·건강 한 건이에요."
    );
    expect(heroSentence(hero, "ex")).toMatch(
      /^의료·건강을 빼면 9일 동안 283,890원, 하루 31,543원이에요/
    );
  });

  it("projects the everyday pace against the same baseline", () => {
    const fact = heroPaceFact(hero, "2026-11-01", "2026-11-09");
    expect(fact?.score).toBeGreaterThanOrEqual(0.5);
    const text = renderTemplate(fact!).text;
    expect(text).toMatch(/^나머지 속도라면 한 달 946,290원 — 의료·건강을 뺀 3–10월 월평균/);
    expect(fact?.evidence).toEqual({ kind: "keys", keys: ["rest"] });
  });

  it("stays quiet in the first two days", () => {
    expect(heroPaceFact({ ...hero, day: 2 }, "2026-11-01", "2026-11-02")).toBeNull();
  });
});

describe("ledger", () => {
  const rows = [
    tx({ id: "a", transactedAt: "2026-11-09T12:28:00.000Z", amount: 16_400 }),
    tx({
      id: "r1",
      type: "deposit",
      bucket: "income",
      merchant: "한국철도공사_토스 원",
      amount: 33_600,
      category: null,
      isRefund: true,
      transactedAt: "2026-11-08T10:22:00.000Z",
    }),
    tx({
      id: "r2",
      type: "deposit",
      bucket: "income",
      merchant: "한국철도공사_",
      amount: 32_300,
      category: null,
      isRefund: true,
      transactedAt: "2026-11-08T09:53:00.000Z",
    }),
    tx({ id: "b", transactedAt: "2026-11-08T13:08:00.000Z", amount: 16_280 }),
    // 00:26 KST on Nov 8 is still Nov 7 in UTC.
    tx({
      id: "c",
      type: "deposit",
      bucket: "income",
      merchant: "박주성",
      amount: 30_000,
      category: null,
      transactedAt: "2026-11-07T15:26:00.000Z",
    }),
  ];

  it("groups by KST day, newest first, with day totals", () => {
    const days = groupLedger(rows);
    expect(days.map((d) => d.key)).toEqual(["2026-11-09", "2026-11-08"]);
    expect(days[1]).toMatchObject({ spend: 16_280, refund: 65_900, count: 4 });
  });

  it("collapses one payer's same-day refunds into one row at the newest position", () => {
    const day = groupLedger(rows)[1];
    expect(day.rows.map((r) => r.id)).toEqual(["b", "refunds:2026-11-08:한국철도공사", "c"]);
    const group = day.rows[1];
    expect(group.kind === "refunds" && group.total).toBe(65_900);
  });

  it("signs cash flow and picks a mark per row kind", () => {
    expect(signedAmount(rows[0])).toBe(-16_400);
    expect(signedAmount(rows[4])).toBe(30_000);
    expect(rowMark(rows[0])).toEqual({ kind: "category", category: "food" });
    expect(rowMark(rows[1])).toEqual({ kind: "ledger", mark: "refund" });
    expect(rowMark(rows[4])).toEqual({ kind: "ledger", mark: "deposit" });
    expect(rowMark(tx({ id: "x", bucket: "ignore", type: "deposit", category: null }))).toEqual({
      kind: "ledger",
      mark: "self_transfer",
    });
  });

  it("flags one-offs, the month's biggest everyday charge and refunds", () => {
    const month = [
      tx({ id: "big", amount: 1_800_000, category: "health" }),
      tx({ id: "wheels", amount: 85_000, category: "leisure" }),
      tx({ id: "s1", amount: 16_400 }),
      tx({ id: "s2", amount: 16_280 }),
      tx({ id: "s3", amount: 15_200 }),
    ];
    const max = monthMaxCharge(month, 600_000);
    expect(max?.id).toBe("wheels");
    const ctx: FlagContext = {
      oneOffThreshold: 600_000,
      monthTotal: 1_932_880,
      monthRest: 132_880,
      monthRestCount: 4,
      monthMaxId: max?.id ?? null,
      monthLabel: "11월",
      refundTotal: 172_200,
      refundCount: 5,
      spendTotal: 2_083_890,
    };
    expect(rowFlag(month[0], ctx)?.label).toBe("1회성");
    expect(rowFlag(month[1], ctx)?.label).toBe("11월 최대");
    expect(rowFlag(month[2], ctx)).toBeNull();
    expect(rowFlag(rows[1], ctx)?.reason).toContain("순지출은 1,911,690원");
  });

  it("names the payer that dominates the top category", () => {
    const month = [
      tx({ id: "1", merchant: "쿠팡이츠", amount: 40_000 }),
      tx({ id: "2", merchant: "쿠팡이츠", amount: 23_400 }),
      tx({ id: "3", merchant: "성림지알에스", amount: 8_500 }),
      tx({ id: "4", merchant: "퍼스널 휠스", amount: 30_000, category: "leisure" }),
    ];
    const fact = topMerchantFact(month, 101_900, "11월", 9, {
      from: "2026-11-01",
      to: "2026-11-09",
    });
    expect(renderTemplate(fact!).text).toBe(
      "식비가 의료·건강 제외 지출의 71%, 그중 쿠팡이츠 2건이 63,400원이에요."
    );
  });
});

describe("periodRange", () => {
  it("covers this month, last month, three months and a year", () => {
    expect(periodRange("month", "2026-11-10")).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(periodRange("prev", "2026-11-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("prev", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("3m", "2026-02-10")).toEqual({ from: "2025-12-01", to: "2026-02-10" });
    expect(periodRange("1y", "2026-11-10")).toEqual({ from: "2025-12-01", to: "2026-11-10" });
  });
});

describe("displayNotificationTitle", () => {
  it("strips emoji and tidies whitespace", () => {
    expect(displayNotificationTitle("📈 오늘의 수익률")).toBe("오늘의 수익률");
    expect(displayNotificationTitle("토스뱅크 👨‍👩‍👧 모임 ✈️")).toBe("토스뱅크 모임");
    expect(displayNotificationTitle("1,000원 결제")).toBe("1,000원 결제");
    expect(displayNotificationTitle(null)).toBe("");
  });
});

describe("refundFlag scoped to a row", () => {
  it("talks about the row and names the period total apart", () => {
    const ctx = {
      oneOffThreshold: null,
      monthTotal: 0,
      monthRest: 0,
      monthRestCount: 0,
      monthMaxId: null,
      monthLabel: "11월",
      refundTotal: 172_200,
      refundCount: 5,
      spendTotal: 2_000_000,
    };
    const r = refundFlag(ctx, { count: 4, total: 133_800 }).reason;
    expect(r).toContain("이 환불 4건 133,800원");
    expect(r).toContain("모두 5건 172,200원");
    expect(refundFlag(ctx, { count: 5, total: 172_200 }).reason).not.toContain("모두");
  });
});
