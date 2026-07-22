import type { DerivedLocationAggregate, LocationHeatmapPoint } from "./aggregate/location";
import type { PeriodType } from "./period";

export type PeriodDomainStatus = "ready" | "failed";

export interface PeriodDomainEnvelope<T> {
  data: T | null;
  status: PeriodDomainStatus;
  computedAt: string;
  computeVersion: number;
  errorCode: string | null;
}

export interface PeriodAggregateInput {
  userId: string;
  periodType: PeriodType;
  periodKey: string;
  computedAt?: Date;
  computeVersion: number;
}

export interface DailyCountPoint {
  date: string;
  count: number;
}

export interface NamedSeconds {
  name: string;
  seconds: number;
}

export interface CodingAggregate {
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
  activeDays: number;
  dailyCommits: DailyCountPoint[];
  commitTypes: { type: string; count: number }[];
  projects: { name: string; commits: number; additions: number; deletions: number }[];
  totalCodingSeconds: number;
  dailyCodingSeconds: { date: string; seconds: number }[];
  languages: NamedSeconds[];
  deepWorkSessions: { date: string; project: string | null; durationSeconds: number }[];
  contextSwitching: { avgDailyProjects: number; avgDailyLanguages: number };
  weekdayHour: { weekdays: number[]; hours: number[] };
  yearlyReport?: {
    languageTrend: { quarter: string; languages: NamedSeconds[] }[];
    projectTimeline: {
      name: string;
      firstCommit: string;
      lastCommit: string;
      totalCommits: number;
    }[];
    commitTypes: { type: string; count: number }[];
  };
}

export interface LocationAggregate {
  derived: DerivedLocationAggregate;
  heatmap: LocationHeatmapPoint[];
}

export interface HealthMetricAggregate {
  metric: "steps" | "sleep" | "heart_rate" | "vo2_max";
  total: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
  days: { date: string; value: number | null }[];
}

export interface HealthAggregate {
  metrics: HealthMetricAggregate[];
  body: {
    measurementCount: number;
    latestMeasuredAt: string | null;
    weightKg: number | null;
    weightChangeKg: number | null;
    fatRatioPct: number | null;
    muscleMassKg: number | null;
    weightSeries: { date: string; weight: number }[];
  };
}

export interface SpendingAggregate {
  spending: number;
  income: number;
  netSpend: number;
  daily: { date: string; spending: number; income: number; netSpend: number }[];
  accountRoles: { role: string; spending: number; income: number }[];
  categories: { category: string; spending: number }[];
}

export interface PortfolioAggregate {
  hasAccounts: boolean;
  evaluationTrend: { date: string; value: number }[];
  twr: { totalReturn: number | null; annualizedReturn: number | null; days: number };
}

export interface PeriodAggregatePayload {
  coding: PeriodDomainEnvelope<CodingAggregate>;
  location: PeriodDomainEnvelope<LocationAggregate>;
  health: PeriodDomainEnvelope<HealthAggregate>;
  spending: PeriodDomainEnvelope<SpendingAggregate>;
  portfolio: PeriodDomainEnvelope<PortfolioAggregate>;
}
