import { describe, expect, it } from "vitest";
import { CURATED_METRICS } from "./metrics-meta";
import {
  buildTimeFilter,
  durationToMinutes,
  HEALTH_METRICS,
  isHealthTokenFresh,
  type MetricConfig,
  parseExerciseWorkout,
  parseSample,
  parseSleepSession,
} from "./service";

const byKey = (key: string): MetricConfig => {
  const c = HEALTH_METRICS.find((m) => m.key === key);
  if (!c) throw new Error(`no metric config for ${key}`);
  return c;
};

describe("HEALTH_METRICS config", () => {
  it("has unique metric keys and dataTypes", () => {
    expect(new Set(HEALTH_METRICS.map((m) => m.key)).size).toBe(HEALTH_METRICS.length);
    expect(new Set(HEALTH_METRICS.map((m) => m.dataType)).size).toBe(HEALTH_METRICS.length);
  });

  it("each time shape filters on its own verified field", () => {
    const suffix = {
      interval: ".interval.start_time",
      sampleTime: ".sample_time.physical_time",
      date: ".date",
    } as const;
    for (const m of HEALTH_METRICS) {
      expect(m.filterField, m.key).toContain(suffix[m.timeShape]);
      // filter fields are snake_case only (spike: camelCase / hyphen → 400)
      expect(m.filterField).not.toMatch(/[A-Z]/);
      expect(m.filterField).not.toContain("-");
      // …and the field is prefixed with the dataType in snake_case.
      expect(m.filterField.startsWith(`${m.dataType.replace(/-/g, "_")}.`), m.key).toBe(true);
    }
  });

  // Only the pre-aggregated daily-* rollups get revised after we first read them.
  it("marks exactly the date-shaped metrics as revisable", () => {
    for (const m of HEALTH_METRICS) {
      expect(!!m.revisable, m.key).toBe(m.timeShape === "date");
    }
  });

  it("marks accumulating metrics as sum and instantaneous ones as avg", () => {
    expect(byKey("steps").agg).toBe("sum");
    expect(byKey("distance").agg).toBe("sum");
    expect(byKey("active_energy").agg).toBe("sum");
    expect(byKey("active_zone_minutes").agg).toBe("sum");
    expect(byKey("heart_rate").agg).toBe("avg");
    expect(byKey("hrv").agg).toBe("avg");
    expect(byKey("resting_heart_rate").agg).toBe("avg");
  });

  // The curated /health view duplicates `agg` (it can't import the server-only
  // service module into client bundles). Guard against the two drifting apart —
  // a mismatch would make the trend read the wrong summary column (sum vs avg).
  it("every curated metric exists in HEALTH_METRICS with a matching agg", () => {
    for (const m of CURATED_METRICS) {
      const config = HEALTH_METRICS.find((h) => h.key === m.key);
      expect(config, `curated metric ${m.key} must exist in HEALTH_METRICS`).toBeDefined();
      expect(m.agg).toBe(config?.agg);
    }
  });
});

describe("isHealthTokenFresh", () => {
  const now = 1_000_000;
  it("is false with no expiry", () => {
    expect(isHealthTokenFresh(null, now)).toBe(false);
  });
  it("is false within the refresh grace window", () => {
    expect(isHealthTokenFresh(new Date(now + 30_000), now, 60_000)).toBe(false);
  });
  it("is true comfortably before expiry", () => {
    expect(isHealthTokenFresh(new Date(now + 5 * 60_000), now, 60_000)).toBe(true);
  });
});

