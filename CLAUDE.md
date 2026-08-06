# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cistory is a personal life-logging application that aggregates several private data streams into one dashboard: GitHub commits with AI-powered summaries, location via OwnTracks (visit/track/transport-mode/trip/subway detection), coding activity via WakaTime, Toss financial transactions via MacroDroid push notifications (with AI expense categorization), brokerage portfolio data via the Korea Investment & Securities (KIS) API, body composition via Withings, and health/fitness (steps, heart rate, sleep, workouts) via the Google Health API (Fitbit) plus an on-device Health Connect importer. Built with Next.js 16, Better Auth (GitHub OAuth), Drizzle ORM with PostgreSQL (PostGIS), and the Anthropic SDK. The reporting surface is a single `/overview` dashboard over precomputed period snapshots with AI narratives (it replaced the separate `/insights` and `/report` pages), plus a `/travel` trip browser, map visualization (Mapbox/Kakao), OSM subway data via Overpass, and background sync via node-cron (dedicated container in production, in-process during dev), with Sentry error tracking and Better Stack structured logging.

## Development Commands

```bash
# Start development server (with Turbopack, includes auto Cron)
yarn dev

# Build for production
yarn build

# Linting and formatting (uses Biome)
yarn lint              # Check for lint errors
yarn lint:fix          # Fix lint errors
yarn format            # Format code
yarn check             # Check and fix all issues

# Database operations (Drizzle Kit)
yarn db:generate       # Generate migrations from schema
yarn db:migrate        # Run migrations
yarn db:studio         # Open Drizzle Studio

# Testing (Vitest, node environment)
yarn test              # Run all tests once (vitest run)
yarn test:watch        # Watch mode
yarn test src/lib/geo.test.ts             # Run a single test file
yarn test -t "visit detector"             # Run tests matching a name

# One-off operational scripts
yarn spending:backfill-categories         # Backfill AI expense categories
yarn location:backfill-heatmaps           # Rebuild location_heatmap_daily rollups
npx tsx scripts/detect-trips.ts <userId>  # Manual/backfill trip detection
npx tsx scripts/verify-returns.ts         # TWR/XIRR sanity check vs live DB

# Production
yarn start             # Start production server (binds to 0.0.0.0, includes Cron unless DISABLE_CRON=true)
```

Tests are colocated `*.test.ts` files (e.g. `src/lib/cron.test.ts`, `src/modules/transaction/parser.test.ts`). `vitest.config.mts` injects fake `DATABASE_URL`/auth/API-key env vars before test modules load — `src/lib/auth.ts` constructs a `pg.Pool` at module scope and most route modules transitively import it, but pool construction opens no connection, so no real DB is needed. `src/app/api/_routes-import.test.ts` is a glob-driven smoke test asserting every `src/app/api/**/route.ts` imports cleanly and exports at least one HTTP verb — it catches import-time crashes across all routes at once.

Package manager is **Yarn 4** (Berry, via Corepack, node-modules linker). Use `yarn` for all package operations.

## Architecture Overview

### Core Stack
- **Next.js 16** (App Router) with Turbopack
- **TypeScript 5** (strict mode)
- **Better Auth** - Authentication (GitHub OAuth) with cookie-based sessions
- **Drizzle ORM** - Type-safe PostgreSQL access via `pg.Pool` singleton (PostGIS-enabled PostgreSQL in production)
- **Anthropic SDK** - Claude for commit summaries (`claude-sonnet-4-5`, `src/lib/adapters/ai/claude.ts`) and expense categorization (`claude-haiku-4-5`, `src/modules/spending/category-classifier.ts`)
- **shadcn/ui** + **Tailwind CSS v4** - UI components and styling
- **Biome** - Linter and formatter (replaces ESLint + Prettier)
- **Vitest** - Test runner (colocated `*.test.ts` files, node environment)
- **node-cron** - Background sync scheduler. Runs in a **dedicated cron container** in production (the web container sets `DISABLE_CRON=true`); runs in-process during `yarn dev`
- **Mapbox GL** + **react-map-gl** - Map visualization for location tracking
- **Sentry** (`@sentry/nextjs`) - Error tracking (server, client, edge configs)
- **Better Stack** (`@logtail/node`) - Structured logging via `src/lib/logger.ts`

### Project Structure

