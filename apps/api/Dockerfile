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

FROM oven/bun:1.2 AS builder
WORKDIR /app

# Reuse the corepack-pinned pnpm.
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Copy workspace metadata first for cache-friendly installs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile=false --ignore-scripts

# Build dependency libraries before bundling the API server.
RUN pnpm run build:libs
RUN pnpm --filter @vsbs/api build

# --- Runtime ---
FROM oven/bun:1.2-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=8787

# The bundled output is a single file with all deps inlined.
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./package.json

EXPOSE 8787
CMD ["bun", "run", "dist/server.js"]
