/**
 * Residency Tracking Service
 *
 * Calculates days spent in each country per year using location points.
 * Ported from Dawarich: app/services/residency/day_counter.rb
 *
 * Uses locationPoints.countryName (enriched during backfill) as primary source.
 * Groups consecutive days into periods and warns at 183-day tax threshold.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";

// ── Constants (Dawarich: THRESHOLD_DAYS = 183) ───────────────────────────────

const TAX_THRESHOLD_DAYS = 183;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ResidencyPeriod {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  days: number;
}

export interface ResidencyData {
  countryName: string;
  days: number;
  percentage: number; // days / total days in year
  periods: ResidencyPeriod[];
  taxWarning: boolean;
}

export interface ResidencyResult {
  residency: ResidencyData[];
  totalTrackedDays: number;
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Calculate residency data for a user in a given year.
 *
 * Algorithm (Dawarich: day_counter.rb L115-142):
 * 1. SQL query: group location points by date and country_name
 * 2. For multi-country days: pick country with most points
 * 3. Group consecutive days per country into periods
 * 4. Flag countries with >= 183 days
 */
export async function calculateResidency(userId: string, year: string): Promise<ResidencyResult> {
  const db = getDb();
  const y = Number(year);
  const yearStart = new Date(y, 0, 1);
  const yearEnd = new Date(y + 1, 0, 1);

  // Dawarich SQL pattern: daily country aggregation from location_points
  const dailyRows = await db.execute<{
    point_date: string;
    country_name: string;
    point_count: number;
  }>(sql`
    SELECT
      to_char(timestamp AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS point_date,
      country_name,
      count(*)::int AS point_count
    FROM location_points
    WHERE user_id = ${userId}
      AND timestamp >= ${yearStart}
      AND timestamp < ${yearEnd}
      AND country_name IS NOT NULL
      AND country_name != ''
      AND (anomaly IS NOT TRUE)
    GROUP BY point_date, country_name
    ORDER BY point_date
  `);

  if (dailyRows.rows.length === 0) {
    return { residency: [], totalTrackedDays: 0 };
  }

  // For multi-country days, pick country with most points
  const dayCountryMap = new Map<string, string>();
  const dayMaxCount = new Map<string, number>();

  for (const row of dailyRows.rows) {
    const existing = dayMaxCount.get(row.point_date) ?? 0;
    if (row.point_count > existing) {
      dayCountryMap.set(row.point_date, row.country_name);
      dayMaxCount.set(row.point_date, row.point_count);
    }
  }

  const totalTrackedDays = dayCountryMap.size;

  // Group by country → sorted dates
  const countryDates = new Map<string, string[]>();
  const sortedDates = [...dayCountryMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  for (const [date, country] of sortedDates) {
    if (!countryDates.has(country)) {
      countryDates.set(country, []);
    }
    countryDates.get(country)!.push(date);
  }

  // Build residency data with consecutive periods
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInYear = isLeap ? 366 : 365;

  const residency: ResidencyData[] = [];

  for (const [country, dates] of countryDates) {
    const periods = buildPeriods(dates);
    const days = dates.length;

    residency.push({
      countryName: country,
      days,
      percentage: Math.round((days / daysInYear) * 1000) / 10,
      periods,
      taxWarning: days >= TAX_THRESHOLD_DAYS,
    });
  }

  // Sort by days descending
  residency.sort((a, b) => b.days - a.days);

  return { residency, totalTrackedDays };
}

/**
 * Group sorted date strings into consecutive periods.
 * Dawarich: day_counter.rb L54-72
 */
function buildPeriods(sortedDates: string[]): ResidencyPeriod[] {
  if (sortedDates.length === 0) return [];

  const periods: ResidencyPeriod[] = [];
  let periodStart = sortedDates[0];
  let prevDate = sortedDates[0];

  for (let i = 1; i < sortedDates.length; i++) {
    const current = sortedDates[i];

    // Check if consecutive (1-day difference)
    const prev = parseLocalDate(prevDate);
    const curr = parseLocalDate(current);
    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays > 1) {
      // End current period, start new one
      periods.push({
        startDate: periodStart,
        endDate: prevDate,
        days: countDays(periodStart, prevDate),
      });
      periodStart = current;
    }

    prevDate = current;
  }

  // Close final period
  periods.push({
    startDate: periodStart,
    endDate: prevDate,
    days: countDays(periodStart, prevDate),
  });

  return periods;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function countDays(from: string, to: string): number {
  const f = parseLocalDate(from);
  const t = parseLocalDate(to);
  return Math.round((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
