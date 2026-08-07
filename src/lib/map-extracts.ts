import { createHash } from "node:crypto";

/**
 * Valhalla 타일을 굽는 데 쓰는 OSM 추출본 목록.
 *
 * 각 추출본은 하나 이상의 bbox를 갖는다 — [minLon, minLat, maxLon, maxLat],
 * Geofabrik/BBBike와 Valhalla가 모두 쓰는 순서다. `hong-kong`만 도시(영토)
 * 단위 추출본이고, `south-korea`/`taiwan`/`vietnam`/`kanto`는 전국(또는
 * 지역 전체) PBF다 — Geofabrik에 그보다 작은 단위가 없거나(taiwan, vietnam),
 * 방문이 실제로 전국에 퍼져 있거나(south-korea), 원래 이름(`tokyo-chiba`)이
 * 뜻하던 것보다 훨씬 넓은 간토 지역 전체를 받기 때문이다(kanto, 옛 이름
 * `tokyo-chiba`가 오해를 불러 이번에 개명했다 — 아래 항목 주석 참고).
 *
 * **bbox는 "이 URL이 내려받는 PBF가 실제로 덮는 지리적 범위"를 뜻한다 —
 * "우리가 가본 곳"이 아니다.** `src/lib/adapters/map-matching/valhalla.ts`가
 * Valhalla의 error_code 444("스냅할 도로 없음")를 no_coverage(추출본을
 * 넓혀야 함)와 failed(추출본은 이미 덮는데 도로 근처가 아님 — 공원, 호수 등)
 * 로 가르는 데 `isPointCovered()`(이 파일)를 쓰기 때문이다.
 *
 * **왜 bbox가 하나가 아니라 배열인가.** `.poly` 경계는 비볼록이고 종종 서로
 * 멀리 떨어진 여러 덩어리(본토 + 외딴 섬들)를 하나의 영역으로 묶는다. 정점
 * 전체의 min/max로 사각형 하나를 만들면 그 사이의 무관한 땅까지 통째로
 * "덮음"이라고 주장하게 된다 — 실제로 이 코드베이스에 있었던 버그다: `kanto`
 * 의 `.poly`는 오가사와라(북위 20°)와 미나미토리시마(동경 154.5°)까지
 * 포함하는데, 정점 min/max 사각형을 그대로 썼더니 오사카·교토·나고야·
 * 시즈오카·나가노·가나자와·도야마까지 "이미 덮인 지역"으로 오판했다(코드
 * 리뷰가 실제 트레이스로 재현: 이 도시들에 444를 흉내 낸 요청을 보내면
 * `everyPointInsideExtracts`가 true를 반환해 no_coverage 대신 failed를
 * 저장했다 — 나중에 `kansai` 추출본을 추가해도 이 행들은 no_coverage만
 * 골라 재실행하는 큐에 절대 잡히지 않는다). 과소 주장은 되돌릴 수 있는
 * 낭비(운영자가 no_coverage를 보고 추출본을 넓히면 그만)지만, 과대 주장은
 * 되돌릴 수 없는 유실(그 행은 영원히 failed로 남는다)이다 — 그래서 애매하면
 * 항상 더 좁게 잡는다.
 *
 * 아래 모든 bbox는 각 URL의 `.poly` 경계 파일을 내려받아, 그 안의 실제
 * 다각형(들)에 대해 점-다각형 포함 판정(ray casting)을 한 결과다 — 정점의
 * min/max가 아니다. 방법: 후보 영역을 촘촘한 격자(도시처럼 좁은 지역은
 * ~0.03°, 나라 전체는 0.5~1.0°)로 나누고, 각 칸의 네 모서리와 중심 다섯 점이
 * 모두 실제 다각형 내부일 때만 그 칸을 "덮임"으로 남긴 뒤, 같은 위도에서
 * 인접한 칸들을 하나의 bbox로 합쳤다. 결과가 여러 개의 작은 bbox인 것은
 * 지저분해서가 아니라, 진짜 육지 모양(비볼록, 섬이 흩어짐)을 사각형 하나로
 * 과대 주장 없이 근사하면 원래 이렇게 된다. `hong-kong`만 이 방식으로도
 * 자연스럽게 1개, `kanto`는 본토+이즈·오가사와라 사슬을 담느라 여러 개다.
 * 검증: 아래 각 항목 옆에 실측으로 빠진 오탐(선전, 후쿠오카·쓰시마, 오사카
 * 등)과 잡힌 정탐(요코하마, 서울/부산 등)을 남겼고, `map-extracts.test.ts`
 * 가 `isPointCovered()`로 양쪽 방향을 모두 고정한다.
 *
 * 새 도시를 다녀왔다면, 그 좌표가 이미 어느 bbox 안에 있는지부터 확인한다
 * (`isPointCovered`) — 이미 덮인 지역 안이면 할 일이 없다. 정말 모든 bbox
 * 밖일 때만 새 추출본을 추가한다. 다음 타일 재빌드 때 반영되고, 그때까지
 * 그 지역 세그먼트는 `no_coverage`로 남는다 (조용히 사라지지 않는다).
 */
