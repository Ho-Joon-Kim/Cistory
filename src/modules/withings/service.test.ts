import { describe, expect, it } from "vitest";
import type { ParsedMeasureGroup } from "@/lib/adapters/withings/interface";
import { buildMeasurementValues, isTokenFresh } from "./service";

describe("isTokenFresh", () => {
  const now = 1_000_000;
  it("is false when no expiry", () => {
    expect(isTokenFresh(null, now)).toBe(false);
  });
  it("is false when within the refresh grace window", () => {
    expect(isTokenFresh(new Date(now + 30_000), now, 60_000)).toBe(false);
  });
  it("is true when comfortably before expiry", () => {
    expect(isTokenFresh(new Date(now + 5 * 60_000), now, 60_000)).toBe(true);
  });
});

describe("buildMeasurementValues", () => {
  const group: ParsedMeasureGroup = {
    groupId: 555,
    measuredAt: new Date("2026-07-10T01:00:00Z"),
    category: 1,
    metrics: {
      weightKg: 69.754,
      fatRatioPct: 18.4,
      heartRateBpm: 62.4, // should round
      visceralFat: 8,
    },
    raw: [{ value: 69754, type: 1, unit: -3 }],
  };

  it("serializes numeric columns to strings and rounds integer columns", () => {
    const v = buildMeasurementValues("user-1", group);
    expect(v.userId).toBe("user-1");
    expect(v.withingsGroupId).toBe(555);
    expect(v.weightKg).toBe("69.754");
    expect(v.fatRatioPct).toBe("18.4");
    expect(v.visceralFat).toBe("8");
    expect(v.heartRateBpm).toBe(62); // rounded
    expect(v.measuredAt).toEqual(group.measuredAt);
    expect(v.category).toBe(1);
  });

  it("maps absent metrics to null so upsert fully replaces", () => {
    const v = buildMeasurementValues("user-1", group);
    expect(v.muscleMassKg).toBeNull();
    expect(v.boneMassKg).toBeNull();
    expect(v.hydrationKg).toBeNull();
    expect(v.metabolicAge).toBeNull();
    expect(v.fatMassKg).toBeNull();
  });

  it("stores the raw measures as JSON", () => {
    const v = buildMeasurementValues("user-1", group);
    expect(JSON.parse(v.rawMeasures)).toEqual(group.raw);
  });
});
