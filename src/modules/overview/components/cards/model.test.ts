import { describe, expect, it } from "vitest";
import type { PeriodAggregatePayload } from "../../types";
import {
  buildOverviewRenderModel,
  overviewCardMetadata,
  R14_COVERAGE_MANIFEST,
  visibleOverviewCards,
} from "./model";

const computedAt = "2026-07-22T03:00:00.000Z";
const envelope = <T>(data: T) => ({
  data,
  status: "ready" as const,
  computedAt,
  computeVersion: 1,
  errorCode: null,
});

function payload(): PeriodAggregatePayload {
  return {
    coding: envelope({
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
    location: envelope({
      derived: {
        visits: { count: 1, durationSeconds: 3600, uniquePlaceCount: 1, places: [] },
        tracks: { count: 1, distanceMeters: 1000, durationSeconds: 600 },
        transportModes: [],
        subway: { tripCount: 1, sessionCount: 1, lines: [] },
        trips: [],
        visitedRegions: [],
        placeProductivity: [],
      },
      heatmap: [],
    }),
    health: envelope({
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
    spending: envelope({
      spending: 100000,
      income: 200000,
      netSpend: -100000,
      daily: [],
      accountRoles: [{ role: "spending", spending: 100000, income: 200000 }],
      categories: [{ category: "food", spending: 50000 }],
    }),
    portfolio: envelope({
      hasAccounts: true,
      evaluationTrend: [{ date: "2026-07-20", value: 1000000 }],
      twr: { totalReturn: 0.12, annualizedReturn: 0.2, days: 30 },
    }),
  };
}

describe("overview render model", () => {
  it("always exposes five safe domain sections", () => {
    expect(
      buildOverviewRenderModel(payload(), "month").sections.map((section) => section.id)
    ).toEqual(["coding", "location", "health", "spending", "portfolio"]);
    const empty = buildOverviewRenderModel(
      {
        coding: { ...payload().coding, data: null, status: "failed" },
        location: { ...payload().location, data: null, status: "failed" },
        health: { ...payload().health, data: null, status: "failed" },
        spending: { ...payload().spending, data: null, status: "failed" },
        portfolio: { ...payload().portfolio, data: null, status: "failed" },
      },
      "week"
    );
    expect(empty.sections.every((section) => section.empty)).toBe(true);
  });

  it("hides annual-only cards during a week", () => {
    const ids = visibleOverviewCards("week").map((card) => card.id);
    expect(ids).not.toContain("coding-yearly-trends");
    expect(ids).not.toContain("location-scratch-map");
    expect(visibleOverviewCards("year").map((card) => card.id)).toContain("coding-yearly-trends");
  });

  it("keeps all required health metrics and body in one domain", () => {
    const health = buildOverviewRenderModel(payload(), "month").sections.find(
      (section) => section.id === "health"
    );
    expect(health?.facts.map((fact) => fact.key)).toEqual(
      expect.arrayContaining(["steps", "sleep", "heart_rate", "vo2_max", "body"])
    );
  });

  it("renders role-aware net spending and portfolio TWR", () => {
    const model = buildOverviewRenderModel(payload(), "month");
    const spending = model.sections.find((section) => section.id === "spending");
    const portfolio = model.sections.find((section) => section.id === "portfolio");
    expect(spending?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "netSpend", value: -100000 }),
        expect.objectContaining({ key: "accountRole:spending" }),
      ])
    );
    expect(portfolio?.facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "twr", value: 0.12 })])
    );
  });

  it("contains only read-through destination links and no destructive actions", () => {
    expect(overviewCardMetadata.find((card) => card.id === "health-summary")?.href).toBe(
      "/overview?section=health"
    );
    expect(overviewCardMetadata.find((card) => card.id === "spending-summary")?.href).toBe(
      "/spending"
    );
    expect(overviewCardMetadata.find((card) => card.id === "portfolio-summary")?.href).toBe(
      "/portfolio"
    );
    expect(overviewCardMetadata.every((card) => !("actions" in card))).toBe(true);
  });

  it("maps every R14 concept to an overview-owned payload field", () => {
    expect(R14_COVERAGE_MANIFEST.map((entry) => entry.concept)).toEqual([
      "language trend",
      "project timeline",
      "commit types",
      "deep work",
      "context switching",
      "weekday/hour activity",
      "scratch map",
      "first visits",
    ]);
    expect(R14_COVERAGE_MANIFEST.every((entry) => entry.owner.startsWith("overview/"))).toBe(true);
  });
});
