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

describe("GET /api/timeline/coding-stats", () => {
  it("parses the JSON summary columns, tolerating bad JSON", async () => {
    const fake = createMockDb([
      [
        {
          date: "2026-11-01",
          totalSeconds: 3600,
          projects: '[{"name":"cistory","totalSeconds":3600}]',
          languages: "not json",
          editors: null,
          categories: "[]",
        },
      ],
    ]);
    mocks.getDb.mockReturnValue(fake.db);
    const res = await GET(
      new NextRequest("http://localhost/api/timeline/coding-stats?from=2026-11-01&to=2026-11-02")
    );
    expect(await res.json()).toEqual({
      stats: [
        {
          date: "2026-11-01",
          totalSeconds: 3600,
          projects: [{ name: "cistory", totalSeconds: 3600 }],
          languages: [],
          editors: [],
          categories: [],
        },
      ],
    });
    expect(fake.whereParams()[0]).toEqual(["user-1", "2026-11-01", "2026-11-02"]);
  });

  it("requires from and to", async () => {
    const res = await GET(new NextRequest("http://localhost/api/timeline/coding-stats"));
    expect(res.status).toBe(400);
  });
});
