# Gestalt server — multi-stage Docker build
# Stage 1: build all packages
# Stage 2: production image with only runtime dependencies

# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace config and all package manifests first (layer cache)
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json             ./packages/core/
COPY packages/server/package.json           ./packages/server/
COPY packages/adapters/postgres/package.json ./packages/adapters/postgres/
COPY packages/agents/generate/package.json  ./packages/agents/generate/
COPY packages/agents/quality-gate/package.json ./packages/agents/quality-gate/
COPY packages/agents/deploy/package.json    ./packages/agents/deploy/
COPY packages/agents/maintenance/package.json ./packages/agents/maintenance/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/core/src           ./packages/core/src
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/adapters/postgres/src           ./packages/adapters/postgres/src
COPY packages/adapters/postgres/tsconfig.json ./packages/adapters/postgres/
COPY packages/server/src           ./packages/server/src
COPY packages/server/tsconfig.json ./packages/server/
COPY packages/agents/generate/src           ./packages/agents/generate/src
COPY packages/agents/generate/tsconfig.json ./packages/agents/generate/
COPY packages/agents/quality-gate/src       ./packages/agents/quality-gate/src
COPY packages/agents/quality-gate/tsconfig.json ./packages/agents/quality-gate/
COPY packages/agents/deploy/src             ./packages/agents/deploy/src
COPY packages/agents/deploy/tsconfig.json   ./packages/agents/deploy/
COPY packages/agents/maintenance/src        ./packages/agents/maintenance/src
COPY packages/agents/maintenance/tsconfig.json ./packages/agents/maintenance/

# Build in dependency order
RUN pnpm --filter @gestalt/core build
RUN pnpm --filter @gestalt/adapter-postgres build
RUN pnpm --filter @gestalt/agents-generate build
RUN pnpm --filter @gestalt/agents-quality-gate build
RUN pnpm --filter @gestalt/agents-deploy build
RUN pnpm --filter @gestalt/agents-maintenance build
RUN pnpm --filter @gestalt/server build

# Build dashboard
COPY packages/dashboard/package.json      ./packages/dashboard/
COPY packages/dashboard/index.html        ./packages/dashboard/
COPY packages/dashboard/vite.config.ts    ./packages/dashboard/
COPY packages/dashboard/tsconfig.json     ./packages/dashboard/
COPY packages/dashboard/src               ./packages/dashboard/src
RUN pnpm --filter @gestalt/dashboard install
RUN pnpm --filter @gestalt/dashboard build

# ─── Stage 2: production image ───────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace config
COPY package.json pnpm-workspace.yaml ./

# Copy built packages
COPY --from=builder /app/packages/core/dist              ./packages/core/dist
COPY --from=builder /app/packages/core/package.json      ./packages/core/
COPY --from=builder /app/packages/adapters/postgres/dist ./packages/adapters/postgres/dist
COPY --from=builder /app/packages/adapters/postgres/package.json ./packages/adapters/postgres/
COPY --from=builder /app/packages/agents/generate/dist   ./packages/agents/generate/dist
COPY --from=builder /app/packages/agents/generate/package.json ./packages/agents/generate/
COPY --from=builder /app/packages/agents/quality-gate/dist ./packages/agents/quality-gate/dist
COPY --from=builder /app/packages/agents/quality-gate/package.json ./packages/agents/quality-gate/
COPY --from=builder /app/packages/agents/deploy/dist     ./packages/agents/deploy/dist
COPY --from=builder /app/packages/agents/deploy/package.json ./packages/agents/deploy/
COPY --from=builder /app/packages/agents/maintenance/dist ./packages/agents/maintenance/dist
COPY --from=builder /app/packages/agents/maintenance/package.json ./packages/agents/maintenance/
COPY --from=builder /app/packages/server/dist            ./packages/server/dist
COPY --from=builder /app/packages/server/package.json    ./packages/server/

# Copy compiled dashboard into server's static directory
COPY --from=builder /app/packages/dashboard/dist ./packages/dashboard/dist

# Copy SQL migrations (needed at runtime)
COPY --from=builder /app/packages/adapters/postgres/src/migrations \
     ./packages/adapters/postgres/src/migrations

# Install production dependencies only
COPY --from=builder /app/packages/core/package.json      ./packages/core/
COPY --from=builder /app/packages/adapters/postgres/package.json ./packages/adapters/postgres/
COPY --from=builder /app/packages/server/package.json    ./packages/server/
RUN pnpm install --prod --frozen-lockfile

# Non-root user for security
RUN addgroup -S gestalt && adduser -S gestalt -G gestalt
RUN chown -R gestalt:gestalt /app
USER gestalt

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "packages/server/dist/server.js"]
