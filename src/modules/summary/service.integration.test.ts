import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitSummaries, commits } from "@/db";
import { insertTestUser } from "@/db/testing/fixtures";
import { useTransactionalDb } from "@/db/testing/transactional-db";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), getCommitDiff: vi.fn() }));
vi.mock("@/lib/adapters/ai/claude", () => ({
  CLAUDE_MODELS: { COMMIT_SUMMARY: "test" },
  createClaudeAdapter: () => ({ generateText: mocks.generateText }),
}));
vi.mock("@/lib/adapters/vcs/github", () => ({
  createGitHubAdapter: () => ({ getCommitDiff: mocks.getCommitDiff }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { SummaryService } from "./service";

describe("summary claims against PostgreSQL", () => {
  const ctx = useTransactionalDb();
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function fixture() {
    const db = ctx.db();
    const userId = await insertTestUser(db);
    const commitId = randomUUID();
    const timestamp = new Date();
    await db.insert(commits).values({
      id: commitId,
      userId,
      sha: commitId,
      message: "fix",
      authorName: "test",
      repoFullName: "test/repo",
      committedAt: timestamp,
      createdAt: timestamp,
    });
    await db.insert(commitSummaries).values({
      id: randomUUID(),
      commitId,
      status: "pending",
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    mocks.getCommitDiff.mockResolvedValue({ rawDiff: "diff", files: [] });
    return { db, userId, commitId };
  }

  it("two workers competing for one row issue only one external request", async () => {
    const { db, userId, commitId } = await fixture();
    let started: () => void = () => {};
    let finish: () => void = () => {};
    const claimed = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.generateText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ content: "winner" });
          started();
        })
    );
    const first = new SummaryService(db, "key", "token", userId).generateSummary(commitId, false);
    await claimed;
    await expect(
      new SummaryService(db, "key", "token", userId).generateSummary(commitId, false)
    ).rejects.toThrow("already processing");
    finish();
    await first;
    const [row] = await db
      .select()
      .from(commitSummaries)
      .where(eq(commitSummaries.commitId, commitId));
    expect(row).toMatchObject({ status: "completed", summary: "winner", retryCount: 0 });
    expect(mocks.getCommitDiff).toHaveBeenCalledOnce();
  });

  it("revives a timed-out lease and prevents the old worker from overwriting its successor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-08T03:00:00.123Z"));
    const { db, userId, commitId } = await fixture();
    let started: () => void = () => {};
    let finishOld: () => void = () => {};
    const claimed = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.generateText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = () => resolve({ content: "expired result" });
          started();
        })
    );
    const old = new SummaryService(db, "key", "token", userId).generateSummary(commitId, false);
    await claimed;
    vi.setSystemTime(new Date("2026-08-08T03:16:00.456Z"));
    expect(await SummaryService.reviveStaleProcessing(db)).toBe(1);
    mocks.generateText.mockResolvedValueOnce({ content: "current result" });
    await new SummaryService(db, "key", "token", userId).generateSummary(commitId, false);
    const expired = expect(old).rejects.toThrow("lease expired");
    finishOld();
    await expired;
    const [row] = await db
      .select()
      .from(commitSummaries)
      .where(eq(commitSummaries.commitId, commitId));
    expect(row).toMatchObject({ summary: "current result", status: "completed", retryCount: 0 });
  });

  it("rejects another user's commit before fetching its private repository", async () => {
    const { db, commitId } = await fixture();
    const otherUser = await insertTestUser(db);
    await expect(
      new SummaryService(db, "key", "other-token", otherUser).generateSummary(commitId, false)
    ).rejects.toThrow("Commit not found");
    expect(mocks.getCommitDiff).not.toHaveBeenCalled();
    const [row] = await db
      .select()
      .from(commitSummaries)
      .where(eq(commitSummaries.commitId, commitId));
    expect(row).toMatchObject({ status: "pending", retryCount: 0 });
  });
});
