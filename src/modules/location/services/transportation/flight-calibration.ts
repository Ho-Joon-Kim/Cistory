export interface FlightSignals {
  averageSpeedKmh: number;
  maxSpeedKmh: number;
  distanceMeters: number;
}

export interface FlightDetectionThresholds {
  minAverageSpeedKmh: number;
  minMaxSpeedKmh: number;
  minDistanceMeters: number;
}

export interface LabeledFlightSignals extends FlightSignals {
  label: string;
  truthFlying: boolean;
}

export interface FlightCalibrationScore {
  thresholds: FlightDetectionThresholds;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Runtime thresholds chosen from the reference labels below. Distance is the
 * guard against short GPS jumps whose computed speed looks flight-like.
 */
export const FLIGHT_DETECTION_THRESHOLDS: FlightDetectionThresholds = {
  minAverageSpeedKmh: 150,
  minMaxSpeedKmh: 400,
  minDistanceMeters: 150_000,
};

export const REFERENCE_FLIGHT_LABELS: readonly LabeledFlightSignals[] = [
  {
    label: "2,409km long-haul flight with raw max-speed outlier",
    truthFlying: true,
    averageSpeedKmh: 820,
    maxSpeedKmh: 16_279,
    distanceMeters: 2_409_000,
  },
  {
    label: "2,409km long-haul flight after max-speed outlier removal",
    truthFlying: true,
    averageSpeedKmh: 820,
    maxSpeedKmh: 880,
    distanceMeters: 2_409_000,
  },
  {
    label: "473km Jeju flight",
    truthFlying: true,
    averageSpeedKmh: 610,
    maxSpeedKmh: 850,
    distanceMeters: 473_000,
  },
  {
    label: "172km sparse flight segment",
    truthFlying: true,
    averageSpeedKmh: 344,
    maxSpeedKmh: 920,
    distanceMeters: 172_000,
  },
  {
    label: "52km GPS jump",
    truthFlying: false,
    averageSpeedKmh: 285,
    maxSpeedKmh: 1_901,
    distanceMeters: 52_000,
  },
  {
    label: "KTX segment",
    truthFlying: false,
    averageSpeedKmh: 250,
    maxSpeedKmh: 305,
    distanceMeters: 325_000,
  },
];

export function isLikelyFlight(
  signals: FlightSignals,
  thresholds: FlightDetectionThresholds = FLIGHT_DETECTION_THRESHOLDS
): boolean {
  return (
    signals.averageSpeedKmh >= thresholds.minAverageSpeedKmh &&
    signals.maxSpeedKmh >= thresholds.minMaxSpeedKmh &&
    signals.distanceMeters >= thresholds.minDistanceMeters
  );
}

export function scoreFlightThresholds(
  labels: readonly LabeledFlightSignals[],
  thresholds: FlightDetectionThresholds
): FlightCalibrationScore {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const item of labels) {
    const predicted = isLikelyFlight(item, thresholds);
    if (predicted && item.truthFlying) truePositives++;
    if (predicted && !item.truthFlying) falsePositives++;
    if (!predicted && item.truthFlying) falseNegatives++;
  }

  const precision =
    truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall =
    truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    thresholds,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
  };
}

export function calibrateFlightDetection(
  labels: readonly LabeledFlightSignals[],
  candidates: readonly FlightDetectionThresholds[]
): FlightCalibrationScore[] {
  return candidates
    .map((thresholds) => scoreFlightThresholds(labels, thresholds))
    .sort(
      (a, b) =>
        b.f1 - a.f1 ||
        b.precision - a.precision ||
        b.recall - a.recall ||
        b.thresholds.minDistanceMeters - a.thresholds.minDistanceMeters
    );
}
