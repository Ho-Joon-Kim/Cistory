import { describe, expect, it } from "vitest";
import { chooseFactPopoverPlacement, pageGutter } from "./fact-placement";

const rect = (top: number, bottom: number, left = 0, right = 100) => ({ top, bottom, left, right });

describe("chooseFactPopoverPlacement", () => {
  const trigger = rect(100, 120, 40, 80);
  const oneLine = rect(100, 120, 0, 600);

  it("keeps the preferred side when nothing is lit", () => {
    expect(chooseFactPopoverPlacement({ trigger, sentence: oneLine, evidence: [] })).toEqual({
      side: "bottom",
      sideOffset: 6,
    });
  });

  it("opens above when the highlighted evidence is below (travel year strip)", () => {
    const strip = [rect(150, 170, 0, 4), rect(150, 170, 40, 44)];
    expect(chooseFactPopoverPlacement({ trigger, sentence: oneLine, evidence: strip }).side).toBe(
      "top"
    );
  });

  it("opens below when the evidence is a chart above the line", () => {
    const bars = [rect(0, 90, 0, 600)];
    expect(
      chooseFactPopoverPlacement({ trigger, sentence: oneLine, evidence: bars, preferred: "top" })
        .side
    ).toBe("bottom");
  });

  it("clears the rest of a wrapped sentence instead of covering line 2", () => {
    const twoLines = rect(100, 144, 0, 600);
    expect(chooseFactPopoverPlacement({ trigger, sentence: twoLines, evidence: [] })).toEqual({
      side: "bottom",
      sideOffset: 30,
    });
  });

  it("ignores highlights inside the sentence itself", () => {
    const self = [rect(100, 120, 0, 600)];
    expect(chooseFactPopoverPlacement({ trigger, sentence: oneLine, evidence: self }).side).toBe(
      "bottom"
    );
  });
});

describe("pageGutter", () => {
  it("matches px-page", () => {
    expect(pageGutter(390)).toBe(16);
    expect(pageGutter(1024)).toBe(24);
    expect(pageGutter(1440)).toBe(96);
  });
});
