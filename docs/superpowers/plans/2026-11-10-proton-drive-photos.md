# Proton Drive Photos (Collection Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Proton Drive Photos metadata, location and NSFW-screened thumbnails into Cistory through a server-held Proton session. Sync runs from the cron container as an event-driven pipeline: a one-time backfill first, then incremental events.

**Architecture:** A new adapter (`src/lib/adapters/proton/`) wraps `@protontech/drive-sdk` and a vendored, lightly modified copy of Proton's MIT account module. The token refresh is injected and runs under a per-user `pg_advisory_xact_lock`. A new feature module (`src/modules/proton/`) owns the connection lifecycle, the backfill and event state machines, and the ingest pipeline: node details, then thumbnail, then a local NSFWJS classifier, then pass or block. It also owns OwnTracks location fill and the cron task. Web only reads stored rows. The only Proton calls web makes are the fork start/poll, a one-time volume lookup on connect completion, and a best-effort revoke.

**Tech Stack:** Next.js 16 (Turbopack build, webpack in browser tests), Drizzle/PostgreSQL, Vitest 5, `@protontech/drive-sdk@0.23.0`, `@protontech/crypto@2.2.0` (Yarn `patch:`), `core-js` array-buffer-base64, `ky`, `nsfwjs@4.4.0` with `@tensorflow/tfjs@4.22.0` and `@tensorflow/tfjs-backend-wasm@4.22.0`, `jpeg-js@0.4.4`.

**Spec:** `docs/superpowers/specs/2026-11-10-proton-drive-photos-design.md` (Korean; executors read both).

## Global Constraints

- **Network:** this Mac sits behind Zscaler TLS interception. Prefix every yarn/npm network command with `NODE_OPTIONS=--use-system-ca` (e.g. `NODE_OPTIONS=--use-system-ca yarn add …`). Never commit that workaround into scripts, Dockerfile, `.yarnrc.yml` or docs.
- **Version pins:**
  - `@protontech/drive-sdk` is pinned to exactly `0.23.0`. An incompatible crypto-model change is announced for late 2026 to early 2027.
  - `@protontech/crypto` is pinned to exactly `2.2.0` and applied through Yarn `patch:` with Proton's patch (`openpgp/lightweight` → `openpgp`).
- **Load order:** `core-js/proposals/array-buffer-base64` must load before any `@protontech/crypto` code. Only `src/lib/adapters/proton/runtime.ts` may value-import `@protontech/crypto` (root, `/proxy/*`, `/srp`), and it does so via dynamic `import()` after the polyfill. Type-only imports are allowed anywhere. Value import of `@protontech/crypto/constants` is allowed in the vendored `addresses.ts` only.
- **Bundling:**
  - Use `transpilePackages: ["@protontech/crypto"]`. It must never be listed in `serverExternalPackages`, because Node 24 refuses TS type stripping under node_modules.
  - Add `test.server.deps.inline` in `vitest.config.mts` (and the integration config).
- **Dockerfile:** `COPY .yarn/patches ./.yarn/patches` goes before `yarn install --immutable` in both the `deps` and `browser-tester` stages.
- **Login constants:**
  - `authClientId: "external-drive"`
  - `PROTON_APP_VERSION = "external-drive-cistory@1.0.0-stable"` (code constant, no env var)
  - API base `drive-api.proton.me`, account URL `account.proton.me`
- **No new environment variables.** Encryption uses `encryptSecret`/`decryptSecret` from `src/lib/crypto.ts` (`KIS_ENCRYPTION_KEY`).
- **Encryption at rest:** tokens, `key_password` and the pending fork key are always stored AES-256-GCM-encrypted. Entity and crypto caches are request-scoped `MemoryCache` objects and are never persisted.
- **Timestamps:**
  - `photos.captured_at` stores `photo.captureTime` / `TimelineItem.captureTime` (true UTC) as UTC wall time through Drizzle.
  - Never re-interpret captured times as KST.
  - Use `localDaySql` for KST days.
  - In raw SQL, bind dates via `timestampParam` or ISO strings with `::timestamp`, never bare `now()`.
- **Fixed error messages:** `last_error`, `details_error` and route error bodies are fixed Korean strings, never Proton payloads.
- **Web/cron split:** web never calls Proton for thumbnails or sync. The NSFW model loads only in the cron process.
- **Cron:**
  - Schedule `*/10 * * * *` with name `proton-photos` and `timezone: "Asia/Seoul"`.
  - Per-user session lock: `pg_try_advisory_lock` on a dedicated pool client, unlocked on the same client in `finally`.
- **Backfill and sync limits:**
  - Details batch: ≤500 rows per tick, with `iterateNodes` and `iterateThumbnails` chunks of 50.
  - `details_attempts < 3`; `thumbnail_attempts` is capped at 3.
  - Location window: ±15 min (`900` s).
  - Location pipeline window: 45 days.
- **NSFW:**
  - Block if `porn + hentai >= 0.5` or `sexy >= 0.8` (constants).
  - `NSFW_MODEL_VERSION` is a code constant.
  - Blocked → photo row deleted (thumbnail cascades) and `photo_blocks(node_uid)` inserted; bytes are never logged or sent to Sentry.
  - Fail closed: no unclassified image is ever stored.
- **Exposure:** only rows with `details_synced_at IS NOT NULL AND deleted_at IS NULL` are counted or served by any API.
- **Thumbnail response headers:** `Cache-Control: private, max-age=86400`, `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`.
- **Migrations:** generate with `yarn db:generate --name proton_photos` (expected `drizzle/0047_proton_photos.sql`; never hand-number) and review the SQL.
- **Commits:** Conventional Commit subjects. Each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Classifier fails to load in the cron container** (wasm file not traced into standalone, OOM). Expected: nothing is stored, `details_attempts` is **not** burned for the whole library, the details stage is skipped for the tick, and the connection shows the fixed `PROTON_ERRORS.classifierUnavailable`. Pinned in Task 9 (`does not consume attempts when the classifier is unavailable`).
2. **A cron refresh racing a web connect/disconnect refresh for the same user.** Expected:
   - only one POST per rejected token;
   - a 4xx on a refresh token another writer already rotated never flips `needs_reauth`.

   Pinned in Task 4 (`skips the POST when another writer already rotated the token`, `retries with the newer token instead of needs_reauth`).
3. **A thumbnail that is not a JPEG** (WebP/PNG from a future client, truncated bytes). Expected: an attempt counts as a classification failure, the bytes are never stored, and the row stays hidden. Pinned in Tasks 7 and 9.
4. **Photos taken 00:00–09:00 KST.** Expected:
   - location settlement looks up the correct KST `location_processing_days` row;
   - `/data-status` buckets the photo on its KST day, not the UTC day.

   Pinned in Task 12 (integration) and Task 13 (integration).
5. **The same fork polled twice concurrently, or polled after expiry.** Expected:
   - exactly one activation;
   - an expired first-time `pending` row is deleted;
   - an expired re-connect clears only `pending_*` and keeps the active tokens.

   Pinned in Task 6.

---

## File Structure

```
src/lib/adapters/proton/
  constants.ts                PROTON_* constants
  runtime.ts                  polyfill → dynamic @protontech/crypto init (memoized)
  account/                    vendored MIT module (SDK commit 05c9115), biome-ignored
    auth.ts                   + beginWebFork / pollWebForkOnce
    apiClient.ts              + refreshSession option (replaces performTokenRefresh POST + signOut)
    (accountApi, addresses, authWeb, srp, … unchanged)
  fork.ts                     startProtonFork / pollProtonFork (no crypto runtime needed)
  http.ts                     postProtonRefresh / revokeProtonSession (plain fetch)
  errors.ts                   isAuthFailure / isRateLimited / isCursorRejection
  client.ts                   createProtonPhotosClient → ProtonPhotosApi
src/modules/proton/
  types.ts                    statuses, PROTON_ERRORS, row types
  credentials.ts              DbSessionCredentials (SessionCredentials impl, memory only)
  token.ts                    refreshProtonSession (advisory-lock refresher)
  session.ts                  openProtonPhotos(db, connection)
  connection.ts               ProtonConnectionService (connect/status/disconnect)
  summary.ts                  getProtonSummary (card + data-status counts)
  mapper.ts                   mapPhotoNode
  repository.ts               DB writes/reads for photos/blocks/thumbnails
  ingest.ts                   prepareIngest / applyIngest (details + thumbnail + NSFW)
  backfill.ts                 baseline / list / details / complete
  events.ts                   planEventBatch / processEvents
  location.ts                 fillPhotoLocations
  sync.ts                     syncProtonPhotosForUser / syncAllProtonPhotos
  cron.ts                     registerProtonPhotosTask (+ warm-up)
  nsfw/classifier.ts          PhotoClassifier interface, isBlocked, errors, constants
  nsfw/decode.ts              decodeJpegToRgb
  nsfw/nsfwjs.ts              createNsfwjsClassifier (wasm → cpu fallback)
  hooks.ts, components/ProtonSettings.tsx
src/app/api/proton/route.ts                    GET summary, DELETE disconnect
src/app/api/proton/connect/route.ts            POST start
src/app/api/proton/connect/status/route.ts     GET poll
src/app/api/photos/[photoId]/thumbnail/route.ts
scripts/rescreen-photo-thumbnails.ts
```

---

### Task 1: Proton dependencies, crypto patch, bundling and runtime entry

**Files:**

