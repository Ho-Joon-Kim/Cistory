import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/logger";

/** 워크로드별 모델. 문자열에 날짜 접미사를 붙이지 않는다. */
export const CLAUDE_MODELS = {
  COMMIT_SUMMARY: "claude-sonnet-5-5",
  NARRATIVE: "claude-opus-5-5",
  EXPENSE_CLASSIFIER: "claude-haiku-5-5",
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

export const DEFAULT_CLAUDE_MODEL: ClaudeModel = CLAUDE_MODELS.COMMIT_SUMMARY;

/**
 * 호출부가 고르는 thinking 모드. "off"는 모델마다 철자가 달라 어댑터가
 * 아래 표로 번역한다 — 호출부는 와이어 값을 몰라도 된다.
 */
export type ThinkingMode = "adaptive" | "off";

// 세 모델 모두 adaptive thinking과 output_config.effort(low~max)를 받는다.
// 기본 effort는 Opus 5.5·Haiku 5.5가 medium, Sonnet 5.5가 high라 호출부가
// 명시하는 편이 안전하다. budget_tokens는 셋 다 400이라 옵션 자체가 없다.
// temperature/top_p/top_k도 없다: SDK 1.x가 보내는 API 버전 2026-10-21은
// 모든 모델에서 이 셋을 400으로 거부하고, SDK 타입에서도 빠졌다.
interface ModelCapabilities {
  /**
   * thinking을 끄는 와이어 값. 모델마다 다르다.
   * - Sonnet 5.5: `{type:"disabled"}`는 400. 대신 `between_tools`(다른 필드
   *   없이, effort high 이하에서만).
   * - Haiku 5.5: `disabled`를 effort high 이하에서만 받는다.
   * - Opus 5.5: 끌 수 없다(`disabled`는 모든 effort에서 400) — null이면
   *   옵션을 빼고 경고하며, 모델 기본값(adaptive)으로 돈다.
   * AIGenerateOptions.effort는 low|medium|high뿐이라 "high 이하" 제약은 타입이
   * 보장한다. xhigh/max를 추가할 때 이 제약을 다시 확인할 것.
   */
  thinkingOff: "disabled" | "between_tools" | null;
}

// Record<ClaudeModel, …>라 모델을 추가하면 컴파일러가 항목 누락을 잡는다.
const MODEL_CAPABILITIES: Record<ClaudeModel, ModelCapabilities> = {
  "claude-sonnet-5-5": { thinkingOff: "between_tools" },
  "claude-opus-5-5": { thinkingOff: null },
  "claude-haiku-5-5": { thinkingOff: "disabled" },
};

export interface AIGenerateOptions {
  /** System prompt to set context */
  system?: string;
  /** User prompt */
  prompt: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Stop sequences */
  stopSequences?: string[];
  thinking?: ThinkingMode;
  effort?: "low" | "medium" | "high";
  /** JSON Schema. 지정하면 응답이 그 스키마를 따르도록 API가 강제한다. */
  outputSchema?: Record<string, unknown>;
}

export interface AICountTokensOptions {
  /** System prompt to set context */
  system?: string;
  /** User prompt */
  prompt: string;
  /**
   * generateText와 같은 capability 표를 통과한다 — 계수 요청이 실제 생성
   * 요청과 다른 파라미터 조합으로 나가면 세는 값이 실제와 어긋난다.
   */
  thinking?: ThinkingMode;
}

export interface AIGenerateResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  // 알려진 네 값 외에는 원문 문자열을 그대로 통과시킨다(예: pause_turn,
  // model_context_window_exceeded, API가 나중에 추가할 값). `string & {}`는
  // 리터럴 자동완성을 유지하면서도 임의 문자열을 허용하는 TS 관용구다.
  stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "refusal" | (string & {});
}

export class ClaudeAdapter {
  private client: Anthropic;
  private model: ClaudeModel;

  constructor(apiKey: string, model: ClaudeModel = DEFAULT_CLAUDE_MODEL, timeoutMs = 60_000) {
    // 기본 60s는 요청 한 건이 걸릴 수 있는 시간의 상한일 뿐이다 — 배치 전체
    // 소요를 보장하지 않는다. processPendingSummaries는 유저당 커밋 20건을
    // 요청 사이 sleep과 함께 순차 처리하므로, 10분 동기화 틱을 지키는 것은
    // 이 값의 역할이 아니다. thinking을 켜는 워크로드는 호출부가 더 큰 값을
    // 넘긴다.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });
    this.model = model;
  }

