import { describe, expect, it } from "vitest";
import { dedupeSessions, isAggregatorSource } from "./sessions";

/** Compact row builder — only the fields dedupeSessions reads, plus a tag to assert on. */
const row = (start: string, source: string, minutes: number, tag = "") => ({
  sampleAt: new Date(start),
  source,
  minutes,
  tag,
});

describe("isAggregatorSource", () => {
  it("flags the Withings app, which re-publishes sessions it read from Health Connect", () => {
    expect(isAggregatorSource("com.withings.wiscale2")).toBe(true);
  });

  it("does not flag measuring platforms or ordinary writer apps", () => {
    expect(isAggregatorSource("FITBIT")).toBe(false);
    expect(isAggregatorSource("com.sec.android.app.shealth")).toBe(false);
    expect(isAggregatorSource("com.google.android.apps.fitness")).toBe(false);
  });
});

describe("dedupeSessions", () => {
  it("keeps a single row per session and returns newest first", () => {
    const out = dedupeSessions([
      row("2026-07-25T09:51:03Z", "FITBIT", 42),
      row("2026-07-27T08:29:51Z", "FITBIT", 22),
      row("2026-07-26T01:34:00Z", "FITBIT", 600),
    ]);
    expect(out.map((r) => r.sampleAt.toISOString())).toEqual([
      "2026-07-27T08:29:51.000Z",
      "2026-07-26T01:34:00.000Z",
      "2026-07-25T09:51:03.000Z",
    ]);
  });

  // The real defect: com.withings.wiscale2 republished one workout at BOTH
  // 08:40:03.000 and 08:40:03.389, and the old exact-ISO key treated the 389ms gap as
  // two sessions — so a single 17-minute workout counted twice in the daily total.
  it("collapses rows whose starts differ only by sub-second precision", () => {
    const out = dedupeSessions([
      row("2026-07-23T23:40:03.000Z", "com.withings.wiscale2", 17),
      row("2026-07-23T23:40:03.389Z", "com.withings.wiscale2", 17),
      row("2026-07-23T23:40:03.389Z", "com.google.android.apps.fitness", 17),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].minutes).toBe(17);
  });

  it("prefers the measuring platform over a re-publishing aggregator", () => {
    // Same 172-minute nap from both: identical DEEP/REM minutes, so this is one
    // session re-processed — not two measurements to reconcile.
    const out = dedupeSessions([
      row("2026-07-26T07:24:00Z", "com.withings.wiscale2", 172, "withings"),
      row("2026-07-26T07:24:00Z", "FITBIT", 172, "fitbit"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe("fitbit");
  });

  it("still prefers the aggregator's copy when it is the only one", () => {
    const out = dedupeSessions([row("2026-07-26T07:24:00Z", "com.withings.wiscale2", 172)]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("com.withings.wiscale2");
  });

  it("prefers the longer duration among non-aggregator sources", () => {
    const out = dedupeSessions([
      row("2026-07-27T08:29:51Z", "com.sec.android.app.shealth", 18, "short"),
      row("2026-07-27T08:29:51Z", "com.google.android.apps.fitness", 22, "long"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe("long");
  });

  it("ranks a non-aggregator ahead of an aggregator even when the aggregator is longer", () => {
    // Duration is a weaker signal than provenance: a re-publisher padding the span
    // must not outrank the device that actually measured the session.
    const out = dedupeSessions([
      row("2026-07-27T08:29:51Z", "com.withings.wiscale2", 99, "withings"),
      row("2026-07-27T08:29:51Z", "FITBIT", 22, "fitbit"),
    ]);
    expect(out[0].tag).toBe("fitbit");
  });

  it("breaks remaining ties deterministically so the same input never reorders", () => {
    const rows = [
      row("2026-07-27T08:29:51Z", "com.sec.android.app.shealth", 15, "shealth"),
      row("2026-07-27T08:29:51Z", "com.google.android.apps.fitness", 15, "gfit"),
    ];
    const a = dedupeSessions(rows);
    const b = dedupeSessions([...rows].reverse());
    expect(a[0].tag).toBe(b[0].tag);
  });

  it("does not merge genuinely distinct sessions a second apart", () => {
    const out = dedupeSessions([
      row("2026-07-24T08:40:03Z", "FITBIT", 17),
      row("2026-07-24T08:41:17Z", "FITBIT", 15),
    ]);
    expect(out).toHaveLength(2);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupeSessions([])).toEqual([]);
  });
});
