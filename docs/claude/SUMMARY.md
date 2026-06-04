# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md

_Auto-regenerated after every session by Claude Code. Do not edit by hand._

_Generated: 2026-06-04_

---


_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-04
**Repo:** https://github.com/afarahat-lab/gestalt
**Migrations:** 023 (latest: `023_llm_api_shape`)

---

## What is built and verified

### Platform foundations

- All 12 buildable packages compile (`pnpm -r build`).
- `docker-compose up -d` brings server + postgres + redis healthy.
- All 23 migrations apply on first start.
- Server reachable on `http://localhost:3000`; `/health` returns 200;
  protected routes return 401 without a JWT.
- Dashboard SPA served at `/app/*`; shareable deep-link URLs work.
- First-boot bootstrap verified: `gestalt init-admin` → `gestalt login`
  → `/auth/me` returns the user.

### Four SDLC layers (all wired end-to-end)

- **generate** — intent → design → context → lint-config → code → test;
  custom agents in `agents.yaml` interleave via `runs_after`.
- **quality-gate** — constraint-agent (regex) + review-agent (LLM).
  Verdict: `pass` / `fail` (auto-retry) / `escalate` (GP_BREACH).
  Max gate retries: 3.
- **deploy** — pr-agent → pipeline-agent → promotion-agent
  (staging → production). `PipelineAdapter` interface;
  `GitHubActionsAdapter` + `NoOpPipelineAdapter` implemented.
  ADR-034 production-requires-staging enforced. Auto-merge supported
  via `pipeline.autoMerge` in HARNESS.json.
- **maintenance** — drift / alignment / gc / evaluation, scheduled via
  `node-cron`. Context-file intents take a direct-fix path via
  context-fixer (path-guarded to `docs/*` + `AGENTS.md`).
  `MonitoringAdapter` (Prometheus / Datadog / NoOp).

### Identity + auth

- Local auth (non-production only, ADR-025).
- Kerberos / SAML / OIDC providers (ADR-024); `auth.config.json`
  primary source, HARNESS.json `identity` block fallback (ADR-040).
- Two-tier role model: platform roles (`platform-admin` | `user`),
  project roles (`project-admin` | `editor` | `reader`).
- Platform groups for bulk assignment (Brief 1, migration 018);
  effective project role = max of direct + group-derived.
- Server-side membership enforcement on every read + write endpoint;
  no-enumeration-leak rule (empty array, not 403).
- Hot-reload of identity providers without server restart
  (`POST /platform/identity/reload`).

### Platform admin surfaces

- **Users** — CRUD + deactivate + self-protection guards.
- **Projects** — platform-admin create / delete (with active-intents
  guard) / list with cross-project enrichment (members / intents /
  last activity).
- **Groups** — CRUD, members, project assignments with role
  precedence.
- **LLM registry** (migration 014) — per-row baseUrl / apiKeyEnv /
  apiShape (`chat-completions` vs `responses` for gpt-5/o1/o3).
- **Secrets vault** (migrations 015+016) — AES-256-GCM encrypted,
  master key at `/etc/gestalt/master.key` or
  `GESTALT_MASTER_KEY` env; rotation tooling (migration 021).
- **Self-healing** (migration 020) — 7 per-failure-type configs;
  diagnostician picks `retryTaskType` + hints; alerts auto-resolve
  at high confidence.
- **Templates** — harness templates table (migration 017) +
  download / duplicate / edit / push / diff (dashboard + CLI).
  Built-in templates read-only; duplicate first to customise.
- **MCP servers** — platform-wide MCP servers (`platform_mcp_servers`).
- **Self-healing** + **identity** dashboard tabs.

### Project lifecycle

- `gestalt init` registers project; server clones repo, generates
  stack config via LLM (`generateStackConfig`), substitutes
  variables into harness template, commits + pushes.
- Phase-1 project description accepts multi-line input via a
  three-mode chooser (single-line default / END-terminated /
  `$EDITOR`). The full body is passed verbatim into
  `generateStackConfig` and into the template's
  `{{projectDescription}}` substitution. Template engine
  JSON-escapes substituted values when the target file is `.json`
  (engine.ts `substitute(..., { jsonEscape: true })`) so newlines
  + quotes + control chars in the description land safely inside
  HARNESS.json string literals; markdown / yaml files keep raw
  newlines.
- Vault-backed Git PATs (migration 022) — operators link a vault
  secret to a project; resolver decrypts server-side per-cycle.
- GitHub repo browser via `/platform/git/repos` proxy.
- Dynamic harness — LLM picks language / framework / package
  manager / test runner at init time.

### Agent infrastructure

- `BaseLLMAgent` in `@gestalt/core/agents` — every LLM-using agent
  in every layer extends it. Captures `lastPrompt` /
  `lastLlmResponse` / `lastModelUsed`.
- Built-in file tools (ADR-038, migration 012): `readFile`,
  `listDirectory`, `searchFiles`, `getFileTree`. Read-only,
  path-traversal-guarded.
- MCP integration (ADR-039) — external tool servers per-agent in
  `agents.yaml`. Namespace prefix prevents collision with built-ins.
