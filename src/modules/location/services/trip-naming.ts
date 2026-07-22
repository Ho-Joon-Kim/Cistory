import { isInKorea } from "@/lib/adapters/geocoding";
import { detectCountry } from "@/modules/report/travel";

export interface TripNamingVisit {
  centerLat: number;
  centerLon: number;
  city: string | null;
  countryName: string | null;
}

const DOMESTIC_REGION_ALIASES = new Map<string, string>([
  ["서울", "서울"],
  ["서울특별시", "서울"],
  ["부산", "부산"],
  ["부산광역시", "부산"],
  ["대구", "대구"],
  ["대구광역시", "대구"],
  ["인천", "인천"],
  ["인천광역시", "인천"],
  ["광주", "광주"],
  ["광주광역시", "광주"],
  ["대전", "대전"],
  ["대전광역시", "대전"],
  ["울산", "울산"],
  ["울산광역시", "울산"],
  ["세종", "세종"],
  ["세종특별자치시", "세종"],
  ["경기", "경기"],
  ["경기도", "경기"],
  ["강원", "강원"],
  ["강원도", "강원"],
  ["강원특별자치도", "강원"],
  ["충북", "충북"],
  ["충청북도", "충북"],
  ["충남", "충남"],
  ["충청남도", "충남"],
  ["전북", "전북"],
  ["전라북도", "전북"],
  ["전북특별자치도", "전북"],
  ["전남", "전남"],
  ["전라남도", "전남"],
  ["경북", "경북"],
  ["경상북도", "경북"],
  ["경남", "경남"],
  ["경상남도", "경남"],
  ["제주", "제주"],
  ["제주도", "제주"],
  ["제주특별자치도", "제주"],
]);

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
  return DOMESTIC_REGION_ALIASES.get(city.trim()) ?? null;
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
