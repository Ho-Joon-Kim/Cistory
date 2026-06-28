import { describe, expect, it } from "vitest";

// Import smoke: every API route module must load without throwing. This catches
// import-time crashes, broken deps, and module-scope env throws across all
// routes at once. Many routes transitively import src/lib/auth.ts, which calls
// getPool() at module scope — the dummy DATABASE_URL/BETTER_AUTH_SECRET in
// vitest.config.mts keeps that from throwing (Pool construction does not
// connect, so no real DB is needed). Importing does NOT invoke the handlers,
// so this proves "loadable", not "runs".
const HTTP_VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const routeModules = import.meta.glob("/src/app/api/**/route.ts");

describe("API route modules import without throwing", () => {
  const entries = Object.entries(routeModules);

  it("discovers route modules (guards against a glob typo)", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s loads and exports an HTTP verb", async (_path, load) => {
    const mod = (await load()) as Record<string, unknown>;
    expect(mod).toBeTruthy();
    const exportsAVerb = Object.keys(mod).some((key) => HTTP_VERBS.includes(key));
    expect(exportsAVerb).toBe(true);
  });
});
