# Architecture Decision Records — Gestalt

This file records all significant architectural decisions made for the Gestalt platform.
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

**Decision:** Thin abstraction in `@gestalt/core/llm` (option 2).

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

---

## ADR-032 — Git repository is the project filesystem

**Date:** 2026-05
**Status:** Accepted

**Decision:** The server never writes generated artifacts to a developer's local machine. All artifact delivery goes through Git: the server clones the project repo, agents write files, commit, push. Developers receive changes via `git pull` or PR merge. `projectRoot` in `ContextSnapshot` is the path to the server-side clone of the project repo, resolved fresh for each intent cycle.

**Rationale:** Aligns with the repo-as-source-of-truth principle. Supports multi-developer teams correctly. Makes every agent change auditable via Git history. Required for the pr-agent deploy layer to function as designed. Resolves the `ENOENT /app/HARNESS.json` blocker that surfaced once the orchestrator was wired in — the server now reads harness files from its own clone of the project repo, not from `process.cwd()`.

**Consequences:**
- New `projects` and `project_git_credentials` tables (migration `003_projects.sql`).
- Server depends on `simple-git` for all Git operations (never `child_process.exec('git ...')`).
- Each intent cycle does a fresh shallow-or-full clone into a temp dir, runs the plan, and removes the tree in a `finally` block.
- Project credentials (Git PATs) are stored alongside the project record and never appear in API responses or logs. Encrypt-at-rest is deferred (see `TODO` in `repositories/projects.ts`).
- `gestalt init` becomes a thin client over `POST /projects` + `POST /projects/:id/init-harness`. Developers run `git pull` locally to receive the harness.

---

## ADR-033 — Deploy layer: pipeline adapter pattern

**Date:** 2026-05
**Status:** Accepted

**Decision:** All CI/CD calls go through a typed `PipelineAdapter` interface. The active adapter is resolved per deploy task from the project's `HARNESS.json` `pipeline.adapter` field. A `NoOpPipelineAdapter` is provided for projects without CI/CD configured. Agents never call CI/CD systems directly.

**Rationale:** Same principle as the database (ADR-004) and scanner (ADR-016) adapter patterns. Client CI/CD platforms vary — GitHub Actions, GitLab CI, Jenkins, Azure DevOps, internal corporate Bamboo / Spinnaker. Adding a new system requires only a new adapter; the deploy-orchestrator and the pr / pipeline / promotion agents stay unchanged.

**Consequences:**
- Pipeline adapter interface lives in `packages/agents/deploy/src/adapters/pipeline-adapter.ts` with four methods: `createPullRequest`, `triggerPipeline`, `getPipelineStatus`, `promoteToEnvironment`.
- Reference implementations today: `GitHubActionsAdapter` (REST API, PAT from `project_git_credentials`) and `NoOpPipelineAdapter` (immediate plausible fake responses so the chain can run end-to-end without real CI).
- Resolution is per-task, not per-server, so a single Gestalt deployment can serve projects on different CI systems.
- Missing `pipeline.adapter` or an unrecognised value falls back to `NoOpPipelineAdapter` rather than failing — the deploy layer always progresses to `deployed`.

---

## ADR-034 — Production promotion requires confirmed staging run

**Date:** 2026-05
**Status:** Accepted

**Decision:** `promotion-agent` hard-blocks promotion to production if no successful `promoted-staging` event exists in `deployment_events` for the current `correlationId`. This check cannot be bypassed by adapter, agent configuration, harness flag, or operator override.

**Rationale:** Promoting untested code to production is the deployment equivalent of a `GOLDEN_PRINCIPLE_BREACH`. The staging checkpoint is a non-negotiable invariant — every change must have been observed running in staging before it can run in production. Making this a hard agent-level invariant means a buggy harness, a misconfigured adapter, or a future direct-promotion shortcut cannot circumvent it.

**Consequences:**
- `promotion-agent` calls `getRepositories().deploymentEvents.findStagingPromotion(correlationId)` before any production promote. If the result is `null`, it emits a `GOLDEN_PRINCIPLE_BREACH` signal and refuses the promote.
- The deploy-orchestrator interprets a `blocked` outcome from `promotion-agent` as escalation, not retry — the intent transitions to `escalated`.
- `deployment_events` is append-only (DB-level `REVOKE UPDATE, DELETE`), so a stray write cannot fake a staging promotion after the fact.
- The check applies to the automated promotion chain only. A future human-triggered emergency promote endpoint (out of scope today) would be a separate audited path with its own ADR.

---

## ADR-035 — Maintenance layer: typed intents and monitoring adapter

**Date:** 2026-05
**Status:** Accepted

**Decision:** Maintenance agents queue typed `MaintenanceIntent` objects with structured fields (`type`, `projectId`, `priority`, `affectedFiles`, `evidence`, `suggestedAction`) — never free-form natural-language strings. The `evaluation-agent` never calls monitoring systems directly; all calls go through a typed `MonitoringAdapter` interface resolved per-project from `HARNESS.json` `maintenance.monitoring.adapter`. Supported adapters today: `prometheus`, `datadog`, and `noop` (default). Drift-agent may commit additive context-file notes directly to `defaultBranch` as a documented exception to ADR-018; every other maintenance action flows through the generate loop.

**Rationale:**
- **ADR-019:** Structured intents give the generate orchestrator known context (type + evidence + affected files), enabling the intent-agent to produce a precise `IntentSpec` without re-deriving what changed. Free-form strings would require the LLM to re-parse the agent's reasoning every cycle.
- **ADR-020:** The monitoring adapter pattern keeps agent code system-agnostic. The same evaluation-agent serves a Prometheus-backed project, a Datadog-backed project, and a project with no monitoring (NoOp) without code changes.
- **NoOp default:** The maintenance layer still ticks on the cron schedule for projects without monitoring configured — it observes zero metrics and queues no intents. This avoids the configuration-required failure mode where a freshly registered project crashes the scheduler.
- **ADR-018 exception (drift-agent additive commits):** The drift-agent appends timestamped HTML-comment notes to `docs/DOMAIN.md` describing observed drift. These additions are pure documentation, never code, and never overwrite existing content; routing them through the generate loop would add 30+ seconds of latency to every drift observation for no review value. Anything beyond additive commenting (rewriting a section, removing an entity) is queued as a `CONTEXT_UPDATE` intent for the generate layer.

