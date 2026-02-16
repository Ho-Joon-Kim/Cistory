# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cistory is a commit timeline visualization application that syncs GitHub commits and generates AI-powered summaries using Claude. Built with Next.js 16, it uses Supabase Auth for GitHub OAuth, Drizzle ORM with Supabase PostgreSQL for data persistence, and the Anthropic SDK for commit summaries. Also includes location tracking via OwnTracks integration with map visualization (Mapbox/Kakao), and WakaTime integration for coding activity tracking. Features automatic background sync via integrated Cron worker with Sentry error tracking and Better Stack structured logging.

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
yarn pm2:start         # Start with PM2 process manager
yarn pm2:stop          # Stop PM2 process
yarn pm2:restart       # Restart PM2 process
yarn pm2:logs          # View PM2 logs
yarn pm2:status        # Check PM2 status
```

No test infrastructure is currently configured.

Package manager is **Yarn 4** (Berry, via Corepack). Use `yarn` for all package operations.

## Architecture Overview

### Core Stack
- **Next.js 16** (App Router) with Turbopack
- **TypeScript 5** (strict mode)
- **Supabase** - Authentication + hosted PostgreSQL with Row Level Security
- **Drizzle ORM** - Type-safe PostgreSQL access via `pg.Pool` singleton
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
│   ├── (dashboard)/         # Dashboard route group (settings, repositories)
│   ├── api/                 # API routes (~23 endpoints)
│   └── dashboard/           # Main dashboard page
├── components/              # Shared components (Layout/, ui/ with 15 shadcn components)
├── db/
│   ├── schema.ts            # Drizzle schema (9 tables)
│   └── index.ts             # Database singleton (throws if DATABASE_URL unset)
├── lib/
│   ├── adapters/            # Adapter pattern interfaces + implementations
│   │   ├── ai/             # AI adapter (interface.ts + claude.ts)
│   │   ├── geocoding/      # Geocoding adapter (kakao.ts, mapbox.ts, google.ts, index.ts)
│   │   ├── vcs/            # VCS adapter (interface.ts + github.ts)
│   │   └── wakatime/       # WakaTime adapter (interface.ts + wakatime.ts)
│   ├── supabase/            # Client configs (client.ts, server.ts, service.ts, auth-helpers.ts)
│   ├── cron.ts              # Cron service (auto-sync commits, summaries, WakaTime)
│   ├── geo.ts               # Geospatial utilities (Haversine distance)
│   ├── logger.ts            # Structured logging (Better Stack / console fallback)
│   └── utils.ts             # Shared utilities (cn, generateId, now, formatRelativeTime, etc.)
├── modules/                 # Feature modules (hooks.ts, service.ts, components/)
│   ├── auth/               # Auth hooks (useAuth, useUser)
│   ├── github/             # GitHub service wrapper (GitHubService class)
│   ├── location/           # Location tracking (OwnTracks, stay points, map)
│   ├── settings/           # User settings (theme, sync interval, OwnTracks key, WakaTime key)
│   ├── summary/            # AI commit summary service
│   ├── sync/               # Commit sync service (SyncService class)
│   ├── timeline/           # Timeline display (hooks, CommitCard, Timeline, Filters)
│   └── wakatime/           # WakaTime coding activity (service, hooks, components)
instrumentation.ts           # (project root) Initializes Cron + Sentry on server boot
sentry.server.config.ts      # Sentry server config
sentry.client.config.ts      # Sentry client config
sentry.edge.config.ts        # Sentry edge config
```

### Key Patterns

**API Route Authentication**: All API routes use shared helpers from `src/lib/supabase/auth-helpers.ts`:
```typescript
// Auth-only routes (most routes)
const { user, error } = await getAuthenticatedUser(request);
if (error) return error;

// Routes that also need GitHub API access
const accessToken = await getGitHubToken(user.id, db, users);
```

**Adapter Pattern**: Extensible interfaces in `lib/adapters/`:
- `ai/interface.ts` - AI/LLM abstraction (implemented: `claude.ts`)
- `vcs/interface.ts` - VCS abstraction (implemented: `github.ts`)
- `geocoding/interface.ts` - Geocoding abstraction (implemented: `kakao.ts` for Korea, `google.ts` for Google Places, `mapbox.ts` for international; auto-selected by coordinates in `index.ts`)
- `wakatime/interface.ts` - WakaTime coding activity abstraction (implemented: `wakatime.ts`)

**Module Organization**: Features in `src/modules/` follow:
- `hooks.ts` - React hooks for client-side data fetching
- `service.ts` - Server-side business logic and DB operations
- `components/` - Feature-specific UI components

**Database Access**: `getDb()` from `src/db/index.ts` returns a lazy-initialized Drizzle ORM singleton over a `pg.Pool`. Import schema tables and types alongside it:
```typescript
import { getDb, users, commits, commitSummaries, syncJobs } from "@/db";
const db = getDb();
```

**Database Schema** (9 tables in `src/db/schema.ts`):
- `users` - Extended user data with GitHub tokens, `ownTracksApiKey`, `wakatimeApiKey` (UUID PK, references Supabase `auth.users`)
- `commits` - GitHub commit data (sha, message, stats, repo info)
- `commitSummaries` - AI summaries (status: pending/processing/completed/failed)
- `syncJobs` - Sync tracking (status: fetching/summarizing/completed/failed)
- `locationPoints` - OwnTracks GPS data (lat, lon, accuracy, altitude, velocity, battery, timestamp). Indexes on `(userId, timestamp)` and unique on `(userId, timestamp, lat, lon)`
- `placeCache` - Geocoding cache (latKey, lonKey, placeName, address, category, provider). Unique index on `(latKey, lonKey)`
- `codingSessions` - WakaTime coding sessions (duration, project, additions/deletions)
- `codingDailyStats` - Daily aggregated coding statistics (projects, languages, editors, categories)
- `dailyDistances` - Cached daily travel distances

