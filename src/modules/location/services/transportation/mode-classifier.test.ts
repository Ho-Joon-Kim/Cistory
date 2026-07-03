import { describe, expect, it } from "vitest";
import { classifyMode } from "./mode-classifier";

// Expected values derived by hand from the Dawarich threshold table:
// stationary ≤1 km/h, walking ≤7, running/cycling ≤20 (split on accel 0.25),
// cycling/driving ≤45 (split on accel 0.4, cycling likely ≤35), bus/motorcycle/
// driving 45-130 (accel bands 0.2-0.4 / >0.6), train 80-350 (accel <0.2, max/avg
// <1.3), high-speed 130-200 (train if accel <0.2), flying avg ≥150 & max ≥200.

describe("classifyMode", () => {
  describe("stationary / walking", () => {
    it("classifies avg speed of exactly 1 km/h as stationary (inclusive)", () => {
      expect(classifyMode(1, 3, 0)).toEqual({ mode: "stationary", confidence: "high" });
    });

    it("classifies just above 1 km/h as walking", () => {
      expect(classifyMode(1.1, 3, 0)).toEqual({ mode: "walking", confidence: "high" });
    });

    it("classifies avg speed of exactly 7 km/h as walking (inclusive)", () => {
      expect(classifyMode(7, 10, 0.1)).toEqual({ mode: "walking", confidence: "high" });
    });
  });

  describe("running vs cycling (7-20 km/h)", () => {
    it("classifies jerky movement above 0.25 m/s² as running", () => {
      expect(classifyMode(12, 16, 0.3)).toEqual({ mode: "running", confidence: "medium" });
    });

    it("classifies smooth movement at exactly 0.25 m/s² as cycling (not running)", () => {
      expect(classifyMode(12, 16, 0.25)).toEqual({ mode: "cycling", confidence: "low" });
    });

    it("classifies avg speed of exactly 20 km/h in the running/cycling band", () => {
      expect(classifyMode(20, 25, 0.3)).toEqual({ mode: "running", confidence: "medium" });
    });
  });

  describe("cycling vs driving (20-45 km/h)", () => {
    it("classifies high acceleration as driving", () => {
      expect(classifyMode(30, 40, 0.5)).toEqual({ mode: "driving", confidence: "medium" });
    });

    it("classifies low acceleration at ≤35 km/h as cycling", () => {
      expect(classifyMode(30, 40, 0.3)).toEqual({ mode: "cycling", confidence: "medium" });
    });

    it("classifies low acceleration above 35 km/h as driving with low confidence", () => {
      expect(classifyMode(40, 48, 0.3)).toEqual({ mode: "driving", confidence: "low" });
    });
  });

  describe("medium-high speed (45-130 km/h)", () => {
    it("classifies moderate acceleration (0.2-0.4 m/s²) as bus", () => {
      expect(classifyMode(60, 80, 0.3)).toEqual({ mode: "bus", confidence: "low" });
    });

    it("includes both bus acceleration band edges", () => {
      expect(classifyMode(60, 80, 0.2)).toEqual({ mode: "bus", confidence: "low" });
      expect(classifyMode(60, 80, 0.4)).toEqual({ mode: "bus", confidence: "low" });
    });

    it("classifies very high acceleration (>0.6 m/s²) as motorcycle", () => {
      expect(classifyMode(60, 90, 0.7)).toEqual({ mode: "motorcycle", confidence: "low" });
    });

    it("falls back to driving between the bus and motorcycle bands", () => {
      expect(classifyMode(60, 80, 0.5)).toEqual({ mode: "driving", confidence: "medium" });
    });
  });

  describe("train", () => {
    it("classifies steady high speed with low variance as train", () => {
      // 110/100 = 1.1 < 1.3 variance cap, accel 0.1 < 0.2.
      expect(classifyMode(100, 110, 0.1)).toEqual({ mode: "train", confidence: "high" });
    });

    it("rejects the train match when speed variance is too high", () => {
      // 140/100 = 1.4 ≥ 1.3 → falls to the 45-130 band → driving.
      expect(classifyMode(100, 140, 0.1)).toEqual({ mode: "driving", confidence: "medium" });
    });

    it("classifies 130-200 km/h with low acceleration as train (medium)", () => {
      // Variance 190/140 ≈ 1.36 blocks the high-confidence match.
      expect(classifyMode(140, 190, 0.1)).toEqual({ mode: "train", confidence: "medium" });
    });

    it("classifies 130-200 km/h with higher acceleration as driving (low)", () => {
      expect(classifyMode(140, 190, 0.3)).toEqual({ mode: "driving", confidence: "low" });
    });
  });

  describe("flying", () => {
    it("classifies avg ≥150 and max ≥200 km/h as flying (inclusive boundaries)", () => {
      expect(classifyMode(150, 200, 1)).toEqual({ mode: "flying", confidence: "high" });
    });

    it("does not classify as flying when avg speed is just below 150 km/h", () => {
      // avg 149 with erratic max → high-speed band, low accel → train.
      expect(classifyMode(149, 250, 0.1)).toEqual({ mode: "train", confidence: "medium" });
    });
  });

  describe("unknown", () => {
    it("returns unknown for speeds above 200 km/h that match no profile", () => {
      // max < 200 blocks flying; accel ≥ 0.2 blocks train.
      expect(classifyMode(250, 199, 0.5)).toEqual({ mode: "unknown", confidence: "low" });
    });
  });
});
