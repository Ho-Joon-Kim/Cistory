import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";

const mocks = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: mocks.getDb,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});

const commitRow = (id: string, summaryId: string | null) => ({
  id,
  sha: `sha-${id}`,
  message: "fix",
  authorName: "me",
  authorAvatarUrl: null,
  committedAt: new Date("2026-11-01T01:00:00Z"),
  additions: 1,
  deletions: 2,
  changedFilesCount: 3,
  isMergeCommit: false,
  repoFullName: "me/repo",
  repoId: 9,
  repoIsPrivate: true,
  summaryId,
  summaryStatus: summaryId ? "completed" : null,
  summary: summaryId ? "요약" : null,
});

describe("GET /api/timeline", () => {
  it("pins commits + summaries + pagination", async () => {
    const fake = createMockDb([[{ count: 41 }], [commitRow("c1", "s1"), commitRow("c2", null)]]);
    mocks.getDb.mockReturnValue(fake.db);

    const res = await GET(
      new NextRequest(
        "http://localhost/api/timeline?page=2&per_page=20&repos=me/repo&from=2026-11-01&to=2026-11-02"
      )
    );
    const body = await res.json();
    expect(body).toEqual({
      commits: [
        {
          id: "c1",
          sha: "sha-c1",
          message: "fix",
          authorName: "me",
          authorAvatarUrl: null,
          committedAt: "2026-11-01T01:00:00.000Z",
          additions: 1,
          deletions: 2,
          changedFilesCount: 3,
          isMergeCommit: false,
          repository: { fullName: "me/repo", id: 9, isPrivate: true },
          summary: { status: "completed", summary: "요약" },
        },
        {
          id: "c2",
          sha: "sha-c2",
          message: "fix",
          authorName: "me",
          authorAvatarUrl: null,
          committedAt: "2026-11-01T01:00:00.000Z",
          additions: 1,
          deletions: 2,
          changedFilesCount: 3,
          isMergeCommit: false,
          repository: { fullName: "me/repo", id: 9, isPrivate: true },
          summary: null,
        },
      ],
      pagination: { page: 2, perPage: 20, total: 41, totalPages: 3, hasNext: true, hasPrev: true },
    });
    for (const params of fake.whereParams()) expect(params[0]).toBe("user-1");
    expect(fake.calls[1].chain.find((s) => s.method === "offset")?.args[0]).toBe(20);
  });

  it("rejects malformed dates", async () => {
    mocks.getDb.mockReturnValue(createMockDb().db);
    const res = await GET(new NextRequest("http://localhost/api/timeline?from=nope"));
    expect(res.status).toBe(400);
  });
});
