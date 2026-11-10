import { describe, expect, it } from "vitest";
import { toExerciseSessions } from "./health-evidence-loader";

const row = (source: string, exerciseType: string, start: string, end: string | null) => ({
  sampleAt: new Date(start),
  source,
  value: 14,
  valueJson: {
    exerciseType,
    interval: end ? { startTime: start, endTime: end } : { startTime: start },
  },
});

describe("toExerciseSessions", () => {
  it("keeps the measuring device's copy when Withings re-publishes a workout", () => {
    const sessions = toExerciseSessions([
      row("com.withings.wiscale2", "BIKING", "2026-11-08T23:45:20Z", "2026-11-08T23:59:20Z"),
      row("FITBIT", "ELECTRIC_BIKE", "2026-11-08T23:45:20Z", "2026-11-08T23:59:20Z"),
    ]);
    expect(sessions).toEqual([
      {
        start: new Date("2026-11-08T23:45:20Z"),
        end: new Date("2026-11-08T23:59:20Z"),
        exerciseType: "ELECTRIC_BIKE",
      },
    ]);
  });

  it("drops rows without an end time or exercise type", () => {
    expect(
      toExerciseSessions([
        row("FITBIT", "BIKING", "2026-11-08T23:45:20Z", null),
        row("FITBIT", "", "2026-11-09T23:45:20Z", "2026-11-09T23:59:20Z"),
      ])
    ).toEqual([]);
  });
});
