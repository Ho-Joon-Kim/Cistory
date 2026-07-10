---
title: "feat: Fitbit Air integration via Google Health API"
type: feat
status: active
date: 2026-07-10
origin: docs/brainstorms/fitbit-air-google-health-integration-requirements.md
---

# feat: Fitbit Air integration via Google Health API

## Summary

Extend the existing Withings integration skeleton (OAuth authorize/callback, AES-GCM token storage, advisory-lock refresh, settings UI) into a new `src/modules/health/` + `src/lib/adapters/google-health/`, but drive sync with the KIS resumable per-metric-watermark / chunked-backfill engine instead of Withings' single-watermark single-transaction upsert. Store Fitbit Air data broadly — a long/narrow intraday `samples` table + a daily-summary table + raw-page retention — and surface curated daily trends on a new top-level `/health` page. A live spike (U1) confirms real data flow and the exact metric set before the sync engine is built.

---

## Problem Frame

Fitbit Air data is siloed in the Google Health app, outside Cistory's unified life-log. The only viable ingestion path is the new **Google Health API** (server-side REST, Google OAuth 2.0); the legacy Fitbit Web API turns down 2026-09. See origin doc (Sources & References) for the full product framing.

---

## Requirements

- R1. Connect/disconnect Fitbit (Google Health) from settings; disconnect stops sync, retains stored data, revokes the token. *(origin R1)*
- R2. Auth uses the new Google Health API + Google OAuth 2.0 only; no legacy Fitbit auth. *(origin R2)*
- R3. Access/refresh tokens encrypted at rest, auto-refreshed; confirmed refresh failure (invalid_grant) flips connection to "needs_reauth"; transient errors do not. *(origin R3)*
- R4. Sync + store the four metric groups (sleep / activity / cardiovascular / oxygen-respiratory-temp) as daily summaries. *(origin R4)*
- R5. Store all available data including intraday raw time series, losslessly (normalized samples + raw response), display a curated subset. *(origin R5, R9)*
- R6. Incremental (watermark) sync, idempotent on re-run (upsert), with resumable historical backfill. *(origin R6)*
- R7. Sync runs in the dedicated cron worker, not the web request path. *(origin R7)*
- R8. New top-level `/health` page shows recent daily trends for curated metrics (sleep, activity, resting HR, SpO2), with backfilling/empty/missing-data/last-synced states. *(origin R8, R12)*
- R9. New health tables appear in the settings data-usage view for size monitoring. *(origin R10)*
- R10. Google OAuth credentials live in `.env`; raw health payloads never appear in logs/Sentry. *(origin R11, R13)*

**Origin actors:** A1 (user/self), A2 (cron worker), A3 (Google Health API)
**Origin flows:** F1 (connect), F2 (periodic sync)
**Origin acceptance examples:** AE1 (token auto-refresh), AE2 (needs_reauth on confirmed failure), AE3 (idempotent re-sync), AE4 (per-metric partial-skip), AE5 (OAuth failure handling), AE6 (missing-data renders as gap)

---

## Scope Boundaries

- Legacy Fitbit Web API / auth (dying path)
- Phase 2 (Withings-merged report health story) and Phase 3 (correlation/insights) — this plan is Phase 1 only
- Real-time webhooks/subscriptions (cron polling only)
- Multi-user public distribution + full Google verification/CASA — we run **single-user Production-unverified** (≤100-user cap covers the owner)

### Deferred to Follow-Up Work

- Intraday sampling/downsampling/rollup and raw-page retention pruning (revisit when the data-usage card shows real growth — `health_raw_pages` is the metric to watch, since it, not the ~0.5 GB/yr normalized samples, is the likely dominant cost)
- Unify the OAuth-state HMAC helper across Withings + Google (this plan clones it to avoid touching Withings)
- Register the existing Withings tables in data-usage `TABLE_DEFS` (pre-existing gap noticed during research)
- Separate tighter-cadence intraday cron task (this plan uses the shared 24h-gated pass first)

---

## Context & Research

### Relevant Code and Patterns

