# AgentForge SDLC

An open-source, self-hosted agent-first platform that automates the full Software Development Lifecycle (SDLC) for corporate operations web and mobile applications.

AgentForge SDLC replaces manual development cycles with a closed-loop system of specialized AI agents — handling everything from design and code generation through quality enforcement, deployment, and continuous maintenance — while keeping humans in strategic control.

---

## What it does

Traditional SDLC requires humans at every stage: design, code, review, test, deploy, maintain. AgentForge SDLC restructures this so agents handle execution and humans handle intent and oversight.

```
You write:   "Add a leave request approval workflow with manager and HR stages"
Agents do:   Design → Context → Code → Tests → Review → Deploy → Maintain
You see:     A dashboard showing every decision, signal, and outcome
```

---

## SDLC coverage

| SDLC Phase | AgentForge SDLC capability |
|---|---|
| Requirements | Intent capture + design agent translates to structured spec |
| Architecture | Harness initializer generates architecture from project context |
| Design | Design agent produces domain model, API contracts, component specs |
| Development | Code agent generates application code within harness constraints |
| Testing | Test agent generates and runs test cases from success criteria |
| Code review | Constraint agent enforces architectural rules automatically |
| Security | Security agent runs OWASP ruleset on every change |
| Deployment | Deploy agent manages PR, CI/CD pipeline, and environment promotion |
| Maintenance | Background agents handle doc drift, arch realignment, and GC |
| Monitoring | Evaluation agents analyze runtime metrics and feed back to generate |

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
git clone https://github.com/afarahat-lab/agentforge-sdlc.git
cd agentforge-sdlc
cp .env.example .env
# Edit .env with your LLM endpoint, DB config, and auth settings
docker-compose up -d
agentforge init
```

### CLI usage

```bash
agentforge init              # initialize a new project — LLM-powered interview generates full harness
agentforge run "<intent>"    # submit an intent to the generate layer
agentforge status            # view current agent activity
agentforge logs              # tail the execution log
agentforge dashboard         # open the oversight dashboard
```

---

## Repository structure

```
agentforge-sdlc/
├── docs/                          # platform architecture and decisions
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   ├── DOMAIN.md
│   └── GOLDEN_PRINCIPLES.md
├── packages/
│   ├── core/                      # core harness engine
│   ├── cli/                       # agentforge CLI tool
│   ├── server/                    # self-hosted server
│   ├── dashboard/                 # React oversight dashboard
│   ├── agents/
│   │   ├── generate/              # generation agents (design, context, code, test)
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
├── HARNESS.json                   # machine-readable harness metadata
├── docker-compose.yml
└── package.json
```

---

## Platform decisions

| Concern | Decision |
|---|---|
| Runtime | Self-hosted server |
| Developer interface | CLI (`agentforge` command) |
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

## Harness registry tiers

- **Tier 1 — Standard library**: ships with the framework, curated by maintainers
- **Tier 2 — Verified registry**: community-contributed, reviewed and badged
- **Tier 3 — Community registry**: open contributions, experimental

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute harness patterns and adapters.

---

## License

MIT
