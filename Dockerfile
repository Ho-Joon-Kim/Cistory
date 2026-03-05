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

# .env is mounted as a secret at build time
# Extract NEXT_PUBLIC_* vars, strip surrounding quotes, export them, then build
# Dummy DATABASE_URL/BETTER_AUTH_SECRET for build (Better Auth imports pool at module scope)
# Real values are injected at runtime via env_file
RUN --mount=type=secret,id=env,target=/tmp/.env \
    grep '^NEXT_PUBLIC_' /tmp/.env | sed "s/=\([\"']\)\(.*\)\1$/=\2/" > /tmp/.env.public && \
    set -a && . /tmp/.env.public && set +a && \
    export DATABASE_URL=postgresql://build:build@localhost:5432/build && \
    export BETTER_AUTH_SECRET=build-placeholder && \
    mkdir -p public && yarn build

# Stage 4: Production runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Seoul

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output (includes minimal node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
