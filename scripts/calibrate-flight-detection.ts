/**
 * Read-only calibration grid search for flight detection.
 *
 * Usage:
 *   npx tsx scripts/calibrate-flight-detection.ts [labels.csv]
 *
 * CSV columns:
 *   label,truth_flying,average_speed_kmh,max_speed_kmh,distance_meters
 *
 * With no path, the checked-in reference labels are used. This script only
 * reads labels and prints candidate precision/recall; it never writes data or
 * changes runtime thresholds.
 */

import { readFileSync } from "node:fs";
import { argv } from "node:process";
import {
  calibrateFlightDetection,
  FLIGHT_DETECTION_THRESHOLDS,
  type FlightDetectionThresholds,
  type LabeledFlightSignals,
  REFERENCE_FLIGHT_LABELS,
  scoreFlightThresholds,
} from "../src/modules/location/services/transportation/flight-calibration";

function parseCsvRow(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error("CSV에 닫히지 않은 따옴표가 있습니다");
  values.push(value.trim());
  return values;
}

function parseFiniteNumber(raw: string | undefined, column: string, row: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${row}행 ${column} 값이 유효한 0 이상의 숫자가 아닙니다`);
  }
  return value;
}

function readLabels(path: string): LabeledFlightSignals[] {
  const rows = readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map(parseCsvRow);
  if (rows.length < 2) throw new Error("CSV에는 헤더와 최소 1개의 라벨 행이 필요합니다");

  const header = rows[0];
  const index = (name: string) => header.indexOf(name);
  const required = ["truth_flying", "average_speed_kmh", "max_speed_kmh", "distance_meters"];
  for (const column of required) {
    if (index(column) < 0) throw new Error(`CSV 헤더에 ${column} 열이 필요합니다`);
  }

  return rows.slice(1).map((columns, rowIndex) => {
    const row = rowIndex + 2;
    const truth = columns[index("truth_flying")]?.toLowerCase();
    if (!truth || !["true", "false", "1", "0", "yes", "no"].includes(truth)) {
      throw new Error(`${row}행 truth_flying 값은 true/false여야 합니다`);
    }
    return {
      label: columns[index("label")] || `row-${row}`,
      truthFlying: ["true", "1", "yes"].includes(truth),
      averageSpeedKmh: parseFiniteNumber(
        columns[index("average_speed_kmh")],
        "average_speed_kmh",
        row
      ),
      maxSpeedKmh: parseFiniteNumber(columns[index("max_speed_kmh")], "max_speed_kmh", row),
      distanceMeters: parseFiniteNumber(columns[index("distance_meters")], "distance_meters", row),
    };
  });
}

function candidateGrid(): FlightDetectionThresholds[] {
  const candidates: FlightDetectionThresholds[] = [FLIGHT_DETECTION_THRESHOLDS];
  for (const minAverageSpeedKmh of [150, 250, 300, 320, 350]) {
    for (const minMaxSpeedKmh of [200, 400, 600]) {
      for (const minDistanceMeters of [0, 50_000, 100_000, 150_000, 170_000]) {
        candidates.push({ minAverageSpeedKmh, minMaxSpeedKmh, minDistanceMeters });
      }
    }
  }
  return candidates;
}

try {
  const path = argv[2];
  const labels = path ? readLabels(path) : [...REFERENCE_FLIGHT_LABELS];
  const scores = calibrateFlightDetection(labels, candidateGrid()).slice(0, 9);
  const runtimeScore = scoreFlightThresholds(labels, FLIGHT_DETECTION_THRESHOLDS);
  if (
    !scores.some(
      ({ thresholds }) => JSON.stringify(thresholds) === JSON.stringify(FLIGHT_DETECTION_THRESHOLDS)
    )
  ) {
    scores.push(runtimeScore);
  }

  console.log(`labels=${labels.length} source=${path ?? "checked-in reference labels"}`);
  console.log("avg_min\tmax_min\tdistance_min\tprecision\trecall\tf1\tFP\tFN\truntime");
  for (const score of scores) {
    const runtime =
      JSON.stringify(score.thresholds) === JSON.stringify(FLIGHT_DETECTION_THRESHOLDS) ? "yes" : "";
    console.log(
      [
        score.thresholds.minAverageSpeedKmh,
        score.thresholds.minMaxSpeedKmh,
        score.thresholds.minDistanceMeters,
        score.precision.toFixed(3),
        score.recall.toFixed(3),
        score.f1.toFixed(3),
        score.falsePositives,
        score.falseNegatives,
        runtime,
      ].join("\t")
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
