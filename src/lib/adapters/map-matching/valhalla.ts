import { logger } from "@/lib/logger";
import { MAP_EXTRACTS } from "@/lib/map-extracts";

/**
 * Valhalla map matching 클라이언트.
 *
 * 두 번째 구현이 실제로 필요해질 때까지 `interface.ts`를 만들지 않는다 —
 * `ai/claude.ts`, `vcs/github.ts`와 같은 판단이다.
 *
 * 응답 형태와 오류 분류 규칙은 docs/map-matching/valhalla-probe-findings.md에서
 * 실측으로 확인한 것이다. 이 파일의 초안(Task 3 브리프)은 Valhalla 문서만
 * 보고 쓰였고, 실제 프로브가 그중 최소 다섯 군데를 틀렸다고 확인했다 — 필드
 * 이름, 타입 필터, 트레이스 상한, 오류 코드 두 개. 추측한 필드 이름을 넣지
 * 않는다; 프로브 문서와 다르면 프로브가 이긴다.
 */

export type ValhallaCosting = "auto" | "pedestrian" | "bicycle" | "motorcycle" | "bus";

export interface MatchPoint {
  lat: number;
  lon: number;
  timestamp: Date;
}

export interface MatchResult {
  status: "matched" | "low_confidence" | "no_coverage" | "failed";
  /** [lat, lon] 순서. matched/low_confidence일 때만 채워진다. */
  shape: Array<[number, number]> | null;
  roadNames: string[];
  roadClasses: string[];
  confidence: number | null;
}

export interface MapMatchingAdapter {
  match(points: MatchPoint[], costing: ValhallaCosting): Promise<MatchResult>;
}

/**
 * 잠정값이다. Task 9의 캘리브레이션으로 실측 분포를 본 뒤 확정한다 —
 * 하드코딩된 추측값이 그대로 굳는 것을 막으려고 상수로 분리해 둔다.
 */
export const MATCH_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Valhalla의 실측 상한(`service_limits.trace.max_shape`) — 16000에서 HTTP 200,
 * 16001에서 `error_code 153 "Too many shape points"`로 경계를 이진 탐색으로
 * 확인했다 (findings §5). 브리프의 1000은 실측 전 문서 추정치였고, 이 값을
 * 낮게 잡을수록 청크 수만 16배로 늘어 왕복 비용이 커진다.
 */
export const MAX_TRACE_POINTS = 16000;

/**
 * "이 좌표 근처에 스냅할 도로가 없다"는 error_code. 프로브로 확인한 값은 444다
 * (findings §3) — 문서만 보고 쓴 초안은 171을 가정했지만, 171은 이 프로브의
 * 어떤 케이스에서도 관측되지 않았다.
 */
const NO_COVERAGE_ERROR_CODE = 444;

/**
 * "경로 거리가 `service_limits.trace.max_distance`(200km)를 넘는다"는
 * error_code (findings §3). 시외 이동을 담은 정상적인 트레이스도 이 상한을
 * 넘을 수 있으므로 요청 오류가 아니다 — 절반으로 잘라 재시도한다.
 */
const TRACE_TOO_LONG_ERROR_CODE = 154;

interface RawMatchedPoint {
  lat: number;
  lon: number;
  /**
   * 세 값 실측 확인 (findings §2): matched=확신 있게 스냅, interpolated=
   * 확신 있게 매칭된 두 점 사이를 보간(실제 경로 지오메트리, 버리면 안 됨),
   * unmatched=전혀 스냅하지 못함.
   */
  type: "matched" | "interpolated" | "unmatched";
  /** unmatched 포인트는 이 키 자체가 없다 — undefined가 아니라 부재. */
  edge_index?: number;
}

