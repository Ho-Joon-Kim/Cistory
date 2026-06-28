import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.ts"],
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
