# DECISIONS.md — ADR cheat sheet

This is a Claude-Code-facing summary of the architecture decisions Claude
must respect when editing this repo. It is NOT the full canonical record —
the rationale, alternatives, and consequences for every ADR live in
[`docs/DECISIONS.md`](../DECISIONS.md). Read this file to know what to
do; read the canonical file to know why.

---

## Architecture decisions to respect

All ADRs are in `docs/DECISIONS.md`. Key ones:

- ADR-002: Ephemeral workers — agents are stateless BullMQ workers
- ADR-003: BullMQ + Redis for the message queue
- ADR-004: Repository pattern — no direct DB access outside adapters
- ADR-006: pnpm workspaces monorepo
- ADR-007: Five typed feedback signals — never generic errors
- ADR-025: Local auth non-production only
- ADR-026: PlatformUser is a shadow record
- ADR-032: Git repository is the project filesystem — server clones per cycle,
  agents commit and push, developers git pull. `projectRoot` in
  `ContextSnapshot` is the temp clone path, not the developer's local machine
- ADR-033: Deploy layer pipeline adapter pattern — all CI/CD calls go
  through `PipelineAdapter`; resolved per-task from HARNESS.json;
  `NoOpPipelineAdapter` is the fallback so the deploy chain always runs
- ADR-034: Production promotion requires a confirmed staging
  `promoted-staging` event for the same correlationId. Unconditional;
  cannot be bypassed by adapter / config / operator override
- ADR-035: Maintenance layer queues typed `MaintenanceIntent` objects
  (never free-form strings); evaluation-agent uses a typed
  `MonitoringAdapter` (Prometheus / Datadog / NoOp) resolved per-project
  from HARNESS.json. Drift-agent may commit additive docs notes directly
  (the one ADR-018 exception, additive-only)

---

## Expanded summaries

### ADR-002 — Ephemeral workers
Agents are stateless BullMQ workers. Each task is self-contained: input
comes from the task payload + a fresh repo clone, output is signals and
artifacts. No agent keeps in-memory state between runs.
*Implication:* never reach for a module-level cache or a worker
instance variable to "remember" previous calls; persist via the
repository layer or pass through the payload.

### ADR-003 — BullMQ + Redis for the message queue
All inter-layer dispatch (`generate:intent`, `gate:review`, `deploy:pr`,
…) flows through BullMQ queues over Redis. Queue names are
`gestalt-<layer>` (hyphenated — BullMQ 5.x rejects colons).
*Implication:* never invoke another layer's handler directly in-process;
always `dispatch()` a task.

### ADR-004 — Repository pattern
No direct DB access outside adapter packages
(`packages/adapters/postgres|oracle|mssql`). Everything goes through
`getRepositories()` returning the typed `RepositoryRegistry`.
*Implication:* if you need new SQL, it lives in an adapter repo class
behind an interface in `@gestalt/core`; the Oracle and MSSQL stubs must
add the same method (even as throw-stubs) so build-time interface drift
is caught.

### ADR-006 — pnpm workspaces monorepo
The repo is a pnpm workspace; build order is enforced by package
dependencies, not a custom orchestrator. pnpm 9.x only — pnpm 10+
requires Node 22.
*Implication:* a new package needs a `package.json` workspace entry; do
not introduce a non-workspace local link.

### ADR-007 — Five typed feedback signals
Signals carry one of `LINT_FAILURE`, `TEST_FAILURE`,
`CONSTRAINT_VIOLATION`, `CONTEXT_GAP`, `GOLDEN_PRINCIPLE_BREACH`. There
is no "generic error" channel.
*Implication:* when an agent surfaces a problem, pick the right type —
`GOLDEN_PRINCIPLE_BREACH` is human-only and never auto-resolves; the
other four are auto-resolvable and route to specific generate agents
through `feedback-router.ts`.

### ADR-025 — Local auth is non-production only
The `local` auth provider is intentionally restricted —
`local_auth.allowedInProduction` defaults to false. Production
deployments connect to a real IdP (Kerberos / SAML / OIDC).
*Implication:* never weaken the local-auth guard, even temporarily;
operators expect prod to refuse local sign-in.

### ADR-026 — PlatformUser is a shadow record
The `users` table is a shadow of whichever IdP issued the identity. The
IdP is canonical; `users` exists so internal FKs can point somewhere
and so role mapping can live in our schema.
*Implication:* do not store identity material (email, displayName) as
the source of truth; always reconcile on next login.

### ADR-032 — Git repository is the project filesystem
The server is the only entity that touches a project's Git repo.
`gestalt init` registers the project, the server clones it, writes the
harness, commits, and pushes; subsequent intent cycles clone fresh
per run into a temp dir. `projectRoot` in `ContextSnapshot` is that
temp clone path, never the developer's local machine.
*Implication:* all Git operations go through `simple-git`, never
`child_process.exec('git ...')`. Temp dirs must be cleaned in a
`finally` block. PATs come from `project_git_credentials` via
`projects.getCredential(projectId)`.

### ADR-033 — Deploy layer pipeline adapter pattern
All CI/CD calls go through the `PipelineAdapter` interface
(`createPullRequest`, `triggerPipeline`, `getPipelineStatus`,
`promoteToEnvironment`). The active adapter is resolved per-task from
`HARNESS.json` `pipeline.adapter`; absent or unrecognised values fall
back to `NoOpPipelineAdapter` so the deploy chain still completes.
*Implication:* never call GitHub / Azure DevOps / GitLab APIs directly
from an agent — go through the adapter. New adapter types extend the
`PipelineAdapterType` union AND get a case in `resolvePipelineAdapter`.

### ADR-034 — Production requires confirmed staging
`promotion-agent` refuses any `production` promotion unless a
`promoted-staging` row exists in `deployment_events` for the same
`correlationId`. Enforcement lives in the agent itself, not the
orchestrator, so future direct callers cannot bypass it.
*Implication:* never add a flag or harness option to skip the check.
Violations raise `GOLDEN_PRINCIPLE_BREACH` and escalate the intent.

### ADR-035 — Maintenance layer typed intents + monitoring adapter
The four maintenance agents (drift, alignment, gc, evaluation) queue
typed `MaintenanceIntent` objects — never free-form strings.
evaluation-agent talks to monitoring via a `MonitoringAdapter`
(Prometheus / Datadog / NoOp) resolved per-project from
`HARNESS.json`. drift-agent is the one ADR-018 exception: it may
commit additive docs notes to `DOMAIN.md` directly (additive-only).
*Implication:* a new maintenance "kind" extends the
`MaintenanceIntent` union, not a new free-text source. New monitoring
backends add a `MonitoringAdapter` impl + resolver case.
