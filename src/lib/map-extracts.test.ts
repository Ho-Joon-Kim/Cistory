process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import {
  extractsFingerprint,
  fingerprintOf,
  isPointCovered,
  MAP_EXTRACTS,
  type MapExtract,
} from "./map-extracts";

describe("MAP_EXTRACTS", () => {
  it("covers every country the user has visited", () => {
    const names = MAP_EXTRACTS.map((e) => e.name);
    expect(names).toContain("south-korea");
    expect(names).toContain("hong-kong");
    // Renamed from "taipei": Geofabrik has no Taipei-only extract, only a
    // nationwide Taiwan PBF, and visits reach New Taipei City/Yilan County too.
    expect(names).toContain("taiwan");
    // Renamed from "vietnam-cities": the URL was always a whole-country PBF
    // (no Da Nang-only source exists), so the name now matches the coverage.
    expect(names).toContain("vietnam");
    // Renamed from "tokyo-chiba": the extract is the whole Kanto region, not
    // just Tokyo/Chiba (fix round 2 code review finding).
    expect(names).toContain("kanto");
  });

  it("gives every extract at least one well-formed bbox", () => {
    for (const extract of MAP_EXTRACTS) {
      expect(extract.bboxes.length).toBeGreaterThan(0);
      for (const [minLon, minLat, maxLon, maxLat] of extract.bboxes) {
        expect(minLon).toBeLessThan(maxLon);
        expect(minLat).toBeLessThan(maxLat);
        expect(minLat).toBeGreaterThanOrEqual(-90);
        expect(maxLat).toBeLessThanOrEqual(90);
        expect(minLon).toBeGreaterThanOrEqual(-180);
        expect(maxLon).toBeLessThanOrEqual(180);
      }
    }
  });

  it("gives every extract an https url", () => {
    for (const extract of MAP_EXTRACTS) {
      expect(extract.url).toMatch(/^https:\/\//);
    }
  });

  it("has no duplicate names", () => {
    const names = MAP_EXTRACTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // fix round 2: bbox went from a single tuple per extract to an array of
  // tuples, because a naive vertex min/max over a non-convex .poly boundary
  // overclaims — see the file-level comment in map-extracts.ts. This table
  // pins both directions of that fix with real coordinates: known-good
  // (should be covered — matches a real visit or a place genuinely inside
  // the extract's tiles) and known-bad (should NOT be covered — a
  // neighboring city/region that the old single-bbox declaration wrongly
  // swallowed). At least one bad coordinate per extract flagged in the code
  // review is included below.
  it("isPointCovered matches real .poly membership, not just the naive vertex bbox", () => {
    const covered: Array<[string, number, number]> = [
      ["Seoul", 37.5665, 126.978], // south-korea — real, frequent visits
      ["Busan", 35.1796, 129.0756], // south-korea
      ["Central, Hong Kong", 22.2793, 114.1628], // hong-kong — real visits
      ["Taipei", 25.033, 121.5654], // taiwan — real visits
      ["Da Nang", 16.0678, 108.2208], // vietnam — the only real visits
      ["Tokyo", 35.6762, 139.6503], // kanto
      ["Yokohama", 35.4437, 139.638], // kanto — inside the tiles, never visited
      ["Narita Airport", 35.7735, 140.387], // kanto — the visit that first exposed the bbox gap
    ];

    const notCovered: Array<[string, number, number]> = [
      // South Atlantic — outside every extract, the baseline no_coverage case.
      ["South Atlantic", -30.0, -20.0],
      // Fix round 2, C1: each of these sat inside the old single-bbox
      // declaration (naive vertex min/max) but is not on any of these
      // extracts' real tiles.
      ["Fukuoka", 33.5904, 130.4017], // was inside the old south-korea bbox
      ["Tsushima", 34.2043, 129.2871], // was inside the old south-korea bbox
      ["Shenzhen", 22.5431, 114.0579], // was inside the old hong-kong bbox
      ["Fuzhou", 26.0745, 119.2965], // was inside the old taiwan bbox
      ["Phnom Penh", 11.5564, 104.9282], // was inside the old vietnam bbox
      // Osaka is the headline case: a future Osaka trip would 444 on every
      // segment (no Kansai tiles), and the old kanto bbox wrongly claimed it
      // as covered, which would have permanently hidden the gap from the
      // no_coverage re-run queue.
      ["Osaka", 34.6937, 135.5023], // was inside the old kanto (tokyo-chiba) bbox
      ["Kyoto", 35.0116, 135.7681], // was inside the old kanto (tokyo-chiba) bbox
      ["Nagoya", 35.1815, 136.9066], // was inside the old kanto (tokyo-chiba) bbox
    ];

    for (const [label, lat, lon] of covered) {
      expect(isPointCovered(lat, lon), `${label} should be covered`).toBe(true);
    }
    for (const [label, lat, lon] of notCovered) {
      expect(isPointCovered(lat, lon), `${label} should NOT be covered`).toBe(false);
    }
  });

  // fingerprint는 tileVersion의 절반을 이룬다. 목록이 바뀌면 반드시 값이
  // 바뀌어야 "추출본을 넓힌 뒤 no_coverage만 다시 돌리기"가 성립한다. 이 성질을
  // 실제로 검증하려면 목록을 바꾼 전/후를 비교해야 한다 — 같은 목록을 두 번
  // 호출해 같다고 주장하는 것만으로는 "aaaaaaaaaaaa"를 반환하는 상수 함수도
  // 통과한다.
  it("changes its fingerprint when a bbox in the list changes", () => {
    const base: MapExtract[] = [
      { name: "a", url: "https://example.com/a.osm.pbf", bboxes: [[0, 0, 1, 1]] },
      { name: "b", url: "https://example.com/b.osm.pbf", bboxes: [[10, 10, 11, 11]] },
    ];
    const mutated: MapExtract[] = [base[0], { ...base[1], bboxes: [[10, 10, 11, 11.5]] }];

    expect(fingerprintOf(mutated)).not.toBe(fingerprintOf(base));
  });

  // A single extract can now carry more than one box (a mainland box plus
  // island boxes) — the fingerprint has to change when a box is added or
  // removed from one extract's list too, not just when a whole extract is
  // added/removed or an existing box's coordinates change.
  it("changes its fingerprint when a bbox is added to or removed from one extract", () => {
    const base: MapExtract[] = [
      { name: "a", url: "https://example.com/a.osm.pbf", bboxes: [[0, 0, 1, 1]] },
    ];
    const withExtraBox: MapExtract[] = [
      { ...base[0], bboxes: [...base[0].bboxes, [10, 10, 11, 11]] },
    ];

    expect(fingerprintOf(withExtraBox)).not.toBe(fingerprintOf(base));
  });

  it("changes its fingerprint when an extract is added or removed", () => {
    const base: MapExtract[] = [
      { name: "a", url: "https://example.com/a.osm.pbf", bboxes: [[0, 0, 1, 1]] },
    ];
    const extended: MapExtract[] = [
      ...base,
      { name: "b", url: "https://example.com/b.osm.pbf", bboxes: [[10, 10, 11, 11]] },
    ];

    expect(fingerprintOf(extended)).not.toBe(fingerprintOf(base));
  });

  it("keeps a stable fingerprint for the real extract list across calls", () => {
    const before = extractsFingerprint();
    expect(before).toMatch(/^[0-9a-f]{12}$/);
    expect(extractsFingerprint()).toBe(before);
  });
});
