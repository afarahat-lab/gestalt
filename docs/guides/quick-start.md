# Quick Start — Gestalt

Get up and running in under 10 minutes using local authentication.
For production deployments with corporate identity integration, see the [Deployment Guide](./deployment.md).

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Docker Desktop | 4.25+ | macOS/Windows: [download here](https://www.docker.com/products/docker-desktop/). Must be running before `docker-compose up`. |
| Docker Compose | 2.20+ | Bundled with Docker Desktop |
| Git | 2.38+ | |
| LLM endpoint | — | Azure OpenAI, Ollama, vLLM, or compatible |

No Node.js installation required — the platform runs entirely in Docker.

> **macOS / Windows:** Open Docker Desktop and wait for the whale icon in the menu bar to stop animating before running any `docker` commands.

---

## Step 1 — Clone the repository

```bash
git clone https://github.com/afarahat-lab/gestalt.git
cd gestalt
```

---

## Step 2 — Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```bash
# Required: LLM provider
LLM_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/gpt-4o
LLM_API_KEY=your-azure-api-key
LLM_MODEL=gpt-4o

# Required: change these before any shared use
POSTGRES_PASSWORD=choose-a-strong-password
JWT_SECRET=choose-a-long-random-string

# Optional: leave as defaults for local development
SERVER_PORT=3000
POSTGRES_USER=gestalt
POSTGRES_DB=gestalt
```

**LLM provider options:**

```bash
# Azure OpenAI (recommended for corporate environments)
LLM_BASE_URL=https://<resource>.openai.azure.com/openai/deployments/<deployment>
LLM_API_KEY=<azure-api-key>
LLM_MODEL=gpt-4o

# Ollama (local, no API key needed)
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3

# vLLM (self-hosted)
LLM_BASE_URL=http://<vllm-host>:8000/v1
LLM_API_KEY=<your-key>
LLM_MODEL=<model-name>
```

---

## Step 3 — Start the platform

```bash
docker-compose up -d
```

This starts three containers:
- `gestalt-server` — the main server (port 3000)
- `gestalt-postgres` — PostgreSQL database
- `gestalt-redis` — Redis message queue

Wait for all containers to be healthy:

```bash
docker-compose ps
# All three containers should show "healthy"
```

---

## Step 4 — Initialize and create admin user

```bash
# Install the CLI (run once)
npm install -g @gestalt/cli

# Create the first admin user (local fallback mode)
gestalt init local-admin
# Follow the prompts: email + password

# You will see a non-production warning — this is expected for local auth
```

---

## Step 5 — Open the dashboard

Navigate to `http://localhost:3000` in your browser.

Log in with the admin credentials you just created.

You will see a yellow banner:
> ⚠️ Local authentication is active. This mode is not recommended for production.
> [Configure corporate identity integration →]

This is expected. For production, follow the [Identity Integration Guide](./identity/overview.md).

---

## Step 6 — Initialize your first project

```bash
gestalt init
```

The initializer will:
1. Confirm your LLM connection
2. Ask you to describe your project in natural language
3. Generate a complete harness for your project
4. Validate the harness and report ready

---

## Step 7 — Submit your first intent

```bash
gestalt run "Set up the initial project scaffold with folder structure and base configuration"
```

Watch the dashboard at `http://localhost:3000` to see agents working.

---

## Next steps

- [Deployment Guide](./deployment.md) — production installation for corporate IT
- [Identity Integration](./identity/overview.md) — connect to your corporate IdP
- [Configuration Reference](../reference/harness-config.md) — all HARNESS.json options
- [Operations Runbook](../runbooks/common-issues.md) — troubleshooting guide
