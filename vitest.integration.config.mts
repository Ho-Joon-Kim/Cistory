import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Separate project from vitest.config.mts on purpose: integration tests need
// a real Postgres (docker-compose.test.yml) and must never run as a side
// effect of the plain `yarn test` a developer runs with no DB available.
// Only src/**/*.integration.test.ts matches here; vitest.config.mts
// explicitly excludes that same pattern, so a file is picked up by exactly
// one of the two configs, never both and never neither.
//
// Run via `yarn test:integration` (starts the throwaway Postgres, applies
// migrations, then runs this config) — see CLAUDE.md's Testing section.
// Invoking `vitest run -c vitest.integration.config.mts` directly is fine
// too, as long as TEST_DATABASE_URL already points at a migrated database.
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.integration.test.ts"],
    // DB round trips over an emulated (arm64 host -> amd64 container)
    // Postgres are slower than the in-memory unit suite; give them room
    // instead of chasing flaky timeouts.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ["./vitest.integration.setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
