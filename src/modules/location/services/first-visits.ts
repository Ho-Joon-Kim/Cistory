/**
 * First-time Visits Service
 *
 * Tracks when a user first visits each city/country.
 * Supports both yearly and monthly queries.
 *
 * Ported from Dawarich:
 * - app/services/users/digests/first_time_visits_calculator.rb (yearly)
 * - app/services/users/digests/monthly_first_time_visits_calculator.rb (monthly)
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, visits } from "@/db";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FirstVisit {
  city: string;
  countryName: string;
  firstVisitDate: string; // YYYY-MM-DD
}

export interface FirstVisitsResult {
  cities: FirstVisit[];
  countries: { countryName: string; firstVisitDate: string }[];
}

// ── Yearly: first visits in a given year ─────────────────────────────────────

/**
 * Find cities and countries first visited during the specified year.
 * A city/country counts as "first-time" if MIN(start_time) falls within that year.
 */
export async function getFirstVisitsByYear(
  userId: string,
  year: string
): Promise<FirstVisitsResult> {
  const db = getDb();
  const y = Number(year);

  const yearStart = new Date(y, 0, 1);
  const yearEnd = new Date(y + 1, 0, 1);

  // All-time first visit per city
  const cityFirstVisits = await db
    .select({
      city: visits.city,
      countryName: visits.countryName,
      firstVisit: sql<Date>`min(${visits.startTime})`,
    })
    .from(visits)
    .where(and(eq(visits.userId, userId), isNotNull(visits.city), isNotNull(visits.countryName)))
    .groupBy(visits.city, visits.countryName);

  // Filter: first visit falls within the target year
  const newCities: FirstVisit[] = [];
  for (const row of cityFirstVisits) {
    const fv = new Date(row.firstVisit);
    if (fv >= yearStart && fv < yearEnd) {
      newCities.push({
        city: row.city!,
        countryName: row.countryName!,
        firstVisitDate: fv.toISOString().slice(0, 10),
      });
    }
  }
  newCities.sort((a, b) => a.firstVisitDate.localeCompare(b.firstVisitDate));

  // All-time first visit per country
  const countryFirstVisits = await db
    .select({
      countryName: visits.countryName,
      firstVisit: sql<Date>`min(${visits.startTime})`,
    })
    .from(visits)
    .where(and(eq(visits.userId, userId), isNotNull(visits.countryName)))
    .groupBy(visits.countryName);

  const newCountries: { countryName: string; firstVisitDate: string }[] = [];
  for (const row of countryFirstVisits) {
    const fv = new Date(row.firstVisit);
    if (fv >= yearStart && fv < yearEnd) {
      newCountries.push({
        countryName: row.countryName!,
        firstVisitDate: fv.toISOString().slice(0, 10),
      });
    }
  }
  newCountries.sort((a, b) => a.firstVisitDate.localeCompare(b.firstVisitDate));

  return { cities: newCities, countries: newCountries };
}

// ── Monthly: first visits in a given month ───────────────────────────────────

/**
 * Find cities and countries first visited during the specified month.
 * "First-time" means MIN(start_time) falls within that month.
 */
export async function getFirstVisitsByMonth(
  userId: string,
  yearMonth: string
): Promise<FirstVisitsResult> {
  const [y, m] = yearMonth.split("-").map(Number);

  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 1);

  const db = getDb();

  const cityFirstVisits = await db
    .select({
      city: visits.city,
      countryName: visits.countryName,
      firstVisit: sql<Date>`min(${visits.startTime})`,
    })
    .from(visits)
    .where(and(eq(visits.userId, userId), isNotNull(visits.city), isNotNull(visits.countryName)))
    .groupBy(visits.city, visits.countryName);

  const newCities: FirstVisit[] = [];
  for (const row of cityFirstVisits) {
    const fv = new Date(row.firstVisit);
    if (fv >= monthStart && fv < monthEnd) {
      newCities.push({
        city: row.city!,
        countryName: row.countryName!,
        firstVisitDate: fv.toISOString().slice(0, 10),
      });
    }
  }
  newCities.sort((a, b) => a.firstVisitDate.localeCompare(b.firstVisitDate));

  const countryFirstVisits = await db
    .select({
      countryName: visits.countryName,
      firstVisit: sql<Date>`min(${visits.startTime})`,
    })
    .from(visits)
    .where(and(eq(visits.userId, userId), isNotNull(visits.countryName)))
    .groupBy(visits.countryName);

  const newCountries: { countryName: string; firstVisitDate: string }[] = [];
  for (const row of countryFirstVisits) {
    const fv = new Date(row.firstVisit);
    if (fv >= monthStart && fv < monthEnd) {
      newCountries.push({
        countryName: row.countryName!,
        firstVisitDate: fv.toISOString().slice(0, 10),
      });
    }
  }
  newCountries.sort((a, b) => a.firstVisitDate.localeCompare(b.firstVisitDate));

  return { cities: newCities, countries: newCountries };
}