interface TraceAttributesResponse {
  confidence_score?: number;
  matched_points?: RawMatchedPoint[];
  edges?: Array<{ names?: string[]; road_class?: string }>;
  error_code?: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function emptyResult(status: MatchResult["status"]): MatchResult {
  return { status, shape: null, roadNames: [], roadClasses: [], confidence: null };
}

/**
 * 트레이스의 어느 한 점이라도 구축된 추출본(MAP_EXTRACTS) bbox 안에 있는지.
 *
 * error_code 444는 "커버리지 밖"과 "커버리지 안이지만 도로 근처가 아님(공원,
 * 호수 등)"에 대해 바이트 단위로 동일한 응답을 준다 — 프로브가 확인했다
 * (findings §3, Soyang 저수지 케이스가 남대서양 케이스와 완전히 같은 본문을
 * 반환). 이 함수가 그 둘을 가르는 유일한 신호다.
 */
function anyPointInsideExtracts(points: MatchPoint[]): boolean {
  return points.some((p) =>
    MAP_EXTRACTS.some(
      ({ bbox: [minLon, minLat, maxLon, maxLat] }) =>
        p.lon >= minLon && p.lon <= maxLon && p.lat >= minLat && p.lat <= maxLat
    )
  );
}

/**
 * 부분 결과들을 하나로 잇는다. 성공한(shape가 채워진) 조각이 하나라도 있으면
 * 그것들만 이어붙이고, 전부 실패했을 때만 대표로 첫 조각의 상태를 반환한다 —
 * 긴 이동의 앞부분만 커버리지 밖인 경우가 실재하기 때문이다.
 */
function mergeResults(results: MatchResult[]): MatchResult {
  const usable = results.filter((r) => r.shape !== null);
  if (usable.length === 0) return results[0];

  const status = usable.some((r) => r.status === "low_confidence") ? "low_confidence" : "matched";
  const confidences = usable.map((r) => r.confidence).filter((c): c is number => c !== null);

  return {
    status,
    shape: usable.flatMap((r) => r.shape ?? []),
    roadNames: uniqueInOrder(usable.flatMap((r) => r.roadNames)),
    roadClasses: uniqueInOrder(usable.flatMap((r) => r.roadClasses)),
    confidence: confidences.length > 0 ? Math.min(...confidences) : null,
  };
}

export function createValhallaAdapter(baseUrl: string, timeoutMs = 30_000): MapMatchingAdapter {
  async function requestTraceAttributes(
    points: MatchPoint[],
    costing: ValhallaCosting
  ): Promise<{ ok: true; body: TraceAttributesResponse } | { ok: false; errorCode?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const base = points[0].timestamp.getTime();
      const response = await fetch(`${baseUrl}/trace_attributes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          shape: points.map((p) => ({
            lat: p.lat,
            lon: p.lon,
            time: Math.round((p.timestamp.getTime() - base) / 1000),
          })),
          costing,
          shape_match: "map_snap",
          filters: {
            attributes: [
              "edge.names",
              "edge.road_class",
              "matched.point",
              "matched.type",
              "matched.edge_index",
              // 이 이름이 없으면 confidence_score가 통째로 사라진다 — include
              // 필터가 매치별 속성뿐 아니라 응답 전체 필드에 걸리는
              // allowlist이기 때문이다 (findings §2, 브리프 자체 프로브
              // 스크립트에서 실제로 걸려 넘어졌던 버그).
              "confidence_score",
            ],
            action: "include",
          },
        }),
      });

      const body = (await response.json().catch(() => ({}))) as TraceAttributesResponse;
      if (!response.ok) return { ok: false, errorCode: body.error_code };
      return { ok: true, body };
    } finally {
      clearTimeout(timer);
    }
  }

  function parseSuccess(body: TraceAttributesResponse): MatchResult {
    // interpolated는 "확신이 덜한 매칭"이 아니라 실제 경로 지오메트리다 —
    // matched만 남기면 조밀한 실제 트레이스에서 절반 가까이 버려진다
    // (findings §2, 60점 샘플에서 matched 31 / interpolated 26). unmatched만
    // 뺀다.
    const shape = (body.matched_points ?? [])
      .filter((p) => p.type === "matched" || p.type === "interpolated")
      .map((p): [number, number] => [p.lat, p.lon]);
    const edges = body.edges ?? [];
    const confidence = body.confidence_score ?? null;

    return {
      status:
        confidence !== null && confidence < MATCH_CONFIDENCE_THRESHOLD
          ? "low_confidence"
          : "matched",
      shape,
      roadNames: uniqueInOrder(edges.flatMap((e) => e.names ?? [])),
      roadClasses: uniqueInOrder(edges.map((e) => e.road_class ?? "").filter(Boolean)),
      confidence,
    };
  }

  /** matchChunk의 오류 분기만 떼어낸 것 — noExcessiveCognitiveComplexity 상한 때문. */
  async function handleErrorCode(
    errorCode: number | undefined,
    points: MatchPoint[],
    costing: ValhallaCosting
  ): Promise<MatchResult> {
    if (errorCode === TRACE_TOO_LONG_ERROR_CODE) {
      // 이 트레이스는 잘못된 요청이 아니라 200km 상한을 넘는 정상적인 시외
      // 이동이다 — 절반으로 잘라 재시도한다. 포인트 1개까지 내려가면(이론상
      // 도달하지 않는다 — 점 하나의 거리는 0이다) 더 못 자르니 failed로
      // 남긴다.
      if (points.length <= 1) return emptyResult("failed");
      const mid = Math.floor(points.length / 2);
      const [left, right] = await Promise.all([
        matchChunk(points.slice(0, mid), costing),
        matchChunk(points.slice(mid), costing),
      ]);
      return mergeResults([left, right]);
    }

    if (errorCode === NO_COVERAGE_ERROR_CODE) {
      if (anyPointInsideExtracts(points)) {
        // 구축된 추출본 안인데도 못 찾았다 — 추출본을 넓힌다고 해결되지
        // 않는 케이스(공원, 호수 등)다. no_coverage로 보고하면 "추출본을
        // 넓히면 살아난다"는 집계 신호가 거짓이 되므로 failed로 남긴다.
        logger.warn("[Valhalla] error_code 444 inside a built extract — not a coverage gap", {
          costing,
          sample: { lat: points[0].lat, lon: points[0].lon },
        });
        return emptyResult("failed");
      }
      return emptyResult("no_coverage");
    }

    return emptyResult("failed");
  }

  async function matchChunk(points: MatchPoint[], costing: ValhallaCosting): Promise<MatchResult> {
    try {
      const result = await requestTraceAttributes(points, costing);
      if (result.ok) return parseSuccess(result.body);
      return await handleErrorCode(result.errorCode, points, costing);
    } catch (error) {
      logger.warn("[Valhalla] match request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return emptyResult("failed");
    }
  }

  return {
    async match(points, costing) {
      if (points.length === 0) return emptyResult("failed");

      const chunks = chunk(points, MAX_TRACE_POINTS);
      const results: MatchResult[] = [];
      for (const part of chunks) {
        results.push(await matchChunk(part, costing));
      }
      return mergeResults(results);
    },
  };
}
