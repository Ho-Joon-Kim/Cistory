# Anthropic SDK·모델 마이그레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SDK를 `0.115.0`으로 올리고 워크로드별로 현행 모델을 쓰되, 모델을 올리는 순간 조용히 깨지는 두 지점(첫 블록만 읽는 응답 파싱, 항상 전송되는 `temperature`)을 먼저 고친다.

**Architecture:** `ClaudeAdapter`에 모델별 수용 파라미터 표를 두어 지원하지 않는 파라미터를 요청에서 제외하고 경고를 남긴다. 응답은 첫 블록이 아니라 text 블록을 찾아 읽는다. 호출부는 워크로드 성격에 따라 모델·thinking·effort를 명시한다. 지출 분류는 structured outputs로 바꿔 수동 JSON 파싱을 없앤다.

**Tech Stack:** TypeScript 5 (strict), `@anthropic-ai/sdk`, Vitest (콜로케이트 `*.test.ts`), Biome.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-06-anthropic-model-migration-design.md`
- 모델 문자열은 **날짜 접미사 없이** 정확히 이 값들만 쓴다: `claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5`.
- `temperature` / `top_p` / `top_k`는 Sonnet 5·Opus 5에서 **400**이다. Haiku 4.5는 수용한다.
- `effort`는 Haiku 4.5에서 **오류**다. Sonnet 5·Opus 5만 수용한다.
- `max_tokens`는 thinking과 응답 텍스트를 **합쳐** 제한한다.
- Batch API·prompt caching·스트리밍은 **범위 밖** — 스펙에서 실측으로 기각했다.
- 스키마 변경 없음, 마이그레이션 없음.
- Biome을 저장소 전체로 돌리지 않는다(무관한 파일 ~20개에 import 정렬 드리프트). 자기 파일만: `npx biome check --write <files>`. 이후 `git status --short`에 자기 파일만 있는지 확인.
- 커밋 제목은 Conventional Commit.
- **이 저장소는 GPG 서명 커밋을 요구한다.** 커밋이 `gpg: signing failed`로 실패하면 우회하지 말고 그 상태로 보고한다.
- 실제 Anthropic API를 호출하지 않는다. 테스트는 SDK를 모킹한다.

---

### Task 1: SDK `0.52.0` → `0.115.0`

**Files:**
- Modify: `package.json`, `yarn.lock`

**Interfaces:**
- Produces: 새 SDK 위에서 컴파일되는 트리. 동작 변경 없음.

63개 마이너 버전을 건너뛰므로 타입이 바뀌었을 수 있다. 이 태스크는 **버전만** 올리고 그로 인한 컴파일 오류만 고친다. 모델·파라미터·파싱은 손대지 않는다 — 그것들은 Task 2·3의 일이며, 여기서 섞으면 어떤 변경이 무엇을 깼는지 분리할 수 없다.

- [ ] **Step 1: 업그레이드**

```bash
yarn up @anthropic-ai/sdk@0.115.0
```

- [ ] **Step 2: 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 통과. 오류가 나면 `src/lib/adapters/ai/claude.ts`에서 타입 이름·시그니처만 새 SDK에 맞춘다. **동작을 바꾸지 않는다** — `temperature`는 아직 그대로 보내고 `content[0]`도 그대로 둔다.

- [ ] **Step 3: 전체 테스트**

Run: `yarn test`
Expected: 802 통과 (현재 기준선).

- [ ] **Step 4: 커밋**

```bash
git add package.json yarn.lock
git commit -m "chore(deps): upgrade @anthropic-ai/sdk to 0.115.0"
```

컴파일 오류 수정이 있었다면 `src/lib/adapters/ai/claude.ts`도 함께 스테이징하고, 무엇을 왜 고쳤는지 커밋 본문에 적는다.

---

### Task 2: `ClaudeAdapter` — 능력 표·응답 파싱·거절 처리

**Files:**
- Modify: `src/lib/adapters/ai/claude.ts`
- Test: `src/lib/adapters/ai/claude.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 SDK
- Produces:
  - `export const CLAUDE_MODELS = { COMMIT_SUMMARY: "claude-sonnet-5", NARRATIVE: "claude-opus-5", EXPENSE_CLASSIFIER: "claude-haiku-4-5" } as const`
  - `export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS]`
  - `AIGenerateOptions`에 `thinking?: "adaptive" | "disabled"`, `effort?: "low" | "medium" | "high"` 추가 (`temperature`는 유지)
  - `AIGenerateResult.stopReason`에 `"refusal"` 추가
  - `createClaudeAdapter(apiKey: string, model?: ClaudeModel, timeoutMs?: number)`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/adapters/ai/claude.test.ts`:

```ts
// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
    constructor(_opts: unknown) {}
  },
}));

