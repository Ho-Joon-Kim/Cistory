import { describe, expect, it } from "vitest";
import { COORD_DECIMALS, distanceM, roundCoord } from "./geo";

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
