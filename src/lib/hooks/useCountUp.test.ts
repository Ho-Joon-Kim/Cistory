import { describe, expect, it } from "vitest";
import { countUpFrame } from "./useCountUp";

describe("countUpFrame", () => {
  it("starts at the previous value and ends exactly on the target", () => {
    expect(countUpFrame(10, 50, 0, 400)).toBe(10);
    expect(countUpFrame(10, 50, 400, 400)).toBe(50);
    expect(countUpFrame(10, 50, 10_000, 400)).toBe(50);
  });

  it("eases out, so the midpoint is past halfway", () => {
    const mid = countUpFrame(0, 100, 200, 400);
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(100);
  });

  it("counts down as well as up", () => {
    expect(countUpFrame(100, 0, 400, 400)).toBe(0);
    expect(countUpFrame(100, 0, 200, 400)).toBeLessThan(50);
  });

  it("jumps to the target when there is no duration", () => {
    expect(countUpFrame(3, 7, 0, 0)).toBe(7);
  });
});
