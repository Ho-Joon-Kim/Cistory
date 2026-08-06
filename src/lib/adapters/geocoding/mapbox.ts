/**
 * Mapbox Geocoding Adapter
 *
 * Uses Mapbox Geocoding v6 reverse endpoint for international locations.
 * Reuses NEXT_PUBLIC_MAPBOX_TOKEN or MAPBOX_ACCESS_TOKEN.
 */

import type { GeocodingAdapter, GeocodingResult } from "./interface";

const MAPBOX_API_BASE = "https://api.mapbox.com/search/geocode/v6";

interface MapboxFeature {
  properties: {
    name?: string;
    name_preferred?: string;
    full_address?: string;
    place_formatted?: string;
    feature_type?: string;
    context?: {
      place?: { name: string };
      region?: { name: string };
      country?: { name: string };
    };
  };
}

export class MapboxGeocodingAdapter implements GeocodingAdapter {
  private accessToken: string;

  constructor() {
    const token = process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      throw new Error("MAPBOX_ACCESS_TOKEN 환경변수가 설정되지 않았습니다");
    }
    this.accessToken = token;
  }

  async reverseGeocode(lat: number, lon: number): Promise<GeocodingResult | null> {
    const url = `${MAPBOX_API_BASE}/reverse?longitude=${lon}&latitude=${lat}&types=poi,address&access_token=${this.accessToken}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.error("Mapbox reverse geocode error:", res.status);
      return null;
    }

    const data = await res.json();
    const feature: MapboxFeature | undefined = data.features?.[0];

    if (!feature) return null;

    const props = feature.properties;
    const placeName = props.name_preferred || props.name || props.full_address || "";
    const address =
      props.full_address ||
      props.place_formatted ||
      [props.context?.place?.name, props.context?.region?.name, props.context?.country?.name]
        .filter(Boolean)
        .join(", ");

    return {
      placeName,
      address,
      category: props.feature_type === "poi" ? "POI" : undefined,
      provider: "mapbox",
      // TODO(task-2/3): fill from the provider response.
      region: null,
      country: null,
    };
  }
}
