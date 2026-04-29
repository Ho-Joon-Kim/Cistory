# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cistory is a personal life-logging application that syncs GitHub commits with AI-powered summaries, tracks location via OwnTracks (with visit/track/transport-mode/trip/subway detection), monitors coding activity via WakaTime, and logs Toss financial transactions via MacroDroid push notifications. Built with Next.js 16, Better Auth (GitHub OAuth), Drizzle ORM with PostgreSQL (PostGIS), and the Anthropic SDK. Includes comprehensive monthly/yearly reports and an "insights" dashboard with AI narratives, map visualization (Mapbox/Kakao), OSM subway data via Overpass, and automatic background sync via an integrated Cron worker, with Sentry error tracking and Better Stack structured logging.

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

# Production
yarn start             # Start production server (binds to 0.0.0.0, includes Cron)
```

No test infrastructure is currently configured.

Package manager is **Yarn 4** (Berry, via Corepack, node-modules linker). Use `yarn` for all package operations.

## Architecture Overview

### Core Stack
- **Next.js 16** (App Router) with Turbopack
- **TypeScript 5** (strict mode)
- **Better Auth** - Authentication (GitHub OAuth) with cookie-based sessions
- **Drizzle ORM** - Type-safe PostgreSQL access via `pg.Pool` singleton (PostGIS-enabled PostgreSQL in production)
- **Anthropic SDK** - Claude AI for commit summaries (`claude-sonnet-4-20250514`)
- **shadcn/ui** + **Tailwind CSS v4** - UI components and styling
- **Biome** - Linter and formatter (replaces ESLint + Prettier)
- **node-cron** - Background sync within Next.js process
- **Mapbox GL** + **react-map-gl** - Map visualization for location tracking
- **Sentry** (`@sentry/nextjs`) - Error tracking (server, client, edge configs)
- **Better Stack** (`@logtail/node`) - Structured logging via `src/lib/logger.ts`

### Project Structure

```
src/
├── app/                      # Next.js App Router
│   ├── (auth)/              # Auth route group (login, callback)
│   ├── (dashboard)/         # Dashboard route group (settings, repositories, spending)
│   ├── api/                 # API routes (14 top-level groups, ~50+ endpoints)
│   ├── dashboard/           # Main dashboard page
│   ├── insights/            # Insights dashboard (places, transportation, residency, etc.)
│   └── report/              # Monthly/yearly report pages
├── components/              # Shared components (Layout/, ui/ with 19 shadcn components)
├── db/
│   ├── schema.ts            # Drizzle schema (16 app tables)
│   └── index.ts             # Database singleton (throws if DATABASE_URL unset)
├── lib/
│   ├── adapters/            # Adapter pattern interfaces + implementations
│   │   ├── ai/             # AI adapter (interface.ts + claude.ts)
│   │   ├── geocoding/      # Geocoding adapter (kakao.ts, mapbox.ts, google.ts, index.ts)
│   │   ├── overpass/       # OSM Overpass adapter for subway lines/stations (interface.ts, index.ts, colour.ts, seed-cities.ts)
│   │   ├── vcs/            # VCS adapter (interface.ts + github.ts)
│   │   └── wakatime/       # WakaTime adapter (interface.ts + wakatime.ts)
│   ├── auth.ts              # Better Auth server config (GitHub OAuth, session, DB hooks)
│   ├── auth-client.ts       # Better Auth client (signIn, signOut, useSession)
│   ├── auth-helpers.ts      # getAuthenticatedUser() and getGitHubToken() for API routes
│   ├── cron.ts              # Cron service (auto-sync commits, summaries, WakaTime, Toss reparse)
│   ├── data-usage.ts        # Data usage cache refresh utility
│   ├── geo.ts               # Geospatial utilities (Haversine distance)
│   ├── hooks/               # Shared React hooks (usePageVisible)
│   ├── logger.ts            # Structured logging (Better Stack / console fallback)
│   └── utils.ts             # Shared utilities (cn, generateId, now, formatRelativeTime, etc.)
├── modules/                 # Feature modules (hooks.ts, service.ts, components/)
│   ├── auth/               # Auth hooks (useAuth, useUser)
│   ├── insights/           # Insights dashboard (hooks, service, components)
│   ├── location/           # Location tracking + processing (services/: anomaly-filter, visit-detector, visit-persister, track-builder, track-persister, trip-detector, transportation/, residency, first-visits, time-of-day, countries-cities, import)
│   ├── report/             # Monthly/yearly reports (service, hooks, AI narratives, 20+ chart components, comparison-service, travel)
│   ├── settings/           # User settings (theme, sync interval, OwnTracks/WakaTime/Toss keys)
│   ├── spending/           # Spending data hooks (Toss transactions)
│   ├── subway/             # Subway system seeding + OSM data refresh (service.ts)
│   ├── summary/            # AI commit summary service
│   ├── sync/               # Commit sync service (SyncService class)
│   ├── timeline/           # Timeline display (hooks, CommitCard, Timeline, Filters)
│   ├── transaction/        # Toss notification parser (parser.ts)
│   └── wakatime/           # WakaTime coding activity (service, hooks, components)
instrumentation.ts           # (project root) Initializes Cron + Sentry on server boot
sentry.server.config.ts      # Sentry server config
sentry.client.config.ts      # Sentry client config
sentry.edge.config.ts        # Sentry edge config
```

### Key Patterns

**API Route Authentication**: Three layered helper modules cover the common shapes:

- `src/lib/auth-helpers.ts` — `getAuthenticatedUser(request)` for session check, `getGitHubToken(userId)` for reading the GitHub OAuth token (now sourced directly from Better Auth's `account` table — the old `users.github_access_token` column was dropped in migration 0017).
- `src/lib/api-handler.ts` — `withAuth` / `withValidation` wrappers that bundle session check + Zod body parse + structured error responses. Prefer these for new session-based routes. Throw `ApiError(status, message, code)` inside a handler to surface a structured error.
- `src/lib/api-key-route.ts` — `createApiKeyRoute({ column, prefix, label })` factory for the POST/DELETE pair that generates or revokes a prefixed API key on `users`. Used by OwnTracks and Toss key routes; WakaTime stays hand-written because it also verifies + kicks off an initial sync.
- `src/lib/api-auth.ts` — hardening for public ingestion endpoints reachable by API key (OwnTracks, Toss). Exposes `verifyApiKey()` (DB probe + `timingSafeEqual`), `enforceRateLimit()` (in-memory 60 req / 60s per key+IP), `checkBodySize()` (10 KB cap), `checkSameOrigin()`, and `logIngestionFailure()`. All ingestion routes must pass the request through these before touching DB state.

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

**Adapter Pattern**: Extensible interfaces in `lib/adapters/`:
- `ai/interface.ts` - AI/LLM abstraction (implemented: `claude.ts`)
- `vcs/interface.ts` - VCS abstraction (implemented: `github.ts`)
- `geocoding/interface.ts` - Geocoding abstraction (implemented: `kakao.ts` for Korea, `google.ts` for Google Places, `mapbox.ts` for international; auto-selected by coordinates in `index.ts`)
- `wakatime/interface.ts` - WakaTime coding activity abstraction (implemented: `wakatime.ts`)
- `overpass/interface.ts` - OSM Overpass abstraction for fetching subway lines/stations per city (`SEED_CITIES` lists bbox-defined seed systems; `colour.ts` normalizes line colors)

**Module Organization**: Features in `src/modules/` follow:
- `hooks.ts` - React hooks for client-side data fetching
- `service.ts` - Server-side business logic and DB operations
- `components/` - Feature-specific UI components

**Database Access**: `getDb()` from `src/db/index.ts` returns a lazy-initialized Drizzle ORM singleton over a `pg.Pool`. Import schema tables and types alongside it:
```typescript
import { getDb, users, commits, commitSummaries, syncJobs } from "@/db";
const db = getDb();
```

**Database Schema** (21 app tables in `src/db/schema.ts`, plus 4 Better Auth tables: `user`, `session`, `account`, `verification`):
- `users` - Extended user data with GitHub tokens, `ownTracksApiKey`, `tossNotificationApiKey`, `tossMyName`, `wakatimeApiKey`, `lastLat`/`lastLon`, `wakatimeLastSyncedAt` (UUID PK, references Better Auth `user.id`)
- `commits` - GitHub commit data (sha, message, stats, repo info)
- `commitSummaries` - AI summaries (status: pending/processing/completed/failed)
- `syncJobs` - Sync tracking (status: fetching/summarizing/completed/failed)
- `locationPoints` - OwnTracks GPS data (lat, lon, accuracy, altitude, velocity, battery, timestamp). Indexes on `(userId, timestamp)` and unique on `(userId, timestamp, lat, lon)`
- `placeCache` - Geocoding cache (latKey, lonKey, placeName, address, category, provider). Unique index on `(latKey, lonKey)`
- `codingSessions` - WakaTime coding sessions (duration, project, additions/deletions)
- `codingDailyStats` - Daily aggregated coding statistics (projects, languages, editors, categories)
- `dailyDistances` - Cached daily travel distances
- `savedPlaces` - User-defined named locations with radius, category, icon, color
- `visits` - Persisted stay points (center lat/lon, radius, start/end time, duration, reverse-geocoded placeName/address/city/countryName, optional `savedPlaceId` link). Indexed on `(userId, startTime)` and `(userId, city)`
- `tracks` - Persisted movement journeys between visits (start/end time, distanceMeters, pointCount, start/end place names, dominantMode, elevation gain/loss)
- `transportationSegments` - Fine-grained transport-mode segments (mode: stationary/walking/running/cycling/driving/train/flying/unknown; confidence; avg/max speed; optional `trackId` link)
- `trips` - Travel detection (name, startDate/endDate as "YYYY-MM-DD", visitedCities/Countries JSON, `isOverseas`, `autoDetected`)
- `notificationLogs` - Raw Toss/MacroDroid push notification payloads (source, rawPayload, headers)
- `transactions` - Parsed Toss financial transactions (type: withdrawal/deposit, amount, merchant, accountName). Unique on `(userId, notificationLogId)`
- `dataUsageCache` - Per-user per-table row count and estimated byte size cache
- `subwaySystems` - City-level subway systems with PostGIS `bbox` (Polygon, SRID 4326), seeded idempotently from `SEED_CITIES` and discoverable from user transportation segments
- `subwayLines` - OSM relations per system with `geometry` (MultiLineString, 4326), name/ref/colour/operator. Unique on `(systemId, osmRelationId)`
- `subwayStations` - OSM nodes per system with `location` (Point, 4326). Unique on `(systemId, osmNodeId)`
- `subwayTripMatches` - Links a user's `transportationSegments` row to a matched subway line + start/end station, supporting transfer-aware session grouping

PostGIS is set up by migration `0013_postgis_setup.sql`; the location tables use `doublePrecision` lat/lon columns, while the `subway*` tables (added in migrations 0019/0020) use real PostGIS `geometry` columns and require the extension. Migration 0018 introduced and 0020 dropped a short-lived `fog_cells_cache` table — fog-of-war was removed (see commit `a3df73a`), so don't reintroduce it.

**Better Auth Setup** (`src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/auth-helpers.ts`):
- Server: `betterAuth()` with `pg.Pool`, GitHub OAuth, cookie cache (5min), UUID ID generation
- Client: `createAuthClient()` exports `signIn`, `signOut`, `useSession`
- Auth helpers: `getAuthenticatedUser(request)` reads session via `auth.api.getSession()`, `getGitHubToken()` reads from DB
- API catch-all route: `src/app/api/auth/[...all]/route.ts` handles login, callback, session, signout
- Database hook: `session.create.after` syncs GitHub user data to app `users` table on each sign-in

**Sync Strategy** (`src/modules/sync/service.ts`):
- Uses `getAllRepoCommits()` which iterates `/user/repos` + `/repos/:owner/:repo/commits`
- Initial sync: last 3 months of commits
- Regular sync: since `lastSyncedAt` (fallback: 7 days)
- Both flows use shared `_executeSyncCommits()` private method
- Deduplication via SHA batch lookup (batch size: 500)
- Rate limiting: 100ms delay between commit saves
- Main cron (`*/10 * * * *` — every 10 min): syncs commits per-user `syncIntervalHours`, processes pending summaries (limit 5/user, 1s delay between), syncs WakaTime data, refreshes data usage cache, and auto-deletes sync jobs older than 7 days
- Daily Toss reparse cron (`0 23 * * *` — 23:00 KST): reparses today's Toss notifications to pick up parser improvements
- Daily location-processing cron (`0 1 * * *` — 01:00 KST): for each user with OwnTracks configured, runs anomaly detection, visit detection + persist, track building + persist, transportation-mode detection, then subway matching (`src/modules/location/services/subway-match/{matcher,session-grouper}`) and subway-system discovery (`src/modules/location/services/subway-discovery`, capped at 3 new cities/run) for the previous day
- Yearly subway data refresh (`0 3 1 1 *` — Jan 1, 03:00 KST) plus a boot-time catch-up that re-fetches any `subway_systems` row never fetched or older than ~350 days. `seedSubwaySystemsIfEmpty()` from `src/modules/subway/service.ts` runs on every boot and is idempotent

**Session/Token Management**:
- Cookie-based sessions managed by Better Auth with cookie cache (5-minute TTL to minimize DB lookups)
- GitHub access token is stored **only** in Better Auth's `account` table. Migration 0017 dropped the duplicate `users.github_access_token` column; `getGitHubToken(userId)` is now the single accessor.
- The cron worker filters users via `EXISTS (SELECT 1 FROM account WHERE providerId = 'github' AND accessToken IS NOT NULL)` rather than reading a column on `users`.

**Cron Initialization**: `instrumentation.ts` (project root, not `src/`) uses the Next.js instrumentation hook to call `initializeCron()` on server boot. Only runs under `NEXT_RUNTIME === 'nodejs'`. Also initializes Sentry and registers graceful shutdown handlers (SIGINT/SIGTERM). Set `RUN_ON_START=true` to trigger an immediate sync on boot.

**Location Tracking & Processing** (`src/modules/location/services/`):
- OwnTracks app sends GPS data to `/api/owntracks?apikey={key}` (returns `[]` per OwnTracks protocol)
- On-demand stay-point detection for client views: clusters points within 100m radius, minimum 10-minute stay
- Persisted `visits`/`tracks`/`transportationSegments` are computed by the daily 01:00 cron (previous-day KST window) and exposed via `/api/timeline/locations/*` and insights endpoints
- Pipeline stages: `anomaly-filter` → `visit-detector`/`visit-persister` → `track-builder`/`track-persister` → `transportation/detector` → `subway-match` (matches segments against `subway_lines` PostGIS geometry, groups transfers into sessions) → `subway-discovery` (probes Overpass for new cities encountered). `trip-detector` + `/api/trips/detect` group visits into multi-day trips (overseas detection included)
- Geocoding auto-selects Kakao (Korean coordinates), Google Places, or Mapbox (international); results cached in `placeCache`
- Backfill & import: `/api/settings/location-backfill` and `/api/timeline/locations/import` re-run processing or ingest GPX/external data
- Location hooks poll every 60 seconds when viewing today's date

**Reports** (`src/modules/report/`):
- Monthly and yearly reports aggregate commits, coding sessions, and location data
- API supports sectioned queries (`?section=commits`, `?section=coding`, `?section=location`) for incremental loading
- AI narrative generation via POST with Claude, using prompts defined in `prompts.ts`
- Includes overseas trip detection (`travel.ts`) and 20+ chart/visualization components
- `ReportService` handles data aggregation with period-over-period comparisons

**Toss Transaction Tracking**:
- MacroDroid app forwards Toss push notifications to `/api/toss-notifications?apikey={key}`
- Raw notification stored in `notificationLogs`, then parsed by `src/modules/transaction/parser.ts`
- Parser extracts type (withdrawal/deposit), amount, merchant, account name from notification title+text
- Deduplication: unique constraint on `(userId, notificationLogId)` plus ±2 minute time-window duplicate check
- Daily cron reparse at 23:00 picks up notifications that failed with older parser versions

**Logging**: `src/lib/logger.ts` wraps Better Stack (Logtail) with `info`, `warn`, `error`, `flush` methods. Falls back to console when `BETTER_STACK_SOURCE_TOKEN` is not set.

### Authentication Flow

1. User clicks "GitHub로 로그인" → `authClient.signIn.social({ provider: "github" })`
2. Better Auth redirects to GitHub OAuth (scopes: `repo read:user`)
3. GitHub redirects back to `/api/auth/callback/github` (handled by `[...all]` catch-all route)
4. Better Auth creates `user` + `account` + `session` records, sets session cookie
5. `session.create.after` database hook syncs GitHub data to app `users` table
6. User redirected to `/dashboard`

### API Routes

- `/api/auth/[...all]` - Better Auth catch-all (login, callback, session, signout); `/api/auth/disconnect` - DELETE account
- `/api/settings` - GET/PUT user settings; `/api/settings/owntracks-key` - POST/DELETE OwnTracks key; `/api/settings/wakatime-key` - POST/DELETE WakaTime key; `/api/settings/toss-key` - POST/DELETE Toss key; `/api/settings/wakatime-sync` - POST manual WakaTime sync; `/api/settings/data-usage` - GET data usage stats; `/api/settings/db-benchmark` - GET DB benchmark; `/api/settings/location-backfill` - POST re-run location processing pipeline
- `/api/sync` - POST manual sync; `/api/sync/status` - GET status; `/api/sync/jobs` - GET history
- `/api/timeline` - GET paginated commits with filters
- `/api/timeline/repos` - GET user repos; `/api/timeline/stats` - GET commit stats
- `/api/timeline/commits/[commitId]` - GET details; `.../stats` - GET file stats; `.../summary` - GET/POST summary
- `/api/timeline/locations` - GET location points; `.../stay-points` - detected stay points; `.../distances` - daily travel distances; `.../tracks` - movement tracks; `.../import` - GPX/external import
- `/api/timeline/coding-sessions` - GET WakaTime coding sessions
- `/api/timeline/coding-stats` - GET WakaTime coding statistics
- `/api/trips` - GET/POST trips; `/api/trips/[id]` - PUT/DELETE trip; `/api/trips/detect` - POST auto-detect trips from visits
- `/api/insights` - GET insights dashboard data. With no `section` param returns all five groups in one batched response; `?section=streaks|patterns|routines|digests|commit-heatmap` fetches a single group
- `/api/reports/monthly` - GET monthly report data (supports `?section=` for commits/coding/location); POST AI narrative
- `/api/reports/yearly` - GET yearly report data (supports `?section=`); POST AI narrative
- `/api/summaries/process` - POST batch summary generation
- `/api/owntracks` - POST location data ingestion
- `/api/map/subway` - GET subway lines/stations for map rendering (filtered by viewport bbox)
- `/api/saved-places` - GET/POST saved places; `/api/saved-places/[id]` - PUT/DELETE individual place; `/api/saved-places/search` - GET place search
- `/api/toss-notifications` - POST Toss notification ingestion (via MacroDroid)
- `/api/health` - GET health check
- `/api/spending` - GET spending analytics; `/api/spending/reparse` - POST reparse notifications; `/api/spending/transactions/[transactionId]` - DELETE transaction; `/api/spending/notifications` - GET raw notifications; `/api/spending/notifications/cleanup` - POST cleanup

### Environment Setup

Required env vars (in `.env.local`):
```bash
DATABASE_URL=postgresql://...         # Required, no fallback
BETTER_AUTH_SECRET=...               # Session signing secret
BETTER_AUTH_URL=https://your-domain.com  # Base URL for auth callbacks
GITHUB_CLIENT_ID=...                 # GitHub OAuth App client ID
GITHUB_CLIENT_SECRET=...            # GitHub OAuth App client secret
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_APP_URL=https://your-domain.com  # For client-side URL resolution
```

Optional:
```bash
NEXT_PUBLIC_MAPBOX_TOKEN=pk...       # Map visualization
KAKAO_REST_API_KEY=...               # Korean location geocoding
GOOGLE_MAPS_API_KEY=...              # Google Places API geocoding
BETTER_STACK_SOURCE_TOKEN=...        # Structured logging via Logtail
NEXT_PUBLIC_SENTRY_DSN=...           # Sentry error tracking
ENABLE_DB_BENCHMARK=true             # Gate /api/settings/db-benchmark (admin-only DB perf test)
NEXT_PUBLIC_ENABLE_DB_BENCHMARK=true # Show the matching UI card
```

### Database Operations

1. Modify `src/db/schema.ts`
2. `yarn db:generate` to create migration files in `drizzle/`
3. `yarn db:migrate` to apply to PostgreSQL (local dev)

Drizzle config loads env from `.env.local` (not `.env`). Fallback `DATABASE_URL` for local dev: `postgresql://cistory:cistory@localhost:5432/cistory`.

CI/production uses `scripts/migrate.ts` (invoked via `npx tsx scripts/migrate.ts`) rather than `drizzle-kit migrate`. That script sets `lock_timeout=60s` and `statement_timeout=2m` at the connection level so a stuck `__drizzle_migrations` lock fails the build fast instead of hanging Jenkins. Jenkins additionally kills stale `idle in transaction` sessions on `drizzle`/DDL queries before starting a run.

### CI/CD & Deployment

- **Jenkins pipeline** (`Jenkinsfile`): GitHub webhook trigger → Docker build → Drizzle migrations (separate builder-stage container) → deploy → health check (15 attempts, 5s interval) → Telegram notification (success/failure)
- **Docker** (`Dockerfile`): 4-stage build (base → deps → builder → runner) on Node 22 Alpine. `.env` mounted as build secret; only `NEXT_PUBLIC_*` vars extracted for the build. Runs as non-root `nextjs` user (UID 1001). Production uses `output: "standalone"` from `next.config.ts`
- **Docker Compose** (`docker-compose.yml`): App + `postgis/postgis:17-3.5-alpine` database with external volume `cistory_postgres_data`
- **Timezone**: Production container runs with `TZ=Asia/Seoul` (KST, UTC+9) — relevant to date parsing and cron scheduling
- Jenkins cleanup keeps only the last 3 Docker image tags

## Code Style

- **Biome** for linting/formatting (configured in `biome.json`); auto-organizes imports
- Formatting: 2-space indent, double quotes, semicolons, trailing commas (ES5), 100 char line width
- Lint: unused imports are errors, unused variables are warnings, `useImportType` enforced, `noNonNullAssertion` off, `noExplicitAny` warn, `noExcessiveCognitiveComplexity` warn, `useExhaustiveDependencies` warn
- Path alias: `@/*` maps to `./src/*`
- Prefer Drizzle ORM query builder (avoid raw SQL)
- Follow Next.js App Router conventions (Server Components by default)
- Korean language used for user-facing strings in API responses and UI
- **Date parsing**: Never use `new Date("YYYY-MM-DD")` for date-only strings — ECMAScript spec parses this as UTC midnight, causing timezone offset issues (e.g., KST is UTC+9, so "2026-03-04" becomes March 3rd 15:00 KST). Instead use `new Date(year, month - 1, day)` which creates local timezone midnight. Established helpers: `parseDateLocal()` in `src/app/api/timeline/route.ts`, `_toLocalDate()` in `src/modules/report/service.ts`
