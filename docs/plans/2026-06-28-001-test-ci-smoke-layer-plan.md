---
title: "test: Add CI smoke/assertion test layer"
type: test
status: active
date: 2026-06-28
origin: docs/brainstorms/2026-06-27-ci-smoke-testing-requirements.md
---

# test: Add CI smoke/assertion test layer

## Summary

Stand up a Vitest 4 test suite and gate the Jenkins pipeline on it. Three layers: real input→expected-output assertions on the pure money/parse/distance logic, an import smoke over all 62 API routes, and mock-based smoke on the extracted cron job bodies. No live third-party calls, no real DB — a green build means "every feature still loads/triggers and the money math is right."

---

## Problem Frame

Today the only automated verification is "the container boots and `/api/health` returns 200" (`Jenkinsfile`). Broken features, silently-stopped crons, and wrong financial numbers all ship green. This is the deliberately-light "작동+트리거링" safety net defined in the origin brainstorm (see origin: `docs/brainstorms/2026-06-27-ci-smoke-testing-requirements.md`) — a regression net, not comprehensive correctness. Production cron-firing monitoring (heartbeat) and HTTP/auth execution smoke stay out of scope.

---

## Requirements

### Pure-logic assertions (Layer 1)

- R1. `src/modules/portfolio/returns.ts` (`computeReturns`/`computeTWR`/`inferCashflows`/`computeXIRR`) has fixture→expected-value assertion tests. Core TWR/XIRR expected values are **independently derived** (hand-calc/spreadsheet), not snapshotted from current output; any output-captured case is tagged regression-only.
- R2. `src/modules/transaction/parser.ts` `parseTossNotification` has per-pattern assertion tests: basic withdrawal/deposit, transfer-received, payment, and self-transfer flagging.
- R3. `src/lib/geo.ts` `distanceM` (and `roundCoord`) has input→expected assertion tests. Detection-math assertions are deferred — no isolated pure helper exists to test cheaply (see Scope Boundaries).

### Route import smoke (Layer 2)

- R4. Every `src/app/api/**/route.ts` (62 files) imports without throwing under the test env, and each exports at least one HTTP verb. Catches import-time crashes, broken deps, and module-scope env throws.

### Cron logic smoke (Layer 4)

- R5. `syncAllUsers`, `processYesterdayLocations`, and `reparseTodayNotifications` are exported from `src/lib/cron.ts` in a directly-callable form.
- R6. Each extracted cron job, run with a mocked DB and mocked services, completes without throwing and invokes the expected service entry points (call-shape assertions, not exact call order).
- R7. The Toss ingest entry point (MacroDroid → parse → persist) gets a mocked success-path test — the gap U6's cron-reparse path doesn't reach. Portfolio sync and AI summary are covered at the invocation level by R6 and at the money-math level by R1; their standalone service-completion mock tests are deferred (see Scope Boundaries).

### CI integration

- R8. Tests run as a gating Jenkins stage **before** the Docker image build; a failing test blocks build/deploy.
- R9. The whole suite passes with no live third-party API calls and no real database.

---

## Key Technical Decisions

