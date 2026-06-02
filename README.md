# Gestalt

An open-source, self-hosted agent-first platform that automates the full Software Development Lifecycle for corporate operations web and mobile applications.

Gestalt replaces manual development cycles with a closed-loop system of specialised AI agents — handling design, code generation, quality enforcement, deployment, and continuous maintenance — while keeping humans in strategic control.

---

## How it works

```
You write:   "Add a leave request approval workflow with manager and HR stages"
Agents do:   Design → Context → Code → Tests → Review → Deploy → Maintain
You see:     A dashboard showing every decision, signal, and outcome
```

---

## Getting started

Gestalt has two parts: a **server** (runs once, hosts the platform) and a **CLI** (installed on each developer's machine).

### 1. Start the server

```bash
git clone https://github.com/afarahat-lab/gestalt.git
cd gestalt
cp .env.example .env        # fill in LLM credentials, POSTGRES_PASSWORD, JWT_SECRET
                            # set NODE_ENV=development for local/first-boot use
docker-compose up -d
curl http://localhost:3000/health   # should return {"status":"ok"}
```

### 2. Create the first admin user (once)

```bash
gestalt init-admin
```

### 3. Install the CLI (each developer machine)

```bash
# From the gestalt repo root
pnpm install
pnpm --filter @gestalt/cli build
cd packages/cli && npm link && cd ../..

gestalt login
```

### 4. Set up a project

Per [ADR-032](docs/DECISIONS.md), Gestalt delivers harness files and agent-generated
code through Git. Create an empty repo on your Git host first (GitHub / GitLab /
Azure DevOps) and a personal access token with read+write on it.

```bash
gestalt init
# Prompts: project name, Git URL, default branch, Git token, description.
# The server registers the project, clones the repo, writes the harness
# files, commits with "chore: initialise project harness [gestalt]",
# and pushes to the default branch.

cd /path/to/your/local/clone
git pull        # AGENTS.md, HARNESS.json, docs/* arrive locally
```

### 5. Submit your first intent

```bash
gestalt run "Set up the initial project scaffold"
gestalt status
gestalt intent show <id> --watch    # live execution-flow graph
gestalt dashboard                   # opens http://localhost:3000/app/
```

Agent-generated changes are committed and pushed back to the same Git repo —
`git pull` again to receive them.

**Full walkthrough:** [docs/guides/quick-start.md](docs/guides/quick-start.md)

### 6. Inspect what happened

The CLI surfaces the same data the dashboard does — every command works
against a single intent or browses recent activity:

| Command | What it shows |
|---|---|
| `gestalt intent list [--status <s>] [--project <name>]` | Table of intents (id, status, priority, age, text). |
| `gestalt intent show <id> [--watch]` | Full execution-flow graph (Generate → Gate → Deploy → Signals). `--watch` re-renders every 3s until terminal status. |
| `gestalt intent submit "<text>"` | Alias of `gestalt run` for noun-verb discoverability. |
| `gestalt gate show <id>` | Quality-gate verdict + per-check status + signals for one cycle. |
| `gestalt deploy list` | Recent deployments with status, branch, PR link. |
| `gestalt deploy show <id>` | Deployment timeline (PR → pipeline → staging → production → merged) with timestamps. |
| `gestalt maintenance list` | Recent maintenance runs (fixes, intents queued, duration). |
| `gestalt maintenance show <runId>` | Run detail with the findings list. |
| `gestalt agents active [--project <name>]` | Currently-running agent executions with intent text, elapsed time, token total, cycle progress. |
| `gestalt status --id <id> --graph [--watch]` | Same execution-flow graph as `intent show`, accessed via the `status` namespace. |

All commands accept an `<id>` as either a full UUID or an 8-char `correlationId`
prefix — same form the list tables print.

---

## SDLC coverage

| Phase | Gestalt capability |
|---|---|
| Requirements | Intent capture → structured spec |
| Architecture | Harness initializer generates architecture from project context |
| Design | Domain model, API contracts, component specs |
| Development | TypeScript code within harness constraints |
| Testing | Tests generated from success criteria |
| Code review | Architectural constraint enforcement |
| Security | OWASP ruleset on every change |
| Deployment | PR, CI/CD pipeline, environment promotion |
| Maintenance | Background agents — doc drift, arch realignment, GC |
| Monitoring | Evaluation agents analyse metrics, queue fixes |

---

## Architecture

```
Human intent
     │
     ▼
Generate layer        (design · context · code · tests)
     │
     ▼
Quality gate layer    (constraints · lint · tests · security)
     │
     ▼
Merge & deploy layer  (PR · CI/CD · environment promotion)
     │
     ▼
Maintenance layer     (drift · alignment · GC · evaluation)
     │
     ▼
Human oversight       (dashboard · alerts · intervention)
```

---

## Repository structure

```
gestalt/
├── packages/
│   ├── core/              # harness engine, LLM, queue, repository
│   ├── cli/               # gestalt CLI tool
│   ├── server/            # Fastify server + auth + oversight API
│   ├── dashboard/         # React oversight dashboard
│   ├── agents/
│   │   ├── generate/      # intent, design, context, code, test agents
│   │   ├── quality-gate/  # lint, security, constraint, test-runner, review
│   │   ├── deploy/        # PR, pipeline, promotion agents
│   │   └── maintenance/   # drift, alignment, GC, evaluation agents
│   └── adapters/
│       ├── postgres/      # PostgreSQL (default)
│       ├── oracle/        # Oracle
│       └── mssql/         # SQL Server
├── templates/
│   └── corporate-ops-web-mobile/   # Tier 1 standard harness
├── docs/
│   ├── guides/            # setup, deployment, identity integration
│   ├── reference/         # configuration reference
│   └── runbooks/          # troubleshooting
├── AGENTS.md              # agent orientation for this repo
├── CLAUDE.md              # Claude Code orientation
└── docker-compose.yml
```

---

## Platform decisions

| Concern | Decision |
|---|---|
| Runtime | Self-hosted server |
| Developer interface | CLI (`gestalt` command) |
| Agent model | Ephemeral workers (BullMQ + Redis) |
| Primary database | PostgreSQL — Oracle and SQL Server adapters available |
| LLM provider | Configurable: Azure OpenAI · Ollama · vLLM |
| Authentication | Windows Kerberos · SAML 2.0 · OIDC · local fallback |
| Frontend | React 18 + Vite |
| Backend | Node.js 20 / TypeScript / Fastify |

---

## Documentation

| Guide | Audience |
|---|---|
| [Quick start](docs/guides/quick-start.md) | Everyone — step-by-step setup |
| [Development setup](docs/guides/running.md) | Contributors — running from source |
| [Deployment guide](docs/guides/deployment.md) | Corporate IT — production install |
| [Identity integration](docs/guides/identity/overview.md) | IT admins — Kerberos, SAML, Azure AD |
| [HARNESS.json reference](docs/reference/harness-config.md) | Operators — full config reference |
| [Common issues](docs/runbooks/common-issues.md) | Everyone — troubleshooting |
| [Architecture](docs/ARCHITECTURE.md) | Contributors — system design |
| [Architecture decisions](docs/DECISIONS.md) | Contributors — all ADRs |

---

## License

MIT
