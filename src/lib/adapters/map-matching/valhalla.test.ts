process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createValhallaAdapter, MATCH_CONFIDENCE_THRESHOLD, MAX_TRACE_POINTS } from "./valhalla";

// findings §2 — the real 4-point Gangnam-daero /trace_attributes request,
// pasted verbatim. All four points sit inside the south-korea MAP_EXTRACTS
// bbox ([124.3188, 32.3608, 132.3386, 38.6497]).
const points = [
  { lat: 37.4979, lon: 127.0276, timestamp: new Date("2026-08-01T00:00:00Z") },
  { lat: 37.4985, lon: 127.0281, timestamp: new Date("2026-08-01T00:00:06Z") },
  { lat: 37.4991, lon: 127.0287, timestamp: new Date("2026-08-01T00:00:12Z") },
  { lat: 37.4997, lon: 127.0292, timestamp: new Date("2026-08-01T00:00:18Z") },
];

// South Atlantic — outside every MAP_EXTRACTS bbox (no region covers it, even
// after the fix-round-1 widening).
const pointsOutsideAnyExtract = [
  { lat: -30.0, lon: -20.0, timestamp: new Date("2026-08-01T00:00:00Z") },
  { lat: -30.001, lon: -20.001, timestamp: new Date("2026-08-01T00:00:06Z") },
  { lat: -30.002, lon: -20.002, timestamp: new Date("2026-08-01T00:00:12Z") },
];

// Starts inside the south-korea bbox (Seoul) and ends in the genuine gap
// between the south-korea and tokyo-chiba (Kanto) extracts — (36.0, 133.0) is
// outside both ([124.3188..132.3386] and [134.5757..154.4709] respectively).
// This is fix round 1's core regression case: the reviewer's "Narita ->
// 35.6,139.0 -> 35.2,138.6" example stopped straddling once tokyo-chiba's
// bbox was correctly widened to Kanto's real reach, so this test uses a real
// gap that survives that widening.
const straddlingPoints = [
  { lat: 37.4979, lon: 127.0276, timestamp: new Date("2026-08-01T00:00:00Z") },
  { lat: 36.0, lon: 133.0, timestamp: new Date("2026-08-01T00:10:00Z") },
];

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// findings §2 — the real 4-point Gangnam-daero /trace_attributes response,
// pasted verbatim (every edge really does carry a route number alongside its
// street name; a single-name fixture was not representative).
const goodBody = {
  units: "kilometers",
  confidence_score: 1,
  edges: [
    { road_class: "primary", names: ["강남대로", "41"] },
    { road_class: "primary", names: ["서초대로", "90"] },
    { road_class: "primary", names: ["테헤란로", "90"] },
    { road_class: "primary", names: ["테헤란로", "90"] },
    { road_class: "residential", names: ["강남대로92길"] },
    { road_class: "residential", names: ["테헤란로5길"] },
    { road_class: "residential", names: ["테헤란로5길"] },
  ],
  matched_points: [
    { lon: 127.027525, lat: 37.497877, type: "matched", edge_index: 0 },
    { lon: 127.028307, lat: 37.4981, type: "matched", edge_index: 3 },
    { lon: 127.028765, lat: 37.498957, type: "matched", edge_index: 4 },
    { lon: 127.029393, lat: 37.49973, type: "matched", edge_index: 6 },
  ],
  alternate_paths: [],
};

// findings §3 — error_code 444 is byte-identical whether the cause is
// "outside every extract" or "inside an extract but off any road." Reused
// verbatim across multiple tests below with different request coordinates,
// to prove the adapter disambiguates on its own bbox knowledge, not on
// anything in this body.
const noSnapErrorBody = {
  error_code: 444,
  error:
    "Map Match algorithm failed to find path: map_snap algorithm failed to snap the shape points to the correct shape.",
  status_code: 400,
  status: "Bad Request",
};

// findings §3 — the 200km max_distance cap.
const traceTooLongErrorBody = {
  error_code: 154,
  error: "Path distance exceeds the max distance limit: 200000 meters",
  status_code: 400,
  status: "Bad Request",
};