```
src/
├── app/                      # Next.js App Router
│   ├── (auth)/              # Auth route group (login, callback)
│   ├── (dashboard)/         # Dashboard route group (settings, repositories, spending)
│   ├── api/                 # API routes (~80 endpoints)
│   ├── dashboard/           # Main dashboard page
│   ├── health/              # Health/fitness dashboard (Google Health + Withings)
│   ├── overview/            # Unified period dashboard (recent/week/month/year)
│   ├── travel/              # Trip list + /travel/[tripId] detail
│   ├── portfolio/           # KIS brokerage portfolio page
│   ├── insights/, report/   # Redirect-only shims → /overview (see legacy-routes.ts)
│   └── privacy|terms/       # Static pages required by the Google/Withings OAuth reviews
├── components/              # Shared components (Layout/, map/, ui/ shadcn components)
├── db/
│   ├── schema.ts            # Drizzle schema (39 app tables)
│   ├── sql.ts               # KST-aware SQL helpers (localDaySql, numericToNumber)
│   └── index.ts             # Database singleton (throws if DATABASE_URL unset)
├── lib/
│   ├── adapters/            # Adapter pattern interfaces + implementations
│   │   ├── ai/             # Claude adapter (claude.ts; types colocated)
│   │   ├── geocoding/      # kakao.ts, mapbox.ts, google.ts, index.ts (auto-select)
│   │   ├── google-health/  # Google Health API (Fitbit) client
│   │   ├── kis/            # Korea Investment & Securities client
│   │   ├── overpass/       # OSM Overpass (subway lines/stations)
│   │   ├── vcs/            # GitHub client (github.ts; types colocated)
│   │   ├── wakatime/       # WakaTime client
│   │   └── withings/       # Withings body-scale client (+ measure-types.ts)
│   ├── api-auth.ts          # Hardening for API-key ingestion endpoints
│   ├── api-handler.ts       # withAuth / withValidation wrappers, ApiError
│   ├── api-key-route.ts     # createApiKeyRoute() factory for key POST/DELETE pairs
│   ├── auth*.ts             # Better Auth server/client config + route helpers
│   ├── cron.ts              # Cron schedule registration + most job bodies
│   ├── trip-detection-cron.ts # runTripDetection + boot catch-up orchestration
│   ├── crypto.ts            # AES-256-GCM secret encryption (KIS/Withings/Google tokens)
│   ├── oauth-state.ts       # Signed stateless OAuth state codec (per-provider context)
│   ├── sentry-scrub.ts      # Drops raw health payloads before they reach Sentry
│   ├── data-usage.ts        # Per-user per-table row/byte estimates → dataUsageCache
│   ├── date-key.ts          # "YYYY-MM-DD" key math + getKstDateWindow
│   ├── hooks/               # Shared client hooks (useCountUp, useNdjsonStream, …)
│   ├── logger.ts            # Structured logging (Better Stack / console fallback)
│   └── utils.ts             # cn, generateId, date helpers (parseDateLocal, …)
├── modules/                 # Feature modules (hooks.ts, service.ts, components/)
│   ├── health/             # Google Health sync, Health Connect import, /health UI
│   │                       #   compaction.ts (heart-rate minute buckets),
│   │                       #   sessions.ts (multi-source sleep/exercise dedup)
│   ├── insights/           # Year-scoped insight sections (/api/insights, /health, overview cards)
│   ├── location/           # Location tracking + processing pipeline (services/)
│   ├── overview/           # /overview: period snapshots, precompute, narratives, legacy redirects
│   ├── portfolio/          # KIS brokerage portfolio (returns.ts for TWR)
│   ├── report/             # Monthly/yearly aggregation behind /api/reports/*, 30+ chart components
│   ├── settings/           # User settings + integration connection cards
│   ├── spending/           # Spending dashboard, AI expense categorization, forecast
│   ├── subway/             # Subway system seeding + OSM refresh
│   ├── summary/            # AI commit summary service
│   ├── sync/               # Commit sync service (SyncService class)
│   ├── timeline/           # Timeline display
│   ├── transaction/        # Toss notification parser
│   ├── travel/             # /travel trip browser (not-a-trip exclusions, route points)
│   ├── wakatime/           # WakaTime coding activity
│   └── withings/           # Withings body-measurement sync
instrumentation.ts           # (project root) Initializes Cron + Sentry on server boot
sentry.{server,client,edge}.config.ts
prompts/                     # External prompt assets (commit-system-prompt.txt)
docs/                        # brainstorms/, plans/, health/, portfolio/, ideation/
scripts/                     # migrate.ts, refresh-subway.ts, detect-trips.ts, verify-returns.ts,
                             # calibrate-subway-matcher.ts, calibrate-flight-detection.ts,
                             # probe-google-health.ts, backfill-location-heatmaps.ts,
                             # backfill-spending-categories.mjs, fix-standalone-instrumentation.mjs
```

### Key Patterns

**API Route Authentication**: Four layered helper modules cover the common shapes:

