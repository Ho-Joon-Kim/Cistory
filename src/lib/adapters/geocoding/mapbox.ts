/**
 * Mapbox Geocoding Adapter
 *
 * Uses Mapbox Geocoding v6 reverse endpoint for international locations.
 * Reuses NEXT_PUBLIC_MAPBOX_TOKEN or MAPBOX_ACCESS_TOKEN.
 */

import { logger } from "@/lib/logger";
import type { GeocodingAdapter, GeocodingResult } from "./interface";

const MAPBOX_API_BASE = "https://api.mapbox.com/search/geocode/v6";

/**
 * Geocoding v6 has no `poi` type (POIs moved to the Search Box API) and answers
 * an unknown type with 422, which used to make every reverse lookup fail.
 * With multiple types, reverse returns at most one feature per type ordered
 * most-specific first, so `features[0]` is the address when one exists and
 * otherwise degrades to street → neighborhood → locality → place. Region and
 * country stay available through each feature's `context`.
 */
export const MAPBOX_REVERSE_TYPES = "address,street,neighborhood,locality,place";

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
    const params = new URLSearchParams({
      longitude: String(lon),
      latitude: String(lat),
      types: MAPBOX_REVERSE_TYPES,
      access_token: this.accessToken,
    });

    // Never log this URL: it carries the access token.
    const res = await fetch(`${MAPBOX_API_BASE}/reverse?${params}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("[Mapbox] reverse geocode failed", {
        status: res.status,
        body: body.slice(0, 500),
      });
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
      provider: "mapbox",
      region: props.context?.region?.name ?? null,
      country: props.context?.country?.name ?? null,
    };
  }
}
