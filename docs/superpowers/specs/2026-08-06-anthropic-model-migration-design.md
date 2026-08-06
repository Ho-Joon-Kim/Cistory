# Anthropic SDK·모델 마이그레이션

날짜: 2026-08-06
대상: `src/lib/adapters/ai/claude.ts`, `src/modules/spending/category-classifier.ts`,
`src/modules/summary/service.ts`, `src/modules/overview/narrative.ts`, `src/modules/report/service.ts`

## 문제

`@anthropic-ai/sdk`가 `0.52.0`이고 최신은 `0.115.0`이다. 모델은 `claude-sonnet-4-6`과
`claude-haiku-4-5`를 쓴다. 모델을 올리려는 순간 **조용히 깨지는 지점이 두 곳** 있다.

### 1. 응답 파싱이 첫 블록만 읽는다

`src/lib/adapters/ai/claude.ts:53`:

```ts
const content = response.content[0];
const text = content.type === "text" ? content.text : "";
```

Sonnet 5와 Opus 5는 **adaptive thinking이 기본 ON**이다. 그러면 `content[0]`이 thinking
블록이고 `type === "text"`가 거짓이 되어 **빈 문자열이 반환된다**. 예외도 로그도 없이 커밋 요약이
빈 값으로 저장된다.

### 2. `temperature`를 항상 보낸다

`claude.ts:47`이 `temperature`를 무조건 실어 보내는데, Sonnet 5·Opus 5는 비기본 sampling
파라미터를 **400으로 거부**한다. 호출부가 각각 다른 값을 쓴다:

| 워크로드 | 파일 | temperature | maxTokens |
|---|---|---|---|
| 커밋 요약 | `summary/service.ts:146` | 0.5 | 300 |
| 기간 내러티브 | `overview/narrative.ts:158` | 0.6 | 1,600 |
| 월/연 리포트 | `report/service.ts:1471` | 0.7 | 2,000 |
| 지출 분류 | `spending/category-classifier.ts:77` | 0 | items×60 (최소 500) |

분류기의 `0`은 결정성이 목적이므로 그냥 지우면 의도가 사라진다.

### 3. `max_tokens`가 thinking과 응답을 합쳐 제한한다

커밋 요약의 `maxTokens: 300`은 thinking이 켜진 채로는 위험하다. 사고에 다 쓰이면 요약이 잘리거나
비어버리고, 증상이 1번과 똑같은 "빈 요약"이라 원인 분리가 어렵다.

### 4. 거절이 정상 완료와 구분되지 않는다

`mapStopReason`이 `default`로 `end_turn`을 반환한다. `stop_reason: "refusal"`이 정상 완료와
같아 보인다.

## 측정 — 제외한 두 가지

설계 중 두 개선안을 실측으로 기각했다.

**Prompt caching은 불가능하다.** `prompts/commit-system-prompt.txt`는 `count_tokens` 실측
**508 토큰**이다. 최소 캐시 길이는 Opus 5·Fable 5가 512, Sonnet 5·Opus 4.8이 1024, Haiku 4.5가
4096이다. 가장 관대한 512에도 4 토큰 모자라 어느 모델에서도 캐시가 생성되지 않는다 — 오류 없이
`cache_creation_input_tokens: 0`이 될 뿐이다.

**Batch API는 실익이 없다.** 최근 30일 실적은 커밋 요약 511건, 지출 분류 298건, 내러티브 2건이다.
분류는 25건씩 묶으므로 **월 12회 호출**이고, 50% 할인의 절대액이 무시할 수준이다. 제출·폴링·수령
흐름을 새로 만들 이유가 없다.

전체 AI 지출이 월 5달러 안팎이므로 **모델 선택은 비용 문제가 아니라 품질 문제**다.

## 설계

### 1. 모델 능력 표

한 어댑터가 세대가 다른 모델을 함께 섬긴다. Haiku 4.5는 `temperature`를 수용하고 `effort`를
거부하며, Sonnet 5·Opus 5는 정반대다. 호출부가 잘못된 파라미터를 넘기면 런타임 400이 난다.

`claude.ts`에 모델별 수용 파라미터 표를 두고, 어댑터가 지원하지 않는 파라미터를 요청에서 제외하며
`logger.warn`을 남긴다. 조용히 버리지 않는 이유는, 호출부의 의도(예: 결정성)가 사라진 것을
운영자가 알아야 하기 때문이다.

```ts
export interface AIGenerateOptions {
  system?: string;
  prompt: string;
  maxTokens?: number;
  stopSequences?: string[];
  /** 구세대 모델(Haiku 4.5)만 수용. Sonnet 5 / Opus 5는 400을 반환한다. */
  temperature?: number;
  thinking?: "adaptive" | "disabled";
  effort?: "low" | "medium" | "high";
}
```

