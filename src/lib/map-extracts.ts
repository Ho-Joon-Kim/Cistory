import { createHash } from "node:crypto";

/**
 * Valhalla 타일을 굽는 데 쓰는 OSM 추출본 목록.
 *
 * bbox는 [minLon, minLat, maxLon, maxLat] — Geofabrik/BBBike와 Valhalla가
 * 모두 쓰는 순서다. 국가 단위가 아니라 방문 도시권으로 자르는 이유는, 방문
 * 9건인 일본을 위해 1.9GB 국가 PBF를 받게 되기 때문이다. 한국만 전국인
 * 이유는 방문이 실제로 전국에 퍼져 있어서다. `taiwan`과 `vietnam`은 예외다 —
 * 두 지역 모두 도시 단위 추출본이 존재하지 않아 부득이 전국 PBF를 쓴다
 * (각 항목 주석 참고).
 *
 * 모든 URL은 2026-08-07에 curl로 200을 확인했고, 모든 bbox는 dev DB의 실제
 * 방문 좌표(country_name/city별 min·max lat/lon)에서 유도했다 — 지역 이름이
 * 그럴듯하게 들린다는 이유만으로 정한 값이 아니다.
 *
 * 새 도시를 다녀왔다면 여기 한 줄을 추가한다. 다음 타일 재빌드 때 반영되고,
 * 그때까지 그 지역 세그먼트는 `no_coverage`로 남는다 (조용히 사라지지 않는다).
 */
export interface MapExtract {
  /** 타일 빌드 로그와 fingerprint에 쓰이는 안정적인 식별자. */
  name: string;
  /** PBF 다운로드 URL. */
  url: string;
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}

export const MAP_EXTRACTS: MapExtract[] = [
  {
    name: "south-korea",
    url: "https://download.geofabrik.de/asia/south-korea-latest.osm.pbf",
    bbox: [124.5, 33.0, 132.0, 38.7],
  },
  {
    // BBBike never hosted a Hong Kong extract — its ~238-city catalog has no entry
    // for it, and the old URL 404s. Geofabrik does. bbox is ~0.1° padding around
    // the actual 137 visits (lat 22.2705–22.3254, lon 113.9306–114.1754, dev DB).
    name: "hong-kong",
    url: "https://download.geofabrik.de/asia/china/hong-kong-latest.osm.pbf",
    bbox: [113.83, 22.17, 114.28, 22.43],
  },
  {
    // Geofabrik has no Taipei-only extract, only nationwide Taiwan (~310MB). That's
    // a deliberate exception to the per-city rule above, not sloppiness: 310MB for
    // 20 visits is worse than the per-city ideal, but it's the only source that
    // actually exists, and it's still far better than downloading all of East Asia.
    // Since the PBF already covers the whole country, the bbox says so too — the
    // 20 visits (Taipei City, New Taipei City, Yilan County; dev DB) sit well
    // inside it, not at its edges.
    name: "taiwan",
    url: "https://download.geofabrik.de/asia/taiwan-latest.osm.pbf",
    bbox: [119.9, 21.8, 122.1, 25.4],
  },
  {
    // All 13 visits are in Da Nang, but Geofabrik's smallest Vietnam extract is the
    // whole country (~326MB) — there's no Da Nang-only source, so this was always
    // downloading nationwide tiles despite the old "vietnam-cities" name and its
    // Da-Nang-shaped bbox. Bbox now matches the coverage the URL actually provides,
    // so a future Hanoi visit lands inside tiles already built instead of coming
    // back `no_coverage`.
    name: "vietnam",
    url: "https://download.geofabrik.de/asia/vietnam-latest.osm.pbf",
    bbox: [102.1, 8.4, 109.5, 23.4],
  },
  {
    // BBBike's "Tokyo" extract is central Tokyo only — its real polygon is
    // [139.62,35.56]–[139.95,35.78] (confirmed via its .poly file), no Chiba at
    // all. The data has a Chiba visit at Narita Airport, lon 140.3870 — outside
    // both the old declared bbox and the old extract's real coverage. Geofabrik's
    // Kanto region extract genuinely spans Tokyo and Chiba; bbox is ~0.1° padding
    // around the actual 9 visits (lat 35.6459–35.7735, lon 139.6917–140.3870,
    // dev DB), not the region's administrative reach (Kanto also covers the
    // Izu/Ogasawara islands hundreds of km further south — irrelevant here).
    name: "tokyo-chiba",
    url: "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf",
    bbox: [139.59, 35.55, 140.49, 35.87],
  },
];

/**
 * `extracts`의 12자리 해시. 정렬 후 조인하므로 목록 순서와 무관하게 안정적이고,
 * `name`이나 `bbox` 중 하나라도 바뀌면 값이 바뀐다. `extractsFingerprint()`가
 * `MAP_EXTRACTS`에 적용하는 얇은 래퍼이고, 이 함수 자체는 임의의 목록에 대해
 * 순수하게 계산하므로 "다른 목록이면 다른 값" 성질을 목록 전체를 갈아엎지
 * 않고도 테스트할 수 있다.
 */
export function fingerprintOf(extracts: MapExtract[]): string {
  const canonical = extracts
    .map((e) => `${e.name}:${e.bbox.join(",")}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

/**
 * 추출본 목록의 12자리 해시. `segment_route_matches.tile_version`의 절반을
 * 이룬다 (나머지 절반은 빌드 날짜). 목록이 바뀌면 값이 바뀌므로, 추출본을
 * 넓힌 뒤 "옛 fingerprint로 매칭된 no_coverage 행"만 골라 다시 돌릴 수 있다.
 */
export function extractsFingerprint(): string {
  return fingerprintOf(MAP_EXTRACTS);
}
