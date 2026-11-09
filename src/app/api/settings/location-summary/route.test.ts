import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock("@/db", () => ({ getDb: () => ({ execute: mocks.execute }) }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner-1" }, error: null });
});

describe("GET settings/location-summary", () => {
  it("returns numeric counts from the three owner-scoped queries", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ processed: "598", failed: "1" }] })
      .mockResolvedValueOnce({ rows: [{ count: "59315" }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] });
    const response = await GET(new NextRequest("http://localhost/api/settings/location-summary"));
    expect(await response.json()).toEqual({
      processedDays: 598,
      failedDays: 1,
      anomalies: 59315,
      unnamedVisits: 2,
    });
    expect(mocks.execute).toHaveBeenCalledTimes(3);
    for (const [query] of mocks.execute.mock.calls) {
      expect(JSON.stringify(query)).toContain("owner-1");
    }
  });
});
