/**
 * AI Adapter Interface
 *
 * Abstraction layer for AI/LLM services.
 * Currently supports Claude, designed for future extensibility (GPT, Gemini).
 */

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

export interface AIStreamOptions extends AIGenerateOptions {
  onToken?: (token: string) => void;
}

export interface AIAdapter {
  /**
   * Generate text completion
   */
  generateText(options: AIGenerateOptions): Promise<AIGenerateResult>;

  /**
   * Generate text with streaming
   */
  generateTextStream(options: AIStreamOptions): Promise<AIGenerateResult>;

  /**
   * Check if the API key is valid
   */
  verifyApiKey(): Promise<boolean>;

  /**
   * Get model information
   */
  getModelInfo(): {
    provider: string;
    model: string;
    maxContextTokens: number;
  };
}
