/**
 * Year Comparison Service
 *
 * Compares two years of data across commits, coding, and location.
 * Ported from Dawarich: app/services/insights/year_comparison_calculator.rb
 */

import { ReportService } from "./service";
import { getDb } from "@/db";

// ── Types ────────────────────────────────────────────────────────────────────

interface YearMetrics {
  totalCommits: number;
  activeDays: number;
  maxStreak: number;
  totalCodingSeconds: number;
  totalDistanceMeters: number;
}

interface MetricDelta {
  value: number;
  growthPercent: number; // 0 if previous is 0
}

export interface YearComparisonData {
  year1: string;
  year2: string;
  metrics: {
    year1: YearMetrics;
    year2: YearMetrics;
  };
  deltas: {
    commits: MetricDelta;
    activeDays: MetricDelta;
    codingSeconds: MetricDelta;
    distanceMeters: MetricDelta;
  };
  monthlyComparison: MonthlyComparisonEntry[];
}

interface MonthlyComparisonEntry {
  month: string; // "01" ~ "12"
  year1Commits: number;
  year2Commits: number;
  year1CodingSeconds: number;
  year2CodingSeconds: number;
  year1DistanceMeters: number;
  year2DistanceMeters: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Dawarich growth calculation: ((current - previous) / previous * 100).round
 * Returns 0 if previous is null or zero.
 */
function calcGrowth(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 100);
}

function delta(current: number, previous: number): MetricDelta {
  return {
    value: current - previous,
    growthPercent: calcGrowth(current, previous),
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

export async function compareYears(
  userId: string,
  year1: string,
  year2: string,
): Promise<YearComparisonData> {
  const service = new ReportService(getDb());

  // Fetch yearly data for both years in parallel
  const [
    commits1,
    commits2,
    coding1,
    coding2,
    location1,
    location2,
  ] = await Promise.all([
    service.aggregateYearlyCommits(userId, year1),
    service.aggregateYearlyCommits(userId, year2),
    service.aggregateYearlyCoding(userId, year1),
    service.aggregateYearlyCoding(userId, year2),
    service.aggregateYearlyLocation(userId, year1),
    service.aggregateYearlyLocation(userId, year2),
  ]);

  const metrics1: YearMetrics = {
    totalCommits: commits1.totalCommits,
    activeDays: commits1.activeDays,
    maxStreak: commits1.maxStreak,
    totalCodingSeconds: coding1.totalCodingSeconds,
    totalDistanceMeters: location1.totalDistanceMeters,
  };

  const metrics2: YearMetrics = {
    totalCommits: commits2.totalCommits,
    activeDays: commits2.activeDays,
    maxStreak: commits2.maxStreak,
    totalCodingSeconds: coding2.totalCodingSeconds,
    totalDistanceMeters: location2.totalDistanceMeters,
  };

  // Build monthly comparison
  const monthlyComparison: MonthlyComparisonEntry[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthStr = String(m).padStart(2, "0");

    const y1Commits = commits1.dailyCommits
      ?.filter(
        (d: { date: string }) => d.date.startsWith(`${year1}-${monthStr}`),
      )
      .reduce((s: number, d: { count: number }) => s + d.count, 0) ?? 0;

    const y2Commits = commits2.dailyCommits
      ?.filter(
        (d: { date: string }) => d.date.startsWith(`${year2}-${monthStr}`),
      )
      .reduce((s: number, d: { count: number }) => s + d.count, 0) ?? 0;

    const y1Coding = coding1.dailyCodingSeconds
      ?.filter(
        (d: { date: string }) => d.date.startsWith(`${year1}-${monthStr}`),
      )
      .reduce((s: number, d: { seconds: number }) => s + d.seconds, 0) ?? 0;

    const y2Coding = coding2.dailyCodingSeconds
      ?.filter(
        (d: { date: string }) => d.date.startsWith(`${year2}-${monthStr}`),
      )
      .reduce((s: number, d: { seconds: number }) => s + d.seconds, 0) ?? 0;

    const y1Distance = location1.dailyDistances
      ?.filter(
        (d: { date: string }) => d.date.startsWith(`${year1}-${monthStr}`),
      )
      .reduce(
        (s: number, d: { meters: number }) => s + d.meters,
        0,
      ) ?? 0;

    const y2Distance = location2.dailyDistances
      ?.filter(
        (d: { date: string }) => d.date.startsWith(`${year2}-${monthStr}`),
      )
      .reduce(
        (s: number, d: { meters: number }) => s + d.meters,
        0,
      ) ?? 0;

    monthlyComparison.push({
      month: monthStr,
      year1Commits: y1Commits,
      year2Commits: y2Commits,
      year1CodingSeconds: y1Coding,
      year2CodingSeconds: y2Coding,
      year1DistanceMeters: y1Distance,
      year2DistanceMeters: y2Distance,
    });
  }

  return {
    year1,
    year2,
    metrics: { year1: metrics1, year2: metrics2 },
    deltas: {
      commits: delta(metrics2.totalCommits, metrics1.totalCommits),
      activeDays: delta(metrics2.activeDays, metrics1.activeDays),
      codingSeconds: delta(
        metrics2.totalCodingSeconds,
        metrics1.totalCodingSeconds,
      ),
      distanceMeters: delta(
        metrics2.totalDistanceMeters,
        metrics1.totalDistanceMeters,
      ),
    },
    monthlyComparison,
  };
}
