/**
 * Geocoding Adapter Interface
 *
 * Abstraction layer for reverse geocoding services.
 * Currently supports Kakao (Korea) and Mapbox (international).
 */

export interface GeocodingResult {
  /** 장소명 (e.g. "스타벅스 강남R점" or "123 Main St") */
  placeName: string;
  /** 주소 (e.g. "서울 강남구 역삼동" or "San Francisco, CA") */
  address: string;
  /** 카테고리 (e.g. "카페", "음식점") */
  category?: string;
  /** 제공자 */
  provider: "kakao" | "mapbox" | "google";
  /**
   * 시/도 또는 administrative_area_level_1. `visits.city` 컬럼으로 매핑된다.
   * 컬럼명이 "city"지만 실제로 담기는 값은 시/도 단위다.
   * 응답에 없으면 null — 주소 문자열에서 추측하지 않는다.
   */
  region: string | null;
  /** 국가명. `visits.countryName`으로 매핑된다. 응답에 없으면 null. */
  country: string | null;
}

export interface GeocodingAdapter {
  /**
   * 좌표를 주소/장소명으로 변환
   */
  reverseGeocode(lat: number, lon: number): Promise<GeocodingResult | null>;
}
