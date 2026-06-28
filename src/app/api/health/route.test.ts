import { describe, expect, it } from "vitest";
import { GET } from "./route";

// Toolchain sanity: proves the runner, node `next/server` support, and the
// `@`-alias config all work before any other unit relies on them.
describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});
