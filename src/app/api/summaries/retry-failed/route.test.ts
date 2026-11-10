import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  token: vi.fn(),
  create: vi.fn(),
  process: vi.fn(),
  after: vi.fn(),
  sameOrigin: vi.fn(),
  returning: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedUser: mocks.auth,
  getGitHubToken: mocks.token,
}));
vi.mock("@/lib/api-auth", () => ({ checkSameOrigin: mocks.sameOrigin }));
vi.mock("@/db", () => ({
  getDb: () => ({
    update: () => ({ set: mocks.set }),
    select: () => ({ from: () => ({ where: () => ({}) }) }),
  }),
}));
vi.mock("@/modules/summary/service", () => ({ createSummaryService: mocks.create }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: mocks.after,
}));

import { POST } from "./route";

const request = () =>
  new NextRequest("http://localhost/api/summaries/retry-failed", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner-1" }, error: null });
  mocks.token.mockResolvedValue("token");
  mocks.sameOrigin.mockReturnValue({ ok: true });
  mocks.set.mockReturnValue({ where: () => ({ returning: mocks.returning }) });
  mocks.create.mockReturnValue({ processPendingSummaries: mocks.process });
});

describe("POST summaries/retry-failed", () => {
  it("re-queues failed rows as pending with a fresh retry budget and runs them", async () => {
    mocks.returning.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ requeued: 2 });
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", retryCount: 0, errorMessage: null })
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.anything(),
      process.env.ANTHROPIC_API_KEY,
      "token",
      "owner-1"
    );
    await mocks.after.mock.calls[0][0]();
    expect(mocks.process).toHaveBeenCalledWith(2);
  });

  it("does not start a run when nothing failed", async () => {
    mocks.returning.mockResolvedValue([]);
    expect(await (await POST(request())).json()).toEqual({ requeued: 0 });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before touching the database", async () => {
    mocks.sameOrigin.mockReturnValue({ ok: false, reason: "origin" });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
