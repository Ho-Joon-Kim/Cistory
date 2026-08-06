import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/logger";

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

export interface AIGenerateOptions {
  /** System prompt to set context */
  system?: string;
  /** User prompt */
  prompt: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** 구세대 모델(Haiku 4.5)만 수용. Sonnet 5 / Opus 5에 보내면 400이므로 제외된다. */
  temperature?: number;
  thinking?: "adaptive" | "disabled";
  effort?: "low" | "medium" | "high";
  /** JSON Schema. 지정하면 응답이 그 스키마를 따르도록 API가 강제한다. */
  outputSchema?: Record<string, unknown>;
}

export interface AIGenerateResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "refusal";
}

export class ClaudeAdapter {
  private client: Anthropic;
  private model: ClaudeModel;

  constructor(apiKey: string, model: ClaudeModel = DEFAULT_CLAUDE_MODEL, timeoutMs = 60_000) {
    // 기본 60s는 느린 응답이 10분 크론 틱을 넘지 못하게 하는 상한이다.
    // thinking을 켜는 워크로드는 호출부가 더 큰 값을 넘긴다.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });
    this.model = model;
  }

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

    const body: Anthropic.MessageCreateParamsNonStreaming = {
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
    // effort와 outputSchema는 둘 다 output_config 아래 들어간다. 따로
    // `body.output_config = {...}`로 대입하면 서로를 덮어쓰므로 하나의
    // 객체에 모아 한 번만 대입한다.
    const outputConfig: Anthropic.OutputConfig = {};
    if (options.effort !== undefined) {
      if (caps.effort) outputConfig.effort = options.effort;
      else drop("effort");
    }
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
}

function mapStopReason(
  reason: string | null
): "end_turn" | "max_tokens" | "stop_sequence" | "refusal" {
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
      return "end_turn";
  }
}

export function createClaudeAdapter(
  apiKey: string,
  model?: ClaudeModel,
  timeoutMs?: number
): ClaudeAdapter {
  return new ClaudeAdapter(apiKey, model, timeoutMs);
}