export interface MapExtract {
  /** 타일 빌드 로그와 fingerprint에 쓰이는 안정적인 식별자. */
  name: string;
  /** PBF 다운로드 URL. */
  url: string;
  /**
   * [[minLon, minLat, maxLon, maxLat], ...] — 이 URL이 내려받는 PBF의 실제
   * 지리적 범위를, `.poly` 경계에 대한 점-다각형 포함 판정으로 근사한
   * bbox들. 이 배열의 합집합 밖은 "덮이지 않음"으로 취급된다 — 정점
   * min/max로 만든 사각형 하나가 아니다(과대 주장 문제, 파일 상단 주석
   * 참고).
   */
  bboxes: Array<[number, number, number, number]>;
}

export const MAP_EXTRACTS: MapExtract[] = [
  {
    name: "south-korea",
    url: "https://download.geofabrik.de/asia/south-korea-latest.osm.pbf",
    // .poly 실측(2026-08-07), 격자 0.5°. 정탐: 서울/부산/제주 모두 포함.
    // 오탐 제거: 후쿠오카·쓰시마(옛 정점 min/max bbox에는 들어있었다 — 규슈
    // 북부가 한반도 bbox의 위경도 범위 안에 들어오기 때문)는 이제 밖이다.
    // 알려진 축소: 울릉도·독도처럼 사각형 하나보다 작은 외딴 섬은 이 격자
    // 해상도에서 빠질 수 있다 — 실방문 가능성이 낮고, 빠지더라도
    // no_coverage(과소 주장, 되돌릴 수 있음)로만 남으므로 허용한다.
    bboxes: [
      [124.8188, 32.8608, 127.3188, 33.3608],
      [124.8188, 33.3608, 127.8188, 33.8608],
      [124.8188, 33.8608, 128.3188, 34.3608],
      [124.8188, 34.3608, 128.8188, 34.8608],
      [124.8188, 34.8608, 129.3188, 35.3608],
      [124.8188, 35.3608, 129.8188, 35.8608],
      [124.8188, 35.8608, 130.8188, 36.3608],
      [124.8188, 36.3608, 131.3188, 36.8608],
      [124.8188, 36.8608, 131.8188, 37.3608],
      [126.8188, 37.3608, 131.8188, 37.8608],
      [128.3188, 37.8608, 129.8188, 38.3608],
    ],
  },
  {
    // BBBike never hosted a Hong Kong extract — its ~238-city catalog has no entry
    // for it, and the old URL 404s. Geofabrik does.
    name: "hong-kong",
    url: "https://download.geofabrik.de/asia/china/hong-kong-latest.osm.pbf",
    // .poly 실측(2026-08-07), 격자 0.03°(HK는 면적이 작아 넓은 격자로는
    // 어떤 칸도 통과하지 못한다). 정탐: 센트럴/침사추이/샤틴/란타우 모두
    // 포함. 오탐 제거: 선전(옛 정점 min/max bbox에는 들어있었다)은 이제 밖.
    bboxes: [
      [113.873, 22.1604, 114.503, 22.1904],
      [113.843, 22.1904, 114.503, 22.2504],
      [113.873, 22.2504, 114.503, 22.3704],
      [113.873, 22.3704, 114.473, 22.4304],
      [113.933, 22.4304, 114.473, 22.4604],
      [113.963, 22.4604, 114.443, 22.4904],
      [114.083, 22.4904, 114.443, 22.5204],
      [114.173, 22.5204, 114.203, 22.5504],
      [114.263, 22.5204, 114.443, 22.5504],
    ],
  },
  {
    // Geofabrik has no Taipei-only extract, only nationwide Taiwan (~310MB). That's
    // a deliberate exception to the per-city rule above, not sloppiness: 310MB for
    // 20 visits is worse than the per-city ideal, but it's the only source that
    // actually exists, and it's still far better than downloading all of East Asia.
    name: "taiwan",
    url: "https://download.geofabrik.de/asia/taiwan-latest.osm.pbf",
    // .poly 실측(2026-08-07), 격자 1.0°. 정탐: 타이베이/이란/가오슝 모두
    // 포함. 오탐 제거: 푸저우·취안저우(옛 정점 min/max bbox에는 들어있었다
    // — 대만해협 건너 중국 본토)는 이제 밖.
    bboxes: [
      [120.1036, 21.728, 121.1036, 22.728],
      [119.1036, 22.728, 122.1036, 24.728],
      [120.1036, 24.728, 122.1036, 25.728],
    ],
  },
  {
    // All 13 visits are in Da Nang, but Geofabrik's smallest Vietnam extract is the
    // whole country (~326MB) — there's no Da Nang-only source, so this was always
    // downloading nationwide tiles despite the old "vietnam-cities" name and its
    // Da-Nang-shaped bbox.
    name: "vietnam",
    url: "https://download.geofabrik.de/asia/vietnam-latest.osm.pbf",
    // .poly 실측(2026-08-07), 격자 1.0°. 정탐: 하노이/다낭/호치민 모두
    // 포함(실제 방문 13건은 전부 다낭). 오탐 제거: 프놈펜·비엔티안·하이난·
    // 난닝(옛 정점 min/max bbox에는 다 들어있었다 — 베트남이 남북으로 길고
    // 가늘어서 이웃 나라·섬까지 위경도 범위에 걸렸다)은 이제 밖. 알려진
    // 축소: 푸꾸옥처럼 사각형 하나보다 작은 섬은 빠질 수 있다 — 실방문
    // 기록이 없고, 빠지더라도 no_coverage로만 남으므로 허용한다.
    bboxes: [
      [104.0959, 8.3822, 110.0959, 9.3822],
      [104.0959, 9.3822, 111.0959, 10.3822],
      [106.0959, 10.3822, 111.0959, 11.3822],
      [108.0959, 11.3822, 113.0959, 12.3822],
      [108.0959, 12.3822, 112.0959, 13.3822],
      [108.0959, 13.3822, 111.0959, 14.3822],
      [108.0959, 14.3822, 110.0959, 15.3822],
      [108.0959, 15.3822, 109.0959, 16.3822],
      [107.0959, 16.3822, 108.0959, 17.3822],
      [106.0959, 17.3822, 107.0959, 18.3822],
      [105.0959, 18.3822, 107.0959, 20.3822],
      [105.0959, 20.3822, 108.0959, 21.3822],
      [103.0959, 21.3822, 106.0959, 22.3822],
    ],
  },
  {
    // BBBike's "Tokyo" extract is central Tokyo only — its real polygon is
    // [139.62,35.56]–[139.95,35.78] (confirmed via its .poly file), no Chiba at
    // all. The data has a Chiba visit at Narita Airport, lon 140.3870 — outside
    // both the old declared bbox and the old extract's real coverage. Geofabrik's
    // extract for this URL is the whole Kanto region — not just Tokyo/Chiba, so
    // renamed from `tokyo-chiba` (a Task 3 code review finding: the old name
    // undersold what's actually downloaded and built).
    name: "kanto",
    url: "https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf",
    // .poly 실측(2026-08-07). 이 `.poly`는 3개의 고리(ring)다: 본토(간토
    // 해안선을 따라가는 197점 + 이즈·오가사와라 제도 쪽을 향해 대략적으로
    // 닫는 나머지 구간), 오키노토리시마, 미나미토리시마. 본토 고리는 격자
    // 1.0°로 분해했고(비볼록이라 정점 min/max로는 오사카·교토·나고야·
    // 시즈오카·나가노·가나자와·도야마까지 "덮음"으로 오판했다 — 이 파일
    // 상단 주석의 버그 사례가 이것이다), 두 외딴 섬은 그 자체로 작고
    // 볼록에 가까워 고리 하나의 정점 min/max를 그대로 썼다. 정탐: 도쿄/
    // 요코하마/나리타/사이타마 모두 포함. 오탐 제거: 위 7개 도시 모두 밖.
    bboxes: [
      [135.8525, 20.2134, 136.3236, 20.6303], // Okinotorishima
      [135.5757, 21.0823, 140.5757, 22.0823],
      [135.5757, 22.0823, 141.5757, 23.0823],
      [136.5757, 23.0823, 149.5757, 24.0823],
      [153.7509, 24.0763, 154.2068, 24.4914], // Minamitorishima
      [136.5757, 24.0823, 153.5757, 25.0823],
      [136.5757, 25.0823, 152.5757, 26.0823],
      [136.5757, 26.0823, 151.5757, 27.0823],
      [137.5757, 27.0823, 150.5757, 28.0823],
      [137.5757, 28.0823, 149.5757, 29.0823],
      [137.5757, 29.0823, 147.5757, 30.0823],
      [138.5757, 30.0823, 146.5757, 31.0823],
      [138.5757, 31.0823, 145.5757, 32.0823],
      [138.5757, 32.0823, 144.5757, 33.0823],
      [138.5757, 33.0823, 143.5757, 34.0823],
      [139.5757, 34.0823, 142.5757, 35.0823], // mainland (Tokyo/Yokohama/Narita/Saitama)
      [139.5757, 35.0823, 141.5757, 36.0823], // mainland (Tokyo/Yokohama/Narita/Saitama)
    ],
  },
];

