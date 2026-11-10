import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEALTH_REFINE_OPTIONS,
  exerciseTypeToMode,
  type HealthEvidence,
  refineSegmentMode,
  refineSegmentsWithHealth,
  stepCadenceForSegment,
} from "./health-evidence";
import type { TransportSegment } from "./movement-analyzer";

const T = (iso: string) => new Date(iso);

function segment(overrides: Partial<TransportSegment> = {}): TransportSegment {
  const startTime = overrides.startTime ?? T("2026-11-09T23:51:00Z");
  const endTime = overrides.endTime ?? T("2026-11-10T00:03:21Z");
  return {
    mode: "running",
    confidence: "medium",
    startTime,
    endTime,
    distanceMeters: 2800,
    durationSeconds: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
    avgSpeedKmh: 13.6,
    maxSpeedKmh: 132,
    avgAcceleration: 0.41,
    ...overrides,
  };
}

/** One step sample per minute in [from, to), `count` steps each. */
function minuteSteps(from: string, to: string, count: number, source = "FITBIT") {
  const out: HealthEvidence["steps"] = [];
  for (let t = T(from).getTime(); t < T(to).getTime(); t += 60_000) {
    out.push({ at: new Date(t), source, count });
  }
  return out;
}

const NO_EVIDENCE: HealthEvidence = { sessions: [], steps: [] };

describe("exerciseTypeToMode", () => {
  it("maps bike types to cycling, walk/hike to walking, running to running", () => {
    expect(exerciseTypeToMode("ELECTRIC_BIKE")).toBe("cycling");
    expect(exerciseTypeToMode("BIKING")).toBe("cycling");
    expect(exerciseTypeToMode("WALKING")).toBe("walking");
    expect(exerciseTypeToMode("HIKING")).toBe("walking");
    expect(exerciseTypeToMode("RUNNING")).toBe("running");
  });

  it("ignores types that do not move along the ground (treadmill, strength, generic workout)", () => {
    expect(exerciseTypeToMode("TREADMILL")).toBeNull();
    expect(exerciseTypeToMode("STRENGTH_TRAINING")).toBeNull();
    expect(exerciseTypeToMode("WORKOUT")).toBeNull();
    expect(exerciseTypeToMode("")).toBeNull();
  });
});

describe("refineSegmentMode — exercise session ground truth", () => {
  // 2026-11-10 08:51 KST: an e-bike commute labelled running (avg 13.6 km/h,
  // a 132 km/h GPS spike, jittery acceleration). Fitbit logged ELECTRIC_BIKE
  // 08:50:45–09:05:10 KST over the same window.
  const ebikeSession = {
    start: T("2026-11-09T23:50:45.600Z"),
    end: T("2026-11-10T00:05:10.600Z"),
    exerciseType: "ELECTRIC_BIKE",
  };

  it("relabels the 08:51 e-bike ride from running to cycling with high confidence", () => {
    const result = refineSegmentMode(segment(), { sessions: [ebikeSession], steps: [] });
    expect(result).toEqual({ mode: "cycling", confidence: "high", basis: "session" });
  });

  it("does not turn a vehicle-speed segment inside a bike session into cycling", () => {
    const result = refineSegmentMode(segment({ mode: "driving", avgSpeedKmh: 72 }), {
      sessions: [ebikeSession],
      steps: [],
    });
    expect(result.mode).toBe("driving");
    expect(result.basis).toBe("classifier");
  });

  it("can relabel a plausible-speed driving segment inside a bike session", () => {
    const result = refineSegmentMode(segment({ mode: "driving", avgSpeedKmh: 24 }), {
      sessions: [ebikeSession],
      steps: [],
    });
    expect(result).toEqual({ mode: "cycling", confidence: "high", basis: "session" });
  });

  it("keeps stationary segments stationary even inside a session", () => {
    const result = refineSegmentMode(segment({ mode: "stationary", avgSpeedKmh: 0.5 }), {
      sessions: [ebikeSession],
      steps: [],
    });
    expect(result.mode).toBe("stationary");
  });

  it("ignores a session that covers less than the overlap threshold of the segment", () => {
    // Segment 23:30–23:52 overlaps the session for ~1.25 of 22 minutes.
    const seg = segment({
      startTime: T("2026-11-09T23:30:00Z"),
      endTime: T("2026-11-09T23:52:00Z"),
    });
    const result = refineSegmentMode(seg, { sessions: [ebikeSession], steps: [] });
    expect(result.basis).not.toBe("session");
  });

  it("labels a walking-session segment walking even when GPS jitter pushes it past 7 km/h", () => {
    const result = refineSegmentMode(segment({ mode: "running", avgSpeedKmh: 9 }), {
      sessions: [{ ...ebikeSession, exerciseType: "WALKING" }],
      steps: [],
    });
    expect(result).toEqual({ mode: "walking", confidence: "high", basis: "session" });
  });

  it("does not let a walking session claim a vehicle-speed segment", () => {
    const result = refineSegmentMode(segment({ mode: "cycling", avgSpeedKmh: 30 }), {
      sessions: [{ ...ebikeSession, exerciseType: "WALKING" }],
      steps: [],
    });
    expect(result.mode).toBe("cycling");
  });
});

