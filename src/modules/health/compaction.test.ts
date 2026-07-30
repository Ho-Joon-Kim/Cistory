import { describe, expect, it } from "vitest";
import { bucketByMinute, bucketStats, type RawScalarSample } from "./compaction";

const s = (at: string, value: number, source = "FITBIT"): RawScalarSample => ({
  sampleAt: new Date(at),
  source,
  value,
});

describe("bucketByMinute", () => {
  it("collapses one minute of samples into a single bucket carrying its bounds", () => {
    const out = bucketByMinute([
      s("2026-07-28T10:00:02Z", 70),
      s("2026-07-28T10:00:05Z", 74),
      s("2026-07-28T10:00:58Z", 72),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].minuteAt.toISOString()).toBe("2026-07-28T10:00:00.000Z");
    expect(out[0].mean).toBe(72);
    expect(out[0].min).toBe(70);
    expect(out[0].max).toBe(74);
    expect(out[0].n).toBe(3);
  });

  // The whole point of keeping bounds: /health draws a daily min-max range bar, so a
  // bucket that stored only its mean would visibly shrink every day's HR range.
  it("preserves the extremes that a mean alone would erase", () => {
    const out = bucketByMinute([s("2026-07-28T10:00:00Z", 60), s("2026-07-28T10:00:30Z", 180)]);
    expect(out[0].mean).toBe(120);
    expect(out[0].min).toBe(60);
    expect(out[0].max).toBe(180);
  });

  it("splits samples across minute boundaries", () => {
    const out = bucketByMinute([s("2026-07-28T10:00:59Z", 70), s("2026-07-28T10:01:00Z", 90)]);
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.minuteAt.toISOString())).toEqual([
      "2026-07-28T10:00:00.000Z",
      "2026-07-28T10:01:00.000Z",
    ]);
  });

  it("keeps sources separate — they are distinct sample identities, not one series", () => {
    const out = bucketByMinute([
      s("2026-07-28T10:00:02Z", 70, "FITBIT"),
      s("2026-07-28T10:00:05Z", 100, "com.sec.android.app.shealth"),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.source).sort()).toEqual(["FITBIT", "com.sec.android.app.shealth"]);
    for (const b of out) expect(b.n).toBe(1);
  });

  it("returns buckets in chronological order regardless of input order", () => {
    const out = bucketByMinute([
      s("2026-07-28T10:02:00Z", 80),
      s("2026-07-28T10:00:00Z", 70),
      s("2026-07-28T10:01:00Z", 75),
    ]);
    expect(out.map((b) => b.mean)).toEqual([70, 75, 80]);
  });

  it("is exactly reversible in aggregate — bucket means reweighted by n recover the true mean", () => {
    const raw = [
      s("2026-07-28T10:00:00Z", 60),
      s("2026-07-28T10:00:10Z", 62),
      s("2026-07-28T10:00:20Z", 64),
      s("2026-07-28T10:01:00Z", 150),
    ];
    const out = bucketByMinute(raw);
    const weighted =
      out.reduce((acc, b) => acc + b.mean * b.n, 0) / out.reduce((a, b) => a + b.n, 0);
    const trueMean = raw.reduce((a, r) => a + r.value, 0) / raw.length;
    expect(weighted).toBeCloseTo(trueMean, 10);
    // ...and the daily extremes survive untouched.
    expect(Math.min(...out.map((b) => b.min))).toBe(60);
    expect(Math.max(...out.map((b) => b.max))).toBe(150);
  });

  it("handles a single sample and an empty input", () => {
    expect(bucketByMinute([s("2026-07-28T10:00:02Z", 70)])).toEqual([
      {
        minuteAt: new Date("2026-07-28T10:00:00Z"),
        source: "FITBIT",
        mean: 70,
        min: 70,
        max: 70,
        n: 1,
      },
    ]);
    expect(bucketByMinute([])).toEqual([]);
  });
});

describe("bucketStats", () => {
  it("reports a raw sample as standing for itself", () => {
    expect(bucketStats(null, 72)).toEqual({ min: 72, max: 72, n: 1 });
  });

  it("reads a bucket's stored bounds and weight", () => {
    expect(bucketStats({ min: 60, max: 180, n: 26 }, 72)).toEqual({ min: 60, max: 180, n: 26 });
  });

  // A sleep/exercise wrapper is also value_json but carries none of these keys, so it
  // must fall through to the row's own value rather than yield NaN.
  it("falls through for a value_json that is not a bucket", () => {
    expect(bucketStats({ stages: [], type: "STAGES" }, 172)).toEqual({
      min: 172,
      max: 172,
      n: 1,
    });
  });

  it("ignores non-numeric or non-finite fields", () => {
    expect(bucketStats({ min: "60", max: null, n: Number.NaN }, 72)).toEqual({
      min: 72,
      max: 72,
      n: 1,
    });
  });

  it("never lets a bucket weigh zero, which would erase it from a weighted mean", () => {
    expect(bucketStats({ min: 60, max: 80, n: 0 }, 70).n).toBe(1);
  });
});