**Consequences:**
- New `maintenance_runs` table (migration `005_maintenance.sql`) tracks per-scheduled-run state with `intents_queued` + `direct_fixes` + a JSONB `findings` array.
- Migration `005` also `GRANT`s `DELETE` on `deployment_events` back (migration `004` had revoked it under the audit-log analogy; gc-agent needs it for the 90-day retention purge — clarified that `deployment_events` are operational logs, not audit records).
- `IntentRecord.source = 'maintenance-agent'` distinguishes maintenance-queued intents from human ones in `gestalt status` and dashboards.
- The duplicate-intent guard in evaluation-agent inspects the intent text for the `[gestalt-maintenance/<TYPE>]` prefix that every maintenance dispatch carries — prevents piling on duplicate `PERFORMANCE_DEGRADATION` intents while a previous one is still in-flight.
- `node-cron` runs in the server process; maintenance is **not** a BullMQ worker. Scheduled agents execute inline in their cron callbacks. Manual operator triggers (`POST /maintenance/trigger`) share the same runner code path.


---

## ADR-036 — Harness templates are files, not inline code

**Date:** 2026-06-01
**Status:** Accepted

**Decision:** All harness file content (`HARNESS.json`, `AGENTS.md`,
`agents.yaml`, the `docs/*.md` set, `.github/workflows/gestalt.yml`)
lives in `templates/<templateId>/` as actual files with `{{variable}}`
placeholders. The server reads, substitutes, and commits them via the
lightweight engine in `packages/server/src/templates/engine.ts`. The
Dockerfile copies `templates/` into both the builder and production
stages of the server image. No harness content is hardcoded in route
handlers.

**Rationale:** Template content was previously inlined in
`packages/server/src/routes/projects.ts` as eight hand-written
`build*()` functions (`buildAgentsMd`, `buildHarnessJson`,
`buildAgentsYaml`, `buildArchitectureMd`, `buildDomainMd`,
`buildGoldenPrinciplesMd`, `buildDecisionsMd`, `buildGestaltWorkflowYml`).
The ADR-032 session log documented this as technical debt:
*"Inlined harness file content in routes/projects.ts (Dockerfile does
not copy templates/; revisit when template story matures)."* Moving
to files:

- Templates become version-controllable as content, not as
  string-concatenated TypeScript. Diffs on `templates/<id>/AGENTS.md`
  are real markdown diffs reviewable in any editor / git log.
- A new template (Tier 2/3, or domain-specific) lands by dropping a
  directory under `templates/`. No server code changes; no
  redeploy beyond the next image build.
- Substitution is one regex (`/\{\{(\w+)\}\}/g`) with no
  conditionals or loops. Unknown variables are left in place
  (e.g. `{{somethingNew}}` survives as the literal string) so a
  forgotten value is debuggable in the committed file rather than
  silently empty.

**Engine contract (`packages/server/src/templates/engine.ts`):**

- `loadTemplate(templatesDir, templateId, variables)` returns the
  list of `{ repoPath, content }` pairs ready to write into the
  cloned project tree.
- `today` and `projectSlug` are auto-supplied (ISO date, kebab-cased
  projectName) when the caller omits them. Other unknown placeholders
  log a debug message and stay in the file.
- Files under `harness/` are committed at the project root
  (`harness/AGENTS.md` → `AGENTS.md`). `docs/*` keeps its prefix.
  `ci/gestalt.yml` maps to `.github/workflows/gestalt.yml`.
- `constraints/` + `principles/` directories and the top-level
  `template.json` + `README.md` are platform-internal and skipped —
  they describe the template but don't belong in project repos.
- `resolveTemplatesDir()` walks a candidate list at module load
  time, caches the result, and supports three deployment modes:
  Docker production (`/app/templates`), `pnpm dev` from
  `packages/server` (walks up to repo root), and `node dist/...`
  from `packages/server` (walks up from the compiled JS location).

**Consequences:**

- New `template.json` per template documents `id`, `name`,
  `version`, `tier`, `description`, and the `variables` operators are
  expected to supply.
- `.dockerignore` no longer excludes `templates/`. The Dockerfile
  adds `COPY templates ./templates` to the builder stage AND
  `COPY --from=builder /app/templates ./templates` to the
  production stage.
- `projects.ts` shrinks from 815 lines to 422 lines — the eight
  `build*()` functions and the `HarnessInputs` interface are deleted.
  The init-harness handler is the only caller of the engine; the
  rest of the route file deals with project CRUD + Git wrangling.
