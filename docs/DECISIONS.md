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

---

## ADR-009 — Generate layer: fixed execution graph with skip logic

**Date:** 2026-05
**Status:** Accepted

**Context:**
The generate layer needs to orchestrate multiple specialist agents in the right order.
Two options: a fixed dependency graph, or an LLM-planned dynamic graph.

**Options considered:**
1. Fixed dependency-ordered graph with skip logic
2. LLM-planned dynamic graph per intent

**Decision:** Fixed graph (option 1). Agents declare `SKIPPED` when their artifact
type is not needed for a given intent.

**Rationale:** Predictable and debuggable. Dynamic graphs add a failure mode where
the plan itself is wrong. Skip logic handles flexibility without dynamic planning.
Revisit for v2 if fixed graph proves too rigid.

---

## ADR-010 — IntentSpec as the inter-agent contract

**Date:** 2026-05
**Status:** Accepted

**Context:**
Downstream agents need a consistent, structured understanding of what an intent
is asking for. Passing raw intent text to each agent leads to independent
interpretation and incoherent artifacts.

**Decision:** `intent-agent` always runs first and produces a structured `IntentSpec`.
All downstream agents receive the `IntentSpec` — never the raw intent text.

**Rationale:** The intent spec is the single source of truth for a generation cycle.
Success criteria in the spec map directly to test cases, closing the loop between
intent and verification. Ambiguities surface early, before any generation begins.

---

## ADR-011 — High-impact ambiguity stops the loop

**Date:** 2026-05
**Status:** Accepted

**Context:**
Some intents are genuinely ambiguous in ways that would lead to wrong code.
Generating against an ambiguous spec wastes tokens and produces artifacts that
fail quality gates for the wrong reasons.

**Decision:** High-impact ambiguities detected by `intent-agent` emit a `CONTEXT_GAP`
signal, pause the cycle, and escalate to the human operator before any generation
begins. Low-impact ambiguities are resolved conservatively and documented in the
intent spec's `outOfScope` field.

**Rationale:** Stopping early is cheaper than retrying downstream. Human clarification
at intent time costs seconds; discovering the wrong interpretation after code generation
costs multiple agent cycles.

---

## ADR-012 — Quality gate: lint and security in parallel, constraints before tests

**Date:** 2026-05
**Status:** Accepted

**Decision:** Lint and security run in parallel first. Constraint check runs after both complete. Test runner runs after constraint check. Review agent always runs last.

**Rationale:** Fast cheap checks fail early. Architectural validity checked before tests — no value testing broken architecture. Tests are the most expensive operation and should only run on structurally sound code.

---

## ADR-013 — Gate verdict logic lives in review-agent only

**Date:** 2026-05
**Status:** Accepted

**Decision:** Individual gate agents report signals without a verdict. Only the review-agent determines pass/fail/escalate. Gate logic is centralised in one function.

**Rationale:** Distributed verdict logic creates inconsistency. One agent should own the gate decision so the logic is auditable, testable, and easy to change under one ADR.

---

## ADR-014 — Two-level constraint checking: ESLint + TypeScript AST

**Date:** 2026-05
**Status:** Accepted

**Decision:** Constraint-agent uses ESLint programmatic API for static rules and TypeScript compiler API for semantic architectural rules. No LLM in the quality gate.

**Rationale:** The quality gate must be deterministic. LLMs introduce non-determinism. ESLint handles import rules and style. TypeScript AST handles semantic patterns that ESLint cannot express (e.g. audit record enforcement, cross-domain call detection).

---

## ADR-015 — Deploy layer: pipeline adapter pattern

**Date:** 2026-05
**Status:** Accepted

**Decision:** All CI/CD system calls go through a typed PipelineAdapter interface. The active adapter is resolved from HARNESS.json at startup. Agents never call CI/CD systems directly.

**Rationale:** Same principle as the DB adapter pattern. Keeps agent code system-agnostic. Adding a new CI/CD system requires only a new adapter — no agent code changes.

---