- Per-agent LLM model override + tools.builtin + tools.mcp +
  prompt_extensions, all driven by `agents.yaml` in the project repo.
- Custom agents (ADR-037) — prompt-only LLM runners declared by the
  project; topo-sorted via `runs_after`.
- Section-based prompts (architecture / constraints / scope /
  design / intent / principles / domain / signals / task) — every
  LLM-generating agent opens with non-negotiable rules.

### Observability + operator surfaces

- Per-agent `agent_executions` + `agent_execution_logs` rows
  (migration 007 + 009 + 012) with prompt / response / model /
  tool calls.
- Live event bus (`@gestalt/core/events`) → SSE at
  `/events`. Dashboard subscribes for instant updates.
- IntentDetail accordion with prompt + LLM response + tool calls
  + signals + artifacts.
- Active agents card with cycle progress + token totals.
- Deployments view: 4/5-node pipeline timeline (5th node for
  auto-merged cycles).
- Maintenance view: per-run findings expansion panel.
- Alerts: per-type bodies + interventions (ADR-021).
- Pipeline failure alerts with operator feedback → resume on the
  same branch (migration 019).
- Operator-driven CLI parity: `gestalt intent / gate / deploy /
  agents active / maintenance / status --graph --watch`.

### CLI

- Bootstrap: `init-admin`, `login`, `init`, `run`, `status`, `logs`.
- Project: `projects list/use/set-adapter/update-token`;
  `project config show/set-agent/set-pipeline/add-custom-agent/...`
- Alerts: `alerts list/show/fix/dismiss/resume/abort/acknowledge/
  pipeline-feedback`.
- Platform admin (gated to platform-admin): `users`,
  `platform llms / secrets / projects / templates / mcp /
  tools / identity / groups / self-healing`.
- Intent: `intent list/show/submit` with `--watch` + filters
  (`--source`, `--priority`, `--search`, `--from`, `--to`).
- Templates push + diff (added 2026-06-04).
- Shared multi-line prompt helpers in `@gestalt/cli/ui/prompts`:
  `promptMultiline` / `promptWithEditor` /
  `promptMultilineDescription`. Used by `gestalt init` (Phase 1
  description) and `gestalt project config add-custom-agent`
  (prompt body). Backwards-compatible single-line default.

---

## Implemented with caveats

- **Quality-gate** — `lint-agent` / `security-agent` /
  `test-runner-agent` are stubs (need a `pnpm install` step in the
  cloned tree). The package works end-to-end via
  `constraint-agent` + `llm-review-agent`.
- **Deploy** — `GitHubActionsAdapter` + `NoOpPipelineAdapter` are
  the only implementations. Azure DevOps / GitLab CI / Jenkins
  are typed stubs in the `PipelineAdapterType` union.
- **Maintenance** — `Prometheus` / `Datadog` `MonitoringAdapter`
  implementations exist but aren't yet verified against a real
  monitoring instance. NoOp is the verified path.
- **Identity** — Local + OIDC verified end-to-end via the
  Keycloak fixture. SAML compiles + the route shape is verified
  but full end-to-end against a real IdP only exercised once.
  Kerberos provider compiles; not exercised end-to-end (needs a
  real AD + krb5.keytab).

---

## What is not yet built

- `@gestalt/adapter-oracle` — every repository method throws.
- `@gestalt/adapter-mssql` — every repository method throws.
- `@gestalt/registry` — types + client only; no server, no UI.
- Non-GitHub `PipelineAdapter` impls (Azure DevOps / GitLab CI /
  Jenkins).
- GitLab / Azure DevOps / Bitbucket support in
  `/platform/git/repos` (GitHub only today).
- LDAP group lookup for Kerberos identities (Kerberos tickets
  carry user only; groups need AD query).

---

## Active follow-ups (small)

- **`gestalt run --project <name>` stores the literal NAME in
  `intents.project_id`** instead of resolving to UUID. Orchestrator
  then errors `invalid input syntax for type uuid` from
  `PostgresProjectRepository.findById`. One-line fix: call the
  existing `resolveProjectId` helper at
  `packages/cli/src/commands/run.ts:34`. Server defense-in-depth:
  validate `projectId` at `POST /intents`. Tracked in
  `docs/claude/TEST_REPORT_001.md` (Fix A + Fix B). Discovered
  2026-06-04 during live test against trackeros.
- **`agent_executions.tokens_used` is always 0** even for cycles
  where the `llm` module logs report real token usage. Per-agent
  token rollups in `gestalt intent show` are wrong as a result.
  Fix D in TEST_REPORT_001.
- **`gestalt intent show <8-char-prefix>` no longer matches**
  despite the help text claiming prefix support. Only full UUID
  works. Fix E in TEST_REPORT_001.
- **`gestalt run --watch` is undocumented / missing.** Operators
  expect submit-and-tail in one step; today they must
  `gestalt run … && gestalt intent show <id> --watch`. Fix F in
  TEST_REPORT_001.
- **Self-healing diagnostician retries on `22P02 invalid input
  syntax for type uuid`** — wasted LLM call for an unrecoverable
  error. Fix C in TEST_REPORT_001.
