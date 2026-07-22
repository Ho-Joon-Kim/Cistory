import { describe, expect, it } from "vitest";
import {
  calibrateFlightDetection,
  FLIGHT_DETECTION_THRESHOLDS,
  REFERENCE_FLIGHT_LABELS,
  scoreFlightThresholds,
} from "./flight-calibration";

describe("flight detection calibration", () => {
  it("keeps all reference flights without accepting the GPS jump or KTX", () => {
    expect(
      scoreFlightThresholds(REFERENCE_FLIGHT_LABELS, FLIGHT_DETECTION_THRESHOLDS)
    ).toMatchObject({
      truePositives: 4,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1,
      recall: 1,
    });
  });

  it("ranks a precision-preserving candidate above the old speed-only thresholds", () => {
    const [best] = calibrateFlightDetection(REFERENCE_FLIGHT_LABELS, [
      { ...FLIGHT_DETECTION_THRESHOLDS, minDistanceMeters: 0 },
      FLIGHT_DETECTION_THRESHOLDS,
    ]);

    expect(best.thresholds).toEqual(FLIGHT_DETECTION_THRESHOLDS);
    expect(best.precision).toBe(1);
  });
});
