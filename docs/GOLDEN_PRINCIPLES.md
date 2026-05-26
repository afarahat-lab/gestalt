# Golden Principles — AgentForge SDLC

These are the non-negotiable invariants for the AgentForge SDLC platform itself.
Violations of any principle below are classified as `GOLDEN_PRINCIPLE_BREACH` and
require human review before any merge. They are never auto-resolved.

Agents must never modify this file without a corresponding ADR in DECISIONS.md
and explicit human approval.

---

## GP-001 — No data leaves the server perimeter

AgentForge SDLC is a self-hosted platform. No telemetry, no analytics, no LLM calls, and no
data of any kind may be sent to any external endpoint not explicitly configured by the
operator at init time.

**Enforcement:** Network egress in agent code is blocked except through
`@agentforge-sdlc/core/llm` and `@agentforge-sdlc/core/repository`. Any direct `fetch`, `axios`,
or DB call outside these modules is a breach.

---

## GP-002 — Every state-changing operation produces an audit record

Any operation that creates, updates, or deletes data must write an audit record before
the operation completes. The audit record must include: actor (agent or human), action,
affected entity, timestamp, and correlation ID.

**Enforcement:** The repository interface enforces this at the adapter level. Operations
that bypass the repository pattern are a breach.

---

## GP-003 — GOLDEN_PRINCIPLE_BREACH signals are never auto-resolved

When the quality gate emits a `GOLDEN_PRINCIPLE_BREACH` signal, the loop stops.
No agent may resolve this signal autonomously. It must be routed to a human operator
via the oversight dashboard and requires explicit approval before the loop resumes.

**Enforcement:** The orchestrator checks signal type before routing. Any code path that
routes a `GOLDEN_PRINCIPLE_BREACH` to an agent rather than the human queue is a breach.

---

## GP-004 — Context files are never deleted

`AGENTS.md`, `ARCHITECTURE.md`, `DOMAIN.md`, `DECISIONS.md`, `GOLDEN_PRINCIPLES.md`,
and `HARNESS.json` are permanent artifacts. They may be updated but never deleted.

**Enforcement:** The harness engine validates the presence of all context files on every
agent task dispatch. A missing context file blocks dispatch and emits a `CONTEXT_GAP`.

---

## GP-005 — No TypeScript suppression

`@ts-ignore`, `@ts-expect-error`, and `as any` are prohibited in all packages.
Type safety is a first-class constraint, not a suggestion.

**Enforcement:** ESLint rule `@typescript-eslint/no-explicit-any` set to error.
`@ts-ignore` detected by lint-agent as `LINT_FAILURE` escalated to `CONSTRAINT_VIOLATION`.

---

## GP-006 — LLM calls go through core only

No agent or adapter may import an LLM provider SDK directly. All LLM calls go through
`@agentforge-sdlc/core/llm`. This ensures provider swapping, rate limiting, cost tracking,
and audit logging are applied uniformly.

**Enforcement:** ESLint import rule banning direct imports of known provider packages
(openai, @azure/openai, ollama, etc.) outside `packages/core/src/llm/`.

---

## GP-007 — Security scan must pass before merge

No PR may be merged without a passing security scan (OWASP ruleset). This applies to
all packages including templates and harness patterns.

**Enforcement:** Security scan is a required step in the quality gate. The deploy agent
checks for a passing security scan result before creating a merge PR.