- Create: `.yarn/patches/@protontech-crypto-npm-2.2.0.patch` (copied verbatim from the SDK clone `config/js/patches/@protontech%2Fcrypto@2.2.0.patch`)
- Modify: `package.json`, `yarn.lock`, `next.config.ts`, `vitest.config.mts`, `vitest.integration.config.mts`, `Dockerfile:7-9,42-46`
- Create: `src/lib/adapters/proton/constants.ts`, `src/lib/adapters/proton/polyfill.ts`, `src/lib/adapters/proton/runtime.ts`
- Test: `src/lib/adapters/proton/runtime.test.ts`, `src/lib/adapters/proton/import-guard.test.ts`

**Interfaces:**

- Produces:
  - `PROTON_APP_VERSION = "external-drive-cistory@1.0.0-stable"`, `PROTON_AUTH_CLIENT_ID = "external-drive"`, `PROTON_API_BASE_URL = "drive-api.proton.me"`, `PROTON_ACCOUNT_URL = "account.proton.me"`, `PROTON_CLIENT_UID = "cistory"`.
  - `initProtonRuntime(): Promise<ProtonRuntime>`, memoized, where `interface ProtonRuntime { cryptoProxy: CryptoApiInterface; srpApi: { getSrp; computeKeyPassword; generateKeySalt; getRandomSrpVerifier } }`.

- [ ] **Step 1: Add dependencies.**

  The dependency lines are:
  - `"@protontech/drive-sdk": "0.23.0"`
  - `"@protontech/crypto": "patch:@protontech/crypto@npm%3A2.2.0#~/.yarn/patches/@protontech-crypto-npm-2.2.0.patch"`
  - `"core-js": "^3.51.0"`
  - `"ky": "^1.14.3"`

  Run `NODE_OPTIONS=--use-system-ca yarn install`. Expected: the patch applies with no "hunk failed" error, and `node_modules/@protontech/crypto/src/pmcrypto/openpgp.ts` imports from `"openpgp"`.

- [ ] **Step 2: Write the failing runtime test** in `src/lib/adapters/proton/runtime.test.ts`:

```ts
it("installs the base64/hex polyfill before crypto loads", async () => {
  await initProtonRuntime();
  expect(new Uint8Array([1, 255]).toHex()).toBe("01ff");
});
it("round-trips a passphrase-protected key through CryptoProxy (needs toHex)", async () => {
  const { cryptoProxy } = await initProtonRuntime();
  const key = await cryptoProxy.generateKey({ userIDs: [{ name: "t", email: "t@example.com" }] });
  const armored = await cryptoProxy.exportPrivateKey({ privateKey: key, passphrase: "pw" });
  const back = await cryptoProxy.importPrivateKey({ armoredKey: armored, passphrase: "pw" });
  expect(back.getFingerprint()).toBe(key.getFingerprint());
}, 30_000);
it("is memoized", async () => {
  expect(await initProtonRuntime()).toBe(await initProtonRuntime());
});
```

If a method or option name differs in the 2.2.0 `CryptoApiInterface`, use its exact name. The assertion stays a passphrase round-trip.

- [ ] **Step 3: Write the failing import guard** in `src/lib/adapters/proton/import-guard.test.ts`. It globs `src/**/*.{ts,tsx}` and asserts that no file other than `runtime.ts` contains a non-`import type` static import of `@protontech/crypto` (except `@protontech/crypto/constants` in `account/addresses.ts`).

- [ ] **Step 4: Run the tests to verify they fail.**

  Run: `yarn test src/lib/adapters/proton`. Expected: FAIL with "Cannot find module './runtime'".

- [ ] **Step 5: Implement the polyfill and runtime.**

  `polyfill.ts` contains only `import "core-js/proposals/array-buffer-base64";`.

  `runtime.ts` exports `initProtonRuntime`. It runs `await import("./polyfill")` first, then dynamic-imports `@protontech/crypto`, `@protontech/crypto/proxy/endpoint/api.ts` and `@protontech/crypto/srp`. Then it calls `CryptoApi.init({})` and `CryptoProxy.setEndpoint(new CryptoApi(), (e) => e.clearKeyStore())`. Do not use a worker pool. Dynamic import is what keeps the load order correct regardless of Biome import sorting.

- [ ] **Step 6: Configure bundling.**
  - `next.config.ts`: add `transpilePackages: ["@protontech/crypto"]`.
  - `vitest.config.mts` and `vitest.integration.config.mts`: add `server: { deps: { inline: [/@protontech\/crypto/] } }` under `test`.
  - `Dockerfile`: add `COPY .yarn/patches ./.yarn/patches` after `COPY package.json yarn.lock .yarnrc.yml ./` in both `deps` and `browser-tester`.

- [ ] **Step 7: Run the tests to verify they pass.**

  Run: `yarn test src/lib/adapters/proton`. Expected: PASS.

- [ ] **Step 8: Verify the full gates.**

  Run `yarn typecheck && yarn lint && yarn test && yarn build`. Expected: all green.

  If `yarn typecheck` reports errors **inside** `node_modules/@protontech/crypto/src/**`, apply fixes in this order:
  1. Align `compilerOptions.lib`/`target` (e.g. `"lib": ["dom","dom.iterable","esnext"]` is already present). Retry.
  2. If errors remain, stop and report BLOCKED with the error list. A `paths` shim would also redirect Next's resolver, so it must not be added without verifying that `yarn build` still bundles the real package.

- [ ] **Step 9: Verify the Docker build.**

  Run `docker build --target tester .`. Expected: the deps stage resolves the patch and `yarn test` passes on Alpine. Use `NODE_OPTIONS=--use-system-ca` only via a local `--build-arg` if the corporate proxy blocks it, and never commit that.

- [ ] **Step 10: Commit.**

  `git commit -m "build(proton): add drive-sdk, patched @protontech/crypto and runtime entry"`

---

### Task 2: Vendored account module with fork split and refresh seam

**Files:**