describe("buildTimeFilter", () => {
  const since = new Date("2026-07-05T00:00:00.000Z");
  const until = new Date("2026-07-12T00:00:00.000Z");

  it("builds a lower-bound-only filter for an interval metric", () => {
    expect(buildTimeFilter(byKey("steps"), since)).toBe(
      'steps.interval.start_time >= "2026-07-05T00:00:00.000Z"'
    );
  });

  it("uses sample_time.physical_time for an instantaneous metric", () => {
    expect(buildTimeFilter(byKey("heart_rate"), since)).toBe(
      'heart_rate.sample_time.physical_time >= "2026-07-05T00:00:00.000Z"'
    );
  });

  it("adds a closed-open upper bound for a backfill window", () => {
    expect(buildTimeFilter(byKey("steps"), since, until)).toBe(
      'steps.interval.start_time >= "2026-07-05T00:00:00.000Z" AND steps.interval.start_time < "2026-07-12T00:00:00.000Z"'
    );
  });

  // daily-* metrics compare against a bare civil date; an instant is rejected 400.
  it("compares a date-shaped metric against a KST calendar day", () => {
    expect(buildTimeFilter(byKey("resting_heart_rate"), since)).toBe(
      'daily_resting_heart_rate.date >= "2026-07-05"'
    );
  });

  it("uses the KST day, not the UTC day, for a date-shaped bound", () => {
    // 2026-07-05T16:00Z is already 2026-07-06 in KST (+9h).
    expect(buildTimeFilter(byKey("resting_heart_rate"), new Date("2026-07-05T16:00:00Z"))).toBe(
      'daily_resting_heart_rate.date >= "2026-07-06"'
    );
  });

  it("ceils a date-shaped upper bound so the partial end day isn't dropped", () => {
    // `until` is exclusive, so 07-12 itself must stay inside the window.
    expect(buildTimeFilter(byKey("resting_heart_rate"), since, until)).toBe(
      'daily_resting_heart_rate.date >= "2026-07-05" AND daily_resting_heart_rate.date < "2026-07-13"'
    );
  });
});

describe("parseSample — interval scalar metrics", () => {
  // Shape captured verbatim from the U1 live spike.
  const stepsPoint = {
    dataSource: { application: { packageName: "android" }, platform: "HEALTH_CONNECT" },
    steps: {
      interval: {
        startTime: "2026-07-10T12:25:53.472Z",
        endTime: "2026-07-10T12:26:37.977Z",
      },
      count: "70",
    },
  };

  it("reads count (string) → number, startTime → sampleAt, packageName → source", () => {
    const p = parseSample(byKey("steps"), stepsPoint);
    expect(p).not.toBeNull();
    expect(p?.value).toBe(70);
    expect(p?.sampleAt.toISOString()).toBe("2026-07-10T12:25:53.472Z");
    expect(p?.source).toBe("android");
    expect(p?.valueJson).toBeNull();
  });

  it("distance reads millimeters", () => {
    const p = parseSample(byKey("distance"), {
      dataSource: { application: { packageName: "com.sec.android.app.shealth" } },
      distance: { interval: { startTime: "2026-06-19T09:30:00Z" }, millimeters: "824450" },
    });
    expect(p?.value).toBe(824450);
    expect(p?.source).toBe("com.sec.android.app.shealth");
  });
});

describe("parseSample — instantaneous scalar metrics", () => {
  it("heart-rate reads beatsPerMinute from sampleTime.physicalTime", () => {
    const p = parseSample(byKey("heart_rate"), {
      dataSource: { application: { packageName: "com.sec.android.app.shealth" } },
      heartRate: {
        sampleTime: { physicalTime: "2026-07-07T11:26:00Z" },
        beatsPerMinute: "110",
      },
    });
    expect(p?.value).toBe(110);
    expect(p?.sampleAt.toISOString()).toBe("2026-07-07T11:26:00.000Z");
  });

  it("spo2 reads a numeric percentage", () => {
    const p = parseSample(byKey("spo2"), {
      dataSource: { application: { packageName: "com.sec.android.app.shealth" } },
      oxygenSaturation: { sampleTime: { physicalTime: "2026-03-25T23:27:00Z" }, percentage: 91 },
    });
    expect(p?.value).toBe(91);
  });

  it("vo2-max reads a float", () => {
    const p = parseSample(byKey("vo2_max"), {
      dataSource: { application: { packageName: "com.sec.android.app.shealth" } },
      vo2Max: { sampleTime: { physicalTime: "2026-04-06T14:03:24.344Z" }, vo2Max: 45.54 },
    });
    expect(p?.value).toBeCloseTo(45.54);
  });
});

