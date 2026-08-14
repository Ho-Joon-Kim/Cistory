// TZ pinned to match production containers (TZ=Asia/Seoul).
process.env.TZ = "Asia/Seoul";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, countTokensMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  countTokensMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock, countTokens: countTokensMock };
    constructor(_opts: unknown) {}
  },
}));

import { logger } from "@/lib/logger";
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

/** The request body the adapter passed to messages.countTokens on its last call. */
function lastCountRequest(): Record<string, unknown> {
  return countTokensMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  createMock.mockReset();
  countTokensMock.mockReset();
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

  it("surfaces an unrecognized stop reason instead of laundering it into end_turn", async () => {
    // pause_turn, model_context_window_exceeded, or any value the API adds
    // later must stay distinguishable from a clean finish — the old default
    // branch collapsed all of these into "end_turn".
    createMock.mockResolvedValueOnce(
      reply([{ type: "text", text: "ok" }], "model_context_window_exceeded")
    );

    const result = await createClaudeAdapter("k", CLAUDE_MODELS.NARRATIVE).generateText({
      prompt: "p",
    });

    expect(result.stopReason).toBe("model_context_window_exceeded");
  });
});

describe("ClaudeAdapter model capabilities", () => {
  it("drops temperature for a model that rejects sampling params", async () => {
    // Dropping the param silently would erase the caller's intent (e.g.
    // temperature: 0 for deterministic classification) with no trace. An
    // operator must be able to see it happened.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    createMock.mockResolvedValueOnce(reply([{ type: "text", text: "ok" }]));

    await createClaudeAdapter("k", CLAUDE_MODELS.COMMIT_SUMMARY).generateText({
      prompt: "p",
      temperature: 0.5,
    });

    expect(lastRequest()).not.toHaveProperty("temperature");
    expect(warnSpy).toHaveBeenCalledWith(
      "Claude option dropped — model does not accept it",
      expect.objectContaining({ model: CLAUDE_MODELS.COMMIT_SUMMARY, option: "temperature" })
    );
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

  it("merges effort and outputSchema into the same output_config instead of one overwriting the other", async () => {
    createMock.mockResolvedValueOnce(reply([{ type: "text", text: "ok" }]));

    await createClaudeAdapter("k", CLAUDE_MODELS.COMMIT_SUMMARY).generateText({
      prompt: "p",
      effort: "low",
      outputSchema: { type: "object" },
    });

    expect(lastRequest().output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: { type: "object" } },
    });
  });

  it("routes countTokens through the same capability table as generateText", async () => {
    // countTokens must not become a parallel code path with its own rules: a
    // count taken with a different parameter combination than the request it
    // is sizing is a count of something the API will never be sent.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    countTokensMock.mockResolvedValueOnce({ input_tokens: 4242 });

    const tokens = await createClaudeAdapter("k", CLAUDE_MODELS.EXPENSE_CLASSIFIER).countTokens({
      prompt: "p",
      thinking: "adaptive",
    });

    expect(tokens).toBe(4242);
    expect(lastCountRequest()).not.toHaveProperty("thinking");
    expect(warnSpy).toHaveBeenCalledWith(
      "Claude option dropped — model does not accept it",
      expect.objectContaining({ model: CLAUDE_MODELS.EXPENSE_CLASSIFIER, option: "thinking" })
    );
  });

  it("sends outputSchema without effort for a model that rejects effort — the classifier's actual path", async () => {
    // Haiku 4.5 (the expense classifier) never sends effort — caps.effort is
    // false for it — but it does send outputSchema. The outputSchema branch
    // must not live inside `if (caps.effort)`, or structured outputs would be
    // silently disabled on exactly the model that uses them.
    createMock.mockResolvedValueOnce(reply([{ type: "text", text: "ok" }]));

    await createClaudeAdapter("k", CLAUDE_MODELS.EXPENSE_CLASSIFIER).generateText({
      prompt: "p",
      outputSchema: { type: "object" },
    });

    expect(lastRequest().output_config).toEqual({
      format: { type: "json_schema", schema: { type: "object" } },
    });
  });
});

describe("ClaudeAdapter countTokens", () => {
  it("counts the prompt without generating, and never touches messages.create", async () => {
    countTokensMock.mockResolvedValueOnce({ input_tokens: 1234 });

    const tokens = await createClaudeAdapter("k", CLAUDE_MODELS.NARRATIVE).countTokens({
      system: "sys",
      prompt: "p",
      thinking: "adaptive",
    });

    expect(tokens).toBe(1234);
    expect(createMock).not.toHaveBeenCalled();
    expect(lastCountRequest()).toEqual({
      model: CLAUDE_MODELS.NARRATIVE,
      system: "sys",
      messages: [{ role: "user", content: "p" }],
      thinking: { type: "adaptive" },
    });
  });

  it("omits system when the caller gives none", async () => {
    countTokensMock.mockResolvedValueOnce({ input_tokens: 7 });

    await createClaudeAdapter("k", CLAUDE_MODELS.NARRATIVE).countTokens({ prompt: "p" });

    expect(lastCountRequest().system).toBeUndefined();
    expect(lastCountRequest()).not.toHaveProperty("thinking");
  });

  it("logs and rethrows instead of returning a fabricated count", async () => {
    // A silently-zero count would read as "this input is tiny" to every
    // caller — the opposite of the truth when the API is unreachable.
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    countTokensMock.mockRejectedValueOnce(new Error("network down"));

    await expect(
      createClaudeAdapter("k", CLAUDE_MODELS.NARRATIVE).countTokens({ prompt: "p" })
    ).rejects.toThrow("network down");
    expect(errorSpy).toHaveBeenCalledWith(
      "Claude token counting error",
      expect.objectContaining({ model: CLAUDE_MODELS.NARRATIVE, error: "network down" })
    );
  });
});