- `HARNESS.json` template includes `templateId:
  "corporate-ops-web-mobile"` so future tooling (registry, audit,
  drift-agent's template-aware checks) can identify which template
  seeded the project without re-parsing the harness.
- Project-side behaviour is byte-for-byte unchanged from before the
  refactor — the template content is the same strings the
  `build*()` functions produced. Existing projects don't see any
  difference. Live verification confirmed: a freshly initialised
  test project receives the same eight files at the same paths
  with the same content modulo `{{variable}}` substitution.


---

## ADR-037 — Custom agents are prompt-only, verdict via signals

**Date:** 2026-06-01
**Status:** Accepted

**Decision:** Project-defined custom agents declared in `agents.yaml`
under `custom_agents:` are generic LLM runners. They receive the
generated artifacts as part of their prompt and return structured
findings (`{ passed, findings: [...], summary }`). The orchestrator
maps each finding to a typed signal that the gate orchestrator
evaluates alongside framework signals:

- `high` severity → `CONSTRAINT_VIOLATION`
- `medium` / `low` → `LINT_FAILURE`
- LLM error / parse failure → `CONTEXT_GAP` (one signal for the run)

Custom agents have no deterministic execution paths — they are
prompt-only. They never emit `GOLDEN_PRINCIPLE_BREACH` (reserved for
framework infrastructure agents and the review-agent). They do not
stop the cycle directly — they contribute signals; the gate
orchestrator owns the final pass / fail / escalate verdict (ADR-013).

**Rationale:** Deterministic enforcement (ESLint, AST-based constraint
checks, real test runners) belongs in framework agents — that code
already exists and is shared across projects. Project-specific
reasoning that varies by domain (security policy, performance
budgets, internal style rules, accessibility checks) is naturally
LLM-driven; the value comes from per-project prompt customisation,
not per-project agent code.

The signal mechanism ensures custom agents participate in the same
quality gate loop as framework agents without bypassing it. Two
properties follow:

1. **Verdict centralisation** — the gate orchestrator + review-agent
   are the only places that produce pass / fail / escalate. Custom
   agents can flag issues but cannot abort the cycle independently.
   Operators can reason about verdict logic by reading review-agent
   code and the signal-routing table alone.
2. **Feedback-loop reuse** — `CONSTRAINT_VIOLATION` and
   `LINT_FAILURE` are auto-resolvable signal types in the gate-↔-
   generate retry router (ADR-013). A custom-agent finding that
   triggers a `CONSTRAINT_VIOLATION` automatically rolls into the
   code-agent's `priorSignals` on the retry leg — same as if the
   constraint-agent had flagged it. No new plumbing needed.

**Consequences:**

- New types in `@gestalt/agents-generate`:
  `CustomAgentDefinition`, `CustomAgentResult`, `CustomAgentFinding`.
  `AgentsYaml.customAgents?: CustomAgentDefinition[]` added.
- `loadCustomAgents(projectRoot)` in the agent config loader. Same
  non-fatal contract as `loadAgentConfig` — missing file / malformed
  YAML / missing required field on an entry all return an empty list
  with a debug log.
- `runCustomAgent(definition, ctx, correlationId)` in
  `packages/agents/generate/src/agents/custom-agent-runner.ts`. Uses
  `getLLMClient(definition.llm.model)` so per-agent model overrides
  from Step 1 / multi-client registry apply automatically.
  `responseFormat: 'json'` requested; parse failures fall through
  to a safe default that captures the LLM's raw text as `summary`.
- Generate orchestrator runs custom agents AFTER `drivePlan` succeeds
  and BEFORE dispatch to the gate. Each run creates an
  `agent_executions` row (`taskType: 'generate:custom'`,
  `agentRole: <definition.name>`), emits `agent.started` /
  `agent.completed` SSE, persists an `agent_execution_logs` row
  carrying the LLM response + the captured `modelUsed`, and saves
  typed signals for each finding (with `signal.emitted` SSE per
  signal). The same observability surface every framework agent
  has.
- `runs_after` is parsed but not enforced — all custom agents run
  after all framework agents regardless of the field value. Future
  work could make this a topological constraint.
- `{{artifacts}}` truncates to 2000 chars per file to keep the
  prompt budget reasonable. Custom agents that need full files can
  request them via a future enhancement (e.g. a `full_artifacts`
  flag that skips the truncation).
- Dashboard `IntentDetail` shows custom-agent execution rows with
  `var(--purple)` colour + a `custom` badge so operators can
  distinguish them from framework agents at a glance.
- New endpoints `GET /projects/:id/agents` and `GET
  /projects/:id/agents/validate` (both `requireRole('viewer')`,
  shallow-clone the repo to read `agents.yaml`).
- New CLI subcommands `gestalt agents list <name>` and
  `gestalt agents validate <name>`. Both accept the standard
  `--server` one-shot override.
- No new migrations — custom agents reuse the existing
  `agent_executions` and `agent_execution_logs` tables with
  `agentRole` widened informally to accept any string (TypeScript
  cast `as AgentRole` at insert time).

---

## ADR-038 — Agent tool use: built-in file tools + agents.yaml configuration

**Date:** 2026-06
**Status:** Accepted

### Context

Agents currently receive a static `ContextSnapshot` and make a single
LLM call. They cannot read existing project files during reasoning,
which produces two visible failure modes:

1. **`code-agent` over-generates.** Without being able to inspect
   what already exists, it falls back to its training-data prior and
   produces wholesale module trees for narrow intents (the
   `fix tsx version in package.json` motivating case generated 8–12
   files until the scope-enforcement session of 2026-06-01).
2. **Maintenance agents work from regex approximations** instead of
   real file content. `alignment-agent` parses Markdown via
   handwritten regexes; an LLM-driven agent with `readFile` access
   could read the file directly and reason about it instead.

### Decision

Agents declare available tools in `agents.yaml` under a new `tools:`
key. Four built-in file tools (`readFile`, `listDirectory`,
`searchFiles`, `getFileTree`) execute against the cloned project repo
in a read-only sandbox. Tool definitions ship in
`@gestalt/core/tools/file-tools.ts` and are sent to the LLM via the
OpenAI chat-completions `tools` parameter on the request.

`BaseLLMAgent.callLLMWithTools` runs the tool-use loop: LLM emits
`tool_calls` → orchestrator executes each call via `executeFileTool` →
results are added as `role: 'tool'` messages → next LLM call →
repeat until `finish_reason === 'stop'` or the safety cap
(`MAX_TOOL_CALLS = 10`) is reached. Each tool call is persisted as
one entry of `agent_execution_logs.tool_calls` (JSONB array,
migration 012) so the dashboard's IntentDetail accordion can show
what the agent read before generating.

MCP servers are the planned extension mechanism for external
integrations (separate ADR-039); the `AgentToolConfig` type reserves
a `mcp?:` field so the schema doesn't shift when ADR-039 lands.

### Rationale

- **Agents that can read existing files make surgical changes
  instead of wholesale regeneration.** This is the immediate
  practical impact; the tool-use loop is the mechanism, not the
  goal.
- **The tool approach lets the agent drive its own discovery.**
  Pre-assembling context dumps in the prompt (the previous approach)
  either includes too much (token bloat, model confusion) or misses
  the relevant file (no escape hatch).
- **Built-in file tools are sufficient for the immediate problem.**
  MCP extends this to external systems without changing the core
  architecture — `BaseLLMAgent.callLLMWithTools` doesn't know or
  care which tool registry produced its tool definitions.
- **OpenAI chat-completions tools format, not Anthropic.** The
  platform's `LLMClient` already speaks OpenAI / Azure
  OpenAI-compatible providers (see ADR-001 in spirit — the
  `baseUrl/chat/completions` shape). The brief used Anthropic
  pseudocode; the implementation maps to OpenAI's
  `tools[{type: 'function', function: {...}}]` request shape and the
  `choices[0].message.tool_calls` response shape. Semantics identical.

### Consequences

- `BaseLLMAgent` gains `callLLMWithTools` alongside `callLLM`.
- `BaseLLMAgent.lastToolCallLog` captures the per-run tool history;
  the orchestrator reads it after `run()` and persists into
  `agent_execution_logs.tool_calls`.
- `code-agent` and `context-agent` use file tools by default (set in
  `PER_ROLE_DEFAULTS`); all other agents default to no tools so their
  behaviour is unchanged.
- Operators can override tool configuration per agent in
  `agents.yaml` (`tools.builtin: [...]`).
- Path traversal outside `projectRoot` throws immediately. Files
  larger than 100 KB are truncated with a clear marker. Search
  returns at most 20 matches. Tree max depth is 4.
- Migration 012 adds the `tool_calls JSONB` column; legacy rows
  default to `[]`. Oracle and MSSQL stubs default the field at the
  type level — neither adapter persists rows yet.
- Dashboard IntentDetail accordion renders a "Tool calls (N)"
  section between the prompt and the LLM response when the row has
  any tool_calls entries; empty array → section hidden.

### Amendment 2026-06 — BaseLLMAgent + BaseOrchestrator + uniform tool/MCP access

- **`BaseLLMAgent` moved to `@gestalt/core`.** All agent layers
  (generate, gate, maintenance) import the same implementation.
  The generate package keeps re-export shims at the old paths so
  existing imports keep working. The class is now generic over
  task / result shapes (`BaseLLMAgent<TTask, TResult>`) so each
  layer can declare its own typed pair without forcing
  generate-specific shapes into core.
- **`BaseOrchestrator` added to `@gestalt/core`.** Slim
  services-oriented class — protected helpers for `closeMcpClients`,
  `loadHarness`, and `resolveAgentContext` (combines
  `loadAgentConfig` + `resolveMcpClients` with a per-cycle MCP
  cache shared across agent steps). Each of the three layer
  orchestrators (`GenerateOrchestrator`, `GateOrchestrator`,
  `MaintenanceOrchestrator`) `extends BaseOrchestrator`. The
  amendment deliberately deviates from the brief's pseudocode
  template-method pattern (`withProjectClone` controlling the
  cycle lifecycle, single `execute(ctx)` entry) — generate's
  resume / clarification / retry flow doesn't fit a single
  template, so the base provides shared services rather than
  forcing a uniform shape.
- **`loadAgentConfig` + `loadCustomAgents` moved to
  `@gestalt/core/agents/agent-config-loader`** with re-export
  shims from agents-generate. Quality-gate and maintenance now
  import these from core directly — they no longer need
  `@gestalt/agents-generate` for anything other than residual
  `AgentResult` re-exports.
- **`PER_ROLE_DEFAULTS` expanded** to include `review-agent` (gate
  layer, file tools: `readFile + searchFiles`), `drift-agent` and
  `alignment-agent` (maintenance layer, full file-tool set), and
  `context-fixer` (maintenance layer, narrow `readFile +
  listDirectory`). Operators may override via `agents.yaml`; new
  `gestalt init` projects ship with these defaults in the template.
- **review-agent switched from `callLLM` to `callLLMWithTools`**
  so it can spot-check files referenced in the artifact set
  before flagging issues. Falls through to plain LLM call when
  the operator strips tools via `agents.yaml`.
- **`GET /projects/:id/agents` payload extended** with a
  `layers: { generate, gate, maintenance }` field partitioning
  the framework agents by layer + listing infrastructure agents
  (`constraint-agent`, `lint-agent`, `security-agent`,
  `test-runner-agent` under gate; `gc-agent`, `evaluation-agent`
  under maintenance). The legacy `frameworkAgents` /
  `customAgents` fields stay on the response so older
  dashboard / CLI builds keep working.
- **`gestalt agents list <projectName>` renders by layer** —
  Generate / Gate / Maintenance sections with each LLM agent's
  resolved `tools:` and `MCP:` set surfaced inline.

---

## ADR-039 — MCP (Model Context Protocol) for external integrations

**Status:** Implemented (2026-06-01)
**Extends:** ADR-038

### Context

ADR-038 gave agents four read-only file tools so they could discover
existing project content before generating output. Real engineering
work needs more: read an issue from the project tracker, look up an
API spec from Confluence, query a metrics dashboard, look at a Slack
thread that prompted the intent. Building a typed adapter for each
external system would have us re-implementing the same surface every
quarter; the industry has converged on **Model Context Protocol
(MCP)** — a JSON-RPC-over-HTTP/stdio protocol where any compliant
server exposes a `listTools` + `callTool` API the LLM can drive.

Constraints we accepted:
- **Built-in tools (ADR-038) keep their role** — the four file tools
  are part of the platform contract. MCP is the extension mechanism
  for everything else.
- **Per-agent declarative config in `agents.yaml`** — same shape as
  built-in tools, no code change to enable a new integration.
- **Token resolution must not put secrets in the project repo by
  default** — `env:VAR_NAME` is the recommended source for sensitive
  PATs; harness-stored tokens are visible to anyone with repo
  access and are flagged as such in `harness-config.md`.
- **MCP failures must be non-fatal** — an unreachable server should
  degrade the agent's capabilities, not abort the cycle.
- **No new repository or migration** — `tool_calls` JSONB already
  stores per-call rows; we add an optional `toolSource` field.

### Decision

Agents may declare external MCP servers in `agents.yaml`:

```yaml
agents:
  code-agent:
    tools:
      builtin: [readFile, listDirectory, searchFiles, getFileTree]
      mcp:
        - name: github
          url: https://mcp.github.com/v1
          token_from: env:GITHUB_MCP_TOKEN
```

Three token sources are supported, resolved by `resolveMcpClients` in
`@gestalt/core/tools/mcp-resolver`:

1. **`harness`** — looks up `mcp.servers[].token` in `HARNESS.json`
   by matching server name. The token sits in the project repo —
   document the visibility implications to the operator.
2. **`project_credential`** — reuses the project's Git PAT (already
   loaded from `project_git_credentials`).
