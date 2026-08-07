process.env.TZ = "Asia/Seoul";

import { describe, expect, it } from "vitest";
import { costingForMode } from "./costing";

describe("costingForMode", () => {
  it.each([
    ["walking", "pedestrian"],
    ["running", "pedestrian"],
    ["cycling", "bicycle"],
    ["driving", "auto"],
    ["motorcycle", "motorcycle"],
    ["bus", "bus"],
  ])("maps %s to the %s costing", (mode, costing) => {
    expect(costingForMode(mode)).toEqual({ kind: "match", costing });
  });

  it.each(["subway", "train", "flying"])("marks %s as not applicable", (mode) => {
    expect(costingForMode(mode)).toEqual({ kind: "not_applicable" });
  });

  it.each(["stationary", "unknown"])("skips %s", (mode) => {
    expect(costingForMode(mode)).toEqual({ kind: "skip" });
  });

  it("skips an unrecognised mode instead of guessing a costing", () => {
    expect(costingForMode("sailing")).toEqual({ kind: "skip" });
  });
});