describe("parseSample — date-shaped daily rollups", () => {
  // Shapes captured verbatim from the 2026-07-26 live re-probe (platform: FITBIT).
  it("anchors a civil date at 12:00 KST so it buckets into its own KST day", () => {
    const p = parseSample(byKey("resting_heart_rate"), {
      dataSource: { platform: "FITBIT" },
      dailyRestingHeartRate: {
        date: { year: 2026, month: 7, day: 27 },
        beatsPerMinute: "62",
        dailyRestingHeartRateMetadata: { calculationMethod: "ONLY_WITH_AWAKE_DATA" },
      },
    });
    expect(p?.value).toBe(62);
    // 12:00 KST on 2026-07-27 == 03:00Z — safely inside the day from either side.
    expect(p?.sampleAt.toISOString()).toBe("2026-07-27T03:00:00.000Z");
    // No packageName on Fitbit-platform points → the "unknown" source bucket.
    expect(p?.source).toBe("unknown");
  });

  it("reads the daily SpO2 average, HRV average and respiratory rate", () => {
    expect(
      parseSample(byKey("daily_spo2"), {
        dailyOxygenSaturation: {
          date: { year: 2026, month: 7, day: 25 },
          averagePercentage: 94.8,
          lowerBoundPercentage: 92.2,
        },
      })?.value
    ).toBeCloseTo(94.8);
    expect(
      parseSample(byKey("daily_hrv"), {
        dailyHeartRateVariability: {
          date: { year: 2026, month: 7, day: 26 },
          averageHeartRateVariabilityMilliseconds: 64.75,
          entropy: 3.211,
        },
      })?.value
    ).toBeCloseTo(64.75);
    expect(
      parseSample(byKey("respiratory_rate"), {
        dailyRespiratoryRate: { date: { year: 2026, month: 7, day: 25 }, breathsPerMinute: 15.4 },
      })?.value
    ).toBeCloseTo(15.4);
  });

  it("keeps the nightly skin temperature even when the baseline is the string NaN", () => {
    const p = parseSample(byKey("skin_temperature"), {
      dailySleepTemperatureDerivations: {
        date: { year: 2026, month: 7, day: 26 },
        nightlyTemperatureCelsius: 31.52571912013537,
        baselineTemperatureCelsius: "NaN",
        relativeNightlyStddev30dCelsius: "NaN",
      },
    });
    expect(p?.value).toBeCloseTo(31.5257);
  });

  it("returns null when the civil date is missing or malformed", () => {
    expect(
      parseSample(byKey("resting_heart_rate"), { dailyRestingHeartRate: { beatsPerMinute: "62" } })
    ).toBeNull();
    expect(
      parseSample(byKey("resting_heart_rate"), {
        dailyRestingHeartRate: { date: { year: 2026, month: 7 }, beatsPerMinute: "62" },
      })
    ).toBeNull();
  });
});

describe("parseSample — structured metric (valueKey: null)", () => {
  // `exercise` is deferred from HEALTH_METRICS (unfilterable), but the parser's
  // structured branch still ships, so exercise it here via a synthetic config.
  const structured: MetricConfig = {
    key: "exercise",
    dataType: "exercise",
    wrapper: "exercise",
    timeShape: "interval",
    filterField: "exercise.interval.start_time",
    valueKey: null,
    agg: "sum",
  };

  it("keeps the whole wrapper as valueJson, no scalar", () => {
    const wrapper = {
      interval: { startTime: "2026-06-19T09:30:00Z", endTime: "2026-06-19T09:41:00Z" },
      exerciseType: "WALKING",
      displayName: "걷기",
      activeDuration: "660s",
    };
    const p = parseSample(structured, {
      dataSource: { application: { packageName: "com.sec.android.app.shealth" } },
      exercise: wrapper,
    });
    expect(p?.value).toBeNull();
    expect(p?.valueJson).toEqual(wrapper);
    expect(p?.sampleAt.toISOString()).toBe("2026-06-19T09:30:00.000Z");
  });
});

describe("durationToMinutes", () => {
  it("parses protobuf Duration seconds → minutes", () => {
    expect(durationToMinutes("660s")).toBe(11);
    expect(durationToMinutes("90s")).toBe(1.5);
  });
  it("accepts a raw seconds number and a bare digit string", () => {
    expect(durationToMinutes(120)).toBe(2);
    expect(durationToMinutes("120")).toBe(2);
  });
  it("returns 0 for unparseable input", () => {
    expect(durationToMinutes("abc")).toBe(0);
    expect(durationToMinutes(undefined)).toBe(0);
    expect(durationToMinutes(null)).toBe(0);
  });
});

