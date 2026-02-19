/**
 * Address Search API (Forward Geocoding)
 *
 * GET /api/saved-places/search?q=검색어
 *
 * Kakao (KAKAO_REST_API_KEY) → 한국 키워드 검색
 * Mapbox (NEXT_PUBLIC_MAPBOX_TOKEN) → 국제 검색
 * 둘 다 없으면 503
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers";

interface SearchResult {
  name: string;
  address: string;
  lat: number;
  lon: number;
  category?: string;
}

async function searchKakao(query: string): Promise<SearchResult[]> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return [];

  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=5`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
  if (!res.ok) return [];

  const data = await res.json();
  return (data.documents ?? []).map(
    (d: {
      place_name: string;
      address_name: string;
      road_address_name?: string;
      y: string;
      x: string;
      category_group_name?: string;
    }) => ({
      name: d.place_name,
      address: d.road_address_name || d.address_name,
      lat: parseFloat(d.y),
      lon: parseFloat(d.x),
      category: d.category_group_name || undefined,
    }),
  );
}

async function searchMapbox(query: string): Promise<SearchResult[]> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return [];

  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&limit=5&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  return (data.features ?? []).map(
    (f: {
      properties: { name?: string; full_address?: string; place_formatted?: string };
      geometry: { coordinates: [number, number] };
    }) => ({
      name: f.properties.name || f.properties.full_address || "",
      address: f.properties.full_address || f.properties.place_formatted || "",
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
    }),
  );
}

export async function GET(request: NextRequest) {
  try {
    const { error: authError } = await getAuthenticatedUser(request);
    if (authError) return authError;

    const query = request.nextUrl.searchParams.get("q")?.trim();
    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // Kakao 우선, 결과 없으면 Mapbox fallback
    let results = await searchKakao(query);
    if (results.length === 0) {
      results = await searchMapbox(query);
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Address search error:", error);
    return NextResponse.json(
      { error: "주소 검색에 실패했습니다" },
      { status: 500 },
    );
  }
}
