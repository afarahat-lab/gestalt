# Quick Start — Gestalt

Get Gestalt running on your machine in under 15 minutes.

---

## Overview

Gestalt has two distinct roles:

| Role | What it is | Who runs it |
|---|---|---|
| **Server** | The platform — runs Docker, hosts the database, queue, and API | Runs once on a server (or your local machine for testing) |
| **CLI** | Developer tool — submits intents, checks status | Installed on every developer's machine |

For local testing, your machine plays both roles.

---

## Part 1 — Server setup (run once)

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Docker Desktop | 4.25+ | [Download here](https://www.docker.com/products/docker-desktop/) — must be **running** before any docker command |
| Git | 2.38+ | |
| LLM endpoint | — | Azure OpenAI, Ollama, or any OpenAI-compatible API |

> **macOS / Windows:** Open Docker Desktop and wait for the whale icon in the menu bar to stop animating before proceeding.

### Step 1 — Clone the repository

```bash
git clone https://github.com/afarahat-lab/gestalt.git
cd gestalt
```

### Step 2 — Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```bash
# LLM provider — choose one:

# Azure OpenAI
LLM_BASE_URL=https://<resource>.openai.azure.com/openai/deployments/<deployment>
LLM_API_KEY=<your-api-key>
LLM_MODEL=gpt-4o

# Ollama (local, no API key needed)
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3

# Required
POSTGRES_PASSWORD=choose-a-strong-password
JWT_SECRET=choose-a-64-character-random-string
SERVER_BASE_URL=http://localhost:3000

# Required for local auth (development / first boot only)
NODE_ENV=development
```

Generate a secure JWT secret:
```bash
openssl rand -hex 64
```

### Step 3 — Start the platform

```bash
docker-compose up -d
```

Verify all three containers are healthy:
```bash
docker-compose ps
# agentforge-server    Up (healthy)
# agentforge-postgres  Up (healthy)
# agentforge-redis     Up (healthy)
```

Confirm the server is responding:
```bash
curl http://localhost:3000/health
# {"status":"ok","version":"0.0.0"}
```

### Step 4 — Create the first admin user

This step is run **once** after the first `docker-compose up`. It creates the platform admin account.

```bash
gestalt init-admin
```

You will be prompted for:
- Email address
- Display name
- Password (minimum 8 characters, hidden input)
- Confirm password

On success you will see:
```
✓ Admin user created. You are now signed in as admin@company.com.
```

> If you see `403 ADMIN_ALREADY_EXISTS`, an admin already exists.
> Run `gestalt login` instead. See [common issues](../runbooks/common-issues.md#admin-setup) if you need to reset.

---

## Part 2 — CLI setup (run once per developer machine)

The CLI is not published to npm. It is built from the repo and linked globally.

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ | |
| pnpm | 9.x | `npm install -g pnpm@9.15.4` — do not use pnpm 10+ |

### Step 5 — Build and install the CLI

```bash
# From the gestalt repo root
pnpm install
pnpm --filter @gestalt/cli build
cd packages/cli && npm link && cd ../..
```

Verify:
```bash
gestalt --version
gestalt --help
```

### Step 6 — Sign in

```bash
# If server is on this machine (local testing)
gestalt login

# If server is on a remote machine (production / team setup)
gestalt config set-server https://gestalt.company.com
gestalt login

# Or in one step
gestalt login --server https://gestalt.company.com
```

The server URL is saved to `~/.gestalt/config.json` after login and reused by
all subsequent commands. You can inspect the current config (without revealing
your token) any time with `gestalt config show`.

`--server <url>` works as a one-shot override on every command (`gestalt
status --server …`, `gestalt run … --server …`, etc.) — it is NOT persisted
on those commands; use `gestalt config set-server <url>` to change the
default.

---

## Part 3 — Project setup (run once per project)

### Step 7 — Create a project folder and Git remote

Per [ADR-032](../DECISIONS.md#adr-032--git-repository-is-the-project-filesystem),
Gestalt delivers all harness files and agent-generated code through Git. Create
an empty repo on your Git host first (GitHub / GitLab / Azure DevOps), then:

```bash
mkdir my-project && cd my-project
git init
git remote add origin https://github.com/yourorg/my-project.git
```

You also need a personal access token (PAT). The same token is used by the
platform to clone the repo, push the initial harness commit, AND drive any
CI/CD calls the deploy layer makes (PR creation, workflow dispatches,
environment promotions). Required scopes:

```
GitHub PAT (classic):
  - repo       (read/write repository, create PRs)
  - workflow   (trigger GitHub Actions workflows)

GitHub fine-grained PAT (per-repository):
  - Contents: read+write
  - Pull requests: read+write
  - Actions: read+write
  - Workflows: read+write

GitLab Project Access Token:
  - api
  - write_repository

Azure DevOps PAT:
  - Code (Read & Write)
  - Build (Read & Execute)
```

Without the workflow scope (or the equivalent for non-GitHub hosts), the
deploy layer's pipeline-agent will fail and the intent will be escalated
with a `GOLDEN_PRINCIPLE_BREACH` signal explaining the missing scope. Issue
the PAT before continuing.

### Step 8 — Initialise the project

```bash
gestalt init
```

The wizard will prompt for:
1. **Project name** — short identifier, e.g. `hr-portal`
2. **Git repository URL** — the remote you created above
3. **Default branch** — defaults to `main`
4. **Git personal access token** — hidden input, never logged

The server then:
- Registers the project (`POST /projects`)
- Clones the repo into a temp directory
- Writes the harness files (`AGENTS.md`, `HARNESS.json`, `docs/ARCHITECTURE.md`,
  `docs/DOMAIN.md`, `docs/GOLDEN_PRINCIPLES.md`, `docs/DECISIONS.md`)
- Commits with message `chore: initialise project harness [gestalt]` and pushes
  to the default branch
- Cleans up the temp directory

Pull the result down to your machine:

```bash
git pull   # in your local project folder
```

You now have the harness files locally. The platform will re-clone the repo on
every subsequent `gestalt run`, so any edits you commit + push will be picked up
on the next intent cycle.

---

## Part 4 — Daily use

### Step 9 — Submit your first intent

From inside your project folder:

```bash
gestalt run "Set up the initial project scaffold with folder structure"
```

Watch live agent activity:
```bash
gestalt logs
```

Check status:
```bash
gestalt status
```

Open the dashboard:
```bash
gestalt dashboard
# Opens http://localhost:3000/app/ in your browser
```

The dashboard SPA is served at `/app/*`. The bare server URL
(`http://localhost:3000/`) 302-redirects to `/app/`, so any URL you
copy from the address bar is shareable — paste it into a new tab or
send it to a teammate and the dashboard loads that exact view.

---

## Summary — command reference

| Command | When | Purpose |
|---|---|---|
| `docker-compose up -d` | Once (server) | Start the platform |
| `gestalt config show` | As needed | View current CLI config (URL, project, token presence) |
| `gestalt config set-server <url>` | First time / remote swap | Persist a server URL without logging in |
| `gestalt config reset` | Rarely | Sign out, clear project, restore default URL |
| `gestalt init-admin` | Once (server) | Create first admin user |
| `gestalt login` | Each machine | Authenticate the CLI |
| `gestalt init` | Once per project | Register project + seed harness in Git |
| `gestalt projects list` | As needed | List your registered projects |
| `gestalt projects use <name>` | As needed | Switch the current project |
| `gestalt projects set-adapter <name> <adapter>` | Once per CI swap | Switch pipeline adapter (`noop` ↔ `github-actions`) |
| `gestalt run "<intent>"` | Daily | Submit work to agents |
| `gestalt status` | Daily | Check platform and intent status |
| `gestalt logs` | Daily | Stream live agent activity |
| `gestalt dashboard` | Daily | Open oversight dashboard |

---

## Next steps

- [Development setup](./running.md) — running Gestalt from source for contributors
- [Deployment guide](./deployment.md) — production install for corporate IT
- [Identity integration](./identity/overview.md) — connect to your corporate IdP
- [HARNESS.json reference](../reference/harness-config.md) — full configuration reference
- [Common issues](../runbooks/common-issues.md) — troubleshooting
