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
 * **bbox는 "이 URL이 내려받는 PBF가 실제로 덮는 지리적 범위"를 뜻한다 —
 * "우리가 가본 곳"이 아니다.** `src/lib/adapters/map-matching/valhalla.ts`가
 * Valhalla의 error_code 444("스냅할 도로 없음")를 no_coverage(추출본을
 * 넓혀야 함)와 failed(추출본은 이미 덮는데 도로 근처가 아님 — 공원, 호수 등)
 * 로 가르는 데 이 bbox를 쓰기 때문이다. 방문 좌표만 감싸는 좁은 bbox를 쓰면,
 * 타일은 실제로 덮고 있지만 방문한 적은 없는 지점(예: 요코하마 — 간토 타일
 * 안이지만 방문 9건 주변 패딩 밖)의 매칭 실패를 "추출본을 넓혀야 한다"고
 * 잘못 보고해 운영자에게 헛수고를 시킨다. 그래서 아래 모든 bbox는 각 URL의
 * `.poly` 경계 파일에서 정점들의 min/max로 직접 계산한, 그 PBF의 진짜 범위다
 * (2026-08-07 재확인 — 이전에는 방문 좌표를 감싸는 패딩값이었다).
 *
 * 새 도시를 다녀왔다면, 그 좌표가 이미 어느 bbox 안에 있는지부터 확인한다 —
 * 위 이유로 이제 bbox가 타일의 실제 범위이므로, 방문지가 국내선 취항 도시처럼
 * 이미 덮인 지역 안이면 할 일이 없다. 정말 모든 bbox 밖일 때만 새 추출본을
 * 추가한다. 다음 타일 재빌드 때 반영되고, 그때까지 그 지역 세그먼트는
 * `no_coverage`로 남는다 (조용히 사라지지 않는다).
 */
export interface MapExtract {
  /** 타일 빌드 로그와 fingerprint에 쓰이는 안정적인 식별자. */
  name: string;
  /** PBF 다운로드 URL. */
  url: string;
  /**
   * [minLon, minLat, maxLon, maxLat]. 이 URL이 내려받는 PBF의 실제 지리적
   * 범위(`.poly` 경계의 min/max) — 방문 좌표를 감싸는 패딩이 아니다.
   */
  bbox: [number, number, number, number];
}

export const MAP_EXTRACTS: MapExtract[] = [
  {
    name: "south-korea",
    url: "https://download.geofabrik.de/asia/south-korea-latest.osm.pbf",
    // .poly 경계 실측(2026-08-07): 옛 [124.5, 33.0, 132.0, 38.7]은 방문
    // 2040건은 넉넉히 감쌌지만, 같은 PBF가 실제로 담고 있는 울릉도/독도 동쪽과
    // 제주 남쪽 먼바다 도서 일부는 밖이었다.
    bbox: [124.3188, 32.3608, 132.3386, 38.6497],
  },
  {
    // BBBike never hosted a Hong Kong extract — its ~238-city catalog has no entry
    // for it, and the old URL 404s. Geofabrik does.
    name: "hong-kong",
    url: "https://download.geofabrik.de/asia/china/hong-kong-latest.osm.pbf",
    // .poly 경계 실측(2026-08-07): 옛 [113.83, 22.17, 114.28, 22.43]는 방문
    // 137건 주변 0.1° 패딩이었을 뿐, 같은 PBF가 실제로 담고 있는 동쪽 외곽
    // 도서(예: 東平洲 방향)는 밖이었다.
    bbox: [113.813, 22.1304, 114.506, 22.569],
  },
  {
    // Geofabrik has no Taipei-only extract, only nationwide Taiwan (~310MB). That's
    // a deliberate exception to the per-city rule above, not sloppiness: 310MB for
    // 20 visits is worse than the per-city ideal, but it's the only source that
    // actually exists, and it's still far better than downloading all of East Asia.
    name: "taiwan",
    url: "https://download.geofabrik.de/asia/taiwan-latest.osm.pbf",
    // .poly 경계 실측(2026-08-07): 옛 [119.9, 21.8, 122.1, 25.4]는 "전국 커버"
    // 라고 주석에 써놓고도 실제로는 본섬 주변만 감쌌다 — 같은 PBF가 실제로
    // 담고 있는 금문/펑후 등 외곽 도서는 밖이었다.
    bbox: [118.1036, 20.728, 122.9312, 26.603],
  },
  {
    // All 13 visits are in Da Nang, but Geofabrik's smallest Vietnam extract is the
    // whole country (~326MB) — there's no Da Nang-only source, so this was always
    // downloading nationwide tiles despite the old "vietnam-cities" name and its
    // Da-Nang-shaped bbox.
    name: "vietnam",
    url: "https://download.geofabrik.de/asia/vietnam-latest.osm.pbf",
    // .poly 경계 실측(2026-08-07): 옛 [102.1, 8.4, 109.5, 23.4]도 "전국 커버"
    // 주석과 달리 본토 주변만 감쌌다 — 같은 PBF가 실제로 담고 있는 남중국해
    // 먼 도서까지는 못 미쳤다.
    bbox: [102.0959, 7.3822, 114.6423, 23.4021],
  },
  {
    // BBBike's "Tokyo" extract is central Tokyo only — its real polygon is
    // [139.62,35.56]–[139.95,35.78] (confirmed via its .poly file), no Chiba at
    // all. The data has a Chiba visit at Narita Airport, lon 140.3870 — outside
    // both the old declared bbox and the old extract's real coverage. Geofabrik's
    // Kanto region extract genuinely spans Tokyo and Chiba.
    name: "tokyo-chiba",
    url: "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf",
    // .poly 경계 실측(2026-08-07). Task 3 코드 리뷰에서 발견: 옛 [139.59,
    // 35.55, 140.49, 35.87]는 방문 9건 주변 0.1° 패딩이었을 뿐, 같은 PBF가
    // 실제로 담고 있는 요코하마(35.44, 139.64)나 이즈·오가사와라 제도까지
    // 뻗은 간토 전체 범위보다 훨씬 좁았다 — 이미 타일이 덮는 지점의 444를
    // no_coverage로 잘못 분류해 "추출본을 넓히라"는 헛된 운영 신호를 냈다.
    bbox: [134.5757, 20.0823, 154.4709, 37.1599],
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
