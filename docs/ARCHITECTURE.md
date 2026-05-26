# Architecture — OpenHarness

Version: 0.1.0
Last updated: 2026-05
Status: In design

---

## Overview

OpenHarness is a self-hosted, closed-loop agent-first software development platform. It targets corporate operations web and mobile applications. The platform enables development teams to operate at an order-of-magnitude higher velocity by delegating code generation, quality enforcement, deployment, and maintenance to specialized AI agents — while keeping humans in strategic control.

The central concept is the **harness**: the complete set of constraints, feedback loops, documentation structures, and tooling that guides agents toward reliable, maintainable output. The harness is a first-class artifact — versioned, evolved, and maintained alongside the code it governs.

---

## Deployment model

OpenHarness runs as a self-hosted server within the client's infrastructure. There is no cloud dependency. All agent execution, state, and data remain within the corporate perimeter.

**Install story:**
```
git clone → docker-compose up → harness init
```

The `docker-compose.yml` brings up the OpenHarness server, PostgreSQL (or configured DB), and Redis together as a single deployable unit.

---

## System layers

```
┌─────────────────────────────────────────────┐
│              Human layer                     │
│  Intent · guardrails · oversight dashboard   │
└────────────────────┬────────────────────────┘
                     │ intent
                     ▼
┌─────────────────────────────────────────────┐
│            Generate layer                    │
│  Design · context files · code · tests       │
└────────────────────┬────────────────────────┘
                     │
              ┌──────┘ retry on failure
              ▼
┌─────────────────────────────────────────────┐
│           Quality gate layer                 │
│  Constraints · linting · tests · security    │
└────────────────────┬────────────────────────┘
                     │ approved
                     ▼
┌─────────────────────────────────────────────┐
│          Merge & deploy layer                │
│  PR management · CI/CD · promotion           │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│         Continuous maintenance layer         │
│  ┌──────────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Monitoring  │→│  Eval    │→│  Maint.  │ │
│  │  agents      │ │  agents  │ │  agents  │ │
│  └──────────────┘ └──────────┘ └──────────┘ │
└─────────────────────────────────────────────┘
                     │ feedback → generate
                     ▼
┌─────────────────────────────────────────────┐
│           Human oversight                    │
│  Dashboard · logs · alerts · gates           │
└─────────────────────────────────────────────┘
```

---

## Package structure

### `@openharness/core`
The nervous system. All other packages depend on this; it depends on nothing internal.

Responsibilities:
- Harness engine (context file management, versioning, validation)
- Agent communication protocol (message envelope, queue interface)
- Feedback signal taxonomy (typed signal definitions)
- LLM provider abstraction (`core/llm`)
- Repository pattern interface (`core/repository`)
- Configuration loader (`core/config`)
- Platform logger (`core/logger`)

### `@openharness/cli`
The developer-facing interface. Communicates with the server over HTTP.

Commands: `init` · `run` · `status` · `logs` · `dashboard`

### `@openharness/server`
The self-hosted server. Built with Fastify. Exposes REST API consumed by the CLI and dashboard.

Responsibilities:
- Receives intent from CLI
- Dispatches tasks to the message queue
- Manages project state
- Serves the dashboard
- Exposes oversight API (logs, status, metrics)

### `@openharness/dashboard`
React-based oversight UI. Served by the server.

Views: intent history · active agents · quality gate results · deployment status · maintenance activity · alert feed

### `@openharness/agents/generate`
Orchestrates the generation of all project artifacts from intent.

Sub-agents:
- `design-agent` — translates intent into design spec and success criteria
- `context-agent` — creates and updates AGENTS.md, ARCHITECTURE.md, DOMAIN.md
- `code-agent` — generates application code
- `test-agent` — generates test cases from success criteria
- `lint-config-agent` — generates linter configuration

### `@openharness/agents/quality-gate`
Enforces the harness. Never generates — only validates and signals.

Sub-agents:
- `constraint-agent` — checks architectural rules from ARCHITECTURE.md
- `test-runner-agent` — executes test suite and collects results
- `lint-agent` — runs static analysis
- `security-agent` — runs security scan (OWASP ruleset)
- `review-agent` — synthesizes all signals into a typed gate result