/**
 * 어떤 좌표가 `MAP_EXTRACTS`의 bbox 중 하나에라도 들어가는지. Valhalla의
 * error_code 444를 no_coverage/failed로 가르는 데 쓰는 유일한 판별 함수다
 * (`src/lib/adapters/map-matching/valhalla.ts`) — 그쪽에서 이 로직을 따로
 * 들고 있지 않는 이유는, "이 좌표는 우리가 덮는 범위 안인가"라는 질문 자체가
 * 이 파일의 데이터에 속하기 때문이다.
 */
export function isPointCovered(lat: number, lon: number): boolean {
  return MAP_EXTRACTS.some((extract) =>
    extract.bboxes.some(
      ([minLon, minLat, maxLon, maxLat]) =>
        lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
    )
  );
}

/**
 * `extracts`의 12자리 해시. 정렬 후 조인하므로 목록 순서와 무관하게 안정적이고,
 * `name`이나 `bboxes` 중 하나라도 바뀌면 값이 바뀐다. `extractsFingerprint()`가
 * `MAP_EXTRACTS`에 적용하는 얇은 래퍼이고, 이 함수 자체는 임의의 목록에 대해
 * 순수하게 계산하므로 "다른 목록이면 다른 값" 성질을 목록 전체를 갈아엎지
 * 않고도 테스트할 수 있다.
 */
export function fingerprintOf(extracts: MapExtract[]): string {
  const canonical = extracts
    .map((e) => `${e.name}:${e.bboxes.map((b) => b.join(",")).join(";")}`)
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