- KTD1. **Runner: Vitest 4**, `node` environment, `globals: false`, explicit `@` → `./src` alias in `vitest.config.mts`. Rationale: clean Next 16 / React 19 fit; pure-logic + import-smoke need no jsdom or React plugin; `tsconfig.json` has no `baseUrl` so an explicit `resolve.alias` is more robust than `vite-tsconfig-paths`; `globals: false` keeps Biome's `noUnusedImports` happy (explicit `import { describe, it, expect, vi }`).
- KTD2. **Dummy env injected via Vitest `test.env`** before any module loads (`DATABASE_URL`, `BETTER_AUTH_SECRET`, and the other build-time placeholders). Required: `src/lib/auth.ts` calls `getPool()` at module scope and 44/62 routes transitively import it, so a bare import throws without `DATABASE_URL`. This mirrors the Dockerfile builder stage and is exactly R4's unique delta over `next build`. `getPool()` constructs a `pg.Pool` but does not connect, so no real DB is needed.
- KTD3. **Route smoke via `import.meta.glob("/src/app/api/**/route.ts")` + `it.each`**, asserting each module loads and exports ≥1 HTTP verb, with a `cases.length > 0` guard so a glob typo can't pass silently. Keep the full 62-route smoke (not narrowed to a targeted env-presence check) — it is nearly free and fails fast before the expensive image build.
- KTD4. **Cron extraction = add `export` only**; keep the inline `getDb()` + factory construction. Importing `cron.ts` is already side-effect-free (`initializeCron()` must be called explicitly), so this is a minimal change. R6/R7 mock `@/db` (via `vi.mock` with `importOriginal` so re-exported schema tables survive), the service-factory modules, and the KIS/Anthropic adapter modules (also use `importOriginal` on `@/lib/adapters/kis/interface` so the re-exported `KISAuthError`/`KISApiError` classes survive for `instanceof` checks). No dependency-injection refactor (out of scope per brainstorm). Assertion contract: no-throw + expected entry-point calls, never exact call order (avoids brittleness while escaping tautology).
- KTD5. **R1 oracles are hand-computed.** Snapshotting current output only proves "changed," not "correct," and the returns math churned recently (T+2 settlement, 2026-05-12 epoch). `RETURNS_EPOCH` is applied only in the route layer (`src/app/api/portfolio/returns/route.ts`) as a snapshot filter, not inside the pure functions (verified in review) — so R1 fixtures use pure-function semantics with no epoch offset. Account for T+2 weekend-skipping settlement (`addBusinessDaysIso`) and the `CASHFLOW_NOISE_THRESHOLD = 1000` filter when constructing fixtures.
- KTD6. **CI test stage runs in Docker** (the Jenkins agent has no bare node/yarn). Add a `FROM base AS tester` Dockerfile target (or reuse the `deps` layer) running `yarn vitest run` with no DB, invoked from a new `stage('Test')` before `Build Docker Image` — mirroring the existing `migrator`-target pattern.

---

## High-Level Technical Design

New `Test` stage gates the pipeline before the expensive image build, so a red test short-circuits cheaply:

```mermaid
flowchart TB
  CO[Checkout] --> T[Test stage — yarn vitest run, no DB]
  T -->|pass| BUILD[Build Docker Image]
  T -->|fail| STOP[Pipeline fails — Telegram failure notify]
  BUILD --> MIG[Run Migrations] --> DEP[Deploy] --> HC[Health Check] --> CU[Cleanup]
```

Test-layer → target → what it asserts:

| Layer | Target | Asserts |
|---|---|---|
| L1 pure assertions | `returns.ts`, `parser.ts`, `geo.ts` | exact expected values (correctness oracle) |
| L2 route smoke | all 62 `route.ts` | module loads without throwing + exports a verb |
| L4 cron smoke | extracted `cron.ts` bodies + high-risk flows | no-throw + expected service calls (mocked deps) |

---

## Implementation Units

### U1. Vitest toolchain + config

- **Goal:** Working `yarn test` (`vitest run`) with alias resolution and dummy env, provable by one trivial smoke test.
- **Requirements:** Enables R1–R7; directly R9 (no DB/live calls baked into config).
- **Dependencies:** none.
- **Files:** `package.json` (add `vitest`, `@vitest/coverage-v8` optional, devDeps; add `"test": "vitest run"`, `"test:watch": "vitest"`), `vitest.config.mts` (create), `vitest.setup.ts` (create, optional `afterEach(vi.restoreAllMocks)`), `tsconfig.json` (modify — exclude test/config files from the Next app build), `src/app/api/health/route.test.ts` (create — toolchain sanity).
- **Approach:** node environment, `globals: false`, explicit `resolve.alias` for `@`, `test.env` block with dummy `DATABASE_URL`/`BETTER_AUTH_SECRET`/`KIS_ENCRYPTION_KEY` (≥32 chars)/etc. Test files co-locate next to source as `*.test.ts` (Biome `noUnusedImports` only errors on genuinely unused, so co-location is fine with explicit imports). **Exclude `**/*.test.ts`, `vitest.config.mts`, and `vitest.setup.ts` from `tsconfig.json`** so `next build` doesn't compile test code — the Docker builder copies all source before `yarn build` and `tsconfig` currently includes all `**/*.ts`, so without the exclude the build would try to type-check test files importing Vitest.
- **Patterns to follow:** Dockerfile builder dummy-env values (`DATABASE_URL=postgresql://build:build@localhost:5432/build`, `BETTER_AUTH_SECRET=build-placeholder`).
- **Test scenarios:** Importing `src/app/api/health/route.ts` and calling `GET()` returns a 200 response (proves runner + node `next/server` + alias all work). `Covers AE1` partially (loadability).
- **Verification:** `yarn test` runs non-interactively and the health test passes.

