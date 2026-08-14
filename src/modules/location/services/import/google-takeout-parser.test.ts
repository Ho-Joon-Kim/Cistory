import { Readable } from "node:stream";
import { createGunzip, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseGoogleTakeout, streamGoogleTakeout } from "./google-takeout-parser";
import type { ParsedPoint } from "./types";

/**
 * Characterization tests for the Google Takeout parser.
 *
 * Written against stream-json 2.1.0 / stream-chain 3.6.1 and made to pass
 * BEFORE those were upgraded to 3.5.0 / 4.2.5, so that behavioral drift
 * introduced by the upgrade surfaced here instead of in production. It did
 * catch one: see the note in the "truncated input" block. Every other
 * assertion held unchanged across the major bump.
 *
 * They pin what the parser does today, not what it ideally should do. Several
 * assertions record rough edges on purpose — an empty stream throws rather
 * than yielding nothing, truncated input throws after yielding what it got,
 * and destroying the source without a reason hangs. Changing those behaviors
 * is a separate decision from upgrading the dependency; this file only makes
 * sure the change is noticed.
 */

function sourceOf(...chunks: string[]): Readable {
  return Readable.from(chunks);
}

/** A source that only produces the next chunk once the previous one is consumed. */
function slowSourceOf(chunks: string[]): Readable {
  return Readable.from(
    (async function* () {
      for (const chunk of chunks) {
        await new Promise((resolve) => setImmediate(resolve));
        yield chunk;
      }
    })()
  );
}

/** Wait until `predicate` holds, or give up after ~500ms. */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function collect(source: Readable): Promise<ParsedPoint[]> {
  const out: ParsedPoint[] = [];
  for await (const point of streamGoogleTakeout(source)) out.push(point);
  return out;
}

/** Run the stream to exhaustion, returning both the points and any thrown error. */
async function collectSettled(
  source: Readable
): Promise<{ points: ParsedPoint[]; error: Error | null }> {
  const points: ParsedPoint[] = [];
  try {
    for await (const point of streamGoogleTakeout(source)) points.push(point);
  } catch (e) {
    return { points, error: e as Error };
  }
  return { points, error: null };
}

const RECORDS_JSON = JSON.stringify({
  locations: [
    {
      latitudeE7: 375665000,
      longitudeE7: 1269780000,
      timestamp: "2026-01-02T03:04:05Z",
      altitude: 42,
      velocity: 1.5,
      accuracy: 12,
    },
    // Epoch millis as a number.
    { latitudeE7: 374000000, longitudeE7: 1270000000, timestampMs: 1767322800000 },
    // Dropped: no coordinates.
    { timestamp: "2026-01-02T05:00:00Z" },
    // Dropped: no usable timestamp.
    { latitudeE7: 370000000, longitudeE7: 1260000000 },
  ],
});

const SEGMENTS_JSON = JSON.stringify({
  semanticSegments: [
    {
      startTime: "2026-02-03T10:00:00Z",
      timelinePath: [
        { point: "37.5665°, 126.9780°", time: "2026-02-03T10:01:00Z" },
        // No own time -> falls back to the segment's startTime.
        { point: "geo:37.5700,126.9800" },
      ],
    },
    {
      startTime: "2026-02-03T12:00:00Z",
      visit: { topCandidate: { placeLocation: { latLng: "37.5000°, 127.0000°" } } },
    },
    {
      startTime: "2026-02-03T14:00:00Z",
      activity: {
        start: { latLng: "37.1000°, 127.1000°", timestamp: "2026-02-03T14:00:00Z" },
        end: { latLng: "37.2000°, 127.2000°", time: "2026-02-03T14:30:00Z" },
      },
    },
  ],
});

const RAW_SIGNALS_JSON = JSON.stringify({
  rawSignals: [
    {
      position: {
        LatLng: "37.5665°, 126.9780°",
        timestamp: "2026-03-04T01:00:00Z",
        accuracyMeters: 8,
        altitudeMeters: 30,
        speedMetersPerSecond: 2.5,
      },
    },
    // accuracyMm converts to metres; altitude/velocity fall back to the aliases.
    // A bare-seconds epoch (< 1e10) is multiplied up to millis.
    {
      position: {
        latLng: "geo:37.4000,127.4000",
        timestamp: 1772582400,
        accuracyMm: 4500,
        altitude: 11,
        velocity: 0.5,
      },
    },
    // Skipped: not a position signal.
    { wifiScan: { accessPoints: [] } },
  ],
});

