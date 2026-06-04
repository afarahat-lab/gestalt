# ARCHITECTURE.md — Gestalt platform reference

_Read on demand — not loaded every session. Reach for this file when
modifying package boundaries, adding a new adapter / agent, or fixing
type drift between core and downstream packages._

---

## What this project is

Gestalt is a self-hosted agent-first platform that automates the full
Software Development Lifecycle. TypeScript monorepo using pnpm
workspaces. The platform is built on the same principles it enforces
in client projects: context files guide agents, the harness is a
first-class artifact, and every package has a README.md that serves
as the agent's local orientation document.

The four SDLC layers are all wired end-to-end:

```
human intent → generate → quality-gate → deploy → deployed
                                ↑                     │
                                └── maintenance ──────┘
```

---

## Monorepo structure

```
packages/
  core/               — shared types, LLM, queue, repository, harness
                        engine, agents/base-llm-agent, secrets/vault,
                        tools (file-tools, mcp-client, mcp-resolver),
                        events bus, projects/credential-resolver
  server/             — Fastify server, auth, oversight API, identity
                        providers (local, kerberos, saml, oidc),
                        templates engine
  cli/                — gestalt CLI tool
  dashboard/          — React oversight dashboard (SPA at /app/*)
  adapters/
    postgres/         — PostgreSQL adapter (reference implementation)
    oracle/           — Oracle adapter (throw-stubs for every method)
    mssql/            — SQL Server adapter (throw-stubs)
  agents/
    generate/         — intent, design, context, code, test, lint-config
                        + custom agent runner + orchestrator
    quality-gate/     — constraint, review (LLM) + gate orchestrator
    deploy/           — pr, pipeline, promotion + deploy orchestrator
                        + PipelineAdapter (GitHubActions, NoOp)
    maintenance/      — drift, alignment, gc, evaluation, context-fixer
                        + maintenance scheduler + MonitoringAdapter
                        (Prometheus, Datadog, NoOp)
templates/
  corporate-ops-web-mobile/   — Tier 1 harness template
                                (built-in; seeded into platform_templates
                                table at server boot)
docs/
  guides/             — quick-start, running (dev setup), deployment,
                        identity (kerberos / saml / oidc / role-mapping)
  reference/          — harness-config.md
  runbooks/           — common-issues.md
  ARCHITECTURE.md     — full system design (project-level — different
                        from this file)
  DECISIONS.md        — all ADRs (project-level — different from
                        @docs/claude/DECISIONS.md which is the index)
fixtures/
  identity-test/      — Keycloak fixture for SAML/OIDC integration tests
```

---

## Package dependency order

Build order is enforced by package dependencies, not by a custom
orchestrator (per ADR-006).

```
@gestalt/core
  └── @gestalt/adapter-postgres
  └── @gestalt/agents-generate
        └── @gestalt/agents-quality-gate
        └── @gestalt/agents-deploy
        └── @gestalt/agents-maintenance
              └── @gestalt/server
                    └── @gestalt/cli
@gestalt/dashboard   (no internal package deps — talks to server via HTTP)
```

- `@gestalt/core` exports the BaseLLMAgent + BaseOrchestrator that every
  agent layer extends, so the agent packages all depend on it.
- `@gestalt/agents-quality-gate` and `@gestalt/agents-maintenance`
  depend on `@gestalt/agents-generate` for `loadAgentConfig` +
  `loadCustomAgents` (the shared agents.yaml loader).
- `@gestalt/server` depends on every agent package so it can register
  the orchestrator workers at boot.
- `@gestalt/cli` depends only on `@gestalt/server`'s types through
  the public API surface.
- `@gestalt/dashboard` is HTTP-only (does not import any internal
  package); the SPA bundle is served by `@gestalt/server` at `/app/*`.

---

## Key type alignment rules

The `@gestalt/agents-generate` package has its own local
`ContextSnapshot`, `FeedbackSignal`, and `AgentConfig` types that
must stay aligned with their counterparts in `@gestalt/core`:

- `FeedbackSignal` must include `autoResolvable: boolean` and
  `createdAt: Date`.