### U2. Returns/TWR/XIRR assertion tests

- **Goal:** Correctness oracle over the financial math.
- **Requirements:** R1.
- **Dependencies:** U1.
- **Files:** `src/modules/portfolio/returns.test.ts` (create).
- **Approach:** Build fixtures of `ReturnSnapshot[]` + `ReturnExecution[]` with **hand-computed** expected TWR/XIRR. Cover the documented mechanics: full-account-value TWR (`eval + deposit`), cashflow-at-period-end subtraction, `startValue <= 0` period skip, T+2 settlement inference, noise-threshold filtering, day-0 synthetic deposit for XIRR anchoring.
- **Execution note:** characterization-resistant — derive expecteds independently, do not paste current output.
- **Test scenarios:**
  - `Covers AE2.` Fixed snapshot/execution set → `computeReturns` returns the independently-derived TWR and XIRR; drift fails the test.
  - `inferCashflows`: a pure deposit (no trades) → one inflow cashflow equal to the deposit; a buy settling T+2 within a period → zero external cashflow; a withdrawal → one negative cashflow; sub-threshold delta (< 1000) → no cashflow.
  - `computeTWR`: two-snapshot flat period → ~0 return; a period with `startValue <= 0` is skipped; multiplicative chaining across ≥3 periods.
  - `computeXIRR`: a known deposit-then-growth series → expected annualized IRR within tolerance; all-positive or all-negative flows → `null`.
  - Edge: `< 2` snapshots → null/empty result shape.
- **Verification:** all returns cases pass with hand-derived expecteds; no value sourced from current output except cases explicitly commented `regression-only`.

### U3. Parser + geo assertion tests

- **Goal:** Pin Toss parsing and distance math.
- **Requirements:** R2, R3.
- **Dependencies:** U1.
- **Files:** `src/modules/transaction/parser.test.ts` (create), `src/lib/geo.test.ts` (create).
- **Approach:** Table-driven cases per parser pattern; numeric expecteds for `distanceM`.
- **Test scenarios:**
  - Parser: basic withdrawal (`"6,900원 출금"` + `"내 토스뱅크 통장 → 쿠팡"`) → withdrawal/amount/merchant/account; basic deposit (`"1원 입금"` + `"**** → 내 토스뱅크 통장"`); transfer-received (`"OOO님이 300,000원을 보냈어요"`) → deposit; payment (`"13,900원 결제"` + `"토스페이머니 | 주식회사 우아한형제들"`); self-transfer flag set when `merchant === myName`; malformed title / wrong arrow-part count → `null`.
  - geo: `distanceM` zero distance for identical points; a known lat/lon pair → expected meters within tolerance; `roundCoord` rounds to `COORD_DECIMALS`.
- **Verification:** all parser patterns and geo cases pass.

### U4. Route import smoke

- **Goal:** Every API route module loads without throwing.
- **Requirements:** R4.
- **Dependencies:** U1 (needs dummy env).
- **Files:** `src/app/api/_routes-import.test.ts` (create).
- **Approach:** `import.meta.glob("/src/app/api/**/route.ts")`, `it.each` over entries, assert the module loads and exports ≥1 of GET/POST/PUT/DELETE/PATCH; guard `entries.length > 0`.
- **Test scenarios:**
  - `Covers AE1.` Each of the 62 route modules imports without throwing under dummy env; a route that reads required env at module scope without a default would fail (the throw class this catches).
  - The glob matches > 0 files (guards against a glob typo passing vacuously).
- **Verification:** all 62 route imports pass; deleting the dummy `DATABASE_URL` makes the auth-backed routes fail (confirms the test is real, not vacuous).

### U5. Extract cron job bodies

