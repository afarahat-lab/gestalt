# Development Setup — Gestalt

This guide covers running Gestalt from source for active development and contribution.

For the Docker-based quick start, see [Quick Start](./quick-start.md).
For production corporate deployment, see [Deployment Guide](./deployment.md).

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ | |
| pnpm | 9+ | `npm install -g pnpm` |
| Docker | 24.0+ | Docker Desktop for macOS/Windows — must be running before `docker-compose up` |
| Docker Compose | 2.20+ | Bundled with Docker Desktop |
| Git | 2.38+ | |

---

## Step 1 — Clone and install dependencies

```bash
git clone https://github.com/afarahat-lab/gestalt.git
cd gestalt
pnpm install
```

---

## Step 2 — Start infrastructure

Start only PostgreSQL and Redis. The server and dashboard run as Node.js processes.

```bash
docker-compose up -d postgres redis

# Verify both are healthy
docker-compose ps postgres redis
```

---

## Step 3 — Configure environment

```bash
cp .env.example .env
```

For development, add these values to `.env`:

```bash
# Required
LLM_BASE_URL=<your-llm-endpoint>
LLM_API_KEY=<your-api-key>
LLM_MODEL=gpt-4o
JWT_SECRET=<64-character-random-string>

# Database (constructed from docker-compose defaults)
DATABASE_URL=postgresql://gestalt:<POSTGRES_PASSWORD>@localhost:5432/gestalt
POSTGRES_PASSWORD=<same-password-as-above>

# Optional
NODE_ENV=development
LOG_LEVEL=debug
```

Generate a secure JWT secret:

```bash
openssl rand -hex 64
```

---

## Step 4 — Build core packages

The server depends on compiled core packages. Build them once before starting:

```bash
pnpm --filter @gestalt/core build
pnpm --filter @gestalt/adapter-postgres build
```

---

## Step 5 — Run in development mode

Open three terminals from the repo root.

**Terminal 1 — Server** (hot-reloads on file changes):

```bash
cd packages/server
pnpm dev
# → Server running on http://localhost:3000
```

**Terminal 2 — Dashboard** (Vite HMR, proxies API to :3000):

```bash
cd packages/dashboard
pnpm dev
# → Dashboard on http://localhost:5173
```

**Terminal 3 — CLI:**

```bash
# Option A: run directly without building
cd packages/cli
pnpm dev -- login

# Option B: build and link globally
cd packages/cli
pnpm build
npm link
gestalt login
```

---

## Running all packages simultaneously

From the repo root:

```bash
pnpm dev
```

This starts server, dashboard, and all packages in watch mode in parallel.

---

## Common commands

```bash
# Type check all packages
pnpm typecheck

# Run all tests
pnpm test

# Test a specific package
pnpm --filter @gestalt/core test
pnpm --filter @gestalt/agents-generate test

# Test in watch mode
pnpm --filter @gestalt/core test -- --watch

# Lint all packages
pnpm lint

# Build all packages for production
pnpm build
# Outputs: packages/*/dist/, packages/dashboard/dist/

# Clean all build outputs
pnpm clean
```

---

## Package dependency order

When making changes, rebuild in this order if needed:

```
@gestalt/core
  └── @gestalt/adapter-postgres
        └── @gestalt/server
              └── @gestalt/cli

@gestalt/core
  └── @gestalt/agents-generate
  └── @gestalt/agents-quality-gate
  └── @gestalt/agents-deploy
  └── @gestalt/agents-maintenance
```

The dashboard has no internal package dependencies — it communicates only via the server API.

---

## First run after setup

```bash
# Create admin user (local auth, development only)
gestalt init local-admin

# Initialise a project
gestalt init

# Submit your first intent
gestalt run "Set up the initial project scaffold"

# Watch live activity
gestalt logs

# Open dashboard
gestalt dashboard   # opens http://localhost:5173 in dev mode
```

---

## Troubleshooting

**`Cannot find module '@gestalt/core'`**

Core packages need to be built first:

```bash
pnpm --filter @gestalt/core build
pnpm --filter @gestalt/adapter-postgres build
```

**Database connection refused**

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Check DATABASE_URL matches your POSTGRES_PASSWORD in .env
echo $DATABASE_URL
```

**Port 3000 already in use**

```bash
# Find and stop the conflicting process
lsof -ti:3000 | xargs kill
# Or change the port in .env: SERVER_PORT=3001
```

**LLM connection failures in dev**

The server logs will show the full error. Common causes:
- `LLM_BASE_URL` not set or wrong format
- API key expired or incorrect
- Corporate proxy blocking outbound requests — set `HTTP_PROXY` in `.env`

For all other issues: [Operations Runbook](../runbooks/common-issues.md)
