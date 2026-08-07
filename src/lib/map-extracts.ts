import { createHash } from "node:crypto";

/**
 * Valhalla 타일을 굽는 데 쓰는 OSM 추출본 목록.
 *
 * bbox는 [minLon, minLat, maxLon, maxLat] — Geofabrik/BBBike와 Valhalla가
 * 모두 쓰는 순서다. 국가 단위가 아니라 방문 도시권으로 자르는 이유는, 방문
 * 9건인 일본을 위해 1.9GB 국가 PBF를 받게 되기 때문이다. 한국만 전국인
 * 이유는 방문이 실제로 전국에 퍼져 있어서다.
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
    name: "hong-kong",
    url: "https://download.bbbike.org/osm/bbbike/HongKong/HongKong.osm.pbf",
    bbox: [113.8, 22.15, 114.45, 22.58],
  },
  {
    name: "taipei",
    url: "https://download.bbbike.org/osm/bbbike/Taipei/Taipei.osm.pbf",
    bbox: [121.3, 24.9, 121.7, 25.2],
  },
  {
    name: "vietnam-cities",
    url: "https://download.geofabrik.de/asia/vietnam-latest.osm.pbf",
    bbox: [106.4, 10.6, 108.4, 16.2],
  },
  {
    name: "tokyo-chiba",
    url: "https://download.bbbike.org/osm/bbbike/Tokyo/Tokyo.osm.pbf",
    bbox: [139.4, 35.4, 140.3, 35.9],
  },
];

/**
 * 추출본 목록의 12자리 해시. `segment_route_matches.tile_version`의 절반을
 * 이룬다 (나머지 절반은 빌드 날짜). 목록이 바뀌면 값이 바뀌므로, 추출본을
 * 넓힌 뒤 "옛 fingerprint로 매칭된 no_coverage 행"만 골라 다시 돌릴 수 있다.
 */
export function extractsFingerprint(): string {
  const canonical = MAP_EXTRACTS.map((e) => `${e.name}:${e.bbox.join(",")}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}
