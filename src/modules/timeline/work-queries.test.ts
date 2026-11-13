import { describe, expect, it } from "vitest";
import { createMockDb } from "@/db/testing/mock-db";
import { getCodingStats, listCodingSessions, listCommits } from "./work-queries";

describe("work queries", () => {
  it("scopes commits (count and page) to the user", async () => {
    const fake = createMockDb([[{ count: 0 }], []]);
    const result = await listCommits("user-1", { page: 1, perPage: 20 }, fake.db);
    expect(result.pagination).toEqual({
      page: 1,
      perPage: 20,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
    expect(fake.whereParams()).toEqual([["user-1"], ["user-1"]]);
  });

  it("scopes coding stats and sessions to the user", async () => {
    const stats = createMockDb([[]]);
    await getCodingStats("user-1", "2026-11-01", "2026-11-07", stats.db);
    expect(stats.whereParams()[0]).toEqual(["user-1", "2026-11-01", "2026-11-07"]);

    const sessions = createMockDb([[]]);
    await listCodingSessions(
      "user-1",
      { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-11-02T00:00:00Z") },
      sessions.db
    );
    expect(sessions.whereParams()[0][0]).toBe("user-1");
  });
});
