import { describe, expect, it } from "vitest";
import { metersPerSecondToKmh } from "./speed";

describe("metersPerSecondToKmh", () => {
  it("converts meters per second to kilometers per hour", () => {
    expect(metersPerSecondToKmh(10)).toBe(36);
  });

  it("preserves the sign of a sensor reading", () => {
    expect(metersPerSecondToKmh(-5)).toBe(-18);
  });
});
