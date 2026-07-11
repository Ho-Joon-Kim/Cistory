import { describe, expect, it } from "vitest";
import { CURATED_METRICS } from "./metrics-meta";
import {
  buildTimeFilter,
  HEALTH_METRICS,
  isHealthTokenFresh,
  type MetricConfig,
  parseSample,
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

  it("interval metrics filter on start_time, sampleTime metrics on physical_time", () => {
    for (const m of HEALTH_METRICS) {
      if (m.timeShape === "interval") {
        expect(m.filterField).toContain(".interval.start_time");
      } else {
        expect(m.filterField).toContain(".sample_time.physical_time");
      }
      // filter fields are snake_case only (spike: camelCase / hyphen → 400)
      expect(m.filterField).not.toMatch(/[A-Z]/);
      expect(m.filterField).not.toContain("-");
    }
  });

  it("marks steps/distance as sum and heart_rate as avg", () => {
    expect(byKey("steps").agg).toBe("sum");
    expect(byKey("distance").agg).toBe("sum");
    expect(byKey("heart_rate").agg).toBe("avg");
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
