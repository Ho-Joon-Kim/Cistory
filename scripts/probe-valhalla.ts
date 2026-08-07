/**
 * THROWAWAY probe — NOT product code. Confirms Valhalla's real /trace_attributes
 * behavior before the map-matching adapter (a later task) is written. Writes
 * nothing, touches no DB. See docs/map-matching/valhalla-probe-findings.md for
 * the recorded results and docker/valhalla/entrypoint.sh for how the tiles this
 * probe runs against were built.
 *
 * Usage:
 *   VALHALLA_URL=http://localhost:8002 npx tsx scripts/probe-valhalla.ts
 */
const BASE = process.env.VALHALLA_URL;
if (!BASE) {
  console.error("VALHALLA_URL이 필요합니다");
  process.exit(1);
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* 본문이 JSON이 아닐 수 있다 — 그것도 알아야 할 사실이다 */
  }
  return { status: res.status, body: parsed };
}

// 서울 강남대로 위 실제 좌표 4개 (커버리지 안 — Korea-only 타일셋에도 들어있다).
const seoul = [
  { lat: 37.4979, lon: 127.0276, time: 0 },
  { lat: 37.4985, lon: 127.0281, time: 6 },
  { lat: 37.4991, lon: 127.0287, time: 12 },
  { lat: 37.4997, lon: 127.0292, time: 18 },
];

// 남대서양 한가운데 — 어떤 추출본에도 들어있지 않다.
const nowhere = [
  { lat: -30.0, lon: -20.0, time: 0 },
  { lat: -30.001, lon: -20.001, time: 6 },
  { lat: -30.002, lon: -20.002, time: 12 },
];

// NOTE: "confidence_score" (bare, no prefix) had to be added after the first
// run against real tiles came back without it — an "include" filter list is an
// allowlist for EVERY field in the response, not just edge/node attributes, so
// the top-level confidence_score/raw_score/admins/osm_changeset/shape fields
// silently disappear unless named here too.
const FILTERS = {
  attributes: [
    "edge.names",
    "edge.road_class",
    "matched.point",
    "matched.type",
    "matched.edge_index",
    "confidence_score",
  ],
  action: "include",
};

function makeShape(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    lat: 37.4979 + i * 0.00001,
    lon: 127.0276 + i * 0.00001,
    time: i * 6,
  }));
}

async function main() {
  console.log("=== 1. /status — 버전과 사용 가능한 액션 ===");
  const status = await fetch(`${BASE}/status?verbose=true`);
  console.log(JSON.stringify(await status.json(), null, 2).slice(0, 2000));

  console.log("\n=== 2. 커버리지 안 — 응답 필드 이름 확인 ===");
  const ok = await post("/trace_attributes", {
    shape: seoul,
    costing: "auto",
    shape_match: "map_snap",
    filters: FILTERS,
  });
  console.log("status:", ok.status);
  console.log(JSON.stringify(ok.body, null, 2).slice(0, 3000));

  console.log("\n=== 3. 커버리지 밖 — failed와 어떻게 구분하는가 ===");
  const off = await post("/trace_attributes", {
    shape: nowhere,
    costing: "auto",
    shape_match: "map_snap",
    filters: FILTERS,
  });
  console.log("status:", off.status);
  console.log(JSON.stringify(off.body, null, 2).slice(0, 1500));

  console.log("\n=== 4. costing 지원 여부 ===");
  for (const costing of ["auto", "pedestrian", "bicycle", "motorcycle", "bus"]) {
    const res = await post("/trace_attributes", {
      shape: seoul,
      costing,
      shape_match: "map_snap",
      filters: FILTERS,
    });
    console.log(`${costing}: HTTP ${res.status}`);
  }

  // service_limits.trace.max_shape는 밸할라 기본 설정값이 16000이다
  // (valhalla_build_config 기본 출력 확인) — 브리프가 준 1000~10000은 전부
  // 그 아래라 상한에 걸리지 않는다. 실제 컷오프를 관찰하려면 그 위 값도 찔러야
  // 한다.
  console.log("\n=== 5. max_trace_points 상한 ===");
  for (const n of [1000, 3000, 6500, 10000, 16000, 16001, 20000]) {
    const res = await post("/trace_attributes", {
      shape: makeShape(n),
      costing: "auto",
      shape_match: "map_snap",
      filters: FILTERS,
    });
    const err =
      typeof res.body === "object" && res.body && "error" in res.body
        ? (res.body as { error: unknown }).error
        : "";
    console.log(`${n} points: HTTP ${res.status} ${String(err).slice(0, 120)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