## ADR-016 — Deploy layer: scanner interpreter pattern

**Date:** 2026-05
**Status:** Accepted

**Decision:** Each enterprise security scanner has a dedicated ScannerInterpreter. The severity mapping (CRITICAL/HIGH → GOLDEN_PRINCIPLE_BREACH, MEDIUM → CONSTRAINT_VIOLATION, LOW/INFO → LINT_FAILURE) is fixed and cannot be changed without a new ADR. Configured in HARNESS.json per project.

**Rationale:** Enterprise scanners differ in output format but share the same platform signal taxonomy. Interpreters isolate format parsing from signal logic. The fixed severity mapping ensures GP-007 is enforced consistently regardless of which scanner the client uses.

---

## ADR-017 — Production promotion requires confirmed staging run

**Date:** 2026-05
**Status:** Accepted

**Decision:** promotion-agent hard-blocks promotion to production if no successful staging PromotionEvent exists for the current correlation chain. This check cannot be bypassed by agent configuration.

**Rationale:** Promoting untested code to production is the deployment equivalent of a GOLDEN_PRINCIPLE_BREACH. The staging gate is a non-negotiable checkpoint in the promotion chain.

---

## ADR-018 — Maintenance changes flow through the generate loop

**Date:** 2026-05
**Status:** Accepted

**Decision:** All maintenance agent code changes are queued as typed MaintenanceIntents and processed by the generate layer. They go through the quality gate and deploy layer like any other change. Direct fixes are only permitted for additive context file documentation updates (drift-agent only).

**Rationale:** Maintenance changes that bypass the quality gate are a safety risk — the same architectural constraints that apply to feature code apply to maintenance code. Routing through the generate loop ensures consistency, auditability, and human visibility.

---

## ADR-019 — Typed MaintenanceIntentType — no free-form intent strings from agents

**Date:** 2026-05
**Status:** Accepted

**Decision:** Maintenance agents queue typed MaintenanceIntent objects with structured fields (type, priority, affectedFiles, evidence, suggestedAction). They never queue free-form natural language strings as intents.

**Rationale:** Structured intents give the generate layer's intent-agent known context — affected files and observed evidence — enabling more precise IntentSpec production with fewer ambiguities. Free-form strings from agents waste tokens on re-parsing information the agent already has.

---

## ADR-020 — Monitoring adapter pattern for evaluation-agent

**Date:** 2026-05
**Status:** Accepted

**Decision:** evaluation-agent never calls monitoring systems directly. All calls go through a typed MonitoringAdapter interface, resolved from HARNESS.json at startup. Supported: Prometheus, Datadog, Azure Monitor.

**Rationale:** Same principle as pipeline and scanner adapters. Client monitoring platforms vary — the adapter pattern keeps agent code system-agnostic. Threshold logic lives in the agent, not the adapter.

---

## ADR-021 — Four typed intervention actions only

**Date:** 2026-05
**Status:** Accepted

**Decision:** Human interventions are typed from a fixed enum of four actions. Free-form text is limited to the mandatory 'notes' field on acknowledge-breach. No open-ended intervention types.

**Rationale:** Typed interventions enable precise server-side validation, routing, and audit logging. Free-form interventions are ambiguous to route and audit. The four types cover all scenarios where human action is required by design.

---

## ADR-022 — SSE over WebSocket for live dashboard events

**Date:** 2026-05
**Status:** Accepted

**Decision:** The live event stream uses Server-Sent Events (SSE) rather than WebSocket.

**Rationale:** SSE is unidirectional (server→client only) which matches the use case. It works through standard HTTP proxies without special configuration — critical in GCC/MENA corporate environments where WebSocket connections are often blocked by proxies and firewalls. Simpler to implement and debug.

---

## ADR-023 — Dashboard served by the server, not separately deployed

**Date:** 2026-05
**Status:** Accepted

**Decision:** The React dashboard is compiled to static assets and served by the Fastify server at the root path. No separate frontend deployment.