3. **`env:VAR_NAME`** — reads `process.env.VAR_NAME` on the server
   process. Recommended path for sensitive secrets; survives a
   `git pull` of the project repo by never being in it.

The generate orchestrator resolves MCP clients **once per cycle**
into a `Map<serverName, McpClient>` cache and threads the matched
subset to each agent's `AgentTask.mcpClients`. Multiple agents
declaring the same server share one transport connection. The cache
is closed (best-effort) in the orchestrator's `finally` block so a
thrown agent run can't leak file descriptors / SSE streams.

`BaseLLMAgent.callLLMWithTools` accepts an optional `mcpClients?:
McpClient[]`, merges every server's `listTools()` output with the
built-in definitions, and dispatches tool calls by namespace prefix
(`<serverName>__<toolName>`). The OpenAI tool-calling loop is
unchanged — the LLM sees one flat tool list with namespaced names,
which keeps the contract identical across providers.

### Tool routing — what the agent does with each call

The dispatcher in `BaseLLMAgent.callLLMWithTools` indexes MCP clients
by their `<serverName>__` prefix into a `Map`. For every tool the
LLM invokes:

```
for each (prefix, client) in mcpByPrefix:
  if toolName.startsWith(prefix):
    return mcpClient.executeTool(toolName, args, toolCallId)
fallthrough → executeFileTool(toolName, args, projectRoot)
```