- `src/lib/auth-helpers.ts` — `getAuthenticatedUser(request)` for session check, `getGitHubToken(userId)` for reading the GitHub OAuth token (sourced from Better Auth's `account` table — the old `users.github_access_token` column was dropped in migration 0017).
- `src/lib/api-handler.ts` — `withAuth` / `withValidation` wrappers that bundle session check + Zod body parse + structured error responses. Prefer these for new session-based routes. Throw `ApiError(status, message, code)` inside a handler to surface a structured error.
- `src/lib/api-key-route.ts` — `createApiKeyRoute({ column, prefix, label })` factory for the POST/DELETE pair that generates or revokes a prefixed API key on `users`. Used by OwnTracks, Toss, and health-import key routes; WakaTime stays hand-written because it also verifies + kicks off an initial sync.
- `src/lib/api-auth.ts` — hardening for public ingestion endpoints reachable by API key (OwnTracks, Toss, health-import). Exposes `verifyApiKey()` (DB probe + `timingSafeEqual`), `enforceRateLimit()` (in-memory 60 req / 60s per key+IP), `checkBodySize()`/`bodyExceedsLimit()` (10 KB default cap), `checkSameOrigin()`, and `logIngestionFailure()`. All ingestion routes must pass the request through these before touching DB state. `/api/health-import` deliberately raises its own cap to 2 MB because it is a batched push of the user's own history.

```typescript
// Auth-only routes
const { user, error } = await getAuthenticatedUser(request);
if (error) return error;

// Or wrapper-style
export const GET = withAuth(async ({ user, request }) => { ... });
export const POST = withValidation(Body, async ({ user, body }) => { ... });

// GitHub-backed routes
const accessToken = await getGitHubToken(user.id);
```

**Third-party OAuth (Withings, Google Health)**: both providers use the shared stateless `state` codec in `src/lib/oauth-state.ts` (wrapped per provider by `withings-oauth-state.ts` / `google-oauth-state.ts`). State is an HMAC-SHA256-signed `userId + nonce + expiry` (10 min TTL) with the key derived from `KIS_ENCRYPTION_KEY` plus a **distinct per-provider context string** — one provider's state must never verify against another's callback. That isolation is a security invariant covered by cross-verify tests; keep the contexts unique when adding a provider. Access/refresh tokens are AES-256-GCM encrypted via `src/lib/crypto.ts`. Google refresh tokens do **not** rotate, so a refresh response that omits one must preserve the stored token; Withings rotates them. Both connections flip `status` to `needs_reauth` only on a *confirmed* auth failure so transient errors don't force re-linking.

**Adapter Pattern**: `lib/adapters/` groups external-service clients. Geocoding, overpass, google-health, withings, and kis expose an `interface.ts`; ai, vcs, and wakatime intentionally merged their types into the impl file (`claude.ts`, `github.ts`, `wakatime.ts`) and are imported as concrete factories. Follow the `interface.ts` style only when a second implementation or a test double is actually needed:
- `geocoding/interface.ts` — implemented by `kakao.ts` (Korea), `google.ts` (Google Places), `mapbox.ts` (international); auto-selected by coordinates in `index.ts`
- `overpass/interface.ts` — OSM subway lines/stations per city (`SEED_CITIES` lists bbox-defined seed systems; `colour.ts` normalizes line colors)
- `kis/kis.ts` — KIS client (`kis/interface.ts` is a re-export barrel). `tr-ids.ts` enumerates KIS transaction IDs; `types.ts` covers raw payload shapes
- `withings/withings.ts` — Withings Measure API (`measure-types.ts` maps numeric measure codes to typed body-composition fields)
- `google-health/google-health.ts` — Google Health API `list` + `dailyRollUp`, plus the OAuth authorize/token exchange

**Module Organization**: Features in `src/modules/` follow:
- `hooks.ts` - React hooks for client-side data fetching
- `service.ts` - Server-side business logic and DB operations
- `components/` - Feature-specific UI components

**Database Access**: `getDb()` from `src/db/index.ts` returns a lazy-initialized Drizzle ORM singleton over a `pg.Pool`. Import schema tables and types alongside it:
```typescript
import { getDb, users, commits, commitSummaries, syncJobs } from "@/db";
const db = getDb();
```

**Database Schema** (39 app tables in `src/db/schema.ts`, plus 4 Better Auth tables: `user`, `session`, `account`, `verification`):

*Core / GitHub*
- `users` - Extended user data with `ownTracksApiKey`, `tossNotificationApiKey`, `tossMyName`, `healthImportApiKey`, `wakatimeApiKey`, `lastLat`/`lastLon`, `syncIntervalHours` (UUID PK, references Better Auth `user.id`)
- `commits`, `commitSummaries` (status: pending/processing/completed/failed), `syncJobs` (status: fetching/summarizing/completed/failed)

*Location*
- `locationPoints` - OwnTracks GPS data. Indexes on `(userId, timestamp)`, unique on `(userId, timestamp, lat, lon)`
- `placeCache` - Geocoding cache, unique on `(latKey, lonKey)`
- `savedPlaces`, `dailyDistances`
- `visits` - Persisted stay points with reverse-geocoded placeName/address/city/countryName, optional `savedPlaceId`
- `tracks` - Movement journeys between visits; `transportationSegments` - fine-grained mode segments; `trips` - multi-day travel detection (`autoDetected` distinguishes cron-detected from user-created)
- `locationHeatmapDaily` - Per-KST-day point counts on a 3-decimal lat/lon grid, unique on `(userId, date, lat, lon)`. Precomputed so `/overview` never scans raw `location_points`
- `locationProcessingDays` - **Durable** per-day pipeline marker (`processing`/`completed`/`failed` + `attemptCount`/`lastError`), unique on `(userId, date)`. Unlike the `anomaly` stamp on `location_points` it records successful *empty* days and survives a restart after a post-anomaly stage fails, and it is the watermark the overview precompute reads to decide whether an ended period may finalize
- `subwaySystems` (PostGIS `bbox` Polygon), `subwayLines` (MultiLineString), `subwayStations` (Point), `subwayTripMatches`

*Coding*
- `codingSessions`, `codingDailyStats` (WakaTime)

*Money*
- `notificationLogs` - Raw Toss/MacroDroid push payloads
- `transactions` - Parsed Toss transactions, unique on `(userId, notificationLogId)`. Also carries the AI categorization columns (`category`, `categorySource`, `categoryConfidence`, `categoryModel`, `categoryAttempts`, `categoryError`, `categorizedAt`)
- `accountRoles` - Per-user classification of Toss account names as `spending`/`default`/`ignore`
- `brokerageAccounts` - Linked KIS accounts with **encrypted** `appKeyEnc`/`appSecretEnc`, cached `accessToken`, `openedAt`, and `executionsBackfilledFrom`/`pnlBackfilledFrom` watermarks
- `holdingSnapshots` (unique `(accountId, asOfDate)`), `holdingPositions`, `brokerageExecutions` (unique `(accountId, odno, ordDt)`), `brokerageDailyPnl`, `brokerageTargetAllocations`

*Body & Health*
- `withingsConnections` - One row per user; encrypted tokens, `lastMeasureUpdate` incremental watermark
- `bodyMeasurements` - One row per Withings measurement group; typed columns for charted metrics plus lossless `rawMeasures` JSON. Unique on `(userId, withingsGroupId)`
- `healthConnections` - One Google Health connection per user; encrypted tokens, `backfillFloor`/`backfillCompletedAt`
- `healthSyncState` - Per-metric watermarks: `syncedThrough` (forward cursor) and `backfilledFrom` (walks history backward). Unique on `(userId, metric)`
- `healthSamples` - Long/narrow intraday series. `value` for scalars, `valueJson` for structured metrics (sleep stages, HRV, SpO2-with-confidence). **`source` is part of the unique key** `(userId, metric, sampleAt, source)` — the same metric is legitimately written by multiple apps, and dropping `source` silently discards one source under `ON CONFLICT DO NOTHING`. `source` is resolved by `sampleSource()` as the Health Connect app package, else the measuring **platform** (Fitbit-native points carry only `dataSource.platform` = `"FITBIT"`, no `application.packageName` — reading the package alone dumped 174k rows into one `"unknown"` bucket, fixed in 0035), else `"unknown"`. Beware that some sources are **re-publishing aggregators, not sensors**: `com.withings.wiscale2` rewrites sessions it read from Health Connect, so read paths must dedup by session identity and prefer the measuring platform (`src/modules/health/sessions.ts`)
- For `heart_rate`, a row is either a raw sample or a **compacted minute bucket** whose `valueJson` carries `{ min, max, n }` — `valueJson IS NULL` is the discriminator (`src/modules/health/compaction.ts`). Anything that aggregates `healthSamples` directly must go through `bucketStats()` or read those bounds in SQL, or a bucket counts as one sample and contributes only its mean, understating daily ranges
- `healthDailySummaries` - Per-**KST**-day rollup derived by bucketing `healthSamples` via `localDaySql` (NOT copied from Google's `dailyRollUp`, whose buckets are Google-server-TZ). Unique on `(userId, metric, day)`
- `healthRawPages` - Verbatim API responses, append-only, never pruned, surfaced per-user in the data-usage card. Cheaper than it looks: highly repetitive JSON compresses hard, so 786k heart-rate points occupied 11 MB here against 287 MB as rows in `healthSamples`. That gap is why minute-bucket compaction is safe — this table stays the verbatim system of record

*Overview (period snapshots)*
- `periodSnapshots` - One row per `(userId, periodType, periodKey)`, unique on that triple. `periodType` is `recent`|`week`|`month`|`year`; `status` is `pending`|`computing`|`ready`|`failed`. Five independent jsonb domain envelopes (`coding`, `location`, `health`, `spending`, `assets`), each carrying its own status so one failing domain doesn't sink the snapshot. Lease columns (`computeStartedAt`/`leaseExpiresAt`/`attemptCount`/`lastError`) drive the claim queue; `computeVersion` invalidates snapshots when aggregation logic changes — bump `OVERVIEW_COMPUTE_VERSION` and every snapshot recomputes
- `periodNarratives` - AI narrative per `(userId, periodType, periodKey)`, unique on that triple, `periodType` excluding `recent`. Same lease shape (`status` `pending`|`generating`|`ready`|`failed`), plus the `model` that produced it

*Meta*
- `dataUsageCache` - Per-user per-table row count and estimated byte size. `estimatedBytes` is **bigint** (0036): it was `integer` until `location_points` reached 75% of int4's 2 GB ceiling, and the per-category `SUM(...)::int` in `insights/service.ts` would have thrown `integer out of range`. Cast byte sums to `::bigint`, never `::int`

PostGIS is set up by migration `0013_postgis_setup.sql`; location tables use `doublePrecision` lat/lon, while the `subway*` tables (0019/0020) use real PostGIS `geometry` columns. Migration 0018 introduced and 0020 dropped a short-lived `fog_cells_cache` table — fog-of-war was removed (commit `a3df73a`), so don't reintroduce it. 0021 `account_roles`; 0022 brokerage tables; 0023 target allocations; 0024 backfill watermarks; 0025 transaction category columns; 0026 Withings; 0027 health; 0028 added `health_samples.source` to the unique key; 0029 `users.health_import_api_key`; 0030 `period_snapshots`; 0031 `location_heatmap_daily`; 0032 `location_processing_days`; 0033 `period_narratives`; 0034 saved-place trip exclusions + `trips.auto_detected`; 0035 relabelled Fitbit-native `health_samples.source` from `'unknown'` to `'FITBIT'` (data-only; must stay paired with the `sampleSource()` parser change, since `source` is part of the sample identity); 0036 widened `data_usage_cache.estimated_bytes` to bigint; 0037 tuned `location_points` autovacuum (scale factor 0.2 → 0.02 — the daily `SET anomaly` rewrite can never be HOT because `anomaly` sits in the `idx_location_points_not_anomaly` predicate, so the table accumulated 15% dead tuples before ever crossing the default threshold); 0038 dropped `idx_location_points_lonlat` — zero scans over the DB's whole life, because `lonlat` is only ever read as `ST_Distance(lonlat, LAG(lonlat))`, which a GiST index cannot serve. The column and its `set_lonlat` trigger stay; recreate the index if a real spatial predicate is ever added.

`location_velocity_migration_20260710_backup` is a leftover backup table from a one-off data fix, not part of the schema — don't build on it.

**Better Auth Setup** (`src/lib/auth.ts`, `auth-client.ts`, `auth-helpers.ts`):
- Server: `betterAuth()` with `pg.Pool`, GitHub OAuth, cookie cache (5min), UUID ID generation
- Client: `createAuthClient()` exports `signIn`, `signOut`, `useSession`
- API catch-all route: `src/app/api/auth/[...all]/route.ts` handles login, callback, session, signout
- Database hook: `session.create.after` syncs GitHub user data to app `users` table on each sign-in
- The GitHub access token lives **only** in Better Auth's `account` table; `getGitHubToken(userId)` is the single accessor. The cron worker filters users via `EXISTS (SELECT 1 FROM account WHERE providerId = 'github' AND accessToken IS NOT NULL)` rather than reading a column on `users`

**Sync Strategy** (`src/modules/sync/service.ts`):
- Uses `getAllRepoCommits()` which iterates `/user/repos` + `/repos/:owner/:repo/commits`
- Initial sync: last 3 months of commits. Regular sync: since `lastSyncedAt` (fallback: 7 days). Both flows use shared `_executeSyncCommits()`
- Deduplication via SHA batch lookup (batch size: 500); 100ms delay between commit saves

**Cron Jobs** (`src/lib/cron.ts` registers every schedule; some bodies live with their feature — `src/lib/trip-detection-cron.ts`, `src/modules/location/cron-processing.ts`, `src/modules/overview/cron.ts`) — all registered with an explicit `timezone: "Asia/Seoul"`. Do **not** drop that option and rely on the container `TZ`: node-cron falls back to an Intl lookup that needs tzdata, which Alpine images often lack, silently resolving to UTC.

| Schedule | Job | What it does |
|---|---|---|
| `*/10 * * * *` | `syncAllUsers` | Per-user commit sync (gated by `syncIntervalHours`), pending AI summaries (20/user), WakaTime sync, Withings sync (24h-gated), Google Health forward sync + `backfillPendingConnections`, KIS portfolio sync + `backfillPendingAccounts`, data-usage refresh, deletes sync jobs older than 7 days |
| `*/10 * * * *` | `categorizePendingSpending` | AI expense categorization of uncategorized transactions (100/user, Haiku) |
| `0 23 * * *` | `reparseTodayNotifications` | Reparses today's Toss notifications to pick up parser improvements |
| `*/5 * * * *` | `precomputeOverviewSnapshots` → `generateOverviewNarratives` | Claims leased `period_snapshots` rows and publishes them, then generates pending `period_narratives`. 5 minutes so UI-triggered recompute lands inside the client's ten-minute poll window |
| `0 1 * * *` | `processYesterdayLocations` | Full location pipeline for the previous KST day, then rebuilds that day's heatmap and chains straight into `precomputeAfterLocation` |
| `15 * * * *` | `processYesterdayLocations` (catch-up) | Hourly safety net — re-uses the same day-selection scan, so it's an empty-set query when there's no backlog. Exists because a single missed daily tick (crash/deploy) used to mean 24h of unprocessed data |
| `0 2 * * 0` | `runTripDetection` | Weekly rolling-window trip detection (date-range op, can't live in the per-day loop) |
| `0 4 * * *` | `compactHealthSamples` | Compacts settled `heart_rate` rows into per-minute buckets (7 days/run, **newest first**, never touching anything under `RAW_RETENTION_DAYS`). Newest-first because density is uneven — an oldest-first walk spent its first week on sparse Samsung-era days while half the remaining rows sat in the 13 most recent Fitbit days at the back of the queue. Daily rather than in the 10-min loop because it only ever touches ranges the sync has finished with; 04:00 keeps the heavy DELETE/INSERT clear of the 01:00 location and 03:00 subway windows |
| `0 3 1 1 *` | `runSubwayRefresh` | Yearly OSM subway refresh, plus a boot catch-up for any system older than ~350 days |

Every job has a module-level single-flight boolean guard. `seedSubwaySystemsIfEmpty()` runs on every boot and is idempotent. Boot-time catch-up also runs location processing and overdue commit sync so a long outage auto-heals; `RUN_ON_START=true` forces an immediate `syncAllUsers`.

**Cron Initialization**: `instrumentation.ts` (project root, not `src/`) uses the Next.js instrumentation hook to call `initializeCron()` on server boot. Only runs under `NEXT_RUNTIME === 'nodejs'`, and is **skipped entirely when `DISABLE_CRON=true`**. In production the web and cron workloads are separate containers built from the same image: the web container sets `DISABLE_CRON=true`, and a dedicated cron container (no published port) leaves it unset. This split exists because cron jobs (AI summaries, location/subway processing) do multi-second synchronous CPU work that blocks the Node event loop — running them in the web process stalled all HTTP requests. **Don't move background jobs back into the web container.** Note: the ingestion rate limiter (`src/lib/api-auth.ts`) and the cron single-flight guards are in-memory, single-process state — scaling either container beyond one replica multiplies the effective rate-limit quota and breaks the guards; use a shared store (or pg advisory locks, as KIS sync already does) before adding replicas. `instrumentation.ts` also initializes Sentry and registers SIGINT/SIGTERM shutdown handlers.

**Location Tracking & Processing** (`src/modules/location/services/`):
- OwnTracks app sends GPS data to `/api/owntracks?apikey={key}` (returns `[]` per OwnTracks protocol)
- On-demand stay-point detection for client views: clusters points within 100m radius, minimum 10-minute stay
- Persisted `visits`/`tracks`/`transportationSegments` are computed by the daily 01:00 cron (`src/modules/location/cron-processing.ts`) and exposed via `/api/timeline/locations/*` and insights endpoints
- Pipeline stages: `anomaly-filter` → `visit-detector`/`visit-persister` → `track-builder`/`track-persister` → `transportation/detector` → `subway-match` (matches segments against `subway_lines` PostGIS geometry, groups transfers into sessions) → `subway-discovery` (probes Overpass for new cities, capped at 3/run). `trip-detector` + `/api/trips/detect` group visits into multi-day trips (overseas detection included). `backfill-orchestrator.ts` drives the re-run path
- **"Has this day been processed?" lives in `locationProcessingDays`, not in `locationPoints.anomaly`.** A day is settled when it has a `completed` row whose `pointCount` still equals the day's current point count; a mismatch (or a missing row) makes it a candidate again, which is what catches points OwnTracks flushes late for an old day. `anomaly` is now purely a quality flag — `true` for anomalous points, NULL otherwise — and every reader tests `anomaly IS NOT TRUE`. Stamping clean points `false` used to rewrite ~98% of each day's rows per run, and since `anomaly` sits in the predicate of `idx_location_points_not_anomaly` none of it could be heap-only. A **count**, not a timestamp, is compared on purpose: `locationPoints.createdAt` is UTC wall time while `locationProcessingDays.completedAt` is KST wall time
- Each day's run is bracketed by a `location_processing_days` row and reports a `failedStage` of `state`|`anomaly`|`visits`|`tracks`|`heatmap`. That row — not the `anomaly` stamp — is the durable "this day is done" signal, and `/overview` refuses to finalize an ended period until it covers the period's end date. A day marked `failed` therefore blocks period finalization rather than silently publishing a partial snapshot
- Trip writes go through `trip-writer.ts`'s advisory-lock wrapper, since detection runs from the weekly cron, `/api/trips/detect`, `/api/settings/trip-regenerate` and the backfill orchestrator
- Geocoding auto-selects Kakao (Korean coordinates), Google Places, or Mapbox (international); results cached in `placeCache`
- Location hooks poll every 60 seconds when viewing today's date

**Health & Body**:
- **Google Health (Fitbit)** — `src/modules/health/service.ts`. `HEALTH_METRICS` is a per-metric config table (dataType, camelCase `wrapper` key, `timeShape` of `interval` vs `sampleTime`, snake_case `filterField`) ground-truthed against live payloads by the U1 spike in `docs/health/google-health-spike-findings.md`. Only metrics whose exact shape was verified are enabled; values arrive as strings *or* numbers. Sync is bidirectional: a forward incremental cursor (`syncedThrough`) plus a backward historical walk in bounded 14-day chunks (4 chunks/run) so one cron tick never pages unbounded history in a single event-loop stretch. The backward walk stops on a presence probe rather than the first empty chunk, because real data has 80+ day gaps for sparse metrics like SpO2/VO2max.
- **Sessions (`sleep` / `exercise`)** — synced by `syncSessions`, unfiltered and newest-first, because both reject every `list` filter. They have no `healthSyncState` row and no backfill: the unfiltered read already reaches all history. They also skip `healthDailySummaries` (a night is a hypnogram, not a daily average), so they are read straight from `healthSamples` — which means the multi-source dedup that `recomputeDailySummaries` gives scalars for free has to be applied at **read** time via `src/modules/health/sessions.ts`. It keys on the start **second**, not the exact instant: an aggregator republished the same workout 389 ms apart, which an exact-timestamp key read as two sessions and double-counted.
- **Compaction** — `src/modules/health/compaction.ts` buckets settled `heart_rate` rows by minute (see the `healthSamples` note above). Compacts *closed* ranges out of stored rows rather than bucketing at ingest: a sync window can end mid-minute, so ingest-time bucketing builds one bucket twice from partial data, and an associative merge there breaks idempotency because a re-fetched window double-counts `n`. Here the contributing raw rows are deleted in the same transaction, so the merge can't double-count.
- **On-device import** — `/api/health-import?apikey={key}` (`src/modules/health/import.ts`) ingests raw Health Connect records pushed by a phone automation, backfilling sleep/exercise that Google's cloud sync does not carry — Google's cloud never held the Samsung-era sleep sessions at all, so this endpoint is the only route to that history. Idempotent via `onConflictDoNothing` on the `(userId, metric, sampleAt, source)` key. Its payload is raw Health Connect shape (epoch-millis times, numeric stage codes), distinct from the cloud shape; `src/modules/health/sleep.ts` normalizes both. `pickSource` falls back to `'healthconnect'`, never `'unknown'` — which is what makes `source = 'unknown'` a safe proxy for "cloud-path, unattributed". `GET /api/health-import` is a session-authed verification view.
- **Withings** — `src/modules/withings/service.ts` syncs measurement groups incrementally off `lastMeasureUpdate`; display formatting is centralized in `src/lib/body-format.ts` so insights and reports never diverge.
- **Privacy**: `src/lib/sentry-scrub.ts` is wired into `sentry.server.config.ts`'s `beforeSend`/`beforeSendTransaction` and drops raw health payloads (URL markers, breadcrumb data, denylisted `extra` keys). Any new field carrying health values must be added to its denylist.

**Overview** (`src/modules/overview/`) — the unified reporting surface, and the piece most likely to surprise you:
- `/overview?periodType=&periodKey=` renders one of four period types (`recent`|`week`|`month`|`year`). `/insights`, `/report` and `/report/comparison` are **redirect-only shims**: `legacy-routes.ts` maps their old query params onto overview params. Don't add UI to those pages — they render nothing
- Their **API** routes are not deprecated, though. `modules/insights` still backs `/api/insights`, the `/health` page and several overview cards; `modules/report` still backs `/api/reports/*` and `location/services/trip-naming`. Neither module is dead code — only the two pages are
- Reads never aggregate on demand. `GET /api/overview` returns a stored `period_snapshots` row, or a `missing`/`pending`/`computing` status that the client polls on. `POST /api/overview/recompute` enqueues (202) and is same-origin-checked, capped at `OVERVIEW_OUTSTANDING_LIMIT` (5) outstanding requests per user
- `precompute.ts` is a leased work queue, not a loop: `recoverExpiredLeases` → `seedActivePeriods` → `claimSnapshots` (10-min lease, 5 per run, 3 attempts, 250 users per page) → `publishSnapshot`. Every publish is conditional on still holding the lease, so a second worker can't clobber a first
- **Active periods refresh freely; ended periods only finalize once `location_processing_days` covers their end date** (`deferredForLocation` in the run result). An ended month finalized before its last day's location pipeline landed would freeze a permanently wrong number
- `aggregate/` computes the five domains (`coding`, `location`, `health`, `spending`, `portfolio`) into independent envelopes; a domain that throws is stored `failed` while the others publish
- `narrative.ts` generates the AI narrative for non-`recent` periods on the same lease pattern (batch 5, 3 attempts, 8-min lease). Input is truncated to `NARRATIVE_MAX_INPUT_CHARS` (24k) by progressively dropping detail, and the producing model is recorded on the row
- `OVERVIEW_RETENTION_PERIODS` (45 recent, 104 week, 60 month, 10 year) bounds how far back a period may be requested or recomputed — a key older than the boundary, or newer than the current one, is rejected rather than queued

**Travel** (`src/modules/travel/`):
- `/travel` lists trips (cursor-paginated on `(endDate, startDate, id)`) and `/travel/[tripId]` shows one, joining visits, commits, coding, spending and health for the trip window
- `POST /api/trips/[id]/not-a-trip` is the correction path for a false positive: rather than just deleting the trip, `not-a-trip.ts` creates a `savedPlaces` exclusion around the trip's dominant visit (10 km radius, or 100 m when pinned to an existing saved place) so auto-detection stops re-detecting it on the next weekly run

**Toss Transaction Tracking**:
- MacroDroid forwards Toss push notifications to `/api/toss-notifications?apikey={key}`
- Raw notification stored in `notificationLogs`, then parsed by `src/modules/transaction/parser.ts` (type, amount, merchant, account name)
- Deduplication: unique constraint on `(userId, notificationLogId)` plus a ±2 minute time-window duplicate check
- Daily 23:00 reparse picks up notifications that failed with older parser versions
- Categorization is a separate async pass: `src/modules/spending/category-classifier.ts` batches 25 transactions per Haiku call into the fixed `EXPENSE_CATEGORIES` list (`categories.ts`), records confidence/model/attempts, and never blocks ingestion

**KIS Brokerage Portfolio** (`src/modules/portfolio/`):
- `service.ts` (`PortfolioSyncService`) drives KIS sync: daily `holdingSnapshots`/`holdingPositions`, `brokerageExecutions`, `brokerageDailyPnl`. Access tokens cached on `brokerageAccounts` and refreshed lazily (60s grace); app key/secret AES-256-GCM encrypted via `src/lib/crypto.ts`
- `backfillPendingAccounts()` walks each account back to `openedAt`, advancing the backfill watermarks so it's idempotent and resumable across cron runs (also exposed as `/api/portfolio/accounts/[id]/backfill`)
- `returns.ts` computes TWR over `tot_evlu_amt` **alone** — KIS `tot_evlu_amt` already includes the cash deposit, so adding `deposit` on top double-counts every external deposit as fake gain. It infers cashflows from deposit deltas reconciled against a **T+2 business-day settlement** model and anchors every account's series to the `RETURNS_EPOCH` of `2026-05-12` (earlier snapshots include pre-settlement receivables that inflate the baseline)

**Logging**: `src/lib/logger.ts` wraps Better Stack (Logtail) with `info`, `warn`, `error`, `flush`. Falls back to console when `BETTER_STACK_SOURCE_TOKEN` is not set.

### API Routes

- `/api/auth/[...all]` - Better Auth catch-all; `/api/auth/disconnect` - DELETE account
- `/api/settings` - GET/PUT settings; `/api/settings/{owntracks-key,wakatime-key,toss-key,health-import-key}` - POST/DELETE API keys; `/api/settings/wakatime-sync` - manual sync; `/api/settings/data-usage`; `/api/settings/db-benchmark`; `/api/settings/location-backfill` - GET dry-run / POST re-run pipeline (SSE); `/api/settings/subway-match-backfill`; `/api/settings/transportation-reclassify`; `/api/settings/trip-regenerate`; `/api/settings/account-roles`
- `/api/sync` - POST manual sync; `/api/sync/status`; `/api/sync/jobs`
- `/api/timeline` - GET paginated commits; `/api/timeline/{repos,stats,current-activity}`; `/api/timeline/commits/[commitId]{,/stats,/summary}`; `/api/timeline/locations{,/stay-points,/distances,/tracks,/import}`; `/api/timeline/{coding-sessions,coding-stats}`
- `/api/trips` - GET/POST; `/api/trips/[id]` - PUT/DELETE; `/api/trips/detect` - POST auto-detect; `/api/trips/[id]/not-a-trip` - POST false-positive correction (creates a saved-place exclusion); `/api/trips/[id]/route-points` - GET map route
- `/api/overview` - GET stored period snapshot (`?periodType=&periodKey=`); `/api/overview/recompute` - POST enqueue (202, same-origin); `/api/overview/narrative` - GET narrative / POST enqueue generation
- `/api/insights` - GET. No `section` param returns all 18 sections in one batched single-transaction response; `?section=` fetches one of streaks|patterns|routines|digests|commit-heatmap|subway|swimlane|ai-clock|commute-reliability|place-productivity|trips|transport-modes|visits-x-commits|net-spend|repo-split|data-usage|discoveries|body
- `/api/reports/{monthly,yearly}` - GET report data (`?section=`); POST AI narrative. `/api/reports/{comparison,scratch-map,subway-usage}`
- `/api/summaries/process` - POST batch summary generation
- `/api/owntracks` - POST location ingestion (API key)
- `/api/toss-notifications` - POST Toss notification ingestion (API key, via MacroDroid)
- `/api/health-import` - POST Health Connect ingestion (API key) / GET verification view (session)
- `/api/fitbit` - DELETE disconnect Google Health; `/api/fitbit/{authorize,callback}` - OAuth; `/api/fitbit/sync` - POST manual sync; `/api/fitbit/summary` - GET 30-day trends, sleep sessions, workouts (powers `/health`); `/api/fitbit/activity-correlation` - GET 14-day health × coding × visits correlation
- `/api/withings` - DELETE disconnect; `/api/withings/{authorize,callback}` - OAuth
- `/api/map/subway` - GET lines/stations for map rendering (viewport bbox filtered)
- `/api/saved-places` - GET/POST; `/api/saved-places/[id]` - PUT/DELETE; `/api/saved-places/search`
- `/api/spending` - GET analytics; `/api/spending/trend`; `/api/spending/reparse`; `/api/spending/transactions/[transactionId]` - DELETE; `/api/spending/notifications{,/cleanup}`
- `/api/portfolio/accounts{,/[accountId]{,/sync,/backfill,/targets}}`; `/api/portfolio/{snapshots,executions,summary,returns,sync}`
- `/api/health` - GET liveness check (`{status:"ok"}`, used by the Jenkins health-check stage). **Not** the health/fitness API — that's `/api/fitbit/*`

### Environment Setup

Required env vars (in `.env.local`; see `.env.example`):
```bash
DATABASE_URL=postgresql://...         # Required, no fallback
BETTER_AUTH_SECRET=...               # Session signing secret
BETTER_AUTH_URL=https://your-domain.com
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

Optional:
```bash
NEXT_PUBLIC_MAPBOX_TOKEN=pk...       # Map visualization (server code also accepts MAPBOX_ACCESS_TOKEN)
KAKAO_REST_API_KEY=...               # Korean geocoding
GOOGLE_MAPS_API_KEY=...              # Google Places geocoding
BETTER_STACK_SOURCE_TOKEN=...        # Structured logging via Logtail
NEXT_PUBLIC_SENTRY_DSN=...           # Sentry error tracking
KIS_ENCRYPTION_KEY=...               # ≥32 chars. Master key for AES-256-GCM encryption of KIS app
                                     # key/secret AND Withings/Google Health tokens, and the HMAC
                                     # root for OAuth state. Rotating it invalidates every stored
                                     # credential and in-flight OAuth state
WITHINGS_CLIENT_ID=... / WITHINGS_CLIENT_SECRET=...   # Withings OAuth
FITBIT_CLIENT_ID=... / FITBIT_CLIENT_SECRET=...       # Google Health OAuth (named "Fitbit" throughout the UI/routes)
IMPORT_MAX_FILE_SIZE_MB=500          # Cap for /api/timeline/locations/import
ENABLE_DB_BENCHMARK=true             # Gate /api/settings/db-benchmark
NEXT_PUBLIC_ENABLE_DB_BENCHMARK=true # Show the matching UI card
DISABLE_CRON=true                    # Set on the production web container only
RUN_ON_START=true                    # Immediate sync on boot (cron-enabled processes only)
```

### Database Operations

1. Modify `src/db/schema.ts`
2. `yarn db:generate` to create migration files in `drizzle/` — review the generated SQL before committing
3. `yarn db:migrate` to apply to PostgreSQL (local dev)

Drizzle config loads env from `.env.local` (not `.env`). Fallback `DATABASE_URL` for local dev: `postgresql://cistory:cistory@localhost:5432/cistory`.

CI/production uses `scripts/migrate.ts` (`npx tsx scripts/migrate.ts`) rather than `drizzle-kit migrate`. That script sets `lock_timeout=60s` and `statement_timeout=2m` at the connection level so a stuck `__drizzle_migrations` lock fails the build fast instead of hanging Jenkins. Jenkins additionally kills stale `idle in transaction` sessions on `drizzle`/DDL queries before starting a run.

### CI/CD & Deployment

- **Jenkins pipeline** (`Jenkinsfile`): GitHub webhook → **Test** (`docker build --target tester`, whose `RUN yarn test` fails the build on any Vitest failure, before the image is built) → Docker build → Drizzle migrations (separate `migrator` stage container) → deploy web + cron containers → health check against `/api/health` (15 attempts, 5s interval) → Telegram notification. Everything from Run Migrations onward is gated on `when { branch 'main' }`, so PR builds test and build but never deploy.
- **Docker** (`Dockerfile`): multi-stage on Node 22 Alpine — `base → deps → builder → tester → migrator → runner`. `.env` mounted as a build secret; only `NEXT_PUBLIC_*` vars are extracted for the build. Runs as non-root `nextjs` (UID 1001), using `output: "standalone"` from `next.config.ts`
- **Web/cron container split**: the same image runs twice — web (`cistory`, port 3000, `DISABLE_CRON=true`) and cron (`cistory-cron`, no published port). Jenkins stops/removes both on each deploy
- **Docker Compose**: `cistory` + `cistory-cron` + `postgis/postgis:17-3.5-alpine` with external volume `cistory_postgres_data`
- **Timezone**: production containers run with `TZ=Asia/Seoul` (KST, UTC+9)
- Jenkins cleanup keeps only the last 3 image tags

## Code Style

- **Biome** for linting/formatting (`biome.json`); auto-organizes imports
- Formatting: 2-space indent, double quotes, semicolons, trailing commas (ES5), 100 char line width
- Lint: unused imports are errors, unused variables are warnings, `useImportType` enforced, `noNonNullAssertion` off, `noExplicitAny` warn, `noExcessiveCognitiveComplexity` warn, `useExhaustiveDependencies` warn
- Naming: PascalCase React components (`LocationMap.tsx`), `useCamelCase` hooks, camelCase functions/variables, Next.js `page.tsx`/`route.ts`
- Path alias: `@/*` maps to `./src/*`
- Prefer Drizzle ORM query builder (avoid raw SQL); keep feature logic in its module and shared infrastructure in `src/lib`
- Follow Next.js App Router conventions (Server Components by default)
- Korean language used for user-facing strings in API responses and UI
- Commits follow Conventional Commit subjects (`feat:`, `fix:`, `test:`, `perf:`, `docs:`, and scoped forms like `fix(security):`). Run `yarn test`, `yarn lint`, and `yarn build` before opening a PR; update `.env.example` when introducing configuration
- **Date parsing**: Never use `new Date("YYYY-MM-DD")` for date-only strings — ECMAScript parses this as UTC midnight, so "2026-03-04" becomes March 3rd 15:00 KST. Canonical helpers in `src/lib/utils.ts`: `parseDateLocal()`, `toLocalDateString()`, `startOfLocalDay()`/`endOfLocalDay()`, `parseDateParam()`. Never derive a date key with `date.toISOString().split("T")[0]` — that is the UTC day, which shifts 00:00–09:00 KST activity onto the previous day; use `toLocalDateString()`
- **Timestamps in SQL**: `timestamp` (without time zone) columns store **UTC wall time** (Drizzle serializes via toISOString on write). Deriving a KST calendar day in SQL therefore requires `(col AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date` — helpers in `src/db/sql.ts` (`localDaySql`, `localDayRawSql`). Both `DATE(col)` and `col AT TIME ZONE 'Asia/Seoul'` are wrong (they yield the UTC day)
- **…but `now()` does NOT follow that convention.** In raw `sql`, a bare `now()` (and any DB `DEFAULT now()`) is cast timestamptz→timestamp using the **session** timezone, and this server's default is `Asia/Seoul` (`pg_settings.source = 'configuration file'`; the pool sets no timezone). Such a value lands as **KST wall time**, 9 hours off from everything Drizzle writes. Two columns written by one operation can therefore sit exactly 9h apart and both be correct — check `information_schema.columns.column_default` before calling such a gap a bug. In raw writes bind a JS Date via `timestampParam(column, date)` and read raw results back through `timestampFromDriver` (both in `src/db/sql.ts`, added by `7790bb5`/`671aa1a` after this bit the overview module; the health rollup was fixed the same way). The ~23 columns still carrying `DEFAULT now()` remain on the KST convention — nothing reads them, and changing them needs a backfill
