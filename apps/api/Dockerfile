# VSBS API — Bun runtime on Cloud Run.
#
# Multi-stage build:
#   1. builder (oven/bun:1.2 + pnpm) installs the full pnpm workspace,
#      compiles every dependent library (`pnpm run build:libs`), then
#      runs `bun build` for the api itself, producing a single bundle
#      under /app/apps/api/dist/server.js.
#   2. runtime (oven/bun:1.2-slim) ships only the bundled artefact and
#      the API package.json so `bun start` works on Cloud Run.
#
# Build context is the REPO ROOT (cloudbuild.yaml passes `.`). The
# Dockerfile path is `apps/api/Dockerfile`.

FROM node:22-alpine AS builder
WORKDIR /app

# Builder is Node-based (so corepack/pnpm work cleanly). Bun is installed
# on top because @vsbs/api's build script runs `bun build`. The Bun
# musl/Alpine build is shipped officially.
RUN apk add --no-cache bash curl unzip libstdc++ \
 && curl -fsSL https://bun.sh/install | bash \
 && ln -s /root/.bun/bin/bun /usr/local/bin/bun

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Copy workspace metadata first for cache-friendly installs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile=false --ignore-scripts

# Build dependency libraries (workspace libs need dist/ for `@vsbs/*`
# imports to resolve at runtime). The API itself is run directly from
# source — Bun has native TypeScript + workspace resolution, and `bun build`
# can't bundle runtime worker-thread entry points (e.g. pino's
# thread-stream worker.js), so a bundled artefact crashes on first log.
RUN pnpm run build:libs

# --- Runtime ---
FROM oven/bun:1.2-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=8787

# Carry the full workspace tree + node_modules so pnpm's symlinked
# packages and pino's worker scripts are reachable at runtime.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/tsconfig.base.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 8787
WORKDIR /app/apps/api
CMD ["bun", "run", "src/server.ts"]
