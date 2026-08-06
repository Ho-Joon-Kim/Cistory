import { describe, expect, it } from "vitest";
import {
  COORD_DECIMALS,
  distanceM,
  PLACE_CACHE_COORD_DECIMALS,
  placeCacheCoordKey,
  roundCoord,
} from "./geo";

describe("distanceM", () => {
  it("is zero for identical points", () => {
    expect(distanceM(37.5665, 126.978, 37.5665, 126.978)).toBe(0);
  });

  it("is ~111.19 km for one degree of latitude", () => {
    // Arc length R * (pi/180) with R = 6_371_000 -> 111194.93 m.
    expect(distanceM(0, 0, 1, 0)).toBeCloseTo(111194.93, 0);
  });

  it("matches the short-distance arc for a ~55 m latitude step", () => {
    expect(distanceM(37.5665, 126.978, 37.567, 126.978)).toBeCloseTo(55.59, 0);
  });
});

describe("roundCoord", () => {
  it("rounds to the canonical 6 decimals", () => {
    expect(COORD_DECIMALS).toBe(6);
    expect(roundCoord(37.1234564)).toBe(37.123456);
    expect(roundCoord(37.1234566)).toBe(37.123457);
  });
});

describe("placeCacheCoordKey vs roundCoord", () => {
  // roundCoord (6 decimals, location_points dedup) and placeCacheCoordKey
  // (3 decimals, the place_cache grid) must never be swapped for each
  // other — swapping one for the other silently matches zero rows against
  // the other table. Pin both against a coordinate with more than 3
  // decimals so the two functions diverge; a coordinate like (37.5, 127)
  // round-trips identically through both and would not catch a swap.
  it("rounds to the place_cache grid precision (3 decimals), distinct from roundCoord's 6", () => {
    expect(PLACE_CACHE_COORD_DECIMALS).toBe(3);
    expect(placeCacheCoordKey(37.5224999)).toBe(37.522);
    expect(roundCoord(37.5224999)).toBe(37.5225);
    expect(placeCacheCoordKey(37.5224999)).not.toBe(roundCoord(37.5224999));
  });
});
