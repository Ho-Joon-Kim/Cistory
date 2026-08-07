process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createValhallaAdapter, MATCH_CONFIDENCE_THRESHOLD, MAX_TRACE_POINTS } from "./valhalla";

// 강남대로 위 실제 좌표 — MAP_EXTRACTS의 south-korea bbox
// ([124.5, 33.0, 132.0, 38.7]) 안이다.
const points = [
  { lat: 37.4979, lon: 127.0276, timestamp: new Date("2026-08-01T00:00:00Z") },
  { lat: 37.4985, lon: 127.0281, timestamp: new Date("2026-08-01T00:00:06Z") },
  { lat: 37.4991, lon: 127.0287, timestamp: new Date("2026-08-01T00:00:12Z") },
];

// 남대서양 한가운데 — MAP_EXTRACTS 어떤 추출본에도 들어있지 않다
// (docs/map-matching/valhalla-probe-findings.md §3, scripts/probe-valhalla.ts).
const pointsOutsideAnyExtract = [
  { lat: -30.0, lon: -20.0, timestamp: new Date("2026-08-01T00:00:00Z") },
  { lat: -30.001, lon: -20.001, timestamp: new Date("2026-08-01T00:00:06Z") },
  { lat: -30.002, lon: -20.002, timestamp: new Date("2026-08-01T00:00:12Z") },
];

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const goodBody = {
  confidence_score: 0.93,
  matched_points: [
    { lat: 37.49791, lon: 127.02762, type: "matched", edge_index: 0 },
    { lat: 37.49851, lon: 127.02812, type: "matched", edge_index: 0 },
    { lat: 37.49911, lon: 127.02872, type: "matched", edge_index: 1 },
  ],
  edges: [
    { names: ["강남대로"], road_class: "trunk" },
    { names: ["테헤란로"], road_class: "primary" },
  ],
};

// findings §3 — error_code 444는 "커버리지 밖"과 "커버리지 안이지만 도로
// 근처가 아님"에 대해 바이트 단위로 동일한 본문을 준다. 두 테스트 모두 이
// 정확한 본문을 재사용해서, 어댑터가 본문이 아니라 좌표를 근거로 판단함을
// 증명한다.
const noSnapErrorBody = {
  error_code: 444,
  error:
    "Map Match algorithm failed to find path: map_snap algorithm failed to snap the shape points to the correct shape.",
  status_code: 400,
  status: "Bad Request",
};

// findings §3 — 200km max_distance 상한.
const traceTooLongErrorBody = {
  error_code: 154,
  error: "Path distance exceeds the max distance limit: 200000 meters",
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
      [37.49791, 127.02762],
      [37.49851, 127.02812],
      [37.49911, 127.02872],
    ]);
    expect(result.roadNames).toEqual(["강남대로", "테헤란로"]);
    expect(result.roadClasses).toEqual(["trunk", "primary"]);
    expect(result.confidence).toBe(0.93);
  });

  it("sends the costing it was given, with map_snap and confidence_score in the filter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, goodBody));
    await createValhallaAdapter("http://valhalla:8002").match(points, "pedestrian");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.costing).toBe("pedestrian");
    expect(body.shape_match).toBe("map_snap");
    expect(body.shape).toHaveLength(3);
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

  it("reports no_coverage when the coordinate is outside every built extract", async () => {
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
  it("reports failed — not no_coverage — for a 444 inside a built extract", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, noSnapErrorBody));
    const result = await createValhallaAdapter("http://valhalla:8002").match(points, "auto");
    expect(result.status).toBe("failed");
    expect(result.shape).toBeNull();
  });

  // 커버리지 밖과 엔진 오류를 섞으면 "추출본을 넓히면 살아난다"는 집계가
  // 거짓이 된다. 애매하면 보수적으로 failed다.
  it("reports failed — not no_coverage — for any other error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "internal" }));
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
    expect(result.shape).toHaveLength(6); // two successful halves stitched together
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
    expect(result.shape).toHaveLength(3 * expectedCalls);
  });
});
