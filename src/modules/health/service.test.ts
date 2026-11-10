import { describe, expect, it } from "vitest";
import {
  CURATED_METRIC_KEYS,
  CURATED_METRICS,
  mergeDailySeries,
  metricSourceKeys,
} from "./metrics-meta";
import {
  buildTimeFilter,
  durationToMinutes,
  HEALTH_METRICS,
  isHealthTokenFresh,
  type MetricConfig,
  parseExerciseWorkout,
  parsePoint,
  parseRollupPoint,
  parseSample,
  parseSleepSession,
  rollupDayRange,
  SESSION_CONFIGS,
  SYNCED_METRICS,
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
      // Rollup-only types never build a `list` filter (list → 400 for them).
      if (m.fetch === "dailyRollUp") {
        expect(m.filterField, m.key).toBe("");
        continue;
      }
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

  // Design §2b/§Risks: the API default `all-sources` SUMS overlapping sources, so a
  // rollup metric without an explicit family silently ~doubles. Pin the family.
  it("every rollup metric pins the google-wearables family and a value key", () => {
    const rollups = HEALTH_METRICS.filter((m) => m.fetch === "dailyRollUp");
    expect(rollups.map((m) => m.key).sort()).toEqual(["floors", "total_calories"]);
    for (const m of rollups) {
      expect(m.rollupFamily, m.key).toBe("google-wearables");
      expect(m.valueKey, m.key).toBeTruthy();
      expect(m.timeShape, m.key).toBe("date");
      expect(m.agg, m.key).toBe("sum");
    }
  });

  it("includes the 2026 list-based types with verified wrappers and value keys", () => {
    expect(byKey("daily_vo2_max")).toMatchObject({
      dataType: "daily-vo2-max",
      wrapper: "dailyVo2Max",
      valueKey: "vo2Max",
      timeShape: "date",
    });
    expect(byKey("run_vo2_max").filterField).toBe("run_vo2_max.sample_time.physical_time");
    expect(byKey("core_body_temperature").valueKey).toBe("temperatureCelsius");
    expect(byKey("blood_glucose").valueKey).toBe("bloodGlucoseMilligramsPerDeciliter");
  });

  // Decision §6/§12: Withings owns body composition — never sync these from Google.
  it("does not sync weight, body-fat or height", () => {
    const types = HEALTH_METRICS.map((m) => m.dataType);
    for (const t of ["weight", "body-fat", "height"]) expect(types).not.toContain(t);
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
      for (const key of metricSourceKeys(m)) {
        const config = HEALTH_METRICS.find((h) => h.key === key);
        expect(config, `curated metric ${m.key} source ${key} must exist`).toBeDefined();
        expect(m.agg, key).toBe(config?.agg);
      }
    }
  });

  it("mergeDailySeries takes each day from the first series that has it, never blending", () => {
    const merged = mergeDailySeries([
      [
        { day: "2026-11-02", v: 45 },
        { day: "2026-11-03", v: 46 },
      ],
      [
        { day: "2026-11-01", v: 40 },
        { day: "2026-11-02", v: 41 },
      ],
    ]);
    expect(merged).toEqual([
      { day: "2026-11-01", v: 40 },
      { day: "2026-11-02", v: 45 },
      { day: "2026-11-03", v: 46 },
    ]);
  });

  it("merges Fitbit daily-vo2-max into the VO₂max card ahead of the Samsung series", () => {
    const vo2 = CURATED_METRICS.find((m) => m.key === "vo2_max");
    expect(vo2 && metricSourceKeys(vo2)).toEqual(["daily_vo2_max", "vo2_max"]);
    expect(CURATED_METRIC_KEYS).toContain("daily_vo2_max");
    expect(CURATED_METRIC_KEYS).toContain("total_calories");
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

// sleep/exercise used to be read unfiltered under a 10-page cap, which silently
// dropped every workout past the newest ~250. The 2026-11-09 probe found the filter
// fields they DO accept (`*.interval.start_time` alone is the one rejected 400).
describe("session configs — time-windowed filters", () => {
  const session = (key: string): MetricConfig => {
    const c = SESSION_CONFIGS.find((m) => m.key === key);
    if (!c) throw new Error(`no session config for ${key}`);
    return c;
  };
  const since = new Date("2026-07-05T00:00:00.000Z"); // 2026-07-05 09:00 KST
  const until = new Date("2026-07-12T00:00:00.000Z"); // 2026-07-12 09:00 KST

  it("filters on the verified fields, never the rejected start_time", () => {
    expect(session("sleep").filterField).toBe("sleep.interval.end_time");
    expect(session("sleep").timeShape).toBe("interval");
    expect(session("exercise").filterField).toBe("exercise.interval.civil_start_time");
    expect(session("exercise").timeShape).toBe("civilInterval");
    for (const c of SESSION_CONFIGS) {
      expect(c.filterField).not.toMatch(/\.start_time$/);
      // revisable → DO UPDATE: sessions are reprocessed after we first read them
      expect(c.revisable, c.key).toBe(true);
      expect(c.forwardOverlapMs, c.key).toBeGreaterThan(0);
    }
  });

  it("is walked by the forward sync + backfill but kept out of HEALTH_METRICS", () => {
    const keys = SYNCED_METRICS.map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["sleep", "exercise", "steps"]));
    expect(new Set(keys).size).toBe(keys.length);
    expect(HEALTH_METRICS.some((m) => m.key === "sleep" || m.key === "exercise")).toBe(false);
  });

  it("sleep uses a physical RFC 3339 end_time bound", () => {
    expect(buildTimeFilter(session("sleep"), since)).toBe(
      'sleep.interval.end_time >= "2026-07-05T00:00:00.000Z"'
    );
    expect(buildTimeFilter(session("sleep"), since, until)).toBe(
      'sleep.interval.end_time >= "2026-07-05T00:00:00.000Z" AND sleep.interval.end_time < "2026-07-12T00:00:00.000Z"'
    );
  });

  // civil_start_time is the DEVICE's local wall clock, which isn't always KST
  // (travel), so the KST-day window is padded by a whole day on each side.
  it("exercise uses a civil day string, padded one day on each side", () => {
    expect(buildTimeFilter(session("exercise"), since)).toBe(
      'exercise.interval.civil_start_time >= "2026-07-04"'
    );
    // until = 07-12 09:00 KST → ceil to 07-13 → pad to 07-14
    expect(buildTimeFilter(session("exercise"), since, until)).toBe(
      'exercise.interval.civil_start_time >= "2026-07-04" AND exercise.interval.civil_start_time < "2026-07-14"'
    );
  });

  it("exercise: a bound exactly at KST midnight is not ceiled, only padded", () => {
    const kstMidnight = new Date("2026-07-11T15:00:00.000Z"); // 2026-07-12 00:00 KST
    expect(buildTimeFilter(session("exercise"), kstMidnight, kstMidnight)).toBe(
      'exercise.interval.civil_start_time >= "2026-07-11" AND exercise.interval.civil_start_time < "2026-07-13"'
    );
  });

  it("adjacent backfill chunks overlap rather than leave a gap", () => {
    const mid = new Date("2026-07-08T20:00:00.000Z");
    const older = buildTimeFilter(session("exercise"), since, mid);
    const newer = buildTimeFilter(session("exercise"), mid, until);
    const upperOfOlder = older.match(/< "([\d-]+)"/)![1];
    const lowerOfNewer = newer.match(/>= "([\d-]+)"/)![1];
    expect(lowerOfNewer < upperOfOlder).toBe(true);
  });

  it("parses a session into duration minutes + the whole wrapper", () => {
    const exercise = {
      interval: { startTime: "2026-06-19T09:30:00Z", endTime: "2026-06-19T09:41:00Z" },
      exerciseType: "WALKING",
      activeDuration: "660s",
    };
    const e = parseSample(session("exercise"), { dataSource: { platform: "FITBIT" }, exercise });
    expect(e).toEqual({
      sampleAt: new Date("2026-06-19T09:30:00Z"),
      source: "FITBIT",
      value: 11,
      valueJson: exercise,
    });
    const sleep = {
      interval: { startTime: "2026-07-26T07:24:00Z", endTime: "2026-07-26T10:16:00Z" },
      stages: [],
    };
    const n = parseSample(session("sleep"), { dataSource: { platform: "FITBIT" }, sleep });
    expect(n?.value).toBe(172);
    expect(n?.valueJson).toEqual(sleep);
    expect(parseSample(session("sleep"), {})).toBeNull();
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
    // No packageName on Fitbit-platform points → the platform identifies them.
    expect(p?.source).toBe("FITBIT");
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
  // The generic structured branch (no parsePoint), via a synthetic config.
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
    expect((w!.wrapper as { displayName?: string }).displayName).toBe("자전거");
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
    expect(s?.source).toBe("FITBIT"); // no packageName → the platform identifies it
    expect((s!.wrapper as { stages?: unknown[] }).stages).toHaveLength(2);
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

// `source` is part of the sample identity (user, metric, sampleAt, source), so what
// we resolve it to is a storage contract, not a label. Fitbit-native points carry NO
// `application.packageName` — only `platform` + `recordingMethod` — so without the
// platform fallback every wrist-measured row lands in one opaque "unknown" bucket
// shared with genuinely unattributable data, and the /health read paths can't tell
// the measuring platform from a re-publishing aggregator app (com.withings.wiscale2).
describe("sample source resolution", () => {
  const at = { interval: { startTime: "2026-07-10T12:00:00Z" }, count: "5" };

  it("prefers the writing app's package name when present", () => {
    const p = parseSample(byKey("steps"), {
      dataSource: { application: { packageName: "com.withings.wiscale2" }, platform: "FITBIT" },
      steps: at,
    });
    expect(p?.source).toBe("com.withings.wiscale2");
  });

  it("falls back to the platform when no package name is present", () => {
    const p = parseSample(byKey("steps"), {
      dataSource: { platform: "FITBIT", recordingMethod: "PASSIVELY_MEASURED" },
      steps: at,
    });
    expect(p?.source).toBe("FITBIT");
  });

  it("applies the same precedence to sleep and exercise sessions", () => {
    const sleep = parseSleepSession({
      dataSource: { platform: "FITBIT" },
      sleep: { interval: { startTime: "2026-07-26T07:24:00Z", endTime: "2026-07-26T10:16:00Z" } },
    });
    expect(sleep?.source).toBe("FITBIT");

    const ex = parseExerciseWorkout({
      dataSource: { platform: "FITBIT" },
      exercise: { interval: { startTime: "2026-07-26T09:00:00Z" }, activeDuration: "600s" },
    });
    expect(ex?.source).toBe("FITBIT");
  });

  it("stays 'unknown' when the payload carries no attribution at all", () => {
    expect(parseSample(byKey("steps"), { steps: at })?.source).toBe("unknown");
    expect(parseSample(byKey("steps"), { dataSource: {}, steps: at })?.source).toBe("unknown");
  });

  it("ignores non-string attribution rather than stringifying it", () => {
    const p = parseSample(byKey("steps"), {
      dataSource: { application: { packageName: 42 }, platform: { name: "FITBIT" } },
      steps: at,
    });
    expect(p?.source).toBe("unknown");
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

describe("parseRollupPoint (dailyRollUp shape, live-verified 2026-11-09)", () => {
  const totalCalories = byKey("total_calories");
  const point = (kcal: unknown) => ({
    civilStartTime: { date: { year: 2026, month: 11, day: 9 }, time: {} },
    civilEndTime: { date: { year: 2026, month: 11, day: 10 }, time: {} },
    totalCalories: { kcalSum: kcal },
  });

  it("reads a numeric kcalSum and anchors the civil day at 12:00 KST", () => {
    const s = parseRollupPoint(totalCalories, point(2104.5));
    expect(s?.value).toBe(2104.5);
    expect(s?.sampleAt.toISOString()).toBe("2026-11-09T03:00:00.000Z");
    // Rollups carry no dataSource; the source names the family instead.
    expect(s?.source).toBe("rollup:google-wearables");
    expect(s?.valueJson).toBeNull();
  });

  it("accepts a numeric-string sum (steps.countSum arrives as a string)", () => {
    const steps = { ...totalCalories, key: "x", wrapper: "steps", valueKey: "countSum" };
    const s = parseRollupPoint(steps, {
      civilStartTime: { date: { year: 2026, month: 1, day: 2 } },
      steps: { countSum: "8123" },
    });
    expect(s?.value).toBe(8123);
  });

  it("drops a point with no civil date or no value (a 0 is kept)", () => {
    expect(parseRollupPoint(totalCalories, { totalCalories: { kcalSum: 1 } })).toBeNull();
    expect(parseRollupPoint(totalCalories, point(undefined))).toBeNull();
    expect(parseRollupPoint(totalCalories, point("NaN"))).toBeNull();
    expect(parseRollupPoint(totalCalories, point(0))?.value).toBe(0);
  });

  it("parsePoint dispatches by fetch mode", () => {
    expect(parsePoint(totalCalories, point(10))?.source).toBe("rollup:google-wearables");
    expect(
      parsePoint(byKey("heart_rate"), {
        dataSource: { platform: "FITBIT" },
        heartRate: { sampleTime: { physicalTime: "2026-11-09T00:00:00Z" }, beatsPerMinute: 61 },
      })?.value
    ).toBe(61);
  });
});

describe("parseSample — new list types", () => {
  it("reads daily-vo2-max by civil date", () => {
    const s = parseSample(byKey("daily_vo2_max"), {
      dataSource: { platform: "FITBIT" },
      dailyVo2Max: {
        date: { year: 2026, month: 11, day: 1 },
        vo2Max: 44.2,
        cardioFitnessLevel: "GOOD",
      },
    });
    expect(s?.value).toBe(44.2);
    expect(s?.sampleAt.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });

  it("reads blood glucose from its sample time", () => {
    const s = parseSample(byKey("blood_glucose"), {
      dataSource: { platform: "HEALTH_CONNECT", application: { packageName: "com.cgm" } },
      bloodGlucose: {
        sampleTime: { physicalTime: "2026-11-01T01:02:03Z" },
        bloodGlucoseMilligramsPerDeciliter: 101,
        mealType: "BREAKFAST",
      },
    });
    expect(s).toMatchObject({ value: 101, source: "com.cgm" });
  });
});

describe("rollupDayRange", () => {
  it("floors the start and ceils a partial end day (KST)", () => {
    // 2026-11-02T15:30Z = 11-03 00:30 KST; 2026-11-05T03:00Z = 11-05 12:00 KST
    expect(
      rollupDayRange(new Date("2026-11-02T15:30:00Z"), new Date("2026-11-05T03:00:00Z"))
    ).toEqual({ startKey: "2026-11-03", endKeyExclusive: "2026-11-06" });
  });

  it("keeps an end exactly at KST midnight exclusive", () => {
    expect(
      rollupDayRange(new Date("2026-11-02T15:00:00Z"), new Date("2026-11-04T15:00:00Z"))
    ).toEqual({ startKey: "2026-11-03", endKeyExclusive: "2026-11-05" });
  });
});
