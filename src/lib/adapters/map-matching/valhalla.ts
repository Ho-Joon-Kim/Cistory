import { logger } from "@/lib/logger";

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
 * 않는다; 프로브 문서와 다르면 프로브가 이긴다. error_code 444는 원인을
 * 구분할 정보가 없으므로 추출본 범위를 추론하지 않고 `no_road_match`로만
 * 보고한다.
 */

export type ValhallaCosting = "auto" | "pedestrian" | "bicycle" | "motorcycle" | "bus";

export interface MatchPoint {
  lat: number;
  lon: number;
  timestamp: Date;
}

export type TimestampedShape = Array<[number, number, number]>;

export interface MatchResult {
  status: "matched" | "low_confidence" | "no_road_match" | "failed";
  /** [lat, lon, epochMillis] 순서. matched/low_confidence일 때만 채워진다. */
  shape: TimestampedShape | null;
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
const NO_ROAD_MATCH_ERROR_CODE = 444;

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
 * 부분 결과들을 하나로 잇는다.
 *
 * 조각 중 하나라도 no_road_match면 — 다른 조각이 실제로 매칭됐더라도 —
 * 전체를 no_road_match로 취급하고 shape는 비운다.
 *
 * 부분 shape를 남기지 않는 이유는 재실행하면 그 지오메트리가 돌아오기
 * 때문이 아니다 — 같은 추출본으로 다시 돌리면 no_road_match가 shape 없이
 * 그대로 재현되고, 바다 한가운데처럼 영영 커버되지 않는 구간은 애초에
 * 돌아오지 않는다. 진짜 이유는 읽는 쪽이다: 이 데이터를 읽을 후속 로직의
 * `covered()` 판정은 세그먼트가 shape를 하나라도 가지고 있으면 그 구간
 * 전체를 "커버됨"으로 본다 — 부분 shape를 저장하면 raw-GPS로 빈틈을 메우는
 * 경로가 억제되고, 지도에는 반쪽짜리 선 뒤에 순간이동하는 모양으로
 * 그려진다(shape 없음보다 나쁘다). 재실행 신호를 잃는 건 되돌릴 수 없고,
 * 스냅 품질을 잃는 건 되돌릴 수 있다 — 그래서 no_road_match 쪽으로 접는다.
 *
 * 이 우선순위는 입력 배열의 순서와 무관하다. no_road_match가 하나라도
 * 있으면 전체를 no_road_match로 접는다.
 *
 * no_road_match가 하나도 없을 때만 기존 방식대로: 매칭된(shape가 채워진)
 * 조각이 있으면 그것들을 이어붙이고(실패한 조각은 버린다 — failed 조각은
 * 어차피 재실행 대상이 아니니 부분 geometry라도 남기는 게 낫다), 전부
 * 실패했을 때만 failed다.
 */
function mergeResults(results: MatchResult[]): MatchResult {
  if (results.some((r) => r.status === "no_road_match")) {
    return emptyResult("no_road_match");
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

  function parseSuccess(body: TraceAttributesResponse, inputPoints: MatchPoint[]): MatchResult {
    // interpolated는 "확신이 덜한 매칭"이 아니라 실제 경로 지오메트리다 —
    // matched만 남기면 조밀한 실제 트레이스에서 절반 가까이 버려진다
    // (findings §2, 60점 샘플에서 matched 31 / interpolated 26). unmatched만
    // 뺀다.
    const matchedPoints = body.matched_points ?? [];
    const inputStart = inputPoints[0].timestamp.getTime();
    const inputEnd = inputPoints[inputPoints.length - 1].timestamp.getTime();
    const timestampAt =
      matchedPoints.length === inputPoints.length
        ? (index: number) => inputPoints[index].timestamp.getTime()
        : (index: number) => {
            // 1:1 정렬을 확인할 수 없으면 이 요청 청크의 시간 범위에 균등 배분한다.
            if (matchedPoints.length === 1) return inputStart;
            return (
              inputStart +
              Math.round(((inputEnd - inputStart) * index) / (matchedPoints.length - 1))
            );
          };
    const shape = matchedPoints
      .map((point, index) => ({ point, timestamp: timestampAt(index) }))
      .filter(({ point }) => point.type === "matched" || point.type === "interpolated")
      .map(({ point, timestamp }): [number, number, number] => [point.lat, point.lon, timestamp]);

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

    if (errorCode === NO_ROAD_MATCH_ERROR_CODE) {
      // 444는 타일이 없는 지역과 타일 안에서 도로를 찾지 못한 경우가 동일하다.
      // 어댑터는 원인을 추론하지 않고 Valhalla가 관측한 사실만 기록한다.
      return emptyResult("no_road_match");
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
      if (result.ok) return parseSuccess(result.body, points);
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
