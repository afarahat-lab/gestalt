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

`gestalt init` only seeds the harness files (`AGENTS.md`,
`HARNESS.json`, `agents.yaml`, `docs/*`, `.github/workflows/gestalt.yml`)
— it does NOT create application code. The repo has no `package.json`
yet, no `src/`, nothing to run. Application code comes from
`gestalt run`.

The first intent should scaffold the project foundation:

```bash
gestalt run "Scaffold the project foundation: create package.json for a
TypeScript application with pnpm as package manager, Vitest for testing,
and a src/ directory with src/index.ts as the entry point"
```

The pipeline workflow (`.github/workflows/gestalt.yml`) skips
`pnpm install` and `pnpm test` until a `package.json` exists, so the
first cycle won't fail on a missing scaffold — the CI step prints a
"skipping install — run `gestalt run` to scaffold" notice and the
deploy chain proceeds.

After the foundation lands, you can submit feature intents normally:

```bash
gestalt run "Add a hello-world REST endpoint at GET /hello"
```

Watch live agent activity:
```bash
gestalt logs                              # SSE stream of every event
gestalt agents active                     # currently-running agents
gestalt intent show <id> --watch          # re-renders the execution
                                          # graph every 3 seconds until
                                          # the intent reaches a
                                          # terminal status
gestalt status --id <id> --graph --watch  # same renderer via the
                                          # status namespace
```

`gestalt intent show` (and the equivalent `gestalt status --id <id>
--graph`) is the primary way to inspect a running or completed intent
from the CLI. The graph groups agent executions by layer (Generate →
Quality gate → Deploy) and inlines per-row details:

```
Generate
  ✓ intent-agent          4.0s
  ✓ code-agent            3.8s  1247 tokens
  ✓ docs-check-agent      903ms  244 tokens [custom]
Quality gate
  ✓ constraint-agent      2ms
  ✓ review-agent          1.4s
Deploy
  ✓ pr-agent              4.4s   PR #26
  ✓ pipeline-agent        21.6s  run #26847601876
  ✓ promotion-agent       4.3s   staging → production   ✓ auto-merged b7a61ae
```

`<id>` is either the full UUID or the 8-char `correlationId` prefix
the table forms show.

Check status (summary mode — no `--graph`):
```bash
gestalt status                            # platform overview + recent intents
gestalt intent list                       # table view of recent intents
gestalt deploy list                       # recent deployments
gestalt maintenance list                  # recent maintenance runs
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

## Customising agents

### Tune framework agents

Edit `agents.yaml` in your project repo (seeded by `gestalt init` alongside
`HARNESS.json`) to change model, temperature, or prompt extensions for any
framework agent. The file is read fresh from each per-cycle clone (ADR-032),
so an edit + push takes effect on the next intent without a server restart:

```yaml
agents:
  code-agent:
    llm:
      model: gpt-4o          # null = platform default
      temperature: 0.1
    prompt_extensions:
      - "Always use the Result<T,E> pattern for error handling"
      - "Add a JSDoc comment to every exported function"
```

`prompt_extensions` are appended verbatim to the agent's prompt under a
`## Project-specific instructions` heading. They give the project team a
way to add standing rules that apply to every call without modifying
framework code.

### Add custom agents

Define project-specific LLM agents under `custom_agents` in `agents.yaml`.
They run after the framework generate agents (intent / design / context /
lint-config / code / test) and BEFORE dispatch to the quality gate, so
their findings reach the gate as signals:

```yaml
custom_agents:
  - name: security-review-agent
    role: "Application security reviewer"
    goal: "Identify OWASP Top 10 vulnerabilities in generated code"
    llm:
      model: ~              # platform default
      temperature: 0.1
      max_tokens: 4000
    prompt: |
      You are {{role}}. Goal: {{goal}}.

      Review the following generated code for OWASP Top 10 issues:
      {{artifacts}}

      Project golden principles:
      {{goldenPrinciples}}

      Return JSON only:
      {
        "passed": true|false,
        "findings": [
          { "severity": "high|medium|low", "file": "path", "description": "..." }
        ],
        "summary": "..."
      }
```

Prompt placeholders the runner provides:

- `{{role}}`, `{{goal}}` — fields on the definition
- `{{artifacts}}` — generated code files (`code` type only), truncated to
  2000 chars each
- `{{goldenPrinciples}}` — bullet list of GP-NNN titles + descriptions
- `{{intentText}}` — operator's original intent string
- `{{projectName}}` — `HARNESS.json` `name` field

The orchestrator routes the agent's findings to typed signals:

- `high` → `CONSTRAINT_VIOLATION`
- `medium` / `low` → `LINT_FAILURE`
- LLM error or parse failure → `CONTEXT_GAP`

Custom agents **never** emit `GOLDEN_PRINCIPLE_BREACH`. They do not block
the cycle directly — the gate orchestrator evaluates all signals and makes
the final pass / fail / escalate verdict.

### Verify your configuration

```bash
gestalt agents list <projectName>      # show framework + custom agents
gestalt agents validate <projectName>  # check agents.yaml parses + valid
```

---

## Authoring custom templates

The harness files committed to every new project (`AGENTS.md`,
`HARNESS.json`, `agents.yaml`, `docs/*`, `.github/workflows/gestalt.yml`)
come from a platform-admin-managed template. Operators who want to ship
their own conventions can either start from the built-in template or
edit a custom one in place.

### Starting from the built-in template

