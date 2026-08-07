process.env.TZ = "Asia/Seoul";

import { parse, populate } from "dotenv";
import { describe, expect, it } from "vitest";
import { DRIZZLE_FALLBACK_DATABASE_URL, resolveDrizzleDatabaseUrl } from "./drizzle-env";

describe("resolveDrizzleDatabaseUrl", () => {
  it("prefers DRIZZLE_DATABASE_URL over DATABASE_URL when both are set", () => {
    const url = resolveDrizzleDatabaseUrl({
      DRIZZLE_DATABASE_URL: "postgresql://escape-hatch:5432/db",
      DATABASE_URL: "postgresql://dev:5432/db",
    });
    expect(url).toBe("postgresql://escape-hatch:5432/db");
  });

  it("falls back to DATABASE_URL when DRIZZLE_DATABASE_URL is unset", () => {
    const url = resolveDrizzleDatabaseUrl({ DATABASE_URL: "postgresql://dev:5432/db" });
    expect(url).toBe("postgresql://dev:5432/db");
  });

  it("falls back to the localhost default when neither is set", () => {
    expect(resolveDrizzleDatabaseUrl({})).toBe(DRIZZLE_FALLBACK_DATABASE_URL);
  });
});

// These reproduce, with synthetic in-memory content (never the real .env/.env.local files),
// the exact load sequence drizzle.config.ts depends on: drizzle-kit's CLI auto-imports
// `dotenv/config` before the config file runs, populating `.env` with dotenv's default
// override:false, and then drizzle.config.ts loads `.env.local` with override:true. Using
// dotenv's own `parse`/`populate` (what `config()` calls internally) exercises the real
// mechanism without touching the filesystem.
describe("dotenv load order (mirrors drizzle-kit's auto .env import + drizzle.config.ts's .env.local override)", () => {
  it("lets .env.local's DATABASE_URL win over .env's when .env.local is loaded with override:true", () => {
    const env: Record<string, string> = {};
    populate(env, parse("DATABASE_URL=postgresql://localhost:5432/wrong-db\n")); // drizzle-kit's auto .env load
    populate(env, parse("DATABASE_URL=postgresql://dev-db:5432/right-db\n"), { override: true }); // drizzle.config.ts's .env.local load

    expect(env.DATABASE_URL).toBe("postgresql://dev-db:5432/right-db");
  });

  it("without override:true, .env's value silently wins instead (the bug this fixes)", () => {
    const env: Record<string, string> = {};
    populate(env, parse("DATABASE_URL=postgresql://localhost:5432/wrong-db\n"));
    populate(env, parse("DATABASE_URL=postgresql://dev-db:5432/right-db\n")); // no override

    expect(env.DATABASE_URL).toBe("postgresql://localhost:5432/wrong-db");
  });
});
