import Anthropic from "@anthropic-ai/sdk";
import type {
  AIAdapter,
  AIGenerateOptions,
  AIGenerateResult,
  AIStreamOptions,
} from "./interface";

const MODEL_ID = "claude-sonnet-4-20250514";
const MAX_CONTEXT_TOKENS = 200000;

export class ClaudeAdapter implements AIAdapter {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateText(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const { system, prompt, maxTokens = 1024, temperature = 0.7 } = options;

    const response = await this.client.messages.create({
      model: MODEL_ID,
      max_tokens: maxTokens,
      temperature,
      system: system ?? undefined,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    const text = content.type === "text" ? content.text : "";

    return {
      content: text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: this.mapStopReason(response.stop_reason),
    };
  }

  async generateTextStream(options: AIStreamOptions): Promise<AIGenerateResult> {
    const { system, prompt, maxTokens = 1024, temperature = 0.7, onToken } =
      options;

    let fullContent = "";
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = await this.client.messages.stream({
      model: MODEL_ID,
      max_tokens: maxTokens,
      temperature,
      system: system ?? undefined,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        const token = event.delta.text;
        fullContent += token;
        onToken?.(token);
      }

      if (event.type === "message_delta" && event.usage) {
        outputTokens = event.usage.output_tokens;
      }
    }

    const finalMessage = await stream.finalMessage();
    inputTokens = finalMessage.usage.input_tokens;

    return {
      content: fullContent,
      usage: {
        inputTokens,
        outputTokens,
      },
      stopReason: this.mapStopReason(finalMessage.stop_reason),
    };
  }

  async verifyApiKey(): Promise<boolean> {
    try {
      // 간단한 요청으로 API 키 검증
      await this.client.messages.create({
        model: MODEL_ID,
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      });
      return true;
    } catch {
      return false;
    }
  }

  getModelInfo() {
    return {
      provider: "Anthropic",
      model: MODEL_ID,
      maxContextTokens: MAX_CONTEXT_TOKENS,
    };
  }

  private mapStopReason(
    reason: string | null
  ): "end_turn" | "max_tokens" | "stop_sequence" {
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
}

export function createClaudeAdapter(apiKey: string): AIAdapter {
  return new ClaudeAdapter(apiKey);
}
