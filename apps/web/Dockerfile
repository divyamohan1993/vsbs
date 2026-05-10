# VSBS Web — Next.js 16 + React 19 on Cloud Run.
#
# Multi-stage build:
#   1. builder (node:22-alpine + pnpm) installs the full pnpm workspace,
#      builds every dependent library, then runs `next build` for the web
#      app under apps/web.
#   2. runtime (node:22-alpine) keeps only the production deps + .next
#      and runs `next start`. Cloud Run injects PORT; we pass it through
#      to next start.
#
# Build context is the REPO ROOT.

FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile=false --ignore-scripts
RUN pnpm run build:libs
RUN pnpm --filter @vsbs/web build

# --- Runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=3000

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web ./apps/web

# Production-only install in the runtime image. Workspace deps already
# resolved during the build stage; we just need runtime modules.
RUN pnpm install --prod --frozen-lockfile=false --ignore-scripts

EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
