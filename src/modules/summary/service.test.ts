process.env.TZ = "Asia/Seoul";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock, getCommitDiffMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  getCommitDiffMock: vi.fn(),
}));

vi.mock("@/lib/adapters/ai/claude", () => ({
  CLAUDE_MODELS: { COMMIT_SUMMARY: "claude-sonnet-5" },
  createClaudeAdapter: vi.fn(() => ({ generateText: generateTextMock })),
}));

vi.mock("@/lib/adapters/vcs/github", () => ({
  createGitHubAdapter: vi.fn(() => ({ getCommitDiff: getCommitDiffMock })),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { Database } from "@/db";
import { SummaryService } from "./service";

const COMMIT_ROW = {
  id: "commit-1",
  sha: "abc123",
  message: "fix bug",
  additions: 1,
  deletions: 1,
  changedFilesCount: 1,
  repoFullName: "octocat/repo",
};

/**
 * Minimal Drizzle stand-in: `select().from().where()` resolves to the given
 * commit row, and every `update().set().where()` records the values it was
 * asked to write instead of touching a database.
 */
function fakeDb(commitRow: Record<string, unknown>, updates: Record<string, unknown>[]): Database {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([commitRow]) }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve(undefined);
        },
      }),
    }),
  } as unknown as Database;
}

beforeEach(() => {
  generateTextMock.mockReset();
  getCommitDiffMock.mockReset();
  getCommitDiffMock.mockResolvedValue({ rawDiff: "diff --git a b", files: [] });
});

describe("SummaryService.generateSummary", () => {
  it("fails loudly instead of persisting an empty summary as completed", async () => {
    // Refusal shape: HTTP 200, no text block, so the adapter's parsed content
    // is "". Before this fix that would land as `{ status: "completed",
    // summary: "" }` and drop out of the cron's pending/failed rescan forever.
    generateTextMock.mockResolvedValue({
      content: "",
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: "refusal",
    });

    const updates: Record<string, unknown>[] = [];
    const db = fakeDb(COMMIT_ROW, updates);
    const service = new SummaryService(db, "anthropic-key", "gh-token");

    await expect(service.generateSummary("commit-1", false)).rejects.toThrow(/refusal/);

    expect(updates.map((update) => update.status)).toEqual(["processing", "failed"]);
    const failedUpdate = updates[1];
    expect(failedUpdate.summary).toBeUndefined();
    expect(String(failedUpdate.errorMessage)).toContain("refusal");
  });

  it("surfaces max_tokens truncation distinctly from a refusal", async () => {
    // Same emptiness check, different stopReason — the thrown message must
    // still say why, so an operator can tell truncation from refusal.
    generateTextMock.mockResolvedValue({
      content: "",
      usage: { inputTokens: 10, outputTokens: 300 },
      stopReason: "max_tokens",
    });

    const updates: Record<string, unknown>[] = [];
    const db = fakeDb(COMMIT_ROW, updates);
    const service = new SummaryService(db, "anthropic-key", "gh-token");

    await expect(service.generateSummary("commit-1", false)).rejects.toThrow(/max_tokens/);
    expect(updates.map((update) => update.status)).toEqual(["processing", "failed"]);
  });

  it("saves a completed summary when the adapter returns text", async () => {
    generateTextMock.mockResolvedValue({
      content: "실제 요약",
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: "end_turn",
    });

    const updates: Record<string, unknown>[] = [];
    const db = fakeDb(COMMIT_ROW, updates);
    const service = new SummaryService(db, "anthropic-key", "gh-token");

    const result = await service.generateSummary("commit-1", false);

    expect(result.summary).toBe("실제 요약");
    expect(updates.map((update) => update.status)).toEqual(["processing", "completed"]);
  });
});
