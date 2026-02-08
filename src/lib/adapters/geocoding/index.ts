/**
 * Geocoding Adapter Factory
 *
 * 국내/국외 판별 후 적절한 geocoding adapter 반환.
 * 한국: Kakao Local API, 해외: Google Places API, fallback: Mapbox
 */

import type { GeocodingAdapter } from "./interface";
import { GooglePlacesAdapter } from "./google";
import { KakaoGeocodingAdapter } from "./kakao";
import { MapboxGeocodingAdapter } from "./mapbox";

export type { GeocodingResult, GeocodingAdapter } from "./interface";
export { GooglePlacesAdapter, KakaoGeocodingAdapter, MapboxGeocodingAdapter };

// 한국 bounding box (대략적)
const KOREA_BOUNDS = {
  minLat: 33.0,
  maxLat: 38.7,
  minLon: 124.5,
  maxLon: 132.0,
};

/**
 * 좌표가 한국 내에 있는지 판별
 */
export function isInKorea(lat: number, lon: number): boolean {
  return (
    lat >= KOREA_BOUNDS.minLat &&
    lat <= KOREA_BOUNDS.maxLat &&
    lon >= KOREA_BOUNDS.minLon &&
    lon <= KOREA_BOUNDS.maxLon
  );
}

/**
 * 좌표에 맞는 geocoding adapter 반환.
 * 한국: Kakao, 해외: Google Places, fallback: Mapbox
 */
export function getGeocodingAdapter(lat: number, lon: number): GeocodingAdapter {
  const inKorea = isInKorea(lat, lon);
  const hasKakaoKey = !!process.env.KAKAO_REST_API_KEY;
  const hasGoogleKey = !!process.env.GOOGLE_MAPS_API_KEY;

  if (inKorea && hasKakaoKey) {
    return new KakaoGeocodingAdapter();
  }

  if (hasGoogleKey) {
    return new GooglePlacesAdapter();
  }

  return new MapboxGeocodingAdapter();
}
