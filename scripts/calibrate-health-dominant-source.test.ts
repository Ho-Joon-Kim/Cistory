import { describe, expect, it } from "vitest";
import { classifyDay } from "./calibrate-health-dominant-source";

describe("classifyDay", () => {
  it("matches within ±1%", () => {
    expect(classifyDay(1000, 1000)).toBe("match");
    expect(classifyDay(995, 1000)).toBe("match");
  });

  it("explains each kind of disagreement", () => {
    expect(classifyDay(18_000, 1_000)).toMatch(/ours higher/);
    expect(classifyDay(490, 1_000)).toMatch(/ours lower/);
    expect(classifyDay(500, 0)).toMatch(/band not worn/);
    expect(classifyDay(null, 800)).toMatch(/sync gap/);
    expect(classifyDay(null, null)).toBe("no data");
  });
});
