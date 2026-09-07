import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  token: vi.fn(),
  summary: vi.fn(),
  process: vi.fn(),
  sync: vi.fn(),
  after: vi.fn(),
  db: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedUser: mocks.auth,
  getGitHubToken: mocks.token,
}));
vi.mock("@/db", () => ({ getDb: mocks.db }));
vi.mock("@/modules/summary/service", () => ({ createSummaryService: mocks.summary }));
vi.mock("@/modules/sync/service", () => ({
  createSyncService: () => ({ syncUserCommits: mocks.sync }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: mocks.after,
}));

import { POST } from "./route";

it("scopes post-sync summaries to the authenticated owner and awaits the background work", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "owner-1" }, error: null });
  mocks.token.mockResolvedValue("owner-token");
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ githubLogin: "owner", initialSyncCompleted: true }],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  mocks.db.mockReturnValue(db);
  mocks.summary.mockReturnValue({ processPendingSummaries: mocks.process });
  mocks.process.mockResolvedValue(1);
  mocks.sync.mockResolvedValue({ syncJobId: "job-1" });
  const response = await POST(new NextRequest("http://localhost/api/sync", { method: "POST" }));
  expect(response.status).toBe(202);
  expect(mocks.summary).toHaveBeenCalledWith(
    db,
    process.env.ANTHROPIC_API_KEY,
    "owner-token",
    "owner-1"
  );
  expect(mocks.sync).not.toHaveBeenCalled();
  await mocks.after.mock.calls[0][0]();
  expect(mocks.sync).toHaveBeenCalledWith("owner-1", "owner", "manual");
  expect(mocks.process).toHaveBeenCalledWith(50);
});
