# Stage 1: Base image with Node.js and Yarn
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare yarn@4.5.0 --activate
WORKDIR /app

# Stage 2: Install dependencies
FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

# Stage 3: Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars passed as build args (inlined into client bundle by Next.js)
# Dummy DATABASE_URL/BETTER_AUTH_SECRET for build (Better Auth imports pool at module scope)
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_MAPBOX_TOKEN=$NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV BETTER_AUTH_SECRET=build-placeholder

RUN mkdir -p public && yarn build && \
    node scripts/fix-standalone-instrumentation.mjs

# Stage: Test runner — runs the Vitest smoke/assertion suite in CI.
# Reuses the deps node_modules (devDependencies include vitest). `yarn test`
# (vitest run) exits non-zero on any failure, so `docker build --target tester`
# fails the Jenkins Test stage before the image is built or deployed. Dummy env
# for the suite is injected by vitest.config.mts (test.env), so no real
# DATABASE_URL is needed here.
FROM base AS tester
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn test

# Stage: Integration test runner — has the full source + deps but does NOT
# run tests at build time, unlike `tester` above. src/**/*.integration.test.ts
# needs a real Postgres (docker-compose.test.yml), and a Docker build cannot
# reach a sibling service container — there is no DB to connect to while this
# stage is being built. Instead this image is built once, then run as a
# container with `--network host` against a postgres-test container already
# up on localhost, the same two-step shape the `migrator` stage below uses
# for `scripts/migrate.ts`. See the Jenkinsfile's "Integration Tests" stage.
FROM base AS integration-tester
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Stage: Lightweight migration runner (no build, no secrets needed)
FROM base AS migrator
COPY --from=deps /app/node_modules ./node_modules
COPY drizzle ./drizzle
COPY scripts/migrate.ts ./scripts/migrate.ts

# Stage 4: Production runner
FROM node:22-alpine AS runner
WORKDIR /app

# tzdata is required for Intl to resolve IANA zone names like "Asia/Seoul".
# Without it, Intl silently falls back to UTC, which breaks node-cron
# expressions like "0 1 * * *" (they'd fire at 10:00 KST, not 01:00).
RUN apk add --no-cache tzdata

ENV NODE_ENV=production
ENV TZ=Asia/Seoul

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output (includes minimal node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# scripts/fix-standalone-instrumentation.mjs (run in the builder stage above)
# already injected the compiled hook + its NFT-traced deps + chunk requires
# back into .next/standalone — the COPY above brings the patched bundle over
# unchanged.

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)throw r.status;process.exit(0)}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "rm -f /tmp/cistory-cron-ready && exec node server.js"]
