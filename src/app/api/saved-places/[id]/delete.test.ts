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

import { DELETE } from "./route";

const context = { params: Promise.resolve({ id: "place-1" }) };
const request = () =>
  new NextRequest("http://localhost/api/saved-places/place-1", { method: "DELETE" });

beforeEach(() => {
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});

describe("DELETE /api/saved-places/:id", () => {
  it("deletes the owner's place under the trip write lock", async () => {
    // advisory lock, then the delete
    const fake = createMockDb([[], [{ id: "place-1" }]]);
    mocks.getDb.mockReturnValue(fake.db);
    const res = await DELETE(request(), context);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(fake.calls.some((c) => c.op === "delete")).toBe(true);
    expect(fake.whereParams().at(-1)).toEqual(["place-1", "user-1"]);
  });

  it("returns 404 when nothing was deleted", async () => {
    mocks.getDb.mockReturnValue(createMockDb([[], []]).db);
    const res = await DELETE(request(), context);
    expect(res.status).toBe(404);
  });
});