  /**
   * 지원하지 않는 파라미터는 요청에서 빼되 조용히 버리지 않는다. 호출부의
   * 의도(예: effort low로 비용 상한을 둔 것)가 사라진 것을 운영자가 알아야 한다.
   * generateText와 countTokens가 같은 표를 보므로 경고도 한 곳에서 낸다.
   */
  private dropOption(name: string) {
    logger.warn("Claude option dropped — model does not accept it", {
      model: this.model,
      option: name,
    });
  }

  /** ThinkingMode를 이 모델의 와이어 값으로 바꾼다. 못 바꾸면 경고 후 undefined. */
  private thinkingParam(mode: ThinkingMode | undefined): Anthropic.ThinkingConfigParam | undefined {
    if (mode === undefined) return undefined;
    if (mode === "adaptive") return { type: "adaptive" };
    const off = MODEL_CAPABILITIES[this.model].thinkingOff;
    if (off === null) {
      this.dropOption("thinking");
      return undefined;
    }
    return { type: off };
  }

  async generateText(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const { system, prompt, maxTokens = 1024, stopSequences } = options;

    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: maxTokens,
      system: system ?? undefined,
      messages: [{ role: "user", content: prompt }],
    };
    if (stopSequences?.length) body.stop_sequences = stopSequences;

    const thinking = this.thinkingParam(options.thinking);
    if (thinking) body.thinking = thinking;
    // effort와 outputSchema는 둘 다 output_config 아래 들어간다. 따로
    // `body.output_config = {...}`로 대입하면 서로를 덮어쓰므로 하나의
    // 객체에 모아 한 번만 대입한다.
    const outputConfig: Anthropic.OutputConfig = {};
    if (options.effort !== undefined) outputConfig.effort = options.effort;
    if (options.outputSchema !== undefined) {
      outputConfig.format = { type: "json_schema", schema: options.outputSchema };
    }
    if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;

    try {
      const response = await this.client.messages.create(body);

      // content[0]이 아니라 text 블록을 찾는다 — adaptive thinking이 켜진
      // 모델은 첫 블록이 thinking이라 content[0]만 읽으면 빈 문자열이 된다.
      const text =
        response.content.find(
          (block): block is Extract<typeof block, { type: "text" }> => block.type === "text"
        )?.text ?? "";

      return {
        content: text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        stopReason: mapStopReason(response.stop_reason),
      };
    } catch (error) {
      logger.error("Claude API error", {
        model: this.model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 생성하지 않고 입력 토큰 수만 센다(`POST /v1/messages/count_tokens`).
   * generateText와 같은 capability 표를 통과하므로 모델이 거부하는
   * 파라미터는 여기서도 똑같이 빠진다.
   *
   * **네트워크 왕복이다.** 호출부가 호출 횟수를 직접 관리해야 하며,
   * 실패는 그대로 던진다 — 이 값 없이도 동작할 수 있는지(문자 수 폴백)는
   * 호출부가 결정할 문제이지 어댑터가 삼킬 문제가 아니다.
   */
  async countTokens(options: AICountTokensOptions): Promise<number> {
    const { system, prompt } = options;

    const body: Anthropic.MessageCountTokensParams = {
      model: this.model,
      system: system ?? undefined,
      messages: [{ role: "user", content: prompt }],
    };
    const thinking = this.thinkingParam(options.thinking);
    if (thinking) body.thinking = thinking;

    try {
      const response = await this.client.messages.countTokens(body);
      return response.input_tokens;
    } catch (error) {
      logger.error("Claude token counting error", {
        model: this.model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function mapStopReason(reason: string | null): AIGenerateResult["stopReason"] {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    case "refusal":
      return "refusal";
    default:
      // Surface the unrecognized reason instead of laundering it into
      // "end_turn" — pause_turn, model_context_window_exceeded, or anything
      // the API adds later must stay distinguishable from a clean finish.
      return reason ?? "end_turn";
  }
}

export function createClaudeAdapter(
  apiKey: string,
  model?: ClaudeModel,
  timeoutMs?: number
): ClaudeAdapter {
  return new ClaudeAdapter(apiKey, model, timeoutMs);
}
