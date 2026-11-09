process.env.TZ = "Asia/Seoul";

import { afterEach, vi } from "vitest";

// Same reasoning as vitest.setup.ts: keep spies/mocks from leaking across
// tests within this project too.
afterEach(() => {
  vi.restoreAllMocks();
});

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Integration tests need a real Postgres — " +
      "run `yarn test:integration` (it starts docker-compose.test.yml, applies " +
      "migrations, then runs this suite) rather than invoking vitest on " +
      "*.integration.test.ts files directly. See CLAUDE.md's Testing section."
  );
}

// Jenkins exports DATABASE_URL alongside TEST_DATABASE_URL; `yarn test:integration`
// only sets the latter. Modules that touch getDb() at import need it too, so point
// it at the same disposable database (never a real one) when it is missing.
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