describe("stepCadenceForSegment", () => {
  const seg = segment();

  it("averages one source's steps over the segment minutes", () => {
    const steps = minuteSteps("2026-11-09T23:51:00Z", "2026-11-10T00:03:00Z", 20);
    const result = stepCadenceForSegment(seg, steps, DEFAULT_HEALTH_REFINE_OPTIONS);
    expect(result?.source).toBe("FITBIT");
    // 12 samples × 20 steps over 12.35 minutes
    expect(result?.stepsPerMinute).toBeCloseTo(240 / (741 / 60), 5);
  });

  it("prefers FITBIT over a phone source instead of summing both", () => {
    const steps = [
      ...minuteSteps("2026-11-09T23:51:00Z", "2026-11-10T00:03:00Z", 10, "FITBIT"),
      ...minuteSteps("2026-11-09T23:51:00Z", "2026-11-10T00:03:00Z", 100, "com.phone"),
    ];
    const result = stepCadenceForSegment(seg, steps, DEFAULT_HEALTH_REFINE_OPTIONS);
    expect(result?.source).toBe("FITBIT");
    expect(result?.stepsPerMinute).toBeCloseTo(120 / (741 / 60), 5);
  });

  it("treats a worn tracker with no in-window samples as zero cadence", () => {
    // Steps right before the ride, none during — the watch was on, the legs weren't walking.
    const steps = minuteSteps("2026-11-09T23:47:00Z", "2026-11-09T23:50:00Z", 30);
    const result = stepCadenceForSegment(seg, steps, DEFAULT_HEALTH_REFINE_OPTIONS);
    expect(result).toEqual({ source: "FITBIT", stepsPerMinute: 0 });
  });

  it("returns null when no source has any sample near the segment", () => {
    const steps = minuteSteps("2026-11-09T20:00:00Z", "2026-11-09T20:05:00Z", 30);
    expect(stepCadenceForSegment(seg, steps, DEFAULT_HEALTH_REFINE_OPTIONS)).toBeNull();
  });

  it("ignores daily-aggregate rows that cannot be a per-minute count", () => {
    const steps = [
      { at: T("2026-11-09T23:55:00Z"), source: "com.sec.android.app.shealth", count: 8000 },
    ];
    expect(stepCadenceForSegment(seg, steps, DEFAULT_HEALTH_REFINE_OPTIONS)).toBeNull();
  });

  it("returns null for segments too short to measure a cadence", () => {
    const short = segment({ endTime: T("2026-11-09T23:51:30Z") });
    const steps = minuteSteps("2026-11-09T23:45:00Z", "2026-11-09T23:55:00Z", 30);
    expect(stepCadenceForSegment(short, steps, DEFAULT_HEALTH_REFINE_OPTIONS)).toBeNull();
  });
});

