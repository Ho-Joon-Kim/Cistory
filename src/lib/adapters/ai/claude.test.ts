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