- **Dashboard bundle is 1010 KB raw / 319 KB gzipped** after the
  CodeMirror addition (2026-06-04). Above Vite's 500 KB warning.
  Future code-split via dynamic `import()` would restore the
  main bundle to ~370 KB.
- **Retry cycle full re-runs all generate agents** even though
  only routed agents need fresh work. Skipping intent/design/
  context when prior artifacts are present in the Git tip would
  speed retries by ~30 s.
- **`qualityGate.maxRetries` hardcoded to 3** in both gate and
  generate orchestrators; reading it per-project from
  HARNESS.json is a small follow-up.
- **Promotion workflow dispatches against a hardcoded `'main'`
  ref.** Projects on `master` / `trunk` will see promotion
  workflow-dispatch fail. Thread `project.defaultBranch` through.
- **No proactive PAT-scope validation at registration /
  set-adapter time.** A PAT missing `workflow` scope only
  surfaces on the first pipeline dispatch.
- **Return-URL preservation across login.** Pasting
  `/app/intents/<id>` in a fresh tab bounces to `/app/login`
  then lands on `/app/` (intent ID dropped).
- **Vite dev-server proxy `/api` entry is dead** — server has
  no routes under `/api`. Pre-existing dead config; remove on
  next dashboard touch.
- **Encrypt Git PATs at rest in the legacy
  `project_git_credentials` table.** Vault path is the modern
  flow; legacy plain-token path still has the TODO comment.
- **LLM model name not validated at startup** — an invalid model
  only surfaces as a 404 on the first LLM call.
- **HA replica support for OIDC state.** Today's state is
  in-memory; multi-replica deployments would need Redis-backed
  state so the callback can hit a different replica than the
  login.

---

## Operator caveats / pending actions

- **trackeros `.github/workflows/gestalt.yml`** still pins Node
  20 (project bootstrapped before the 2026-06-04 Node 22 LTS
  template change). Edit `node-version: '20'` → `'22'` + commit
  manually. Non-breaking — Node 20 still works.
- **trackeros PR #46** — synthetic test PR opened during
  vault-credential live verification (2026-06-04). Close with
  `gh pr close 46 --repo afarahat-lab/trackeros --delete-branch`.
- **Re-create vault secret for OpenAI API key** if the operator
  wants vault-backed routing. The dev-override container restart
  during ADR-023 (apiShape) verification regenerated
  `master.key`, breaking the prior vault secret. Both LLMs are
  currently in env-var mode and working.
- **Open alert** (type `generate-error`, severity `high`,
  correlation `06299649-2db4-4d64-8785-167e025cbacb`) from the
  2026-06-04 test-report cycle. Will auto-resolve once Fix A
  lands and the same intent is re-run, or dismiss explicitly
  with `gestalt alerts dismiss`.

---

## CLI install

`@gestalt/cli` is private — not on npm.
```bash
pnpm --filter @gestalt/cli build && cd packages/cli && npm link
```

---

## First-boot sequence

1. `docker-compose up -d` — start platform.
2. `gestalt init-admin` — create admin user (TTY only, once
   per server).
3. `gestalt login` — authenticate CLI.
4. `mkdir my-project && cd my-project && git init && git remote
   add origin <url>`.
5. `gestalt init` — register project + server pushes harness.
6. `git pull` — receive harness files locally.
7. `gestalt run "<intent>"` — submit work to agents.

---


## How to run builds

```bash
pnpm -r build                 # build all packages (topological order)
pnpm --filter @gestalt/core typecheck

docker-compose up -d          # postgres + redis + server (production stage)
docker-compose logs -f server
```

---

## Current build status

| | |
|---|---|
| `pnpm -r build` | ✅ clean (12 packages) |
| `docker-compose up -d` | ✅ healthy (server / postgres / redis) |
| Migrations applied | 023 (latest: `023_llm_api_shape`) |
| Server reachable | `http://localhost:3000/health` returns 200 |
| Dashboard | served at `http://localhost:3000/app/` |

The 12 buildable packages: `@gestalt/core`, `@gestalt/adapter-postgres`,
`@gestalt/adapter-oracle` (stub), `@gestalt/adapter-mssql` (stub),
`@gestalt/agents-generate`, `@gestalt/agents-quality-gate`,
`@gestalt/agents-deploy`, `@gestalt/agents-maintenance`,
`@gestalt/registry`, `@gestalt/server`, `@gestalt/cli`,
`@gestalt/dashboard`.

---

## Known issues

None blocking the build. Areas to keep in mind:

1. **`UserRepository` and `ProjectRepository` extensions touch every
   adapter.** Adding a method to the interface means the Oracle and
   SQL Server stubs must add the same method (as throw-stubs is
   fine). Build will fail until every adapter implements the new
   surface — that's the intent.
2. **CLI pins chalk@4 / ora@5 for CJS compatibility.** Do not upgrade
   either without performing the full ESM migration (`"type":
   "module"`, `.js` extensions on relative imports, Dockerfile
   update). The pin is intentional.
3. **Dashboard bundle is 1010 KB raw (319 KB gzipped)** after the
   CodeMirror addition in the 2026-06-04 template editor session.
   Above Vite's 500 KB warning. Acceptable for an admin-only feature;
   candidate for a future code-split via dynamic `import()`.
