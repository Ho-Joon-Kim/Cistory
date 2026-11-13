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

const call = () =>
  GET(new NextRequest("http://localhost/api/portfolio/accounts/a1/targets"), {
    params: Promise.resolve({ accountId: "a1" }),
  });

describe("GET /api/portfolio/accounts/:id/targets", () => {
  it("returns numeric weights and the latest updatedAt", async () => {
    const fake = createMockDb([
      [{ id: "a1" }],
      [
        {
          ticker: "A",
          name: "에이",
          targetWeight: "0.6",
          updatedAt: new Date("2026-11-01T00:00:00Z"),
        },
        {
          ticker: "B",
          name: "비",
          targetWeight: "0.4",
          updatedAt: new Date("2026-11-02T00:00:00Z"),
        },
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);
    expect(await (await call()).json()).toEqual({
      targets: [
        { ticker: "A", name: "에이", targetWeight: 0.6 },
        { ticker: "B", name: "비", targetWeight: 0.4 },
      ],
      updatedAt: "2026-11-02T00:00:00.000Z",
    });
    expect(fake.whereParams()[0]).toEqual(["a1", "user-1"]);
  });

  it("returns 404 for an account the user doesn't own", async () => {
    mocks.getDb.mockReturnValue(createMockDb([[]]).db);
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("returns null updatedAt without targets", async () => {
    mocks.getDb.mockReturnValue(createMockDb([[{ id: "a1" }], []]).db);
    expect(await (await call()).json()).toEqual({ targets: [], updatedAt: null });
  });
});