- **Goal:** Make the cron bodies directly callable from tests.
- **Requirements:** R5.
- **Dependencies:** none (independent of U1, but consumed by U6).
- **Files:** `src/lib/cron.ts` (modify — add `export` to `syncAllUsers`, `processYesterdayLocations`, `reparseTodayNotifications`).
- **Approach:** Add `export` only; preserve inline `getDb()`/factory construction, single-flight guards, and `initializeCron()` wiring unchanged. Confirm importing `cron.ts` triggers no `initializeCron()` side effects.
- **Test scenarios:** `Test expectation: none -- pure export-visibility change; behavior covered by U6.`
- **Verification:** the three functions are importable; `initializeCron`/`stopCron` and scheduling behavior unchanged.

### U6. Cron mock smoke

- **Goal:** Each cron body runs under mocks without throwing and calls the expected work.
- **Requirements:** R6.
- **Dependencies:** U1, U5.
- **Files:** `src/lib/cron.test.ts` (create).
- **Approach:** `vi.mock("@/db")` with `importOriginal` (preserve schema exports), stub `getDb()` to return a query-shaped mock; register all mocks **before** importing `cron.ts` (it statically imports `getDb`/`syncJobs`/`users`). Mock the service-factory modules (`@/modules/sync/service`, `@/modules/summary/service` — including the static `SummaryService.reviveStaleProcessing`, `@/modules/wakatime/service`, `@/modules/portfolio/service`), `@/lib/auth-helpers` (stub `getGitHubToken` — `syncAllUsers` throws before `createSyncService` if it's falsy), `@/lib/data-usage` (`maybeRefreshDataUsage` runs DB chains for a due user), and the dynamically-imported pipeline modules (`@/modules/location/services/anomaly-filter`, `.../visit-persister`, `.../track-persister`, `.../subway-match/matcher`, `.../subway-match/session-grouper`, `.../subway-discovery`, `@/modules/transaction/reparse-service`). Assert call-shape (function + key args), not order.
- **Test scenarios:**
  - `Covers AE3.` `syncAllUsers` with a mocked zero-user query completes without throwing and reaches `SummaryService.reviveStaleProcessing(db)` (the only entry point before the early-return).
  - `syncAllUsers` with one due user + token → `syncUserCommits(user.id, login, "scheduled")` called; with `ANTHROPIC_API_KEY` set → `processPendingSummaries(20, undefined, user.id)`; with `hasActiveAccounts` true → `syncUserAccounts(user.id)` then `backfillPendingAccounts(user.id)`, and neither when `hasActiveAccounts` is false.
  - `reparseTodayNotifications` with one Toss user (frozen time) → `reparseNotifications(db, user.id, { dryRun: false, from, to, tossMyName })`; no throw on zero users.
  - `processYesterdayLocations` → completes without throwing with mocked DB; the anomaly/visit/track stage functions receive the mocked user id + date (plumbing-only; PostGIS results not asserted).
- **Verification:** all cron-smoke cases pass; no real DB or network engaged.

### U7. Toss ingest success-path test

- **Goal:** Exercise the MacroDroid → Toss notification ingest entry point with the DB mocked — the one high-risk flow U6's cron path doesn't reach.
- **Requirements:** R7.
- **Dependencies:** U1.
- **Files:** `src/app/api/toss-notifications/route.test.ts` (create).
- **Approach:** Drive the handler with a representative notification payload, API-key auth + rate-limit boundary mocked, `@/db` mocked. Assert the parsed transaction is persisted. Portfolio-sync and AI-summary standalone service tests are intentionally NOT here — two independent reviews found them redundant with U6 (invocation) + U2 (money math), and the portfolio path additionally needs crypto/transaction mocking that exceeds the smoke bar.
- **Test scenarios:**
  - Representative Toss notification → parsed transaction persisted (against mocked DB), no throw.
  - Malformed or duplicate payload → handled without a 500.
- **Verification:** the ingest success path passes with no live secrets or DB.

### U8. Jenkins + Docker CI wiring

- **Goal:** Gate the pipeline on the suite.
- **Requirements:** R8, R9.
- **Dependencies:** U1 (script + config must exist).
- **Files:** `Jenkinsfile` (modify — add `stage('Test')` before `Build Docker Image`), `Dockerfile` (modify — add `FROM base AS tester` target running deps install + `yarn vitest run`, or reuse `deps`).
- **Approach:** Mirror the `migrator`-target pattern: `docker build --target tester` then run, or reuse the `deps` layer with `yarn vitest run`. No DB container, no migrations, no `--env-file` (dummy env lives in Vitest config). Red test fails the stage before the image build.
- **Test scenarios:** `Test expectation: none -- CI config; validated by pipeline run (green on pass, red+blocked on a deliberately failing test).`
- **Verification:** a passing suite lets the pipeline continue to Build; a deliberately failing test fails the Test stage and blocks Build/Deploy.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- Detection-math assertions (R3 beyond `geo`) — no isolated pure helper; revisit if one is extracted.
- Cron bodies beyond the three named (`runTripDetection`, `runSubwayRefresh`, `maybeRunSubwayBootCatchUp`) — export/smoke later if needed.
- Real assertion on the location pipeline's PostGIS logic — needs the deferred L5 DB harness.
- Standalone service-completion mock tests for portfolio sync and AI summary — U6 covers their cron invocation and U2 covers the money math; add later only if that coverage proves insufficient.

### Outside scope (from origin)

- HTTP/auth execution smoke (Layer 3, app boot) and real Postgres/PostGIS integration (Layer 5).
- Production cron-firing monitoring (heartbeat/dead-man's switch) — runtime concern, not CI.
- 62-route E2E, Better Auth OAuth reproduction, cron schedule-timing tests, API response snapshot spam, live third-party calls, and any large "do it properly" refactor (including cron dependency injection).

---

## Risks & Dependencies

- **Biome lints test files** under `src/` (`yarn lint ./src`); `noUnusedImports` is an error. Mitigation: `globals: false` + explicit Vitest imports; keep mocks tidy.
- **Returns epoch.** Verified: `RETURNS_EPOCH` (2026-05-12) lives only in the returns route's snapshot filter, not the pure functions — R1 fixtures need no epoch offset.
- **T+2 fixture sensitivity.** `inferCashflows` skips weekends only (no holiday calendar); fixtures straddling settlement boundaries need care or hand-computed expecteds won't match.
- **Route smoke depends on dummy env** (KTD2) — without it 44/62 routes throw at import; the env must be in Vitest config, not the shell.
- **Jenkins is Docker-only** — the Test stage must run inside a Docker target, not as a bare agent step.

---

## Open Questions

### Deferred to implementation

- Per-cron-job R6 assertion specifics (which exact entry points to assert per job) — settle while writing U6, holding to call-shape-not-order.
- Whether to extract one pure detection helper to bring a slice of detection math into R3 — only if a clean, stateless, `getDb()`-free helper surfaces during U3.
- `tester` Docker target vs reusing the `deps` layer — pick the simpler working shape in U8.

---

## Sources / Research

- `src/lib/cron.ts` — private job bodies `syncAllUsers` (L82), `processYesterdayLocations` (L366), `reparseTodayNotifications` (L584); only `initializeCron`/`stopCron` exported; importing is side-effect-free.
- `src/modules/portfolio/returns.ts` — pure `computeReturns`/`computeTWR`/`inferCashflows`/`computeXIRR`; only `parseKstDate` dep (itself pure); `computeXIRR` has a dead `startDate` branch.
- `src/modules/transaction/parser.ts`, `src/lib/geo.ts` — zero-import pure functions.
- `src/lib/auth.ts` — module-scope `getPool()`; `src/db/index.ts` — `getPool()` throws on missing `DATABASE_URL`, `getDb()` lazy, Pool construction does not connect.
- `Jenkinsfile` — Checkout → Build → Migrate → Deploy → Health Check → Cleanup; insert Test before Build. `Dockerfile` — `base`/`deps`/`builder`/`migrator`/`runner`; builder uses dummy `DATABASE_URL`/`BETTER_AUTH_SECRET`.
- Vitest 4 + Next 16 docs: `vitest.config.mts`, `test.env`, `import.meta.glob`, `vi.mock`/`vi.hoisted`/`importOriginal`; Vitest 4 removed `environmentMatchGlobs`/`workspace`. `next/server` works in node 22.
- `docs/portfolio/kis-integration.md` — KIS payloads are string-typed; mock at the adapter interface to skip throttle/backoff.
- Codex advisory — layer priority (pure units > import smoke > cron smoke), and anti-patterns to avoid (live calls, OAuth reproduction, schedule-timing tests, snapshot spam, large refactors).
