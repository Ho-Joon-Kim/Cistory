import type { PeriodType } from "../../period";
import type { PeriodAggregatePayload, PeriodDomainEnvelope } from "../../types";

export type OverviewSectionId = "coding" | "location" | "health" | "spending" | "portfolio";

export interface OverviewCardMetadata {
  id: string;
  section: OverviewSectionId;
  periods: readonly PeriodType[];
  href?: string;
}

const allPeriods = ["recent", "week", "month", "year"] as const;
const longPeriods = ["recent", "month", "year"] as const;

export const overviewCardMetadata = [
  { id: "coding-activity", section: "coding", periods: allPeriods },
  { id: "coding-breakdown", section: "coding", periods: allPeriods },
  { id: "coding-focus", section: "coding", periods: allPeriods },
  { id: "coding-weekday-hour", section: "coding", periods: allPeriods },
  { id: "coding-yearly-trends", section: "coding", periods: ["year"] },
  { id: "location-places", section: "location", periods: allPeriods },
  { id: "location-transport", section: "location", periods: allPeriods },
  { id: "location-trips", section: "location", periods: allPeriods },
  { id: "location-productivity", section: "location", periods: allPeriods },
  { id: "location-scratch-map", section: "location", periods: longPeriods },
  {
    id: "health-summary",
    section: "health",
    periods: allPeriods,
    href: "/overview?section=health",
  },
  { id: "spending-summary", section: "spending", periods: allPeriods, href: "/spending" },
  { id: "portfolio-summary", section: "portfolio", periods: allPeriods, href: "/portfolio" },
] as const satisfies readonly OverviewCardMetadata[];

export const R14_COVERAGE_MANIFEST = [
  {
    concept: "language trend",
    field: "coding.yearlyReport.languageTrend",
    owner: "overview/coding",
  },
  {
    concept: "project timeline",
    field: "coding.yearlyReport.projectTimeline",
    owner: "overview/coding",
  },
  { concept: "commit types", field: "coding.commitTypes", owner: "overview/coding" },
  { concept: "deep work", field: "coding.deepWorkSessions", owner: "overview/coding" },
  { concept: "context switching", field: "coding.contextSwitching", owner: "overview/coding" },
  { concept: "weekday/hour activity", field: "coding.weekdayHour", owner: "overview/coding" },
  { concept: "scratch map", field: "location.derived.visitedRegions", owner: "overview/location" },
  {
    concept: "first visits",
    field: "location.derived.visitedRegions.isFirstVisit",
    owner: "overview/location",
  },
] as const;

export function visibleOverviewCards(periodType: PeriodType) {
  return overviewCardMetadata.filter((card) =>
    card.periods.some((period) => period === periodType)
  );
}

export interface OverviewFact {
  key: string;
  label: string;
  value: string | number | boolean | null;
}

export interface OverviewSectionRenderModel {
  id: OverviewSectionId;
  status: "ready" | "failed";
  computedAt: string;
  empty: boolean;
  facts: OverviewFact[];
}

function section<T>(
  id: OverviewSectionId,
  envelope: PeriodDomainEnvelope<T>,
  facts: (data: T) => OverviewFact[]
): OverviewSectionRenderModel {
  return {
    id,
    status: envelope.status,
    computedAt: envelope.computedAt,
    empty: envelope.status === "failed" || envelope.data === null,
    facts: envelope.data ? facts(envelope.data) : [],
  };
}

export function buildOverviewRenderModel(payload: PeriodAggregatePayload, _periodType: PeriodType) {
  const coding = section("coding", payload.coding, (data) => [
    { key: "commits", label: "커밋", value: data.totalCommits },
    { key: "activeDays", label: "활동일", value: data.activeDays },
    { key: "codingSeconds", label: "코딩 시간", value: data.totalCodingSeconds },
  ]);
  const location = section("location", payload.location, (data) => [
    { key: "visits", label: "방문", value: data.derived.visits.count },
    { key: "distance", label: "이동 거리", value: data.derived.tracks.distanceMeters },
    { key: "trips", label: "여행", value: data.derived.trips.length },
  ]);
  const health = section("health", payload.health, (data) => {
    const metrics = new Map(data.metrics.map((metric) => [metric.metric, metric]));
    return [
      { key: "steps", label: "걸음", value: metrics.get("steps")?.average ?? null },
      { key: "sleep", label: "수면", value: metrics.get("sleep")?.average ?? null },
      { key: "heart_rate", label: "심박", value: metrics.get("heart_rate")?.average ?? null },
      { key: "vo2_max", label: "VO₂max", value: metrics.get("vo2_max")?.average ?? null },
      { key: "body", label: "체중", value: data.body.weightKg },
    ];
  });
  const spending = section("spending", payload.spending, (data) => [
    { key: "spending", label: "지출", value: data.spending },
    { key: "income", label: "수입", value: data.income },
    { key: "netSpend", label: "순지출", value: data.netSpend },
    ...data.accountRoles.map((role) => ({
      key: `accountRole:${role.role}`,
      label: role.role,
      value: role.spending - role.income,
    })),
  ]);
  const portfolio = section("portfolio", payload.portfolio, (data) => [
    { key: "hasAccounts", label: "계좌 연결", value: data.hasAccounts },
    {
      key: "evaluation",
      label: "평가액",
      value: data.evaluationTrend.at(-1)?.value ?? null,
    },
    { key: "twr", label: "기간 수익률", value: data.twr.totalReturn },
  ]);

  return { sections: [coding, location, health, spending, portfolio] };
}
