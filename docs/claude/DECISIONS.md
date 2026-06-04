# DECISIONS.md — ADR index for Claude Code

_This is the Claude-Code-facing index. The full rationale, alternatives,
and consequences for every ADR live in
[`docs/DECISIONS.md`](../DECISIONS.md). Read this file to know **which**
ADR to respect; read the canonical file to know **why**._

---

## Index (one-line summaries)

- **ADR-001** — Self-hosted server (not SaaS)
- **ADR-002** — Ephemeral workers (stateless BullMQ consumers)
- **ADR-003** — BullMQ + Redis; queue names use hyphens (`gestalt-<layer>`)
- **ADR-004** — Repository pattern; no direct DB outside adapters
- **ADR-006** — pnpm workspaces monorepo (pnpm 9.x, Node 20)
- **ADR-007** — Five typed feedback signals; never generic errors
- **ADR-013** — Verdict logic centralised in review-agent + gate
- **ADR-018** — Maintenance agents are pure detectors; drift-agent is
  the one exception (additive-only commits to `DOMAIN.md`)
- **ADR-021** — Four typed operator interventions on escalated intents
  (resume / abort / acknowledge-breach / request-clarification)
- **ADR-024** — Pluggable identity providers (kerberos / saml / oidc /
  local)
- **ADR-025** — Local auth non-production only
- **ADR-026** — PlatformUser is a shadow record; IdP is canonical
- **ADR-032** — Git repository IS the project filesystem; server
  clones per cycle
- **ADR-033** — Deploy layer pipeline adapter pattern
- **ADR-034** — Production promotion requires confirmed staging
- **ADR-035** — Maintenance layer typed `MaintenanceIntent` +
  `MonitoringAdapter` pattern
- **ADR-036** — Harness templates live under `templates/`, not inline
  in `routes/projects.ts`
- **ADR-037** — Custom agents in `agents.yaml` (declared by project,
  prompt-only LLM runners)
- **ADR-038** — Built-in file tools for agents (`readFile`,
  `listDirectory`, `searchFiles`, `getFileTree`) + tool-use loop in
  BaseLLMAgent
- **ADR-039** — MCP (Model Context Protocol) integration; external
  tool servers declared per-agent in `agents.yaml`; namespace prefix
  prevents collision with built-ins
- **ADR-040** — `auth.config.json` as the primary identity config
  source; sensitive fields reference vault secrets via `*SecretId`

---

## Expanded summaries — what Claude Code must respect

The ADRs below are the ones Claude Code most frequently violates if
unaware. Read these before editing the deploy layer, the maintenance
layer, the orchestrator, or anything that touches a project's Git
tree.

### ADR-002 — Ephemeral workers
Agents are stateless BullMQ workers. Each task is self-contained:
input comes from the task payload + a fresh repo clone, output is
signals and artifacts. No agent keeps in-memory state between runs.
**Implication:** never reach for a module-level cache or a worker
instance variable to "remember" previous calls; persist via the
repository layer or pass through the payload.

### ADR-003 — BullMQ + Redis for the message queue
All inter-layer dispatch (`generate:intent`, `gate:review`,
`deploy:pr`, …) flows through BullMQ queues over Redis. Queue
names are `gestalt-<layer>` (hyphenated — BullMQ 5.x rejects
colons).
**Implication:** never invoke another layer's handler directly
in-process; always `dispatch()` a task.

### ADR-004 — Repository pattern
No direct DB access outside adapter packages
(`packages/adapters/postgres|oracle|mssql`). Everything goes through
`getRepositories()` returning the typed `RepositoryRegistry`.
**Implication:** if you need new SQL, it lives in an adapter repo
class behind an interface in `@gestalt/core`; the Oracle and MSSQL
stubs must add the same method (even as throw-stubs) so build-time
interface drift is caught.

### ADR-007 — Five typed feedback signals
Signals carry one of `LINT_FAILURE`, `TEST_FAILURE`,
`CONSTRAINT_VIOLATION`, `CONTEXT_GAP`, `GOLDEN_PRINCIPLE_BREACH`.
There is no "generic error" channel.
**Implication:** when an agent surfaces a problem, pick the right
type — `GOLDEN_PRINCIPLE_BREACH` is human-only and never auto-
resolves; the other four are auto-resolvable and route to specific
generate agents through `feedback-router.ts`.

### ADR-018 — Maintenance agents are pure detectors
drift-agent, alignment-agent, gc-agent, evaluation-agent emit
findings and queue typed `MaintenanceIntent` objects — they don't
mutate the project tree directly. The one exception: drift-agent
may commit additive notes to `docs/DOMAIN.md` (additive-only). The
context-fixer is enforced by a path guard restricting it to
`docs/*` and `AGENTS.md` only — never touch `src/`.

