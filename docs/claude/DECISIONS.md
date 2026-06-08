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
- **ADR-041** — Quality gate runs AFTER CI, before merge (LLM gate
  reviews code CI has already compiled / tested / linted)
- **ADR-042** — LLM prompt content lives in `HARNESS.json` +
  `agents.yaml`; `.ts` carries only platform mechanics (schemas,
  framing, evidence enforcement, parsing, severity caps)
- **ADR-043** — Aider as opt-in code generation backend
  (`HARNESS.json codeGeneration.backend`)
- **ADR-044** — Gate agents use gpt-4o; code generation uses
  gpt-4o-mini
- **ADR-045** — Evidence requirement (`quotedLine`) for all
  finding-emitting agents
- **ADR-046** — LLM-driven `executeScript` for gate verification —
  no hardcoded commands
- **ADR-047** — CI/CD owns runtime verification; Gestalt gate owns
  architectural review
- **ADR-048** — Self-healing uses LLM-driven retry routing — no
  hardcoded dispatch maps
- **ADR-049** — Architecture agent uses phased consultation —
  high-level then per-phase
- **ADR-050** — All evaluation and routing decisions made by LLM —
  no hardcoded decision logic
- **ADR-051** — CodiumAI PR-Agent replaces the custom review-agent
  on github-actions pipelines; review-agent stays as fallback
- **ADR-053** — Qodo Gen replaces test-agent in generate layer
  (accepted, pending implementation)
- **ADR-054** — SWE-agent handles bug-fix maintenance intents
  (accepted, pending implementation)
- **ADR-055** — K8sGPT feeds Gestalt Kubernetes operations layer
  (accepted, pending implementation)

> ADR-052 (external scanner webhook → MaintenanceIntent pattern)
> is referenced by ADR-054–055 but has not yet been authored —
> backfill when the next session touches that code.

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

### ADR-041 — Quality gate runs AFTER CI
The LLM gate (constraint-agent + review-agent) runs as a pre-merge
step on the PR branch, AFTER CI passes. CI owns compile / test /
lint / security via the project's own tooling. Pre-CI `lint-agent`
/ `security-agent` / `test-runner-agent` are gone. Generate
orchestrator dispatches `deploy:pr` directly at end of cycle (not
`gate:review`); deploy's `deploy:pipeline` success branch
dispatches `gate:review` with `readFromBranch: true` + branch /
prNumber / prUrl / ciRunId. Gate clones the PR branch, checks it
out, reads source files from the working tree. On pass:
`deploy:promotion`. On fail: `resumeOnBranch` so the retry leg
pushes to the same PR.
**Implication:** never re-add the deleted pre-CI gate agents
(ADR-047 forbids it). Don't re-route generate → gate:review
directly. Don't open a second PR on gate-fail retry — the same
branch must receive the fix commit.

### ADR-042 — LLM prompt content lives in HARNESS.json + agents.yaml
Project-specific LLM guidance prose (rules, `verificationGuidance`,
`prompt_extensions`, `architectureGuidance`, `phaseScopingRules`,
`evaluationCriteria`, role / goal) lives in
`HARNESS.json.agentConfig[role]` or `agents.yaml`. `.ts` carries
only platform mechanics: JSON response schemas, structural
framing ("You are {role}. Goal: {goal}."), evidence requirement
(`EVIDENCE_REQUIREMENT_SECTION`), parsing, severity caps, tool
instruction boilerplate. Injection points are
`buildHarnessAgentSection()` (HARNESS.json) and `loadAgentConfig()`
(agents.yaml).
**Implication:** if you catch yourself adding English prose to a
`.ts` prompt file that guides LLM reasoning about the project
domain, stop — it belongs in `HARNESS.json.agentConfig[role].rules`
or `verificationGuidance`. A `.ts` prompt file should read like a
template with placeholders, not like a prompt.

### ADR-043 — Aider as opt-in code-gen backend
`HARNESS.json codeGeneration.backend: "aider"` swaps the
generate-layer code-agent for Aider, invoked via the
`executeScript` tool. The Aider message stays minimal — task +
rules + architecture context only; HOW to implement is Aider's
call. `test-agent` is skipped when Aider runs (Aider writes
tests inline). The custom code-agent remains the default for
projects that haven't opted in.
**Implication:** don't add implementation instructions to the
Aider message. Don't run `test-agent` when Aider mode is active.
Aider must be installed in the server Docker image
(`pip install aider-chat`).

### ADR-044 — Gate uses gpt-4o; code-gen uses gpt-4o-mini
gpt-4o-mini cannot reliably follow rules that contradict its
training bias (TR_015 proof: 8 rounds flagging `pool.query()` in
`*.repository.ts` despite explicit "this is CORRECT" rule). Gate
agents (constraint-agent, review-agent) must use gpt-4o or an
equivalent. Code-gen tolerates gpt-4o-mini for the 200 k TPM
ceiling. Per-project assignment via `agents.yaml` model
overrides — never hardcoded.
**Implication:** never set gate agents to gpt-4o-mini without
extensive instruction-following testing on the specific rule set.
Reach for code-gen-tier models for code-gen volume; gate-tier
models for verdict reliability.

### ADR-045 — Evidence requirement (`quotedLine`)
Every finding from review-agent / constraint-agent / custom
finding-emitting agents must carry a `quotedLine` field with the
violating code quoted verbatim from the artifact.
`dropUnevidencedFindings()` drops findings without `quotedLine`
before the gate verdict. Lives in `@gestalt/core` and is shared.
**Implication:** any new finding-emitting agent's JSON response
schema must require `quotedLine`. Parse failure defaults to
dropping the finding — never block a cycle for evidence-shape
issues. self-healing-agent uses a softer warning (not drop)
since it diagnoses failures rather than making blocking claims.

