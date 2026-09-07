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
          return Object.assign(Promise.resolve(undefined), {
            returning: async () => [{ id: "summary-1" }],
          });
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
    const service = new SummaryService(db, "anthropic-key", "gh-token", "user-1");

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
    const service = new SummaryService(db, "anthropic-key", "gh-token", "user-1");

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
    const service = new SummaryService(db, "anthropic-key", "gh-token", "user-1");

    const result = await service.generateSummary("commit-1", false);

    expect(result.summary).toBe("실제 요약");
    expect(updates.map((update) => update.status)).toEqual(["processing", "completed"]);
  });
});

// Stateful DB seam: competing services share the same row, as separate HTTP
// and cron workers do. Query predicates are checked against the SQL generated
// by Drizzle, so missing ownership/lease constraints fail these regressions.
function sharedQueueDb() {
  let status = "pending";
  let lease: Date | undefined;
  const predicates: { sql: string; params: unknown[] }[] = [];
  const writes: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: async (predicate: SQL) => {
          const query = dialect.sqlToQuery(predicate);
          predicates.push(query);
          return query.params.includes("user-1") ? [COMMIT_ROW] : [];
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: SQL) => {
          const query = dialect.sqlToQuery(predicate);
          predicates.push(query);
          const isClaim = values.status === "processing";
          const ownsLease = query.params.includes(lease?.toISOString());
          const eligible = isClaim ? status !== "processing" : status === "processing" && ownsLease;
          if (eligible) {
            status = String(values.status);
            lease = values.updatedAt as Date;
            writes.push(values);
          }
          const result = Promise.resolve(undefined);
          return Object.assign(result, {
            returning: async () => (eligible ? [{ id: "summary-1" }] : []),
          });
        },
      }),
    }),
  };
  return {
    db: db as unknown as Database,
    predicates,
    writes,
    expire: () => {
      status = "pending";
      lease = undefined;
    },
  };
}

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

describe("summary ownership and atomic leases", () => {
  it("never reads another user's commit using this user's GitHub token", async () => {
    const queue = sharedQueueDb();
    const service = new SummaryService(queue.db, "key", "token-for-user-2", "user-2");
    await expect(service.generateSummary("commit-1", false)).rejects.toThrow("Commit not found");
    expect(getCommitDiffMock).not.toHaveBeenCalled();
    expect(queue.writes).toEqual([]);
  });

  it("only one concurrent worker calls GitHub and AI for a queued row", async () => {
    const queue = sharedQueueDb();
    generateTextMock.mockResolvedValue({ content: "summary" });
    const first = new SummaryService(queue.db, "key", "token", "user-1");
    const second = new SummaryService(queue.db, "key", "token", "user-1");
    const results = await Promise.allSettled([
      first.generateSummary("commit-1", false),
      second.generateSummary("commit-1", false),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(getCommitDiffMock).toHaveBeenCalledOnce();
    expect(generateTextMock).toHaveBeenCalledOnce();
    expect(queue.writes.map((write) => write.status)).toEqual(["processing", "completed"]);
    expect(queue.predicates.some((query) => query.sql.includes('"retry_count" <'))).toBe(true);
  });

  it("a stale worker failure cannot overwrite a newer completed summary or its retry count", async () => {
    const queue = sharedQueueDb();
    let rejectOld: (error: Error) => void = () => {};
    let oldStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    generateTextMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
          oldStarted();
        })
    );
    const old = new SummaryService(queue.db, "key", "token", "user-1").generateSummary(
      "commit-1",
      false
    );
    // Attach the rejection handler before triggering failure.
    const oldFailure = expect(old).rejects.toThrow("late failure");
    await started;
    queue.expire();
    generateTextMock.mockResolvedValueOnce({ content: "new summary" });
    await new SummaryService(queue.db, "key", "token", "user-1").generateSummary("commit-1", false);
    rejectOld(new Error("late failure"));
    await oldFailure;
    expect(queue.writes.map((write) => write.status)).toEqual([
      "processing",
      "processing",
      "completed",
    ]);
    expect(queue.writes.at(-1)?.summary).toBe("new summary");
  });

  it("manual regeneration cannot reset an active worker's retry count or lease", async () => {
    const queue = sharedQueueDb();
    let release: () => void = () => {};
    getCommitDiffMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ rawDiff: "diff", files: [] });
        })
    );
    const service = new SummaryService(queue.db, "key", "token", "user-1");
    const running = service.generateSummary("commit-1", false);
    // Allow the claim to finish before trying regeneration.
    await Promise.resolve();
    await Promise.resolve();
    await expect(service.regenerateSummary("commit-1")).rejects.toThrow("already processing");
    generateTextMock.mockResolvedValue({ content: "summary" });
    release();
    await running;
    expect(queue.writes).toHaveLength(2);
    expect(queue.writes[0].retryCount).toBeUndefined();
  });
});
