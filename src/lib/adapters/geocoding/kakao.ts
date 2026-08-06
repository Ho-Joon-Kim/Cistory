/**
 * Kakao Local API Geocoding Adapter
 *
 * Uses Kakao coord2address + category search for Korean locations.
 * Requires KAKAO_REST_API_KEY environment variable.
 */

import type { GeocodingAdapter, GeocodingResult } from "./interface";

const KAKAO_API_BASE = "https://dapi.kakao.com/v2/local";

/** 카테고리 검색 반경 (미터) */
const POI_SEARCH_RADIUS = 150;

/**
 * 검색할 카테고리 그룹 코드 목록
 * @see https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-category
 */
const CATEGORY_CODES = [
  "CE7", // 카페
  "FD6", // 음식점
  "SW8", // 지하철역
  "CT1", // 문화시설
  "AT4", // 관광명소
  "SC4", // 학교
];

interface KakaoAddressDoc {
  address?: { address_name: string };
  road_address?: { address_name: string; building_name?: string };
}

interface KakaoCategoryDoc {
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
      addressDoc?.road_address?.address_name ?? addressDoc?.address?.address_name ?? "";

    // 2. 카테고리 검색으로 반경 내 가장 가까운 POI 탐색
    const poiResults = await Promise.all(
      CATEGORY_CODES.map(async (code) => {
        try {
          const url = `${KAKAO_API_BASE}/search/category.json?category_group_code=${code}&x=${lon}&y=${lat}&radius=${POI_SEARCH_RADIUS}&sort=distance&size=1`;
          const res = await fetch(url, { headers });
          if (!res.ok) return null;
          const data = await res.json();
          return (data.documents?.[0] as KakaoCategoryDoc) ?? null;
        } catch {
          return null;
        }
      })
    );

    const closestPoi = poiResults
      .filter((p): p is KakaoCategoryDoc => p !== null)
      .sort((a, b) => Number(a.distance) - Number(b.distance))[0];

    if (closestPoi) {
      return {
        placeName: closestPoi.place_name,
        address: address || closestPoi.address_name,
        category: closestPoi.category_group_name || undefined,
        provider: "kakao",
        // TODO(task-2/3): fill from the provider response.
        region: null,
        country: null,
      };
    }

    // POI가 없으면 주소만 반환
    if (address) {
      const buildingName = addressDoc?.road_address?.building_name;
      return {
        placeName: buildingName || address,
        address,
        provider: "kakao",
        // TODO(task-2/3): fill from the provider response.
        region: null,
        country: null,
      };
    }

    return null;
  }
}
