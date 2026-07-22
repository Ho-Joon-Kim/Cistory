/**
 * Overseas Travel Detection
 *
 * 좌표 기반 해외여행 감지 및 그룹핑
 */

import { isInKorea } from "@/lib/adapters/geocoding";

// 주요 국가 bounding box
const COUNTRY_BOUNDS: Record<
  string,
  { minLat: number; maxLat: number; minLon: number; maxLon: number }
> = {
  일본: { minLat: 24.0, maxLat: 46.0, minLon: 122.0, maxLon: 154.0 },
  태국: { minLat: 5.5, maxLat: 20.5, minLon: 97.3, maxLon: 105.7 },
  베트남: { minLat: 8.2, maxLat: 23.4, minLon: 102.1, maxLon: 109.5 },
  대만: { minLat: 21.9, maxLat: 25.3, minLon: 120.0, maxLon: 122.0 },
  필리핀: { minLat: 4.5, maxLat: 21.0, minLon: 116.9, maxLon: 127.0 },
  싱가포르: { minLat: 1.15, maxLat: 1.47, minLon: 103.6, maxLon: 104.1 },
  말레이시아: { minLat: 0.8, maxLat: 7.4, minLon: 99.6, maxLon: 119.3 },
  인도네시아: { minLat: -11.0, maxLat: 6.1, minLon: 95.0, maxLon: 141.0 },
  미국: { minLat: 24.5, maxLat: 49.4, minLon: -124.8, maxLon: -66.9 },
  하와이: { minLat: 18.9, maxLat: 22.3, minLon: -160.3, maxLon: -154.8 },
  캐나다: { minLat: 41.7, maxLat: 83.1, minLon: -141.0, maxLon: -52.6 },
  영국: { minLat: 49.9, maxLat: 60.9, minLon: -8.6, maxLon: 1.8 },
  프랑스: { minLat: 41.3, maxLat: 51.1, minLon: -5.1, maxLon: 9.6 },
  독일: { minLat: 47.3, maxLat: 55.1, minLon: 5.9, maxLon: 15.0 },
  이탈리아: { minLat: 36.6, maxLat: 47.1, minLon: 6.6, maxLon: 18.5 },
  스페인: { minLat: 36.0, maxLat: 43.8, minLon: -9.3, maxLon: 3.3 },
  호주: { minLat: -43.6, maxLat: -10.7, minLon: 113.2, maxLon: 153.6 },
  // Keep specific regions before broader overlapping country bounds.
  홍콩: { minLat: 22.15, maxLat: 22.56, minLon: 113.83, maxLon: 114.41 },
  중국: { minLat: 18.2, maxLat: 53.6, minLon: 73.5, maxLon: 135.1 },
  터키: { minLat: 35.8, maxLat: 42.1, minLon: 26.0, maxLon: 44.8 },
  스위스: { minLat: 45.8, maxLat: 47.8, minLon: 5.9, maxLon: 10.5 },
};

/**
 * 좌표로 국가 추정 (bounding box 기반)
 * 한국이면 null 반환
 */
export function detectCountry(lat: number, lon: number): string | null {
  if (isInKorea(lat, lon)) return null;

  for (const [country, bounds] of Object.entries(COUNTRY_BOUNDS)) {
    if (
      lat >= bounds.minLat &&
      lat <= bounds.maxLat &&
      lon >= bounds.minLon &&
      lon <= bounds.maxLon
    ) {
      return country;
    }
  }

  return "기타";
}

export interface OverseasTrip {
  country: string;
  startDate: string;
  endDate: string;
  places: string[];
}

interface LocationWithDate {
  lat: number;
  lon: number;
  date: string; // YYYY-MM-DD
  placeName?: string | null;
}

/**
 * 위치 데이터에서 해외여행 그룹핑
 *
 * 연속된 날짜에서 해외 좌표가 감지되면 하나의 "해외여행"으로 그룹핑.
 * 같은 국가의 연속된 날을 하나의 여행으로 묶음.
 */
export function detectOverseasTrips(locations: LocationWithDate[]): OverseasTrip[] {
  if (locations.length === 0) return [];

  // 날짜별 해외 국가 매핑
  const dateCountryMap = new Map<string, { country: string; places: Set<string> }>();

  for (const loc of locations) {
    const country = detectCountry(loc.lat, loc.lon);
    if (!country) continue; // 국내

    const existing = dateCountryMap.get(loc.date);
    if (existing) {
      if (loc.placeName) existing.places.add(loc.placeName);
    } else {
      const places = new Set<string>();
      if (loc.placeName) places.add(loc.placeName);
      dateCountryMap.set(loc.date, { country, places });
    }
  }

  if (dateCountryMap.size === 0) return [];

  // 날짜순 정렬
  const sortedDates = [...dateCountryMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  // 연속 날짜 그룹핑
  const trips: OverseasTrip[] = [];
  let currentTrip: OverseasTrip | null = null;

  for (const [date, { country, places }] of sortedDates) {
    if (
      currentTrip &&
      currentTrip.country === country &&
      isConsecutiveDate(currentTrip.endDate, date)
    ) {
      currentTrip.endDate = date;
      for (const place of places) {
        if (!currentTrip.places.includes(place)) {
          currentTrip.places.push(place);
        }
      }
    } else {
      if (currentTrip) trips.push(currentTrip);
      currentTrip = {
        country,
        startDate: date,
        endDate: date,
        places: [...places],
      };
    }
  }

  if (currentTrip) trips.push(currentTrip);

  return trips;
}

/**
 * 두 날짜가 연속(1일 이내 차이)인지 확인
 * 2일 갭까지는 같은 여행으로 취급 (이동일 고려)
 */
function isConsecutiveDate(date1: string, date2: string): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffDays = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= 2;
}

/**
 * 좌표가 해외인지 간단 판별
 */
export function isOverseas(lat: number, lon: number): boolean {
  return !isInKorea(lat, lon);
}
