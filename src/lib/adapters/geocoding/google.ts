/**
 * Google Places API (New) Geocoding Adapter
 *
 * Uses Nearby Search to find the closest POI given coordinates.
 * Falls back to Reverse Geocoding for address when no POI found.
 * Requires GOOGLE_MAPS_API_KEY environment variable.
 */

import type { GeocodingAdapter, GeocodingResult } from "./interface";

const PLACES_API_BASE = "https://places.googleapis.com/v1/places:searchNearby";
const GEOCODING_API_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

/** POI 검색 반경 (미터) */
const POI_SEARCH_RADIUS = 150;

interface GooglePlace {
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  primaryTypeDisplayName?: { text: string };
}

interface GoogleGeocodingResult {
  formatted_address: string;
}

export class GooglePlacesAdapter implements GeocodingAdapter {
  private apiKey: string;

  constructor() {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      throw new Error("GOOGLE_MAPS_API_KEY 환경변수가 설정되지 않았습니다");
    }
    this.apiKey = key;
  }

  async reverseGeocode(lat: number, lon: number): Promise<GeocodingResult | null> {
    // 1. Nearby Search로 가장 가까운 POI 검색
    const [poi, address] = await Promise.all([
      this.searchNearbyPoi(lat, lon),
      this.getAddress(lat, lon),
    ]);

    if (poi) {
      return {
        placeName: poi.displayName?.text || address || "",
        address: poi.formattedAddress || address || "",
        category: poi.primaryTypeDisplayName?.text || undefined,
        provider: "google",
      };
    }

    // POI가 없으면 주소만 반환
    if (address) {
      return {
        placeName: address,
        address,
        provider: "google",
      };
    }

    return null;
  }

  private async searchNearbyPoi(lat: number, lon: number): Promise<GooglePlace | null> {
    try {
      const res = await fetch(PLACES_API_BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.primaryTypeDisplayName",
        },
        body: JSON.stringify({
          maxResultCount: 1,
          rankPreference: "DISTANCE",
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lon },
              radius: POI_SEARCH_RADIUS,
            },
          },
        }),
      });

      if (!res.ok) {
        console.error("Google Nearby Search error:", res.status);
        return null;
      }

      const data = await res.json();
      return (data.places?.[0] as GooglePlace) ?? null;
    } catch (e) {
      console.error("Google Nearby Search error:", e);
      return null;
    }
  }

  private async getAddress(lat: number, lon: number): Promise<string | null> {
    try {
      const url = `${GEOCODING_API_BASE}?latlng=${lat},${lon}&key=${this.apiKey}&result_type=street_address|premise&language=en`;
      const res = await fetch(url);

      if (!res.ok) return null;

      const data = await res.json();
      const result: GoogleGeocodingResult | undefined = data.results?.[0];
      return result?.formatted_address ?? null;
    } catch {
      return null;
    }
  }
}