// findings §3 — a genuine request-shape error (invalid costing name), pasted
// verbatim from the table of contrasting error codes. Standing in for "any
// other error" — Valhalla never actually returns a bare 5xx per the probe.
const genericErrorBody = {
  error_code: 125,
  error: "No costing method found: 'flying_carpet'",
  status_code: 400,
  status: "Bad Request",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createValhallaAdapter", () => {
  it("returns matched with snapped shape, road names and classes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, goodBody));
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");

    expect(result.status).toBe("matched");
    expect(result.shape).toEqual([
      [37.497877, 127.027525],
      [37.4981, 127.028307],
      [37.498957, 127.028765],
      [37.49973, 127.029393],
    ]);
    expect(result.roadNames).toEqual([
      "강남대로",
      "41",
      "서초대로",
      "90",
      "테헤란로",
      "강남대로92길",
      "테헤란로5길",
    ]);
    expect(result.roadClasses).toEqual(["primary", "residential"]);
    expect(result.confidence).toBe(1);
  });

  it("sends the costing it was given, with map_snap and confidence_score in the filter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, goodBody));
    await createValhallaAdapter("http://valhalla:8002").match(points, "pedestrian");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.costing).toBe("pedestrian");
    expect(body.shape_match).toBe("map_snap");
    expect(body.shape).toHaveLength(4);
    // 이게 없으면 confidence_score가 응답에서 통째로 사라진다 — include
    // 필터가 매치별 속성뿐 아니라 응답 전체 필드에 걸리는 allowlist이기
    // 때문이다 (findings §2).
    expect(body.filters.attributes).toEqual(
      expect.arrayContaining([
        "edge.names",
        "edge.road_class",
        "matched.point",
        "matched.type",
        "matched.edge_index",
        "confidence_score",
      ])
    );
  });

  // 이 테스트가 없으면 저신뢰도 매칭이 matched로 저장돼, 나중에 지도에서
  // 엉뚱한 도로를 보고도 원인을 알 수 없게 된다.
  it("downgrades to low_confidence below the threshold", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...goodBody, confidence_score: MATCH_CONFIDENCE_THRESHOLD - 0.01 })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("low_confidence");
    expect(result.shape).not.toBeNull();
  });

  // Pins the `<` in `confidence < MATCH_CONFIDENCE_THRESHOLD` — mutating it to
  // `<=` leaves every other test green.
  it("treats confidence exactly at the threshold as matched, not low_confidence", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...goodBody, confidence_score: MATCH_CONFIDENCE_THRESHOLD })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("matched");
  });

  it("reports no_coverage when every point of the trace is outside every built extract", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, noSnapErrorBody));
    const result = await createValhallaAdapter("http://valhalla:8002").match(
      pointsOutsideAnyExtract,
      "auto"
    );
    expect(result.status).toBe("no_coverage");
    expect(result.shape).toBeNull();
  });

  // findings §3: error_code 444 is byte-identical whether the point is outside
  // every extract or inside one but off any road (a park, a lake). Reusing the
  // exact same error body here — with in-bbox coordinates instead of the
  // out-of-bbox ones above — proves the adapter is disambiguating on the
  // trace's own coordinates, not on anything Valhalla's response says.
  it("reports failed — not no_coverage — for a 444 when every point of the trace is inside a built extract", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, noSnapErrorBody));
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("failed");
    expect(result.shape).toBeNull();
  });

  // Fix round 1 regression test: the predicate used to be "any point inside
  // -> failed", which is backwards. A trace that starts inside a built
  // extract and crosses into a genuine gap (open sea between Korea and Japan
  // here) is exactly the case widening an extract fixes, so it must be
  // no_coverage, not failed — a failed row never gets re-run once coverage
  // widens.
  it("reports no_coverage — not failed — for a trace that starts inside a built extract and crosses into an uncovered gap", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, noSnapErrorBody));
    const result = await createValhallaAdapter("http://valhalla:8002").match(
      straddlingPoints,
      "auto"
    );
    expect(result.status).toBe("no_coverage");
    expect(result.shape).toBeNull();
  });

  // 커버리지 밖과 엔진 오류를 섞으면 "추출본을 넓히면 살아난다"는 집계가
  // 거짓이 된다. 애매하면 보수적으로 failed다. Uses a realistic error_code —
  // findings §3 confirms Valhalla never actually returns a bare 5xx.
  it("reports failed — not no_coverage — for any other error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, genericErrorBody));
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("failed");
  });

  it("reports failed when the request throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("failed");
    expect(result.shape).toBeNull();
  });

  // findings §3: a trace that legitimately spans more than 200km (an
  // intercity trip) is not a bad request — it should be split and retried,
  // not surfaced as a failure that would page an operator.
  it("splits and retries on error_code 154 (trace distance cap) instead of failing", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, traceTooLongErrorBody))
      .mockResolvedValueOnce(jsonResponse(200, goodBody))
      .mockResolvedValueOnce(jsonResponse(200, goodBody));

    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("matched");
    expect(result.shape).toHaveLength(8); // two successful halves of 4 points each, stitched
  });

  // A 2-point chunk splits into two 1-point chunks, and Valhalla can't
  // meaningfully map-match (or compute a distance for) a single point — those
  // two follow-up requests are foregone conclusions. Don't send them.
  it("does not split a 2-point trace on error_code 154 — no pointless sub-requests", async () => {
    const twoPoints = [points[0], points[1]];
    fetchMock.mockResolvedValueOnce(jsonResponse(400, traceTooLongErrorBody));

    const result = await createValhallaAdapter("http://valhalla:8002").match(twoPoints, "auto");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("failed");
  });

  // Fix round 1, finding 4 (success path): losing no_coverage in a merge is
  // the expensive error, because it's the only status the re-run job selects
  // on. A silently truncated "matched" (shape from only the covered half)
  // would hide that this segment needs a re-run once the gap is covered.
  it("drops a successfully-matched chunk's shape and reports no_coverage overall when another chunk has no coverage", async () => {
    const partialCoverageTrace = [
      points[0], // Seoul — covered
      points[1], // Seoul — covered
      { lat: -30.0, lon: -20.0, timestamp: new Date("2026-08-01T00:10:00Z") }, // Atlantic — uncovered
      { lat: -30.001, lon: -20.001, timestamp: new Date("2026-08-01T00:15:00Z") }, // Atlantic — uncovered
    ];
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, traceTooLongErrorBody)) // initial: triggers the split
      .mockResolvedValueOnce(jsonResponse(200, goodBody)) // left half (Seoul): matches
      .mockResolvedValueOnce(jsonResponse(400, noSnapErrorBody)); // right half (Atlantic): no_coverage

    const result = await createValhallaAdapter("http://valhalla:8002").match(
      partialCoverageTrace,
      "auto"
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("no_coverage");
    expect(result.shape).toBeNull();
  });

  // Fix round 1, finding 4 (all-non-usable path, direction 1): the reviewer
  // measured [failed, no_coverage] -> failed and [no_coverage, failed] ->
  // no_coverage from the old order-dependent "return results[0]" fallback.
  // This and the next test pin both orderings to the same, deterministic
  // answer.
  it("picks no_coverage deterministically when the failed chunk comes before the no_coverage chunk", async () => {
    const failThenNoCoverage = [
      points[0], // Seoul — will get a generic request error
      points[1],
      { lat: -30.0, lon: -20.0, timestamp: new Date("2026-08-01T00:10:00Z") }, // Atlantic — no_coverage
      { lat: -30.001, lon: -20.001, timestamp: new Date("2026-08-01T00:15:00Z") },
    ];
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, traceTooLongErrorBody))
      .mockResolvedValueOnce(jsonResponse(400, genericErrorBody)) // left -> failed
      .mockResolvedValueOnce(jsonResponse(400, noSnapErrorBody)); // right -> no_coverage

    const result = await createValhallaAdapter("http://valhalla:8002").match(
      failThenNoCoverage,
      "auto"
    );
    expect(result.status).toBe("no_coverage");
  });

  it("picks no_coverage deterministically when the no_coverage chunk comes before the failed chunk", async () => {
    const noCoverageThenFail = [
      { lat: -30.0, lon: -20.0, timestamp: new Date("2026-08-01T00:00:00Z") }, // Atlantic — no_coverage
      { lat: -30.001, lon: -20.001, timestamp: new Date("2026-08-01T00:05:00Z") },
      points[2], // Seoul — will get a generic request error
      points[3],
    ];
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, traceTooLongErrorBody))
      .mockResolvedValueOnce(jsonResponse(400, noSnapErrorBody)) // left -> no_coverage
      .mockResolvedValueOnce(jsonResponse(400, genericErrorBody)); // right -> failed

    const result = await createValhallaAdapter("http://valhalla:8002").match(
      noCoverageThenFail,
      "auto"
    );
    expect(result.status).toBe("no_coverage");
  });

  // Fix round 1, finding 3: an all-unmatched 2xx response must not be stored
  // as a real match — match_status='matched' with no geometry is
  // indistinguishable from a genuine match in the status column alone, and it
  // breaks this file's own contract that shape is only filled for
  // matched/low_confidence.
  it("reports failed — not matched — when a 2xx response has no usable shape (all points unmatched)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ...goodBody,
        matched_points: [
          { lat: 37.4979, lon: 127.0276, type: "unmatched" },
          { lat: 37.4985, lon: 127.0281, type: "unmatched" },
        ],
      })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("failed");
    expect(result.shape).toBeNull();
  });

  it("reports failed when a 2xx response body isn't valid JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>not json — e.g. a proxy error page</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("failed");
    expect(result.shape).toBeNull();
  });

  it("keeps interpolated points but drops unmatched ones from the shape", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ...goodBody,
        matched_points: [
          { lat: 37.49791, lon: 127.02762, type: "matched", edge_index: 0 },
          { lat: 37.4983, lon: 127.028, type: "interpolated", edge_index: 0 },
          { lat: 37.4985, lon: 127.0281, type: "unmatched" }, // no edge_index key at all
          { lat: 37.49911, lon: 127.02872, type: "matched", edge_index: 1 },
        ],
      })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.shape).toEqual([
      [37.49791, 127.02762],
      [37.4983, 127.028],
      [37.49911, 127.02872],
    ]);
  });

  it("deduplicates road names while keeping first-seen order", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ...goodBody,
        edges: [
          { names: ["강남대로"], road_class: "trunk" },
          { names: ["강남대로"], road_class: "trunk" },
          { names: ["테헤란로"], road_class: "primary" },
        ],
      })
    );
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.roadNames).toEqual(["강남대로", "테헤란로"]);
    expect(result.roadClasses).toEqual(["trunk", "primary"]);
  });

  it("MAX_TRACE_POINTS matches Valhalla's real, config-enforced ceiling", () => {
    // findings §5: confirmed by binary search — 16000 -> HTTP 200,
    // 16001 -> error_code 153 "Too many shape points". The brief's assumed
    // 1000 would chunk 16x more often than necessary.
    expect(MAX_TRACE_POINTS).toBe(16000);
  });

  it("splits a trace longer than MAX_TRACE_POINTS and stitches the results", async () => {
    const total = MAX_TRACE_POINTS + 500;
    const many = Array.from({ length: total }, (_, i) => ({
      lat: 37.4 + i * 0.00001,
      lon: 127.0 + i * 0.00001,
      timestamp: new Date(Date.UTC(2026, 7, 1, 0, 0, 0) + i * 6000),
    }));
    // mockImplementation, not mockResolvedValue — a Response body can only be
    // read once, and mockResolvedValue would hand the *same* Response
    // instance to every call, silently emptying every chunk after the first.
    fetchMock.mockImplementation(async () => jsonResponse(200, goodBody));

    const adapter = createValhallaAdapter("http://valhalla:8002");
    const result = await adapter.match(many, "auto");

    const expectedCalls = Math.ceil(total / MAX_TRACE_POINTS);
    expect(fetchMock).toHaveBeenCalledTimes(expectedCalls);
    expect(result.status).toBe("matched");
    expect(result.shape).toHaveLength(4 * expectedCalls);
  });
});