### ADR-032 — Git repository is the project filesystem
The server is the only entity that touches a project's Git repo.
`gestalt init` registers the project, the server clones it, writes
the harness, commits, and pushes; subsequent intent cycles clone
fresh per run into a temp dir. `projectRoot` in `ContextSnapshot`
is that temp clone path, never the developer's local machine.
**Implication:** all Git operations go through `simple-git`, never
`child_process.exec('git ...')`. Temp dirs must be cleaned in a
`finally` block. PATs come from `project_git_credentials` (legacy)
OR the vault (`projects.gitSecretId`) via
`resolveProjectCredential(project)` (the shared helper from the
2026-06-04 vault session).

### ADR-033 — Deploy layer pipeline adapter pattern
All CI/CD calls go through the `PipelineAdapter` interface
(`createPullRequest`, `triggerPipeline`, `getPipelineStatus`,
`promoteToEnvironment`, `mergePullRequest`). The active adapter is
resolved per-task from `HARNESS.json` `pipeline.adapter`; absent
or unrecognised values fall back to `NoOpPipelineAdapter` so the
deploy chain still completes.
**Implication:** never call GitHub / Azure DevOps / GitLab APIs
directly from an agent — go through the adapter. New adapter types
extend the `PipelineAdapterType` union AND get a case in
`resolvePipelineAdapter`.

### ADR-034 — Production requires confirmed staging
`promotion-agent` refuses any `production` promotion unless a
`promoted-staging` row exists in `deployment_events` for the same
`correlationId`. Enforcement lives in the agent itself, not the
orchestrator, so future direct callers cannot bypass it.
**Implication:** never add a flag or harness option to skip the
check. Violations raise `GOLDEN_PRINCIPLE_BREACH` and escalate.

### ADR-035 — Maintenance layer typed intents + monitoring adapter
The four maintenance agents queue typed `MaintenanceIntent`
objects — never free-form strings. evaluation-agent talks to
monitoring via a `MonitoringAdapter` (Prometheus / Datadog / NoOp)
resolved per-project from `HARNESS.json`. CONTEXT_UPDATE and
CONTEXT_ALIGNMENT intents take the direct-fix path through
context-fixer (path-guarded to `docs/*` + `AGENTS.md`); other
maintenance intent kinds dispatch into the regular generate loop.
**Implication:** a new maintenance "kind" extends the
`MaintenanceIntent` union, not a new free-text source. New
monitoring backends add a `MonitoringAdapter` impl + resolver case.

### ADR-038 — Built-in file tools
Agents declare `tools.builtin: [...]` in `agents.yaml`; the
BaseLLMAgent's `callLLMWithTools` loop dispatches calls to
`executeFileTool(...)` (file-tools.ts: `readFile`, `listDirectory`,
`searchFiles`, `getFileTree`). All read-only, path-traversal-
guarded by `safePath()`. `MAX_TOOL_CALLS = 10` per agent run.
Tool call audit persisted on `agent_execution_logs.tool_calls`
(JSONB array via `db.json(...)` typed binding).
**Implication:** any new built-in tool MUST be read-only and
sandboxed against `projectRoot`. New tool types go in
`@gestalt/core/tools/file-tools.ts`; the `BuiltInToolName` union
in `@gestalt/core/types` must be extended in lockstep.

### ADR-039 — MCP integration
External MCP servers are declared per-agent in `agents.yaml`
under `tools.mcp[]` (project-level) or via the
`platform_mcp_servers` table (platform-wide). The
`<serverName>__<toolName>` namespace prefix prevents collision
with built-ins. McpClients are cycle-scoped — opened lazily on
first use, closed in the orchestrator's `finally`. Failure modes
are non-fatal: a failed `listTools()` returns `[]`; a failed
`executeTool()` returns `{ isError: true }`. An unreachable MCP
server never aborts a cycle.

### ADR-040 — `auth.config.json` for identity
`auth.config.json` is the primary corporate identity config source.
Optional file, read from cwd or `/etc/gestalt/`. Sensitive
credentials (SAML cert / OIDC client secrets / Kerberos keytab
path) live in a separately-mountable file with tighter permissions.
Legacy HARNESS.json `identity` block continues to work as
fallback. `platform_identity_config` table (migration 017) lets
operators configure providers via the dashboard with values
referencing vault `*SecretId`s.

---

## ADR fast-lookup matrix

| Code path | Read first |
|---|---|
| Editing an agent's LLM call | ADR-002, ADR-007, ADR-038 |
| Editing the orchestrator | ADR-002, ADR-003, ADR-007 |
| Adding a new agent role | ADR-007, ADR-013, ADR-037 |
| Editing pipeline / deploy | ADR-033, ADR-034 |
| Editing maintenance agents | ADR-018, ADR-035 |
| Touching Git / clones | ADR-032 |
| Touching auth / users | ADR-024, ADR-025, ADR-026 |
| Configuring providers | ADR-040 |
| Touching the database | ADR-004 |
| Touching custom agents | ADR-037 |
| Touching tools / MCP | ADR-038, ADR-039 |
