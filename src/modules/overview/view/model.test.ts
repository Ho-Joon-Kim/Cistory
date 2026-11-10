process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/facts";
import type { OverviewHistoryPeriod, OverviewHistoryResponse } from "../history";
import type { OverviewSnapshotDomains } from "../service";
import type { LocationAggregate } from "../types";
import { evidenceTag } from "./evidence-tag";
import { buildHeadline } from "./headline";
import { periodContext, periodMeta, periodTitle } from "./labels";
import { buildOverviewModel } from "./model";
import { groupPlaces, shortRegion } from "./sections";

const NOW = new Date("2026-11-10T03:00:00Z");
const TODAY = "2026-11-10";

function envelope<T>(data: T) {
  return {
    data,
    status: "ready" as const,
    computedAt: "2026-11-01T00:00:00Z",
    computeVersion: 5,
    errorCode: null,
  };
}

function period(
  key: string,
  overrides: Partial<OverviewHistoryPeriod> = {}
): OverviewHistoryPeriod {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    periodType: "month",
    periodKey: key,
    from: `${key}-01`,
    to: `${key}-${last}`,
    inProgress: false,
    commits: 100,
    activeDays: 20,
    spending: 1_000_000,
    income: 1_000_000,
    steps: { total: 120_000, days: 30 },
    heartRate: 75,
    weight: null,
    ...overrides,
  };
}

const days = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

const domains: OverviewSnapshotDomains = {
  coding: envelope({
    totalCommits: 1000,
    totalAdditions: 0,
    totalDeletions: 0,
    activeDays: 26,
    // A five-day burst (18–22) holding 60% of the month.
    dailyCommits: days.map((date, i) => ({ date, count: i >= 17 && i <= 21 ? 120 : 16 })),
    commitTypes: [],
    projects: [
      { name: "me/main", commits: 900, additions: 0, deletions: 0 },
      { name: "org/a", commits: 40, additions: 0, deletions: 0 },
      { name: "org/b", commits: 30, additions: 0, deletions: 0 },
      { name: "org/c", commits: 30, additions: 0, deletions: 0 },
    ],
    totalCodingSeconds: 0,
    dailyCodingSeconds: [],
    languages: [],
    deepWorkSessions: [],
    contextSwitching: { avgDailyProjects: 0, avgDailyLanguages: 0 },
    weekdayHour: {
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      hours: Array.from({ length: 24 }, (_, h) => (h < 4 ? 50 : 10)),
    },
  }),
  spending: envelope({
    spending: 5_417_390,
    income: 12_467_201,
    netSpend: 0,
    daily: [
      { date: "2026-10-02", spending: 54_900, income: 8_738_100, netSpend: 0 },
      { date: "2026-10-04", spending: 1_618_300, income: 0, netSpend: 0 },
      { date: "2026-10-26", spending: 1_200_000, income: 2_200_000, netSpend: 0 },
      { date: "2026-10-07", spending: 2_544_190, income: 1_529_101, netSpend: 0 },
    ],
    accountRoles: [],
    categories: [
      { category: "health", spending: 2_800_000 },
      { category: "finance", spending: 1_082_590 },
      { category: "food", spending: 662_540 },
    ],
  }),
  health: envelope({
    metrics: [
      {
        metric: "steps",
        total: null,
        average: 32.7,
        min: null,
        max: null,
        days: days.slice(0, 25).map((date) => ({ date, value: 3000 })),
      },
      {
        metric: "heart_rate",
        total: null,
        average: 76,
        min: null,
        max: null,
        days: [{ date: "2026-10-01", value: 76 }],
      },
    ],
    body: {
      measurementCount: 3,
      latestMeasuredAt: null,
      weightKg: 86.3,
      weightChangeKg: null,
      fatRatioPct: null,
      muscleMassKg: null,
      weightSeries: [
        { date: "2026-10-04", weight: 87.6 },
        { date: "2026-10-27", weight: 86.3 },
      ],
    },
  }),
  location: null,
  portfolio: envelope({
    hasAccounts: true,
    evaluationTrend: [
      { date: "2026-10-01", value: 54_947_180 },
      { date: "2026-10-23", value: 50_880_433 },
      { date: "2026-10-31", value: 52_344_071 },
    ],
    twr: { totalReturn: -0.0267, annualizedReturn: null, days: 30 },
  }),
};