This means an MCP server cannot shadow a built-in: an MCP server
named `readFile` couldn't intercept the built-in because the prefix
is `readFile__`, not `readFile`. The LLM sees `readFile`
(built-in) and `readFile__readFile` (MCP) as two distinct tools.

### Observability

`ToolCallLogEntry.toolSource` (`'builtin' | 'mcp:<name>'`) tells the
operator which transport handled each call. Stored in
`agent_execution_logs.tool_calls` JSONB; rendered by the dashboard
IntentDetail accordion as a small badge after each tool name
(`readFile (built-in)` vs `github__get_pull_request (MCP: github)`).
`GET /projects/:id/agents` returns the list of MCP servers each
agent has wired; `gestalt agents list` prints them in the framework
agents table.

### Failure mode

`McpClient.listTools()` and `McpClient.executeTool()` both catch
every thrown error from the SDK and return safe values (`[]` and
`{ isError: true, content: '...' }` respectively). The agent
proceeds with whatever tools resolved successfully. The LLM sees
the error text in the tool result and is free to pick a different
tool or give up — the orchestrator does not abort the step on MCP
failure.

### Transports

Two SDK transports are supported via URL scheme:
- `http(s)://...` → `StreamableHTTPClientTransport` (the
  MCP-spec-name for modern HTTP+SSE). Bearer-auth via `Authorization`
  header when a token is resolved.
- `stdio:<binary> <arg1> <arg2>...` → `StdioClientTransport` spawns
  the child process and speaks JSON-RPC over its stdin/stdout. Used
  for local test servers (`npx @modelcontextprotocol/server-
  filesystem /tmp/xyz`) and for any self-hosted server the operator
  wants to run as a child.

### Consequences

- **One new dep** — `@modelcontextprotocol/sdk` on `@gestalt/core`
  only. Agents import `McpClient` from `@gestalt/core`.
- **No new migration** — `tool_calls` JSONB stores the new
  `toolSource` field; the column already exists from ADR-038.
- **Oracle / MSSQL stubs unaffected** — no new repository methods.
- **Cycle wall-clock grows by network latency × tool count.** An
  agent that makes one MCP call adds the round-trip; the cycle is
  still bounded by the existing `MAX_TOOL_CALLS` cap from ADR-038.
- **Tokens via `tokenFrom: 'harness'` are visible in the project
  repo.** Documented in `harness-config.md` so operators choose
  `env:VAR_NAME` for anything sensitive.

---

## ADR-040 — Corporate identity configuration schema

**Date:** 2026-06
**Status:** Accepted

### Context

ADR-024 defines the identity contract (every provider produces a
`VerifiedIdentity` the AuthManager maps to a `PlatformUser` via
role mapping). The local provider already ships per ADR-025; the
Kerberos / SAML / OIDC stubs in
`packages/server/src/auth/providers/` need real implementations
for the GCC/MENA enterprise market this platform targets.

Sensitive credentials (SAML cert + signing keys, OIDC client
secrets, Kerberos keytab path) should not live in the same file
as application config — they have different lifecycles, different
audit requirements, and different operators (corporate IT vs the
application engineering team).

### Decision

Corporate identity is configured in a dedicated `auth.config.json`
file that the server reads at startup from one of:
1. `process.cwd()/auth.config.json` (dev / docker-compose with a
   bind mount in the workdir)
2. `/etc/gestalt/auth.config.json` (production — placed by IT into
   the container via a volume mount)

The file is **optional**. If absent, the server falls back to the
existing `HARNESS.json` `identity` block (for back-compat with
pre-040 deployments) and finally to the local-only default per
ADR-025.

Schema:

```json
{
  "providers": {
    "kerberos": {
      "enabled": true,
      "realm": "COMPANY.COM",
      "serviceAccount": "HTTP/gestalt.company.com@COMPANY.COM",
      "keytabPath": "/etc/gestalt/krb5.keytab"
    },
    "saml": {
      "enabled": true,
      "entryPoint": "https://adfs.company.com/adfs/ls/",
      "issuer": "https://gestalt.company.com",
      "cert": "MIIBkTC...",
      "callbackUrl": "https://gestalt.company.com/auth/saml/callback",
      "wantAssertionsSigned": true,
      "identifierFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      "attributeMapping": {
        "email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        "displayName": "http://schemas.microsoft.com/ws/2008/06/identity/claims/displayname",
        "groups": "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
      }
    },
    "oidc": {
      "enabled": true,
      "issuer": "https://login.microsoftonline.com/<tenantId>/v2.0",
      "clientId": "...",
      "clientSecret": "...",
      "redirectUri": "https://gestalt.company.com/auth/oidc/callback",
      "scope": "openid profile email groups",
      "groupsClaim": "groups"
    }
  },
  "roleMapping": {
    "platformAdmin": ["gestalt-admins", "domain-admins"],
    "defaultRole": "user"
  },
  "sessionTtlMinutes": 480
}
```