- `src/lib/adapters/withings/withings.ts` — adapter shape: undici **IPv4 dispatcher** (`new Agent({ connect: { family: 4 } })`), throttle + capped exponential backoff, terminal (`WithingsAuthError`) vs retryable (5xx/rate-limit) error classes, page cap. Mirror for Google (googleapis is dual-stack → same dev-host IPv6 black hole).
- `src/modules/withings/service.ts` — `getValidToken()` advisory-lock (`pg_advisory_xact_lock`) + re-read-inside-lock + 60s grace; `needs_reauth` only on confirmed auth error; `syncUser(skipIfSyncedWithinMs)`. Mirror, with the Google divergence below.
- `src/modules/portfolio/service.ts` — `backfillPendingAccounts()` + `executionsBackfilledFrom`/`pnlBackfilledFrom` watermarks + 3-month chunked windows + `onConflictDoNothing`. This is the **sync-engine template** (not Withings' single-watermark).
- `src/lib/withings-oauth-state.ts` — stateless HMAC-signed OAuth `state`. `src/lib/withings-urls.ts` — `appBaseUrl` + callback URL builder.
- `src/app/api/withings/{authorize,callback,route}.ts` — plain-GET redirect routes (not `withAuth`, since browser-navigation); callback encrypts tokens, upserts, then fire-and-forget backfill. **Follow the route/redirect/encrypt shape but NOT the fire-and-forget backfill** — U4 deliberately drops it (that call runs in the web container; see U4 + R7). Intraday backfill is heavier than Withings' single measurement pull, so the Google callback leaves `backfilledFrom` null and lets the cron worker backfill.
- `src/modules/settings/components/WithingsSettings.tsx`, `src/modules/settings/{types,hooks}.ts`, `src/app/api/settings/route.ts`, `SettingsForm.tsx` — settings-card wiring + `?provider=connected|error` callback toast.
- `src/app/portfolio/page.tsx` + `src/modules/portfolio/hooks.ts` — top-level page pattern for `/health`. `src/components/Layout/Header.tsx` — nav link + active-state pattern.
- `src/lib/data-usage.ts` — `TABLE_DEFS` (line ~50) + `CATEGORY_LABELS`; every counted table must have a `user_id` column (`buildEstimateQuery` filters `WHERE "user_id" = $1`). Withings tables are currently **not** registered.
- `src/lib/crypto.ts` — `encryptSecret`/`decryptSecret` (AES-256-GCM, `KIS_ENCRYPTION_KEY`). Reuse; do **not** add a second key env.
- `src/db/schema.ts` / `src/db/index.ts` — table conventions, `getDb()` singleton; migration flow `yarn db:generate` → next file is `0027`.
- `src/lib/cron.ts` — per-user sync loop (Withings block ~line 315, KIS ~line 274), each integration in its own try/catch; 24h gate via `skipIfSyncedWithinMs`.

### Institutional Learnings

- No `docs/solutions/` tree exists yet. Durable context lives in `docs/plans/2026-07-10-001-feat-withings-body-scale-integration-plan.md` (the reused skeleton) and `docs/portfolio/kis-integration.md` (§6 third-party-API trap catalog + live-spike discipline).
- User memory `project_dev_host_ipv6_blackhole.md`: dev host has a dead-IPv6 black hole; the undici `family:4` dispatcher is the confirmed fix, and `setGlobalDispatcher`/`dns.setDefaultResultOrder` did **not** work under Next. Mock the `undici` module (not global fetch) in adapter tests.

### External References

- Google Health API is a server-side REST API at `https://health.googleapis.com/v4/` — `users/me/dataTypes/{dataType}/dataPoints` with `list` (intraday, `pageSize`≤10000, `pageToken`), `dailyRollUp` (daily summaries; span caps **14 days** for heart-rate/active-minutes/total-calories, **90 days** others), `reconcile` (multi-source dedup). ([reference](https://developers.google.com/health/reference/rest))
- OAuth: auth `accounts.google.com/o/oauth2/v2/auth`, token `oauth2.googleapis.com/token`, revoke `oauth2.googleapis.com/revoke`. `access_type=offline` + `prompt=consent` for a refresh token; **Google refresh tokens do not rotate** (response omits it → keep the stored one).
- **Token durability (verified):** switching the app to **"In Production" status removes the Testing-only 7-day refresh-token expiry even while unverified**; unverified apps still return restricted-scope data for ≤100 users. ([health/setup](https://developers.google.com/health/setup), [health/app-verification](https://developers.google.com/health/app-verification))
- All `googlehealth.*.readonly` scopes are Restricted. HR intraday cadence ~5s → ~6.5M normalized rows/yr (~0.5 GB) — small; no partitioning/BRIN day one. **That figure is the normalized `samples` cost only; `health_raw_pages` retains the verbatim JSON responses and is likely the larger consumer** (raw pages carry per-point envelopes + metadata the normalized table drops). Track both in the data-usage card (U6); raw-page pruning is the first lever if growth surprises (already in Deferred to Follow-Up).

---

## Key Technical Decisions

- **Google Health API v4 REST, not legacy Fitbit** *(origin)*. Research-confirmed server-side REST; the existing web OAuth client (`cistory-fitbit-track`) fits.
- **Token path = Production-unverified, no CASA.** Verified: Production status yields durable non-rotating refresh tokens for the owner's account; keep `needs_reauth` as the safety net (revocation / 6-month inactivity / latent Google review) — but flip it only on a *confirmed* auth failure (a forced-refresh retry still failing, or the refresh call itself returning `invalid_grant`), never on a single transient `invalid_grant`, so a blip doesn't force a needless re-link.
- **Sync engine = KIS pattern, not Withings.** Resumable per-metric watermarks + chunked windows (respect 14/90-day dailyRollUp caps and per-day intraday windows) + batched `ON CONFLICT DO NOTHING`, with inter-batch yields so the single-process cron loop isn't blocked.
- **Storage = long/narrow intraday `samples` + daily-summary table + raw-page retention.** `samples(userId, metric, sampleAt, value|valueJson)` unique `(userId, metric, sampleAt)` (the unique index doubles as the time-range read path); `value` for scalars, `valueJson` for structured metrics (sleep stages, HRV). **Daily summaries are aggregated from stored intraday `samples` over the KST day (`localDaySql`), not copied from `dailyRollUp`** (whose buckets are Google-server-TZ and can't be re-bucketed); `dailyRollUp` fills only daily-only metrics and beyond-retention backfill gaps. Summaries carry `valueSum` for total-shaped metrics (steps, sleep-minutes). Raw pages kept for lossless re-normalization. Every table carries `user_id` (data-usage). No partitioning/BRIN until ~50M rows.
- **Refresh-token non-rotation divergence from Withings:** preserve the stored refresh token when a refresh response omits it (Withings rotates and replaces; Google does not).
- **undici IPv4 dispatcher mandatory** (googleapis dual-stack).
- **API routes off `/api/health`** (that path is the Jenkins/Docker deploy healthcheck) — use `/api/fitbit/*`. The **page** `/health` is fine (page route, not API handler).
- Reuse `KIS_ENCRYPTION_KEY` + `crypto.ts`; creds via `.env` `FITBIT_CLIENT_ID`/`FITBIT_CLIENT_SECRET` (already moved there).

---

## Open Questions

### Resolved During Planning

- Is it server-side REST (not on-device Health Connect)? → Yes, `health.googleapis.com/v4` (research-verified; U1 confirms end-to-end).
- Testing-mode 7-day token vs unattended cron? → Switch app to Production-unverified → durable tokens, no CASA.
- Refresh-token rotation? → Non-rotating; keep stored token when omitted.
- Route namespace collision? → New API routes under `/api/fitbit/*`, never `/api/health/*`.
- Storage volume concern? → ~0.5 GB/yr; store intraday now, no partitioning.

### Deferred to Implementation

- Exact metric set: whether `readiness`, `daily-sleep-temperature-derivations`, `run-vo2-max` etc. actually return data for this account — **U1 spike enumerates** (VO2max/HRV/resting-HR/SpO2/sleep-stages/respiratory confirmed present; readiness likely absent).
- Intraday retention window and published rate limits — read from a live query / Cloud Console during U1.
- Intraday sync cadence: shared 24h-gated pass (this plan) vs a separate hourly cron task with a single-flight guard (deferred).
- **Read method per metric — `list` vs `reconcile`, and the sample upsert conflict policy.** The plan assumes single-source `list` + `ON CONFLICT DO NOTHING` (one authoritative value per timestamp). If the U1 spike shows the account has multiple contributing data sources for a metric (Fitbit device + phone + manual entry), a same-`sampleAt` collision could silently keep the wrong value — `reconcile` (Google's multi-source dedup) or a `DO UPDATE` precedence rule may be needed instead. Resolve from the U1 multi-source finding before U5 locks the upsert. *(from plan review — deferred: depends on U1 data)*
- **Curated `/health` metric set, chart composition, and trend window.** Origin R8 delegated the exact curated surface to planning; it's a UX judgment better made against real U1 data. Baseline is sleep / activity / resting-HR / SpO2 as separate trend cards over a default window (7 / 14 / 30 days — pick at build time); revisit which metrics earn a card and how (line vs band vs sparkline) once the spike shows what's dense enough to chart. *(from plan review — deferred: UX decision, best made with real data)*

---

## Output Structure

    src/
    ├── app/
    │   ├── api/fitbit/
    │   │   ├── authorize/route.ts        # OAuth start (plain GET → redirect)
    │   │   ├── callback/route.ts         # OAuth callback (exchange, store; cron backfills)
    │   │   ├── route.ts                  # DELETE = disconnect (revoke + delete)
    │   │   └── summary/route.ts          # GET curated daily trends (withAuth)
    │   └── health/page.tsx               # top-level dashboard (mirrors /portfolio)
    ├── lib/
    │   ├── adapters/google-health/
    │   │   ├── google-health.ts          # adapter + factory + colocated types
    │   │   ├── interface.ts              # barrel re-export
    │   │   └── google-health.test.ts
    │   ├── google-oauth-state.ts         # HMAC-signed state (cloned from withings)
    │   └── google-health-urls.ts         # base + callback URL builders
    └── modules/
        ├── health/
        │   ├── service.ts                # HealthSyncService (+ test)
        │   ├── hooks.ts                  # client fetch hooks + response types
        │   └── components/*.tsx          # trend cards, states
        └── settings/components/HealthSettings.tsx

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Connect (F1):  /health page ─▶ <a href=/api/fitbit/authorize>
   authorize:  getUser ─▶ build Google authorize URL (offline+consent+scopes, signed state) ─▶ 302 Google
   callback:   verify state ─▶ exchange code ─▶ encrypt {access,refresh} ─▶ upsert healthConnections
               (backfilledFrom = null) ─▶ 302 /settings?health=connected   [no backfill on web path — cron picks it up]

Cron (F2, dedicated container, 24h gate):
   per user with active healthConnection:
     getValidToken (advisory lock, re-read, refresh; keep refresh token if omitted)
     for each configured metric:
        forward:  window [syncedThrough..now] by span-cap ─▶ pageToken loop
                  ─▶ upsert samples ON CONFLICT DO NOTHING / daily summaries ON CONFLICT DO UPDATE
                  ─▶ store raw page ─▶ advance syncedThrough   (yield between batches)
        (metric error → skip this metric, continue others  [AE4])
     backfillPendingConnections: walk backfilledFrom ◀─ toward floor, chunked, resumable
```

---

## Implementation Units

### U1. Live verification spike (de-risk gate)

**Goal:** Before building the sync engine, confirm end-to-end against the real account: server-side REST data flow, durable token under Production-unverified, and the exact metric set that returns data.

**Requirements:** origin Resolve-Before-Planning gate (R2, R4, R1, R3)

**Dependencies:** None

**Files:**
- Create: `docs/health/google-health-spike-findings.md` (findings record)
- (Optional throwaway probe script under `scripts/`, not committed as product code)

**Approach:**
- GCP console: enable `health.googleapis.com`; confirm the existing web OAuth client; **rotate the `client_secret`** (the one committed earlier to the repo — regenerate in the console and update `.env` `FITBIT_CLIENT_SECRET` *before* any production OAuth, per R11); add the personal @gmail as owner; **switch the consent screen to "In Production" (leave unverified)**.
- Run one manual authorize (`access_type=offline`, `prompt=consent`, `googlehealth.*.readonly`), click through the unverified-app warning, exchange the code.
- Call `list` and `dailyRollUp` for `steps`, `heart-rate`, `oxygen-saturation`, `sleep`, `daily-resting-heart-rate`, `heart-rate-variability`, `daily-respiratory-rate`, `vo2-max`, `daily-sleep-temperature-derivations`, `readiness` (probe). Record which return real data, **each one's value shape** (scalar float vs structured object — drives `value` vs `valueJson` in U2) **and whether it's total-shaped** (steps/sleep-minutes need `valueSum`).
- Token durability can't be proven by one refresh at T+0 — a single immediate refresh succeeds whether or not the 7-day Testing cap is gone. So verify two ways: (a) **by config** — screenshot the consent screen showing "In Production" status, which per Google's docs is what removes the 7-day refresh-token expiry; (b) **by observation** — record the connect timestamp and schedule a **T+8-day manual refresh** of the stored refresh token; a success past day 7 empirically confirms durability. Treat U1 as provisionally passed on (a), fully closed on (b).
- Record dailyRollUp span caps, its **aggregation timezone** (KST vs UTC vs account-TZ — decides how much we can trust it vs re-bucketing intraday), intraday `pageSize`/`nextPageToken`, any intraday retention limit (this becomes the `backfillFloor` seed), and **whether any metric reports multiple contributing data sources** (drives the `list` vs `reconcile` decision in Open Questions).

**Execution note:** Exploratory manual spike, not test code. Its findings gate U5's metric map and confirm the token path.

**Test scenarios:**
- Test expectation: none — manual spike; output is the findings doc.

**Verification:** `docs/health/google-health-spike-findings.md` records the confirmed metric set (with per-metric value shape + total-vs-average nature), a successful data read, the config-level "In Production" durability confirmation, and — after T+8 days — the empirical post-7-day refresh result. The `client_secret` rotation is done and reflected in `.env`.

---

### U2. Database schema + migration

**Goal:** Add tables for the health connection, per-metric sync watermarks, intraday samples, daily summaries, and raw-page retention.

**Requirements:** R3, R5, R6

**Dependencies:** U1 (hard — the per-metric value shape from U1 decides `value` vs `valueJson` for each metric and which metrics need `valueSum`; the schema is not fully metric-agnostic)

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0027_*.sql` (via `yarn db:generate`; never hand-number)

**Approach:**
- `health_connections`: `userId` unique FK cascade, `accessTokenEnc`, `refreshTokenEnc`, `accessTokenExpiresAt`, `scope`, `googleSub`, `status` ('active'|'needs_reauth'), `lastSyncedAt`, `lastSyncError`, `backfillFloor` (earliest instant historical backfill targets — the KIS `openedAt` analog; seeded from the U1 spike's discovered intraday-retention limit / connection date, so backfill has a defined stop and can't walk forever), `backfillCompletedAt` (null until every metric's `backfilledFrom` reaches `backfillFloor` — lets the UI tell "still backfilling" from "connected, no data" per R12), timestamps. Mirror `withings_connections`.
- `health_sync_state`: `userId` FK cascade, `metric`, `syncedThrough` (forward watermark), `backfilledFrom` (historical; null = never), unique `(userId, metric)`. KIS-watermark analog.
- `health_samples`: `userId` FK cascade (denormalized for data-usage), `metric`, `sampleAt` (timestamp), `value` (doublePrecision, nullable), `valueJson` (jsonb, nullable — for non-scalar metrics that don't reduce to one float: sleep-stage segments, HRV RMSSD/interval payloads, SpO2 with a confidence field). Scalar metrics use `value`; structured metrics use `valueJson`; the U1 spike's per-metric shape enumeration decides which. Unique `(userId, metric, sampleAt)`.
- `health_daily_summaries`: `userId` FK cascade, `day` ('YYYY-MM-DD' KST local day), `metric`, `valueAvg/Min/Max`, `valueSum` (nullable — total-shaped metrics like steps and sleep-minutes need a sum, not an average; avg/min/max are meaningless for them), `count`, unique `(userId, metric, day)`. **No `rawJson` here** — raw payloads live once in `health_raw_pages`; duplicating them per summary row is dead weight. The KST `day` is derived by bucketing stored `health_samples` via `localDaySql`, **not** copied from `dailyRollUp` (see U5 — `dailyRollUp` days are Google-server-TZ pre-aggregates that can't be re-bucketed to KST).
- `health_raw_pages`: `userId` FK cascade, `dataType`, `method`, `windowStart/End`, `rawJson`, `fetchedAt`.
- Type exports (`$inferSelect`/`$inferInsert`).

**Patterns to follow:** `src/db/schema.ts` Withings/brokerage tables; `drizzle/0026_watery_sway.sql`.

**Test scenarios:**
- Test expectation: none — schema/migration scaffolding; idempotency/behavior covered by U5.

**Verification:** `yarn db:generate` produces `0027`; `yarn db:migrate` applies cleanly; new types importable from `@/db`.

---

### U3. Google Health adapter

**Goal:** Server-side client for Google OAuth (authorize/exchange/refresh/revoke) and Health data reads (`list`, `dailyRollUp`), over undici with a forced-IPv4 dispatcher.

**Requirements:** R2, R3, R4, R5

**Dependencies:** U1 (the U1 spike confirms OAuth scopes, `list`/`dailyRollUp` response shapes, and the error taxonomy the adapter encodes — building it before U1 risks re-work)

**Files:**
- Create: `src/lib/adapters/google-health/google-health.ts`, `.../interface.ts`
- Test: `src/lib/adapters/google-health/google-health.test.ts`

**Approach:**
- Module-scoped `new Agent({ connect: { family: 4 } })`; use undici's `fetch` export (built-in `fetch` rejects an undici Agent).
- `buildAuthorizeUrl` (offline + consent + scopes + signed state), `exchangeCode`, `refreshToken` (**keep existing refresh token when response omits it**), `revokeToken`, `listDataPoints` (returns `{dataPoints, nextPageToken}`), `dailyRollUp` (`{rollupDataPoints, nextPageToken}`).
- Error taxonomy: `GoogleHealthAuthError` (invalid_grant / 401, terminal) vs `GoogleHealthApiError`; 429/5xx retryable with capped exponential backoff; self-paced throttle; page cap.

**Execution note:** Implement `refreshToken` (non-rotation) and the error taxonomy test-first — these are the fragile, divergent-from-Withings parts.

**Patterns to follow:** `src/lib/adapters/withings/withings.ts` (dispatcher, retry/throttle/backoff, error classes, page cap).

**Test scenarios:**
- Happy: `buildAuthorizeUrl` includes `access_type=offline`, `prompt=consent`, joined scopes; `exchangeCode` parses tokens.
- Edge: `refreshToken` response omitting `refresh_token` → returned tokens keep the passed-in refresh token (regression guard vs Withings rotation).
- Error: 401/`invalid_grant` → `GoogleHealthAuthError` (terminal, not retried); 5xx/429 → retried with backoff then success.
- Integration: `listDataPoints` loops `nextPageToken` until absent; `dailyRollUp` posts the given range/`windowSizeDays`. Mock the `undici` module, not global fetch.

**Verification:** Adapter unit tests pass; requests go through the IPv4 dispatcher.

---

### U4. OAuth connect/callback/disconnect routes + settings wiring

**Goal:** User connects and disconnects from settings; tokens stored encrypted; disconnect revokes; settings surfaces status.

**Requirements:** R1, R2, R3, R10; F1; AE5

**Dependencies:** U2, U3

**Files:**
- Create: `src/lib/google-oauth-state.ts`, `src/lib/google-health-urls.ts`
- Create: `src/app/api/fitbit/authorize/route.ts`, `src/app/api/fitbit/callback/route.ts`, `src/app/api/fitbit/route.ts`
- Create: `src/modules/settings/components/HealthSettings.tsx`
- Modify: `src/modules/settings/types.ts`, `src/modules/settings/hooks.ts`, `src/app/api/settings/route.ts`, `src/modules/settings/components/SettingsForm.tsx`

**Approach:**
- `authorize`/`callback` are **plain GET** (browser navigation): call `getAuthenticatedUser` manually, redirect to `/login` (authorize) or `/settings?health=error&reason=...` (callback) on failure — never raw JSON 401. Rate-limit via `enforceRateLimit`.
- `callback`: verify signed state (`verified.userId === user.id`), exchange code, **encrypt both tokens**, upsert `health_connections` on `userId` (leaving each metric's `backfilledFrom` null), redirect `?health=connected`. **No backfill here** — the callback runs in the web container, and kicking off an intraday backfill on the request path violates R7 and blocks the event loop. Backfill is picked up by the cron worker (U6): `backfillPendingConnections` sees the null watermarks and walks history there. First-connect therefore lands in the "backfilling" UI state (R12) until the cron pass runs.
- `route.ts` DELETE (disconnect, `withAuth`): revoke token via adapter, hard-delete the connection row, retain sample/summary data.
- Settings serializer adds `hasHealthConnection`/`healthLastSyncedAt`/`healthNeedsReauth` (parallel select in `readUserSettings`); `HealthSettings.tsx` mirrors `WithingsSettings` (connect `<a href="/api/fitbit/authorize">`, needs_reauth banner, disconnect); `SettingsForm` renders it + handles `?health=` toast.

**Patterns to follow:** `src/app/api/withings/{authorize,callback,route}.ts`; `WithingsSettings.tsx`; settings wiring in `src/app/api/settings/route.ts`.

**Test scenarios:**
- Happy: valid state+code → encrypted tokens stored, connection upserted, redirect `connected`.
- Error (AE5): consent denied / code-exchange failure → redirect `error`, **no** connection row created; settings stays "not connected".
- Error: state `userId` mismatch → rejected.
- Integration: disconnect → adapter revoke called, connection deleted, samples retained.

**Verification:** Connect round-trips (manual/spike); settings shows connected + last-sync; disconnect revokes and deletes.

---

### U5. Health sync service (incremental + backfill engine)

**Goal:** Cron-driven per-metric incremental sync + resumable historical backfill; store intraday samples + daily summaries + raw pages; idempotent and event-loop-safe.

**Requirements:** R3, R4, R5, R6, R7; AE1, AE2, AE3, AE4

**Dependencies:** U1, U2, U3 (U1 supplies the metric config map — dataType, mode, and value shape per metric — that this service is built around)

**Files:**
- Create: `src/modules/health/service.ts`
- Test: `src/modules/health/service.test.ts`

**Approach:**
- `getValidToken`: advisory lock `health-token:${userId}`, re-read-inside-lock, 60s grace, refresh via adapter, **preserve stored refresh token if the refresh response omits one**, persist encrypted. **`needs_reauth` is not flipped on the first `invalid_grant`** — a data read that 401s forces one refresh-and-retry (Withings `fetchGroups` pattern); only a *fresh* token still failing auth confirms revocation and flips `needs_reauth` (AE2). A refresh call that itself returns `invalid_grant` is confirmed-terminal and flips immediately; transient 5xx/network never flips.
- Metric config map `{ metric → { dataType, mode: intraday|daily|both, shape: scalar|structured } }` seeded from the U1 findings.
- Incremental `syncUser`: per metric, from `syncedThrough` (fallback ~7d) → now, windowed per span cap, `pageToken` loop, parse one page at a time, batched upsert (`ON CONFLICT (userId,metric,sampleAt) DO NOTHING` for samples), store raw page, advance `syncedThrough`. **Yield (`setImmediate`) between batches.** Per-metric try/catch (AE4).
- Daily summaries: for metrics with intraday coverage, compute `health_daily_summaries` rows by aggregating the freshly-upserted `health_samples` over the KST day (`localDaySql`), so the daily boundary is correct (`ON CONFLICT (userId,metric,day) DO UPDATE`). `dailyRollUp` is used only for metrics with **no** intraday series (daily-only) or to fill days older than the intraday-retention window during backfill — never re-bucketed to KST (its buckets are Google-server-TZ; recording that TZ is a U1 finding).
- `backfillPendingConnections`: walk each metric's `backfilledFrom` toward `health_connections.backfillFloor` (never past it), chunked per span cap, resumable, idempotent. When every configured metric's `backfilledFrom` reaches `backfillFloor`, set `backfillCompletedAt` so the UI can leave the "backfilling" state (R12).
- KST correctness: bucket `day` via `src/db/sql.ts` `localDaySql` / `toLocalDateString`, never the UTC day (overnight SpO2 spans midnight).

**Execution note:** Test-first on the invariants — idempotent re-sync, non-rotating-refresh preservation, `needs_reauth`-only-on-confirmed-auth, KST day bucketing.

**Patterns to follow:** `src/modules/withings/service.ts` (`getValidToken`, `needs_reauth`, `syncUser`); `src/modules/portfolio/service.ts` (`backfillPendingAccounts`, watermarks, chunked windows, `onConflictDoNothing`).

**Test scenarios:**
- Integration (AE3): re-syncing the same window upserts with no row growth.
- Error (AE4): a metric returning 403/no-data is skipped; other metrics still persist.
- Happy (AE1): expired access token → advisory-lock refresh → sync continues.
- Edge: refresh response without `refresh_token` keeps the stored refresh token.
- Error (AE2): a data read returning `invalid_grant` → one forced refresh-and-retry; a *fresh* token still 401ing flips `needs_reauth`, but a retry that succeeds does **not**.
- Error (AE2): `invalid_grant` returned by the refresh call itself → `needs_reauth` immediately; transient 5xx/network does **not** flip status.
- Integration: backfill advances `backfilledFrom` toward `backfillFloor`, stops at the floor, resumes from a partial run, stays idempotent, and sets `backfillCompletedAt` once all metrics reach the floor.
- Edge: a 00:00–09:00 KST sample lands on the correct KST day in `health_daily_summaries` (aggregated from intraday via `localDaySql`, not from `dailyRollUp`).
- Integration: multi-page window exhausts `nextPageToken`.

**Verification:** Sync tests pass; incremental + backfill idempotent; `needs_reauth` semantics correct; no unbounded in-memory arrays.

---

### U6. Cron wiring + data-usage registration

**Goal:** Run health sync + backfill in the cron worker; surface the new tables' sizes in settings data-usage.

**Requirements:** R7, R9

**Dependencies:** U5

**Files:**
- Modify: `src/lib/cron.ts`, `src/lib/data-usage.ts`
- Test: `src/lib/cron.test.ts` (extend if it exercises per-integration isolation)

**Approach:**
- Add a health block in the per-user loop (after the Withings block), in its own try/catch: `createHealthSyncService(db).syncUser(user.id, { skipIfSyncedWithinMs: 24h })` then `backfillPendingConnections(user.id)`. (Tighter intraday cadence deferred.)
- `data-usage.ts`: add a `health` key to `CATEGORY_LABELS` and `TABLE_DEFS` entries for `health_samples`, `health_daily_summaries`, `health_raw_pages`, `health_connections` — each already carries `user_id` for the per-user estimate filter.

**Patterns to follow:** `src/lib/cron.ts` Withings/KIS blocks; `src/lib/data-usage.ts` `TABLE_DEFS` shape.

**Test scenarios:**
- Integration: a thrown error in the health block does not abort other integrations for the user (mirror existing isolation).
- Happy: data-usage estimate includes the health tables and returns per-user counts.

**Verification:** Cron runs health sync gated at 24h; data-usage card lists health tables with sizes.

---

### U7. `/health` page + data API + module UI

**Goal:** New top-level `/health` dashboard showing curated daily trends with proper states.

**Requirements:** R1 (disconnected-with-retained-history view), R8; AE6; success criteria

**Dependencies:** U5, U6

**Files:**
- Create: `src/app/health/page.tsx`, `src/app/api/fitbit/summary/route.ts`
- Create: `src/modules/health/hooks.ts`, `src/modules/health/components/*.tsx`
- Modify: `src/components/Layout/Header.tsx`

**Approach:**
- Page mirrors `/portfolio` (client, `useAuth` → `/login`, `Header`, never-connected empty-state → `/settings`).
- `summary` route (`withAuth`) returns recent daily trends for the curated metric set (sleep, activity, resting HR, SpO2) plus connection meta: `hasConnection`, `status` ('active'|'needs_reauth'), `backfillCompletedAt`, `lastSyncedAt` — so the page picks the right state without a second call.
- Components must distinguish four states, none a bare spinner (R12): **(1) never connected** → CTA to `/settings`; **(2) connected, `backfillCompletedAt` null, no summaries yet** → "동기화 중 (백필 진행 중)" backfilling state; **(3) connected, backfill done, still no data for a metric** → that metric's "데이터 없음"; **(4) disconnected but history retained** → disconnect keeps samples/summaries (R1), so a returning user with a deleted connection but non-empty history sees a "연동 해제됨 · 과거 데이터 유지" banner with the retained charts still rendered + a re-connect CTA — not the never-connected empty state.
- A day with no summary row renders as a visual **gap, not zero (AE6)**; a last-synced indicator; a `needs_reauth` banner mirroring settings.
- Header: `<Link href="/health">` + `isHealthPage` active state + icon. API stays under `/api/fitbit/*`, never `/api/health/*`.

**Patterns to follow:** `src/app/portfolio/page.tsx`, `src/modules/portfolio/hooks.ts`, `src/components/Layout/Header.tsx`.

**Test scenarios:**
- Happy: `summary` route returns curated metrics + connection meta; 401 when unauthenticated.
- Edge (R12): connected, `backfillCompletedAt` null, no summaries → "backfilling" state (not a spinner); connected, backfill done, no data → "no data" state — the two are visually distinct.
- Edge (R1): no connection row but non-empty history → "disconnected, history retained" banner + retained charts, not the never-connected CTA.
- Edge (AE6): a missing-day metric renders as a gap, not a 0 value.
- Happy: last-synced timestamp shown; `needs_reauth` surfaces a re-connect banner.

**Verification:** `/health` renders recent sleep/activity/resting-HR/SpO2 trends; all four states (never-connected / backfilling / connected-no-data / disconnected-with-history) render distinctly; nav link works; no API handler under `/api/health`.

---

### U8. Privacy hygiene (log + Sentry scrubbing)

**Goal:** Raw health payloads never reach logs or Sentry.

**Requirements:** R10 (R13 of origin)

**Dependencies:** U3, U5

**Files:**
- Modify: `sentry.server.config.ts`
- Modify: health adapter/service logging call sites (`src/lib/adapters/google-health/google-health.ts`, `src/modules/health/service.ts`)

**Approach:**
- Health logging emits only path/status/count/window metadata — never sample values or raw JSON (mirror Withings adapter).
- Sentry `beforeSend`/`beforeSendTransaction` scrubber strips health request bodies and any health data from `extra`/breadcrumbs; keep `sendDefaultPii: false`.

**Patterns to follow:** Withings adapter logging (path/status/count only); existing `sentry.server.config.ts`.

**Test scenarios:**
- Error path (R13): an adapter/service error log contains no metric values or raw JSON (assert logged payload shape).
- Integration: Sentry `beforeSend` removes health data from a synthetic event's `extra`/breadcrumbs.

**Verification:** No raw health values appear in logs or Sentry events.

---

## System-Wide Impact

- **Interaction graph:** New cron block in `src/lib/cron.ts` (per-user loop); new settings fields in the `/api/settings` contract; new nav entry in `Header`; new `/api/fitbit/*` route group.
- **Error propagation:** Adapter throws terminal `GoogleHealthAuthError` vs retryable `GoogleHealthApiError`; the service maps confirmed auth failure → `needs_reauth`, everything else stays transient; per-metric and per-integration try/catch keep one failure from cascading.
- **State lifecycle risks:** Idempotent upsert on natural keys guards re-sync; advisory lock guards concurrent token refresh + overlapping backfill; non-rotating-refresh preservation avoids self-inflicted token loss.
- **API surface parity:** `/api/health` (deploy healthcheck) MUST stay untouched — new data routes live under `/api/fitbit/*`.
- **Unchanged invariants:** Withings, KIS, WakaTime, location integrations and the `/api/health` liveness route are not modified; `crypto.ts`/`KIS_ENCRYPTION_KEY` reused as-is.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| U1 spike finds a metric (e.g. readiness) isn't exposed | Metric config is data-driven; unavailable metrics are simply omitted from the map (AE4 skip). Core set (sleep/activity/resting-HR/SpO2/HRV/VO2max) is research-confirmed. |
| Google applies discretionary review to the unverified-Production app | `needs_reauth` fallback surfaces a re-connect prompt; single-user + low volume keeps risk low; documented as accepted. |
| Intraday backfill volume blocks the cron event loop | Per-day windows, one-page-at-a-time parse, batched upsert with inter-batch yields; advisory-lock single-flight; runs only in the dedicated cron container. |
| Google Health API schema shifts (GA + ~2 months) | Raw-page retention allows re-normalization without re-fetch; normalized `samples`/summaries are derived. |
| undici IPv4 omission reintroduces the dev-host IPv6 black hole | Adapter forces `family:4` from day one; adapter tests mock the `undici` module. |
| Migration `0027` conflicts if another lands first | Let `yarn db:generate` assign the number at implementation time. |

---

## Sources & References

- **Origin document:** [docs/brainstorms/fitbit-air-google-health-integration-requirements.md](docs/brainstorms/fitbit-air-google-health-integration-requirements.md)
- Reused skeleton plan: `docs/plans/2026-07-10-001-feat-withings-body-scale-integration-plan.md`
- Third-party-API trap catalog: `docs/portfolio/kis-integration.md`
- Google Health API: https://developers.google.com/health/reference/rest , https://developers.google.com/health/setup , https://developers.google.com/health/app-verification
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2 , https://support.google.com/cloud/answer/15549945
