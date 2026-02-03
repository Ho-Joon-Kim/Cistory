/**
 * Kakao Local API Geocoding Adapter
 *
 * Uses Kakao coord2address + keyword search for Korean locations.
 * Requires KAKAO_REST_API_KEY environment variable.
 */

import type { GeocodingAdapter, GeocodingResult } from "./interface";

const KAKAO_API_BASE = "https://dapi.kakao.com/v2/local";

interface KakaoAddressDoc {
  address?: { address_name: string };
  road_address?: { address_name: string; building_name?: string };
}

interface KakaoKeywordDoc {
  place_name: string;
  address_name: string;
  category_group_name: string;
  distance: string;
}

export class KakaoGeocodingAdapter implements GeocodingAdapter {
  private apiKey: string;

  constructor() {
    const key = process.env.KAKAO_REST_API_KEY;
    if (!key) {
      throw new Error("KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다");
    }
    this.apiKey = key;
  }

  async reverseGeocode(lat: number, lon: number): Promise<GeocodingResult | null> {
    const headers = { Authorization: `KakaoAK ${this.apiKey}` };

    // 1. coord2address로 주소 확인
    const addressUrl = `${KAKAO_API_BASE}/geo/coord2address.json?x=${lon}&y=${lat}`;
    const addressRes = await fetch(addressUrl, { headers });

    if (!addressRes.ok) {
      console.error("Kakao coord2address error:", addressRes.status);
      return null;
    }

    const addressData = await addressRes.json();
    const addressDoc: KakaoAddressDoc | undefined = addressData.documents?.[0];
    const address =
      addressDoc?.road_address?.address_name ??
      addressDoc?.address?.address_name ??
      "";

    // 2. keyword search로 반경 50m 이내 POI 검색
    const keywordUrl = `${KAKAO_API_BASE}/search/keyword.json?query=*&x=${lon}&y=${lat}&radius=50&sort=distance&size=1`;
    const keywordRes = await fetch(keywordUrl, { headers });

    if (keywordRes.ok) {
      const keywordData = await keywordRes.json();
      const poi: KakaoKeywordDoc | undefined = keywordData.documents?.[0];

      if (poi) {
        return {
          placeName: poi.place_name,
          address: address || poi.address_name,
          category: poi.category_group_name || undefined,
          provider: "kakao",
        };
      }
    }

    // POI가 없으면 주소만 반환
    if (address) {
      const buildingName = addressDoc?.road_address?.building_name;
      return {
        placeName: buildingName || address,
        address,
        provider: "kakao",
      };
    }

    return null;
  }
}
