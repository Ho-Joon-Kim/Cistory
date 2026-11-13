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

import { PATCH } from "./route";

const context = { params: Promise.resolve({ transactionId: "tx-1" }) };
function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/spending/transactions/tx-1", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    context
  );
}

beforeEach(() => {
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: "user-1" }, error: null });
});

describe("PATCH /api/spending/transactions/:id", () => {
  it("sets a manual category and override, scoped to the user", async () => {
    // (before read), update
    const fake = createMockDb([[{ id: "tx-1" }], [{ id: "tx-1" }]]);
    mocks.getDb.mockReturnValue(fake.db);

    const res = await patch({ category: "cafe", spendingOverride: "exclude", overrideNote: "x" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const set = fake.writes("set")[0] as Record<string, unknown>;
    expect(set).toMatchObject({
      category: "cafe",
      categorySource: "manual",
      categoryConfidence: null,
      categoryModel: null,
      categoryError: null,
      spendingOverride: "exclude",
      overrideNote: "x",
    });
    expect(set.categorizedAt).toBeInstanceOf(Date);
    expect(fake.whereParams().at(-1)).toEqual(["tx-1", "user-1"]);
  });

  it("clears the category back to unclassified", async () => {
    const fake = createMockDb([[{ id: "tx-1" }], [{ id: "tx-1" }]]);
    mocks.getDb.mockReturnValue(fake.db);
    await patch({ category: null });
    expect(fake.writes("set")[0]).toEqual({
      category: null,
      categorySource: null,
      categoryConfidence: null,
      categoryModel: null,
      categoryAttempts: 0,
      categoryError: null,
      categorizedAt: null,
    });
  });

  it("rejects invalid values and empty bodies", async () => {
    mocks.getDb.mockReturnValue(createMockDb().db);
    expect((await patch({ spendingOverride: "maybe" })).status).toBe(400);
    expect((await patch({ category: "nope" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });

  it("returns 404 for a missing or foreign transaction", async () => {
    mocks.getDb.mockReturnValue(createMockDb([[], []]).db);
    expect((await patch({ spendingOverride: null })).status).toBe(404);
  });
});