4. **LLM model name not validated at startup.** `loadConfig` accepts
   any non-empty string for `LLM_MODEL`. An invalid model only
   surfaces as a 404 on the first LLM call. Set a valid model in
   `.env` (or seed the platform LLM registry) before running
   `gestalt run`.

---

## Pending operator actions

- **`gestalt run --project <name>` bug** (BLOCKING the operator
  workflow that uses an explicit project flag). One-line CLI fix
  + server defense-in-depth — see `docs/claude/TEST_REPORT_001.md`.
  Workaround: use `gestalt projects use trackeros` first, then
  `gestalt run "…"` without `--project`. Discovered 2026-06-04.
- **trackeros `.github/workflows/gestalt.yml`** still pins Node 20
  (project was bootstrapped before the 2026-06-04 Node 22 LTS
  template change). Edit `node-version: '20'` → `'22'` + commit.
  Non-breaking — Node 20 still works.
- **trackeros PR #46** (synthetic test PR opened during vault-
  credential live verification). Close with
  `gh pr close 46 --repo afarahat-lab/trackeros --delete-branch`.
- **Re-create vault secret for OpenAI API key** if the operator
  wants vault-backed routing. The dev-override container restart
  during ADR-023 (apiShape) verification regenerated `master.key`,
  breaking the prior vault secret. Both LLMs are currently in
  env-var mode (`apiKeyEnv: 'LLM_API_KEY'`) and working.

---

## Type alignment rules

