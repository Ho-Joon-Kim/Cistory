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
  provider: "kakao" | "mapbox";
}

export interface GeocodingAdapter {
  /**
   * 좌표를 주소/장소명으로 변환
   */
  reverseGeocode(lat: number, lon: number): Promise<GeocodingResult | null>;
}