### 2. 응답 파싱

```ts
const text = response.content.find((block) => block.type === "text")?.text ?? "";
```

`AIGenerateResult.stopReason`에 `"refusal"`을 추가하고 `mapStopReason`이 그대로 전달한다.

### 3. 워크로드별 모델·정책

| 워크로드 | 모델 | thinking | effort | maxTokens | timeout |
|---|---|---|---|---|---|
| 커밋 요약 | `claude-sonnet-5` | disabled | low | 300 유지 | 60s |
| 기간 내러티브 | `claude-opus-5` | adaptive | **medium** | **8,000** | 120s |
| 월/연 리포트 | `claude-opus-5` | adaptive | **medium** | **8,000** | 120s |
| 지출 분류 | `claude-haiku-4-5` (변경 없음) | — | — | 현행 | 60s |

커밋 요약과 내러티브·리포트의 정책이 갈리는 이유는 성격이 반대이기 때문이다. 커밋 요약은 하루
17건씩 나오는 짧은 정형 출력이라 사고가 필요 없고, 내러티브·리포트는 월 몇 건이면서 판단이 핵심인
긴 글이라 사고가 값을 한다.

`effort`를 내러티브·리포트에 **명시적으로 `medium`으로 지정**한다. 생략하면 기본값이 `high`인데,
두 워크로드는 이미 계산이 끝난 집계를 글로 옮기는 일이라 깊은 사고가 필요 없고, `high`에서 사고가
수천 토큰을 쓰면 8,000 한도가 빠듯해진다. `medium`은 사고 예산을 묶어 응답 공간을 보장한다.

maxTokens 8,000은 thinking과 응답이 한도를 나눠 쓰기 때문이며, 비스트리밍 권장 상한(~16,000)
안이라 스트리밍 도입이 필요 없다. timeout 120s는 크론 10분 틱 안쪽이라 기존 주석의 의도
("느린 응답이 크론 틱을 넘지 못하게")를 유지한다.

**배포 후 확인할 것**: 내러티브 응답의 `stop_reason`이 `max_tokens`로 오는지 본다. 그렇다면
사고가 한도를 먹은 것이므로 maxTokens를 올리거나 `effort`를 `low`로 내린다.

### 4. 지출 분류 — structured outputs

`output_config.format`에 JSON 스키마를 넘기고 `extractJson`(코드펜스 제거 + `JSON.parse`)을
삭제한다. Haiku 4.5는 structured outputs를 지원한다. `temperature: 0`은 유지한다.

현재는 파싱 실패 시 배치 25건이 통째로 실패 처리되는데(`category-classifier.ts:156`의
"Expense classification batch failed"), 그 경로 자체가 사라진다. 이것은 비용이 아니라 견고성
개선이다.

### 5. SDK `0.52.0` → `0.115.0`

## 테스트

`claude.ts`에 테스트가 없다. 어댑터는 요청 조립과 응답 파싱뿐이라 SDK를 모킹해 검증할 수 있다.
`src/lib/adapters/withings/withings.test.ts`가 같은 디렉터리 계열의 모킹 선례다.

- thinking 블록이 앞에 오는 응답에서 text 블록을 찾아낸다 — **현재 코드로는 반드시 실패해야 한다**
- Sonnet 5에 `temperature`를 넘기면 요청 본문에서 제외되고 경고가 남는다
- Haiku 4.5에 `effort`를 넘기면 요청 본문에서 제외되고 경고가 남는다
- Haiku 4.5에 `temperature`를 넘기면 요청 본문에 **포함된다**
- `stop_reason: "refusal"`이 결과에 그대로 전달된다
- text 블록이 없는 응답에서 빈 문자열을 반환하고 예외를 던지지 않는다

## 범위 밖

- **Batch API** — 위 측정 참조
- **Prompt caching** — 위 측정 참조
- **스트리밍** — maxTokens 8,000은 비스트리밍 한도 안
- `report/service.ts`의 프롬프트 내용 조정 — 모델이 바뀌면 톤이 달라질 수 있으나, 실제 출력을 보고
  판단할 일이지 이번 변경에 묶을 일이 아니다
- Sonnet 5의 thinking 비활성화 경로는 Opus 5에서 보고된 부작용(도구 호출이 텍스트로 새는 문제,
  `<thinking>` 태그 누출)과 다른 모델이며 우리는 도구를 쓰지 않는다. 다만 배포 후 커밋 요약 출력에
  태그가 섞이는지는 한 번 확인한다

## 스키마

변경 없음.
