# OpenHarness

An open-source, self-hosted agent-first software development platform for corporate operations web and mobile applications.

OpenHarness provides a closed-loop autonomous development environment where AI agents handle code generation, quality enforcement, deployment, and continuous maintenance — while humans set intent, define guardrails, and monitor outcomes.

---

## Core concepts

**Harness** — the complete set of constraints, feedback loops, documentation structures, and tooling that guides AI agents toward reliable, maintainable output. The harness is a first-class artifact in every project.

**Agent-first** — humans write intent. Agents execute. The platform is designed so that every development task — from scaffolding to refactoring to documentation — is handled by a specialized agent operating within a well-defined harness.

**Closed loop** — generate → quality gate → deploy → maintain → evaluate → generate. The loop runs autonomously at machine speed, with human intervention triggered only by escalation conditions.

---

## Architecture

```
Human intent
     │
     ▼
Generate layer        (design · context files · code · tests · linters)
     │
     ▼
Quality gate layer    (architectural constraints · linting · tests · security)
     │
     ▼
Merge & deploy layer  (PR management · CI/CD · environment promotion)
     │
     ▼
Maintenance layer     (doc drift · arch realignment · garbage collection)
     │
     ▼
Evaluation layer      (metrics · degradation detection · feedback → generate)
     │
     ▼
Human oversight       (dashboard · logs · alerts · intervention gates)
```

Full architecture documentation: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Getting started

### Prerequisites

- Docker and Docker Compose
- Git
- A configured LLM endpoint (Azure OpenAI, Ollama, vLLM, or compatible)

### Install

```bash
git clone https://github.com/your-org/openharness.git
cd openharness
cp .env.example .env
# Edit .env with your LLM endpoint, DB config, and auth settings
docker-compose up -d
harness init
```

### CLI usage

```bash
harness init              # initialize a new project with a generated harness
harness run "<intent>"    # submit an intent to the generate layer
harness status            # view current agent activity
harness logs              # tail the execution log
harness dashboard         # open the oversight dashboard
```

---

## Repository structure

```
openharness/
├── docs/                          # platform architecture and decisions
├── packages/
│   ├── core/                      # core harness engine
│   ├── cli/                       # harness CLI tool
│   ├── server/                    # self-hosted server
│   ├── dashboard/                 # React oversight dashboard
│   ├── agents/
│   │   ├── generate/              # generation agents
│   │   ├── quality-gate/          # quality enforcement agents
│   │   ├── deploy/                # merge and deploy agents
│   │   └── maintenance/           # background maintenance agents
│   └── adapters/
│       ├── postgres/              # PostgreSQL adapter (default)
│       ├── oracle/                # Oracle adapter
│       └── mssql/                 # SQL Server adapter
├── templates/
│   └── corporate-ops-web-mobile/  # Tier 1 standard library harness
├── AGENTS.md                      # agent orientation for this repo
├── docker-compose.yml
└── package.json
```

---

## Platform decisions

| Concern | Decision |
|---|---|
| Runtime | Self-hosted server |
| Developer interface | CLI (`harness` command) |
| Agent model | Ephemeral workers |
| Message queue | BullMQ (Redis-backed) |
| Primary database | PostgreSQL (configurable) |
| DB adapters | PostgreSQL · Oracle · SQL Server |
| LLM provider | Configurable (Azure OpenAI · Ollama · vLLM) |
| Frontend | React |
| Backend | Node.js / TypeScript |
| Target domain | Corporate operations web and mobile |

Full decision log: [docs/DECISIONS.md](docs/DECISIONS.md)

---

## Contributing

OpenHarness uses a three-tier registry model:

- **Tier 1 — Standard library**: ships with the framework, curated by maintainers
- **Tier 2 — Verified registry**: community-contributed, reviewed and badged
- **Tier 3 — Community registry**: open contributions, experimental

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute harness patterns and adapters.

---

## License

MIT