describe("parseExerciseWorkout", () => {
  const point = {
    dataSource: { application: { packageName: "com.sec.android.app.shealth" } },
    exercise: {
      interval: { startTime: "2026-07-11T09:30:00Z", endTime: "2026-07-11T10:12:00Z" },
      exerciseType: "BIKING",
      displayName: "자전거",
      activeDuration: "660s",
    },
  };

  it("extracts start/source/active-minutes and keeps the wrapper", () => {
    const w = parseExerciseWorkout(point);
    expect(w?.sampleAt.toISOString()).toBe("2026-07-11T09:30:00.000Z");
    expect(w?.source).toBe("com.sec.android.app.shealth");
    expect(w?.activeMinutes).toBe(11);
    expect((w?.wrapper as { displayName?: string }).displayName).toBe("자전거");
  });

  it("returns null without an exercise wrapper or start time", () => {
    expect(parseExerciseWorkout({})).toBeNull();
    expect(parseExerciseWorkout({ exercise: { exerciseType: "BIKING" } })).toBeNull();
  });

  it("falls back to 0 minutes / unknown source when fields are absent", () => {
    const w = parseExerciseWorkout({
      exercise: { interval: { startTime: "2026-07-11T09:30:00Z" } },
    });
    expect(w?.activeMinutes).toBe(0);
    expect(w?.source).toBe("unknown");
  });
});

describe("parseSleepSession", () => {
  // Shape captured verbatim from the 2026-07-26 live re-probe (platform: FITBIT).
  const point = {
    dataSource: { recordingMethod: "DERIVED", platform: "FITBIT" },
    sleep: {
      interval: {
        startTime: "2026-07-26T07:24:00Z",
        startUtcOffset: "32400s",
        endTime: "2026-07-26T10:16:00Z",
      },
      type: "STAGES",
      stages: [
        { startTime: "2026-07-26T07:24:00Z", endTime: "2026-07-26T07:38:30Z", type: "AWAKE" },
        { startTime: "2026-07-26T07:38:30Z", endTime: "2026-07-26T07:57:30Z", type: "LIGHT" },
      ],
      metadata: { stagesStatus: "OK", nap: false },
    },
  };

  it("derives duration from the interval — there is no activeDuration field", () => {
    const s = parseSleepSession(point);
    expect(s?.sampleAt.toISOString()).toBe("2026-07-26T07:24:00.000Z");
    expect(s?.activeMinutes).toBe(172); // 07:24 → 10:16
    expect(s?.source).toBe("unknown"); // Fitbit points carry no packageName
    expect((s?.wrapper as { stages?: unknown[] }).stages).toHaveLength(2);
  });

  it("returns null without a sleep wrapper or start time", () => {
    expect(parseSleepSession({})).toBeNull();
    expect(parseSleepSession({ sleep: { type: "STAGES" } })).toBeNull();
    expect(
      parseSleepSession({ sleep: { interval: { endTime: "2026-07-26T10:16:00Z" } } })
    ).toBeNull();
  });

  it("falls back to 0 minutes when the session has no end time", () => {
    expect(
      parseSleepSession({ sleep: { interval: { startTime: "2026-07-26T07:24:00Z" } } })
        ?.activeMinutes
    ).toBe(0);
  });
});

describe("parseSample — defensive / edge cases", () => {
  it("returns null when the wrapper is missing (empty {} list response)", () => {
    expect(parseSample(byKey("steps"), {})).toBeNull();
  });

  it("returns null when the timestamp is missing", () => {
    expect(parseSample(byKey("steps"), { steps: { count: "70" } })).toBeNull();
  });

  it("returns null for a scalar metric whose value is absent", () => {
    expect(
      parseSample(byKey("steps"), { steps: { interval: { startTime: "2026-07-10T12:00:00Z" } } })
    ).toBeNull();
  });

  it("returns null for a non-numeric scalar value", () => {
    expect(
      parseSample(byKey("steps"), {
        steps: { interval: { startTime: "2026-07-10T12:00:00Z" }, count: "abc" },
      })
    ).toBeNull();
  });

  it("falls back to 'unknown' source when packageName is absent", () => {
    const p = parseSample(byKey("steps"), {
      steps: { interval: { startTime: "2026-07-10T12:00:00Z" }, count: "5" },
    });
    expect(p?.source).toBe("unknown");
  });

  it("is deterministic — same point yields the same identity (idempotency precondition)", () => {
    const point = {
      dataSource: { application: { packageName: "android" } },
      steps: { interval: { startTime: "2026-07-10T12:25:53.472Z" }, count: "70" },
    };
    const a = parseSample(byKey("steps"), point);
    const b = parseSample(byKey("steps"), point);
    expect(a?.sampleAt.toISOString()).toBe(b?.sampleAt.toISOString());
    expect(a?.source).toBe(b?.source);
    expect(a?.value).toBe(b?.value);
  });
});
