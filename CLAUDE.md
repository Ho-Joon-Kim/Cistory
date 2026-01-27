# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cistory is a commit timeline visualization application that syncs GitHub commits and generates AI-powered summaries using Claude. Built with Next.js 16, it uses Supabase Auth for GitHub OAuth, Drizzle ORM with Supabase PostgreSQL for data persistence, and the Anthropic SDK for commit summaries. Features automatic background sync via Self-hosted Cron worker.

## Development Commands

### Essential Commands
```bash
# Start development server (with Turbopack, includes auto Cron)
yarn dev

# Build for production
yarn build

# Start production server (binds to 0.0.0.0, includes Cron)
yarn start

# Production with PM2 (process manager)
yarn pm2:start         # Start with PM2
yarn pm2:stop          # Stop PM2 process
yarn pm2:restart       # Restart PM2 process
yarn pm2:logs          # View logs
yarn pm2:status        # Check status

# Linting and formatting (uses Biome)
yarn lint              # Check for lint errors
yarn lint:fix          # Fix lint errors
yarn format            # Format code
yarn check             # Check and fix all issues

# Database operations (Drizzle Kit)
yarn db:generate       # Generate migrations from schema
yarn db:migrate        # Run migrations
yarn db:studio         # Open Drizzle Studio
```

### Running Single Tests
This project does not currently have test infrastructure configured.

## Architecture Overview

### Core Technology Stack
- **Next.js 16** (App Router) - React framework with Turbopack
- **TypeScript 5** - Type-safe development
- **Supabase** - Authentication, hosted PostgreSQL with Row Level Security
- **Drizzle ORM** - Type-safe PostgreSQL database access
- **Integrated Cron** - Automatic background sync via node-cron (runs within Next.js process)
- **Anthropic SDK** - Claude AI for commit summaries
- **shadcn/ui** - Component library with Radix UI primitives
- **Tailwind CSS v4** - Styling
- **Biome** - Fast linter and formatter (replaces ESLint + Prettier)

### Project Structure

```
src/
├── app/                      # Next.js App Router
│   ├── (auth)/              # Auth route group (login, callback)
│   ├── (dashboard)/         # Dashboard route group (settings)
│   ├── api/                 # API routes
│   │   ├── auth/           # Auth endpoints (callback, ensure-user, disconnect)
│   │   ├── timeline/       # Timeline and commits endpoints
│   │   ├── sync/           # Sync operations
│   │   └── settings/       # User settings
│   └── dashboard/          # Main dashboard page
├── components/             # Shared components
│   ├── Layout/            # Header, nav components
│   └── ui/                # shadcn/ui components
├── db/
│   ├── schema.ts          # Drizzle schema (users, commits, summaries, syncJobs)
│   └── index.ts           # Database singleton
├── lib/
│   ├── adapters/          # Abstraction layer
│   │   ├── ai/           # AI adapter (Claude, extensible to other LLMs)
│   │   └── vcs/          # VCS adapter (GitHub, extensible to GitLab/Bitbucket)
│   ├── supabase/         # Supabase client configuration
│   │   ├── client.ts     # Browser client
│   │   ├── server.ts     # Server client (API routes, Server Components)
│   │   └── service.ts    # Service client (Cron worker, bypasses RLS)
│   ├── cron.ts           # Cron service (auto-sync commits)
│   └── utils.ts          # Shared utilities
├── modules/              # Feature modules
│   ├── auth/            # Auth hooks and components
│   ├── github/          # GitHub service
│   ├── settings/        # User settings
│   ├── summary/         # AI commit summaries
│   ├── sync/            # Commit sync service
│   └── timeline/        # Timeline display
└── instrumentation.ts    # Next.js instrumentation (initializes Cron on server boot)
```

### Key Architectural Patterns

**Adapter Pattern**: The codebase uses adapter interfaces for extensibility:
- `lib/adapters/ai/interface.ts` - AI/LLM abstraction (current: Claude)
- `lib/adapters/vcs/interface.ts` - VCS abstraction (current: GitHub)
- Implementations: `ai/claude.ts`, `vcs/github.ts`

**Module Organization**: Features are organized in `src/modules/` with:
- `hooks.ts` - React hooks for data fetching
- `service.ts` - Business logic and data operations
- `components/` - Feature-specific UI components
- `types.ts` - TypeScript type definitions

**Database Schema**: Four main tables (see `src/db/schema.ts`):
- `users` - Extended user data with GitHub tokens and sync settings (UUID primary key, references Supabase auth.users)
- `commits` - Commit data from GitHub (sha, message, stats, repo info)
- `commitSummaries` - AI-generated summaries (status: pending/completed/failed)
- `syncJobs` - Sync operation tracking (status, progress, errors)