**Rationale:** Minimises corporate IT deployment complexity. One docker-compose up, one security review, one URL. Separate frontend deployment would require a second service, second SSL certificate, and CORS configuration — all friction in enterprise environments.

---

## ADR-024 — Three auth modes: Kerberos, IdP (SAML/OIDC), local fallback

**Date:** 2026-05
**Status:** Accepted

**Decision:** The platform supports three authentication modes in fixed priority order: Windows Kerberos/SPNEGO (1st), corporate IdP via SAML 2.0 or OIDC (2nd), local username/password fallback (3rd). All modes produce a normalised VerifiedIdentity — downstream code is auth-mode agnostic.

**Rationale:** GCC/MENA enterprise environments primarily use Windows AD domains and ADFS/AAD. Windows Kerberos enables seamless SSO for domain-joined users — the dominant use case. SAML/OIDC covers non-Windows and cloud IdP scenarios. Local fallback enables adoption before IT approval of IdP integration.

---

## ADR-025 — Local auth is non-production only

**Date:** 2026-05
**Status:** Accepted

**Decision:** Local auth provider will not start if NODE_ENV=production unless allowedInProduction: true is explicitly set in HARNESS.json. A warning banner is shown in the dashboard when local auth is active.

**Rationale:** Local password auth in a corporate context creates a shadow identity silo that bypasses corporate access policies, audit requirements, and deprovisioning workflows. It exists solely to enable early adoption and development. Production environments must use a corporate IdP.

---

## ADR-026 — PlatformUser is a shadow record, never the identity source of truth

**Date:** 2026-05
**Status:** Accepted

**Decision:** The local PlatformUser record stores only the platform role assignment, display name, and session metadata. Identity and group membership are always re-verified on login from the IdP. Deprovisioning a user in the corporate IdP automatically blocks access — no synchronisation needed.

**Rationale:** Maintaining a separate user database in sync with the corporate IdP is an operational burden and a source of security gaps (stale access after offboarding). The shadow record approach gives the platform the minimum local state it needs without owning the identity lifecycle.

---

## ADR-027 — Windows Kerberos requires SPN registration (one-time IT setup)

**Date:** 2026-05
**Status:** Accepted

**Decision:** Windows Kerberos SSO requires the server to be registered as a Service Principal Name in Active Directory. This is a one-time IT setup step documented in the deployment guide. The init wizard detects if Kerberos is configured and provides the exact setspn command for IT.

**Rationale:** Kerberos authentication cannot work without SPN registration. Documenting this as a known prerequisite prevents deployment failures. The IT setup cost is low (single command) and the user experience benefit (no login screen) is significant for the target market.

---

## ADR-028 — Registry is a metadata service, not a file host

**Date:** 2026-05
**Status:** Accepted

**Decision:** The registry stores metadata (slug, name, type, tier, git URL, checksum). Entry files are served from their source git repositories, not from registry infrastructure. Tier 1 entries are bundled with the platform.

**Rationale:** Minimises registry infrastructure requirements. Air-gapped environments work by mirroring source repos. Entries are always served from their source of truth — no synchronisation lag.

---

## ADR-029 — Promotion thresholds are fixed in code

**Date:** 2026-05
**Status:** Accepted

**Decision:** Promotion thresholds (minimum downloads, active projects, rating, production projects) are defined as constants in the promotion engine source code. They cannot be configured or overridden at runtime.

**Rationale:** The thresholds define the quality signal. Making them configurable would allow maintainers to lower the bar for political or convenience reasons, eroding the trust the tiers are designed to establish. Changes require a code change and a new ADR — visible, auditable, deliberate.

---

## ADR-030 — Tier 1 entries ship bundled — no registry call needed

**Date:** 2026-05
**Status:** Accepted

**Decision:** Tier 1 entries (standard library) are bundled with the platform in the `templates/` directory. The registry is called for version checking only. Air-gapped deployments never need registry access for Tier 1.

**Rationale:** Tier 1 is the most critical dependency. Requiring a registry call to use the standard library would create a runtime dependency on an external service — unacceptable for air-gapped corporate deployments.
