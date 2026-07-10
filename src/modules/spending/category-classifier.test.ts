import { describe, expect, it, vi } from "vitest";
import type { ClaudeAdapter } from "@/lib/adapters/ai/claude";
import { buildExpenseClassificationPrompt, classifyExpenses } from "./category-classifier";

const input = [
  {
    id: "tx-1",
    merchant: "한국철도공사",
    amount: 59_800,
    rawTitle: "59,800원 결제",
    rawText: "토스페이 | 한국철도공사",
  },
];

function mockAi(content: string): Pick<ClaudeAdapter, "generateText"> {
  return {
    generateText: vi.fn().mockResolvedValue({
      content,
      usage: { inputTokens: 10, outputTokens: 10 },
      stopReason: "end_turn",
    }),
  };
}

describe("expense category classifier", () => {
  it("builds a prompt with the allowed categories and transaction IDs", () => {
    const prompt = buildExpenseClassificationPrompt(input);
    expect(prompt).toContain("transport");
    expect(prompt).toContain("tx-1");
  });

  it("parses a valid JSON response", async () => {
    const result = await classifyExpenses(
      mockAi('{"classifications":[{"id":"tx-1","category":"transport","confidence":98}]}'),
      input
    );

    expect(result).toEqual([{ id: "tx-1", category: "transport", confidence: 98 }]);
  });

  it("accepts JSON wrapped in a markdown fence", async () => {
    const result = await classifyExpenses(
      mockAi(
        '```json\n{"classifications":[{"id":"tx-1","category":"travel","confidence":80}]}\n```'
      ),
      input
    );

    expect(result[0]?.category).toBe("travel");
  });

  it("rejects categories outside the closed set", async () => {
    await expect(
      classifyExpenses(
        mockAi('{"classifications":[{"id":"tx-1","category":"restaurant","confidence":90}]}'),
        input
      )
    ).rejects.toThrow();
  });

  it("drops duplicate and unexpected transaction IDs", async () => {
    const result = await classifyExpenses(
      mockAi(
        '{"classifications":[' +
          '{"id":"tx-1","category":"transport","confidence":98},' +
          '{"id":"tx-1","category":"travel","confidence":50},' +
          '{"id":"tx-2","category":"food","confidence":50}]}'
      ),
      input
    );

    expect(result).toEqual([{ id: "tx-1", category: "transport", confidence: 98 }]);
  });
});
