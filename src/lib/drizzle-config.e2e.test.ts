process.env.TZ = "Asia/Seoul";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadDotenv } from "dotenv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Executes the real `drizzle.config.ts` end to end against synthetic, disposable `.env` /
 * `.env.local` files — never the project's real ones — to prove its `.env.local` load's
 * `override: true` is load-bearing, not a redundant flag a future cleanup could delete.
 *
 * `drizzle-env.test.ts` only pins `resolveDrizzleDatabaseUrl`, a pure function that never
 * touches dotenv or the filesystem — it cannot detect `drizzle.config.ts` dropping the flag,
 * because nothing in that file imports or evaluates `drizzle.config.ts` itself. This file
 * closes that gap: it chdirs into a temp directory (dotenv resolves a relative `path` against
 * `process.cwd()`) and dynamically imports the real config module fresh each time, cache-bust
 * suffixed so repeated imports in the same run don't return a stale module instance.
 *
 * If this file starts failing, it means `drizzle.config.ts` stopped making `.env.local` win
 * over `.env` — check that its `.env.local` load still passes `override: true` before
 * touching this test. (Verified by proof-of-mutation: flipping that flag to `false` locally
 * and re-running this file reproduces exactly the "resolves .env.local over .env" failure,
 * with dotenv itself logging "injecting env (0) from .env.local" — the silent no-op this
 * whole fix exists to close.)
 *
 * The `.env` load in `beforeEach`/each test below simulates drizzle-kit's own CLI, which
 * auto-imports `dotenv/config` (default override:false) before `drizzle.config.ts` is ever
 * evaluated — confirmed by reading `node_modules/drizzle-kit/bin.cjs`. We reproduce that
 * precondition ourselves rather than invoking the drizzle-kit CLI, since running it for real
 * would mean an actual `db:*` command.
 */

const CONFIG_PATH = path.resolve(__dirname, "../../drizzle.config.ts");

let tempDir: string;
let originalCwd: string;
let originalDatabaseUrl: string | undefined;
let originalDrizzleUrl: string | undefined;
let importCounter = 0;

beforeEach(() => {
  originalCwd = process.cwd();
  originalDatabaseUrl = process.env.DATABASE_URL;
  originalDrizzleUrl = process.env.DRIZZLE_DATABASE_URL;
  delete process.env.DRIZZLE_DATABASE_URL;

  tempDir = mkdtempSync(path.join(tmpdir(), "drizzle-config-e2e-"));
  writeFileSync(path.join(tempDir, ".env"), "DATABASE_URL=postgresql://localhost:5432/wrong-db\n");
  writeFileSync(
    path.join(tempDir, ".env.local"),
    "DATABASE_URL=postgresql://dev-db:5432/right-db\n"
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalDrizzleUrl === undefined) delete process.env.DRIZZLE_DATABASE_URL;
  else process.env.DRIZZLE_DATABASE_URL = originalDrizzleUrl;
  rmSync(tempDir, { recursive: true, force: true });
});

/** Imports a fresh copy of the real drizzle.config.ts, bypassing the module cache. */
async function loadRealConfig() {
  importCounter += 1;
  const url = `${pathToFileURL(CONFIG_PATH).href}?t=${importCounter}`;
  const mod = await import(/* @vite-ignore */ url);
  return mod.default as { dbCredentials: { url: string } };
}

describe("drizzle.config.ts end to end (real file, synthetic env)", () => {
  it("resolves DATABASE_URL from .env.local, not .env, when both define it", async () => {
    delete process.env.DATABASE_URL;
    loadDotenv({ path: path.join(tempDir, ".env") }); // simulates drizzle-kit's CLI auto-load
    process.chdir(tempDir);

    const cfg = await loadRealConfig();

    expect(cfg.dbCredentials.url).toBe("postgresql://dev-db:5432/right-db");
  });

  it("DRIZZLE_DATABASE_URL overrides even .env.local", async () => {
    delete process.env.DATABASE_URL;
    process.env.DRIZZLE_DATABASE_URL = "postgresql://escape-hatch:5432/db";
    loadDotenv({ path: path.join(tempDir, ".env") });
    process.chdir(tempDir);

    const cfg = await loadRealConfig();

    expect(cfg.dbCredentials.url).toBe("postgresql://escape-hatch:5432/db");
  });
});
