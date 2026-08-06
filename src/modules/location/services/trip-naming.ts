import { isInKorea } from "@/lib/adapters/geocoding";
import { detectCountry } from "@/modules/report/travel";

export interface TripNamingVisit {
  centerLat: number;
  centerLon: number;
  city: string | null;
  countryName: string | null;
}

/**
 * Kakao's region_1depth_name is not uniformly short-form — it returns "서울" but
 * also "제주특별자치도". Strip the administrative suffix instead of maintaining a
 * lookup table, so region names the table never knew about still normalise.
 * Order matters: the longer suffixes must be tried before the bare "도", or
 * "제주특별자치도" loses only its final character.
 */
const REGION_SUFFIXES = ["특별자치시", "특별자치도", "특별시", "광역시", "도"];

/**
 * Builds a short trip name exclusively from trusted coordinate classification
 * and allow-listed Korean administrative regions. Raw country text is ignored.
 */
export function createTripName(visits: TripNamingVisit[]): string {
  const coordinateCountries = unique(
    visits.map((visit) => {
      const country = detectCountry(visit.centerLat, visit.centerLon);
      return country === "기타" ? null : country;
    })
  );
  if (coordinateCountries.length > 0) {
    return `${coordinateCountries.join(" · ")} 여행`;
  }

  if (visits.some((visit) => !isInKorea(visit.centerLat, visit.centerLon))) {
    return "해외 여행";
  }

  const domesticRegions = visits
    .filter((visit) => isInKorea(visit.centerLat, visit.centerLon))
    .map((visit) => normalizeDomesticRegion(visit.city))
    .filter((region): region is string => region !== null);
  const primaryRegion = mostFrequent(domesticRegions);

  return primaryRegion ? `${primaryRegion} 여행` : "국내 여행";
}

function normalizeDomesticRegion(city: string | null): string | null {
  if (!city) return null;
  let value = city.trim().replace(/,$/, "");
  for (const suffix of REGION_SUFFIXES) {
    if (value.length > suffix.length && value.endsWith(suffix)) {
      value = value.slice(0, -suffix.length);
      break;
    }
  }
  // Reject invalid region names that contain ASCII digits (postal codes, street addresses)
  if (value.length === 0 || /\d/.test(value)) {
    return null;
  }
  return value;
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

function mostFrequent(values: string[]): string | null {
  let best: string | null = null;
  let bestCount = 0;
  const counts = new Map<string, number>();

  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }

  return best;
}
