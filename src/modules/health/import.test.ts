import { describe, expect, it } from "vitest";
import { parseImportBatch, parseImportRecord } from "./import";

const U = "user-1";

describe("parseImportRecord — sessions", () => {
  it("parses a sleep session → duration minutes + full record as valueJson", () => {
    const rec = {
      type: "SleepSession",
      start: "2026-07-11T23:00:00Z",
      end: "2026-07-12T07:30:00Z",
      metadata: { dataOrigin: { packageName: "com.sec.android.app.shealth" } },
    };
    const p = parseImportRecord(U, rec);
    expect(p?.metric).toBe("sleep");
    expect(p?.sampleAt.toISOString()).toBe("2026-07-11T23:00:00.000Z");
    expect(p?.value).toBe(510); // 8.5h
    expect(p?.source).toBe("com.sec.android.app.shealth");
    expect(p?.valueJson).toEqual(rec);
  });

  it("parses an exercise session and infers type from exerciseType", () => {
    const p = parseImportRecord(U, {
      exerciseType: "STRENGTH_TRAINING",
      startTime: "2026-07-11T09:00:00Z",
      endTime: "2026-07-11T09:45:00Z",
      source: "com.sec.android.app.shealth",
    });
    expect(p?.metric).toBe("exercise");
    expect(p?.value).toBe(45);
  });

  it("infers sleep from a stages field when type is unlabeled", () => {
    const p = parseImportRecord(U, {
      start: "2026-07-11T23:00:00Z",
      end: "2026-07-12T00:00:00Z",
      stages: [{ stage: "deep" }],
    });
    expect(p?.metric).toBe("sleep");
    expect(p?.value).toBe(60);
    expect(p?.source).toBe("healthconnect"); // fallback
  });

  it("keeps value null for a session with no end time", () => {
    const p = parseImportRecord(U, { type: "sleep", start: "2026-07-11T23:00:00Z" });
    expect(p?.metric).toBe("sleep");
    expect(p?.value).toBeNull();
  });
});

describe("parseImportRecord — scalars + rejects", () => {
  it("parses a scalar metric with a value", () => {
    const p = parseImportRecord(U, { metric: "steps", start: "2026-07-11T10:00:00Z", value: 120 });
    expect(p?.metric).toBe("steps");
    expect(p?.value).toBe(120);
    expect(p?.valueJson).toBeNull();
  });

  it("maps aliases (HeartRate → heart_rate, oxygen_saturation → spo2)", () => {
    expect(
      parseImportRecord(U, { type: "HeartRate", time: "2026-07-11T10:00:00Z", beatsPerMinute: 70 })
        ?.metric
    ).toBe("heart_rate");
    expect(
      parseImportRecord(U, {
        type: "oxygen_saturation",
        time: "2026-07-11T10:00:00Z",
        percentage: 98,
      })?.metric
    ).toBe("spo2");
  });

  it("handles real HC record shapes: epoch-millis times + nested { value } + suffixes", () => {
    // OxygenSaturationRecord: instant `time`, percentage nested as { value }
    const o = parseImportRecord(U, {
      type: "OxygenSaturationRecord",
      time: 1746800000000,
      percentage: { value: 97.5 },
    });
    expect(o?.metric).toBe("spo2");
    expect(o?.value).toBe(97.5);
    expect(o?.sampleAt.getTime()).toBe(1746800000000);

    // Vo2MaxRecord: vo2MillilitersPerMinuteKilogram
    expect(
      parseImportRecord(U, {
        type: "Vo2MaxRecord",
        time: 1746800000000,
        vo2MillilitersPerMinuteKilogram: 50,
      })?.value
    ).toBe(50);

    // DistanceRecord: distance.value in METERS → millimeters
    expect(
      parseImportRecord(U, {
        type: "DistanceRecord",
        startTime: 1746800000000,
        endTime: 1746810000000,
        distance: { value: 5000, type: "METERS" },
      })?.value
    ).toBe(5_000_000);

    // StepsRecord: count
    expect(
      parseImportRecord(U, {
        type: "StepsRecord",
        startTime: 1746800000000,
        endTime: 1746810000000,
        count: 512,
      })?.value
    ).toBe(512);

    // RestingHeartRateRecord + HeartRateVariabilityRmssdRecord (new metrics)
    expect(
      parseImportRecord(U, {
        type: "RestingHeartRateRecord",
        time: 1746800000000,
        beatsPerMinute: 69,
      })?.metric
    ).toBe("resting_heart_rate");
    expect(
      parseImportRecord(U, {
        type: "HeartRateVariabilityRmssdRecord",
        time: 1746800000000,
        heartRateVariabilityMillis: 42,
      })?.metric
    ).toBe("hrv");
  });

  it("rejects unknown metrics, missing time, and non-objects", () => {
    expect(
      parseImportRecord(U, { metric: "bloodpressure", start: "2026-07-11T10:00:00Z", value: 1 })
    ).toBeNull();
    expect(parseImportRecord(U, { metric: "steps", value: 1 })).toBeNull();
    expect(parseImportRecord(U, null)).toBeNull();
    expect(parseImportRecord(U, "nope")).toBeNull();
  });

  it("rejects a scalar with no numeric value", () => {
    expect(parseImportRecord(U, { metric: "steps", start: "2026-07-11T10:00:00Z" })).toBeNull();
  });
});

describe("metric inference for UNLABELED records (the plugin omits the type field)", () => {
  it("infers the metric from distinctive fields", () => {
    expect(parseImportRecord(U, { time: 1746800000000, percentage: { value: 97.5 } })?.metric).toBe(
      "spo2"
    );
    expect(
      parseImportRecord(U, { time: 1746800000000, vo2MillilitersPerMinuteKilogram: 50 })?.metric
    ).toBe("vo2_max");
    expect(
      parseImportRecord(U, { time: 1746800000000, heartRateVariabilityMillis: 42 })?.metric
    ).toBe("hrv");
    expect(parseImportRecord(U, { time: 1746800000000, beatsPerMinute: 69 })?.metric).toBe(
      "resting_heart_rate"
    );
    expect(
      parseImportRecord(U, { startTime: 1746800000000, endTime: 1746810000000, count: 512 })?.metric
    ).toBe("steps");
    expect(
      parseImportRecord(U, {
        startTime: 1746800000000,
        endTime: 1746810000000,
        distance: { value: 5000 },
      })?.metric
    ).toBe("distance");
  });

  it("falls back to the typeHint when a record has no type and no distinctive field", () => {
    const p = parseImportRecord(U, { time: 1746800000000, value: 97 }, "OxygenSaturationRecord");
    expect(p?.metric).toBe("spo2");
    expect(p?.value).toBe(97);
  });
});

describe("parseImportBatch", () => {
  it("accepts a bare array and a { records } wrapper, skipping bad rows", () => {
    const good = { type: "sleep", start: "2026-07-11T23:00:00Z", end: "2026-07-12T00:00:00Z" };
    expect(parseImportBatch(U, [good, {}, "x"]).length).toBe(1);
    expect(parseImportBatch(U, { records: [good, good] }).length).toBe(2);
    expect(parseImportBatch(U, { nope: 1 }).length).toBe(0);
  });

  it("binds the caller's userId, ignoring any in the payload", () => {
    const rows = parseImportBatch(U, [
      {
        userId: "attacker",
        type: "sleep",
        start: "2026-07-11T23:00:00Z",
        end: "2026-07-12T00:00:00Z",
      },
    ]);
    expect(rows[0].userId).toBe(U);
  });
});
