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

describe("GET /api/timeline/coding-sessions", () => {
  it("returns sessions with ISO start times and a count", async () => {
    const fake = createMockDb([
      [
        {
          id: "cs1",
          project: "cistory",
          startedAt: new Date("2026-11-01T01:00:00Z"),
          durationSeconds: 600,
          humanAdditions: 1,
          humanDeletions: 2,
          aiAdditions: 3,
          aiDeletions: 4,
        },
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);
    const res = await GET(
      new NextRequest("http://localhost/api/timeline/coding-sessions?date=2026-11-01")
    );
    expect(await res.json()).toEqual({
      sessions: [
        {
          id: "cs1",
          project: "cistory",
          startedAt: "2026-11-01T01:00:00.000Z",
          durationSeconds: 600,
          humanAdditions: 1,
          humanDeletions: 2,
          aiAdditions: 3,
          aiDeletions: 4,
        },
      ],
      count: 1,
    });
    expect(fake.whereParams()[0][0]).toBe("user-1");
  });
});