### Rationale

- Separating auth config from application config (HARNESS.json,
  .env) lets corporate IT manage identity independently of
  application deployment.
- Keeping the file path under `/etc/gestalt/` follows POSIX
  convention for machine-wide system config — tighter filesystem
  permissions, separately mountable in Docker.
- The brief's friendly object-keyed shape (`providers.kerberos`,
  `providers.saml`, …) is more ergonomic for IT to author than
  the existing discriminated-union array shape. The loader
  translates to the existing `IdentityConfig` so AuthManager and
  the rest of the auth stack don't need to know about the new
  source.

### Consequences

- Pre-040 deployments using `HARNESS.json` `identity` keep working
  — the loader checks `auth.config.json` first and falls through.
- Sensitive credentials are now confined to a single file the
  operator can mount with `:ro` and `mode 0600`.
- The `kerberos` npm package requires a native addon
  (`krb5-dev` apk pkg on Alpine). The Dockerfile installs the
  build dep; the provider dynamic-imports the package so a missing
  native addon fails gracefully (provider skipped, server still
  starts) — important for macOS dev where the addon may not
  build.

---

## ADR-041 — Quality gate runs after CI, before merge

Date: 2026-06
Status: Accepted

### Decision

The LLM quality gate (constraint-agent + review-agent) runs AFTER
CI passes, as a pre-merge step. It no longer runs before the PR is
created.

New sequence:

```
Aider generates → pr-agent creates PR →
CI (build + tests + lint + security) → CI passes →
gate (constraint-agent + review-agent on the PR branch) →
gate passes → promotion-agent merges → staging → production
```

The pre-CI stubs `lint-agent`, `security-agent`, and
`test-runner-agent` are removed from `@gestalt/agents-quality-gate`
along with their roles in `AgentRole`, their `gate:*` task types,
and their `PER_ROLE_DEFAULTS` entries.

### Rationale

- The LLM gate's value is what CI cannot do: architectural
  compliance and design-spec adherence. Running after CI means the
  gate reviews code that already compiles, passes tests, and
  passes lint — no redundant checks.
- CI uses the project's own tools (its real ESLint config, real
  test runner, real Semgrep rules), which is more accurate than
  the platform's pre-CI stubs ever were.
- A single failure surface (CI) catches the broad class of
  problems CI is good at. Aider's self-healing loop reads CI
  failures via the existing `pipeline-failed` failure type, so
  retries route through the same code path as before.
- The CI provider is configured via `HARNESS.json` `pipeline.adapter`.
  Supported today: `github-actions`, `noop`. The pipeline adapter
  union still names `azure-pipelines`, `gitlab-ci`, `jenkins`;
  those remain typed stubs.

### Implementation

- `packages/agents/quality-gate/src/agents/lint-agent.ts` /
  `security-agent.ts` / `test-runner-agent.ts` deleted.
- Generate orchestrator no longer dispatches `gate:review` at the
  end of a successful cycle — it dispatches `deploy:pr` directly.
- Deploy orchestrator's `deploy:pipeline` success branch now
  dispatches `gate:review` (with `readFromBranch: true`,
  `branch`, `prNumber`, `prUrl`, `ciRunId`) instead of
  `deploy:promotion`.
- Gate orchestrator gains a `readSourceFilesFromWorkDir` walker
  that produces `ArtifactRef[]` from the cloned PR branch (filtered
  by `SOURCE_FILE_EXTENSIONS`, skipping `node_modules` / `dist` /
  `build` / `__pycache__` / etc., capped at 200 files / 64 KiB
  per file). The constraint-agent + review-agent then see the
  exact code CI just tested.
- Gate orchestrator `git fetch origin <branch> && git checkout -B
  <branch> origin/<branch>` before reading source files.
- On gate pass with `readFromBranch: true`, gate dispatches
  `deploy:promotion` (staging) — the rest of the deploy chain
  (production promotion + auto-merge) is unchanged.
- On gate fail, `maybeDispatchRetry` now forwards
  `resumeOnBranch: payload.branch` to the generate retry, so the
  next Aider cycle pushes its fix commit to the same PR branch
  instead of opening a second PR. CI re-triggers automatically on
  the push, then the gate re-runs.
- The CI template (`templates/corporate-ops-web-mobile/ci/gestalt.yml`)
  becomes comprehensive: `Compile`, `Test`, `Lint`, and a Semgrep
  security scan. `StackConfig` gains `lintCmd`.
- The legacy pre-CI gate path (`readFromBranch: false`) is
  preserved as a fallback so in-flight jobs queued before this
  change can still complete.

### Consequences

- Quicker generate cycles — no LLM gate before the PR exists.
- More accurate quality signal — CI uses the project's real
  tooling, not platform stubs.
- The gate now needs the PR branch to exist, so gate cannot run
  on an empty intent. Generate cycles that produce no artifacts
  never reach the gate (matched the prior behaviour anyway).
- `IntentStatus` `in-review` semantics tighten: it now means
  "CI passed, LLM gate running" rather than "code generated,
  gate running". Dashboards rendering the status string keep
  working; the operator-visible meaning is more accurate.
- Pre-existing alerts for `gate-max-retries` continue to fire
  when retries are exhausted; the only behaviour change is that
  the retry leg now pushes to the same PR branch.

---

## ADR-042 — LLM prompt content belongs in HARNESS.json and agents.yaml, not in TypeScript files

**Date:** 2026-06
**Status:** Accepted

**Context:**
Early in the platform's development, LLM prompt content was
embedded directly in TypeScript `.ts` files as string constants
(e.g. `verificationGuidance`, `AGENT_CONFIG`, inline prompt
templates). This created several problems:
- Operators cannot customise agent reasoning without modifying
  platform source code and rebuilding
- Different projects with different stacks, languages, or
  conventions cannot tune agent behaviour
- Prompt improvements require code changes, reviews, and
  deployments rather than config file edits
- The distinction between "how the platform works" and "what
  the platform looks for" was lost

**Decision:**
All LLM prompt content that guides agent reasoning is
externalised to `HARNESS.json` (via `agentConfig`) and
`agents.yaml` (via `role`, `goal`, `prompt_extensions`,
and domain-specific guidance fields). TypeScript prompt
files contain only platform mechanics.

