# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cistory is a commit timeline visualization application that syncs GitHub commits and generates AI-powered summaries using Claude. Built with Next.js 16, it uses Supabase Auth for GitHub OAuth, Drizzle ORM with Supabase PostgreSQL for data persistence, and the Anthropic SDK for commit summaries. Features automatic background sync via integrated Cron worker.

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
```

No test infrastructure is currently configured.

Package manager is **Yarn 4** (Berry, via Corepack). Use `yarn` for all package operations.

## Architecture Overview

### Core Stack
- **Next.js 16** (App Router) with Turbopack
- **TypeScript 5** (strict mode)
- **Supabase** - Authentication + hosted PostgreSQL with Row Level Security
- **Drizzle ORM** - Type-safe PostgreSQL access via `pg.Pool` singleton
- **Anthropic SDK** - Claude AI for commit summaries
- **shadcn/ui** + **Tailwind CSS v4** - UI components and styling
- **Biome** - Linter and formatter (replaces ESLint + Prettier)
- **node-cron** - Background sync within Next.js process

### Project Structure

```
src/
├── app/                      # Next.js App Router
│   ├── (auth)/              # Auth route group (login, callback)
│   ├── (dashboard)/         # Dashboard route group (settings)
│   ├── api/                 # API routes
│   └── dashboard/           # Main dashboard page
├── components/              # Shared components (Layout/, ui/)
├── db/
│   ├── schema.ts            # Drizzle schema (users, commits, commitSummaries, syncJobs)
│   └── index.ts             # Database singleton (throws if DATABASE_URL unset)
├── lib/
│   ├── adapters/            # Adapter pattern interfaces + implementations
│   │   ├── ai/             # AI adapter (interface.ts + claude.ts)
│   │   └── vcs/            # VCS adapter (interface.ts + github.ts)
│   ├── supabase/            # Client configs (client.ts, server.ts, service.ts, auth-helpers.ts)
│   ├── cron.ts              # Cron service (auto-sync commits)
│   └── utils.ts             # Shared utilities
├── modules/                 # Feature modules (hooks.ts, service.ts, components/)
│   ├── auth/               # Auth hooks (useAuth, useUser)
│   ├── summary/            # AI commit summary service
│   ├── sync/               # Commit sync service (SyncService class)
│   └── timeline/           # Timeline display (hooks, CommitCard, Timeline)
instrumentation.ts           # (project root) Initializes Cron on server boot (Node.js runtime only)
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

**Module Organization**: Features in `src/modules/` follow:
- `hooks.ts` - React hooks for client-side data fetching
- `service.ts` - Server-side business logic and DB operations
- `components/` - Feature-specific UI components

**Database Access**: `getDb()` from `src/db/index.ts` returns a lazy-initialized Drizzle ORM singleton over a `pg.Pool`. Import schema tables and types alongside it:
```typescript
import { getDb, users, commits, commitSummaries, syncJobs } from "@/db";
const db = getDb();
```

**Database Schema** (4 tables in `src/db/schema.ts`):
- `users` - Extended user data with GitHub tokens (UUID PK, references Supabase `auth.users`)
- `commits` - GitHub commit data (sha, message, stats, repo info)
- `commitSummaries` - AI summaries (status: pending/processing/completed/failed)
- `syncJobs` - Sync tracking (status: fetching/summarizing/completed/failed)

**Sync Strategy** (`src/modules/sync/service.ts`):
- Initial sync: GitHub Search API for last 3 months of commits
- Regular sync: GitHub Search API since `lastSyncedAt` (fallback: 7 days)
- Both flows use shared `_executeSyncCommits()` private method
- Deduplication via SHA batch lookup (batch size: 500)
- Cron runs every 10 minutes, respects per-user `syncIntervalHours`

**Session/Token Management**:
- JWT sessions managed by Supabase with automatic refresh
- Hybrid GitHub token strategy: prefer `session.provider_token` (short-lived), fallback to DB-stored `users.githubAccessToken` (for Cron worker)
- Cron worker uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS

**Cron Initialization**: `instrumentation.ts` (project root, not `src/`) uses the Next.js instrumentation hook to call `initializeCron()` on server boot. Only runs under `NEXT_RUNTIME === 'nodejs'`. Set `RUN_ON_START=true` to trigger an immediate sync on boot.

### Authentication Flow

1. User signs in with GitHub via Supabase OAuth
2. Callback redirects to `/callback` page which calls `/api/auth/ensure-user`
3. Ensure-user creates/updates application `users` record with GitHub token
4. GitHub access token stored in DB for Cron worker access

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

### Database Operations

1. Modify `src/db/schema.ts`
2. `yarn db:generate` to create migration files in `drizzle/`
3. `yarn db:migrate` to apply to PostgreSQL

Drizzle config loads env from `.env.local` (not `.env`).

## Code Style

- **Biome** for linting/formatting (configured in `biome.json`)
- Formatting: 2-space indent, double quotes, semicolons, trailing commas (ES5), 100 char line width
- Lint: unused imports are errors, `useImportType` enforced, `noNonNullAssertion` off
- Path alias: `@/*` maps to `./src/*`
- Prefer Drizzle ORM query builder (avoid raw SQL)
- Follow Next.js App Router conventions (Server Components by default)
- Korean language used for user-facing strings in API responses and UI