import { CLAUDE_MODELS, createClaudeAdapter } from "./claude";

function reply(content: unknown[], stopReason = "end_turn") {
  return {
    content,
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

/** The request body the adapter passed to messages.create on its last call. */
function lastRequest(): Record<string, unknown> {
  return createMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  createMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ClaudeAdapter response parsing", () => {
  it("finds the text block even when a thinking block comes first", async () => {
    // Sonnet 5 and Opus 5 run adaptive thinking by default, so content[0] is a
    // thinking block. Reading only content[0] yields an empty summary with no
    // error — the exact silent failure this change exists to prevent.
    createMock.mockResolvedValueOnce(
      reply([
        { type: "thinking", thinking: "internal reasoning" },
        { type: "text", text: "실제 요약" },
      ])
    );

    const result = await createClaudeAdapter("k", CLAUDE_MODELS.NARRATIVE).generateText({
      prompt: "p",
    });

    expect(result.content).toBe("실제 요약");
  });

  it("returns an empty string without throwing when there is no text block", async () => {
    createMock.mockResolvedValueOnce(reply([{ type: "thinking", thinking: "only thinking" }]));

    const result = await createClaudeAdapter("k", CLAUDE_MODELS.NARRATIVE).generateText({
      prompt: "p",
    });

    expect(result.content).toBe("");
  });

  it("surfaces a refusal instead of reporting it as a normal completion", async () => {
    createMock.mockResolvedValueOnce(reply([{ type: "text", text: "" }], "refusal"));

    const result = await createClaudeAdapter("k", CLAUDE_MODELS.NARRATIVE).generateText({
      prompt: "p",
    });

    expect(result.stopReason).toBe("refusal");
  });
});

describe("ClaudeAdapter model capabilities", () => {
  it("drops temperature for a model that rejects sampling params", async () => {
    createMock.mockResolvedValueOnce(reply([{ type: "text", text: "ok" }]));

    await createClaudeAdapter("k", CLAUDE_MODELS.COMMIT_SUMMARY).generateText({
      prompt: "p",
      temperature: 0.5,
    });

    expect(lastRequest()).not.toHaveProperty("temperature");
  });

  it("keeps temperature for a model that accepts it", async () => {
    createMock.mockResolvedValueOnce(reply([{ type: "text", text: "ok" }]));

    await createClaudeAdapter("k", CLAUDE_MODELS.EXPENSE_CLASSIFIER).generateText({
      prompt: "p",
      temperature: 0,
    });

    expect(lastRequest().temperature).toBe(0);
  });

  it("drops effort for a model that rejects it", async () => {
    createMock.mockResolvedValueOnce(reply([{ type: "text", text: "ok" }]));

    await createClaudeAdapter("k", CLAUDE_MODELS.EXPENSE_CLASSIFIER).generateText({
      prompt: "p",
      effort: "low",
    });

    expect(lastRequest()).not.toHaveProperty("output_config");
  });

  it("sends thinking and effort for a model that accepts them", async () => {
    createMock.mockResolvedValueOnce(reply([{ type: "text", text: "ok" }]));

    await createClaudeAdapter("k", CLAUDE_MODELS.COMMIT_SUMMARY).generateText({
      prompt: "p",
      thinking: "disabled",
      effort: "low",
    });

    expect(lastRequest().thinking).toEqual({ type: "disabled" });
    expect(lastRequest().output_config).toEqual({ effort: "low" });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `yarn test src/lib/adapters/ai/claude.test.ts`
Expected: FAIL. 첫 테스트는 `expected '' to be '실제 요약'`(현재 `content[0]`만 읽음), 능력 표 테스트들은 `CLAUDE_MODELS` 미존재로 import 오류.

- [ ] **Step 3: 구현**

`claude.ts`를 아래 형태로 바꾼다. `generateText`의 try/catch 로깅과 `createClaudeAdapter` 팩토리는 유지한다.

```ts
/** 워크로드별 모델. 문자열에 날짜 접미사를 붙이지 않는다. */
export const CLAUDE_MODELS = {
  COMMIT_SUMMARY: "claude-sonnet-5",
  NARRATIVE: "claude-opus-5",
  EXPENSE_CLASSIFIER: "claude-haiku-4-5",
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

export const DEFAULT_CLAUDE_MODEL: ClaudeModel = CLAUDE_MODELS.COMMIT_SUMMARY;

interface ModelCapabilities {
  /** temperature/top_p/top_k. Sonnet 5·Opus 5는 400으로 거부한다. */
  sampling: boolean;
  /** thinking 파라미터. */
  thinking: boolean;
  /** output_config.effort. Haiku 4.5는 오류를 낸다. */
  effort: boolean;
}

// Record<ClaudeModel, …>라 모델을 추가하면 컴파일러가 항목 누락을 잡는다.
const MODEL_CAPABILITIES: Record<ClaudeModel, ModelCapabilities> = {
  "claude-sonnet-5": { sampling: false, thinking: true, effort: true },
  "claude-opus-5": { sampling: false, thinking: true, effort: true },
  "claude-haiku-4-5": { sampling: true, thinking: false, effort: false },
};
```

`AIGenerateOptions`에 두 필드를 추가하고 `temperature` 주석을 갱신한다:

```ts
export interface AIGenerateOptions {
  system?: string;
  prompt: string;
  maxTokens?: number;
  stopSequences?: string[];
  /** 구세대 모델(Haiku 4.5)만 수용. Sonnet 5 / Opus 5에 보내면 400이므로 제외된다. */
  temperature?: number;
  thinking?: "adaptive" | "disabled";
  effort?: "low" | "medium" | "high";
}
```

`AIGenerateResult.stopReason`을 `"end_turn" | "max_tokens" | "stop_sequence" | "refusal"`로 넓히고 `mapStopReason`에 `case "refusal": return "refusal";`을 추가한다.

`generateText` 본문:

```ts
  async generateText(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const { system, prompt, maxTokens = 1024, stopSequences } = options;
    const caps = MODEL_CAPABILITIES[this.model];

    // 지원하지 않는 파라미터는 요청에서 빼되 조용히 버리지 않는다. 호출부의
    // 의도(예: temperature 0의 결정성)가 사라진 것을 운영자가 알아야 한다.
    const drop = (name: string) =>
      logger.warn("Claude option dropped — model does not accept it", {
        model: this.model,
        option: name,
      });

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      system: system ?? undefined,
      messages: [{ role: "user", content: prompt }],
    };
    if (stopSequences?.length) body.stop_sequences = stopSequences;

    if (options.temperature !== undefined) {
      if (caps.sampling) body.temperature = options.temperature;
      else drop("temperature");
    }
    if (options.thinking !== undefined) {
      if (caps.thinking) body.thinking = { type: options.thinking };
      else drop("thinking");
    }
    if (options.effort !== undefined) {
      if (caps.effort) body.output_config = { effort: options.effort };
      else drop("effort");
    }

    try {
      const response = await this.client.messages.create(
        body as Parameters<typeof this.client.messages.create>[0]
      );

      // content[0]이 아니라 text 블록을 찾는다 — adaptive thinking이 켜진
      // 모델은 첫 블록이 thinking이라 content[0]만 읽으면 빈 문자열이 된다.
      const text =
        response.content.find(
          (block): block is Extract<typeof block, { type: "text" }> => block.type === "text"
        )?.text ?? "";
      …
```

생성자는 timeout을 받도록 넓힌다:

```ts
  constructor(apiKey: string, model: ClaudeModel = DEFAULT_CLAUDE_MODEL, timeoutMs = 60_000) {
    // 기본 60s는 느린 응답이 10분 크론 틱을 넘지 못하게 하는 상한이다.
    // thinking을 켜는 워크로드는 호출부가 더 큰 값을 넘긴다.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });
    this.model = model;
  }
```

`createClaudeAdapter(apiKey: string, model?: ClaudeModel, timeoutMs?: number)`로 시그니처를 맞춘다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `yarn test src/lib/adapters/ai/claude.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 좁아진 시그니처가 깨뜨리는 호출부를 이 태스크에서 고친다**

`createClaudeAdapter`의 2번째 인자를 `ClaudeModel`로 좁히면 **딱 한 곳**이 깨진다.
`src/modules/spending/category-classifier.ts:93,99`가 `model: string`을 넘긴다:

```ts
export class ExpenseCategoryService {
  private ai: ClaudeAdapter;
  private model: string;                       // ← ClaudeModel로
  constructor(
    private db: Database,
    anthropicApiKey: string,
    model: string = EXPENSE_CLASSIFIER_MODEL   // ← ClaudeModel로
  ) {
```

두 `string`을 `ClaudeModel`로 바꾼다. 같은 파일의 `createExpenseCategoryService` 팩토리에도
`model?: string` 파라미터가 있으면 함께 좁힌다. **분류기의 다른 부분(프롬프트, 파싱, 배치 로직)은
건드리지 않는다** — 그것은 Task 4의 일이다.

나머지 4개 호출부(`api/overview/narrative/route.ts:31`, `report/service.ts:1468`,
`overview/cron.ts:66`, `summary/service.ts:46`)는 모델 인자 없이 부르므로 이 태스크에서는
바뀌지 않는다. 모델을 명시하는 것은 Task 3의 일이다.

이유: 타입 오류가 남은 커밋을 만들지 않기 위해서다. 커밋되는 트리는 항상 컴파일되어야 한다.

- [ ] **Step 6: 전체 확인**

Run: `yarn test && npx tsc --noEmit`
Expected: 둘 다 통과. 오류가 남아 있으면 좁힌 시그니처가 예상보다 넓게 퍼진 것이므로 멈추고 보고한다.

- [ ] **Step 7: 커밋**

```bash
npx biome check --write src/lib/adapters/ai/claude.ts src/lib/adapters/ai/claude.test.ts src/modules/spending/category-classifier.ts
git add src/lib/adapters/ai/ src/modules/spending/category-classifier.ts
git commit -m "fix(ai): read the text block, not content[0], and gate params by model"
```

---

### Task 3: 호출부 — 모델·thinking·effort·maxTokens

**Files:**
- Modify: `src/modules/summary/service.ts` (146행 부근)
- Modify: `src/modules/overview/narrative.ts` (158행 부근)
- Modify: `src/modules/report/service.ts` (1468-1472행 부근)

**Interfaces:**
- Consumes: Task 2의 `CLAUDE_MODELS`, `createClaudeAdapter(apiKey, model?, timeoutMs?)`, `AIGenerateOptions`

- [ ] **Step 1: 커밋 요약**

`src/modules/summary/service.ts`의 `generateText` 호출에서 `temperature: 0.5`를 지우고 `thinking`/`effort`를 넣는다. `maxTokens: 300`은 그대로 둔다 — thinking을 껐으므로 300 전부가 응답 몫이다.

```ts
        maxTokens: 300,
        // 짧은 정형 출력이라 사고가 필요 없다. thinking을 끄면 maxTokens 300이
        // 전부 요약 몫이 되고, effort low가 이전 temperature 0.5 자리의
        // 결정성을 대신한다.
        thinking: "disabled",
        effort: "low",
```

이 파일이 어댑터를 만드는 지점을 찾아 모델을 `CLAUDE_MODELS.COMMIT_SUMMARY`로 명시한다. 기본값과 같더라도 명시하는 편이 워크로드 의도를 드러낸다.

- [ ] **Step 2: 기간 내러티브**

`src/modules/overview/narrative.ts:158`:

```ts
      const result = await ai.generateText({
        ...prompt,
        maxTokens: 8000,
        thinking: "adaptive",
        effort: "medium",
      });
```

`temperature: 0.6`을 제거한다. maxTokens를 1,600에서 8,000으로 올리는 이유는 thinking과 응답이 같은 한도를 나눠 쓰기 때문이다. `effort`를 `medium`으로 명시하는 이유는 생략 시 기본값이 `high`이고, 이 워크로드는 이미 계산된 집계를 글로 옮기는 일이라 깊은 사고가 불필요하며 사고가 한도를 먹으면 응답이 잘리기 때문이다.

어댑터 생성 지점(`src/app/api/overview/narrative/route.ts:31`과 `src/modules/overview/cron.ts:66`, 둘 다 `createClaudeAdapter(apiKey)`)에 모델과 timeout을 넘긴다:

```ts
createClaudeAdapter(apiKey, CLAUDE_MODELS.NARRATIVE, 120_000)
```

- [ ] **Step 3: 월/연 리포트**

`src/modules/report/service.ts:1468-1472`에서 `temperature: 0.7`을 제거하고 같은 정책을 적용한다:

```ts
    const ai = createClaudeAdapter(this.anthropicApiKey, CLAUDE_MODELS.NARRATIVE, 120_000);
    …
      maxTokens: 8000,
      thinking: "adaptive",
      effort: "medium",
```

- [ ] **Step 4: 남은 temperature가 없는지 확인**

Run: `grep -rn "temperature" src/modules/summary/ src/modules/overview/ src/modules/report/`
Expected: 출력 없음. 분류기(`src/modules/spending/`)의 `temperature: 0`은 Haiku 4.5가 수용하므로 남는다 — 이 grep 범위에 포함하지 않는다.

- [ ] **Step 5: 전체 확인**

Run: `yarn test && npx tsc --noEmit`
Expected: 둘 다 통과.

- [ ] **Step 6: 커밋**

```bash
npx biome check --write src/modules/summary/service.ts src/modules/overview/narrative.ts src/modules/report/service.ts src/app/api/overview/narrative/route.ts src/modules/overview/cron.ts
git add src/
git commit -m "feat(ai): pick model and thinking policy per workload"
```

---

### Task 4: 지출 분류 — structured outputs

**Files:**
- Modify: `src/modules/spending/category-classifier.ts`
- Test: `src/modules/spending/category-classifier.test.ts` (있으면 추가, 없으면 신규)

**Interfaces:**
- Consumes: Task 2의 `AIGenerateOptions`, `CLAUDE_MODELS.EXPENSE_CLASSIFIER`

지금은 응답에서 코드펜스를 벗기고 `JSON.parse` 후 zod로 검증한다(`extractJson`, 39행 부근). 파싱이 실패하면 배치 25건이 통째로 실패 처리된다(156행 "Expense classification batch failed"). Haiku 4.5는 structured outputs를 지원하므로 스키마를 API에 넘겨 그 경로를 없앤다.

- [ ] **Step 1: 어댑터에 output format 전달 경로 추가**

`AIGenerateOptions`에 필드를 하나 더 넣는다 (Task 2에서 만든 인터페이스):

```ts
  /** JSON Schema. 지정하면 응답이 그 스키마를 따르도록 API가 강제한다. */
  outputSchema?: Record<string, unknown>;
```

`generateText`에서 `body.output_config`를 구성할 때 effort와 합친다 — 둘 다 `output_config` 아래 들어가므로 따로 대입하면 서로를 덮어쓴다:

```ts
    const outputConfig: Record<string, unknown> = {};
    if (options.effort !== undefined) {
      if (caps.effort) outputConfig.effort = options.effort;
      else drop("effort");
    }
    if (options.outputSchema !== undefined) {
      outputConfig.format = { type: "json_schema", schema: options.outputSchema };
    }
    if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;
```

`claude.test.ts`에 케이스를 추가한다: `effort`와 `outputSchema`를 함께 넘기면 `output_config`에 **두 키가 모두** 존재한다. 한쪽이 다른 쪽을 덮어쓰는 회귀를 고정한다.

- [ ] **Step 2: 실패하는 분류기 테스트 작성**

기존 테스트 파일이 있으면 그 구조를 따르고, 없으면 `claude.test.ts`와 같은 SDK 모킹 방식으로 만든다. 검증할 것:

- `classifyExpenses`가 어댑터에 `outputSchema`를 넘긴다 (스키마의 `required`에 `classifications`가 있고 `additionalProperties`가 `false`)
- 코드펜스 없는 순수 JSON 응답을 파싱한다
- **코드펜스로 감싼 응답도 여전히 파싱한다** — structured outputs를 켜도 모델이 펜스를 붙일 가능성이 완전히 0은 아니고, 이 폴백을 지우면 그때 배치 전체가 실패한다

세 번째 항목 때문에 `extractJson`을 **삭제하지 않고 폴백으로 남긴다.** 스펙은 삭제한다고 했으나, 구조화 출력이 보장을 주더라도 폴백 제거의 이득(코드 몇 줄)보다 실패 시 손해(25건 통째 실패)가 크다. 이 판단을 코드 주석에 남긴다.

- [ ] **Step 3: 구현**

`responseSchema`(zod)는 **검증용으로 유지**한다 — API가 스키마를 강제해도 우리 쪽 타입 가드(`isExpenseCategory`)는 여전히 필요하다. 여기에 API로 보낼 JSON Schema를 추가한다:

```ts
/** Sent to the API so the response shape is enforced server-side. The zod
 * schema above still runs on the result — it additionally checks that each
 * category is one of ours, which JSON Schema's enum could express but which we
 * keep in one place. */
const OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: [...EXPENSE_CATEGORIES] },
          confidence: { type: "integer" },
        },
        required: ["id", "category", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["classifications"],
  additionalProperties: false,
} as const;
```

`classifyExpenses`의 `generateText` 호출에 `outputSchema: OUTPUT_JSON_SCHEMA`를 추가한다. `temperature: 0`은 유지한다 — Haiku 4.5가 수용하고 결정성이 목적이다.

어댑터 생성 지점의 모델을 `CLAUDE_MODELS.EXPENSE_CLASSIFIER`로 맞춘다. `EXPENSE_CLASSIFIER_MODEL` 상수가 이미 같은 값이면 `CLAUDE_MODELS`를 참조하도록 바꿔 한 곳에서만 정의되게 한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `yarn test src/modules/spending/ src/lib/adapters/ai/`
Expected: PASS

- [ ] **Step 5: 전체 확인 후 커밋**

```bash
yarn test && npx tsc --noEmit && yarn build
npx biome check --write src/modules/spending/category-classifier.ts src/lib/adapters/ai/claude.ts src/lib/adapters/ai/claude.test.ts
git add src/
git commit -m "feat(spending): enforce the classification schema server-side"
```

---

## Self-Review

**스펙 커버리지**

| 스펙 절 | 담당 태스크 |
|---|---|
| 1. 모델 능력 표 | Task 2 |
| 2. 응답 파싱 + refusal | Task 2 |
| 3. 워크로드별 모델·정책 | Task 3 (분류기는 Task 4) |
| 4. structured outputs | Task 4 |
| 5. SDK 업그레이드 | Task 1 |
| 테스트 6항목 | Task 2 (5개), Task 4 (나머지 + output_config 병합) |

**스펙과의 차이 1건 (의도적)** — 스펙 4절은 `extractJson` 삭제를 지시하나, 계획은 폴백으로 유지한다. 사유는 Task 4 Step 2에 적었다: 구조화 출력이 보장을 주더라도, 폴백 제거의 이득(코드 몇 줄)이 실패 시 손해(배치 25건 통째 실패)보다 작다.

**타입 일관성** — `CLAUDE_MODELS`/`ClaudeModel`은 Task 2에서 정의되고 Task 3·4에서 같은 이름으로 쓰인다. `AIGenerateOptions`의 `thinking`/`effort`는 Task 2에서, `outputSchema`는 Task 4 Step 1에서 같은 인터페이스에 추가된다. `createClaudeAdapter(apiKey, model?, timeoutMs?)`의 3-인자 형태를 Task 3이 사용한다.

**플레이스홀더** — Task 1 Step 2·4는 컴파일 오류가 있을 때만 조건부로 동작하며 그때 무엇을 해야 하는지(타입 이름만 맞추고 동작은 유지) 명시했다. Task 4 Step 2는 기존 테스트 파일 유무 양쪽 경로를 적었다. 그 외 미확정 항목은 없다.
