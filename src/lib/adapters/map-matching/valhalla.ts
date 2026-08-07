import { logger } from "@/lib/logger";
import { isPointCovered } from "@/lib/map-extracts";

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
 * 않는다; 프로브 문서와 다르면 프로브가 이긴다. Task 3 코드 리뷰 fix round 1
 * 에서 444 판별식의 방향이 뒤집혀 있던 것과 병합 시 no_coverage 신호가
 * 조용히 사라지던 것도 추가로 고쳤다. fix round 2에서는 그 판별식이 기대는
 * `MAP_EXTRACTS`의 bbox 자체가 실제 타일 범위보다 훨씬 넓게 잘못 잡혀 있던
 * 것을 고쳤다 — `map-extracts.ts` 참고. 아래 각 함수의 주석 참고.
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

/**
 * 154 재시도 분할 후 절반의 최소 포인트 수. Valhalla는 점 하나로는 거리도
 * 경로도 계산할 수 없어, 1점짜리 요청은 보내봐야 결과가 뻔한 왕복 낭비다 —
 * 그래서 분할 결과 어느 한쪽이라도 이 아래로 내려가면 아예 나누지 않고
 * failed로 남긴다 (분할 전 이미 200km를 넘겼다는 것 자체가, 점이 2개뿐인데도
 * 넘겼다면 더 쪼개봐야 답이 안 나온다는 뜻이기도 하다).
 */
const MIN_SPLIT_POINTS = 2;

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
 * 트레이스의 모든 점이 구축된 추출본(MAP_EXTRACTS) 안에 있는지 —
 * `isPointCovered`(`@/lib/map-extracts`)가 실제 판별을 한다.
 *
 * error_code 444는 "커버리지 밖"과 "커버리지 안이지만 도로 근처가 아님(공원,
 * 호수 등)"에 대해 바이트 단위로 동일한 응답을 준다 — 프로브가 확인했다
 * (findings §3, Soyang 저수지 케이스가 남대서양 케이스와 완전히 같은 본문을
 * 반환). 위젠(widen)이 도움이 되는지는 "밖에 있는 점이 하나라도 있는가"로
 * 갈린다 — 하나라도 밖에 있으면 그 지점 근처로 추출본을 넓히는 게 옳은
 * 조치이므로 no_coverage다. **모든** 점이 안에 있는데도 못 찾았다면 넓혀도
 * 소용없다(공원, 호수 등) — 그때만 failed다.
 *
 * (fix round 1: 이전 버전은 "하나라도 안에 있으면 failed"였다 — 반대였다.
 * 방문 이력에서 뽑은 bbox라 실제 트레이스 대부분이 한 점쯤은 어딘가의 bbox
 * 안에 걸치므로, 이 반전된 조건은 나리타→간토 밖 같은 "안에서 밖으로
 * 걸치는" 구간까지 거의 다 failed로 묻어버려 재실행 대상에서 영영 빠뜨렸다.
 * fix round 2: `isPointCovered`가 예전엔 각 추출본을 정점 min/max 하나짜리
 * bbox로 판별했다 — .poly 경계가 비볼록이라 오사카나 후쿠오카 같은, 실제로는
 * 타일에 없는 도시까지 "안"으로 오판했다. 이제는 `.poly`를 점-다각형 포함
 * 판정으로 실측해 만든 bbox 배열이라 그 문제가 없다. 자세한 내용은
 * `map-extracts.ts`의 파일 상단 주석 참고.)
 */
function everyPointInsideExtracts(points: MatchPoint[]): boolean {
  return points.every((p) => isPointCovered(p.lat, p.lon));
}