### ADR-046 — LLM-driven `executeScript` for gate verification
No hardcoded script commands in platform `.ts` files. Gate agents
get `executeScript` as a built-in tool; the LLM decides what to
run based on project language / stack / finding.
`HARNESS.json.agentConfig.verificationGuidance` provides hints;
the LLM picks the approach. Platform-level blocklist (`rm -rf`,
`git push`, `git commit`, `sudo`, `curl | bash`) is never
configurable. stdout capped 10 KB / stderr 5 KB. Timeout 30 s
default / 120 s max.
**Implication:** never write `executeScript({ command: "tsc
--noEmit" })` or similar in a `.ts` prompt — put the hint in
HARNESS.json `verificationGuidance` and let the LLM choose. Never
relax the blocklist.

### ADR-047 — CI owns runtime, gate owns architecture
Extends ADR-041. Compile / test / lint / security belong in CI/CD
with the project's own config (`.eslintrc`, `jest.config.js`,
`semgrep.yml`). Gate handles architectural rule enforcement and
design-spec compliance only. `lint-agent` / `security-agent` /
`test-runner-agent` permanently removed.
**Implication:** adding any of those agents back to the gate is
explicitly prohibited by this ADR. A new "runtime check" goes in
the CI template, not in the gate.

### ADR-048 — LLM-driven retry routing
`SelfHealingDiagnosis.retryTaskType` is the authoritative
dispatch decision. The platform does NOT maintain a hardcoded
`RETRY_TASK_TYPE` map. The diagnosis prompt documents available
retry task types as options; the LLM picks based on failure
semantics (git non-fast-forward → `deploy:pr`, TS compile error
→ `generate:code`). Unknown / novel failures fall through to
`generate:intent` as a safe default.
**Implication:** never reintroduce a hardcoded failure-type →
layer map. New failure shapes are handled by widening the
diagnosis prompt's option list (and its descriptions), not by
adding code paths.

### ADR-049 — Phased architecture consultation
architecture-agent exposes two methods: `designFeature()`
(high-level — domain entities, module list, dependency map,
phase sequence; no implementation detail) and `designPhase()`
(focused — interface signatures, import paths, SQL schema,
measurable success criteria; receives prior phases' actual code
as context). High-level design is committed to
`docs/ARCHITECTURE.md` before any code generation. Phase-level
consultation never designs in a vacuum.
**Implication:** never collapse the two methods into a single
"design everything up front" call. `designPhase()` must receive
completed phase results. Future CrewAI migration keeps the same
two-mode interface (chief / data / app architect crew); don't
change the surface.

### ADR-050 — LLM-driven evaluation and routing (no hardcoded decision logic)
Any decision that requires evaluating context, classifying a
situation, or choosing between multiple actions is made by an
LLM — never by a hardcoded `switch`, `if/else` chain, regex,
or string-match map. The platform supplies the tools to gather
evidence (`executeScript`, `readFile`), the JSON output schema,
and the routing logic for each possible value. The LLM supplies
the evaluation, classification, and chosen action. Hardcoded
logic is acceptable ONLY for: safety blocklists (e.g.
`BLOCKED_PATTERNS` in executeScript), structural validation
(UUID / JSON syntax / file-extension checks), and platform
mechanics that are deterministic consequences of a prior LLM
decision (e.g. dispatching to the queue named in
`diagnosis.retryTaskType`).
**Implication:** when adding a new type of evaluation, the
default question is "what LLM output field drives this
routing?" — not "what conditions should I check?". Regex for
semantic evaluation, "known error" lookup tables, and
failure-type → handler maps all fail this ADR. Project-specific
guidance lands in `HARNESS.json agentConfig` rules (ADR-042)
as LLM instructions, not as platform checks.
**Compliance test:** if a reviewer can replace a code block
with "ask the LLM and route on its answer", that block should
be replaced. If the block is a direct consequence of a previous
LLM decision (routing on `diagnosis.retryTaskType`), it is
acceptable routing logic, not evaluation logic.

---

## ADR fast-lookup matrix

| Code path | Read first |
|---|---|
| Editing an agent's LLM call | ADR-002, ADR-007, ADR-038, ADR-042, ADR-050 |
| Editing prompt content / agent reasoning | ADR-042, ADR-045, ADR-046, ADR-050 |
| Editing the orchestrator | ADR-002, ADR-003, ADR-007, ADR-050 |
| Adding a new agent role | ADR-007, ADR-013, ADR-037, ADR-042, ADR-050 |
| Editing the gate / pre-merge flow | ADR-041, ADR-045, ADR-046, ADR-047, ADR-050 |
| Editing pipeline / deploy | ADR-033, ADR-034, ADR-041 |
| Editing code-gen / Aider integration | ADR-043, ADR-044 |
| Editing self-healing / retry routing | ADR-048, ADR-050 |
| Editing planning / architecture agent | ADR-049, ADR-050 |
| Adding any decision logic (`switch` / `if/else` / regex / dispatch map) | ADR-050 |
| Editing maintenance agents | ADR-018, ADR-035 |
| Touching Git / clones | ADR-032 |
| Touching auth / users | ADR-024, ADR-025, ADR-026 |
| Configuring providers | ADR-040 |
| Touching the database | ADR-004 |
| Touching custom agents | ADR-037, ADR-042 |
| Touching tools / MCP | ADR-038, ADR-039, ADR-046 |