- Create: `src/lib/adapters/proton/account/*`, copied from `incubating/account/js/src` at SDK commit `05c9115955589d9f6ab7392a36f8f0cb39327133`. Exclude `*.test.ts`. Each file gets the header: `// Vendored from ProtonDriveApps/sdk incubating/account/js/src @ 05c9115 — MIT, Copyright (c) 2025-2026 Proton AG. Local changes marked "CISTORY:".`
- Create: `src/lib/adapters/proton/account/LICENSE` (the MIT text from the SDK's `LICENSE.md`)
- Modify: `biome.json` (`files.includes` += `"!src/lib/adapters/proton/account"`)
- Create: `src/lib/adapters/proton/fork.ts`, `src/lib/adapters/proton/http.ts`, `src/lib/adapters/proton/errors.ts`
- Test: `src/lib/adapters/proton/account/apiClient.cistory.test.ts`, `src/lib/adapters/proton/fork.test.ts`, `src/lib/adapters/proton/http.test.ts`, `src/lib/adapters/proton/errors.test.ts`

**Interfaces:**

- Consumes: `PROTON_*` constants (Task 1).
- Produces:
  - `ApiClientOptions.refreshSession?: (rejectedAccessToken: string | undefined) => Promise<SessionInfo | null>` (CISTORY change 2).
  - `Auth.beginWebFork(): Promise<{ selector: string; signInUrl: string; encryptionKey: Buffer }>` and `Auth.pollWebForkOnce(selector: string, encryptionKey: Buffer): Promise<ForkPollResult>` (CISTORY change 1).
  - `type ProtonSessionTokens = { uid: string; accessToken: string; refreshToken: string }`
  - `type ForkPollResult = { status: "pending" } | { status: "ready"; tokens: ProtonSessionTokens; keyPassword: string }`
  - `startProtonFork(): Promise<{ selector: string; signInUrl: string; encryptionKey: Buffer; expiresAt: Date }>` (expiresAt = now + 10 min)
  - `pollProtonFork(selector: string, encryptionKey: Buffer): Promise<ForkPollResult>`
  - `type RefreshHttpResult = { kind: "ok"; uid: string; accessToken: string; refreshToken?: string } | { kind: "rejected"; status: number } | { kind: "rate_limited" } | { kind: "transient" }`
  - `postProtonRefresh(tokens: ProtonSessionTokens): Promise<RefreshHttpResult>`
  - `revokeProtonSession(tokens: ProtonSessionTokens): Promise<boolean>`
  - `isAuthFailure(e: unknown): boolean`, `isRateLimited(e: unknown): boolean`, `isCursorRejection(e: unknown): boolean`

- [ ] **Step 1: Write the failing apiClient seam tests.**

```ts
it("delegates a 401 refresh to the injected refreshSession and never signs out on 4xx", async () => {
  const credentials = fakeCredentials({ accessToken: "old" }); // signOut = vi.fn()
  const refreshSession = vi.fn(async () => null);
  const client = new ApiClient({
    baseUrl: "https://api.test",
    appVersion: PROTON_APP_VERSION,
    credentials,
    logger: quiet,
    refreshSession,
  });
  expect(await client.refreshSessionIfPossible("old")).toBe(false);
  expect(refreshSession).toHaveBeenCalledWith("old");
  expect(credentials.signOut).not.toHaveBeenCalled();
});
it("applies the refreshed session to credentials and reports success", async () => {
  const refreshSession = vi.fn(async () => ({ uid: "u", accessToken: "new", refreshToken: "r2" }));
  /* … */ expect(await client.refreshSessionIfPossible("old")).toBe(true);
  expect(credentials.setSessionInfo).toHaveBeenCalledWith({
    uid: "u",
    accessToken: "new",
    refreshToken: "r2",
  });
});
```

- [ ] **Step 2: Write the failing fork tests.**

  `fork.test.ts`: encrypt `{"type":"…","keyPassword":"kp"}` with AES-256-GCM, nonce(12) ‖ ct ‖ tag(16), AAD `"fork"`.

```ts
it("decrypts the fork payload into the key password", async () => { /* stub sessionForksStatus → {UID,AccessToken,RefreshToken,Payload} */
  expect(await pollProtonFork("sel", key)).toEqual({ status: "ready",
    tokens: { uid: "U", accessToken: "A", refreshToken: "R" }, keyPassword: "kp" });
});
it("returns pending on 422", …);
it("rejects a payload sealed with another key (GCM auth fails)", …); // throws
it("builds a sign-in URL carrying external-drive and a 10-minute expiry", …);
  // signInUrl starts with "https://account.proton.me/desktop/login?app=drive&pv=3#payload="
  // and contains encodeURIComponent(":external-drive")
```

- [ ] **Step 3: Write the failing http tests.**

  `http.test.ts` stubs `globalThis.fetch`:

```ts
it("refresh POSTs /auth/v4/refresh with x-pm-uid, x-pm-appversion and refresh_token grant", …);
it("maps 200 → ok (keeps refreshToken undefined when omitted), 429 → rate_limited, 400/422 → rejected, 5xx/network → transient", …);
it("revoke sends DELETE /auth/v4 with Bearer + x-pm-uid and returns true on 2xx", …);
it("revoke refreshes once on 401 then retries with the new access token", …);
it("revoke returns false (never throws) when both attempts fail", …);
```

- [ ] **Step 4: Write the failing errors tests.**

  `errors.test.ts` uses SDK classes from `@protontech/drive-sdk`:
  - `RateLimitedError` → rate limited.
  - `ServerError` with `statusCode` 401 or 403 → auth.
  - `ValidationError`, and `ServerError` with `statusCode` ∈ {400, 404, 422} → cursor rejection.
  - A generic `Error` → none of the three.

- [ ] **Step 5: Run the tests to verify they fail.**

  Run: `yarn test src/lib/adapters/proton`. Expected: FAIL.

- [ ] **Step 6: Copy the vendored files and apply the two CISTORY changes.**
  1. In `auth.ts`, add `beginWebFork` and `pollWebForkOnce`, mirroring `authViaWeb` without the loop and **without** writing credentials. Keep `authViaWeb` intact.
  2. In `apiClient.ts`, `performTokenRefresh()` first checks `this.options.refreshSession`. If present: `const info = await this.options.refreshSession(currentAccessToken)`. If `info` is non-null, call `await credentials.setSessionInfo(info)` and return `true`. Otherwise return `false`, and never call `signOut`. Without the option, the original behaviour is unchanged.

- [ ] **Step 7: Implement `fork.ts`, `http.ts` and `errors.ts`.**
  - `fork.ts` builds an `ApiClient` with inert credentials and an `AccountApi`. It uses `PROTON_AUTH_CLIENT_ID` and `PROTON_ACCOUNT_URL`.
  - `http.ts` uses plain `fetch` with a 30 s `AbortSignal.timeout`.

- [ ] **Step 8: Run the tests to verify they pass.**

  Run `yarn test src/lib/adapters/proton && yarn typecheck && yarn lint`. Expected: PASS.

- [ ] **Step 9: Commit.**

  `git commit -m "feat(proton): vendor account module with fork split and injectable refresh"`

---

### Task 3: Schema and migration

**Files:**

- Modify: `src/db/schema.ts` (add a `bytea` customType and four tables after `wakatimeConnections`)
- Create: `drizzle/0047_proton_photos.sql` + `drizzle/meta/*` (generated)

**Interfaces:**

- Produces: `protonConnections`, `photos`, `photoBlocks`, `photoThumbnails` and their types `ProtonConnection`, `Photo`, `PhotoBlock`.
  - **`proton_connections`:**
    - `id` uuid PK; `user_id` → `users` (cascade), unique.
    - `uid_enc`, `access_token_enc`, `refresh_token_enc`, `key_password_enc` (text, nullable while pending).
    - `status` text not null, `$type<"pending" | "active" | "needs_reauth">()`.
    - `pending_fork_selector`, `pending_fork_key_enc`, `pending_fork_expires_at`.
    - `volume_id`, `event_cursor`, `timeline_listed_at`, `backfill_completed_at`, `last_synced_at`, `last_error`.
    - `created_at`, `updated_at`.
  - **`photos`:**
    - `id` uuid PK; `user_id` (cascade).
    - Identity and form: `node_uid` not null, `main_photo_node_uid`, `content_hash`, `captured_at` timestamp not null, `media_type`, `width` int, `height` int, `duration_sec` double.
    - Location: `lat`, `lon` double; `location_source` text `$type<"exif" | "owntracks">()`; `location_gap_sec` int.
    - Source metadata: `device`, `tags` integer[], `claimed_metadata` jsonb.
    - State: `trashed_at`, `deleted_at`, `details_synced_at`, `location_checked_at`.
    - Attempts: `details_attempts` int not null default 0, `details_error`, `thumbnail_attempts` int not null default 0.
    - `created_at`, `updated_at`.
    - Indexes: unique `(user_id, node_uid)`, index `(user_id, captured_at)`, index `(user_id, main_photo_node_uid)`.
  - **`photo_blocks`:** `id`, `user_id` (cascade), `node_uid` not null, `blocked_at` not null, `model_version` not null. Unique `(user_id, node_uid)`.
  - **`photo_thumbnails`:** `photo_id` uuid PK → `photos.id` (cascade), `bytes` bytea not null, `fetched_at` not null.

- [ ] **Step 1: Add the schema.**

  Add `customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" })` and the tables. For `tags`, use `integer("tags").array()`. Comment on `captured_at`: "true UTC from Proton, stored UTC wall time".

- [ ] **Step 2: Generate the migration.**

  Run `yarn db:generate --name proton_photos`. Expected: `drizzle/0047_proton_photos.sql`. Review it: four `CREATE TABLE`, FKs `ON DELETE cascade`, `bytea`, `integer[]`, no unrelated diffs.

- [ ] **Step 3: Apply and verify.**

  Run `yarn db:test:up && yarn db:test:migrate`. Expected: the migration applies cleanly.

- [ ] **Step 4: Verify typecheck and tests.**

  Run `yarn typecheck && yarn test`. Expected: PASS. `src/lib/data-usage.test.ts` must still pass.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(db): add proton_connections, photos, photo_blocks, photo_thumbnails"`

---

### Task 4: Session credentials and the advisory-lock refresher

**Files:**

- Create: `src/modules/proton/types.ts`, `src/modules/proton/credentials.ts`, `src/modules/proton/token.ts`
- Test: `src/modules/proton/token.test.ts`, `src/modules/proton/credentials.test.ts`

**Interfaces:**

- Consumes: `SessionCredentials`, `SessionInfo` (account), `postProtonRefresh`, `RefreshHttpResult` (Task 2), `protonConnections` (Task 3).
- Produces:
  - `PROTON_ERRORS` (fixed Korean strings):
    - `authExpired: "Proton 인증이 만료되었습니다. 다시 연결해 주세요."`
    - `treeRemoved: "Proton 사진 보관함에 접근할 수 없습니다. 다시 연결해 주세요."`
    - `rateLimited: "Proton 요청 한도에 도달해 다음 주기에 다시 시도합니다."`
    - `syncFailed: "사진을 동기화하지 못했습니다. 잠시 후 다시 시도합니다."`
    - `classifierUnavailable: "사진 분류 모델을 불러오지 못해 세부 정보 수집을 미뤘습니다."`
    - `revokeFailed: "Proton 계정 설정의 세션 목록에서 Cistory 세션을 직접 삭제해 주세요."`
  - `class DbSessionCredentials implements SessionCredentials`, with `static fromConnection(row: ProtonConnection): DbSessionCredentials`. It holds decrypted values in memory. `setSessionInfo` updates memory and notifies, and does **not** persist (the refresher persists under the lock). `signOut()` only clears memory. `getUserKeyPassword()` returns the decrypted key password.
  - `refreshProtonSession(db: Database, userId: string, rejectedAccessToken: string | undefined, post?: (t: ProtonSessionTokens) => Promise<RefreshHttpResult>): Promise<SessionInfo | null>`
  - `lockProtonTokens(tx, userId)`, which runs `SELECT pg_advisory_xact_lock(hashtextextended('proton-token:' || userId, 0))` (same shape as `src/modules/wakatime/connection.ts:117`)

- [ ] **Step 1: Write the failing tests.**

  `token.test.ts` uses a `fakeDb` like `src/modules/wakatime/connection.test.ts:30`:

```ts
it("skips the POST when another writer already rotated the token", async () => {
  const { db } = fakeDb(row({ access: "new-by-other" }));
  const post = vi.fn();
  expect(await refreshProtonSession(db, "u", "old", post)).toMatchObject({ accessToken: "new-by-other" });
  expect(post).not.toHaveBeenCalled();
});
it("persists rotated tokens encrypted and keeps the stored refresh token when omitted", async () => {
  post.mockResolvedValue({ kind: "ok", uid: "U", accessToken: "A2" });
  /* updates[0]: decryptSecret(accessTokenEnc) === "A2", decryptSecret(refreshTokenEnc) === "R1", status "active" */
});
it("flips needs_reauth only when the locked re-read still equals the rejected token and the POST is a non-429 4xx", …);
it("retries with the newer token instead of needs_reauth when a concurrent writer won", …);
  // first re-read equals "old"; post → rejected 400; but the re-read token differs? (simulate: row mutated between lock acquisitions → expect no needs_reauth update and return of the newer session)
it("never flips needs_reauth on rate_limited or transient", …); // returns null, no status update
it("takes the proton-token advisory lock inside the transaction", …); // execute called with SQL containing "proton-token:u"
```

`credentials.test.ts`:

```ts
it("decrypts uid/access/refresh/keyPassword from the row", …);
it("setSessionInfo updates memory, keeps refresh token when omitted, and fires sessionInfoChanged", …);
it("signOut clears memory only", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test src/modules/proton`. Expected: FAIL.

- [ ] **Step 3: Implement.**

  The refresher runs one `db.transaction`:
  1. Lock.
  2. Re-select the row.
  3. If `decrypt(access) !== rejected`, return the stored session.
  4. Otherwise POST.
     - `ok`: update the encrypted tokens and set `status: "active"`, `updatedAt: new Date()`.
     - `rejected`: set `status: "needs_reauth"`, `lastError: PROTON_ERRORS.authExpired`, and return `null`.
     - `rate_limited` / `transient`: return `null` with no write.

- [ ] **Step 4: Run the tests to verify they pass.**

  Run: `yarn test src/modules/proton`. Expected: PASS.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(proton): DB-backed session credentials and advisory-lock token refresher"`

---

### Task 5: Photos client factory

**Files:**

- Create: `src/lib/adapters/proton/client.ts`, `src/modules/proton/session.ts`
- Test: `src/lib/adapters/proton/client.test.ts`

**Interfaces:**

- Consumes: `initProtonRuntime` (Task 1), `ApiClient`/`initAccount` (Task 2), `DbSessionCredentials`, `refreshProtonSession` (Task 4).
- Produces:

```ts
export interface ProtonPhotosApi {
  getPhotosVolumeId(): Promise<string>; // getMyPhotosRootFolder().treeEventScopeId
  iterateTimeline(
    signal?: AbortSignal
  ): AsyncIterable<{ nodeUid: string; captureTime: Date; tags: number[] }>;
  iterateNodes(uids: string[], signal?: AbortSignal): AsyncIterable<MaybeMissingPhotoNode>;
  iterateThumbnails(uids: string[], signal?: AbortSignal): AsyncIterable<ThumbnailResult>; // ThumbnailType.Type1
  iterateEvents(scopeId: string, cursor?: string, signal?: AbortSignal): AsyncIterable<DriveEvent>;
}
export function createProtonPhotosClient(opts: {
  credentials: SessionCredentials;
  refreshSession: (rejected: string | undefined) => Promise<SessionInfo | null>;
}): Promise<ProtonPhotosApi>;
export function buildSdkHttpClient(apiClient: ApiClient): { fetchJson; fetchBlob }; // exported for test
export function driveRequirementsHook(log: (value: string) => void): AfterResponseHook;
// in src/modules/proton/session.ts:
export function openProtonPhotos(
  db: Database,
  connection: ProtonConnection
): Promise<ProtonPhotosApi>;
```

- [ ] **Step 1: Write the failing tests.**

```ts
it("bridges SDK fetchJson to authenticatedRequest with throwHttpErrors:false and json body", …);
it("bridges fetchBlob with the raw body", …);
it("logs x-pm-drive-requirements once per value without failing the response", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test src/lib/adapters/proton/client.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `createProtonPhotosClient`.**

  Wire it exactly as the spike `run/spike.ts` does:
  - `initProtonRuntime()`.
  - `new ApiClient({ baseUrl: PROTON_API_BASE_URL, appVersion: PROTON_APP_VERSION, credentials, logger, refreshSession, afterResponseHooks: [driveRequirementsHook(...)] })`.
  - `initAccount({ authClientId: PROTON_AUTH_CLIENT_ID, ..., cryptoProxy, srpApi, accountUrl: PROTON_ACCOUNT_URL })`.
  - `new ProtonDrivePhotosClient({ httpClient, entitiesCache: new MemoryCache(), cryptoCache: new MemoryCache(), account, openPGPCryptoModule: new OpenPGPCryptoWithCryptoProxy(cryptoProxy), srpModule, config: { baseUrl: PROTON_API_BASE_URL, clientUid: PROTON_CLIENT_UID }, featureFlagProvider: new NullFeatureFlagProvider() })`.

  Imports:
  - `ProtonDrivePhotosClient` deep-imports from `@protontech/drive-sdk/dist/protonDrivePhotosClient.js`.
  - Everything else comes from `@protontech/drive-sdk`.
  - The logger maps to `logger.warn`/`logger.error` and drops debug/info.

  `openProtonPhotos` binds `refreshSession` to `refreshProtonSession(db, connection.userId, …)`.

- [ ] **Step 4: Run the tests to verify they pass.**

  Run `yarn test src/lib/adapters/proton && yarn typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(proton): photos client factory over the vendored account module"`

---

### Task 6: Connection lifecycle service and routes

**Files:**

- Create: `src/modules/proton/connection.ts`, `src/modules/proton/summary.ts`
- Create: `src/app/api/proton/route.ts` (GET summary, DELETE), `src/app/api/proton/connect/route.ts` (POST), `src/app/api/proton/connect/status/route.ts` (GET)
- Test: `src/modules/proton/connection.test.ts`, `src/app/api/proton/route.test.ts`

**Interfaces:**

- Consumes: `startProtonFork`, `pollProtonFork`, `revokeProtonSession` (Task 2); `lockProtonTokens` (Task 4); `openProtonPhotos` (Task 5).
- Produces:

```ts
export type ConnectStatus =
  | { status: "none" }
  | { status: "pending"; expiresAt: string }
  | { status: "active" }
  | { status: "expired" };
export interface ProtonConnectionDeps {
  startFork: typeof startProtonFork;
  pollFork: typeof pollProtonFork;
  resolveVolumeId: (tokens: ProtonSessionTokens, keyPassword: string) => Promise<string>;
  revoke: typeof revokeProtonSession;
  now: () => Date;
}
export class ProtonConnectionService {
  constructor(db: Database, deps?: Partial<ProtonConnectionDeps>);
  getConnection(userId: string): Promise<ProtonConnection | null>;
  startConnect(userId: string): Promise<{ signInUrl: string; expiresAt: string }>;
  checkConnect(userId: string): Promise<ConnectStatus>;
  clearExpiredFork(userId: string): Promise<void>; // also called by cron
  disconnect(userId: string): Promise<{ revoked: boolean }>;
  revokeOnly(userId: string): Promise<boolean>; // used by account deletion
}
export interface ProtonSummary {
  connected: boolean;
  status: "pending" | "active" | "needs_reauth" | null;
  photoCount: number;
  lastSyncedAt: string | null;
  backfilling: boolean;
  detailsFailedCount: number;
  blockedCount: number;
  lastError: string | null;
}
export function getProtonSummary(db: Database, userId: string): Promise<ProtonSummary>;
```

- [ ] **Step 1: Write the failing service tests.** They use a fake db, or a small in-memory row holder in the style of the wakatime fake.

```ts
it("first connect inserts a pending row with encrypted selector/key and 10-minute expiry", …);
it("re-connect on an active row writes only pending_* and keeps status and tokens", …);
it("checkConnect returns pending while the fork answers 422 and polls exactly once per call", …);
it("completion activates, stores encrypted tokens + keyPassword, sets volume_id, clears pending_*", …);
it("completion with the same volume keeps photos and nulls event_cursor, timeline_listed_at, backfill_completed_at", …);
it("completion with a different volume revokes the old session, deletes photos/blocks, and resets cursors", …);
it("an expired first-time fork deletes the row; an expired re-connect clears only pending_*", …);
it("a second concurrent completion after the first is a no-op (selector no longer matches under lock)", …);
it("disconnect deletes the row and photos even when revoke fails, returning revoked:false", …);
```

- [ ] **Step 2: Write the failing route tests.** Mock the service and auth helpers as in `src/app/api/data-status/route.test.ts`.

```ts
it("POST /api/proton/connect and DELETE /api/proton reject cross-origin with 403 INVALID_ORIGIN", …);
it("POST returns { signInUrl, expiresAt } for the session user", …);
it("DELETE includes the fixed revokeFailed notice when revoke failed", …); // body.notice === PROTON_ERRORS.revokeFailed
it("GET /api/proton/connect/status is session-authenticated and never echoes Proton errors", …);
```

- [ ] **Step 3: Run the tests to verify they fail.**

  Run: `yarn test src/modules/proton/connection.test.ts src/app/api/proton`. Expected: FAIL.

- [ ] **Step 4: Implement.**
  - Completion runs inside `db.transaction` with `lockProtonTokens`. It re-reads the row and requires `pending_fork_selector` to equal the polled selector.
  - `resolveVolumeId` (default) builds a short-lived `ProtonPhotosApi` from in-memory credentials and calls `getPhotosVolumeId()`. This is the only crypto work web performs.
  - Disconnect deletes `proton_connections`, `photos` (thumbnails cascade) and `photo_blocks`.
  - Routes use `withAuth` / `checkSameOrigin` exactly as in `src/app/api/overview/recompute/route.ts:13-21`.
  - `getProtonSummary` counts only exposed rows for `photoCount`. It counts `details_attempts >= 3 AND details_synced_at IS NULL AND deleted_at IS NULL` for `detailsFailedCount` and `photo_blocks` rows for `blockedCount`.

- [ ] **Step 5: Run the tests to verify they pass.**

  Run `yarn test src/modules/proton src/app/api` (the latter includes `_routes-import.test.ts`). Expected: PASS.

- [ ] **Step 6: Commit.**

  `git commit -m "feat(proton): connect/status/disconnect routes and connection lifecycle"`

---

### Task 7: NSFW classifier

**Files:**

- Modify: `package.json`, `yarn.lock`, `next.config.ts`
  - Packages: `"nsfwjs": "4.4.0"`, `"@tensorflow/tfjs": "4.22.0"`, `"@tensorflow/tfjs-backend-wasm": "4.22.0"`, `"jpeg-js": "0.4.4"`, `"buffer": "^6.0.3"` (nsfwjs peer).
  - Add `serverExternalPackages: ["nsfwjs", "@tensorflow/tfjs", "@tensorflow/tfjs-core", "@tensorflow/tfjs-backend-cpu", "@tensorflow/tfjs-backend-wasm", "jpeg-js"]`.
  - Add `outputFileTracingIncludes["/*"]` += `"./node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm"`.
- Create: `src/modules/proton/nsfw/classifier.ts`, `src/modules/proton/nsfw/decode.ts`, `src/modules/proton/nsfw/nsfwjs.ts`
- Test: `src/modules/proton/nsfw/classifier.test.ts`, `src/modules/proton/nsfw/decode.test.ts`, `src/modules/proton/nsfw/nsfwjs.test.ts`

**Interfaces:**

- Produces:

```ts
export interface NsfwScores {
  drawing: number;
  hentai: number;
  neutral: number;
  porn: number;
  sexy: number;
}
export interface PhotoClassifier {
  readonly modelVersion: string;
  classify(jpeg: Uint8Array): Promise<NsfwScores>;
}
export class ClassifierUnavailableError extends Error {} // model/backend could not load — infrastructure
export class ClassifyInputError extends Error {} // per-image: missing, non-JPEG, undecodable
export const NSFW_MODEL_VERSION = "nsfwjs@4.4.0/MobileNetV2";
export const NSFW_BLOCK_PORN_PLUS_HENTAI = 0.5;
export const NSFW_BLOCK_SEXY = 0.8;
export function isBlocked(s: NsfwScores): boolean;
export function decodeJpegToRgb(bytes: Uint8Array): {
  width: number;
  height: number;
  data: Uint8Array;
}; // RGB, 3 ch
export function createNsfwjsClassifier(): PhotoClassifier; // lazy, memoized load; reset memo on load failure
```

- [ ] **Step 1: Install.**

  Run `NODE_OPTIONS=--use-system-ca yarn add nsfwjs@4.4.0 @tensorflow/tfjs@4.22.0 @tensorflow/tfjs-backend-wasm@4.22.0 jpeg-js@0.4.4 buffer@^6.0.3`. Confirm that `node_modules/core-js/package.json` (hoisted) is still ≥3.51 (tfjs pins its own 3.29.1 nested).

- [ ] **Step 2: Write the failing tests.**

```ts
// classifier.test.ts
it("blocks porn+hentai at exactly 0.5", () => expect(isBlocked(s({ porn: 0.3, hentai: 0.2 }))).toBe(true));
it("blocks sexy at 0.8 but not 0.79", …);
it("passes neutral/drawing-dominant scores", …);
// decode.test.ts  (build fixtures with jpeg-js encode)
it("decodes a JPEG to RGB without alpha", () => { const { width, height, data } = decodeJpegToRgb(jpeg8x6);
  expect([width, height, data.length]).toEqual([8, 6, 8 * 6 * 3]); });
it("rejects PNG/WebP/HEIC magic bytes with ClassifyInputError", …);
it("rejects truncated JPEG with ClassifyInputError", …);
it("rejects images over the 4-megapixel decode cap", …);
// nsfwjs.test.ts — real model, proves wasm (or cpu fallback) loads on Node 24 incl. Alpine tester stage
it("loads the bundled MobileNetV2 and returns five probabilities summing to ~1", async () => {
  const scores = await createNsfwjsClassifier().classify(grayJpeg224);
  expect(Object.keys(scores).sort()).toEqual(["drawing", "hentai", "neutral", "porn", "sexy"]);
  expect(Object.values(scores).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
}, 120_000);
it("wraps non-JPEG input in ClassifyInputError, not ClassifierUnavailableError", …);
```

- [ ] **Step 3: Run the tests to verify they fail.**

  Run: `yarn test src/modules/proton/nsfw`. Expected: FAIL.

- [ ] **Step 4: Implement.**
  - **`decode.ts`:** check `FF D8 FF`, then call `jpeg-js` `decode(bytes, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 4, maxMemoryUsageInMB: 128 })`.
  - **`nsfwjs.ts` load sequence:**
    1. `tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false)`.
    2. `setWasmPaths(path.join(process.cwd(), "node_modules/@tensorflow/tfjs-backend-wasm/dist/"))`.
    3. `await tf.setBackend("wasm")`. On failure, log a warning and use `tf.setBackend("cpu")`.
    4. `tf.enableProdMode()`.
    5. `nsfwjs.load("MobileNetV2")`. The weights are bundled in the npm package, so there is no runtime download.
  - **Load failure:** throw `ClassifierUnavailableError`.
  - **Classify:**
    1. `tf.tensor3d(data, [h, w, 3], "int32")`.
    2. `model.classify(tensor)`.
    3. Dispose the tensor in `finally`.
    4. Map `className` → key.
  - **Never log bytes.**
  - **Comment:** `process.cwd()` is the repo root in dev/Vitest and the standalone dir under `server.js`.

- [ ] **Step 5: Run the tests to verify they pass.**

  Run `yarn test src/modules/proton/nsfw && yarn build`. Then confirm `ls .next/standalone/node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm` and `ls .next/standalone/node_modules/nsfwjs`. Expected: files present.

- [ ] **Step 6: Run the Alpine test stage.**

  Run `docker build --target tester .`. Expected: `nsfwjs.test.ts` passes on Alpine/musl.

- [ ] **Step 7: Commit.**

  `git commit -m "feat(proton): local NSFWJS thumbnail classifier on tfjs wasm"`

---

### Task 8: Node metadata mapper

**Files:**

- Create: `src/modules/proton/mapper.ts`
- Test: `src/modules/proton/mapper.test.ts`

**Interfaces:**

- Consumes: `PhotoNode`, `NodeType` from `@protontech/drive-sdk`; `parseAdditionalNodeMetadata` from `@protontech/drive-sdk/dist/additionalNodeMetadata/index.js`.
- Produces:

```ts
export interface MappedPhoto {
  nodeUid: string;
  capturedAt: Date;
  mainPhotoNodeUid: string | null;
  relatedPhotoNodeUids: string[];
  contentHash: string | null;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  lat: number | null;
  lon: number | null;
  device: string | null;
  tags: number[];
  claimedMetadata: { Location?: unknown; Camera?: unknown; Media?: unknown } | null;
  trashedAt: Date | null;
}
export type MapResult =
  | { ok: true; photo: MappedPhoto }
  | { ok: false; reason: "not_photo" | "degraded" | "invalid" };
export function mapPhotoNode(node: PhotoNode): MapResult;
export function isValidCoordinate(lat: unknown, lon: unknown): lat is number;
```

- [ ] **Step 1: Write the failing tests.**

```ts
it("takes capturedAt from photo.captureTime as-is (true UTC, no shift)", …); // getTime() equality
it("keeps exif lat/lon from claimedAdditionalMetadata.Location", …);
it("rejects GPS outside ±90/±180, NaN, non-numbers and exact 0,0", …); // lat/lon null, claimedMetadata keeps raw
it("preserves raw tag integers (e.g. 8) without interpreting", …);
it("reads contentHash defensively (absent in d.ts) and mainPhotoNodeUid/relatedPhotoNodeUids", …);
it("maps trashTime → trashedAt, Media.Width/Height/Duration, Camera.Device", …);
it("returns not_photo for NodeType.Folder/Album and degraded when node.errors is non-empty", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test src/modules/proton/mapper.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `mapPhotoNode`.**

  Run `claimedAdditionalMetadata` through `parseAdditionalNodeMetadata`. A throw → `invalid`. `claimedMetadata` keeps only the validated `Location`/`Camera`/`Media`.

- [ ] **Step 4: Run the tests to verify they pass.**

  Run: `yarn test src/modules/proton/mapper.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(proton): map Photos nodes to photo rows with GPS validation"`

---

### Task 9: Ingest pipeline (details + thumbnail + NSFW, fail-closed)

**Files:**

- Create: `src/modules/proton/repository.ts`, `src/modules/proton/ingest.ts`
- Test: `src/modules/proton/ingest.test.ts`

**Interfaces:**

- Consumes: `ProtonPhotosApi` (Task 5), `PhotoClassifier`, `isBlocked`, `ClassifierUnavailableError`, `ClassifyInputError` (Task 7), `mapPhotoNode` (Task 8).
- Produces:

```ts
export type IngestOutcome =
  | { kind: "pass"; photo: MappedPhoto; thumbnail: Uint8Array }
  | { kind: "block"; nodeUid: string; relatedUids: string[] }
  | { kind: "missing"; nodeUid: string }
  | { kind: "skip"; nodeUid: string } // not a photo
  | { kind: "fail"; nodeUid: string; error: string; thumbnailFailed: boolean };
export const INGEST_CHUNK = 50;
export function prepareIngest(
  api: ProtonPhotosApi,
  classifier: PhotoClassifier,
  uids: string[],
  blocked: ReadonlySet<string>
): Promise<IngestOutcome[]>; // throws ClassifierUnavailableError
export function applyIngest(
  tx: Database,
  userId: string,
  outcomes: IngestOutcome[],
  modelVersion: string,
  now: Date
): Promise<void>;
// repository.ts
export function loadBlockedUids(db: Database, userId: string): Promise<Set<string>>;
export function selectDetailsBatch(db: Database, userId: string, limit: number): Promise<string[]>;
// details_synced_at IS NULL AND details_attempts < 3 AND deleted_at IS NULL ORDER BY captured_at DESC
export function upsertTimelineItems(
  db: Database,
  userId: string,
  items: { nodeUid: string; captureTime: Date; tags: number[] }[],
  blocked: ReadonlySet<string>
): Promise<void>;
export function markNodesDeleted(
  tx: Database,
  userId: string,
  uids: string[],
  now: Date
): Promise<void>; // + rows whose main is in uids
export function resetForReingest(tx: Database, userId: string, uids: string[]): Promise<void>;
// upsert placeholder rows (captured_at from node later), set details_synced_at=NULL, details_attempts=0
```

Per-outcome writes in `applyIngest`, all in the caller's transaction:

- **pass:** upsert the `photos` row with mapped fields, `details_synced_at = now`, `details_error = null`. EXIF coords → `location_source = 'exif'` and `location_checked_at = now`. Upsert `photo_thumbnails(photo_id, bytes, fetched_at = now)`.
- **block:** delete the `photos` rows where `node_uid` ∈ {uid, …relatedUids} or `main_photo_node_uid = uid`. Insert `photo_blocks` for uid and each related uid with `ON CONFLICT DO NOTHING` and `model_version`.
- **missing:** `markNodesDeleted`.
- **skip:** delete the row.
- **fail:** `details_attempts += 1`, `details_error = error`, and `thumbnail_attempts += 1` when `thumbnailFailed`. The thumbnail is never written.

Fixed `details_error` strings:

- `"세부 정보를 복호화하지 못했습니다"` (degraded/invalid)
- `"썸네일을 받지 못했습니다"`
- `"썸네일 형식을 분류할 수 없습니다"`

**Spec reconciliation (3.2 vs 3.4a):** a thumbnail fetch failure must bump `details_attempts` too, because no thumbnail means no verdict, and 3.4a fail-closed supersedes 3.2's "thumbnail-only failure doesn't fail the row". `thumbnail_attempts` stays as a diagnostic counter.

- [ ] **Step 1: Write the failing tests.** Use a fake `ProtonPhotosApi`, a fake classifier (`{ modelVersion: "test", classify: vi.fn() }`) and a recording fake tx.

```ts
it("stores row + thumbnail only after a passing verdict", …);
it("blocked: deletes the listed row, writes photo_blocks only, never writes thumbnail bytes", …);
it("blocks related photos of a blocked main without classifying them", …); // relatedUids also in photo_blocks
it("blocks a related node whose main is already in photo_blocks", …);       // classify not called
it("skips uids already in photo_blocks before any network call", …);       // iterateNodes not called with them
it("fail-closed: classify throws ClassifyInputError → fail outcome, no thumbnail write, attempts+1", …);
it("fail-closed: thumbnail result ok:false → fail with thumbnailFailed, attempts+1 on both counters", …);
it("does not consume attempts when the classifier is unavailable", …);
  // classify throws ClassifierUnavailableError → prepareIngest rejects; applyIngest never called
it("missing node → soft delete including related rows", …);
it("yields to the event loop between classifications", …); // spy on setImmediate / await count
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test src/modules/proton/ingest.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Chunk the uids by 50.
  - For each chunk, `iterateNodes`, then `iterateThumbnails(passable uids)` into `Map<uid, bytes>`.
  - Classify sequentially with `await new Promise(setImmediate)` between images.
  - Never put bytes, lat/lon or `claimedMetadata` into logger calls.

- [ ] **Step 4: Run the tests to verify they pass.**

  Run: `yarn test src/modules/proton/ingest.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(proton): fail-closed ingest pipeline with NSFW pre-blocking"`

---

### Task 10: Backfill stages

**Files:**

- Create: `src/modules/proton/backfill.ts`
- Test: `src/modules/proton/backfill.test.ts`

**Interfaces:**

- Consumes: `ProtonPhotosApi`, repository and ingest functions (Task 9).
- Produces:

```ts
export type BackfillStep = "baseline" | "list" | "details" | "complete" | "done";
export function nextBackfillStep(
  c: Pick<ProtonConnection, "eventCursor" | "timelineListedAt" | "backfillCompletedAt">,
  pendingDetails: number
): BackfillStep;
export function captureBaselineCursor(api: ProtonPhotosApi, volumeId: string): Promise<string>; // first fast_forward eventId
export function runTimelineListing(
  db: Database,
  api: ProtonPhotosApi,
  userId: string,
  now: Date
): Promise<number>;
export function runDetailsStage(
  db: Database,
  api: ProtonPhotosApi,
  classifier: PhotoClassifier,
  userId: string,
  now: Date,
  limit?: number /* 500 */
): Promise<{ processed: number }>;
export const DETAILS_BATCH_LIMIT = 500;
```

- [ ] **Step 1: Write the failing tests.**

```ts
it("orders steps baseline → list → details → complete → done", …);
  // eventCursor null → baseline; listed null → list; pendingDetails>0 → details; 0 & not completed → complete; completed → done
it("lists the timeline only when timeline_listed_at is null (never re-lists after)", …);
it("listing soft-deletes unlisted rows but not related rows (main_photo_node_uid set)", …);
it("listing marks related rows deleted when their main is deleted", …);
it("listing skips blocked node_uids and clears deleted_at on rows that reappear", …);
it("details selection excludes rows with details_attempts >= 3, so one bad row cannot block completion", …);
it("baseline takes the fast_forward eventId from iterateEvents(volumeId) without a cursor", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test src/modules/proton/backfill.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Listing does one transaction:
    - upsert in chunks of 1000;
    - `UPDATE … SET deleted_at = $now WHERE user_id = $u AND deleted_at IS NULL AND main_photo_node_uid IS NULL AND node_uid <> ALL($listed::text[])`;
    - a related-rows pass;
    - `timeline_listed_at = now`.
  - The details stage runs `prepareIngest` outside any transaction, then `applyIngest` in one transaction per 50-chunk.

- [ ] **Step 4: Run the tests to verify they pass.**

  Run: `yarn test src/modules/proton/backfill.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(proton): backfill baseline, single timeline listing and batched details"`

---

### Task 11: Event processing

**Files:**

- Create: `src/modules/proton/events.ts`
- Test: `src/modules/proton/events.test.ts`

**Interfaces:**

- Consumes: `ProtonPhotosApi`, `prepareIngest`/`applyIngest`/`markNodesDeleted`/`resetForReingest` (Task 9), `isCursorRejection` (Task 2), `captureBaselineCursor` (Task 10).
- Produces:

```ts
export interface EventPlan {
  upsertUids: string[];
  deleteUids: string[];
  treeRefresh: boolean;
  treeRemoved: boolean;
  lastEventId: string | null;
}
export const EVENT_BATCH = 100;
export function planEventBatch(
  events: DriveEvent[],
  volumeId: string,
  blocked: ReadonlySet<string>
): EventPlan;
export function processEvents(
  db: Database,
  api: ProtonPhotosApi,
  classifier: PhotoClassifier,
  conn: ProtonConnection,
  now: Date
): Promise<{ applied: number; stopped: "end" | "tree_removed" }>;
```

- [ ] **Step 1: Write the failing tests.**

```ts
it("node_created/node_updated → upsert, node_deleted → delete, last one wins per uid", …);
it("fast_forward only advances lastEventId", …);
it("ignores events from other scopes and shared_with_me_updated", …);
it("skips blocked uids for created/updated", …);
it("tree_refresh nulls timeline_listed_at and backfill_completed_at and stores the cursor", …);
it("tree_remove flips needs_reauth with PROTON_ERRORS.treeRemoved and stops", …);
it("cursor rejection (404/422) re-baselines and resets listing like tree_refresh", …);
it("stores the cursor in the same transaction as the batch writes", …); // tx.update(protonConnections) inside same tx as applyIngest
it("does not advance the cursor when prepare fails mid-batch", …);
it("node_updated resets the row to hidden (details_synced_at NULL) before re-ingest", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test src/modules/proton/events.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  1. Iterate `api.iterateEvents(volumeId, cursor)` in batches of 100.
  2. Per batch, run `prepareIngest(upsertUids)` with no transaction open.
  3. Then one transaction: `resetForReingest`, then `applyIngest`, then `markNodesDeleted`, then the tree flags, then `event_cursor = lastEventId`, `updated_at`.

  `isCursorRejection` → `captureBaselineCursor` plus the listing reset. `isRateLimited` propagates.

- [ ] **Step 4: Run the tests to verify they pass.**

  Run: `yarn test src/modules/proton/events.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(proton): event-driven incremental sync with transactional cursor"`

---

### Task 12: OwnTracks location fill with settlement rules

**Files:**

- Create: `src/modules/proton/location.ts`
- Test: `src/modules/proton/location.test.ts`, `src/modules/proton/location.integration.test.ts`

**Interfaces:**

- Consumes: `photos`, `locationPoints`, `locationProcessingDays`; `localDaySql`, `timestampParam` (`src/db/sql.ts`); `toLocalDateString` (`src/lib/utils.ts`).
- Produces:
  - `export const PHOTO_LOCATION_WINDOW_SEC = 900`
  - `export const LOCATION_PIPELINE_WINDOW_DAYS = 45`
  - `export const LOCATION_FILL_LIMIT = 2000`
  - `export function buildLocationFillSql(userId: string, now: Date, todayKst: string, limit: number): SQL` (exported for the text test)
  - `export function fillPhotoLocations(db: Database, userId: string, now?: Date): Promise<{ updated: number; settled: number }>`

  SQL shape (one `UPDATE … FROM (SELECT …)`):
  - **Targets:** `user_id = $u AND details_synced_at IS NOT NULL AND deleted_at IS NULL AND location_checked_at IS NULL AND location_source IS DISTINCT FROM 'exif'`, `LIMIT $limit`.
  - **Nearest point:** a `LATERAL` select of the nearest point by `abs(extract(epoch FROM lp.timestamp - p.captured_at))`. Filter on `lp.user_id = $u AND lp.anomaly IS NOT TRUE` and `lp.timestamp BETWEEN p.captured_at - interval '15 minutes' AND p.captured_at + interval '15 minutes'`. Both columns are UTC wall time, so no conversion.
  - **Day:** `d = localDaySql(p.captured_at)`.
  - **settled =**
    - (a) `EXISTS lpd WHERE lpd.user_id = $u AND lpd.date = to_char(d,'YYYY-MM-DD') AND lpd.status = 'completed' AND lpd.point_count = (SELECT count(*) FROM location_points WHERE user_id = $u AND localDay(timestamp) = d)`, OR
    - (b) `d < $todayKst::date - 45`.
  - **SET:** `lat`, `lon`, `location_source` (`'owntracks'` or NULL), `location_gap_sec`, `location_checked_at = CASE WHEN settled THEN $now::timestamp END`, `updated_at`.

- [ ] **Step 1: Write the failing unit test.**

  `location.test.ts`: the rendered SQL contains `anomaly IS NOT TRUE`, `details_synced_at IS NOT NULL`, `IS DISTINCT FROM 'exif'`, `interval '15 minutes'` and the `at time zone 'UTC' at time zone 'Asia/Seoul'` day expression, and contains no bare `now()`.

- [ ] **Step 2: Write the failing integration test** in `location.integration.test.ts`. Set `process.env.TZ = "Asia/Seoul"` at the top and use `useTransactionalDb`.

```ts
it("matches on UTC wall time: photo 2026-03-01T03:00Z ↔ point 03:05Z (gap 300), not a point at 12:05Z", …);
it("never uses another user's closer point", …);
it("never uses anomaly points, and clears an owntracks fill once the only point turns anomalous", …);
it("settles via (a): completed lpd with matching point_count sets location_checked_at", …);
it("does not settle when point_count mismatches (late points) and recomputes next call", …);
it("settles via (b): a 2019 day with no lpd row", …);
it("buckets a photo at 2026-03-01T16:30Z under the KST day 2026-03-02 lpd row", …);
it("ignores rows without details (details_synced_at NULL) and exif rows", …);
```

- [ ] **Step 3: Run the tests to verify they fail.**

  Run `yarn test src/modules/proton/location.test.ts`, then `yarn test:integration`. Expected: FAIL.

- [ ] **Step 4: Implement `fillPhotoLocations`.**

  It binds `$now` via `timestampParam(photos.locationCheckedAt, now)` and computes `todayKst` via `toLocalDateString(now)`.

- [ ] **Step 5: Run the tests to verify they pass.**

  Run `yarn test src/modules/proton/location.test.ts && yarn test:integration`. Expected: PASS.

- [ ] **Step 6: Commit.**

  `git commit -m "feat(proton): OwnTracks location fill settled by location_processing_days"`

---

### Task 13: `/data-status` source

**Files:**

- Modify: `src/modules/data-status/types.ts` (add `"proton"` to `SOURCE_IDS`; `SourceStatus.notes?: string[]`), `src/modules/data-status/service.ts` (LABELS, HELP, connections, reauth, success, observations union, notes), `src/app/data-status/page.tsx` (render `source.notes` under the timestamps)
- Test: `src/modules/data-status/service.integration.test.ts` (add one `describe` block for proton)

**Interfaces:**

- Consumes: `getProtonSummary` counts (Task 6).
- Produces:
  - `LABELS.proton = "Proton Drive 사진"`
  - `HELP.proton = "복구 대상이 아닙니다. 이벤트 동기화가 Proton과 다시 대조합니다."`
  - `connected = row exists AND status <> 'pending'`; `needsReauth = status = 'needs_reauth'`. A backfilling connection counts as connected.
  - `success.proton = last_synced_at`; `stale` applies.
  - Observation branch: `SELECT 'proton', captured_at FROM photos WHERE user_id = $u AND details_synced_at IS NOT NULL AND deleted_at IS NULL AND captured_at` in range.
  - `notes`: `["세부 정보 수집 실패 N장"]` when N > 0, and `["차단 N장"]` when N > 0. Never identify blocked photos.
  - `canRecover` stays false (not in `RECOVERABLE_SOURCES`).

- [ ] **Step 1: Write the failing integration tests.**

```ts
it("counts exposed proton photos per KST day (16:30Z → next KST day), excluding hidden and deleted rows", …);
it("reports proton connected while backfilling, needs_reauth when flagged, never recoverable", …);
it("adds count-only notes for failed details and blocked photos", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test:integration`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Verify.**

  Run `yarn test && yarn test:integration && BROWSER_TEST_PRODUCTION=true yarn test:browser`. Expected: PASS. The data-status browser fixture keeps working because `notes` is optional.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(data-status): add Proton Drive Photos source"`

---

### Task 14: Thumbnail API

**Files:**

- Create: `src/app/api/photos/[photoId]/thumbnail/route.ts`
- Test: `src/app/api/photos/[photoId]/thumbnail/route.test.ts`

**Interfaces:**

- Consumes: `photos`, `photoThumbnails`, `withAuth<RouteParams>` (pattern: `src/app/api/portfolio/accounts/[accountId]/targets/route.ts:7-24`).
- Produces: `GET`. It returns 200 with bytes only for the owner's row with `details_synced_at IS NOT NULL AND deleted_at IS NULL` and a thumbnail. It returns 404 otherwise, including a non-UUID id. It never calls Proton.

- [ ] **Step 1: Write the failing tests.**

```ts
it("serves the owner's thumbnail with private cache, image/jpeg and nosniff headers", …);
it("404s another user's photo, a details-pending row, a soft-deleted row and a missing thumbnail", …);
it("404s a malformed photoId without querying", …);
it("does not import the Proton adapter", …); // module graph: vi.mock("@/lib/adapters/proton/client") never called
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test "src/app/api/photos"`. Expected: FAIL.

- [ ] **Step 3: Implement.**

  Return `new NextResponse(bytes, { headers })`.

- [ ] **Step 4: Run the tests to verify they pass.**

  Run `yarn test src/app/api`. Expected: PASS, including `_routes-import.test.ts`.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(photos): owner-scoped thumbnail endpoint over stored thumbnails"`

---

### Task 15: Settings card

**Files:**

- Create: `src/modules/proton/hooks.ts`, `src/modules/proton/components/ProtonSettings.tsx`
- Modify: `src/modules/settings/components/SettingsForm.tsx` (render `<ProtonSettings />` after `WakaTimeSettings`, line ~288)
- Test: `src/modules/proton/hooks.test.ts`

**Interfaces:**

- Consumes: `GET /api/proton` → `ProtonSummary`, `POST /api/proton/connect`, `GET /api/proton/connect/status`, `DELETE /api/proton` (Task 6).
- Produces:
  - `useProtonConnection()`, a TanStack Query hook: `{ summary, start(): Promise<{signInUrl, expiresAt}>, disconnect(): Promise<{notice?: string}>, pollStatus }`. Status polling runs every 5000 ms only while a fork is pending and stops at `active`/`expired`/`none`.
  - Card copy (Korean). Shows only photo count, last sync time, backfill progress, detail failure count and blocked count (number only):
    - Disclosure: `"Cistory는 Proton의 공식 앱이 아닌 개인 서드파티 앱입니다. 로그인은 Proton 페이지에서 진행되며 비밀번호는 Cistory로 전달되지 않습니다."`
    - Reconnect notice on `needs_reauth`, same shape as `ReconnectNotice` in `WakaTimeSettings.tsx:40-52`.
    - Disconnect confirm dialog; on `notice`, show it via `toast.warning`.

- [ ] **Step 1: Write the failing hook test.**

  `hooks.test.ts` tests a pure `nextPollDelay(status)` helper exported from hooks:
  - `pending` → 5000
  - otherwise → `false`

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `yarn test src/modules/proton/hooks.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the hook and card, and wire them into `SettingsForm`.**

  The sign-in link opens with `target="_blank" rel="noopener noreferrer"`. No glyph or emoji badges.

- [ ] **Step 4: Verify.**

  Run `yarn test src/modules/proton && yarn typecheck && yarn lint`. Then visually check with `yarn dev` → `/settings`: the card renders disconnected, and a mocked pending state renders (owner design taste: refined, on real data where possible).

- [ ] **Step 5: Commit.**

  `git commit -m "feat(settings): Proton Drive Photos connection card"`

---

### Task 16: Sync orchestrator and cron registration

**Files:**

- Create: `src/modules/proton/sync.ts`, `src/modules/proton/cron.ts`
- Modify: `src/lib/cron.ts` (register in `initializeCron` beside `registerDataRecoveryTask`; stop in `stopCron`)
- Test: `src/modules/proton/sync.test.ts`, `src/modules/proton/cron.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 4–12; `"proton"` in `SOURCE_IDS` (Task 13); `trackSourceSync(db, userId, "proton", run)` (`src/modules/data-status/telemetry.ts`); `getPool()`.
- Produces:

```ts
export interface ProtonSyncDeps {
  open: (db: Database, c: ProtonConnection) => Promise<ProtonPhotosApi>;
  classifier: PhotoClassifier;
  now: () => Date;
}
export function syncProtonPhotosForUser(
  db: Database,
  userId: string,
  deps: ProtonSyncDeps
): Promise<"skipped_locked" | "synced" | "rate_limited" | "needs_reauth">;
export function syncAllProtonPhotos(db: Database, deps?: Partial<ProtonSyncDeps>): Promise<void>;
export function registerProtonPhotosTask(schedule: ScheduleFn, timezone: string): ScheduledTask; // "*/10 * * * *", name "proton-photos"
export function warmUpProtonRuntime(): Promise<void>; // initProtonRuntime + classifier load; logs "[Proton] runtime ready" / error
```

Tick per user (status `active` only; `pending` rows go through `clearExpiredFork`):

1. Take `pg_try_advisory_lock(hashtextextended('proton-sync:'||userId,0))` on `await getPool().connect()`. If not acquired → `skipped_locked`.
2. `trackSourceSync(db, userId, "proton", async () => { … })`:
   - events (if `event_cursor`);
   - then the backfill step (`baseline` / `list` / `details` / `complete`, where `complete` writes `backfill_completed_at`);
   - **then** the details stage again only if the step was not already `details`, because event-reset rows also need it;
   - then `fillPhotoLocations`;
   - then `last_synced_at = now`, `last_error = null`.
3. Errors inside the run:
   - `ClassifierUnavailableError` → set `last_error = PROTON_ERRORS.classifierUnavailable`. The details stage is skipped for this tick only. The run still completes events and location, and is reported as success.
   - `isRateLimited` → rethrow so telemetry records an attempt without success. Outer result `rate_limited`, logged at warn.
   - `isAuthFailure` → `needs_reauth` (the refresher already wrote it, or set it here with `authExpired`).
   - Otherwise set `last_error = PROTON_ERRORS.syncFailed` and rethrow.
4. In `finally`: `pg_advisory_unlock` on the same client, then `client.release()`.

`registerProtonPhotosTask` mirrors `src/modules/health/webhook-cron.ts`:

- closure `running` guard;
- lazy `import("./sync")` inside the tick;
- `warmUpProtonRuntime()` fired once at registration (catch → `logger.error`, never throws).

* [ ] **Step 1: Write the failing tests.**

```ts
// cron.test.ts (style of src/modules/health/webhook-cron.test.ts)
it("schedules */10 in Asia/Seoul named proton-photos and never overlaps ticks", …);
it("warm-up failure is logged and does not prevent registration", …);
// sync.test.ts
it("skips the user when pg_try_advisory_lock returns false and still releases the client", …);
it("unlocks on the same client in finally even when the run throws", …);
it("runs events before backfill and location fill after, in that order", …);
it("records success via trackSourceSync on a zero-event tick (prevents stale)", …);
it("rate-limited tick records an attempt without success and returns rate_limited", …);
it("classifier unavailable: events and location still run, last_error set, no attempts consumed", …);
it("only active connections sync; pending rows get clearExpiredFork", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test src/modules/proton/sync.test.ts src/modules/proton/cron.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement, then register in `initializeCron` and stop in `stopCron`.**

- [ ] **Step 4: Run the tests to verify they pass.**

  Run `yarn test` (including `src/lib/cron.test.ts`) and `yarn typecheck`. Expected: PASS.

- [ ] **Step 5: Standalone boot check.**

  Run `yarn build && node scripts/fix-standalone-instrumentation.mjs`. Then:

  `cd .next/standalone && DATABASE_URL=postgresql://x:x@127.0.0.1:1/x BETTER_AUTH_SECRET=x KIS_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef node server.js`

  Leave `DISABLE_CRON` unset. Expected log: `[Proton] runtime ready`. DB connection errors from other boot catch-ups are expected. Stop with Ctrl-C.

- [ ] **Step 6: Commit.**

  `git commit -m "feat(proton): cron sync orchestrator with per-user session lock"`

---

### Task 17: Data usage and Sentry scrubbing

**Files:**

- Modify: `src/lib/data-usage.ts` (`CATEGORY_LABELS.photos = "사진"`; `TABLE_DEFS` += `{ category: "photos", table: "photos" }`, `{ category: "photos", table: "photo_thumbnails", ownedVia: { parent: "photos", fk: "photo_id" } }`), `src/modules/settings/components/DataUsageCard.tsx` (`CATEGORY_COLORS.photos = "#0ea5e9"`)
- Modify: `src/lib/sentry-scrub.ts`:
  - `HEALTH_URL_MARKERS` += `"proton.me"`, `"/api/proton"`, `"/api/photos"`.
  - `HEALTH_EXTRA_KEY_DENYLIST` += `"latitude"`, `"longitude"`, `"claimedmetadata"`, `"claimed_metadata"`, `"thumbnail"`, `"keypassword"`, `"key_password"`.
  - `scrubRequest` also deletes the `x-pm-uid` header.
  - `HEALTH_SPAN_DROP_HEADER` adds `x-pm-uid`.
- Test: `src/lib/data-usage.test.ts`, `src/lib/sentry-scrub.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// data-usage.test.ts
it("counts photo_thumbnails through photos (it has no user_id column)", …);
// sentry-scrub.test.ts
it("drops body, query, Authorization and x-pm-uid on a drive-api.proton.me request", …);
it("drops x-pm-uid/authorization span header attributes on a Proton span", …);
it("redacts latitude/longitude/claimedMetadata/thumbnail/keyPassword keys in extra", …);
it("strips the response body of /api/photos/<id>/thumbnail breadcrumbs", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test src/lib/data-usage.test.ts src/lib/sentry-scrub.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Verify.**

  Run `yarn test src/lib` (including `sentry-hooks.test.ts`). Expected: PASS.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(proton): data-usage rows and Sentry scrubbing for photo data"`

---

### Task 18: Account deletion

**Files:**

- Modify: `src/app/api/auth/disconnect/route.ts` (call `new ProtonConnectionService(db).revokeOnly(user.id)` before `deleteAccount`, inside try/catch; append `PROTON_ERRORS.revokeFailed` to `message` when it returns false)
- Test: `src/app/api/auth/disconnect/route.test.ts`, `src/modules/proton/cascade.integration.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// route.test.ts
it("best-effort revokes Proton before deleting and still deletes when revoke fails", …);
it("adds the fixed Proton notice to the success message when revoke failed", …);
// cascade.integration.test.ts (useTransactionalDb)
it("deleting the users row cascades proton_connections, photos, photo_thumbnails and photo_blocks", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run `yarn test src/app/api/auth/disconnect && yarn test:integration`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests to verify they pass.**

  Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(proton): revoke Proton session on account deletion"`

---

### Task 19: Rescreen script for model changes

**Files:**

- Create: `scripts/rescreen-photo-thumbnails.ts`, `scripts/rescreen-photo-thumbnails.test.ts`

**Interfaces:**

- Consumes: `createNsfwjsClassifier`, `isBlocked` (Task 7); the `applyIngest` block outcome (Task 9).
- Produces: `rescreenUser(db: Database, userId: string, classifier: PhotoClassifier, opts: { dryRun: boolean }): Promise<{ scanned: number; blocked: number }>`. The CLI is `npx tsx scripts/rescreen-photo-thumbnails.ts <userId> [--apply]` and defaults to a dry run.

- [ ] **Step 1: Write the failing tests.**

```ts
it("dry run reports would-block counts without writing", …);
it("--apply blocks via the same delete-row + photo_blocks path and never logs bytes", …);
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `yarn test scripts/rescreen-photo-thumbnails.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

  Walk the stored thumbnails page by page (keyset on `photo_id`).

- [ ] **Step 4: Run the tests to verify they pass.**

  Run: `yarn test scripts/rescreen-photo-thumbnails.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.**

  `git commit -m "feat(proton): thumbnail rescreen script for classifier threshold changes"`

---

### Task 20: Docs, privacy and final gates

**Files:**

- Modify: `src/app/privacy/page.tsx`:
  - Collected-items list (line ~54-66): add `<li>Proton Drive 사진 메타데이터(촬영 시각·위치·기기)와 썸네일(선택 연동)</li>`.
  - Add a sentence: `"민감한 이미지는 서버 안의 로컬 모델로 자동 판별하여 저장하지 않으며, 사진을 외부 분석 서비스로 보내지 않습니다."`
  - Encryption sentence (line ~123): add `Proton`.
  - External services sentence (line ~152): add `Proton`.
- Modify: `CLAUDE.md`:
  - Project Overview: add Proton Drive Photos.
  - Architecture: adapter entry `proton/` (vendored account module, patched crypto, runtime load order, `transpilePackages`).
  - Schema: the four tables, the exposure rule, `photo_blocks` semantics.
  - Migration list: `0047`.
  - Cron table row: `*/10 * * * *` | `proton-photos`.
  - API list: `/api/proton`, `/api/proton/connect`, `/api/proton/connect/status`, `/api/photos/[photoId]/thumbnail`.
  - Data-status: 8 sources, `proton` not recoverable.
  - Privacy/Sentry: new denylist and markers.
  - Docker: the `.yarn/patches` COPY.
  - NSFW: model, thresholds, fail-closed rule, rescreen script.
  - Known unknowns: spec §6.
- `.env.example`: no change (no new vars). State this in the commit body.

- [ ] **Step 1: Make the edits.**

- [ ] **Step 2: Run all gates.**

  Run `yarn typecheck && yarn lint && yarn test && yarn build && yarn test:integration && BROWSER_TEST_PRODUCTION=true yarn test:browser`. Expected: all PASS.

- [ ] **Step 3: Commit.**

  `git commit -m "docs: document Proton Drive Photos collection layer and privacy"`

---

## Operational verification (owner, after deploy; spec §5)

1. Connect from Settings and complete the Proton login page.
2. After backfill: about 8.5k exposed photos. Check the distribution of `location_source` (exif / owntracks / null). Check the blocked count. Spot-check random passes for false positives and false negatives. If needed, lower the thresholds and run `scripts/rescreen-photo-thumbnails.ts --apply`.
3. A new phone photo appears within 10 minutes.
4. The connection stays `active` after at least one token refresh. Watch logs for `x-pm-drive-requirements`.