**The split — what goes where:**

Stays in `.ts` (platform mechanics — not operator-configurable):
- JSON response schemas (platform contracts)
- Structural framing ("You are {role}. Goal: {goal}.")
- Context injection placeholders
- Evidence requirement enforcement (`EVIDENCE_REQUIREMENT_SECTION`)
- Parsing and validation logic
- Signal severity caps
- Tool instruction boilerplate (`buildScriptToolInstruction`)

Goes in `agents.yaml` (per-agent, operator-tunable):
- `role` — professional title of the agent
- `goal` — one-sentence mission statement
- `prompt_extensions` — standing project rules appended to every prompt
- Domain-specific guidance fields:
  `phaseScopingRules`, `evaluationCriteria`, `architectureGuidance`

Goes in `HARNESS.json agentConfig` (per-project, operator-tunable):
- `rules` — architectural and quality rules the agent enforces
- `verificationGuidance` — project-specific hints on how to
  verify findings before emitting them
- Domain-specific guidance that varies by project language,
  framework, or architecture pattern

**Rationale:**
This separation mirrors a key principle: the platform owns HOW
agents work (mechanics), operators own WHAT agents look for
(domain knowledge). An operator running a Python/FastAPI project
should be able to change agent reasoning to match their stack
by editing HARNESS.json — not by forking the platform.

This also ensures prompt improvements from real-world testing
(e.g. the repository pattern rule clarifications from
TEST_REPORT_013 through 016) can be captured as config changes
rather than code changes, making them easier to apply and share
across projects.

**Consequences:**
- All new agents must follow this split from day one
- Existing agents are refactored to this pattern incrementally
  as they are touched
- `buildHarnessAgentSection()` in `BaseLLMAgent` is the single
  injection point for HARNESS.json agent config
- `loadAgentConfig()` is the single injection point for
  agents.yaml config
- Code reviews must reject any PR that adds LLM guidance text
  directly to a `.ts` prompt file
- The `agents.yaml` template ships with sensible defaults so
  new projects work out of the box without editing config

**Verification:**
A `.ts` prompt file passes review if it contains no English
prose that guides the LLM's reasoning about the project domain.
It should read like a template with placeholders, not like
a prompt.

---

## ADR-043 — Aider as opt-in code generation backend

**Date:** 2026-06
**Status:** Accepted

**Context:**
The custom code-agent used LLM tool calls (readFile, listDirectory,
searchFiles, getFileTree) to explore the project and generate code.
This proved fragile: agents exhausted tool call budgets exploring
empty directories, missed compilation errors, and generated code
without verifying it compiled. Aider is a battle-tested AI coding
tool with built-in repository awareness, test execution, and
multi-file editing capability.

**Decision:**
Aider is the preferred code generation backend. It is enabled
per-project via `HARNESS.json codeGeneration.backend: "aider"`.
The generate orchestrator checks this flag and either runs Aider
(via executeScript) or falls back to the custom code-agent.
The Aider message is intentionally minimal — task, rules, and
architecture context. HOW to implement is Aider's decision.

**Rationale:**
Aider's repository map understands the codebase without expensive
tool calls. Its built-in test execution catches errors before
committing. Its targeted file editing avoids scope creep. The
platform provides governance (gate, deploy, audit); Aider provides
code generation quality. These complement each other.

**Consequences:**
- Aider must be installed in the server Docker image (pip install aider-chat)
- The Aider message must remain minimal — do not add implementation
  instructions; Aider decides HOW to implement
- test-agent is skipped in Aider mode (Aider writes tests inline)
- The custom code-agent is retained as the default for projects
  that have not opted in to Aider

---

## ADR-044 — Gate agents require gpt-4o; code generation uses gpt-4o-mini

**Date:** 2026-06
**Status:** Accepted

**Context:**
TEST_REPORT_015 proved conclusively that gpt-4o-mini cannot
reliably follow rules that contradict its training bias. The
model read explicit rules stating "pool.query() in *.repository.ts
is CORRECT — do not flag it" and then flagged it anyway, 8 rounds
in a row. gpt-4o has significantly stronger instruction-following
capability and correctly applied the rule in TR_016.

**Decision:**
Gate agents (constraint-agent, review-agent) must use gpt-4o or
an equivalent instruction-following capable model. Code generation
(Aider) uses gpt-4o-mini for its 200k TPM ceiling and lower cost.
Model assignments are per-project via agents.yaml overrides —
not hardcoded in the platform.

