import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  signOut: vi.fn(),
  deleteAccount: vi.fn(),
  origin: vi.fn(),
  revokeOnly: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/lib/auth", () => ({ auth: { api: { signOut: mocks.signOut } } }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/account-deletion", () => ({ deleteAccount: mocks.deleteAccount }));
vi.mock("@/lib/api-auth", () => ({ checkSameOrigin: mocks.origin }));
vi.mock("@/modules/proton/connection", () => ({
  ProtonConnectionService: class {
    revokeOnly = mocks.revokeOnly;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { PROTON_ERRORS } from "@/modules/proton/types";
import { DELETE } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner-1" }, error: null });
  mocks.origin.mockReturnValue({ ok: true });
  mocks.deleteAccount.mockResolvedValue(undefined);
  mocks.revokeOnly.mockResolvedValue(true);
  const headers = new Headers();
  headers.append("set-cookie", "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly");
  headers.append("set-cookie", "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly");
  mocks.signOut.mockResolvedValue({ headers });
});

it("deletes the authenticated account and forwards every cookie expiration", async () => {
  const response = await DELETE(
    new NextRequest("http://localhost/api/auth/disconnect", { method: "DELETE" })
  );
  expect(response.status).toBe(200);
  expect(mocks.deleteAccount).toHaveBeenCalledWith({}, "owner-1");
  expect(mocks.signOut).toHaveBeenCalledWith({ headers: expect.any(Headers), returnHeaders: true });
  expect(response.headers.getSetCookie()).toHaveLength(2);
  expect(response.headers.getSetCookie().every((cookie) => cookie.includes("Max-Age=0"))).toBe(
    true
  );
});

it("rejects cross-origin requests before deleting data", async () => {
  mocks.origin.mockReturnValue({ ok: false, reason: "origin mismatch" });
  expect(
    (await DELETE(new NextRequest("http://localhost/api/auth/disconnect", { method: "DELETE" })))
      .status
  ).toBe(403);
  expect(mocks.deleteAccount).not.toHaveBeenCalled();
});

it("never reports success when the deletion transaction fails", async () => {
  mocks.deleteAccount.mockRejectedValue(new Error("rollback"));
  expect(
    (await DELETE(new NextRequest("http://localhost/api/auth/disconnect", { method: "DELETE" })))
      .status
  ).toBe(500);
  expect(mocks.signOut).not.toHaveBeenCalled();
});

const request = () => new NextRequest("http://localhost/api/auth/disconnect", { method: "DELETE" });

it("best-effort revokes Proton before deleting and still deletes when revoke fails", async () => {
  const order: string[] = [];
  mocks.revokeOnly.mockImplementation(async () => {
    order.push("revoke");
    throw new Error("network down");
  });
  mocks.deleteAccount.mockImplementation(async () => {
    order.push("delete");
  });
  const response = await DELETE(request());
  expect(response.status).toBe(200);
  expect(mocks.revokeOnly).toHaveBeenCalledWith("owner-1");
  expect(order).toEqual(["revoke", "delete"]);
  expect((await response.json()).message).toContain(PROTON_ERRORS.revokeFailed);
});

it("adds the fixed Proton notice to the success message when revoke failed", async () => {
  mocks.revokeOnly.mockResolvedValue(false);
  const failed = await (await DELETE(request())).json();
  expect(failed.message).toContain("모든 데이터가 삭제되었습니다.");
  expect(failed.message).toContain(PROTON_ERRORS.revokeFailed);

  mocks.revokeOnly.mockResolvedValue(true);
  const ok = await (await DELETE(request())).json();
  expect(ok.message).not.toContain(PROTON_ERRORS.revokeFailed);
});