- `ContextSnapshot` must include `projectRoot`, `architectureMd`,
  `domainMd`, `priorSignals`, and `agentConfig`.
- `AgentRole` values must match the union in
  `@gestalt/core/src/types.ts`. Adding a new role requires updating
  both files in lockstep.
- `AgentConfig` / `AgentToolConfig` / `CustomAgentDefinition`
  re-export from `@gestalt/core/agents/agent-config` since the
  BaseLLMAgent-to-core refactor (2026-06-02). Local declarations in
  the agents-generate types file are re-exports, not duplicates.

When a new repository method is added to `@gestalt/core`, every
adapter (postgres + oracle + mssql) must implement it — at minimum
as a throw-stub so build-time interface drift surfaces immediately.
This convention is enforced through compile errors, not lint rules.

---

## Adapter interface contract

All persistent state lives behind the repository interface in
`@gestalt/core/repository`. Adapters expose a `createXxxAdapter()`
factory that returns a `RepositoryRegistry`. Three rules:

1. No direct DB access outside an adapter package — every consumer
   imports `getRepositories()` from `@gestalt/core/repository` and
   reads through the typed interface.
2. Adapter packages never import from each other or from any agent
   package — they only import types from `@gestalt/core`.
3. Postgres is the reference implementation. Oracle + MSSQL stubs
   must accept the same method signatures (even if every method
   throws) so a future operator who switches the `DATABASE_URL`
   gets a clear "not implemented" error rather than a missing
   method panic.

---

## Agent execution model

Per ADR-002 (ephemeral workers), every agent is a stateless BullMQ
consumer. Each task is self-contained:

- Input: the BullMQ payload + a fresh per-cycle clone of the
  project's Git repo + a context snapshot built by the orchestrator.
- Output: typed signals (one of LINT_FAILURE / TEST_FAILURE /
  CONSTRAINT_VIOLATION / CONTEXT_GAP / GOLDEN_PRINCIPLE_BREACH) and
  artifacts (file content keyed by path).

Agents NEVER:

- Keep module-level state between tasks.
- Call another agent directly — every inter-layer dispatch goes via
  `dispatch()` to a BullMQ queue.
- Call a database directly — every read/write goes through
  `getRepositories()`.
- Call an LLM provider SDK directly — every LLM call goes through
  `@gestalt/core/llm`.

The base class `BaseLLMAgent` (in `@gestalt/core/agents`) owns the
shared LLM call surface: instance-captured `lastPrompt` /
`lastLlmResponse` / `lastModelUsed`, `callLLM` /
`callLLMWithMessages` / `callLLMWithTools` /
`callLLMWithToolsMessages`, tool-use loop with namespace-aware
dispatch (built-in vs MCP), and the canonical CONTEXT_GAP signal
builder. Every LLM-using agent in every layer extends this class.

---

## Event bus + SSE

A single in-process event bus lives in `@gestalt/core/events` as a
module-level singleton. The server's `/events` SSE route subscribes
to the bus and forwards events to authenticated clients. Orchestrators
and agents emit on the same bus — never import from server-side
code.

Events: `intent.created`, `intent.status-changed`, `agent.started`,
`agent.completed`, `signal.emitted`, `deployment.updated`,
`alert.created`, `alert.acknowledged`, `alert.auto-resolved`,
`gate.completed`, `maintenance.run-completed`, `project.deleted`.

---

## Where to find specific implementation details

| Concern | File |
|---|---|
| ADRs (full text) | `docs/DECISIONS.md` |
| ADR index for Claude | `docs/claude/DECISIONS.md` |
| Coding constraints | `docs/claude/CONSTRAINTS.md` |
| Build status + migration count | `docs/claude/BUILD.md` |
| Current capabilities | `docs/claude/STATE.md` |
| Recent sessions | `docs/claude/sessions/RECENT.md` |
| Historical sessions | `docs/claude/sessions/archive/*.md` |
| Harness schema | `docs/reference/harness-config.md` |
| Onboarding | `docs/guides/quick-start.md` |
| Common runbook entries | `docs/runbooks/common-issues.md` |
| Per-package conventions | each package's `README.md` |
