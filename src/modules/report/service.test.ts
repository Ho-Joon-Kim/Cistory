import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock("@/lib/adapters/ai/claude", () => ({
  CLAUDE_MODELS: { NARRATIVE: "claude-opus-5" },
  createClaudeAdapter: vi.fn(() => ({ generateText: generateTextMock })),
}));

import type { Database } from "@/db";
import type { AIGenerateResult } from "@/lib/adapters/ai/claude";
import { aggregateReportBody, createReportService, type ReportBodyPoint } from "./service";

/** `_generateNarrative` never touches `db` — an empty stand-in is enough. */
const db = {} as Database;

function aiResult(overrides: Partial<AIGenerateResult> = {}): AIGenerateResult {
  return {
    content: "이번 달 요약입니다.",
    usage: { inputTokens: 10, outputTokens: 20 },
    stopReason: "end_turn",
    ...overrides,
  };
}

/**
 * `_generateNarrative` is private (TS-only enforcement, not JS `#private`),
 * so it's reachable at runtime through a narrow cast — this keeps the test
 * targeted at the guard itself rather than routing through the full
 * generateMonthlyNarrative/generateYearlyNarrative DB path.
 */
function generateNarrative(service: ReturnType<typeof createReportService>, prompt: string) {
  return (
    service as unknown as { _generateNarrative(p: string): Promise<string> }
  )._generateNarrative(prompt);
}

function pt(day: string, over: Partial<ReportBodyPoint> = {}): ReportBodyPoint {
  return {
    day,
    weightKg: null,
    fatRatioPct: null,
    muscleMassKg: null,
    visceralFat: null,
    ...over,
  };
}

describe("aggregateReportBody", () => {
  it("computes period averages, first→last change, range, and count", () => {
    const rows = [
      pt("2026-02-01", { weightKg: 71, fatRatioPct: 20, muscleMassKg: 55 }),
      pt("2026-02-10", { weightKg: 70, fatRatioPct: 19.5, muscleMassKg: 55.5 }),
      pt("2026-02-20", { weightKg: 69, fatRatioPct: 19, muscleMassKg: 56 }),
    ];

    const r = aggregateReportBody(rows);

    expect(r.measurementCount).toBe(3);
    expect(r.avgWeightKg).toBeCloseTo(70, 5);
    expect(r.weightChangeKg).toBeCloseTo(-2, 5); // 69 - 71
    expect(r.fatRatioChangePct).toBeCloseTo(-1, 5);
    expect(r.muscleChangeKg).toBeCloseTo(1, 5);
    expect(r.weightMinKg).toBe(69);
    expect(r.weightMaxKg).toBe(71);
    expect(r.weightSeries).toHaveLength(3);
  });

  it("returns nulls and an empty series when the period has no measurements", () => {
    const r = aggregateReportBody([]);

    expect(r.measurementCount).toBe(0);
    expect(r.avgWeightKg).toBeNull();
    expect(r.weightChangeKg).toBeNull();
    expect(r.weightMinKg).toBeNull();
    expect(r.weightMaxKg).toBeNull();
    expect(r.weightSeries).toEqual([]);
  });

  it("ignores metrics that are always null and needs 2+ points for a change", () => {
    const rows = [pt("2026-02-01", { weightKg: 70, visceralFat: null })];
    const r = aggregateReportBody(rows);

    expect(r.avgWeightKg).toBe(70);
    expect(r.weightChangeKg).toBeNull(); // only one point
    expect(r.avgVisceralFat).toBeNull();
  });

  it("groups the weight series by KST day, keeping the last of each day (AE4)", () => {
    // Both land on KST day 2026-02-28 (month-end boundary) — series keeps them
    // in February, one point, last-of-day.
    const rows = [
      pt("2026-02-27", { weightKg: 70.2 }),
      pt("2026-02-28", { weightKg: 70.0 }),
      pt("2026-02-28", { weightKg: 69.8 }),
    ];

    const r = aggregateReportBody(rows);

    expect(r.weightSeries).toEqual([
      { date: "2026-02-27", weight: 70.2 },
      { date: "2026-02-28", weight: 69.8 },
    ]);
    expect(r.measurementCount).toBe(3);
  });
});

describe("_generateNarrative", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it("throws — with the stop reason in the message — when the API call returns no text", async () => {
    // Mirrors overview/narrative.ts's guard: adaptive thinking can consume the
    // whole maxTokens budget on reasoning, leaving a thinking block and no
    // text block. A refusal (stopReason "refusal", HTTP 200) looks the same.
    generateTextMock.mockResolvedValue(aiResult({ content: "", stopReason: "refusal" }));
    const service = createReportService(db, "fake-api-key");

    await expect(generateNarrative(service, "prompt")).rejects.toThrow(/refusal/);
  });

  it("throws on whitespace-only text, not just a fully-empty string", async () => {
    generateTextMock.mockResolvedValue(
      aiResult({ content: "   \n\t  ", stopReason: "max_tokens" })
    );
    const service = createReportService(db, "fake-api-key");

    await expect(generateNarrative(service, "prompt")).rejects.toThrow(/max_tokens/);
  });

  it("still returns an empty string, without calling the API, when no key is configured", async () => {
    // The legitimate empty: "no AI configured" must stay silent and must not
    // be conflated with a failed call — only a real generateText() call whose
    // result is empty should throw.
    const service = createReportService(db); // no anthropicApiKey
    await expect(generateNarrative(service, "prompt")).resolves.toBe("");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns the narrative unchanged on a normal result", async () => {
    generateTextMock.mockResolvedValue(aiResult({ content: "이번 달 요약입니다." }));
    const service = createReportService(db, "fake-api-key");

    await expect(generateNarrative(service, "prompt")).resolves.toBe("이번 달 요약입니다.");
  });
});