**Rationale:**
The gate is the quality enforcement layer. False positives in the
gate cause infinite retry loops that waste tokens and block
deployments. The cost of gpt-4o for the gate (two small LLM calls
per cycle) is justified by the reliability gain. Code generation
at high token volumes (Aider's tool loop) requires gpt-4o-mini's
200k TPM ceiling.

**Consequences:**
- Default platform `agents.yaml` template sets gate agents to
  model: ~ (platform default). Projects must override to gpt-4o
  in their agents.yaml if the platform default is gpt-4o-mini
- Never set gate agents to gpt-4o-mini without extensive testing
  of instruction-following on the specific rule set in use

---

## ADR-045 — Evidence requirement for all finding-emitting agents

**Date:** 2026-06
**Status:** Accepted

**Context:**
Gate agents were emitting findings based on pattern-matching and
inference without quoting the specific code that constituted the
violation. This produced hallucinated findings on correct code
(e.g. flagging ILeaveRepository import as "direct DB access"),
causing retry loops. TEST_REPORT_011 through TR_013 documented
this extensively.

**Decision:**
Any agent that emits a finding, signal, or violation must provide
a `quotedLine` field containing the exact line of code that is
the violation, quoted verbatim from the artifact. Findings without
`quotedLine` are dropped by `dropUnevidencedFindings()` before
reaching the gate verdict. This applies to review-agent,
constraint-agent, and all custom agents.

**Rationale:**
A finding that cannot be grounded in specific quoted evidence is
an inference, not a fact. Requiring quoted evidence forces the
LLM to locate the actual violating code before flagging it.
If the code does not exist, the finding cannot be emitted.
This eliminates hallucinated findings structurally rather than
through prompt engineering.

**Consequences:**
- `EVIDENCE_REQUIREMENT_SECTION` and `dropUnevidencedFindings`
  live in @gestalt/core and are shared by all gate agents
- The JSON schema for all agent finding responses includes
  `quotedLine` as a required field
- Parse failure defaults to dropping the finding — never block
  a cycle because a finding lacks evidence
- The self-healing-agent uses a softer version (warning, not drop)
  since it diagnoses failures rather than making blocking claims

---

## ADR-046 — LLM-driven script execution for gate verification

**Date:** 2026-06
**Status:** Accepted

**Context:**
Gate agents originally used hardcoded regex patterns for constraint
checking. These were language-specific, brittle, and produced
false positives on valid code patterns (e.g. flagging type-only
imports as direct database access). The alternative — pure LLM
evaluation without any tool use — hallucinated findings.

**Decision:**
Gate agents use the `executeScript` built-in tool to verify
findings before emitting them. What scripts to run is decided
by the LLM based on the project language, stack, and the specific
finding being verified. No script commands are hardcoded in
platform `.ts` files. The HARNESS.json `agentConfig.verificationGuidance`
field provides project-specific hints about what to verify,
but the LLM decides the approach.

The `executeScript` sandbox has a hard platform-level blocklist
of destructive operations (rm -rf, git push, git commit, sudo,
curl | bash). This blocklist is never configurable.

**Rationale:**
An LLM that can run `tsc --noEmit` and see actual compiler output
has real evidence for its findings. An LLM reasoning from text
alone hallusinates. The script approach is language-agnostic —
the LLM knows what tools are appropriate for TypeScript vs Python
vs Go without being told. Hardcoding script commands would
re-introduce the language-specific brittleness of the regex approach.

**Consequences:**
- `executeScript` is opt-in per agent via tools.builtin in agents.yaml
- It is enabled by default for constraint-agent and review-agent
- Code-agent has it available for pre-commit self-verification
- stdout capped at 10KB, stderr at 5KB to prevent context overflow
- Timeout defaults to 30s, max 120s

---

## ADR-047 — CI/CD owns runtime verification; Gestalt gate owns architectural review

**Date:** 2026-06
**Status:** Accepted (extends ADR-041)

**Context:**
lint-agent, security-agent, and test-runner-agent were originally
planned as Gestalt gate agents that would run ESLint, Semgrep,
and test runners internally. This would duplicate what CI/CD
already does with the project's own tool configuration.

**Decision:**
Runtime verification (compilation, test execution, lint, security
scanning) belongs exclusively in CI/CD. Gestalt's gate layer
(constraint-agent, review-agent) handles only what CI cannot do:
architectural rule enforcement and design spec compliance.
lint-agent, security-agent, and test-runner-agent are removed.

**Rationale:**
CI/CD runs the exact tools with the exact configuration the team
maintains (.eslintrc, jest.config.js, semgrep.yml). Running
parallel checks in Gestalt creates redundancy, potential
contradictions, and duplication of tool configuration. The
Gestalt gate's value is in architectural intelligence — not
in re-running tools that CI already runs better.

**Consequences:**
- The CI template (gestalt.yml / .gitlab-ci.yml / azure-pipelines.yml)
  is comprehensive: compile + test + lint + security (Semgrep)
- The Gestalt gate only runs after CI passes (ADR-041)
- Adding lint/test/security agents back to the Gestalt gate
  is explicitly prohibited by this ADR

---

## ADR-048 — Self-healing uses LLM-driven retry routing, not hardcoded dispatch maps

**Date:** 2026-06
**Status:** Accepted

**Context:**
The self-healing loop initially used a hardcoded RETRY_TASK_TYPE
map to decide which layer to retry for each failure type
(e.g. deploy-error → deploy:pr, gate-max-retries → generate:intent).
This was rigid — it could not handle novel failures and required
code changes to add new failure patterns.

**Decision:**
The SelfHealingAgent's LLM diagnosis includes a `retryTaskType`
field that dynamically selects the retry layer based on failure
context. The platform does not maintain a hardcoded dispatch map.
Available retry task types are documented in the diagnosis prompt
as options; the LLM chooses based on the specific failure.

**Rationale:**
A non-fast-forward git push error is a deploy-layer failure —
retrying the generate layer wastes tokens regenerating correct
code. A TypeScript compilation error is a generate-layer failure —
retrying the deploy layer without fixing the code accomplishes
nothing. The LLM understands the failure semantics and chooses
the appropriate retry layer without being explicitly programmed
for every case.

**Consequences:**
- `SelfHealingDiagnosis.retryTaskType` is the authoritative
  dispatch decision — no hardcoded maps anywhere in the platform
- The diagnosis prompt documents available retry task types
  as options with descriptions
- Unknown or novel failure types default to generate:intent
  as the safe fallback

---

## ADR-049 — Architecture agent uses phased consultation, not single-call full design

**Date:** 2026-06
**Status:** Accepted

**Context:**
A single LLM call to design a complete feature architecture
loses context and produces shallow results. A leave management
system requires domain model design, module boundary decisions,
API surface design, database schema, and testing strategy —
too much for one context window to reason about deeply.

**Decision:**
The architecture agent is consulted in two modes:
1. High-level (feature-level): produces domain entities, module
   list, dependency map, and recommended phase sequence. No
   implementation detail.
2. Focused (phase-level): produces exact interface signatures,
   import paths, SQL schema for this specific phase, and
   measurable success criteria. Receives actual built code from
   prior phases as context.

**Rationale:**
The same principle applies to architecture as to code generation —
scope matters. A focused architecture consultation for one phase
produces actionable, precise specifications. A full-feature
architecture produces vague generalities. The phase-level
consultation grounds its recommendations in what was actually
built, not just what was planned.

**Future:** When CrewAI migration occurs, the architecture agent
becomes an architecture crew (chief architect, data architect,
application architect) using the same two-mode consultation pattern.
The interface stays identical; the implementation improves.

**Consequences:**
- architecture-agent.ts exposes two methods: designFeature() and
  designPhase()
- Phase-level consultation always receives completed phase results
  as context — never designs in a vacuum
- High-level design is committed to ARCHITECTURE.md before any
  code is generated