```bash
# 1. Download the built-in as a starting point
gestalt platform templates download corporate-ops-web-mobile \
  --output ./my-template.zip

# 2. Unzip, modify files locally (AGENTS.md / HARNESS.json /
#    constraint rules / architecture patterns), then re-zip
unzip my-template.zip -d ./my-template
# ... edit files ...
cd my-template && zip -r ../my-template.zip . && cd -

# 3. Upload as a new custom template
gestalt platform templates upload ./my-template.zip
# Prompts for name / slug / tier / version
```

### Editing a template in place

For small tweaks, duplicate the built-in and edit through the platform:

```bash
# 1. Duplicate the built-in (built-ins are read-only)
gestalt platform templates duplicate corporate-ops-web-mobile \
  --name "My Template" --new-slug my-template

# 2. Edit files via $EDITOR
gestalt platform templates edit my-template harness/AGENTS.md
# Opens $EDITOR with the current AGENTS.md content; saving + exiting
# pushes the change. Use --content "<string>" to skip the editor.

# 3. Add a new file (e.g. operator-runbook.md)
gestalt platform templates add-file my-template docs/RUNBOOK.md

# 4. Remove a non-required file
gestalt platform templates remove-file my-template docs/DECISIONS.md

# 5. Inspect what variables the template uses
gestalt platform templates inspect my-template

# 6. Set as default so `gestalt init` uses it
gestalt platform templates set-default my-template
```

The same surface is available in the dashboard at
`/app/admin/templates` — each row has `[↓ Download]`, `[⎘ Duplicate]`,
and (for custom rows) `[✎ Edit]` buttons. The edit panel renders a
file tree on the left + a textarea editor on the right with per-file
save / discard / delete + a "save all changes" button at the bottom.

### Constraints

- **Built-in templates are read-only.** `PATCH /files` and
  `DELETE /files/*` return `400 BUILTIN_TEMPLATE`. Duplicate first.
- **Required files cannot be removed** — `AGENTS.md`, `HARNESS.json`,
  and `agents.yaml` (by basename). `remove-file` returns
  `400 REQUIRED_FILE` on these. They can still be EDITED.
- **PATCH /files is a MERGE not a REPLACE.** Only the keys you supply
  change; other files are preserved. Saving one file doesn't wipe
  adjacent state.
- **Audit metadata records changed file NAMES only** — never content.
  GP-006 holds: a forensics operator can see who-changed-what but
  never the file content from `audit_log`.

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
| `gestalt project config show` | As needed | Show all six config sections (pipeline / agents / custom agents / tools / members / LLMs) |
| `gestalt project config set-agent <role>` | As needed | Patch a framework agent's LLM / persona / prompt extensions |
| `gestalt project config add-custom-agent` | As needed | Interactive — add a custom agent (commits to project repo) |
| `gestalt project config set-tools <role>` | As needed | Toggle built-in tools or add/remove MCP servers per agent |
| `gestalt project config set-pipeline` | As needed | Adapter / auto-merge / merge method (replaces `set-adapter`) |
| `gestalt project members list / add / remove / role` | As needed | Manage members of the current project (project-admin) |
| `gestalt run "<intent>"` | Daily | Submit work to agents |
| `gestalt status` | Daily | Check platform and intent status |
| `gestalt status --id <id> --graph [--watch]` | Daily | Execution-flow graph for an intent (live re-render with --watch) |
| `gestalt logs` | Daily | Stream live agent activity |
| `gestalt dashboard` | Daily | Open oversight dashboard |
| `gestalt intent list` | Daily | Table of recent intents (status / priority / age / text) |
| `gestalt intent show <id> [--watch]` | Daily | Execution-flow graph for one intent |
| `gestalt intent submit "<text>"` | Discoverability | Alias of `gestalt run` |
| `gestalt gate show <id>` | As needed | Quality-gate verdict + per-check status + signals |
| `gestalt deploy list` | As needed | Recent deployments with status, branch, PR link |
| `gestalt deploy show <id>` | As needed | Deployment timeline with timestamps |
| `gestalt maintenance list` | As needed | Recent maintenance runs (fixes / intents queued) |
| `gestalt maintenance show <runId>` | As needed | Maintenance run detail + findings list |
| `gestalt agents active [--project <name>]` | As needed | Currently-running agents with intent text + token total |
| `gestalt agents list <name>` | As needed | Show framework + custom agents for a project |
| `gestalt agents validate <name>` | As needed | Validate `agents.yaml` and report warnings |
| `gestalt platform templates list` | As needed | List registered harness templates |
| `gestalt platform templates download <slug> [--output <path>]` | Authoring | Download a template as a ZIP |
| `gestalt platform templates duplicate <slug> --name <n> --new-slug <s>` | Authoring | Copy a template into a new editable one |
| `gestalt platform templates edit <slug> <filePath> [--content <str>]` | Authoring | Edit a single file in a custom template ($EDITOR fallback) |
| `gestalt platform templates add-file <slug> <filePath>` | Authoring | Add a new file to a custom template |
| `gestalt platform templates remove-file <slug> <filePath>` | Authoring | Remove a non-required file from a custom template |
| `gestalt platform templates inspect <slug>` | Authoring | List files + per-`{{variable}}` usage |
| `gestalt platform templates set-default <slug>` | Authoring | Make `<slug>` the default for `gestalt init` |

---

## Next steps

- [Development setup](./running.md) — running Gestalt from source for contributors
- [Deployment guide](./deployment.md) — production install for corporate IT
- [Identity integration](./identity/overview.md) — connect to your corporate IdP
- [HARNESS.json reference](../reference/harness-config.md) — full configuration reference
- [Common issues](../runbooks/common-issues.md) — troubleshooting
