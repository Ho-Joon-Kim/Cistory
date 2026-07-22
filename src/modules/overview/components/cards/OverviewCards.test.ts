import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverviewSnapshotDomains } from "../../service";
import { OverviewCards } from "./OverviewCards";

const computedAt = "2026-07-22T03:00:00.000Z";

function ready<T>(data: T) {
  return {
    data,
    status: "ready" as const,
    computedAt,
    computeVersion: 1,
    errorCode: null,
  };
}

function allReadyPayload(): OverviewSnapshotDomains {
  return {
    coding: ready({
      totalCommits: 3,
      totalAdditions: 30,
      totalDeletions: 4,
      activeDays: 2,
      dailyCommits: [{ date: "2026-07-20", count: 3 }],
      commitTypes: [{ type: "feat", count: 3 }],
      projects: [{ name: "cistory", commits: 3, additions: 30, deletions: 4 }],
      totalCodingSeconds: 7200,
      dailyCodingSeconds: [{ date: "2026-07-20", seconds: 7200 }],
      languages: [{ name: "TypeScript", seconds: 7200 }],
      deepWorkSessions: [{ date: "2026-07-20", project: "cistory", durationSeconds: 7200 }],
      contextSwitching: { avgDailyProjects: 1.5, avgDailyLanguages: 2 },
      weekdayHour: { weekdays: [1, 0, 0, 3, 0, 0, 0], hours: Array(24).fill(0) },
      yearlyReport: {
        languageTrend: [{ quarter: "Q3", languages: [{ name: "TypeScript", seconds: 7200 }] }],
        projectTimeline: [
          {
            name: "cistory",
            firstCommit: computedAt,
            lastCommit: computedAt,
            totalCommits: 3,
          },
        ],
        commitTypes: [{ type: "feat", count: 3 }],
      },
    }),
    location: ready({
      derived: {
        visits: {
          count: 1,
          durationSeconds: 3600,
          uniquePlaceCount: 1,
          places: [
            {
              placeName: "집",
              centerLat: 37.5,
              centerLon: 127,
              visitCount: 1,
              durationSeconds: 3600,
            },
          ],
        },
        tracks: { count: 1, distanceMeters: 1000, durationSeconds: 600 },
        transportModes: [
          {
            mode: "walking",
            segmentCount: 1,
            distanceMeters: 1000,
            durationSeconds: 600,
            sharePercent: 100,
          },
        ],
        subway: { tripCount: 0, sessionCount: 0, lines: [] },
        trips: [],
        visitedRegions: [
          {
            city: "서울",
            countryName: "대한민국",
            centerLat: 37.5,
            centerLon: 127,
            firstVisitDate: "2026-07-20",
            isFirstVisit: true,
          },
        ],
        placeProductivity: [],
      },
      heatmap: [{ lat: 37.5, lon: 127, weight: 2 }],
    }),
    health: ready({
      metrics: [
        { metric: "steps", total: 10000, average: 5000, min: 4000, max: 6000, days: [] },
        { metric: "sleep", total: 14, average: 7, min: 6, max: 8, days: [] },
        { metric: "heart_rate", total: null, average: 65, min: 50, max: 110, days: [] },
        { metric: "vo2_max", total: null, average: 42, min: 41, max: 43, days: [] },
      ],
      body: {
        measurementCount: 1,
        latestMeasuredAt: computedAt,
        weightKg: 70,
        weightChangeKg: -1,
        fatRatioPct: 18,
        muscleMassKg: 32,
        weightSeries: [],
      },
    }),
    spending: ready({
      spending: 100000,
      income: 200000,
      netSpend: -100000,
      daily: [],
      accountRoles: [{ role: "spending", spending: 100000, income: 200000 }],
      categories: [{ category: "food", spending: 50000 }],
    }),
    portfolio: ready({
      hasAccounts: true,
      evaluationTrend: [{ date: "2026-07-20", value: 1000000 }],
      twr: { totalReturn: 0.12, annualizedReturn: 0.2, days: 30 },
    }),
  };
}

function renderCards(payload: OverviewSnapshotDomains, periodType: "week" | "year") {
  return renderToStaticMarkup(createElement(OverviewCards, { payload, periodType }));
}

describe("OverviewCards", () => {
  it("renders the five real domain slots, translated values, and destination links", () => {
    const markup = renderCards(allReadyPayload(), "week");

    expect(markup.match(/data-overview-slot=/g)).toHaveLength(5);
    expect(markup).toContain("도보 · 100%");
    expect(markup).toContain('href="/overview?section=health"');
    expect(markup).toContain('href="/spending"');
    expect(markup).toContain('href="/portfolio"');
  });

  it("keeps every slot mounted when domain envelopes are failed or missing", () => {
    const payload = allReadyPayload();
    payload.coding = { ...payload.coding!, data: null, status: "failed", errorCode: "CODING" };
    payload.location = null;

    const markup = renderCards(payload, "week");

    expect(markup.match(/data-overview-slot=/g)).toHaveLength(5);
    expect(markup.match(/이 영역의 요약을 계산하지 못했거나 데이터가 없습니다\./g)).toHaveLength(2);
    expect(markup).toContain("소비 요약");
    expect(markup).toContain("자산 요약");
  });

  it("hides annual cards for a week and renders them for a year", () => {
    const payload = allReadyPayload();
    const week = renderCards(payload, "week");
    const year = renderCards(payload, "year");

    expect(week).not.toContain("연간 언어 추이와 프로젝트 타임라인");
    expect(week).not.toContain("방문 지역과 처음 방문한 곳");
    expect(year).toContain("연간 언어 추이와 프로젝트 타임라인");
    expect(year).toContain("방문 지역과 처음 방문한 곳");
  });
});