Moved to [@docs/claude/ARCHITECTURE.md](./ARCHITECTURE.md#key-type-alignment-rules).

---


_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---

### Session 2026-06-04 — Claude Code (Test Report 001: live scaffold intent against trackeros surfaces a `gestalt run --project <name>` UUID-resolution bug — read-only diagnostic session, no code changes)

Diagnostic / observational session. Goal: submit a real scaffolding
intent against the live trackeros project, capture every agent's
prompt + response, and produce a structured report
(`docs/claude/TEST_REPORT_001.md`) for the platform owner to paste
into the design chat. The user explicitly forbade any source or
config changes — the deliverable is the report itself, not a fix.

Outcome: the intent **failed before any agent dispatched**, blocked
by a previously-undetected platform bug in the `--project` flag
handling. The session pivoted from "review what the agents
produced" to "explain why no agent ever ran and what the platform
needs to fix to make the test repeatable."

What the user asked for:

- `gestalt run "Scaffold the project foundation. Create
  package.json with express pg jsonwebtoken bcrypt and dotenv as
  dependencies. Add typescript ts-node jest and the relevant type
  definitions as dev dependencies. Create tsconfig.json with
  strict mode targeting Node 22. Create jest.config.js. Create
  src/shared/types/index.ts with the AppError class and Leave
  domain enums for LeaveType LeaveStatus and UserRole. Create
  src/shared/db/connection.ts with the pg Pool singleton."
  --project trackeros --watch` — submitted (minus the `--watch`
  flag, which doesn't exist on `gestalt run`; that surfaced
  Issue #3 in the report).
- Capture every agent's output via `gestalt intent show`,
  `gestalt gate show`, `gestalt deploy show`, and direct DB
  reads from `agent_executions` / `agent_execution_logs` /
  `artifacts` / `signals`.
- Write a detailed analysis to `docs/claude/TEST_REPORT_001.md`.

What actually happened on the platform:

- Intent ID `c867da2a-c5ed-49f1-82c4-1a4e4ae27c06`, correlation
  `06299649-2db4-4d64-8785-167e025cbacb`. Status: `failed`
  inside ~10s wall-clock, with `attempt_count = 1`.
- **Zero rows in `agent_executions` / `agent_execution_logs` /
  `artifacts` / `signals`** for this correlation. The
  orchestrator threw `PostgresError: invalid input syntax for
  type uuid: "trackeros"` from
  `PostgresProjectRepository.findById` before any agent
  dispatched. Three LLM calls (≈9 350 ms total) were consumed
  by the self-healing diagnostician, which correctly identified
  the symptom and ended at medium confidence with
  `retryTaskType: none`. One row was written to `alerts`
  (type=`generate-error`, severity=`high`, required_action=
  `provide-feedback`).
- Root cause traced (by an Explore subagent against the source):
  - `packages/cli/src/commands/run.ts:34` reads `--project`
    raw and forwards it as `projectId` to the server; **does
    not** call the `resolveProjectId(client,
    config.currentProjectId, options.project)` helper that
    `packages/cli/src/commands/intent.ts:91` and `:274-289`
    already implement and use correctly.
  - `packages/server/src/routes/intents.ts:62-89` accepts the
    raw value and INSERTs it into `intents.project_id` (a
    `text` column) without any UUID validation or
    name-to-UUID lookup.
  - The first time the value is coerced to UUID is inside
    `packages/adapters/postgres/src/repositories/projects.ts:43-49`
    (`PostgresProjectRepository.findById`), which throws.
  - Every prior intent in this project's history was
    submitted via the "current project" path (where
    `gestalt projects use trackeros` resolves the name to a
    UUID via `packages/cli/src/commands/projects.ts:302`), so
    the `--project <name>` failure mode had been masked until
    this run.

Why this surfaces now: the previous two sessions
(multi-line-description prompt + JSON-escape fix) lifted
`gestalt init` to accept multi-line bodies and fixed the
HARNESS.json substitution to JSON-escape values — both
prerequisites for the live test the user wants to run here. The
test exposed an independent, longer-standing bug in the
`--project` CLI surface.

Captured (read-only):

- Confirmed via `gestalt projects list` that trackeros
  is registered (UUID `5d99e2f3-f3cb-4842-a03a-419790f70e2d`).
- Confirmed via `gestalt project config show --project
  trackeros` that all 9 generate / quality-gate / maintenance
  agents are configured (intent / design / context / code /
  test / review / drift / alignment / context-fixer), no
  custom agents declared.
- Pulled the orchestrator stack trace from
  `docker logs gestalt-server-1` showing the exact `findById`
  call site + postgres error code `22P02`.
- Compared to control: the immediately-prior smoke-test cycle
  (correlation `0389391b-…`) has 15 rows in `agent_executions`
  across three retry rounds (intent → design → context →
  lint-config → code-agent), with code-agent failing every
  round on the OpenAI rate limit. The agent pipeline is
  healthy when it gets to run; only the entry point is
  broken.
- Surfaced four secondary platform issues in passing:
  (a) `agent_executions.tokens_used` is 0 on every row in the
  control cycle despite real LLM calls;
  (b) `gestalt intent list` did not include the new intent
  because the server-side filter resolves `--project
  trackeros` to a UUID and the broken row's `project_id` is
  the literal name `'trackeros'`;
  (c) `gestalt intent show <8-char-prefix>` returned "No
  intent matches" despite the help text claiming prefix
  support — only full UUID worked;
  (d) the diagnostician's `escalation_reason` contains a
  double period (`syntax..`).

Deliverable:

- **`docs/claude/TEST_REPORT_001.md`** (new file, ~17KB) —
  full structured report with: per-agent status table,
  per-agent analysis (every agent "not dispatched"),
  artifacts table (empty), signals table (empty), alert row
  contents, 9 numbered issues, 7 recommended platform fixes
  (Fix A: resolve names in `run.ts:34`; Fix B: validate
  `projectId` at `POST /intents`; Fix C: skip retry on
  `22P02`; Fix D: capture per-agent tokens; Fix E: fix
  prefix matching in `intent show`; Fix F: implement or
  document `gestalt run --watch`; Fix G: strip trailing
  period in diagnostician), verdict, and a raw-evidence
  appendix with full server log timeline + alert context
  + comparison control-cycle `agent_executions` dump.

Decisions made:

- **Did not run `pnpm` builds or restart the server.** The
  brief explicitly forbade source + config changes. A bug
  fix was tempting (it's a one-line change in `run.ts:34`)
  but the user wants the report first, presumably to
  decide which of the 7 recommended fixes to ship + in what
  order. The fix can be applied in a follow-up session.
- **Used Explore subagent for the code-path trace.** The
  bug spans 4 files (CLI command, CLI client, server
  route, postgres adapter). A subagent could read all four
  and produce a citation-style trace without burning the
  main conversation context. Returned a clean
  file:line-keyed report which became the foundation of
  the report's "Issue #1" section.
- **Comparison control cycle pulled from the prior smoke
  test** (correlation `0389391b-…`, 12 min earlier in this
  same project). Demonstrates that the agent pipeline is
  healthy and the failure is specifically at the
  orchestrator's pre-flight project lookup, not in any
  agent's prompt or behavior.
- **Did not push a fix to the trackeros remote.** Same
  rationale — this session is read-only by user
  instruction. The pending operator alert (open, `severity:
  high`, `required_action: provide-feedback`) is left
  in-place for the operator to acknowledge or for a
  follow-up session to clear with `gestalt alerts
  dismiss`.
- **Wrote the report as a single self-contained file at
  `docs/claude/TEST_REPORT_001.md`** rather than inside
  the session log, because the user will paste it into a
  design chat and wants the deliverable to be independent
  of Claude Code's session-log rotation. The session log
  entry (this entry) is the meta-context for *how* the
  report was produced.

Pending follow-ups (for the design-chat + next session):

- **Fix A (run.ts:34 resolveProjectId call)** is the
  one-line blocking fix. Lands in `@gestalt/cli`. No
  migration, no server change required for the CLI side.
- **Fix B (server-side validation at `POST /intents`)** is
  defense-in-depth and recommended to land in the same PR
  as Fix A.
- **Re-run the same scaffolding intent after Fix A + B
  ship** to produce a real `TEST_REPORT_002.md` covering
  what intent-agent / design-agent / context-agent /
  code-agent actually produce. Correlation
  `06299649-2db4-4d64-8785-167e025cbacb` is the permanent
  reference point for the pre-fix baseline; the
  follow-up report will diff against the agent prompts
  + outputs that didn't exist this round.
- **Open alert** (id not captured; query
  `SELECT id FROM alerts WHERE correlation_id =
  '06299649-…';`) remains open. Either dismiss via
  `gestalt alerts dismiss` once Fix A ships, or let it
  age out organically.
- **Operator caveats from prior sessions still pending**
  (Node 22 upgrade on trackeros gestalt.yml, PR #46
  close, vault secret re-creation) are unaffected by this
  session.

Build status: no source changes made. `pnpm -r build` was
not re-run (no need; nothing compiled differently). Server
container `gestalt-server-1` still running the binary from
the prior session's JSON-escape fix; no restart performed.

---

### Session 2026-06-04 — Claude Code (HARNESS.json multi-line description bug: JSON-escape values substituted into .json template files; repair trackeros)

Bug fix. Every intent submission against the live trackeros project
was failing in 1-4ms — before the intent-agent could make any LLM
call — with `SyntaxError: Bad control character in string literal in
JSON at position 187 (line 6 column 78)` from
`HarnessEngine.loadHarnessConfig`. Same error also surfaced from the
maintenance scheduler's `loadHarnessSubset` (it catches + warns, so
maintenance didn't hard-fail, but the warning was the same root
cause).

Root cause:

The previous session (multi-line description prompt) lifted
`gestalt init` to accept >1 line of project description. That body
is passed verbatim to the harness template engine which substitutes
`{{projectDescription}}` into every template file — including
`harness/HARNESS.json` line 6: `"description": "{{projectDescription}}"`.
The substitution at `packages/server/src/templates/engine.ts:215`
(`substitute()`) was a naive string-replace: it dropped the value's
raw bytes — newlines and all — into the JSON string literal. JSON
forbids unescaped control characters inside string literals, so the
resulting HARNESS.json was unparseable. trackeros was the first
project bootstrapped after the multi-line prompt change landed, so
it was the first to hit this.

Verification: cloned the live trackeros HEAD and confirmed byte 187
was a raw `\n` (code 10) inside the description string, sitting
between "company." and "Employees can apply".

Changed:

- **`packages/server/src/templates/engine.ts`** — `substitute()`
  gains a third `options: { jsonEscape?: boolean }` parameter. When
  `jsonEscape` is true, the substituted value is fed through
  `JSON.stringify(value).slice(1, -1)` — produces a string body
  with `\n`, `\"`, `\\`, control-char `\uXXXX` escapes, suitable
  for dropping into an existing `"..."` literal in the template.
  Unknown keys still leave the `{{key}}` placeholder verbatim.
- **Same file** — both call sites (`applyVariablesFromFileMap` for
  the DB-stored template path, `collectFiles` for the filesystem
  fallback) now pass `{ jsonEscape: isJsonPath(templateRelativePath) }`
  with a tiny local `isJsonPath()` helper that lowercases the path
  and tests `.endsWith('.json')`. Markdown (`AGENTS.md` line 8 has
  `{{projectDescription}}` too) and yaml stay verbatim so
  human-readable bodies keep their real line breaks.
- **trackeros `HARNESS.json`** — rewrote the description value
  in-place with `\n`-escaped newlines via the same
  `JSON.stringify().slice(1,-1)` trick, then verified
  `JSON.parse(fixed)` succeeded before committing. Committed +
  pushed to `main` (`0cb7528`). User explicitly authorized the
  direct push to main; auto-mode classifier had blocked the first
  attempt because main-branch pushes bypass PR review.

Verified:

- Round-trip unit-style test (Node driver against the compiled
  `dist/templates/engine.js`): seeded the trackeros multi-line
  description into the corporate-ops-web-mobile HARNESS.json
  template, ran `substitute(raw, vars, { jsonEscape: true })`,
  parsed the result with `JSON.parse()` — parses clean.
  `parsed.description` contains real `\n` characters (the escape
  sequences were resolved by the parser as expected); raw
  description body had 7 lines, the result kept all 7 separated by
  newlines.
- Same driver against AGENTS.md (markdown) with
  `jsonEscape: false` — newlines pass through verbatim (10-line
  output for a 10-line template, no escaping applied).
- `pnpm --filter @gestalt/server build` then `pnpm -r build` —
  clean across all 12 packages. Dashboard re-emitted as
  `index-DSlpzI_R.js` (no UI change; 1010 KB / 319 KB gzipped
  identical to the prior session). Server `dist` hot-copied into
  `gestalt-server-1:/app/packages/server/dist/` + container
  restart.
- Server back to `/health` 200 inside ~10 seconds.
- `gestalt run "Smoke test: confirm intent-agent reaches the LLM
  after HARNESS.json fix"` against the repaired trackeros:
  intent-agent now completes in 2667 ms (real LLM call duration),
  not the prior 1-4 ms instant failure. design-agent (3029 ms),
  lint-config-agent (19 ms), and context-agent (4544 ms) all
  succeed. code-agent fails with `Rate limit exceeded` from the
  LLM provider — unrelated to this bug; downstream-only and
  recoverable by waiting out the OpenAI rate limit.
- `docker logs --since 3m gestalt-server-1 | grep "Bad control
  character\|SyntaxError\|loadHarnessConfig"` returns zero hits
  since the restart — the parse error is gone.

Decisions made:

- **Escape at the substitution boundary, not at intake.** The
  multi-line description is correct data; it's only invalid when
  rendered into a JSON string literal. Sanitising at the CLI /
  dashboard intake path (stripping or replacing newlines) would
  corrupt the value for the markdown path (AGENTS.md) and the
  LLM stack-config-generator path (which already accepts
  arbitrary-length strings). Escaping per-file-type at the
  template engine is the right layer.
- **File extension is the discriminator, not a flag in
  `TemplateVariables`.** A template author can add a new `.json`
  file (e.g. `package.json`, `tsconfig.json`) and the engine
  will Do The Right Thing without per-variable wiring. The
  alternative (marking individual variables as "is JSON-safe")
  doesn't scale; the file knows what it is.
- **`JSON.stringify(value).slice(1, -1)` rather than a hand-rolled
  escape table.** Built-in `stringify` handles the full JSON
  string-literal escape spec (`\b\f\n\r\t\"\\` + `\uXXXX` for
  control chars + surrogate pair handling). Slicing the surrounding
  quotes drops the body into the template's existing `"..."`.
  Pseudocode for placeholder-not-in-string-context (e.g.
  `"port": {{port}}`) doesn't apply here because every existing
  HARNESS.json placeholder is inside a string literal; if a future
  template needs a non-string injection it can use a typed
  helper rather than the generic substitute.
- **Direct push to trackeros/main, not a PR.** User explicitly
  authorized after the auto-mode classifier blocked the first
  attempt. The fix is a single-file `1 insertion, 7 deletions`
  diff (the 7-line multi-line description collapses to a single
  `\n`-escaped line) and unblocks the platform immediately.
- **Hot-copy of server dist into the running container, not a
  docker compose build.** Matches the pattern from the previous
  template-editor session — restart picks up the new `dist/`
  immediately; the next clean image rebuild folds the change in.

Pending follow-ups:

- **Code-agent rate limit** surfaced during the verification run
  is environmental, not a code defect. Operator can wait out the
  OpenAI rate limit and resubmit any intent.

Build status: `pnpm -r build` clean across all 12 packages.
Engine fix landed in `packages/server/dist/templates/engine.js`
and hot-copied into `gestalt-server-1`. The repaired
trackeros HARNESS.json is pushed at commit `0cb7528` on
`main`.

---

### Session 2026-06-04 — Claude Code (multi-line description prompt: gestalt init now accepts >1 line of project description; dashboard create-project description is a textarea)

Bug fix + small refactor. The Phase-1 description prompt in
`gestalt init` used the existing single-line `prompt()` helper,
which calls `readline.question()` and resolves on the first
newline — so a multi-line paste was truncated to its first line.
The same shape applied to the dashboard "Create project" modal
(single-line `<input type="text">`). This session lifts both
surfaces to true multi-line capture, extracts the helpers into
the shared prompts module, and tightens the custom-agent prompt
flow to reuse the same editor helper.

Changed:

- **`packages/cli/src/ui/prompts.ts`** — three new exported
  helpers next to the existing `prompt` / `promptSecret`:
  - `promptMultiline(fieldName, hint?)` — END-terminated capture
    (case-insensitive `END` / `end` / `End`, leading + trailing
    whitespace trimmed for the sentinel check, lines themselves
    preserved verbatim). EOF on stdin also terminates so piped
    callers without an explicit `END` still get the buffered
    content.
  - `promptWithEditor(fieldName, initial?)` — spawns
    `$EDITOR` / `$VISUAL` / `vi` against a temp file. When
    `initial` is supplied it pre-populates the buffer (used by
    the custom-agent prompt to seed the `{{role}} {{goal}} …`
    placeholder hint). Comment lines starting with `#` are
    stripped after save. On editor launch failure (`spawnSync`
    error or non-zero exit) it falls back to `promptMultiline`
    so operators on minimal images stay unblocked.
  - `promptMultilineDescription(fieldName, hint?)` — three-mode
    chooser shown to the operator: (1) single line — backwards-
    compatible default, (2) multi-line END-terminated, (3)
    open in `$EDITOR`. Empty choice → option 1.
- **`makeBufferedReader(rl)` private helper** — attaches one
  long-lived `line` listener that pushes into a queue and feeds
  `next()` waiters. Necessary because `readline` emits `line`
  events as soon as bytes arrive, regardless of whether anyone
  is awaiting. Previous draft attached a fresh listener per
  prompt and lost every line that arrived between prompts under
  piped stdin (the bug surfaced during smoke tests; documented
  inline so the next refactor doesn't regress it).
- **`packages/cli/src/commands/init.ts`** — Phase 1 swaps
  `await prompt('Description')` for
  `await promptMultilineDescription('Project description', '…')`.
  All other Phase 1 hint copy preserved.
- **`packages/cli/src/commands/project-config.ts`** — the
  `openEditorForPrompt()` local helper now delegates to the
  shared `promptWithEditor`, passing the existing
  `{{role}}/{{goal}}/{{artifacts}}` placeholder seed as the
  `initial` body. Removed the standalone `spawn` / `writeFile` /
  `readFile` / `unlink` / `mkdtemp` imports from this file —
  they all live in `prompts.ts` now. The "empty prompt aborts"
  guard remains in `openEditorForPrompt` because custom-agent
  prompts must not be blank.
- **`packages/dashboard/src/views/Admin.tsx`** —
  `CreateProjectModal` description field is now a `<textarea
  rows={4}>` with `resize: vertical` + `minHeight: 96px` +
  `fontFamily: inherit`. Placeholder rewritten as a three-line
  example matching the brief. State binding unchanged
  (`description` / `setDescription`) — the existing trim +
  fallback at submit time (line 703-705) already handles the
  multi-line body correctly. Server's `init-harness` route at
  `packages/server/src/routes/projects.ts:613-689` does only
  `.trim()` on `projectDescription` before passing it to
  `generateStackConfig` and `loadTemplate` — no server change
  needed; the LLM stack config generator already accepts
  arbitrary-length descriptions.

Verified:

- `pnpm -r build` clean across all 12 packages. Dashboard
  bundle re-emitted as `index-DSlpzI_R.js` (1010.76 KB raw /
  319.35 KB gzipped; identical structure to the prior
  CodeMirror-era bundle — the textarea swap added a handful
  of bytes inside the existing chunk).
- Spot-grep on the dashboard bundle confirms the new textarea
  + placeholder ship: `textarea` appears 8 times (was
  pre-existing in `TemplateEditor`-adjacent code; the new one
  raised the count from 7 to 8) and the new placeholder
  copy `Describe your project: purpose, tech stack` is
  present in the bundle exactly once.
- Helper-level smoke tests (5 cases for the individual
  helpers + 3 cases for the 3-mode chooser, run via a Node
  driver script that imports the compiled `dist/ui/prompts.js`
  and pipes synthetic stdin):
  - `promptMultiline` captures all 4 lines verbatim through
    END.
  - END sentinel terminates on any of `END` / `end` / `End` /
    `"  end  "`.
  - `promptWithEditor` with `EDITOR=true` (no-op editor)
    strips the `# Enter ${fieldName}…` comment seed to an
    empty body.
  - `promptWithEditor` round-trips a non-comment `initial`
    body when `EDITOR=true`.
  - `promptWithEditor` with `EDITOR=/nonexistent` falls
    through to `promptMultiline` and captures the END-
    terminated body the operator typed instead.
  - `promptMultilineDescription` option 1 (empty choice →
    default) returns the single line typed at the field
    prompt.
  - `promptMultilineDescription` option 2 captures all 4
    lines and trims trailing whitespace.
  - `promptMultilineDescription` option 3 routes through
    `promptWithEditor` (verified via `EDITOR=true` → empty
    body).
- Server path traced manually: CLI calls
  `client.initHarness(projectId, description)` →
  `POST /projects/:id/init-harness` with
  `{ projectDescription }` → `generateStackConfig(description.trim(),
  project.name)` and `loadTemplate(…, { projectDescription:
  description.trim(), … })`. Description is a plain string
  parameter end-to-end; no truncation anywhere in the path.
- Dashboard bundle hot-copied into `gestalt-server-1` at
  `/app/packages/dashboard/dist/` so the running platform
  serves the textarea-having build without an image rebuild.
  `curl http://localhost:3000/app/` shows the new
  `index-DSlpzI_R.js` reference; container HEAD-of-bundle
  matches the on-disk hash.

Decisions made:

- **Three-mode chooser, not "single vs multi" toggle.** The
  brief offered three modes (single line / END-terminated /
  editor); the chooser preserves the existing keystroke-
  efficient default (Enter → single line) while still
  giving the operator an editor escape hatch when they want
  full control. Empty choice deliberately defaults to (1)
  so muscle memory doesn't break.
- **Buffered reader rather than fresh interface per prompt.**
  Initial implementation created a `readline.createInterface`
  per call inside `promptMultiline`. Under piped stdin
  (smoke tests), readline emits `line` events synchronously
  as bytes arrive — between calls the next line was already
  emitted and dropped. The fix is a single long-lived
  interface plus a buffered pull-based `next()`. Documented
  inline so future refactors don't regress it.
- **Custom-agent prompt routes through the shared helper.**
  The existing `openEditorForPrompt` did the same job
  but reimplemented the editor lifecycle. Collapsed to a
  one-line wrapper that passes the existing placeholder
  seed as `initial`. Kept the "empty prompt aborts" guard
  there because custom-agent prompts cannot be blank
  (the rest of the workflow assumes a non-empty body).
- **Dashboard uses a plain `<textarea>`, not a CodeMirror
  instance.** The description field is free-form prose, not
  code — a textarea with `resize: vertical` is the right
  affordance and keeps the bundle exactly as it is. Reusing
  the existing `styles.input` base + a small style merge
  keeps the visual integration consistent with the rest of
  the modal.
- **No new server endpoint / no migration.** The
  `projectDescription` body field already accepts arbitrary-
  length strings — the only server-side operation on it is
  `.trim()` before passing through to the LLM stack config
  generator. The bug was purely client-side.

Pending follow-ups: none introduced.

Build status: `pnpm -r build` clean across all 12 packages
(CLI: `tsc && chmod +x dist/index.js` clean; dashboard:
1010.76 KB / 319.35 KB gzipped, identical structure to the
template-improvements session). Dashboard hot-copied into
the running container; next image rebuild folds it in.