**Note**: Supabase manages auth tables (`auth.users`, `auth.sessions`) in a separate schema. Application tables use RLS policies for security.

**Sync Strategy** (`src/modules/sync/service.ts`):
- Initial sync: Uses GitHub Search API to fetch last 3 months of commits
- Regular sync: Uses GitHub Events API for recent push events
- Deduplication: Checks existing SHAs before inserting
- Progress tracking: Updates sync jobs with status and counts

### Environment Setup

Required environment variables (see `.env.example`):
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # For Cron worker
DATABASE_URL=postgresql://postgres:password@host:5432/postgres

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Optional
RUN_ON_START=true  # Run sync immediately on server start (useful for testing)
```

**Supabase Setup**:
1. Create Supabase project at https://supabase.com
2. Get credentials from Project Settings → API
3. Configure GitHub OAuth in Authentication → Providers
4. Run migrations: `yarn db:migrate`
5. Apply RLS policies: Execute `supabase-rls-policies.sql` in Supabase SQL Editor

### Database Operations

**Creating Migrations**:
1. Modify `src/db/schema.ts`
2. Run `yarn db:generate` to create migration files in `drizzle/`
3. Run `yarn db:migrate` to apply migrations to PostgreSQL

**Connection Management**:
- Database uses connection pooling via `pg.Pool`
- Singleton pattern ensures single connection pool instance
- Connection string configured via `DATABASE_URL` environment variable

### Authentication Flow

1. User clicks "Sign in with GitHub" (Supabase Auth GitHub provider)
2. GitHub OAuth redirects to Supabase Auth callback
3. Supabase creates user record in `auth.users` and session in `auth.sessions`
4. App redirects to `/callback` page which calls `/api/auth/ensure-user`
5. Ensure-user endpoint creates extended user record in application `users` table
6. GitHub access token stored in DB (`users.githubAccessToken`) for Cron worker access

**Session Management**:
- JWT-based sessions managed by Supabase
- Hybrid token strategy: Prefer `session.provider_token` (short-lived), fallback to DB-stored token (for Cron)
- Automatic token refresh handled by Supabase client

### API Architecture

All API routes are in `src/app/api/`:
- `/api/auth/callback` - OAuth callback handler (exchanges code for session)
- `/api/auth/ensure-user` - Creates/updates application user record after Supabase auth
- `/api/auth/disconnect` - Delete user data and sign out
- `/api/timeline` - Get commits with optional filtering (pagination, date range, repo)
- `/api/timeline/repos` - List user's repositories with commit counts
- `/api/timeline/commits/[commitId]` - Get commit details
- `/api/timeline/commits/[commitId]/summary` - Generate AI summary (POST, async)
- `/api/sync` - Trigger sync operations (manual sync)
- `/api/sync/status` - SSE stream for real-time sync progress
- `/api/sync/jobs` - Get sync job history with statistics
- `/api/settings` - User preferences (theme, sync interval)

### Important Implementation Notes

- **Singleton Pattern**: Database (`src/db/index.ts`) uses singleton to avoid multiple connection pools
- **GitHub Token Storage**: Access tokens stored in `users.githubAccessToken` for Cron worker and API fallback
- **Cron Integration**: `instrumentation.ts` initializes Cron service when Next.js server boots (Node.js runtime only)
- **Cron Schedule**: Runs every hour (`0 * * * *`), syncs users based on their `syncIntervalHours` setting
- **RLS Security**: Row Level Security policies ensure users only access their own data
- **Service Role**: Cron worker uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS for background operations
- **AI Summaries**: Generated on-demand via `/api/timeline/commits/[commitId]/summary`, stored in `commitSummaries` table
- **Route Groups**: App Router uses `(auth)` and `(dashboard)` groups for layout organization
- **Server Binding**: Production server binds to `0.0.0.0` to allow external connections
- **Process Management**: PM2 manages single process (`cistory`) which includes both Next.js server and Cron worker

## Code Style

- Use Biome for linting and formatting (configured in `.biome.json` if present)
- TypeScript strict mode enabled
- Prefer functional components with hooks
- Use Drizzle ORM query builder (avoid raw SQL)
- Follow Next.js App Router conventions (Server Components by default)

## Recent Migration Notes

The project has undergone the following migrations:
1. **Cloudflare Workers → Local Deployment**: Migrated from Cloudflare Workers to local Next.js deployment
2. **SQLite → PostgreSQL**: Database migrated from SQLite to PostgreSQL
3. **Better Auth → Supabase Auth**: Authentication migrated to Supabase for better scalability
4. **Added Self-hosted Cron**: Automatic background sync for users without requiring re-login

Git history contains commits related to previous architectures that are no longer relevant to the current stack.