**Supabase Client Variants** (`src/lib/supabase/`):
- `client.ts` - Browser client for Client Components (`createClient()`)
- `server.ts` - Server Component client (silently catches cookie errors) and Route Handler client (`createRouteHandlerClient()`, throws on cookie errors)
- `service.ts` - Service role client bypassing RLS (`createServiceClient()`), used by Cron worker only
- `auth-helpers.ts` - `getAuthenticatedUser()` and `getGitHubToken()` for API routes

**Sync Strategy** (`src/modules/sync/service.ts`):
- Uses `getAllRepoCommits()` which iterates `/user/repos` + `/repos/:owner/:repo/commits`
- Initial sync: last 3 months of commits
- Regular sync: since `lastSyncedAt` (fallback: 7 days)
- Both flows use shared `_executeSyncCommits()` private method
- Deduplication via SHA batch lookup (batch size: 500)
- Rate limiting: 100ms delay between commit saves
- Cron runs every 10 minutes, respects per-user `syncIntervalHours`
- Cron also processes pending summaries (limit 5/user, 1s delay between), syncs WakaTime data, and auto-deletes sync jobs older than 7 days

**Session/Token Management**:
- JWT sessions managed by Supabase with automatic refresh
- Hybrid GitHub token strategy: prefer `session.provider_token` (short-lived), fallback to DB-stored `users.githubAccessToken` (for Cron worker)
- Cron worker uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS

**Cron Initialization**: `instrumentation.ts` (project root, not `src/`) uses the Next.js instrumentation hook to call `initializeCron()` on server boot. Only runs under `NEXT_RUNTIME === 'nodejs'`. Also initializes Sentry and registers graceful shutdown handlers (SIGINT/SIGTERM). Set `RUN_ON_START=true` to trigger an immediate sync on boot.

**Location Tracking**:
- OwnTracks app sends GPS data to `/api/owntracks?apikey={key}` (returns `[]` per OwnTracks protocol)
- Stay point detection: clusters points within 100m radius, minimum 10-minute stay duration
- Geocoding auto-selects Kakao (Korean coordinates), Google Places, or Mapbox (international)
- Location hooks poll every 60 seconds when viewing today's date

**Logging**: `src/lib/logger.ts` wraps Better Stack (Logtail) with `info`, `warn`, `error`, `flush` methods. Falls back to console when `BETTER_STACK_SOURCE_TOKEN` is not set.

### Authentication Flow

1. User signs in with GitHub via Supabase OAuth (scopes: `repo read:user`)
2. Callback redirects to `/callback` page which calls `/api/auth/ensure-user`
3. Ensure-user creates/updates application `users` record with GitHub token
4. GitHub access token stored in DB for Cron worker access

### API Routes

- `/api/auth/*` - OAuth callback, ensure-user, disconnect
- `/api/settings` - GET/PUT user settings; `/api/settings/owntracks-key` - POST/DELETE OwnTracks key; `/api/settings/wakatime-key` - POST/DELETE WakaTime key; `/api/settings/wakatime-sync` - POST manual WakaTime sync
- `/api/sync` - POST manual sync; `/api/sync/status` - GET status; `/api/sync/jobs` - GET history
- `/api/timeline` - GET paginated commits with filters
- `/api/timeline/repos` - GET user repos; `/api/timeline/stats` - GET commit stats
- `/api/timeline/commits/[commitId]` - GET details; `.../stats` - GET file stats; `.../summary` - GET/POST summary
- `/api/timeline/locations` - GET location points; `.../stay-points` - GET detected stay points; `.../distances` - GET daily travel distances
- `/api/timeline/coding-sessions` - GET WakaTime coding sessions
- `/api/timeline/coding-stats` - GET WakaTime coding statistics
- `/api/summaries/process` - POST batch summary generation
- `/api/owntracks` - POST location data ingestion

### Environment Setup

Required env vars (in `.env.local`):
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...     # For Cron worker (bypasses RLS)
DATABASE_URL=postgresql://...         # Required, no fallback
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_APP_URL=https://your-domain.com  # For OAuth redirects
```

Optional:
```bash
NEXT_PUBLIC_MAPBOX_TOKEN=pk...       # Map visualization
KAKAO_REST_API_KEY=...               # Korean location geocoding
GOOGLE_MAPS_API_KEY=...              # Google Places API geocoding
BETTER_STACK_SOURCE_TOKEN=...        # Structured logging via Logtail
NEXT_PUBLIC_SENTRY_DSN=...           # Sentry error tracking
```

### Database Operations

1. Modify `src/db/schema.ts`
2. `yarn db:generate` to create migration files in `drizzle/`
3. `yarn db:migrate` to apply to PostgreSQL

Drizzle config loads env from `.env.local` (not `.env`).

## Code Style

- **Biome** for linting/formatting (configured in `biome.json`)
- Formatting: 2-space indent, double quotes, semicolons, trailing commas (ES5), 100 char line width
- Lint: unused imports are errors, `useImportType` enforced, `noNonNullAssertion` off, `noExplicitAny` warn, `noExcessiveCognitiveComplexity` warn, `useExhaustiveDependencies` warn
- Path alias: `@/*` maps to `./src/*`
- Prefer Drizzle ORM query builder (avoid raw SQL)
- Follow Next.js App Router conventions (Server Components by default)
- Korean language used for user-facing strings in API responses and UI
