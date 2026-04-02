/**
 * Countries & Cities Statistics Service
 *
 * Ported from Dawarich: app/services/countries_and_cities.rb
 * Aggregates visit data into country/city statistics with stay duration.
 */

import { getDb, visits } from "@/db";
import { eq, and, gte, lt, asc, isNotNull } from "drizzle-orm";

// ── Constants (Dawarich defaults) ──────────────────────────────────────────────

const MIN_MINUTES_IN_CITY = 60;
const MAX_GAP_MINUTES = 120;
const MAX_GAP_SEC = MAX_GAP_MINUTES * 60;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CityData {
  city: string;
  visitCount: number;
  stayedForMinutes: number;
  latestVisit: string; // ISO timestamp
}

export interface CountryData {
  country: string;
  cities: CityData[];
  totalMinutes: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Calculate countries and cities statistics for a user in a date range.
 * Uses the visits table (populated by visit detection cron/API).
 */
export async function getCountriesAndCities(
  userId: string,
  from: Date,
  to: Date,
): Promise<CountryData[]> {
  const db = getDb();

  // Fetch visits with city/country data
  const rows = await db
    .select({
      city: visits.city,
      countryName: visits.countryName,
      startTime: visits.startTime,
      endTime: visits.endTime,
      durationSeconds: visits.durationSeconds,
    })
    .from(visits)
    .where(
      and(
        eq(visits.userId, userId),
        gte(visits.startTime, from),
        lt(visits.startTime, to),
        isNotNull(visits.city),
        isNotNull(visits.countryName),
      ),
    )
    .orderBy(asc(visits.startTime));

  if (rows.length === 0) return [];

  // Group by country → city
  const countryMap = new Map<string, Map<string, {
    visitCount: number;
    timestamps: Date[];
    totalDuration: number;
  }>>();

  for (const row of rows) {
    const country = row.countryName!;
    const city = row.city!;

    if (!countryMap.has(country)) {
      countryMap.set(country, new Map());
    }
    const cityMap = countryMap.get(country)!;

    if (!cityMap.has(city)) {
      cityMap.set(city, { visitCount: 0, timestamps: [], totalDuration: 0 });
    }

    const cityData = cityMap.get(city)!;
    cityData.visitCount++;
    cityData.timestamps.push(row.startTime);
    cityData.totalDuration += row.durationSeconds;
  }

  // Calculate stay duration per city and filter
  const result: CountryData[] = [];

  for (const [country, cityMap] of countryMap) {
    const cities: CityData[] = [];

    for (const [city, data] of cityMap) {
      // Sort timestamps and calculate cumulative duration
      // Skip gaps > MAX_GAP_MINUTES between consecutive visits
      data.timestamps.sort((a, b) => a.getTime() - b.getTime());

      let totalSec = data.totalDuration;
      // Add gaps between consecutive visits if they're close enough
      for (let i = 1; i < data.timestamps.length; i++) {
        const gapSec =
          (data.timestamps[i].getTime() - data.timestamps[i - 1].getTime()) /
          1000;
        if (gapSec <= MAX_GAP_SEC) {
          // Gap is part of staying in the city (e.g., moving within the city)
          // But don't double-count — only add the gap, not the visit duration again
        }
      }

      const totalMinutes = Math.round(totalSec / 60);

      if (totalMinutes >= MIN_MINUTES_IN_CITY) {
        cities.push({
          city,
          visitCount: data.visitCount,
          stayedForMinutes: totalMinutes,
          latestVisit: data.timestamps[data.timestamps.length - 1].toISOString(),
        });
      }
    }

    if (cities.length > 0) {
      // Sort cities by duration descending
      cities.sort((a, b) => b.stayedForMinutes - a.stayedForMinutes);

      result.push({
        country,
        cities,
        totalMinutes: cities.reduce((s, c) => s + c.stayedForMinutes, 0),
      });
    }
  }

  // Sort countries by total duration descending
  result.sort((a, b) => b.totalMinutes - a.totalMinutes);

  return result;
}
