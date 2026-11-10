import { describe, expect, it } from "vitest";
import {
  chooseFactPopoverPlacement,
  factPopoverBounds,
  pageGutter,
  scrollToFitPopover,
} from "./fact-placement";

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

describe("chooseFactPopoverPlacement · chart regions", () => {
  const trigger = rect(345, 365, 750, 840);
  const sentence = rect(345, 390, 750, 1000);
  const chart = rect(420, 690, 750, 1000);

  it("opens above when the host's chart sits below, even with room below (health HR)", () => {
    expect(
      chooseFactPopoverPlacement({ trigger, sentence, evidence: [], regions: [chart] }).side
    ).toBe("top");
  });

  it("opens below when the chart is above the line (mobile HR sparkline)", () => {
    const above = rect(250, 330, 200, 380);
    expect(
      chooseFactPopoverPlacement({
        trigger,
        sentence,
        evidence: [],
        regions: [above],
        preferred: "top",
      }).side
    ).toBe("bottom");
  });

  it("lets lit evidence win over chart regions (spending keeps its behaviour)", () => {
    const litAbove = rect(100, 300, 750, 1000);
    expect(
      chooseFactPopoverPlacement({ trigger, sentence, evidence: [litAbove], regions: [chart] }).side
    ).toBe("bottom");
  });
});

describe("factPopoverBounds", () => {
  it("uses the page gutters without a column", () => {
    expect(factPopoverBounds({ viewportWidth: 1440 })).toEqual({
      left: 96,
      right: 96,
      maxWidth: null,
    });
  });

  it("keeps the popover inside a middle column of a three-column row", () => {
    expect(factPopoverBounds({ viewportWidth: 1440, column: rect(200, 700, 720, 1032) })).toEqual({
      left: 720,
      right: 408,
      maxWidth: 312,
    });
  });

  it("ignores a full-width host (mobile)", () => {
    expect(factPopoverBounds({ viewportWidth: 390, column: rect(0, 900, 0, 390) })).toEqual({
      left: 16,
      right: 16,
      maxWidth: null,
    });
  });

  it("ignores a column too narrow to read in", () => {
    expect(
      factPopoverBounds({ viewportWidth: 1440, column: rect(0, 100, 600, 800) }).maxWidth
    ).toBeNull();
  });
});

describe("pageGutter", () => {
  it("matches px-page", () => {
    expect(pageGutter(390)).toBe(16);
    expect(pageGutter(1024)).toBe(24);
    expect(pageGutter(1440)).toBe(96);
  });
});

describe("scrollToFitPopover", () => {
  const base = { sideOffset: 6, height: 200, viewportHeight: 1000 };
  it("scrolls down so a below-popover fits instead of flipping onto the evidence", () => {
    expect(scrollToFitPopover({ ...base, side: "bottom", trigger: rect(900, 918) })).toBe(140);
  });
  it("does nothing when it already fits", () => {
    expect(scrollToFitPopover({ ...base, side: "bottom", trigger: rect(400, 418) })).toBe(0);
    expect(scrollToFitPopover({ ...base, side: "top", trigger: rect(400, 418) })).toBe(0);
  });
  it("scrolls up for a top popover near the top edge", () => {
    expect(scrollToFitPopover({ ...base, side: "top", trigger: rect(100, 118) })).toBe(-122);
  });
  it("never scrolls the trigger out of view", () => {
    expect(
      scrollToFitPopover({ ...base, height: 990, side: "bottom", trigger: rect(500, 518) })
    ).toBe(0);
  });
});
