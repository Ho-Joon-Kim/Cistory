import { describe, expect, it } from "vitest";
import { bboxContains, expandBbox } from "./subwayViewport";

describe("subway viewport buffering", () => {
  it("expands the viewport on every side", () => {
    expect(expandBbox([126, 37, 128, 38], 0.5)).toEqual([125, 36.5, 129, 38.5]);
  });

  it("clamps expanded bounds to valid world coordinates", () => {
    expect(expandBbox([-179, -89, 179, 89], 0.75)).toEqual([-180, -90, 180, 90]);
  });

  it("recognizes viewports that can reuse an already loaded buffer", () => {
    const loaded = [125, 36, 129, 39] as const;

    expect(bboxContains([...loaded], [126, 37, 128, 38])).toBe(true);
    expect(bboxContains([...loaded], [124.9, 37, 128, 38])).toBe(false);
  });
});
