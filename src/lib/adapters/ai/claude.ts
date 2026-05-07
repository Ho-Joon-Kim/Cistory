import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/logger";

const MODEL_ID = "claude-sonnet-4-5";

export interface AIGenerateOptions {
  /** System prompt to set context */
  system?: string;
  /** User prompt */
  prompt: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature for randomness (0-1) */
  temperature?: number;
  /** Stop sequences */
  stopSequences?: string[];
}

export interface AIGenerateResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: "end_turn" | "max_tokens" | "stop_sequence";
}

export class ClaudeAdapter {
  private client: Anthropic;

  constructor(apiKey: string) {
    // 60s per-request ceiling so a slow Anthropic response can't outrun the
    // 10-min cron tick; SDK retries idempotent failures (5xx, 429, network).
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  }

  async generateText(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const { system, prompt, maxTokens = 1024, temperature = 0.7 } = options;

    try {
      const response = await this.client.messages.create({
        model: MODEL_ID,
        max_tokens: maxTokens,
        temperature,
        system: system ?? undefined,
        messages: [{ role: "user", content: prompt }],
      });

      const content = response.content[0];
      const text = content.type === "text" ? content.text : "";

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
        model: MODEL_ID,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function mapStopReason(reason: string | null): "end_turn" | "max_tokens" | "stop_sequence" {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}

export function createClaudeAdapter(apiKey: string): ClaudeAdapter {
  return new ClaudeAdapter(apiKey);
}