/** Three complete `locations` entries — used to build truncated prefixes. */
const THREE_RECORDS = JSON.stringify({
  locations: [
    { latitudeE7: 375665000, longitudeE7: 1269780000, timestamp: "2026-01-02T03:04:05Z" },
    { latitudeE7: 374000000, longitudeE7: 1270000000, timestamp: "2026-01-02T04:04:05Z" },
    { latitudeE7: 373000000, longitudeE7: 1271000000, timestamp: "2026-01-02T05:04:05Z" },
  ],
});

/** Byte offset just past the closing brace of the entry carrying `marker`. */
function offsetAfterEntry(doc: string, marker: string): number {
  return doc.indexOf("}", doc.indexOf(marker)) + 1;
}

const SLOW_CHUNKS = [
  '{"locations":[',
  '{"latitudeE7":375665000,"longitudeE7":1269780000,"timestamp":"2026-01-02T03:04:05Z"},',
  '{"latitudeE7":374000000,"longitudeE7":1270000000,"timestamp":"2026-01-02T04:04:05Z"},',
  '{"latitudeE7":373000000,"longitudeE7":1271000000,"timestamp":"2026-01-02T05:04:05Z"}',
  "]}",
];

describe("parseGoogleTakeout (whole-document path)", () => {
  it("parses Records.json entries and drops incomplete ones", () => {
    expect(parseGoogleTakeout(JSON.parse(RECORDS_JSON))).toEqual([
      {
        lat: 37.4,
        lon: 127,
        altitude: null,
        velocity: null,
        accuracy: null,
        timestamp: new Date(1767322800000),
      },
      {
        lat: 37.5665,
        lon: 126.978,
        altitude: 42,
        velocity: 1.5,
        accuracy: 12,
        timestamp: new Date("2026-01-02T03:04:05Z"),
      },
    ]);
  });

  it("drops a Records.json entry whose timestampMs is a string, not a number", () => {
    // Real Google exports have shipped `timestampMs` as a decimal string.
    // parseTimestamp only feeds strings to `new Date(...)`, which rejects
    // "1767322800000", so such an entry is silently dropped today.
    expect(
      parseGoogleTakeout({
        locations: [
          { latitudeE7: 375665000, longitudeE7: 1269780000, timestampMs: "1767322800000" },
        ],
      })
    ).toEqual([]);
  });

  it("parses semanticSegments (timelinePath, visit, activity), sorted by time", () => {
    expect(
      parseGoogleTakeout(JSON.parse(SEGMENTS_JSON)).map((p) => [
        p.lat,
        p.lon,
        p.timestamp.toISOString(),
      ])
    ).toEqual([
      [37.57, 126.98, "2026-02-03T10:00:00.000Z"],
      [37.5665, 126.978, "2026-02-03T10:01:00.000Z"],
      [37.5, 127, "2026-02-03T12:00:00.000Z"],
      [37.1, 127.1, "2026-02-03T14:00:00.000Z"],
      [37.2, 127.2, "2026-02-03T14:30:00.000Z"],
    ]);
  });

  it("parses rawSignals, converting accuracyMm to metres and epoch seconds to millis", () => {
    expect(parseGoogleTakeout(JSON.parse(RAW_SIGNALS_JSON))).toEqual([
      {
        lat: 37.4,
        lon: 127.4,
        altitude: 11,
        velocity: 0.5,
        accuracy: 4.5,
        timestamp: new Date(1772582400 * 1000),
      },
      {
        lat: 37.5665,
        lon: 126.978,
        altitude: 30,
        velocity: 2.5,
        accuracy: 8,
        timestamp: new Date("2026-03-04T01:00:00Z"),
      },
    ]);
  });

  it("returns an empty array for a document with no known top-level key", () => {
    expect(parseGoogleTakeout({ somethingElse: [1, 2, 3] })).toEqual([]);
  });
});

