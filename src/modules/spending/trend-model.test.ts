import { describe, expect, it } from "vitest";
import type { SpendingTrendResponse } from "./types";
import {
  forecastRows,
  type HeroModel,
  heroSentence,
  referenceLabel,
  sameDayRefs,
  trendModel,
  trendValueAt,
} from "./view-model";

/** 10 days in, 1,800,000원 의료·건강 on day 4 plus 30,000원 a day of everything else. */
function fixture(): SpendingTrendResponse {
  const daily = 30_000;
  const days = 30;
  const today = 10;
  return {
    cumulativeCurve: Array.from({ length: days }, (_, i) => {
      const day = i + 1;
      const health = day >= 4 ? 1_800_000 : 0;
      const food = day * daily;
      return {
        day,
        actual: day <= today ? health + food : null,
        mid: null,
        upper: null,
        lower: null,
        categories: day <= today ? { health, food } : {},
      };
    }),
    references: {
      previous: {
        months: ["2026-10"],
        total: Array.from({ length: days }, (_, i) => (i + 1) * 50_000),
        split: Array.from({ length: days }, () => 0),
      },
      average: {
        months: ["2026-08", "2026-09", "2026-10"],
        total: Array.from({ length: days }, (_, i) => (i + 1) * 40_000 + 100_000),
        split: Array.from({ length: days }, () => 100_000),
      },
    },
    monthlyBars: [],
    forecast: {
      predictedTotal: 2_700_000,
      upperBound: 3_000_000,
      lowerBound: 2_400_000,
      todayDayNumber: today,
      daysInMonth: days,
      currentMonthActualTotal: 2_100_000,
      oneOffTotal: 1_800_000,
      oneOffCount: 1,
      oneOffThreshold: 700_000,
    },
  };
}

describe("referenceLabel", () => {
  it("names one month, a same-year span, or a cross-year count", () => {
    expect(referenceLabel({ months: ["2026-10"] })).toBe("10월");
    expect(referenceLabel({ months: ["2026-08", "2026-09", "2026-10"] })).toBe("8–10월 평균");
    expect(referenceLabel({ months: ["2025-12", "2026-01"] })).toBe("최근 2개월 평균");
  });
});

describe("trendModel", () => {
  it("uses the server forecast and band on the 전체 basis", () => {
    const m = trendModel(fixture(), "all");
    expect(m.actual).toHaveLength(10);
    expect(m.now).toBe(2_100_000);
    expect(m.forecast).toEqual({ mid: 2_700_000, range: { lower: 2_400_000, upper: 3_000_000 } });
    expect(m.references.map((r) => r.label)).toEqual(["10월", "8–10월 평균"]);
    // Halfway between today and month end the projection is halfway to the mid.
    expect(trendValueAt(m, 20)).toBe(2_100_000 + Math.round((600_000 * 10) / 20));
  });

  it("drops 의료·건강 everywhere and projects the pace without a band", () => {
    const m = trendModel(fixture(), "ex");
    expect(m.now).toBe(300_000);
    expect(m.forecast).toEqual({ mid: 900_000, range: null });
    expect(m.references[1].values[0]).toBe(40_000);
  });

  it("has no forecast before the month's first spending or on its last day", () => {
    const empty = fixture();
    empty.cumulativeCurve = empty.cumulativeCurve.map((p) => ({
      ...p,
      actual: p.actual === null ? null : 0,
      categories: {},
    }));
    expect(trendModel(empty, "all").forecast).toBeNull();
    const last = fixture();
    last.forecast.todayDayNumber = 30;
    expect(trendModel(last, "all").forecast).toBeNull();
  });

  it("puts the method, band and drivers in the evidence rows", () => {
    const t = fixture();
    const rows = forecastRows(t, trendModel(t, "all"));
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual([
      "지금까지",
      "1회성 결제",
      "하루 속도",
      "예상 범위",
      "범위 근거",
      "많이 쓴 곳",
    ]);
    expect(rows.find((r) => r.label === "하루 속도")?.value).toBe("30,000원 × 남은 20일");
    expect(rows.find((r) => r.label === "많이 쓴 곳")?.value).toBe("식비 300,000원");
  });
});

describe("heroSentence with same-day references", () => {
  const t = fixture();
  const hero: HeroModel = {
    monthLabel: "11월",
    day: 10,
    daysInMonth: 30,
    total: 2_100_000,
    health: 1_800_000,
    healthCount: 1,
    healthItem: null,
    rest: 300_000,
    restCount: 20,
    perDay: 30_000,
    previous: null,
    average: null,
    sameDay: sameDayRefs(t.references, 10),
  };

  it("leads with the same-day change the chart draws", () => {
    expect(heroSentence(hero, "all")).toBe(
      "10월 같은 날보다 1,600,000원 더, 8–10월 평균 같은 날보다 1,600,000원 더 썼어요. 그중 1,800,000원은 의료·건강 한 건이에요."
    );
  });

  it("compares the rest on the 의료·건강 제외 basis", () => {
    expect(heroSentence(hero, "ex")).toBe(
      "의료·건강을 빼면 10일 동안 300,000원, 하루 30,000원이에요. 10월 같은 날보다 200,000원 덜, 8–10월 평균 같은 날보다 100,000원 덜 썼어요."
    );
  });

  it("calls a near-equal day 비슷하게", () => {
    const close = { ...hero, total: 505_000, health: 0, rest: 505_000 };
    expect(heroSentence({ ...close, sameDay: { ...close.sameDay, average: null } }, "all")).toBe(
      "10월 같은 날과 비슷하게 썼어요."
    );
  });
});
