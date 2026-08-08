import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.ts", "scripts/**/*.{test,spec}.ts"],
    // *.integration.test.ts still matches the glob above (it ends in
    // .test.ts) — exclude it explicitly so this suite stays DB-free. Those
    // files run under vitest.integration.config.mts instead, against a real
    // throwaway Postgres (see CLAUDE.md's Testing section / `yarn
    // test:integration`), and must never run as a side effect of `yarn test`.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Injected before any test module loads so module-scope reads don't throw.
    // src/lib/auth.ts calls getPool() at module scope, and 44/62 route modules
    // transitively import it — without DATABASE_URL the bare import throws.
    // Pool construction does not open a connection, so no real DB is needed.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      BETTER_AUTH_SECRET: "test-secret-please-ignore",
      BETTER_AUTH_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
      ANTHROPIC_API_KEY: "sk-ant-test",
      KIS_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    },
  },
  resolve: {
    // tsconfig.json defines `@/*` -> `./src/*` but has no baseUrl, so an
    // explicit alias is more robust here than a tsconfig-paths plugin.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