describe("streamGoogleTakeout — well-formed input", () => {
  it("yields the same Records.json points as the whole-document parser", async () => {
    const streamed = await collect(sourceOf(RECORDS_JSON));
    // Same set; streaming emits in document order and never sorts.
    expect([...streamed].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())).toEqual(
      parseGoogleTakeout(JSON.parse(RECORDS_JSON))
    );
  });

  it("yields semanticSegments points in document order", async () => {
    const streamed = await collect(sourceOf(SEGMENTS_JSON));
    expect(streamed.map((p) => [p.lat, p.lon, p.timestamp.toISOString()])).toEqual([
      [37.5665, 126.978, "2026-02-03T10:01:00.000Z"],
      [37.57, 126.98, "2026-02-03T10:00:00.000Z"],
      [37.5, 127, "2026-02-03T12:00:00.000Z"],
      [37.1, 127.1, "2026-02-03T14:00:00.000Z"],
      [37.2, 127.2, "2026-02-03T14:30:00.000Z"],
    ]);
  });

  it("yields rawSignals points", async () => {
    const streamed = await collect(sourceOf(RAW_SIGNALS_JSON));
    expect(streamed.map((p) => [p.lat, p.lon, p.accuracy, p.altitude, p.velocity])).toEqual([
      [37.5665, 126.978, 8, 30, 2.5],
      [37.4, 127.4, 4.5, 11, 0.5],
    ]);
  });

  it("does not care how the document is split across chunks", async () => {
    const halfway = Math.floor(RECORDS_JSON.length / 2);
    const split = await collect(
      sourceOf(RECORDS_JSON.slice(0, halfway), RECORDS_JSON.slice(halfway))
    );
    expect(split).toEqual(await collect(sourceOf(RECORDS_JSON)));
  });

  it("only picks the three known top-level arrays, not same-named nested ones", async () => {
    const doc = JSON.stringify({
      metadata: {
        version: 1,
        locations: [
          { latitudeE7: 100000000, longitudeE7: 200000000, timestamp: "2026-01-01T00:00:00Z" },
        ],
      },
      locations: [
        { latitudeE7: 375665000, longitudeE7: 1269780000, timestamp: "2026-01-02T03:04:05Z" },
      ],
    });
    const points = await collect(sourceOf(doc));
    expect(points).toHaveLength(1);
    expect(points[0].lat).toBeCloseTo(37.5665, 6);
  });

  it("emits in document order without sorting (unlike parseGoogleTakeout)", async () => {
    const doc = JSON.stringify({
      locations: [
        { latitudeE7: 370000000, longitudeE7: 1270000000, timestamp: "2026-01-03T00:00:00Z" },
        { latitudeE7: 380000000, longitudeE7: 1280000000, timestamp: "2026-01-01T00:00:00Z" },
      ],
    });
    expect((await collect(sourceOf(doc))).map((p) => p.timestamp.toISOString())).toEqual([
      "2026-01-03T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("streams a realistically sized gzipped document to completion", async () => {
    const doc = JSON.stringify({
      locations: Array.from({ length: 5000 }, (_, i) => ({
        latitudeE7: 375665000 + i,
        longitudeE7: 1269780000 + i,
        timestamp: new Date(Date.UTC(2026, 0, 2) + i * 1000).toISOString(),
        accuracy: 10 + (i % 30),
      })),
    });
    // Mirrors the import route's openDecoded(): raw bytes piped through gunzip.
    const gunzip = createGunzip();
    const rawErrors: string[] = [];
    const gunzipErrors: string[] = [];
    const raw = Readable.from([gzipSync(Buffer.from(doc, "utf-8"))]);
    raw.on("error", (e: NodeJS.ErrnoException) => rawErrors.push(String(e.code ?? e.message)));
    gunzip.on("error", (e: NodeJS.ErrnoException) =>
      gunzipErrors.push(String(e.code ?? e.message))
    );

    const points = await collect(raw.pipe(gunzip));

    expect(points).toHaveLength(5000);
    expect(points[0].lat).toBeCloseTo(37.5665, 6);
    expect(points[4999].timestamp.toISOString()).toBe(
      new Date(Date.UTC(2026, 0, 2) + 4999 * 1000).toISOString()
    );
    expect(rawErrors).toEqual([]);
    expect(gunzipErrors).toEqual([]);
  });
});

describe("streamGoogleTakeout — empty and degenerate input", () => {
  // NOTE: an empty stream does NOT yield an empty result — stream-json's parser
  // rejects a zero-byte document. The import route never reaches this path with
  // an empty file (format detection rejects it first), so this is pinned as-is.
  it("throws rather than yielding nothing for a zero-byte stream", async () => {
    const { points, error } = await collectSettled(sourceOf());
    expect(points).toEqual([]);
    expect(error?.message).toBe("Parser has expected a value");
  });

  it("throws for a stream carrying only an empty string chunk", async () => {
    const { points, error } = await collectSettled(sourceOf(""));
    expect(points).toEqual([]);
    expect(error?.message).toBe("Parser has expected a value");
  });

  it("yields nothing, without throwing, for an empty JSON object", async () => {
    expect(await collectSettled(sourceOf("{}"))).toEqual({ points: [], error: null });
  });

  it("yields nothing, without throwing, for an empty locations array", async () => {
    expect(await collectSettled(sourceOf('{"locations":[]}'))).toEqual({
      points: [],
      error: null,
    });
  });

  it("yields nothing, without throwing, for an unknown top-level key", async () => {
    expect(await collectSettled(sourceOf('{"somethingElse":[1,2,3]}'))).toEqual({
      points: [],
      error: null,
    });
  });
});

describe("streamGoogleTakeout — truncated input", () => {
  // A prefix containing N complete array entries yields all N points, then
  // throws on the unterminated remainder.
  //
  // CHANGED BY THE stream-json 2.1.0 -> 3.5.0 UPGRADE. Under 2.1.0 the decoder
  // lagged exactly one entry behind the bytes it had seen — an entry was only
  // released once the following token arrived — so these same prefixes yielded
  // N-1 points (0 and 1 respectively). 3.5.0 releases an entry as soon as its
  // closing brace is read. This is the only behavioral difference the upgrade
  // produced; the thrown error types and messages are byte-identical, and a
  // truncated import now recovers one more point than it used to.
  it.each([
    ["cut just after the 1st entry", '"2026-01-02T03:04:05Z"', 1],
    ["cut just after the 2nd entry", '"2026-01-02T04:04:05Z"', 2],
  ])("%s yields the entries released so far, then throws", async (_label, marker, expected) => {
    const cut = offsetAfterEntry(THREE_RECORDS, marker);
    const { points, error } = await collectSettled(sourceOf(THREE_RECORDS.slice(0, cut)));
    expect(points).toHaveLength(expected);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/^Parser cannot parse input/);
  });

  it("yields the released entries when the cut lands mid-way through a later entry", async () => {
    const cut = offsetAfterEntry(THREE_RECORDS, '"2026-01-02T04:04:05Z"') + 30;
    const { points, error } = await collectSettled(sourceOf(THREE_RECORDS.slice(0, cut)));
    expect(points.map((p) => p.timestamp.toISOString())).toEqual([
      "2026-01-02T03:04:05.000Z",
      "2026-01-02T04:04:05.000Z",
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/^Parser has expected/);
  });

  it("yields nothing and throws when the cut lands inside the first entry", async () => {
    const { points, error } = await collectSettled(
      sourceOf('{"locations":[{"latitudeE7":375665000,"longitudeE7":1269')
    );
    expect(points).toEqual([]);
    expect(error?.message).toMatch(/^Parser cannot parse input/);
  });
});

describe("streamGoogleTakeout — abort paths", () => {
  // Scope note. What this suite pins is the parser half: calling
  // `pipeline.destroy()` from the generator's `finally` tears the source down
  // without surfacing anything to the caller, and — measured on both
  // stream-json 2.1.0 and 3.5.0 — without the source emitting ABORT_ERR or
  // ERR_STREAM_PREMATURE_CLOSE at all, including over a real
  // Readable.pipe(createGunzip()) chain.
  //
  // What it does NOT pin is the import route's openDecoded() suppression
  // (route.ts). Replaying that route's parse path over real gzipped fixtures
  // showed its benign-error listener does fire with ABORT_ERR — but from
  // readSniffPrefix()'s own `src.destroy()` after the 4KB sniff, not from this
  // parser. So that listener is load-bearing for a reason this file cannot
  // reach, and removing it on the strength of these tests would be wrong.
  it("destroys the source when the consumer stops iterating early, silently", async () => {
    const source = slowSourceOf(SLOW_CHUNKS);
    const sourceErrors: NodeJS.ErrnoException[] = [];
    source.on("error", (e: NodeJS.ErrnoException) => sourceErrors.push(e));

    const seen: ParsedPoint[] = [];
    for await (const point of streamGoogleTakeout(source)) {
      seen.push(point);
      break;
    }
    await until(() => source.destroyed);

    expect(seen).toHaveLength(1);
    expect(source.destroyed).toBe(true);
    expect(sourceErrors).toEqual([]);
  });

  it("does not crash when the consumer breaks and the source has no error listener", async () => {
    const source = slowSourceOf(SLOW_CHUNKS);
    const seen: ParsedPoint[] = [];
    for await (const point of streamGoogleTakeout(source)) {
      seen.push(point);
      break;
    }
    await until(() => source.destroyed);
    expect(seen).toHaveLength(1);
    expect(source.destroyed).toBe(true);
  });

  // Destroying the source WITHOUT a reason mid-flight leaves the async iterator
  // permanently unsettled: `pipeline.on("error", () => {})` swallows the
  // teardown, and nothing ever ends the chain. Pinned as a known hazard, not as
  // desired behavior — the route never does this, it destroys with a reason or
  // lets the consumer break.
  it("never settles when the source is destroyed mid-flight without a reason", async () => {
    const source = slowSourceOf(SLOW_CHUNKS);
    source.on("error", () => {});
    const seen: ParsedPoint[] = [];

    const drained = (async () => {
      for await (const point of streamGoogleTakeout(source)) {
        seen.push(point);
        if (seen.length === 1) source.destroy();
      }
      return "settled" as const;
    })().catch((e) => `threw:${(e as Error).message}` as const);

    const outcome = await Promise.race([
      drained,
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 300)),
    ]);

    expect(seen).toHaveLength(1);
    expect(outcome).toBe("pending");
  });

  it("surfaces the reason, not ERR_STREAM_PREMATURE_CLOSE, when the source is destroyed with one", async () => {
    const source = slowSourceOf(SLOW_CHUNKS);
    source.on("error", () => {});
    const seen: ParsedPoint[] = [];
    let thrown: NodeJS.ErrnoException | undefined;

    try {
      for await (const point of streamGoogleTakeout(source)) {
        seen.push(point);
        if (seen.length === 1) source.destroy(new Error("upload aborted"));
      }
    } catch (e) {
      thrown = e as NodeJS.ErrnoException;
    }

    expect(seen).toHaveLength(1);
    expect(thrown?.message).toBe("upload aborted");
    expect(thrown?.code).toBeUndefined();
  });

  it("tears the gzip chain down without ABORT_ERR / ERR_STREAM_PREMATURE_CLOSE on break", async () => {
    const doc = JSON.stringify({
      locations: Array.from({ length: 400 }, (_, i) => ({
        latitudeE7: 375665000 + i,
        longitudeE7: 1269780000 + i,
        timestamp: new Date(Date.UTC(2026, 0, 2) + i * 1000).toISOString(),
      })),
    });
    const gz = gzipSync(Buffer.from(doc, "utf-8"));
    const raw = Readable.from(
      (async function* () {
        for (let i = 0; i < gz.length; i += 64) {
          await new Promise((resolve) => setImmediate(resolve));
          yield gz.subarray(i, i + 64);
        }
      })()
    );
    const gunzip = createGunzip();
    const errors: string[] = [];
    raw.on("error", (e: NodeJS.ErrnoException) => errors.push(`raw:${e.code ?? e.message}`));
    gunzip.on("error", (e: NodeJS.ErrnoException) => errors.push(`gunzip:${e.code ?? e.message}`));

    const seen: ParsedPoint[] = [];
    for await (const point of streamGoogleTakeout(raw.pipe(gunzip))) {
      seen.push(point);
      if (seen.length === 3) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(seen).toHaveLength(3);
    expect(errors).toEqual([]);
  });
});