/**
 * 부분 결과들을 하나로 잇는다.
 *
 * no_coverage는 절대 조용히 사라지면 안 된다 — "추출본을 넓힌 뒤 재실행"을
 * 트리거하는 유일한 신호이기 때문이다(재실행 대상 조회는 `match_status`
 * 컬럼만 본다). 조각 중 하나라도 no_coverage면 — 다른 조각이 실제로
 * 매칭됐더라도 — 전체를 no_coverage로 취급하고 shape는 비운다.
 *
 * 부분 shape를 남기지 않는 이유는 재실행하면 그 지오메트리가 돌아오기
 * 때문이 아니다 — 같은 추출본으로 다시 돌리면 no_coverage가 shape 없이
 * 그대로 재현되고, 바다 한가운데처럼 영영 커버되지 않는 구간은 애초에
 * 돌아오지 않는다. 진짜 이유는 읽는 쪽이다: 이 데이터를 읽을 후속 로직의
 * `covered()` 판정은 세그먼트가 shape를 하나라도 가지고 있으면 그 구간
 * 전체를 "커버됨"으로 본다 — 부분 shape를 저장하면 raw-GPS로 빈틈을 메우는
 * 경로가 억제되고, 지도에는 반쪽짜리 선 뒤에 순간이동하는 모양으로
 * 그려진다(shape 없음보다 나쁘다). 재실행 신호를 잃는 건 되돌릴 수 없고,
 * 스냅 품질을 잃는 건 되돌릴 수 있다 — 그래서 no_coverage 쪽으로 접는다.
 *
 * 이 순서는 입력 배열의 순서와 무관하게 결정적이어야 한다 — fix round 1
 * 리뷰가 [failed, no_coverage]와 [no_coverage, failed]가 서로 다른 결과를
 * 내던 것을 잡았다.
 *
 * no_coverage가 하나도 없을 때만 기존 방식대로: 매칭된(shape가 채워진)
 * 조각이 있으면 그것들을 이어붙이고(실패한 조각은 버린다 — failed 조각은
 * 어차피 재실행 대상이 아니니 부분 geometry라도 남기는 게 낫다), 전부
 * 실패했을 때만 failed다.
 */
function mergeResults(results: MatchResult[]): MatchResult {
  if (results.some((r) => r.status === "no_coverage")) {
    return emptyResult("no_coverage");
  }

  const usable = results.filter((r) => r.shape !== null);
  if (usable.length === 0) return emptyResult("failed");

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

    if (shape.length === 0) {
      // 전부 unmatched였거나(포인트 하나도 못 스냅) matched_points 자체가
      // 없거나(2xx인데 본문이 JSON으로 안 읽히는 경우도 .catch(() => ({}))를
      // 거쳐 결국 여기로 온다) — 어느 쪽이든 geometry가 없다. matched로
      // 남기면 match_status 컬럼만 보고는 진짜 매칭과 구분이 안 되고,
      // `shape는 matched/low_confidence일 때만 채워진다`는 이 파일의 계약도
      // 깨진다.
      return emptyResult("failed");
    }

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
      // 이동이다 — 절반으로 잘라 재시도한다. 어느 한쪽이라도 MIN_SPLIT_POINTS
      // 아래로 내려가는 분할은 하지 않는다 — 1점짜리 요청은 Valhalla가 애초에
      // 유의미하게 처리할 수 없어 결과가 뻔한 왕복 낭비다.
      const mid = Math.floor(points.length / 2);
      const canSplit = mid >= MIN_SPLIT_POINTS && points.length - mid >= MIN_SPLIT_POINTS;
      if (!canSplit) return emptyResult("failed");

      const [left, right] = await Promise.all([
        matchChunk(points.slice(0, mid), costing),
        matchChunk(points.slice(mid), costing),
      ]);
      return mergeResults([left, right]);
    }

    if (errorCode === NO_COVERAGE_ERROR_CODE) {
      if (everyPointInsideExtracts(points)) {
        // 구축된 추출본 안인데도(전 구간) 못 찾았다 — 추출본을 넓힌다고
        // 해결되지 않는 케이스(공원, 호수 등)다. no_coverage로 보고하면
        // "추출본을 넓히면 살아난다"는 집계 신호가 거짓이 되므로 failed로
        // 남긴다.
        //
        // 로그는 남기지 않는다: pedestrian 코스팅에서는 공원/호수를 걷는
        // 게 흔하고 정상적인 결과라, 세그먼트마다 warn을 찍으면 진짜 엔진
        // 오류와 뒤섞인 잡음이 된다. 근거가 필요하면 segment_route_matches
        // 의 `match_status='failed'` 행 자체가 이미 영구 기록이다.
        return emptyResult("failed");
      }
      return emptyResult("no_coverage");
    }

    // findings §3의 나머지 4xx(125/114/100/153 등)는 전부 요청 자체가
    // 잘못됐다는 뜻이다 — 예를 들어 잘못된 costing 이름이거나, 이 Valhalla의
    // max_shape가 우리가 가정한 16000보다 낮게 설정된 경우다. in-coverage
    // 444(pedestrian이 공원을 걷는 정상적인 결과)의 warn은 없애는 게 맞았지만
    // (흔하고, 조용히 넘어가도 되는 정상 분류다), 이 분기는 다르다 — 매번
    // "이 어댑터 자체가 잘못 설정됐다"는 뜻이라 잡음이 아니다.
    logger.warn("[Valhalla] unrecognized error_code — adapter/request likely malformed", {
      errorCode,
      costing,
    });
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
