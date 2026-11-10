import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  db: {},
  startConnect: vi.fn(),
  checkConnect: vi.fn(),
  disconnect: vi.fn(),
  summary: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.logError, warn: vi.fn() } }));
vi.mock("@/modules/proton/summary", () => ({ getProtonSummary: mocks.summary }));
vi.mock("@/modules/proton/connection", () => ({
  ProtonConnectionService: vi.fn(function ProtonConnectionService() {
    return {
      startConnect: mocks.startConnect,
      checkConnect: mocks.checkConnect,
      disconnect: mocks.disconnect,
    };
  }),
}));

import { PROTON_ERRORS } from "@/modules/proton/types";
import { POST } from "./connect/route";
import { GET as STATUS } from "./connect/status/route";
import { DELETE, GET } from "./route";

const APP = "https://cistory.test";
const req = (path: string, method: string, origin?: string) =>
  new NextRequest(`${APP}${path}`, { method, headers: origin ? { origin } : {} });

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  mocks.auth.mockResolvedValue({ user: { id: "owner", email: null }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("Proton routes", () => {
  it("POST /api/proton/connect and DELETE /api/proton reject cross-origin with 403 INVALID_ORIGIN", async () => {
    for (const response of [
      await POST(req("/api/proton/connect", "POST", "https://evil.test"), undefined),
      await DELETE(req("/api/proton", "DELETE", "https://evil.test"), undefined),
      await DELETE(req("/api/proton", "DELETE"), undefined),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: PROTON_ERRORS.invalidOrigin,
        code: "INVALID_ORIGIN",
      });
    }
    expect(mocks.startConnect).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it("rejects anonymous requests before touching the connection", async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await POST(req("/api/proton/connect", "POST", APP), undefined)).status).toBe(401);
    expect((await STATUS(req("/api/proton/connect/status", "GET"), undefined)).status).toBe(401);
    expect((await GET(req("/api/proton", "GET"), undefined)).status).toBe(401);
    expect((await DELETE(req("/api/proton", "DELETE", APP), undefined)).status).toBe(401);
    expect(mocks.startConnect).not.toHaveBeenCalled();
    expect(mocks.checkConnect).not.toHaveBeenCalled();
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it("POST returns { signInUrl, expiresAt } for the session user", async () => {
    const started = {
      signInUrl: "https://account.proton.me/fork#x",
      expiresAt: "2026-11-10T03:10:00.000Z",
    };
    mocks.startConnect.mockResolvedValue(started);
    const response = await POST(req("/api/proton/connect", "POST", APP), undefined);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(started);
    expect(mocks.startConnect).toHaveBeenCalledWith("owner");
  });

  it("DELETE includes the fixed revokeFailed notice when revoke failed", async () => {
    mocks.disconnect.mockResolvedValue({ revoked: false });
    const failed = await DELETE(req("/api/proton", "DELETE", APP), undefined);
    expect(failed.status).toBe(200);
    expect(mocks.disconnect).toHaveBeenCalledWith("owner");
    expect((await failed.json()).notice).toBe(PROTON_ERRORS.revokeFailed);

    mocks.disconnect.mockResolvedValue({ revoked: true });
    const ok = await DELETE(req("/api/proton", "DELETE", APP), undefined);
    expect(await ok.json()).toEqual({ success: true, revoked: true });
  });

  it("GET /api/proton/connect/status is session-authenticated and never echoes Proton errors", async () => {
    mocks.checkConnect.mockResolvedValueOnce({
      status: "pending",
      expiresAt: "2026-11-10T03:10:00.000Z",
    });
    const pending = await STATUS(req("/api/proton/connect/status", "GET"), undefined);
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({
      status: "pending",
      expiresAt: "2026-11-10T03:10:00.000Z",
    });
    expect(mocks.checkConnect).toHaveBeenCalledWith("owner");

    mocks.checkConnect.mockRejectedValueOnce(new Error("Proton: secret account detail"));
    const failed = await STATUS(req("/api/proton/connect/status", "GET"), undefined);
    expect(failed.status).toBe(502);
    const body = await failed.text();
    expect(JSON.parse(body)).toEqual({
      error: PROTON_ERRORS.connectFailed,
      code: "PROTON_UNAVAILABLE",
    });
    expect(body).not.toContain("secret account detail");
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("secret account detail");
  });

  it("GET /api/proton returns the owner's summary", async () => {
    const summary = {
      connected: true,
      status: "active",
      photoCount: 3,
      lastSyncedAt: null,
      backfilling: true,
      detailsFailedCount: 0,
      blockedCount: 1,
      originalCheckedCount: 0,
      originalEligibleCount: 0,
      lastError: null,
      forkPending: false,
    };
    mocks.summary.mockResolvedValue(summary);
    const response = await GET(req("/api/proton", "GET"), undefined);
    expect(await response.json()).toEqual(summary);
    expect(mocks.summary).toHaveBeenCalledWith(mocks.db, "owner");
  });
});