const history: OverviewHistoryResponse = {
  periodType: "month",
  periodKey: "2026-10",
  previous: period("2026-09", {
    commits: 980,
    activeDays: 30,
    spending: 5_701_099,
    income: 5_218_550,
    steps: { total: 108_000, days: 30 },
    weight: { date: "2026-09-29", weight: 87.1 },
  }),
  series: [
    ...["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map(
      (k) => period(k)
    ),
    period("2026-09", { commits: 980, steps: { total: 108_000, days: 30 } }),
    period("2026-10", { commits: 1000, steps: { total: 75_000, days: 25 } }),
  ],
  weight: [
    { date: "2026-09-06", weight: 90.5 },
    { date: "2026-09-29", weight: 87.1 },
  ],
};

function model() {
  return buildOverviewModel({
    periodType: "month",
    periodKey: "2026-10",
    computedAt: "2026-10-31T15:00:00Z",
    domains,
    history,
    today: TODAY,
    now: NOW,
  });
}

describe("labels", () => {
  it("titles and meta for an ended month and a running year", () => {
    const month = periodContext("month", "2026-10", TODAY, NOW);
    expect(periodTitle(month)).toBe("2026년 10월");
    expect(periodMeta(month, "2026-10-31T15:00:00Z")).toBe("10월 1일–31일 · 11월 1일 00:00 집계");
    expect(month.previousLabel).toBe("9월");
    const year = periodContext("year", "2026", TODAY, NOW);
    expect(year.inProgress).toBe(true);
    expect(periodMeta(year, null)).toBe("1월 1일–11월 10일 · 진행 중");
    expect(periodContext("week", "2026-W46", TODAY, NOW).label).toBe("이번 주");
    expect(periodContext("month", "2026-01", TODAY, NOW).previousLabel).toBe("2025년 12월");
  });
});

describe("headline", () => {
  it("joins the three comparisons and closes on the period noun", () => {
    const ctx = periodContext("month", "2026-10", TODAY, NOW);
    expect(
      buildHeadline(ctx, {
        commits: 4678,
        previousCommits: 4415,
        net: 7_050_000,
        previousNet: -483_000,
        weight: 86.3,
        previousWeight: 87.1,
      })
    ).toBe("커밋 속도는 9월 그대로, 현금흐름은 흑자로 돌아서고 체중이 줄어든 달");
  });

  it("is omitted without any comparison", () => {
    const ctx = periodContext("month", "2026-10", TODAY, NOW);
    expect(
      buildHeadline(ctx, {
        commits: 1,
        previousCommits: null,
        net: null,
        previousNet: null,
        weight: null,
        previousWeight: null,
      })
    ).toBeNull();
  });
});

