import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  token: vi.fn(),
  create: vi.fn(),
  process: vi.fn(),
  after: vi.fn(),
  db: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedUser: mocks.auth,
  getGitHubToken: mocks.token,
}));
vi.mock("@/db", () => ({ getDb: mocks.db }));
vi.mock("@/modules/summary/service", () => ({ createSummaryService: mocks.create }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: mocks.after,
}));

import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner-1" }, error: null });
  mocks.token.mockResolvedValue("token-for-owner-1");
  mocks.db.mockReturnValue({});
  mocks.create.mockReturnValue({ processPendingSummaries: mocks.process });
  mocks.process.mockResolvedValue(1);
});

function request(body = {}) {
  return new NextRequest("http://localhost/api/summaries/process", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST summaries/process", () => {
  it("binds the authenticated owner to the service and schedules bounded work after the response", async () => {
    const response = await POST(request({ limit: 5 }));
    expect(response.status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith(
      {},
      process.env.ANTHROPIC_API_KEY,
      "token-for-owner-1",
      "owner-1"
    );
    expect(mocks.process).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.process).toHaveBeenCalledWith(5);
  });

  it.each([-1, 0, 101, 1.5, "5"])("rejects invalid limits: %s", async (limit) => {
    expect((await POST(request({ limit }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

it("counts all commits and status groups with one joined aggregate query", async () => {
  const groupBy = vi.fn().mockResolvedValue([
    { status: null, count: "2" },
    { status: "completed", count: "3" },
    { status: "failed", count: "1" },
  ]);
  const leftJoin = vi.fn(() => ({ where: () => ({ groupBy }) }));
  const select = vi.fn(() => ({ from: () => ({ leftJoin }) }));
  mocks.db.mockReturnValue({ select });
  const response = await GET(request());
  expect(await response.json()).toEqual({
    total: 6,
    pending: 0,
    processing: 0,
    completed: 3,
    failed: 1,
  });
  expect(select).toHaveBeenCalledOnce();
  expect(leftJoin).toHaveBeenCalledOnce();
});