describe("refineSegmentMode — step cadence fallback", () => {
  it("relabels a running segment cycling when the tracker shows almost no steps", () => {
    const steps = [
      ...minuteSteps("2026-11-09T23:47:00Z", "2026-11-09T23:51:00Z", 26),
      { at: T("2026-11-09T23:52:00Z"), source: "FITBIT", count: 13 },
    ];
    const result = refineSegmentMode(segment(), { sessions: [], steps });
    expect(result).toEqual({ mode: "cycling", confidence: "medium", basis: "steps" });
  });

  it("keeps a high-cadence band segment on foot (running)", () => {
    const steps = minuteSteps("2026-11-09T23:51:00Z", "2026-11-10T00:04:00Z", 165);
    const result = refineSegmentMode(segment({ mode: "cycling", confidence: "low" }), {
      sessions: [],
      steps,
    });
    expect(result).toEqual({ mode: "running", confidence: "medium", basis: "steps" });
  });

  it("calls a walking-cadence band segment walking (GPS-inflated speed)", () => {
    const steps = minuteSteps("2026-11-09T23:51:00Z", "2026-11-10T00:04:00Z", 100);
    const result = refineSegmentMode(segment({ avgSpeedKmh: 8.5 }), { sessions: [], steps });
    expect(result).toEqual({ mode: "walking", confidence: "medium", basis: "steps" });
  });

  it("catches a slow ride the classifier now calls walking (7–9 km/h, no steps)", () => {
    const steps = minuteSteps("2026-11-09T23:45:00Z", "2026-11-09T23:50:00Z", 30);
    const result = refineSegmentMode(segment({ mode: "walking", avgSpeedKmh: 8.2 }), {
      sessions: [],
      steps,
    });
    expect(result).toEqual({ mode: "cycling", confidence: "medium", basis: "steps" });
  });

  it("never second-guesses an ordinary walking pace with cadence", () => {
    // Zero steps at 4 km/h is a phone riding along in a bus or a GPS drift, not a bike.
    const steps = minuteSteps("2026-11-09T23:45:00Z", "2026-11-09T23:50:00Z", 30);
    const result = refineSegmentMode(segment({ mode: "walking", avgSpeedKmh: 4 }), {
      sessions: [],
      steps,
    });
    expect(result.basis).toBe("classifier");
  });

  it("never uses cadence on modes outside the running/cycling band", () => {
    const steps = minuteSteps("2026-11-09T23:51:00Z", "2026-11-10T00:04:00Z", 0);
    const result = refineSegmentMode(segment({ mode: "driving", avgSpeedKmh: 40 }), {
      sessions: [],
      steps,
    });
    expect(result.mode).toBe("driving");
  });

  it("leaves the classifier result alone without any health evidence", () => {
    const result = refineSegmentMode(segment({ mode: "cycling", confidence: "low" }), NO_EVIDENCE);
    expect(result).toEqual({ mode: "cycling", confidence: "low", basis: "classifier" });
  });
});

describe("refineSegmentsWithHealth", () => {
  it("merges neighbours that end up with the same mode", () => {
    const a = segment({
      mode: "cycling",
      startTime: T("2026-11-09T23:51:00Z"),
      endTime: T("2026-11-09T23:57:00Z"),
      distanceMeters: 1300,
      durationSeconds: 360,
      avgSpeedKmh: 13,
    });
    const b = segment({
      mode: "running",
      startTime: T("2026-11-09T23:57:00Z"),
      endTime: T("2026-11-10T00:03:00Z"),
      distanceMeters: 1500,
      durationSeconds: 360,
      avgSpeedKmh: 15,
    });
    const sessions = [
      {
        start: T("2026-11-09T23:50:00Z"),
        end: T("2026-11-10T00:05:00Z"),
        exerciseType: "ELECTRIC_BIKE",
      },
    ];
    const merged = refineSegmentsWithHealth([a, b], { sessions, steps: [] });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      mode: "cycling",
      confidence: "high",
      startTime: a.startTime,
      endTime: b.endTime,
      distanceMeters: 2800,
      durationSeconds: 720,
    });
  });

  it("returns segments unchanged when there is no evidence", () => {
    const segs = [segment({ mode: "walking", avgSpeedKmh: 4 })];
    expect(refineSegmentsWithHealth(segs, NO_EVIDENCE)).toEqual(segs);
  });
});