describe("buildOverviewModel", () => {
  it("leads the hero with changes vs the previous period", () => {
    const { hero } = model();
    expect(hero.commits?.delta).toEqual({ text: "9월 980보다 2% 많음", dir: "up" });
    expect(hero.commits?.foot.delta?.text).toBe("9월 30일");
    expect(hero.savings?.delta?.text).toBe("9월 −48.3만원에서 흑자 전환");
    expect(hero.body.weight?.delta?.text).toBe("9월 말 87.1kg보다 0.8kg 감소");
    expect(hero.body.steps?.average).toBe(3000);
    expect(hero.body.steps?.delta?.dir).toBe("down");
    // History bars: ten months, October current.
    expect(hero.commits?.bars).toHaveLength(10);
    expect(hero.commits?.bars.at(-1)?.current).toBe(true);
  });

  it("renders template-first AI lines with exactly one fact", () => {
    const { hero, asset, details } = model();
    expect(renderTemplate(hero.commits?.fact ?? fail()).text).toBe(
      "커밋의 59%가 10월 18일–22일 닷새에 몰렸어요."
    );
    expect(renderTemplate(hero.savings?.fact ?? fail()).text).toBe(
      "수입의 70%는 10월 2일 하루 입금이에요 — 이를 빼면 −168.8만원."
    );
    expect(renderTemplate(hero.body.weight?.fact ?? fail()).text).toBe(
      "9월 6일 정점 90.5kg 이후 내림세 — 정점보다 4.2kg 낮아요."
    );
    expect(renderTemplate(asset?.fact ?? fail()).text).toBe(
      "10월 23일 저점 5,088만원에서 월말까지 2.9% 회복했어요."
    );
    const category = details.find((t) => t.id === "category");
    expect(renderTemplate(category?.fact ?? fail()).text).toBe(
      "의료·건강이 지출의 62% — 이를 빼면 지출은 174.5만원."
    );
    const repo = details.find((t) => t.id === "repo");
    expect(repo?.rows.map((r) => r.name)).toEqual(["main", "org · 저장소 3개"]);
  });

  it("shows the viewed period's own numbers in its history bar", () => {
    // The history entry for October (from overlapping snapshots) disagrees with
    // the month's own snapshot; every surface uses the snapshot.
    const drifted: OverviewHistoryResponse = {
      ...history,
      series: history.series.map((p) =>
        p.periodKey === "2026-10" ? { ...p, commits: 990, steps: { total: 76_000, days: 25 } } : p
      ),
    };
    const m = buildOverviewModel({
      periodType: "month",
      periodKey: "2026-10",
      computedAt: null,
      domains,
      history: drifted,
      today: TODAY,
      now: NOW,
    });
    expect(m.hero.body.steps?.average).toBe(3000);
    expect(m.hero.body.steps?.bars.at(-1)?.tip).toContain("하루 3,000보");
    expect(m.hero.commits?.bars.at(-1)?.tip).toContain("1,000");
  });

  it("tags each hero fact with the series its evidence belongs to", () => {
    const { hero, asset } = model();
    const tag = (f: { evidence?: unknown } | null | undefined) =>
      evidenceTag(f?.evidence as Parameters<typeof evidenceTag>[0]);
    expect(tag(hero.commits?.fact)).toBe("commits");
    expect(tag(hero.savings?.fact)).toBe("cash.income");
    expect(tag(hero.body.weight?.fact)).toBe("weight");
    expect(tag(asset?.fact)).toBe("evaluation");
  });

  it("never puts heart rate in the hero", () => {
    const { hero } = model();
    expect(JSON.stringify(hero)).not.toMatch(/bpm|심박/);
  });

  it("annotates the flow chart and drops history from another period", () => {
    const m = buildOverviewModel({
      periodType: "month",
      periodKey: "2026-10",
      computedAt: null,
      domains,
      history: { ...history, periodKey: "2026-09" },
      today: TODAY,
      now: NOW,
    });
    expect(m.hero.commits?.delta).toBeNull();
    expect(m.headline).toBeNull();
    expect(m.flow.units).toHaveLength(31);
    expect(m.flow.annotations.commits[0].label).toBe("최다 120");
    expect(m.flow.annotations.cash.map((a) => a.label)).toEqual([
      "지출 254.4만원",
      "입금 873.8만원",
    ]);
  });
});

describe("places", () => {
  it("groups away-from-home places by area and shortens region names", () => {
    expect(shortRegion("전북특별자치도")).toBe("전북");
    expect(shortRegion("대전광역시")).toBe("대전");
    expect(shortRegion("서울")).toBe("서울");
    const place = (placeName: string, lat: number, lon: number, durationSeconds: number) => ({
      placeName,
      centerLat: lat,
      centerLon: lon,
      visitCount: 1,
      durationSeconds,
    });
    const derived = {
      visits: {
        count: 4,
        durationSeconds: 0,
        uniquePlaceCount: 4,
        places: [
          place("집", 37.508, 127.031, 1000),
          place("회사", 37.5, 127.03, 500),
          place("본가", 36.35, 127.38, 300),
          place("치킨집", 36.36, 127.35, 100),
        ],
      },
      visitedRegions: [
        {
          city: "대전광역시",
          countryName: "대한민국",
          centerLat: 36.34,
          centerLon: 127.42,
          firstVisitDate: "2025-03-28",
          isFirstVisit: false,
        },
      ],
    } as unknown as LocationAggregate["derived"];
    const groups = groupPlaces(derived);
    expect(groups.map((g) => [g.name, g.places.length])).toEqual([
      ["집", 1],
      ["회사", 1],
      ["대전", 2],
    ]);
  });
});

function fail(): never {
  throw new Error("expected a fact");
}
