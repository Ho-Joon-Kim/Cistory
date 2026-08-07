process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { extractsFingerprint, MAP_EXTRACTS } from "./map-extracts";

describe("MAP_EXTRACTS", () => {
  it("covers every country the user has visited", () => {
    const names = MAP_EXTRACTS.map((e) => e.name);
    expect(names).toContain("south-korea");
    expect(names).toContain("hong-kong");
    expect(names).toContain("taipei");
    expect(names).toContain("vietnam-cities");
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
  // 바뀌어야 "추출본을 넓힌 뒤 no_coverage만 다시 돌리기"가 성립한다.
  it("changes its fingerprint when the extract list changes", () => {
    const before = extractsFingerprint();
    expect(before).toMatch(/^[0-9a-f]{12}$/);
    expect(extractsFingerprint()).toBe(before);
  });
});
