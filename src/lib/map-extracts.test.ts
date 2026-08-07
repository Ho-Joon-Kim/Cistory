process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { extractsFingerprint, fingerprintOf, MAP_EXTRACTS, type MapExtract } from "./map-extracts";

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
    expect(names).toContain("tokyo-chiba");
  });

  it("gives every extract a well-formed bbox", () => {
    for (const extract of MAP_EXTRACTS) {
      const [minLon, minLat, maxLon, maxLat] = extract.bbox;
      expect(minLon).toBeLessThan(maxLon);
      expect(minLat).toBeLessThan(maxLat);
      expect(minLat).toBeGreaterThanOrEqual(-90);
      expect(maxLat).toBeLessThanOrEqual(90);
      expect(minLon).toBeGreaterThanOrEqual(-180);
      expect(maxLon).toBeLessThanOrEqual(180);
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

  // fingerprint는 tileVersion의 절반을 이룬다. 목록이 바뀌면 반드시 값이
  // 바뀌어야 "추출본을 넓힌 뒤 no_coverage만 다시 돌리기"가 성립한다. 이 성질을
  // 실제로 검증하려면 목록을 바꾼 전/후를 비교해야 한다 — 같은 목록을 두 번
  // 호출해 같다고 주장하는 것만으로는 "aaaaaaaaaaaa"를 반환하는 상수 함수도
  // 통과한다.
  it("changes its fingerprint when a bbox in the list changes", () => {
    const base: MapExtract[] = [
      { name: "a", url: "https://example.com/a.osm.pbf", bbox: [0, 0, 1, 1] },
      { name: "b", url: "https://example.com/b.osm.pbf", bbox: [10, 10, 11, 11] },
    ];
    const mutated: MapExtract[] = [base[0], { ...base[1], bbox: [10, 10, 11, 11.5] }];

    expect(fingerprintOf(mutated)).not.toBe(fingerprintOf(base));
  });

  it("changes its fingerprint when an extract is added or removed", () => {
    const base: MapExtract[] = [
      { name: "a", url: "https://example.com/a.osm.pbf", bbox: [0, 0, 1, 1] },
    ];
    const extended: MapExtract[] = [
      ...base,
      { name: "b", url: "https://example.com/b.osm.pbf", bbox: [10, 10, 11, 11] },
    ];

    expect(fingerprintOf(extended)).not.toBe(fingerprintOf(base));
  });

  it("keeps a stable fingerprint for the real extract list across calls", () => {
    const before = extractsFingerprint();
    expect(before).toMatch(/^[0-9a-f]{12}$/);
    expect(extractsFingerprint()).toBe(before);
  });
});