### `@openharness/agents/deploy`
Manages the promotion of approved changes.

Sub-agents:
- `pr-agent` — creates, updates, and merges pull requests
- `pipeline-agent` — triggers and monitors CI/CD pipeline
- `promotion-agent` — manages environment promotion (dev → staging → prod)

### `@openharness/agents/maintenance`
Background agents running continuously.

Sub-agents:
- `drift-agent` — detects documentation drift (context files out of sync with code)
- `alignment-agent` — detects code that has drifted from architectural standards
- `gc-agent` — runs garbage collection (duplicate logic, dead code, outdated patterns)
- `evaluation-agent` — analyzes runtime metrics and emits feedback to generate layer

### `@openharness/adapters/postgres`
PostgreSQL repository implementation. The reference adapter.

### `@openharness/adapters/oracle`
Oracle repository implementation.

### `@openharness/adapters/mssql`
SQL Server repository implementation.

---

## Agent communication

All inter-agent communication is asynchronous via BullMQ (Redis-backed). Agents are ephemeral workers — they start, consume a task message, emit results, and terminate.

**Task message envelope:**
```typescript
interface TaskMessage<T = unknown> {
  id: string;                    // uuid
  correlationId: string;         // ties all messages in one intent cycle
  type: TaskType;                // typed enum
  sourceAgent: AgentRole;
  targetAgent: AgentRole | 'orchestrator';
  priority: TaskPriority;
  payload: T;
  contextSnapshot: ContextSnapshot;
  createdAt: Date;
  expiresAt: Date;
}
```

The `contextSnapshot` carries the full harness state at dispatch time. Ephemeral workers never read context files directly — they consume context from the snapshot.

---

## Harness structure (per project)

Every project managed by OpenHarness gets these context files:

| File | Format | Purpose |
|---|---|---|
| `AGENTS.md` | Markdown | Agent orientation — stack, conventions, rules |
| `ARCHITECTURE.md` | Markdown | Layered architecture, dependency rules, domain boundaries |
| `DOMAIN.md` | Markdown | Business domain model, entities, bounded contexts |
| `DECISIONS.md` | Markdown | Architecture decision records |
| `GOLDEN_PRINCIPLES.md` | Markdown | Non-negotiable invariants (security, compliance, audit) |
| `HARNESS.json` | JSON | Machine-readable metadata, versions, adapter config |

---

## Feedback signal taxonomy

| Signal | Severity | Auto-resolvable | Routes to |
|---|---|---|---|
| `LINT_FAILURE` | Low | Yes | code-agent |
| `TEST_FAILURE` | Medium | Yes | code-agent |
| `CONSTRAINT_VIOLATION` | High | Yes | code-agent + constraint-agent |
| `CONTEXT_GAP` | High | Sometimes | context-agent |
| `GOLDEN_PRINCIPLE_BREACH` | Critical | No | human escalation |

---

## Database abstraction

All data access goes through the repository pattern. The core package defines the repository interfaces. Adapters implement them.

The active adapter is resolved at server startup from `HARNESS.json` configuration. No other package knows which adapter is in use.

Supported adapters: PostgreSQL (default) · Oracle · SQL Server

---

## LLM provider abstraction

All LLM calls go through `@openharness/core/llm`. Agents never import provider SDKs directly.

Supported providers (configured at init): Azure OpenAI · Ollama · vLLM · OpenAI-compatible endpoints

---

## Security model

- No data leaves the server perimeter
- All LLM calls go to the configured internal/approved endpoint
- RBAC on the dashboard and API (admin · operator · viewer)
- All state-changing operations produce an audit record
- `GOLDEN_PRINCIPLE_BREACH` signals are never auto-resolved — always escalate to human

---

## Harness registry tiers

| Tier | Description | Quality bar |
|---|---|---|
| Tier 1 — Standard library | Ships with the framework | Curated by maintainers, battle-tested |
| Tier 2 — Verified registry | Community-contributed, reviewed | Passes automated + manual review |
| Tier 3 — Community registry | Open contributions | No guarantee |
