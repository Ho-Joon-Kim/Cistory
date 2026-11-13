import { describe, expect, it, vi } from "vitest";
import { callTool, TEST_USER_ID } from "./test-context";
import { workTool } from "./work";

const mocks = vi.hoisted(() => ({
  listCommits: vi.fn(),
  getCodingStats: vi.fn(),
  listCodingSessions: vi.fn(),
}));
vi.mock("@/modules/timeline/work-queries", () => mocks);

describe("work tool", () => {
  it("returns commits with AI summaries and coding days, paging by offset cursor", async () => {
    mocks.listCommits.mockResolvedValue({
      commits: [
        {
          id: "c1",
          sha: "abc",
          message: "feat: x",
          authorName: "me",
          authorAvatarUrl: "https://avatars/me",
          committedAt: new Date("2026-11-12T15:30:00Z"),
          additions: 1,
          deletions: 2,
          changedFilesCount: 1,
          isMergeCommit: false,
          repository: { fullName: "me/repo", id: 1, isPrivate: true },
          summary: { status: "completed", summary: "기능 추가" },
        },
      ],
      // pg hands count(*) back as a string; the tool must not pass it through.
      pagination: { page: 1, perPage: 1, total: "2", totalPages: 2, hasNext: true, hasPrev: false },
    });
    mocks.getCodingStats.mockResolvedValue([
      {
        date: "2026-11-12",
        totalSeconds: 3600,
        projects: [],
        languages: [],
        editors: [],
        categories: [],
      },
    ]);

    const out = await callTool(workTool, { from: "2026-11-12", to: "2026-11-13", limit: 1 });
    const [userId, query] = mocks.listCommits.mock.calls[0];
    expect(userId).toBe(TEST_USER_ID);
    expect(query.page).toBe(1);
    expect(query.from.toISOString()).toBe("2026-11-11T15:00:00.000Z");
    expect(query.to.toISOString()).toBe("2026-11-13T14:59:59.999Z");
    expect(mocks.getCodingStats).toHaveBeenCalledWith(
      TEST_USER_ID,
      "2026-11-12",
      "2026-11-13",
      expect.anything()
    );
    expect(out.structured.totalCommits).toBe(2);
    expect(out.structured.message).toBeNull();
    const [commit] = out.structured.commits as Record<string, unknown>[];
    expect(commit).toMatchObject({
      repository: "me/repo",
      committedAt: "2026-11-13T00:30:00+09:00",
      aiSummary: "기능 추가",
    });
    expect(commit).not.toHaveProperty("authorAvatarUrl");
    expect(out.structured.sessions).toBeNull();
    expect(mocks.listCodingSessions).not.toHaveBeenCalled();

    await callTool(workTool, {
      from: "2026-11-12",
      to: "2026-11-13",
      limit: 1,
      cursor: out.structured.nextCursor,
    });
    expect(mocks.listCommits.mock.calls[1][1].page).toBe(2);
  });

  it("reports an empty range as no records when pg returns the count as a string", async () => {
    mocks.listCommits.mockResolvedValue({
      commits: [],
      pagination: {
        page: 1,
        perPage: 100,
        total: "0",
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    });
    mocks.getCodingStats.mockResolvedValue([]);
    const out = await callTool(workTool, { from: "2026-11-12", to: "2026-11-13" });
    expect(out.structured.totalCommits).toBe(0);
    expect(out.structured.message).toBe("기록 없음");
  });
});
