# Gestalt server — multi-stage Docker build
# Node 20 + pnpm 9 (last major version compatible with Node 20)

# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Pin pnpm to v9 — the last major version fully compatible with Node 20
# pnpm 10+ requires Node 22+
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace manifests first for better layer caching
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json                      ./packages/core/
COPY packages/server/package.json                    ./packages/server/
COPY packages/dashboard/package.json                 ./packages/dashboard/
COPY packages/adapters/postgres/package.json         ./packages/adapters/postgres/
COPY packages/adapters/oracle/package.json           ./packages/adapters/oracle/
COPY packages/adapters/mssql/package.json            ./packages/adapters/mssql/
COPY packages/agents/generate/package.json           ./packages/agents/generate/
COPY packages/agents/quality-gate/package.json       ./packages/agents/quality-gate/
COPY packages/agents/deploy/package.json             ./packages/agents/deploy/
COPY packages/agents/maintenance/package.json        ./packages/agents/maintenance/
COPY packages/agents/planning/package.json           ./packages/agents/planning/

# Install dependencies — no lockfile exists yet so use --no-frozen-lockfile
# Once a lockfile is committed, change this to --frozen-lockfile
RUN pnpm install --no-frozen-lockfile

# Copy full source after install (better cache: deps only reinstall when package.json changes)
COPY packages/core                 ./packages/core
COPY packages/server               ./packages/server
COPY packages/dashboard            ./packages/dashboard
COPY packages/adapters/postgres    ./packages/adapters/postgres
COPY packages/adapters/oracle      ./packages/adapters/oracle
COPY packages/adapters/mssql       ./packages/adapters/mssql
COPY packages/agents/generate      ./packages/agents/generate
COPY packages/agents/quality-gate  ./packages/agents/quality-gate
COPY packages/agents/deploy        ./packages/agents/deploy
COPY packages/agents/maintenance   ./packages/agents/maintenance
COPY packages/agents/planning      ./packages/agents/planning

# Harness templates (ADR-036). The engine reads + substitutes these
# at init-harness time; they ship as part of the image so the server
# doesn't need outbound network access to fetch them.
COPY templates                     ./templates

# Build in dependency order
RUN pnpm --filter @gestalt/core build
RUN pnpm --filter @gestalt/adapter-postgres build
RUN pnpm --filter @gestalt/agents-generate build
RUN pnpm --filter @gestalt/agents-quality-gate build
RUN pnpm --filter @gestalt/agents-deploy build
RUN pnpm --filter @gestalt/agents-maintenance build
RUN pnpm --filter @gestalt/agents-planning build
RUN pnpm --filter @gestalt/server build
RUN pnpm --filter @gestalt/dashboard build

# ─── Stage 2: production image ───────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# `git` is required at runtime — simple-git shells out to the system binary
# for clone / commit / push (ADR-032). `openssh-client` is needed for SSH
# remotes (HTTPS+PAT still works without it but most operators use both).
# `python3` + `py3-pip` ship Aider (TR_014) — opt-in code-generation
# backend per project via HARNESS.json.codeGeneration.backend — AND
# pr-agent (TR_027 / ADR-051) — server-side LLM PR reviewer
# invoked via `executeScript` after CI passes.
# `--break-system-packages` is required on Alpine 3.20+ because PEP 668
# treats the system Python as externally-managed; we own the image
# entirely so the override is safe here. Aider depends on tree-sitter
# which has C extensions — build-base + python3-dev are installed
# temporarily for the pip build, then removed via `apk del` in the
# same layer so the runtime image doesn't grow with compilers.
# TR_027 — Aider and PR-Agent both depend on `litellm` but at
# incompatible versions (PR-Agent's litellm has exception classes
# Aider's exceptions adapter doesn't recognise — Aider crashes at
# import time). Each app runs in its own venv so their dep graphs
# don't collide. We shim two CLI entry points onto $PATH so the
# rest of the platform calls them unchanged.
RUN apk add --no-cache git openssh-client python3 py3-pip \
    && apk add --no-cache --virtual .aider-build-deps build-base python3-dev gfortran openblas-dev \
    # Aider in its own venv at /opt/aider
    && python3 -m venv /opt/aider \
    && /opt/aider/bin/pip install --no-cache-dir --prefer-binary aider-chat \
    && ln -sf /opt/aider/bin/aider /usr/local/bin/aider \
    # PR-Agent in its own venv at /opt/pr-agent
    && python3 -m venv /opt/pr-agent \
    && /opt/pr-agent/bin/pip install --no-cache-dir --prefer-binary pr-agent \
    # Shim: `python -m pr_agent.cli` resolves to the pr-agent venv's
    # interpreter so the platform's `executeScript` call uses the
    # right deps without setting PATH/PYTHONPATH at the call site.
    && printf '#!/bin/sh\nexec /opt/pr-agent/bin/python -m pr_agent.cli "$@"\n' > /usr/local/bin/pr-agent \
    && chmod +x /usr/local/bin/pr-agent \
    && apk del .aider-build-deps

