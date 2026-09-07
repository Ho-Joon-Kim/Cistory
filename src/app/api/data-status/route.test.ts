import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), status: vi.fn(), enqueue: vi.fn(), db: {} }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/modules/data-status/service", () => ({ getDataStatus: mocks.status }));
vi.mock("@/modules/data-status/recovery", () => ({ enqueueRecovery: mocks.enqueue }));

import { ApiError } from "@/lib/api-handler";
import { POST } from "./recover/route";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner", email: null }, error: null });
  mocks.status.mockResolvedValue({ sources: [], jobs: [] });
  mocks.enqueue.mockResolvedValue({ id: "queued" });
});
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/data-status/recover", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    undefined
  );

describe("collection status authentication and validation", () => {
  it("rejects anonymous reads and writes before accessing data", async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await GET(new NextRequest("http://localhost/api/data-status"), undefined)).status).toBe(
      401
    );
    expect((await post({})).status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("uses the authenticated owner even when the query supplies another user", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/data-status?from=2026-09-01&to=2026-09-02&userId=other"
      ),
      undefined
    );
    expect(response.status).toBe(200);
    expect(mocks.status).toHaveBeenCalledWith(mocks.db, "owner", "2026-09-01", "2026-09-02");
  });
  it("rejects invalid dates before default range calculation", async () => {
    expect(
      (await GET(new NextRequest("http://localhost/api/data-status?to=2026-02-30"), undefined))
        .status
    ).toBe(400);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it.each([
    { source: "kis", from: "2026-09-01", to: "2026-09-02" },
    { source: "wakatime", from: "2026-09-01", to: "2026-09-02", userId: "other" },
  ])("rejects unsupported sources and owner injection", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("returns a durable accepted job owned by the current user", async () => {
    const response = await post({ source: "wakatime", from: "2026-09-01", to: "2026-09-02" });
    expect(response.status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      mocks.db,
      "owner",
      "wakatime",
      "2026-09-01",
      "2026-09-02"
    );
    expect(await response.json()).toEqual({ job: { id: "queued" } });
  });
  it("preserves duplicate job conflict and hides unexpected provider details", async () => {
    mocks.enqueue.mockRejectedValueOnce(new ApiError(409, "already running", "RECOVERY_ACTIVE"));
    expect((await post({ source: "wakatime", from: "2026-09-01", to: "2026-09-02" })).status).toBe(
      409
    );
    mocks.enqueue.mockRejectedValueOnce(new Error("token=secret"));
    const response = await post({ source: "wakatime", from: "2026-09-01", to: "2026-09-02" });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
