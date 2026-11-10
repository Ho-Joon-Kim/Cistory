import { describe, expect, it } from "vitest";
import {
  axisTickIndices,
  placeAxisLabel,
  placeCallout,
  placeLineLabel,
  polylineHitsBox,
  segmentHitsBox,
} from "./chart-layout";

describe("segmentHitsBox", () => {
  const box = { x0: 10, x1: 20, y0: 10, y1: 20 };
  it("detects a segment passing through", () => {
    expect(segmentHitsBox({ x: 0, y: 15 }, { x: 30, y: 15 }, box, 0)).toBe(true);
  });
  it("ignores a segment passing by", () => {
    expect(segmentHitsBox({ x: 0, y: 30 }, { x: 30, y: 30 }, box, 0)).toBe(false);
  });
});

describe("placeCallout", () => {
  it("moves the callout off a line that runs through its default spot", () => {
    // A flat cost line 20px under the point: the default spot below it is struck.
    const cost = [
      { x: 0, y: 120 },
      { x: 400, y: 120 },
    ];
    const value = [
      { x: 0, y: 100 },
      { x: 400, y: 100 },
    ];
    const spot = placeCallout({
      p: { x: 200, y: 100 },
      w: 120,
      h: 18,
      preferAbove: false,
      width: 400,
      top: 0,
      bottom: 240,
      lines: [value, cost],
      avoid: [],
    });
    expect(spot).not.toBeNull();
    expect(polylineHitsBox(cost, spot!.box)).toBe(false);
    expect(polylineHitsBox(value, spot!.box)).toBe(false);
  });

  it("stays inside the chart and keeps a leader to the point at the edge", () => {
    const spot = placeCallout({
      p: { x: 280, y: 60 },
      w: 230,
      h: 18,
      preferAbove: false,
      width: 288,
      top: 0,
      bottom: 200,
      lines: [],
      avoid: [],
    });
    expect(spot!.box.x0).toBeGreaterThanOrEqual(0);
    expect(spot!.box.x1).toBeLessThanOrEqual(288);
    expect(spot!.leader.x).toBeGreaterThan(spot!.box.x0);
    expect(spot!.leader.x).toBeLessThanOrEqual(spot!.box.x1);
  });
});

describe("axisTickIndices", () => {
  it("labels every point when they fit", () => {
    expect(axisTickIndices(8, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("spaces ticks evenly back from the latest point", () => {
    const ticks = axisTickIndices(31, 3);
    expect(ticks).toEqual([0, 15, 30]);
    const seven = axisTickIndices(8, 6);
    const gaps = seven.slice(1).map((t, i) => t - seven[i]);
    expect(new Set(gaps).size).toBe(1);
    expect(seven.at(-1)).toBe(7);
  });
});

describe("placeAxisLabel", () => {
  const flat = (y: number) => [
    { x: 0, y },
    { x: 400, y },
  ];
  it("keeps the label directly above its own grid line", () => {
    const spot = placeAxisLabel({ y: 100, w: 60, width: 400, lines: [flat(160)] });
    expect(spot).not.toBeNull();
    expect(spot!.anchor).toBe("start");
    expect(spot!.baseline).toBeLessThan(100);
    expect(spot!.box.y1).toBeLessThanOrEqual(100);
  });
  it("moves to the right edge when a line crosses the left spot", () => {
    const rising = [
      { x: 0, y: 95 },
      { x: 80, y: 95 },
      { x: 100, y: 200 },
      { x: 400, y: 200 },
    ];
    const spot = placeAxisLabel({ y: 100, w: 60, width: 400, lines: [rising] });
    expect(spot?.anchor).toBe("end");
    expect(spot?.box.y1).toBeLessThanOrEqual(100);
  });
  it("drops the label rather than drawing it over the data", () => {
    expect(placeAxisLabel({ y: 100, w: 60, width: 400, lines: [flat(94)] })).toBeNull();
  });
});

describe("placeLineLabel", () => {
  const flat = (y: number) => [
    { x: 0, y },
    { x: 400, y },
  ];
  const base = { w: 48, width: 400, bottom: 200, avoid: [] };

  it("sits just below its own line at the right end when that is clear", () => {
    expect(placeLineLabel({ ...base, own: flat(100), other: flat(40) })).toEqual({
      x: 400,
      y: 116,
    });
  });

  it("never lands on or nearer the other series", () => {
    // The other line runs 14px under the own line: below is too close to it,
    // above is the only side that reads as the own line's label.
    const spot = placeLineLabel({ ...base, own: flat(100), other: flat(114) });
    expect(spot).toEqual({ x: 400, y: 94 });
  });

  it("slides left past an obstacle at the right end", () => {
    const avoid = [{ x0: 340, x1: 400, y0: 60, y1: 140 }];
    const spot = placeLineLabel({ ...base, avoid, own: flat(100), other: flat(20) });
    expect(spot?.x).toBeLessThanOrEqual(339);
    expect(spot?.x).toBeGreaterThanOrEqual(248);
  });

  it("drops the label when the lines are too tight to name one", () => {
    expect(placeLineLabel({ ...base, own: flat(100), other: flat(106) })).toBeNull();
  });
});
