# Architecture Decision Records — AgentForge SDLC

This file records all significant architectural decisions made for the AgentForge SDLC platform.
Every decision includes context, the options considered, the choice made, and the rationale.

Agents must not modify existing ADRs. New decisions are appended at the bottom.

---

## ADR-001 — Runtime model: self-hosted server

**Date:** 2026-05
**Status:** Accepted

**Context:**
Target market is corporate operations teams in regions (GCC/MENA) with strict data residency, security review, and regulatory requirements. Cloud-hosted SaaS would require per-client security approval for every data egress point. CLI-only would not support multi-agent coordination across machines or a central oversight dashboard.

**Options considered:**
1. Cloud-hosted SaaS
2. CLI tool only
3. Self-hosted server with CLI as operator interface

**Decision:** Self-hosted server (option 3). CLI is the developer-facing interface; the server handles orchestration, state, and the dashboard.

**Rationale:** Single security review per deployment. Air-gapped operation possible. Central coordination for ephemeral workers. Docker Compose makes corporate IT deployment straightforward.

---

## ADR-002 — Agent execution model: ephemeral workers

**Date:** 2026-05
**Status:** Accepted

**Context:**
Agents need to run tasks concurrently, potentially across multiple machines. Long-lived agent services create state management complexity and make auditing harder.

**Options considered:**
1. Long-lived agent services
2. Ephemeral workers (spin up per task, terminate on completion)

**Decision:** Ephemeral workers (option 2).

**Rationale:** Each execution is a discrete, auditable unit. Horizontal scaling is natural. State lives in PostgreSQL and Redis, not in process memory. Workers carry a `contextSnapshot` so they never need to read files mid-task. Corporate compliance teams benefit from clear per-task audit trails.

---

## ADR-003 — Message queue: BullMQ + Redis

**Date:** 2026-05
**Status:** Accepted

**Context:**
Ephemeral workers require a reliable message queue. Options range from simple DB polling to dedicated queue systems.

**Options considered:**
1. PostgreSQL-backed polling queue
2. RabbitMQ
3. BullMQ (Redis-backed)

**Decision:** BullMQ (option 3).

**Rationale:** BullMQ is Node.js-native, battle-tested, and has strong support for priority queues, delayed jobs, and rate limiting — all needed for the maintenance layer. Redis is a lightweight dependency well-understood by corporate IT teams. DB polling (option 1) would create unnecessary load on the primary DB. RabbitMQ adds operational complexity without sufficient benefit at this scale.

---

## ADR-004 — Database abstraction: repository pattern

**Date:** 2026-05
**Status:** Accepted

**Context:**
Enterprise clients use a variety of databases. The platform must support PostgreSQL, Oracle, and SQL Server without lowest-common-denominator SQL.

**Options considered:**
1. ORM with multi-DB support (Prisma, TypeORM)
2. Repository pattern with per-adapter implementations
3. PostgreSQL only

**Decision:** Repository pattern with per-adapter implementations (option 2). PostgreSQL is the reference implementation.

**Rationale:** ORMs abstract too much and produce poor SQL on non-PostgreSQL targets. Repository pattern keeps adapter implementations clean and idiomatic for each DB. The active adapter is resolved at startup from config — no other package is aware of which adapter is in use.

---

## ADR-005 — LLM provider abstraction

**Date:** 2026-05
**Status:** Accepted

**Context:**
Corporate clients use different LLM providers based on compliance and data residency requirements (Azure OpenAI for Microsoft-approved environments, on-premise models for air-gapped deployments).

**Options considered:**
1. Hardcode a single provider
2. Thin abstraction in core with provider-specific config
3. Full plugin system

**Decision:** Thin abstraction in `@agentforge-sdlc/core/llm` (option 2).

**Rationale:** A full plugin system adds complexity before it's needed. A thin abstraction covers the real requirement: swap providers via config at init time. Supported providers at launch: Azure OpenAI, Ollama, vLLM, and any OpenAI-compatible endpoint.

---

## ADR-006 — Monorepo structure: pnpm workspaces

**Date:** 2026-05
**Status:** Accepted

**Context:**
The platform has multiple packages that need to share types and utilities without publishing to a registry.

**Decision:** pnpm workspaces monorepo.

**Rationale:** pnpm's strict dependency isolation prevents phantom dependency issues common in npm/yarn workspaces. Workspace protocol (`workspace:*`) makes internal package references explicit. Faster installs than npm for a monorepo of this size.

---

## ADR-007 — Feedback signal taxonomy

**Date:** 2026-05
**Status:** Accepted

**Context:**
Quality gate rejections need to carry enough information for the correct agent to resolve them autonomously. Generic pass/fail is insufficient.

**Decision:** Five typed signal classes: `LINT_FAILURE`, `TEST_FAILURE`, `CONSTRAINT_VIOLATION`, `CONTEXT_GAP`, `GOLDEN_PRINCIPLE_BREACH`.

**Rationale:** Each signal maps to a distinct resolution path and agent. `GOLDEN_PRINCIPLE_BREACH` is the only signal that escalates to human intervention — this is a hard rule, never automated away. `CONTEXT_GAP` is the most diagnostically valuable signal: it surfaces harness gaps rather than hiding them as generic failures.

---

## ADR-008 — Target domain: corporate operations web and mobile

**Date:** 2026-05
**Status:** Accepted

**Context:**
The Tier 1 standard library harness needs to be domain-specific enough to be genuinely useful out of the box.

**Decision:** Initial Tier 1 targets corporate operations web and mobile applications.

**Rationale:** This domain has strong recurring patterns (approval workflows, RBAC, audit trails, enterprise integrations) and is underserved by current AI coding tools precisely because cross-cutting concerns require coordinated enforcement — exactly what a harness provides.