# Install pnpm globally via npm rather than corepack — corepack caches
# per-user (`~/.cache/node/corepack/...`) so an activation as root
# doesn't carry to the `gestalt` runtime user, and a fresh
# `pnpm install` invocation by `gestalt` would auto-download the
# LATEST pnpm (which requires Node 22+ for `node:sqlite`). A
# straight `npm install -g pnpm@9.15.4` lands at /usr/local/bin/pnpm
# and is callable by every user without per-user activation.
# Required by pr-agent (lockfile sync after writing artifacts).
RUN npm install -g pnpm@9.15.4

COPY package.json pnpm-workspace.yaml ./

# Copy package manifests and built output
COPY --from=builder /app/packages/core/package.json             ./packages/core/package.json
COPY --from=builder /app/packages/core/dist                     ./packages/core/dist
COPY --from=builder /app/packages/adapters/postgres/package.json ./packages/adapters/postgres/package.json
COPY --from=builder /app/packages/adapters/postgres/dist        ./packages/adapters/postgres/dist
COPY --from=builder /app/packages/agents/generate/package.json  ./packages/agents/generate/package.json
COPY --from=builder /app/packages/agents/generate/dist          ./packages/agents/generate/dist
COPY --from=builder /app/packages/agents/quality-gate/package.json ./packages/agents/quality-gate/package.json
COPY --from=builder /app/packages/agents/quality-gate/dist      ./packages/agents/quality-gate/dist
COPY --from=builder /app/packages/agents/deploy/package.json    ./packages/agents/deploy/package.json
COPY --from=builder /app/packages/agents/deploy/dist            ./packages/agents/deploy/dist
COPY --from=builder /app/packages/agents/maintenance/package.json ./packages/agents/maintenance/package.json
COPY --from=builder /app/packages/agents/maintenance/dist       ./packages/agents/maintenance/dist
COPY --from=builder /app/packages/agents/planning/package.json  ./packages/agents/planning/package.json
COPY --from=builder /app/packages/agents/planning/dist          ./packages/agents/planning/dist
COPY --from=builder /app/packages/server/package.json           ./packages/server/package.json
COPY --from=builder /app/packages/server/dist                   ./packages/server/dist

# Dashboard static assets served by Fastify
COPY --from=builder /app/packages/dashboard/dist                ./packages/dashboard/dist

# SQL migrations run at startup
COPY --from=builder /app/packages/adapters/postgres/src/migrations \
                    ./packages/adapters/postgres/src/migrations

# Harness templates — copied verbatim from the builder image. The
# template engine (packages/server/src/templates/engine.ts) walks
# /app/templates/<id>/ on every init-harness call.
COPY --from=builder /app/templates ./templates

# Production-only dependencies
RUN pnpm install --prod --no-frozen-lockfile

# Non-root user for security
RUN addgroup -S gestalt && adduser -S gestalt -G gestalt \
    && chown -R gestalt:gestalt /app
USER gestalt

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

EXPOSE 3000
CMD ["node", "packages/server/dist/server.js"]
