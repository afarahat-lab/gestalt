# CLAUDE.md — Gestalt platform

This file orients Claude Code when working on this repository.
Read it completely before taking any action.

---

## What this project is

Gestalt is a self-hosted agent-first platform that automates the full Software
Development Lifecycle. It is a TypeScript monorepo using pnpm workspaces.

The platform is built on the same principles it enforces in client projects:
context files guide agents, the harness is a first-class artifact, and every
package has a README.md that is the agent's local orientation document.

---

## Before doing anything

1. Read this file completely — especially **Current state** and **Session log**
2. Read `AGENTS.md` (platform-wide coding conventions)
3. Read the relevant package `README.md` for the package you are working in
4. Read `docs/ARCHITECTURE.md` for system-wide context
5. If anything needed is missing from context, state it before proceeding

## After every session — mandatory

Before ending any session, append an entry to the **Session log** section
at the bottom of this file. Include:
- Every file changed and why
- Any decision that deviated from or extended the original design
- Current build status (which packages compile, which don't)
- What remains to be done

This keeps the design chat aligned with what was actually built.

---

## Critical constraints

- **pnpm 9.x only** — pnpm 10+ requires Node 22; this project uses Node 20
  ```bash
  npm install -g pnpm@9.15.4
  ```
- **TypeScript strict mode** — all packages use `strict: true`
- **No `any`** — use `unknown` with type guards instead
- **Named exports only** — no default exports except React components
- **No `console.log`** — use `createContextLogger` from `@gestalt/core`
- **No `process.env` directly** — use `loadConfig()` from `@gestalt/core/config`

---

## Monorepo structure

```
packages/
  core/               — shared types, LLM, queue, repository, harness engine
  server/             — Fastify server, auth, oversight API
  cli/                — gestalt CLI tool
  dashboard/          — React oversight dashboard
  adapters/
    postgres/         — PostgreSQL adapter (reference implementation)
    oracle/           — Oracle adapter (stub)
    mssql/            — SQL Server adapter (stub)
  agents/
    generate/         — intent, design, context, code, test agents + orchestrator
    quality-gate/     — lint, security, constraint, test-runner, review agents
    deploy/           — PR, pipeline, promotion agents
    maintenance/      — drift, alignment, GC, evaluation agents
templates/
  corporate-ops-web-mobile/   — Tier 1 harness template
docs/
  guides/             — quick-start, running (dev setup), deployment, identity
  reference/          — harness-config.md
  runbooks/           — common-issues.md
  ARCHITECTURE.md     — full system design
  DECISIONS.md        — all ADRs
```

---

## Package dependency order

Build in this order:

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

---

## Key type alignment rules

The `@gestalt/agents-generate` package has its own local `ContextSnapshot` and
`FeedbackSignal` types in `packages/agents/generate/src/types.ts`. These must
stay aligned with `@gestalt/core` types:

- `FeedbackSignal` must include `autoResolvable: boolean` and `createdAt: Date`
- `ContextSnapshot` must include `projectRoot`, `architectureMd`, `domainMd`
- `AgentRole` values must match the union in `@gestalt/core/src/types.ts`

---

## How to run builds

```bash
# Type check a package
pnpm --filter @gestalt/core typecheck

# Build a package
pnpm --filter @gestalt/core build

# Build all in order
pnpm build

# Run tests
pnpm test

# Docker (requires Docker Desktop running)
docker-compose up -d
docker-compose logs -f server
```

---

## Current build status

`pnpm -r build` compiles cleanly across all 12 buildable workspace packages.
The most recent verifying build is from the 2026-05-29 ADR-032 session — see
the **Current state** section below for the authoritative snapshot and the
**Session log** for what changed since.

| Package | Status |
|---|---|
| `@gestalt/core` | ✅ compiles |
| `@gestalt/adapter-postgres` | ✅ compiles |
| `@gestalt/adapter-oracle` | ✅ compiles (stub) |
| `@gestalt/adapter-mssql` | ✅ compiles (stub) |
| `@gestalt/agents-generate` | ✅ compiles |
| `@gestalt/agents-quality-gate` | ✅ compiles |
| `@gestalt/agents-deploy` | ✅ compiles |
| `@gestalt/agents-maintenance` | ✅ compiles |
| `@gestalt/registry` | ✅ compiles |
| `@gestalt/server` | ✅ compiles |
| `@gestalt/cli` | ✅ compiles |
| `@gestalt/dashboard` | ✅ builds (Vite) |

`docker-compose up -d` brings server + postgres + redis up `Up (healthy)`;
`/health` returns 200; protected routes return 401 without a JWT.
All three migrations apply on first start: `001_initial`, `002_local_auth`,
`003_projects`.

## Known issues to resolve

None blocking the build today. Areas to keep in mind when working in this repo:

1. **`UserRepository` extensions touch every adapter.** Adding a method to
   the interface (as the `count()` addition for first-boot admin setup did)
   means the Oracle and SQL Server stubs must learn the same method when
   they leave stub state. Same applies to `ProjectRepository` — oracle and
   mssql stubs already have throw-stubs added (2026-05-29 ADR-032 session).
2. **Type alignment between `@gestalt/agents-generate` and `@gestalt/core`.**
   The local `ContextSnapshot` and `FeedbackSignal` types in
   `packages/agents/generate/src/types.ts` must keep matching the core types
   — see the **Key type alignment rules** section above.
3. **CLI pins chalk@4 / ora@5 for CJS compatibility.** Do not upgrade either
   without performing the full ESM migration (`"type": "module"`, `.js`
   extensions on relative imports, Dockerfile update). The pin is
   intentional, not a bug.
4. **`toTaskPriority()` mapper in `packages/server/src/routes/intents.ts`.**
   Bridges `IntentRecord.priority` (`'low'`) and core `TaskPriority`
   (`'background'`). If priority levels are extended, both types must move
   together.
5. **Git token stored plain text.** `project_git_credentials.token` has a
   `TODO: encrypt at rest before production use` comment in
   `packages/adapters/postgres/src/repositories/projects.ts`. Do not remove
   the comment; address it before any shared/production deployment.
6. **LLM model name not validated at startup.** `loadConfig` accepts any
   non-empty string for `LLM_MODEL`. An invalid model name will only surface
   as a 404 when the first LLM call is made. Set a valid model in `.env`
   before running `gestalt run`.

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

## What to do if context is missing

If you need information about a layer, component, or decision that isn't in
this file or in `AGENTS.md`, check:

1. The relevant `docs/` file
2. The package `README.md`
3. The source file itself — it has JSDoc comments
4. Ask in your response before making assumptions

---

## Session log

This section is maintained by both this chat and Claude Code.
Every session that modifies the codebase appends an entry here.
When returning to the design chat, paste this section so the context is current.

**Format for Claude Code — at the end of every session, append:**
```
### Session [date] — [Claude Code]
Changed:
- <file>: <what changed and why>
Decisions made:
- <any architectural decision that deviated from or extended the original design>
Build status:
- <which packages compile, which don't, what errors remain>
```

---

### Session 2026-05-28 — Claude Code (CLI install fix)
Changed:
- `packages/cli/package.json`: flipped `"private": false` → `"private": true`
- `README.md`, `docs/guides/quick-start.md`, `docs/guides/deployment.md`:
  replaced `npm install -g @gestalt/cli` with build + npm link workflow
- `docs/runbooks/common-issues.md`: added CLI issues section

Build status: No source changes — TypeScript build unaffected.

---

### Session 2026-05-28 — Claude Code (first-boot admin setup)
Changed:
- `packages/adapters/postgres/src/migrations/002_local_auth.sql` (new)
- `packages/core/src/repository/index.ts`: added `LocalAuthRepository`,
  `LocalAuthRecord`, `count()` on `UserRepository`, `localAuth` to registry
- `packages/adapters/postgres/src/repositories/local-auth.ts` (new)
- `packages/server/src/routes/admin.ts` (new): `POST /auth/admin/setup`
- `packages/server/src/auth/providers/local.ts`: implemented bcrypt auth
- `packages/server/src/auth/auth-manager.ts`: preserves role on local login
- `packages/server/src/auth/routes.ts`: implemented `POST /auth/login`
- `packages/cli/src/commands/init-admin.ts` (new): `gestalt init-admin`

Decisions made:
- Separate `local_auth` table (not nullable column on users)
- bcrypt 12 rounds
- Manual audit write in admin route (audit hook skips unauthenticated requests)
- Preserve role on local login in AuthManager, not role-mapper

Build status: All 12 packages compile clean.

---

### Session 2026-05-29 — Claude Code (bootstrap smoke test + fixes)
Changed:
- `packages/adapters/postgres/package.json`: build script copies SQL to dist
- `packages/adapters/postgres/src/migrations/001_initial.sql`: fixed REVOKE
  role reference + removed duplicate schema_migrations writes
- `docker-compose.yml`: `NODE_ENV` made overridable via `.env`

Decisions made:
- Fix migration packaging in build script, not Dockerfile
- Use `current_user` in REVOKE (not hardcoded role name)
- Strip manual schema_migrations writes from migration files — runner owns that

Build status: All 12 packages compile clean. docker-compose up healthy.
Both migrations apply. End-to-end admin smoke test passes.

---

### Session 2026-05-29 — Claude Code (BullMQ queue-name fix)
Changed:
- `packages/core/src/queue/index.ts`: `gestalt:{layer}` → `gestalt-{layer}`
  (BullMQ 5.x rejects colons in queue names)
- `docs/runbooks/common-issues.md`: fixed redis-cli diagnostic command

Build status: `POST /intents` returns 201. Queue keys created in Redis.

---

### Session 2026-05-29 — Claude Code (postgres repo stubs implemented)
Changed:
- `packages/adapters/postgres/src/repositories/executions.ts` (new)
- `packages/adapters/postgres/src/repositories/artifacts.ts` (new)
- `packages/adapters/postgres/src/repositories/signals.ts` (new)
  — `markResolved` enforces GOLDEN_PRINCIPLE_BREACH human-only resolution
- `packages/adapters/postgres/src/index.ts`: removed inline stubs

Build status: `GET /status`, `GET /intents/:id` all return 200.

---

### Session 2026-05-29 — Claude Code (orchestrator worker wired)
Changed:
- `packages/server/package.json`: added `@gestalt/agents-generate` dep
- `packages/server/src/server.ts`: `startOrchestratorWorker` called at startup

Build status: Orchestrator worker running. Intents drain from queue and
transition to `failed` (ENOENT /app/HARNESS.json — expected, by design
at this stage).

---

### Session 2026-05-29 — Claude Code (ADR-032 project registration + Git)

Implemented the ADR-032 design: the server is the only thing that touches
the project's Git repo. `gestalt init` now registers a project + has the
server push the harness; subsequent intent cycles clone fresh per run.
Resolves the `ENOENT /app/HARNESS.json` blocker.

Changed:
- `packages/adapters/postgres/src/migrations/003_projects.sql` (new):
  `projects` + `project_git_credentials` tables. Pure schema only.
- `packages/core/src/repository/index.ts`: added `ProjectRecord` type and
  `ProjectRepository` interface; added `projects` to `RepositoryRegistry`
- `packages/core/src/index.ts`: re-exports `ProjectRecord`, `ProjectRepository`
- `packages/adapters/postgres/src/repositories/projects.ts` (new):
  full `PostgresProjectRepository`. Token stored plain with TODO comment.
  `getCredential` returns most recent row (allows PAT rotation)
- `packages/adapters/postgres/src/index.ts`: wired `PostgresProjectRepository`
- `packages/adapters/oracle/`, `packages/adapters/mssql/`: added
  `@gestalt/core` dep + TypeScript devDeps + `repositories/projects.ts`
  stub (every method throws `not implemented`). Both adapters now fully
  participate in `pnpm -r build`
- `packages/server/package.json`: added `simple-git@^3.23.0`
- `packages/server/Dockerfile`: `apk add --no-cache git openssh-client`
- `packages/server/src/routes/projects.ts` (new): `POST /projects`,
  `GET /projects`, `GET /projects/:id`, `POST /projects/:id/init-harness`.
  Token never returned in responses. Temp dir cleaned in `finally` block.
- `packages/server/src/app.ts`: registered `registerProjectRoutes`
- `packages/agents/generate/package.json`: added `simple-git`
- `packages/agents/generate/src/orchestrator/orchestrator.ts`: rewrote
  `handleIntentTask` — looks up project, reads credential, clones fresh
  per cycle into temp dir, sets `projectRoot` to clone path, cleans up
  in `finally`
- `packages/cli/src/api/client.ts`: added `createProject`, `listProjects`,
  `getProject`, `initHarness` typed wrappers
- `packages/cli/src/commands/init.ts`: replaced mock with real Git-first
  four-phase wizard
- `packages/cli/src/commands/projects.ts` (new): `gestalt projects list`
  and `gestalt projects use <name>`
- `packages/cli/src/index.ts`: registered `gestalt projects` commands.
  Added `.allowExcessArguments(false)` on `init` — old broken
  `gestalt init local-admin` now fails fast
- `docs/DECISIONS.md`: appended ADR-032
- `docs/guides/quick-start.md`: Steps 7-8 rewritten for Git-first flow

Decisions made:
- Inlined harness file content in routes/projects.ts (Dockerfile does not
  copy templates/; revisit when template story matures)
- `x-access-token` URL-embedded PAT (works across GitHub/GitLab/Azure DevOps)
- Per-cycle clone (stateless, clean failure recovery)
- `getCredential` returns most recent row by `created_at DESC LIMIT 1`

Build status:
- `pnpm -r build` — all 12 buildable packages compile clean
- `docker-compose up -d --build` — server, postgres, redis all `Up (healthy)`
- All three migrations apply on first start
- Orchestrator worker running, clones project repo per intent cycle
- ADR-032 end-to-end verified (failure mode against fake PAT confirms real flow)

Operator caveats:
- Smoke test left data in DB. Run `docker-compose down -v` before real use
- `LLM_MODEL` in local `.env` is still bogus — set a valid model before
  running `gestalt run` against a real project

---

## Current state (keep this section current)

**Last updated:** 2026-05-30 (Claude Code — real GitHub Actions integration verified end-to-end)

**Repo:** https://github.com/afarahat-lab/gestalt

**What is built and working:**
- All 8 architecture layers fully designed and documented
- **All four SDLC layers fully implemented end-to-end:** generate,
  quality-gate, deploy, maintenance. The closed loop runs:
  `human intent → generate → gate → deploy → deployed`, plus
  `maintenance scheduler → queues typed MaintenanceIntent → back into
  generate`. See per-layer detail bullets below; per-agent run lifecycles
  are summarised in the "Session log" entries dated 2026-05-29 / 30
- All 12 buildable workspace packages compile clean (`pnpm -r build`)
- `docker-compose up -d` succeeds — server, postgres, redis all `Up (healthy)`
- All five migrations apply on startup: `001_initial`, `002_local_auth`,
  `003_projects`, `004_deployments`, `005_maintenance`
- Server reachable on http://localhost:3000 — `/health` returns 200
- Auth middleware active — protected routes return 401
- First-boot bootstrap verified end-to-end: `gestalt init-admin` creates
  admin + JWT; `gestalt login` authenticates; `GET /auth/me` returns user
- `gestalt init` fully implemented — Git-backed four-phase wizard:
  registers project on server, server clones repo, commits harness files,
  pushes; developer runs `git pull` to receive harness locally
- `gestalt projects list`, `gestalt projects use <name>`, and
  `gestalt projects set-adapter <name> <noop|github-actions>` working.
  `set-adapter` clones the project repo, mutates `pipeline.adapter` in
  `HARNESS.json`, commits as
  `chore: update pipeline adapter to <adapter> [gestalt]`, and pushes
  to `defaultBranch` — HARNESS.json in the repo remains the source of
  truth (ADR-032). Audit-logged as `project.config-updated`
- `gestalt run` queues intent → orchestrator picks up → clones project
  repo fresh per cycle → runs generate loop against cloned harness files
- **Maintenance layer wired end-to-end (ADR-018, ADR-019, ADR-020,
  ADR-035).** Four scheduled agents run in-process via `node-cron`,
  registered as `startMaintenanceScheduler(config)` at server.ts step 9:
  - **drift-agent** (daily 02:00 UTC) — clones the project, finds
    `src/modules/*/...` files changed in the last 30 days, compares
    against the most recent commit timestamp on the global context
    files; for modules drifted by > 7 days appends a timestamped HTML
    comment to `docs/DOMAIN.md` (ADR-018 additive-only exception, direct
    commit + push) and queues a `CONTEXT_UPDATE` MaintenanceIntent
  - **alignment-agent** (daily 03:00 UTC) — reads context files,
    cross-checks DOMAIN.md entities ↔ ARCHITECTURE.md modules, and
    GP-NNN cross-references in AGENTS.md; queues `CONTEXT_ALIGNMENT`
    intents per misalignment
  - **gc-agent** (weekly Fri 04:00 UTC) — deletes remote `gestalt/*`
    branches older than 30 days, `.gestalt/*` spec files older than 90
    days (committed deletion), and `deployment_events` rows older than
    90 days. Never queues intents
  - **evaluation-agent** (every 15 min) — resolves the project's
    `MonitoringAdapter` from HARNESS.json; queries error rate / p99
    latency / alert count; queues `PERFORMANCE_DEGRADATION` or
    `SECURITY_FINDING` intents on threshold breach. Dedupe guard skips
    any candidate whose `[gestalt-maintenance/<type>]` prefix already
    appears on an open intent (status `pending` / `generating`)
  - All four agents share a runner (`runMaintenanceAgent`) that creates
    a `maintenance_runs` row, dispatches queued intents into the
    `gestalt-generate` queue with `source: 'maintenance-agent'` and the
    operator-supplied `suggestedAction` as intent text, updates the row
    on completion, and emits a `maintenance.run-completed` SSE event
  - Manual operator trigger via `POST /maintenance/trigger { agentRole,
    projectId }` (requireRole operator); same runner code path as the
    cron schedules
  - `GET /maintenance/runs?projectId&agentRole&limit` returns
    `MaintenanceRunRecord[]`
  - Live verification against `trackeros`: all 4 agents triggered;
    alignment-agent produced 5 findings → 5 maintenance intents
    queued (all carrying `[gestalt-maintenance/CONTEXT_ALIGNMENT]`
    prefix; generate orchestrator picked them up immediately); other
    agents returned 0 findings as expected on this small repo
- **Deploy layer v1 wired end-to-end (ADR-033, ADR-034).** A `pass`
  verdict on the quality gate now dispatches `deploy:pr` to the new
  deploy-orchestrator (`startDeployWorker` registered at server.ts
  step 8). The generate orchestrator no longer mutates the project's
  Git tree — pr-agent owns the only commit + push, to a PR branch,
  never to `defaultBranch`. The deploy worker drains
  `bull:gestalt-deploy:*` and chains three agents:
  - **pr-agent** — clones the project, cuts
    `gestalt/<corr8>-<slug>` (intent's first 5 words, kebab-cased,
    capped at 40 chars), writes artifacts, commits + pushes, opens a
    PR via the resolved `PipelineAdapter`. Transitions intent
    `approved → deploying`. Writes a `pr-opened` row to
    `deployment_events`, emits `deployment.updated` with `prUrl` +
    `prNumber`
  - **pipeline-agent** — triggers the adapter's pipeline, polls
    `getPipelineStatus` every 15s (up to 10 min). On `passed` writes
    `pipeline-passed`. On `failed`/`cancelled` emits `TEST_FAILURE`;
    on timeout emits `CONTEXT_GAP`
  - **promotion-agent** — promotes staging then production. **ADR-034
    is enforced here**: production refused unless a
    `promoted-staging` row exists for the same correlationId (emits
    `GOLDEN_PRINCIPLE_BREACH`, deploy-orchestrator transitions to
    `escalated`). On success writes `promoted-staging` /
    `promoted-production` rows
  - Final transition: intent → `deployed` after production promote.
    All temp clones cleaned in `finally`
  - PipelineAdapter (ADR-033) abstraction: `createPullRequest`,
    `triggerPipeline`, `getPipelineStatus`, `promoteToEnvironment`.
    `GitHubActionsAdapter` (REST API + PAT from `project_git_credentials`)
    and `NoOpPipelineAdapter` (immediate plausible fakes with a 500ms
    pipeline-status delay so dashboards see the `running → passed`
    transition) included. Resolved per-task from `HARNESS.json`
    `pipeline.adapter`; absent or unrecognised → NoOp
  - First live cycle (`8f53b75d`, string-case utility module): 30s
    total — generate 17s → gate 2s → deploy 6s (PR open 2.5s,
    pipeline 1.9s, staging promote 1.0s, production promote 0.9s);
    intent → `deployed`. Branch `origin/gestalt/8f53b75d-add-a-string-case-utility-module`
    pushed to GitHub; deployment_events has all 5 expected rows
  - **First REAL GitHub Actions cycle (`67e5ee02`, kebab-case utility,
    2026-05-30 session).** Adapter switched from `noop` to
    `github-actions` via the new `gestalt projects set-adapter` CLI.
    49 s wall-clock total — generate 12 s → gate 1 s → deploy 30 s
    (pr-agent 4.6 s, pipeline-agent 21.0 s including the real GitHub
    Actions run, staging promote 1.8 s, production promote 1.8 s).
    PR #1 opened on `afarahat-lab/trackeros`, GitHub Actions run
    `26689527360` completed with `conclusion: success`,
    `event: workflow_dispatch`. All 5 `deployment_events` rows carry
    the real numeric `run_id` and a real `pr_url`; the dashboard /
    `gestalt status --id` are no longer faking. PAT-scope GP_BREACH
    path was NOT exercised (the PAT used had `workflow` scope);
    detection logic is unit-shaped and tested at the adapter level
    only. ADR-034 production-without-staging path also stays
    NoOp-validated since the cycle ran clean
- **Gate ↔ generate feedback loop wired.** A `fail` verdict (auto-resolvable
  signals, no GP_BREACH) dispatches a `generate:intent` task back to the
  generate queue with `retryCount + 1` and the signals routed to the
  responsible specialist agent (LINT_FAILURE / TEST_FAILURE / CONSTRAINT_VIOLATION
  → code-agent; CONTEXT_GAP → context-agent). The intent transitions
  `in-review → generating` for the retry. `code-prompt` includes a
  "Quality-gate feedback from the previous attempt" section listing every
  prior signal with file:line + rule. After `MAX_GATE_RETRIES = 3` cycles
  the gate gives up and marks the intent `failed`. The retry leg's commit
  uses `fix:` prefix and a `retry N/3` suffix so `git log` narrates the
  cycle history. Verified live (`2a57b087`): 4 cycles fired, all
  committed to Git, intent ended at `failed` after retry budget
  exhausted
- **Quality gate v1 wired end-to-end.** After the generate orchestrator
  pushes artifacts, the gate worker (registered as `startGateWorker(config.queue)`
  in `server.ts` step 7) clones the project repo fresh and runs:
  - `constraint-agent` — deterministic regex checks (no-any, no-console,
    no-direct-db-outside-shared-db, no-hardcoded-secret, no-direct-llm-sdk).
    Hardcoded-secret and direct-LLM-SDK emit GOLDEN_PRINCIPLE_BREACH.
  - `llm-review-agent` — single LLM call summarising the artifact set;
    critical / golden-principle items become GOLDEN_PRINCIPLE_BREACH
    signals, high/medium become CONSTRAINT_VIOLATION, low/info land in
    the prose review artifact only. Full review saved as
    `.gestalt/llm-review-<corr8>.md` in the `artifacts` table
  - `synthesiseGateResult` produces a verdict: any GOLDEN_PRINCIPLE_BREACH
    → `escalate`; any CONSTRAINT_VIOLATION / TEST_FAILURE / LINT_FAILURE
    → `fail`; otherwise `pass`
  - Intent transitions: `in-review` → `approved` / `failed` / `escalated`
  - Gate emits `agent.started` / `agent.completed` / `signal.emitted`
    per agent + a top-level `gate.completed` event with verdict + summary
  - First live cycle (`b1f6eecd…`): constraint-agent caught a direct-DB
    import outside `shared/db/`; review-agent caught a missing GP-003
    input validation (escalating) + a potential data-exposure concern in
    the audit-log. Intent landed at `escalated` as designed
- **First full intent → code → push cycle verified end-to-end.** A real
  intent ("Add a hello world endpoint at GET /hello") ran six agents
  (intent / design completed, context + lint-config skipped, code +
  test completed) in ~11 seconds against `gpt-4o`, produced 7 artifacts,
  and the orchestrator committed + pushed `8938d51` to the project's
  GitHub repo (commit subject `feat: Add a hello world endpoint at GET
  /hello returning JSON {message:"hello" [gestalt 75000cb2]`). Files
  landed at the expected paths (`src/modules/hello/...`,
  `src/api/index.ts`, `src/shared/auth/rbac-middleware.ts`,
  `__tests__/hello-routes.test.ts`, `.gestalt/{intent,design}-spec.json`).
  `git pull` on the developer's local clone yields them
- Generate-layer cycles are fully observable and write to Git:
  - one `agent_executions` row per step (`running` → `completed` /
    `failed` / `skipped`) with `tokensUsed` + `durationMs`
  - every `result.signals` saved to `signals`; every `result.artifacts`
    saved to `artifacts`
  - SSE events emitted on the in-process bus at every transition —
    `intent.status-changed`, `agent.started`, `agent.completed`,
    `signal.emitted` — verified by tapping `GET /events?token=…` during a
    real submission
  - on a successful cycle the orchestrator writes artifacts into the
    cloned tree, commits `feat: <intent> [gestalt <corr8>]`, and pushes
    to `defaultBranch`; developers `git pull` to receive
  - the event bus lives in `@gestalt/core/events` so both the server SSE
    route and the orchestrator publish on the same singleton without an
    agents → server dep cycle
- `gestalt init local-admin` (old broken syntax) now fails fast with a
  clear error (`allowExcessArguments(false)` on init command)
- `GET /status`, `GET /status/agents`, `GET /intents`, `GET /intents/:id`
  all return 200

**Implemented with caveats (worth knowing):**
- `@gestalt/agents-quality-gate` — constraint-agent + llm-review-agent +
  gate orchestrator implemented and exercised live. lint-agent /
  security-agent / test-runner-agent remain stubs (need a
  pnpm-install-in-clone pipeline to run real tooling); the package
  works end-to-end without them via the two implemented agents
- `@gestalt/agents-deploy` — pr-agent + pipeline-agent + promotion-agent
  + deploy orchestrator implemented. Two `PipelineAdapter` impls live
  (`GitHubActions`, `NoOp`); Azure DevOps / GitLab CI / Jenkins
  adapters intentionally not implemented (one concrete adapter was the
  ADR-033 scope)
- `@gestalt/agents-maintenance` — all four agents (drift, alignment,
  gc, evaluation) + node-cron scheduler + three `MonitoringAdapter`
  impls (`Prometheus`, `Datadog`, `NoOp`) implemented and exercised
  live via `POST /maintenance/trigger`. Prometheus / Datadog
  implementations not yet verified against a real monitoring instance

**What is not yet built:**
- `@gestalt/adapter-oracle` — stub (every repository method throws;
  exists only to surface interface drift at build time)
- `@gestalt/adapter-mssql` — same shape as oracle
- `@gestalt/registry` — types and client only (no server, no UI)

**Postgres adapter repository coverage (all real, no remaining stubs):**
- `intents`     — full CRUD + list with paging
- `executions`  — create, updateStatus, findByCorrelationId, findActive
- `artifacts`   — save, findByCorrelationId (typed filter), findById
- `signals`     — save, findByCorrelationId, findUnresolved, markResolved
  (with GOLDEN_PRINCIPLE_BREACH human-only guard)
- `audit`       — append-only, query with filters
- `users`       — upsert, findById, findByIdpSubject, list, count
- `localAuth`   — create, findByEmail
- `projects`    — create, findById, findByName, list, saveCredential,
  getCredential (token stored plain — TODO: encrypt at rest)
- `deploymentEvents` — append, findByCorrelationId, findStagingPromotion,
  gcOlderThan. UPDATE is still revoked; DELETE was REVOKED in migration
  004 then GRANTed back in migration 005 once it was clarified that
  deployment_events are operational logs (not audit records) and
  gc-agent needs to prune them. ADR-034 enforcement runs through
  `findStagingPromotion`
- `maintenanceRuns` — create (status=running), complete (final counts +
  findings JSONB + duration), list (filter by projectId / agentRole).
  Findings are JSONB-array-typed; the PG impl uses an explicit
  `::jsonb` cast on insert/update (without it postgres' implicit
  text→jsonb cast wraps the whole array as a JSON string scalar) and
  `parseFindings` normalises the read path against postgres.js
  returning either a parsed array or a raw JSON string

**CLI install:**
- `@gestalt/cli` is private — not on npm
- Install: `pnpm --filter @gestalt/cli build && cd packages/cli && npm link`

**First-boot sequence:**
1. `docker-compose up -d` — start platform
2. `gestalt init-admin` — create admin user (TTY only, once per server)
3. `gestalt login` — authenticate CLI
4. `mkdir my-project && cd my-project`
5. `git init && git remote add origin <url>`
6. `gestalt init` — register project + server pushes harness to Git
7. `git pull` — receive harness files locally
8. `gestalt run "<intent>"` — submit work to agents

**Pending enhancements (design in chat first):**
- **Encrypt Git PATs at rest.** `project_git_credentials.token` is plain
  text. Documented TODO in `repositories/projects.ts`. Pick a key-management
  approach before any shared/production use
- **LLM model name validation.** `loadConfig` accepts any non-empty string
  for `LLM_MODEL`. Worth adding a startup-time ping or clear error path
- Non-interactive mode for `gestalt init-admin` (--email/--password flags)
  for scripted use — current implementation is TTY-only
- **Retry cycle full re-runs all generate agents** even though only the
  routed agents need fresh work (code-agent typically). Cheaper retries
  would skip intent/design/context when their prior artifacts are
  present in the Git tip. For now: ~50-60s per retry cycle. Tracked as
  an optimisation, not a correctness gap
- **Read `qualityGate.maxRetries` from the project's HARNESS.json** —
  currently hardcoded to 3 in both the gate and generate orchestrators
- **Other PipelineAdapter implementations** (Azure DevOps, GitLab CI,
  Jenkins). The interface is in place; only `GitHubActions` + `NoOp`
  are implemented today. `GitHubActions` is verified end-to-end (see
  `67e5ee02` cycle in the session log); the others are typed stubs in
  the `PipelineAdapterType` union but have no implementation
- **`set-adapter` only switches `pipeline.adapter` today.** The
  `POST /projects/:id/config` body shape is generic
  (`{ pipeline?: ... }`) — adding monitoring (`maintenance.monitoring.adapter`)
  and `qualityGate.maxRetries` follows the same whitelist + clone-edit-
  commit pattern but is not implemented yet
- **Promotion workflow dispatches against a hardcoded `'main'` ref.**
  `GitHubActionsAdapter.promoteToEnvironment` always sends
  `{"ref":"main",...}` instead of the project's `defaultBranch`.
  Projects on `master`/`trunk`/etc. will see the promotion workflow
  fail to dispatch. Thread `project.defaultBranch` through the
  promotion-agent → adapter call to fix
- **No proactive PAT-scope validation at registration / set-adapter
  time.** A PAT missing `workflow` scope only surfaces on the first
  pipeline dispatch (`GOLDEN_PRINCIPLE_BREACH` signal + intent
  `escalated`). A startup-time `GET /user` + `GET /repos/:o/:r` ping
  in `init-harness` / `set-adapter` would catch the misconfiguration
  before any intent cycle
- **Promotion strategy beyond auto.** Today both staging → production
  fires unconditionally on a passed pipeline. The `EnvironmentStrategy`
  type already supports `trigger: 'manual'` + `approvals: N`; wire that
  through promotion-agent once a human-approval UI exists
- **Real-tooling gate agents** (typecheck via `tsc`, lint via ESLint,
  tests via `vitest`). Each needs the project's deps installed in the
  cloned tree — likely a `pnpm install --frozen-lockfile` step before
  the agents run, with the install output cached
- **alignment-agent entity extractor is too loose.** Matches every
  `## Word` and `- **Word**` line in DOMAIN.md as an entity, including
  template headings like "Description" / "Status" — produces false
  positives like "entity 'description' has no module" intents. Tighten
  the regex to require capitalised-PascalCase + skip a known stop list
  (Description, Status, Notes, etc.)
- **Live Prometheus / Datadog adapters not yet exercised.** Built
  against the published REST API shapes; unit-tested smoke would
  require a monitoring system. NoOp adapter is the verified path
- **drift-agent additive note can churn DOMAIN.md** if the agent runs
  daily and the module keeps changing. Should de-dupe against existing
  notes (the current `includes(note)` check uses the exact day, so the
  next day's note appears as a new line — fine for low-volume
  projects, may need rolling-window dedupe for active ones)

**Known architectural constraints Claude Code must respect:**
- pnpm 9.x only (Node 20 compatibility)
- No direct DB access outside adapter packages
- No direct LLM calls outside @gestalt/core/llm
- GOLDEN_PRINCIPLE_BREACH signals are never auto-resolved
- All state-changing operations write an audit record (GP-002)
- Server must not import from packages/dashboard/src — use server-local type mirrors
- /events SSE route is canonical in routes/events.ts — do not re-register elsewhere
- Git token must never appear in API responses or logs
- `simple-git` for all Git operations — never child_process.exec('git ...')
- Temp dirs must be cleaned in a finally block — always, even on error
- Migration files must NOT contain CREATE TABLE schema_migrations or INSERT
  INTO schema_migrations — the runner handles that

---

### Session 2026-05-29 — Claude Code (orchestrator observability + Git push-back)

After ADR-032 wired Git as the project filesystem, `gestalt run` cycles
ran end-to-end but produced no visible outcome: `agent_executions` /
`signals` / `artifacts` stayed empty, the SSE stream was silent, and
generated files never reached the project repo. The orchestrator was
keeping every result in memory, then discarding it. Four pieces wired:

Changed:
- `packages/core/src/events/index.ts` (new): canonical in-process event
  bus. `LiveEventType` / `LiveEvent` / `EventBus` / `EventSubscriber`
  types + the `eventBus` singleton + `emitLiveEvent` helper moved here
  so the orchestrator can publish on the same bus the SSE route
  subscribes to. `packages/core/src/index.ts` re-exports
- `packages/server/src/events.ts`: now a 1-line re-export of
  `@gestalt/core` (preserves existing `import { eventBus, emitLiveEvent }
  from '../events'` paths). `packages/server/src/types.ts`: re-exports
  the event types from core
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  - new `transitionIntent(intentId, correlationId, status)` helper —
    `intents.updateStatus` + `emitLiveEvent('intent.status-changed')`
  - `drivePlan` now creates an `agent_executions` row at step start
    (status='running'), saves every `result.signals` + `result.artifacts`
    via the postgres repos, updates the execution row at end with
    `tokensUsed` + `durationMs`, and emits `agent.started`,
    `signal.emitted`, `agent.completed` events at the right boundaries
  - new `commitAndPushArtifacts({ workDir, defaultBranch, commitMessage,
    artifacts, childLog })` helper: writes each artifact to its `path`
    inside the cloned working tree, `git add . && git commit`
    (`feat: <intent text> [gestalt <corr8>]`) and `git push origin
    <defaultBranch>`. Called from `handleIntentTask` after a successful
    plan, before the gate dispatch
  - fixed a latent bug: `drivePlan` now bails out as soon as
    `plan.state === 'waiting_for_clarification'`. Previously the CONTEXT_GAP
    branch only returned from the inner `Promise.all` callback, so the
    loop kept finding ready steps and running them

Verified live against the running container:
- Built `pnpm -r build` clean across all 12 packages
- `docker-compose up -d --build server` healthy
- Submitted an intent against the existing `trackeros` project, tapped
  `GET /events?token=…` in parallel: SSE captured the full sequence —
  `intent.created` → `intent.status-changed=generating` →
  `agent.started{agentRole: intent-agent}` → `signal.emitted{CONTEXT_GAP}`
  → `agent.completed{status=failed, durationMs=11172, signalCount=1}` →
  `intent.status-changed=waiting-for-clarification` →
  `intent.status-changed=failed`
- `agent_executions` and `signals` tables both populated with one row
  matching the SSE payloads
- `artifacts` and the git-push path were not exercised this cycle
  (intent-agent's JSON parsing failed before any artifacts existed) —
  the code path is structurally identical to the harness-init route
  that already pushes to the same real repo

Decisions made:
- **Push straight to `defaultBranch` for now**, not a side branch + PR.
  The original ADR-032 design has the deploy-layer pr-agent open a PR,
  but pr-agent does not exist. Listed under Pending enhancements as
  "Move artifact push from orchestrator to pr-agent." Direct push gives
  the operator something to `git pull` today
- **Event bus moved into core, not duplicated**, because the orchestrator
  needs to publish on the same singleton the SSE route subscribes to.
  Putting it in core avoids both an agents → server dep cycle and the
  bug of having two unrelated EventEmitter instances
- **One commit per successful intent cycle**, message `feat: <intent
  text> [gestalt <corr8>]`. Truncated to 72 chars + uses only the first
  line of the intent so multi-line intents do not blow out the subject

Build status: All 12 packages compile clean. SSE end-to-end confirmed
via live `/events` tap. Unresolved issue surfaced (intent-agent prompt /
validator mismatch — `IntentSpec missing rawIntent`) tracked under
Pending enhancements.

---

### Session 2026-05-29 — Claude Code (intent-agent: first end-to-end cycle)

The follow-up to the orchestrator-observability session. Live runs against
`gpt-4o` were failing at the intent-agent because (a) the operator's intent
text never reached the prompt — `ContextSnapshot.intentSpec.rawIntent` was
always `""` — and (b) the local validator required `affectedDomains.length
> 0`, which is impossible to satisfy on a greenfield project where
`docs/DOMAIN.md` has no entities yet.

Changed:
- `packages/agents/generate/src/orchestrator/context-assembler.ts`:
  `assembleContext` now takes an `intentText: string` parameter and
  populates `intentSpec.rawIntent` with it (preserving any non-empty
  rawIntent from a prior intent-agent artifact for downstream agents)
- `packages/agents/generate/src/orchestrator/orchestrator.ts`: threads
  `payload.text` from the BullMQ message → `drivePlan` → each
  `assembleContext` call. Without this the LLM was being asked to parse
  `"Intent to parse: ""`
- `packages/agents/generate/src/agents/intent-agent.ts`:
  - `parseIntentSpec` now takes `rawIntentText` and unconditionally
    overwrites the parsed `rawIntent`. The LLM is not trusted to
    round-trip the input verbatim
  - The local `validateIntentSpec` now only checks `rawIntent` (which the
    orchestrator guarantees). Empty `affectedDomains` and
    `successCriteria` arrays are accepted — they are legitimate
    greenfield outputs, and downstream agents already handle them
- `packages/agents/generate/src/prompts/intent-prompt.ts`: rules block
  rewritten — `affectedDomains` may now name new domains for greenfield
  projects (previously the prompt required referencing existing ones,
  which was impossible)

Verified live against the running container, project `trackeros`:
- Submitted intent "Add a hello world endpoint at GET /hello returning
  JSON {message:'hello'}"
- 6 agent_executions rows: `intent-agent` 3.0s ✓, `design-agent` 2.3s ✓,
  `context-agent` / `lint-config-agent` correctly skipped, `code-agent`
  5.6s ✓, `test-agent` 4.7s ✓
- 0 signals (no problems), 7 artifacts (intent-spec, design-spec, 4 code
  files, 1 test file)
- Intent transitioned `generating → in-review` in 11 seconds
- Orchestrator committed + pushed `8938d51` to
  `github.com/afarahat-lab/trackeros.git` with the expected file paths
  (`src/modules/hello/{routes/hello-routes.ts,index.ts}`,
  `src/api/index.ts`, `src/shared/auth/rbac-middleware.ts`,
  `src/modules/hello/__tests__/hello-routes.test.ts`,
  `.gestalt/{intent,design}-spec.json`)
- Verified the push by cloning the remote with a one-off temp clone; tip
  shows the new commit on top of the harness-init commit

Build status: All 12 packages compile clean. First end-to-end run-through
the full SDLC slice (intent → design → code → test → commit → push) is
functioning. The intent-agent prompt / validator entry under Pending
enhancements is resolved.

---

### Session 2026-05-29 — Claude Code (quality gate v1)

Implemented the first slice of the quality-gate layer per the "both
deterministic + LLM review" scope.

Changed:
- `packages/agents/quality-gate/src/agents/constraint-agent.ts`:
  replaced the Phase-2 stubs with deterministic regex checks against
  generated text. Five rules: `no-any`, `no-console` (CONSTRAINT_VIOLATION,
  auto-resolvable, medium); `no-direct-db-outside-shared-db`
  (CONSTRAINT_VIOLATION, high); `no-hardcoded-secret` (GOLDEN_PRINCIPLE_BREACH,
  critical, never auto-resolved); `no-direct-llm-sdk` (GOLDEN_PRINCIPLE_BREACH,
  high). Locations carry file/line/column/rule
- `packages/agents/quality-gate/src/agents/llm-review-agent.ts` (new):
  single LLM call summarising the artifact set. Structured JSON output
  with items keyed by file/line/severity/category. low/info items live
  only in the prose review artifact; medium and above produce signals.
  Severity → signal-type mapping: any `golden-principle` category OR
  `critical` severity → GOLDEN_PRINCIPLE_BREACH; otherwise
  CONSTRAINT_VIOLATION. The full prose review is persisted as a `design`
  artifact at `.gestalt/llm-review-<corr8>.md`
- `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`
  (new): BullMQ worker for `bull:gestalt-gate:*`. Mirrors the generate
  orchestrator's observability pattern — clone project repo into temp
  dir; per gate-agent run an `agent_executions` row + SSE events
  (`agent.started` / `agent.completed` / `signal.emitted`); persist
  signals via the gate-to-platform signal mapping; `synthesiseGateResult`
  → verdict; emit `gate.completed` with verdict + per-agent summary;
  transition the intent (`pass` → `approved`, `fail` → `failed`,
  `escalate` → `escalated`). Temp dir cleaned up in `finally`
- `packages/agents/quality-gate/src/index.ts`: exports
  `startGateWorker`, `runLlmReviewAgent`, plus types
- `packages/agents/quality-gate/package.json`: added `simple-git` runtime
  dep
- `packages/server/package.json`: added `@gestalt/agents-quality-gate`
  workspace dep
- `packages/server/src/server.ts`: imports `startGateWorker` and calls
  it as a new "step 7" between the generate-orchestrator registration
  and Fastify app creation. Startup-sequence comment renumbered

Verified live against project trackeros (correlationId `b1f6eecd…`):
- Intent: "Add an audit log dashboard module under src/modules/audit
  with GET /audit/logs … RBAC must require admin role"
- Generate cycle: 6 agents completed, 12 artifacts produced and pushed
  to Git (~37s)
- Gate cycle started immediately on `gate.review` dispatch
- constraint-agent: 7ms; caught 1 `no-direct-db-outside-shared-db`
  violation in the generated repository file (the code-agent reached
  for postgres directly instead of using the shared db layer)
- llm-review-agent: 3.8s; produced 1 GOLDEN_PRINCIPLE_BREACH (missing
  GP-003 input validation on the POST endpoint) + 1 CONSTRAINT_VIOLATION
  (potential PII exposure in audit-log details). Full prose review saved
  as `.gestalt/llm-review-b1f6eecd.md`
- Verdict: `escalate` (any GP_BREACH escalates). Intent transitioned to
  `escalated`
- SSE captured every event: agent.started + agent.completed for each
  gate agent + the top-level gate.completed with summary "Gate escalated
  — 1 golden principle breach(es) require human review"

Decisions made:
- **Regex over AST for constraint-agent today.** The package comment
  describes a two-level approach (ESLint + tsc API) but text-based
  catches the obvious offenders without requiring deps installed in the
  cloned tree. Promote to AST when a project-deps-install pipeline lands
- **Review-agent persists the prose review as an artifact** rather than
  pushing it back to Git or sending the whole prose as signals. The
  operator reads it via `gestalt status --id <correlationId>`; blocking
  concerns flow as signals
- **Failed verdicts don't feed back to generate yet** — they mark the
  intent `failed`. Routing auto-resolvable signals back to the right
  generate-agent is a follow-up (existing `feedback-router.ts` already
  defines the mapping)
- **Gate clones a fresh copy of the project repo** rather than running
  against the in-memory artifact set the generate orchestrator hands
  over. Matches the design intent that downstream layers see the actual
  Git state (which is what would ship). Also future-proofs for the
  real-tooling gate agents that will need `node_modules`
- **Default gate harness config is inlined.** Per-project gate config
  in HARNESS.json is a small follow-up — the structure is already in
  the `GateHarnessConfig` type

Build status: All 12 packages compile clean. Both orchestrators
registered at startup. First end-to-end intent → gate → escalate cycle
working as designed.

---

### Session 2026-05-29 — Claude Code (gate ↔ generate feedback loop)

The follow-up to the quality-gate-v1 session. Closes the loop so a `fail`
verdict no longer terminates the intent — it dispatches a retry to the
generate queue with the gate's signals threaded into the routed
specialist agent's prompt.

Changed:
- `packages/agents/generate/src/types.ts`: `AgentTask` gained optional
  `priorSignals: FeedbackSignal[]` and `retryCount: number`. Threaded
  through the orchestrator into each step's task
- `packages/agents/generate/src/prompts/code-prompt.ts`: when
  `priorSignals.length > 0`, prepends a "Quality-gate feedback from the
  previous attempt" section listing every prior signal with file:line +
  rule and the platform's expectation ("Address each one in this
  attempt; do not regress on items that were not flagged")
- `packages/agents/generate/src/agents/code-agent.ts`: forwards
  `task.priorSignals` to `buildCodePrompt`
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  - `IntentTaskPayload` extended with `retryCount` and `priorSignals`
  - exports `MAX_GATE_RETRIES = 3`
  - `drivePlan` accepts `priorSignals`; per-step, it routes only the
    signal subset relevant to that agent role (per the
    `feedback-router.ts` table — code-agent gets LINT_FAILURE /
    TEST_FAILURE / CONSTRAINT_VIOLATION; context-agent gets CONTEXT_GAP)
  - commit-message switches `feat:` → `fix:` and appends ` retry N/3`
    on retry cycles so `git log` narrates the SDLC
  - gate-handoff payload now forwards `retryCount` (so the gate enforces
    the budget across re-entries) and `projectId` / `text` (so the gate
    can reconstruct a `generate:intent` payload on retry dispatch)
- `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`:
  - `GateTaskPayload` extended with `retryCount` / `projectId` / `text`
  - new `MAX_GATE_RETRIES = 3` constant
  - new `GenerateRetryPayload` local type — the shape of the message
    posted back to the generate queue (mirrors generate's payload
    without importing agents-generate at runtime)
  - verdict handling rewritten as `pass → approved` / `escalate →
    escalated` / `fail → maybeDispatchRetry(...) ? generating : failed`
  - new `maybeDispatchRetry()` helper: checks budget, filters
    auto-resolvable signals, reconstructs the project/text from the
    intents table if needed, transitions the intent back to
    `generating`, emits an `intent.status-changed` event with a
    `note: gate-retry N/M — K signal(s) routed` field, then `dispatch()`s
    a `generate:intent` task with `retryCount + 1` and the routed
    signals
- `packages/agents/quality-gate/src/agents/llm-review-agent.ts`: tuned
  signal mapping so `golden-principle` category by itself no longer
  escalates. GP_BREACH only fires for `critical` severity — actual
  security threats (hardcoded secrets, unguarded SQL, RBAC bypass).
  Common LLM findings like "missing input validation" now flow as
  CONSTRAINT_VIOLATION and can be retried

Verified live against `trackeros` (correlationId `2a57b087…`):
- Intent: "Add a settings module ... PATCH /settings ... validate with Zod"
- Cycle 1 (50s): generate produced 12 artifacts and pushed; gate fail
  (2 signals); retry dispatched
- Cycle 2 (45s): generate retried with prior signals in code-prompt;
  pushed `fix: ... [retry 1/3]`; gate fail (3 signals)
- Cycle 3 (54s): pushed `fix: ... [retry 2/3]`; gate fail (1 signal)
- Cycle 4 (50s): pushed `fix: ... [retry 3/3]`; gate fail (4 signals);
  retry budget exhausted → intent → `failed`
- Each cycle's agent_executions, signals, and artifacts are persisted;
  the Git log shows the four commits in chronological order
- Total wall-clock for the failed-after-retries case: 214 seconds
- Pure-utility intent (`66891cc2…`) in the same session: gate passed
  on first try → intent → `approved`. First time the platform has
  reached `approved` end-to-end

Decisions made:
- **Retry dispatches a fresh `generate:intent` task** rather than a new
  task type. The orchestrator distinguishes retries by the presence of
  `retryCount > 0` and `priorSignals`. Keeps the queue plumbing simple
  and lets the existing handleIntentTask code path own the cycle
- **Full plan re-runs on retry** — all 6 specialist agents run again,
  even though only code-agent typically needs to act on the feedback.
  Skipping intent/design/context when their prior artifacts exist in
  the Git tip is an optimisation, not a correctness gap. Tracked under
  Pending enhancements
- **MAX_GATE_RETRIES hardcoded to 3** in both orchestrators — matches
  the harness template's `qualityGate.maxRetries: 3`. Reading it per-
  project from HARNESS.json is a small follow-up
- **`golden-principle` category no longer auto-escalates.** The LLM's
  default categorisation is too aggressive — almost every cycle on a
  corporate-ops app produces at least one "missing input validation"
  or "audit log could be improved" finding, and those are fixable, not
  human-review-worthy. GP_BREACH is now gated on `critical` severity
  only, which the prompt reserves for real security threats
- **`retry N/3` suffix in commit subjects.** Lets operators see at a
  glance which commits were generated, which were gate-driven retries,
  and how many cycles the platform spent. `feat:` → `fix:` prefix swap
  on retry follows conventional-commits

Build status: All 12 packages compile clean. Both orchestrators
register at startup. Feedback loop verified end-to-end with both a
budget-exhaustion failure case (`2a57b087`, 4 cycles → `failed`) and a
clean-first-try success case (`66891cc2`, 1 cycle → `approved`).

---

### Session 2026-05-30 — Claude Code (deploy layer v1)

Implements ADR-033 (pipeline adapter pattern) and ADR-034 (production
requires staging). After a gate `pass`, the new deploy-orchestrator
worker chains pr-agent → pipeline-agent → promotion-agent (staging →
production) and transitions the intent to `deployed`.

Changed:
- `packages/adapters/postgres/src/migrations/004_deployments.sql` (new):
  `deployment_event_type` enum + `deployment_events` table (PK,
  correlation_id, intent_id FK, event_type, environment, pr_url,
  pr_number, run_id, deployment_url, metadata, created_at). Append-only
  at the DB layer via `REVOKE UPDATE, DELETE ON … FROM current_user`
  inside a DO block (same pattern as `audit_log`)
- `packages/core/src/repository/index.ts`: `DeploymentEventRecord`,
  `DeploymentEventType`, and `DeploymentEventRepository` (append +
  findByCorrelationId + findStagingPromotion). Added
  `deploymentEvents` to `RepositoryRegistry`
- `packages/core/src/index.ts`: re-exports the new types + repo
- `packages/adapters/postgres/src/repositories/deployment-events.ts`
  (new): `PostgresDeploymentEventRepository`. Wired into
  `createPostgresAdapter`
- `packages/adapters/{oracle,mssql}/src/repositories/deployment-events.ts`
  (new): throw-stubs so adding methods to the interface forces a build
  break across all adapters (same pattern as the project stubs from the
  ADR-032 session)
- `packages/agents/deploy/src/adapters/pipeline-adapter.ts` (new):
  `PipelineAdapter` interface — four methods (`createPullRequest`,
  `triggerPipeline`, `getPipelineStatus`, `promoteToEnvironment`),
  `PipelineStatus` union, `PipelineAdapterType` (`github-actions` |
  `azure-devops` | `gitlab-ci` | `jenkins` | `noop`)
- `packages/agents/deploy/src/adapters/github-actions-adapter.ts` (new):
  `GitHubActionsAdapter` — REST API client. `createPullRequest` posts
  `/repos/{owner}/{repo}/pulls`; `triggerPipeline` dispatches the
  `gestalt.yml` workflow then queries
  `/actions/runs?branch=…&event=workflow_dispatch` to recover the
  numeric runId; `getPipelineStatus` maps `status`/`conclusion` to
  `running`/`passed`/`failed`/`cancelled`; `promoteToEnvironment`
  dispatches the same workflow with `inputs.environment`. PAT comes
  from `getRepositories().projects.getCredential(projectId)` — same
  token used for clone + push. Includes `parseOwnerRepo(gitUrl)`
  helper for the resolver
- `packages/agents/deploy/src/adapters/noop-pipeline-adapter.ts` (new):
  `NoOpPipelineAdapter` — immediate plausible fakes. PR numbers
  deterministic from branch name (hash → mod 9000 + 1000). Pipeline
  status simulates a 500 ms `running → passed` transition so dashboards
  see the change rather than collapsing to an instant
- `packages/agents/deploy/src/adapters/resolver.ts` (new):
  `resolvePipelineAdapter` reads `pipeline.adapter` from
  `HARNESS.json` in the cloned tree. `github-actions` + parseable
  gitUrl → `GitHubActionsAdapter`; anything else or unparseable → log a
  warning and fall back to `NoOpPipelineAdapter`
- `packages/agents/deploy/src/agents/pr-agent.ts` (rewritten): clones
  the project, transitions intent `approved → deploying`, cuts
  `gestalt/<corr8>-<slug>` (slug = first 5 words, kebab-cased, capped
  at 40 chars), writes artifacts, commits + pushes, calls
  `adapter.createPullRequest`. Persists `pr-opened` to
  `deployment_events`, emits `deployment.updated`. Temp dir cleaned in
  `finally`
- `packages/agents/deploy/src/agents/pipeline-agent.ts` (rewritten):
  triggers the pipeline, polls `getPipelineStatus` on a 15 s tick up
  to 10 min. Persists `pipeline-triggered` / `pipeline-passed` /
  `pipeline-failed` rows + SSE. On `failed`/`cancelled` returns
  `TEST_FAILURE` signal; on timeout `CONTEXT_GAP`. Outcome union typed
- `packages/agents/deploy/src/agents/promotion-agent.ts` (rewritten):
  **ADR-034 enforcement** — `targetEnvironment === 'production'` calls
  `findStagingPromotion(correlationId)`; null → emit
  `GOLDEN_PRINCIPLE_BREACH`, return `{ kind: 'blocked' }`. Otherwise
  call `adapter.promoteToEnvironment`, persist `promoted-staging` /
  `promoted-production`, emit `deployment.updated`
- `packages/agents/deploy/src/agents/util.ts` (new): shared
  `authenticatedGitUrl` + `branchNameFor` helpers (same auth contract
  as generate/gate, but co-located so the agents don't depend on
  other layers)
- `packages/agents/deploy/src/orchestrator/deploy-orchestrator.ts`
  (new): BullMQ worker on `gestalt-deploy`. Routes `deploy:pr` →
  pr-agent → dispatch `deploy:pipeline`; `deploy:pipeline` →
  pipeline-agent → dispatch `deploy:promotion` staging; `deploy:promotion`
  → promotion-agent → dispatch staging-promotion follow-up OR mark
  intent `deployed`. `blocked` outcome from promotion-agent →
  `escalated`. Per-task observability mirrors the gate orchestrator
  (agent_executions create → updateStatus, SSE `agent.started` /
  `agent.completed` / `signal.emitted`)
- `packages/agents/deploy/src/{index.ts,types.ts}`: rewrote to expose
  the new surface (`startDeployWorker`, `runPRAgent`,
  `runPipelineAgent`, `runPromotionAgent`, `GitHubActionsAdapter`,
  `NoOpPipelineAdapter`, `resolvePipelineAdapter`, `PipelineAdapter`).
  Old aspirational `PipelineAdapter` interface (which had `trigger` /
  `getStageResults` / `cancel`) and the empty Azure/GitLab/Jenkins
  + scanner stub files removed — they would have collided with the new
  interface and don't match the ADR-033 contract
- `packages/agents/deploy/package.json`: added `simple-git` runtime dep
- `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`:
  on `pass` verdict, in addition to transitioning intent to
  `approved`, now dispatches `deploy:pr` to the deploy queue with
  `intentId`, `projectId`, `intentText`, and the full artifact set.
  New `dispatchDeployPR` helper alongside `maybeDispatchRetry`
- `packages/server/package.json`: added `@gestalt/agents-deploy`
  workspace dep
- `packages/server/src/server.ts`: imports `startDeployWorker`,
  registers it as step 8 between the quality-gate worker and the
  Fastify app. Startup-sequence comment renumbered
- `packages/server/src/routes/projects.ts`: harness template gained
  `pipeline: { adapter: 'noop' }` so freshly-registered projects can
  run the deploy chain end-to-end without configuring real CI
- `docs/DECISIONS.md`: appended ADR-033 (pipeline adapter pattern) and
  ADR-034 (production requires confirmed staging) with full decision /
  rationale / consequences sections

Verified live against `trackeros` (correlationId `8f53b75d…`):
- Intent: "Add a string-case utility module under
  src/shared/utils/string-case with two pure functions"
- Generate: 17 s, 6 agent executions, 5 artifacts
- Gate: 2 s, constraint-agent + llm-review-agent both passed, verdict
  `pass`
- Deploy chain: pr-agent 2.5 s → pipeline-agent 1.9 s → promotion-agent
  staging 1.0 s → promotion-agent production 0.9 s
- Total wall-clock: 30 s; intent transitioned `generating → in-review
  → deploying → deployed`
- `deployment_events`: 5 rows in order (`pr-opened`,
  `pipeline-triggered`, `pipeline-passed`, `promoted-staging`,
  `promoted-production`) with the expected metadata
- SSE: 5 `deployment.updated` events captured with the expected
  payloads (prUrl, prNumber, runId, environment, deploymentUrl)
- Git: branch
  `origin/gestalt/8f53b75d-add-a-string-case-utility-module` pushed
  with the artifact commit. Branch name matches the brief's
  `gestalt/<corr8>-<slug>` format (slug = first 5 words, kebab-cased,
  40-char cap)
- Adapter used: `NoOpPipelineAdapter` (harness template default). The
  500 ms simulated pipeline delay is visible in the SSE timestamps —
  `pipeline-triggered` at 21:12:15.xxx, `pipeline-passed` at the same
  second; dashboards will see the transition rather than instant
  collapse

Decisions made:
- **`pipeline.adapter: noop` is the harness default.** A fresh project
  has no CI/CD wired up yet; defaulting to `github-actions` would 500
  every cycle on the dispatch call. NoOp lets the chain progress and
  the operator opts into real CI by flipping a single field in
  `HARNESS.json`
- **The 500 ms NoOp pipeline delay is intentional.** Without it the
  `running → passed` transition collapses to a single instant and the
  dashboard never renders the in-progress state
- **Resolved per-task, not per-server.** A single Gestalt deployment
  can serve projects on different CI systems because the resolver
  reads from each project's cloned `HARNESS.json`
- **pr-agent transitions `approved → deploying`, not the gate.** The
  gate dispatches `deploy:pr` and the orchestrator picks it up
  asynchronously; the intent shows `approved` until the deploy worker
  actually starts work, which is the right semantics — the deploy
  could be queued for a while if many cycles are in flight
- **ADR-034 enforcement lives in promotion-agent itself, not the
  orchestrator.** A future direct-promotion endpoint or test harness
  would still have to go through the agent, and putting the check in
  the agent means the invariant holds regardless of caller. The
  orchestrator just maps a `blocked` outcome to `escalated`
- **`branchNameFor` slug derivation matches the brief exactly** (first
  5 words, kebab-cased, max 40 chars, non-alphanumeric stripped).
  Stable enough that re-running the same intent text produces the
  same branch
- **Removed old aspirational adapter stubs** (Azure DevOps / GitLab
  CI / Jenkins / scanner files). They referenced a PipelineAdapter
  shape that no longer matches the ADR-033 contract and would have
  blocked the build. Their position in the design is preserved in
  ADR-016 / the `PipelineAdapterType` union; rebuild them on demand
- **`deployment_events` is append-only at the DB layer**, not just by
  convention. Same `REVOKE` + `DO`-block pattern as `audit_log` so it
  survives whatever role `POSTGRES_USER` resolves to

Build status: All 12 packages compile clean. All four workers (gate +
generate + deploy + Fastify routes) register at startup. Full SDLC
slice — intent → design → code → test → gate → PR → pipeline →
staging → production → `deployed` — verified end-to-end against the
NoOp adapter.

---

### Session 2026-05-30 — Claude Code (single-push deploy + workflow seed)

Two follow-ups to the deploy layer v1 session, both already documented
as Pending enhancements there:

1. **Retired the generate-orchestrator's direct push to
   `defaultBranch`.** The dual-push (generate to main + pr-agent to PR
   branch) is now a single push from pr-agent.
2. **`init-harness` now seeds `.github/workflows/gestalt.yml`** so
   projects opting into `pipeline.adapter: github-actions` have a
   working workflow file to dispatch.

Changed:
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  - Removed the `commitAndPushArtifacts(...)` call inside
    `handleIntentTask`. The artifact set is already forwarded to the
    gate in the `gate:review` dispatch payload (`payload.artifacts`),
    and from there into the `deploy:pr` payload — pr-agent does the
    only commit + push, to the PR branch
  - Deleted the `commitAndPushArtifacts` helper function (~45 lines)
  - Stripped now-unused imports: `mkdir`, `writeFile`, `dirname`, and
    the `type SimpleGit` (only the runtime `simpleGit` clone call
    remains, for the per-cycle working-tree clone the
    context-assembler reads from)
  - The "All generate steps complete" log moved up to the artifact
    flatMap line and now includes `artifactCount` + `retryCount`
- `packages/server/src/routes/projects.ts`:
  - Added `'.github/workflows/gestalt.yml': buildGestaltWorkflowYml()`
    to the harness file map
  - New `buildGestaltWorkflowYml()` returns the workflow content —
    `name: gestalt`, `on: workflow_dispatch` with three string inputs
    (`environment`, `correlationId`, `branch`), single `test` job on
    `ubuntu-latest` running `checkout` → `setup-node@v4` (Node 20) →
    `pnpm/action-setup@v3` (pnpm 9) → `pnpm install --frozen-lockfile`
    → `pnpm test`
  - `environment` is typed as `string` (not `choice`) so the
    deploy-orchestrator's CI-leg dispatch (which currently passes
    `environment: 'ci'`) is accepted as well as the staging /
    production promotion dispatches. The description documents the
    expected values

Verified live against `trackeros` (correlationId `75625687…`):
- Submitted intent "Add a snake-case utility under
  src/shared/utils/snake-case with snakeCase(s: string): string"
- Intent reached `deployed` in 36 s (generate 22 s → gate 4 s →
  deploy 8 s)
- Captured `origin/main` HEAD before submission: `23e5d373…`
- Re-cloned after `deployed` transition: HEAD still `23e5d373…`
- New branch `origin/gestalt/75625687-add-a-snake-case-utility-under`
  exists, contains the cycle's artifacts as a single commit. PR
  opened against `main` (NoOp adapter, fake PR number)
- Single-push behaviour confirmed: only pr-agent touches Git now
- The `gestalt.yml` change applies only to NEW projects — `trackeros`
  was bootstrapped before this commit so its repo does not yet
  include the workflow file. Future `gestalt init` runs will write
  it as part of the initial harness commit

Decisions made:
- **Kept `MAX_GATE_RETRIES` exported from
  `agents-generate/src/orchestrator/orchestrator.ts`** even though it
  is no longer used inside that file (the retry-suffix logic that
  consumed it went with the commit-message builder). External
  consumers and the public docs reference it as the retry-budget
  constant; gate-orchestrator has its own private `const` of the
  same name. Removing the export would be an unrelated cleanup
- **`environment` workflow input is a string, not a choice.** A
  `type: choice` with `options: [staging, production]` would reject
  the deploy-orchestrator's `triggerPipeline` call (which currently
  passes `environment: 'ci'` to differentiate the CI-only leg from
  the staging / production promotions). String input documents the
  expected values without constraining them, which keeps the
  workflow contract loose enough for future task types
- **Workflow uses `--frozen-lockfile`** — the project repo is
  expected to have committed `pnpm-lock.yaml`. Catches accidental
  dependency drift between the developer's machine and CI

Build status: `pnpm -r build` clean across all 12 packages. All four
workers (generate orchestrator, gate, deploy, Fastify routes)
register on startup. Full SDLC slice now reaches `deployed` with a
single Git commit per cycle on a PR branch.

---

### Session 2026-05-30 — Claude Code (maintenance layer v1)

Implements ADR-018 / ADR-019 / ADR-020 / ADR-035 — the four scheduled
maintenance agents that close the SDLC loop. Closes the platform's
build-time scope: every layer (generate, gate, deploy, maintenance) is
now end-to-end wired with the same observability pattern.

Changed:
- `packages/adapters/postgres/src/migrations/005_maintenance.sql` (new):
  `maintenance_runs` table (agent_role, project_id FK, status,
  intents_queued, direct_fixes, findings JSONB, duration_ms, run_at,
  completed_at) + a `GRANT DELETE` on `deployment_events` (migration
  004 had revoked it under the audit-log analogy; gc-agent needs it
  for the 90-day retention purge). Starts with a `DROP TABLE IF EXISTS
  maintenance_runs CASCADE` because `001_initial.sql` created an
  incompatible legacy shape — confirmed empty before dropping
- `packages/core/src/repository/index.ts`: `MaintenanceRunRecord` +
  `MaintenanceRunStatus` + `MaintenanceFinding` types; new
  `MaintenanceRunRepository` interface (create / complete / list);
  added `maintenanceRuns` to `RepositoryRegistry`; added
  `gcOlderThan(cutoff: Date)` to `DeploymentEventRepository`; added
  `listAll(): Promise<ProjectRecord[]>` to `ProjectRepository` so the
  maintenance scheduler can iterate every project regardless of owner.
  `packages/core/src/index.ts` re-exports the new types
- `packages/adapters/postgres/src/repositories/maintenance-runs.ts`
  (new): `PostgresMaintenanceRunRepository`. `findings` is JSONB; the
  insert/update path uses an **explicit `::jsonb` cast** on the
  stringified payload (without it postgres' implicit text→jsonb
  conversion wraps the whole array as a JSON string scalar) and
  `parseFindings` defensively handles both shapes postgres.js may
  return on read (parsed array vs raw JSON string)
- `packages/adapters/postgres/src/repositories/deployment-events.ts`:
  `gcOlderThan` implemented via `WITH deleted AS (...) RETURNING 1`
  count
- `packages/adapters/postgres/src/repositories/projects.ts`:
  `listAll()` implemented (no WHERE filter, ORDER BY created_at DESC)
- `packages/adapters/postgres/src/index.ts`: wired
  `PostgresMaintenanceRunRepository` into `createPostgresAdapter`
- `packages/adapters/{oracle,mssql}/src/repositories/{deployment-events,maintenance-runs,projects}.ts`:
  added throw-stubs for the new methods (`gcOlderThan`, `listAll`) +
  new `*MaintenanceRunRepository` stub classes. `index.ts` of each
  re-exports them — interface drift in core still surfaces as a build
  break here
- `packages/agents/maintenance/src/types.ts`: rewritten to the brief's
  contract — `MaintenanceIntent` with the four typed values
  (`CONTEXT_UPDATE`, `CONTEXT_ALIGNMENT`, `PERFORMANCE_DEGRADATION`,
  `SECURITY_FINDING`), `MonitoringAdapter` (`getErrorRate`,
  `getLatencyP99Ms`, `getAlertCount`), `MonitoringThresholds`,
  `MaintenanceAgentInput` / `MaintenanceAgentResult`, `HarnessSubset`,
  `MaintenanceHarnessConfig`. Old DriftFinding / AlignmentViolation /
  GCFinding shapes removed
- `packages/agents/maintenance/src/adapters/` (flat layout per brief):
  `noop-monitoring-adapter.ts` (returns zeros), `prometheus-adapter.ts`
  (Prometheus HTTP API `/api/v1/query` — error-rate, p99 via
  `histogram_quantile`, alerts via `ALERTS{alertstate="firing"}`),
  `datadog-adapter.ts` (Metrics API v1 + monitor states endpoint),
  `resolver.ts` (reads `maintenance.monitoring.adapter` from HARNESS.json
  with NoOp fallback). The old `adapters/monitoring/` subdir + the
  Azure Monitor stub deleted
- `packages/agents/maintenance/src/agents/util.ts` (new): shared
  `authenticatedGitUrl` + `maintenanceIntentPrefix` / `maintenanceIntentText`
  helpers — every maintenance-dispatched intent text carries a
  `[gestalt-maintenance/<type>]` prefix that the evaluation-agent's
  dedupe guard greps for
- `packages/agents/maintenance/src/agents/drift-agent.ts`: rewritten.
  Clones repo, walks `git log --since="30 days ago" --name-only` to
  collect module changes, compares against context-file timestamps via
  `git log -1 --format=%aI`. For drifted modules: appends an HTML-comment
  note to DOMAIN.md (ADR-018 additive exception — direct commit
  authored as `Gestalt Drift Agent`) and queues a `CONTEXT_UPDATE`
  intent for structural follow-up
- `packages/agents/maintenance/src/agents/alignment-agent.ts`:
  rewritten. Extracts entities from DOMAIN.md headings + bullet lists,
  modules from `src/modules/...` references in ARCHITECTURE.md,
  principle IDs (`GP-NNN`) from GOLDEN_PRINCIPLES.md; queues
  `CONTEXT_ALIGNMENT` intents per misalignment
- `packages/agents/maintenance/src/agents/gc-agent.ts`: rewritten.
  Three actions: prune `deployment_events` older than 90 days (via
  `gcOlderThan`), delete stale `gestalt/*` remote branches older than
  30 days (`git push origin --delete`), delete + commit `.gestalt/*`
  spec files older than 90 days. No intent queuing — direct cleanup only
- `packages/agents/maintenance/src/agents/evaluation-agent.ts`:
  rewritten. Resolves adapter via the resolver, queries all three
  metrics in parallel, builds candidate intents on threshold breach,
  runs the **duplicate guard** against open intents (two `intents.list`
  calls — one for `pending`, one for `generating` — concatenated and
  checked for the type-prefix string). Skips when monitoring is
  disabled
- `packages/agents/maintenance/src/runner/index.ts` (new): the shared
  per-run wrapper. Creates the `maintenance_runs` row, iterates
  projects (or just one, for the manual trigger), invokes the agent,
  dispatches each queued `MaintenanceIntent` as a fresh `intents` row
  + `generate:intent` BullMQ task (`source: 'maintenance-agent'`,
  priority mapped via the same `low → background` rule the human
  intent route uses), completes the run row with totals + findings +
  durationMs, emits `maintenance.run-completed` SSE event
- `packages/agents/maintenance/src/scheduler/index.ts` (new):
  `startMaintenanceScheduler` registers four `node-cron` schedules
  (drift 02:00 UTC, alignment 03:00 UTC, gc Fri 04:00 UTC, evaluation
  every 15 min); `triggerMaintenanceRun` is the shared entry point
  used both by the cron callbacks and by `POST /maintenance/trigger`.
  Also implements `loadHarnessSubset` — shallow-clones the project to
  read its HARNESS.json once per run
- `packages/agents/maintenance/src/index.ts`: rewritten to expose the
  new surface (`startMaintenanceScheduler`, `triggerMaintenanceRun`,
  `runMaintenanceAgent`, `loadProjectInputs`, the 4 `run*Agent`
  helpers, the 3 monitoring adapters, `resolveMonitoringAdapter`, and
  the public types)
- `packages/agents/maintenance/package.json`: added `node-cron` +
  `simple-git` runtime deps, `@types/node-cron` dev dep
- `packages/server/package.json`: added `@gestalt/agents-maintenance`
  workspace dep
- `packages/server/src/server.ts`: imports `startMaintenanceScheduler`
  and calls it as new step 9 (after the deploy worker). Startup-
  sequence comment renumbered
- `packages/server/src/routes/maintenance.ts` (new):
  `GET /maintenance/runs?projectId&agentRole&limit` (any authenticated
  user) reads the table; `POST /maintenance/trigger` (operator+) runs
  the named agent for the given project via `triggerMaintenanceRun`
  with `scopedProjectId` — same code path as the cron schedules
- `packages/server/src/app.ts`: registers the new routes
- `packages/server/src/oversight/routes.ts`: removed the aspirational
  `/maintenance/runs` + `/maintenance/trigger` throw-stubs that were
  shadowing the real handlers (Fastify rejected the duplicate
  registration on startup)
- `packages/server/src/routes/projects.ts`: harness template's
  `maintenance` section gained a `monitoring` object (`adapter: 'noop'`,
  `enabled: true`, `thresholds: {errorRatePercent: 5.0, latencyP99Ms:
  2000, alertCountWindow: '1h', alertCountThreshold: 10}`) so the
  evaluation-agent has a config to read against fresh projects
- `docs/DECISIONS.md`: appended ADR-035 covering the typed-intent
  contract, the monitoring-adapter pattern, the NoOp fallback, the
  ADR-018 drift-agent exception, and the DB-grant clarification on
  deployment_events

Verified live against `trackeros` (4 manual triggers via
`POST /maintenance/trigger`):
- alignment-agent: 5 findings → 5 maintenance intents queued; SSE
  `intent.created` fired for each with `source: 'maintenance-agent'`
  and `maintenanceType: 'CONTEXT_ALIGNMENT'`; intents picked up by the
  generate orchestrator within seconds (DB shows status flipping from
  `pending` → `generating` on multiple rows)
- gc-agent: 0 findings (no stale branches or `.gestalt/*` files)
- evaluation-agent: 0 findings in 3 ms (NoOp adapter — no metric
  breach)
- drift-agent: 0 findings (no module changes in the 30-day window
  exceeding the 7-day staleness threshold)
- `GET /maintenance/runs?limit=10` returns all 4 records with correct
  shapes (counts, durations, findings array)
- SSE `maintenance.run-completed` event fired with runId, agentRole,
  projectId, intentsQueued, directFixes, findingCount, durationMs
- DB: 5 `maintenance-agent`-sourced intents persisted with the
  expected `[gestalt-maintenance/CONTEXT_ALIGNMENT]` prefix

Decisions made:
- **Explicit `::jsonb` cast on every JSONB-array write.** Discovered
  during smoke that `findings = ${JSON.stringify(arr)}` resulted in a
  jsonb string scalar (`"[{...},{...}]"`) rather than a jsonb array,
  because postgres' implicit text→jsonb is a quote-wrap rather than a
  parse. The cast (`${JSON.stringify(arr)}::jsonb`) forces the parse.
  Documented in the file's comments
- **Defensive `parseFindings`.** postgres.js was returning the JSONB
  as a string on read despite being stored correctly. Rather than
  audit every other repo's JSONB read path (deployment_events
  metadata, audit_log metadata, signals location) — none of which
  currently fail because nothing iterates their parsed shape —
  added a normalising parser in the maintenance repo only. Apply the
  pattern to the others on demand
- **Migration 005 starts with `DROP TABLE IF EXISTS … CASCADE`.**
  `001_initial.sql` created a legacy `maintenance_runs` table with an
  incompatible schema (no project_id, no findings, no completed_at,
  NOT NULL duration_ms). No data was ever written to it; verified
  COUNT(*) = 0 before adding the DROP. Fresh installs run 001's CREATE
  then 005's DROP+CREATE (wasteful but correct); existing installs run
  005 against the legacy table and the DROP unblocks the recreate.
  Edit to 001 would only affect fresh installs — leaving it
- **Manual trigger reuses the runner.** `POST /maintenance/trigger`
  goes through `triggerMaintenanceRun({ scopedProjectId })` which is
  the same entry the cron callbacks use. Observability story is
  identical regardless of how the agent was invoked
- **Dedupe by intent text prefix, not by intent kind.** The IntentRepository
  doesn't store the maintenance type; the cleanest way to identify
  in-flight maintenance intents for a given type is the
  `[gestalt-maintenance/<type>]` prefix prepended to every dispatched
  intent text. Two list calls (one per status), filter in JS
- **Removed the old `/maintenance/runs` and `/maintenance/trigger`
  throw-stubs from `oversight/routes.ts`.** They were aspirational
  placeholders that registered before the real handlers in app.ts,
  causing Fastify to reject the duplicate. Same fix pattern as the
  pre-existing one for `/events` in routes/events.ts vs the old
  oversight stub

Build status: `pnpm -r build` clean across all 12 packages. All four
layers (generate orchestrator, gate, deploy, maintenance scheduler)
register on startup; migrations 001-005 apply on first run. Maintenance
agents exercised live; queued intents flow through the generate
orchestrator on the same code path as human-submitted intents.

---

### Session 2026-05-30 — Claude Code (docs refresh after maintenance layer)

Documentation-only pass. No code changes. Brings the **Current build
status** table and the **Current state** section in line with what is
actually shipped after the maintenance-layer commit (`62faa06`).

Changed:
- `CLAUDE.md` — **Current build status** table: dropped the `(stub)`
  qualifier from `@gestalt/agents-quality-gate` and `@gestalt/agents-deploy`.
  Both have been fully implemented end-to-end with live verification
  (constraint + LLM review for the gate, pr-agent + pipeline-agent +
  promotion-agent + 2 PipelineAdapter impls for deploy). The remaining
  `(stub)` markers on `@gestalt/adapter-oracle` and
  `@gestalt/adapter-mssql` are correct — those are genuine throw-stubs
- `CLAUDE.md` — **Current state → What is built and working**: added a
  one-line summary at the top of the bullet list explicitly stating
  all four SDLC layers (generate / gate / deploy / maintenance) are
  fully implemented end-to-end, with a pointer to the per-layer detail
  bullets that follow. Migrations bullet already covered all five
  (`001`-`005`); repo coverage already listed `deploymentEvents` and
  `maintenanceRuns`. No edits needed there
- `CLAUDE.md` — **What is not yet built** rewritten. The previous
  framing put `agents-quality-gate` / `agents-deploy` / `agents-maintenance`
  under this heading with a long "implemented (above) BUT…" caveat
  that made them read as not-built. Split into two sections:
  **Implemented with caveats** (the three layer packages — captures
  what's in and what's intentionally out per their respective briefs)
  and **What is not yet built** (just the genuine non-starts:
  `adapter-oracle`, `adapter-mssql`, `registry`)
- `CLAUDE.md` — **Pending enhancements**: removed the "Move the
  artifact push from generate-orchestrator to pr-agent" entry. That
  was resolved in commit `8f8757c` (2026-05-30 single-push deploy +
  workflow seed session); the generate orchestrator no longer mutates
  Git at all. The corresponding `What is built and working` bullet
  already documents this — pr-agent is now the sole writer

Decisions made:
- **Split "What is not yet built" into two headings** rather than
  trying to keep agent packages in one section with long caveats. The
  three layer packages are implemented and exercised; their caveats
  (stub sub-agents, missing alternate adapters) are scoped feature
  limits, not "not built". Operators reading the section want to know
  what they can't do today — `adapter-oracle` / `adapter-mssql` /
  `registry` are the honest answers
- **Kept the per-layer detail bullets unchanged** even though they
  duplicate the new top-line summary. Readers who scan only the
  summary get the high-level answer; readers who need to know which
  agent does what for debugging or onboarding still have the detail
  paragraphs in the same section
- **Did not edit the per-layer detail bullets to remove their now-
  redundant verification anecdotes** (e.g. the `8f53b75d` cycle
  description in the deploy bullet). They serve as the "is this still
  live?" reality check for future agents and shouldn't bit-rot into a
  marketing summary
- **Did not touch the session log entries above this one.** Past
  sessions are the audit trail of how the project arrived at the
  current state and remain accurate as historical records — there is
  no value in retro-editing them. New sessions append

Build status: no code changes; build state from the previous
`62faa06` commit is unchanged. `pnpm -r build` would still pass.

---

### Session 2026-05-30 — Claude Code (GitHub Actions adapter hardening + live verification)

Audited the `GitHubActionsAdapter` for the bugs flagged in the brief —
race condition in `triggerPipeline`, single-shot run discovery, and the
missing PAT-scope error path — then verified the full deploy chain
against a real GitHub repo with a real PAT.

Changed:
- `packages/agents/deploy/src/adapters/pipeline-adapter.ts`: new
  `PipelineAdapterAuthError` class. Typed marker for "PAT lacks
  required scope" so the deploy-orchestrator can distinguish a
  configuration error (escalate, never retry) from a transient adapter
  failure (mark `failed`). Carries `adapter` + `operation` for the
  signal message
- `packages/agents/deploy/src/adapters/github-actions-adapter.ts`:
  - **`triggerPipeline` rewritten.** Captures `dispatchedAt` BEFORE the
    `workflow_dispatch` call. After dispatch, waits 3 s then retries up
    to 10 times with 2 s intervals (~23 s total) for the run to appear.
    Each attempt calls a new `findDispatchedRun(branch, dispatchedAt)`
    helper that queries
    `GET /actions/runs?branch=<branch>&event=workflow_dispatch&per_page=10`,
    filters to runs created at-or-after `dispatchedAt - 2s` (clock skew
    tolerance), sorts by `created_at` desc, and returns the most recent
    match. Stops `runs[0]`-style false positives from concurrent runs
    on the same branch
  - **`createPullRequest` / `getPipelineStatus` / `promoteToEnvironment`
    all detect missing-scope 403s.** New `throwIfAuthError(status,
    body, operation, requiredScope)` helper checks for HTTP 403 + body
    containing `"Resource not accessible"` (GitHub's marker for both
    "by personal access token" and "by integration" variants) and
    throws `PipelineAdapterAuthError` instead of a generic error
  - **Status mapping verified — unchanged.** `status !== 'completed'` →
    `'running'`; `'success'` → `'passed'`; `'cancelled'` → `'cancelled'`;
    everything else → `'failed'`. Matches the brief and GitHub's
    documented `status`/`conclusion` shapes
  - **`promoteToEnvironment` cleaned up.** Stopped sending the
    synthesised `gestalt/promote-<corr8>` branch input (the branch
    didn't exist anywhere); now sends `environment` +
    `correlationId` only. `ref` stays `main` because the platform
    only promotes after a merged PR, by which point the artifact set
    is on the default branch
- `packages/agents/deploy/src/orchestrator/deploy-orchestrator.ts`:
  - Imports the new error class
  - Catch block now does `instanceof PipelineAdapterAuthError` first —
    if matched, saves a `GOLDEN_PRINCIPLE_BREACH` signal (severity
    `critical`, message from the adapter), emits `signal.emitted` SSE,
    and transitions the intent to `escalated`. Returns a `failed` task
    result so BullMQ does not retry. Generic errors retain the previous
    `failed` transition + rethrow
  - New `escalateAuthError()` helper maps `taskType` →
    `DeployAgentRole` (`deploy:pr` → `pr-agent`, etc.) for the
    `sourceAgent` field, satisfying the `AgentRole` union
- `packages/agents/deploy/src/index.ts`: re-exports
  `PipelineAdapterAuthError`
- `packages/server/src/routes/projects.ts`:
  - New `POST /projects/:id/config` route (`requireRole('operator')`).
    Accepts `{ pipeline?: { adapter?: string } }`. Validates against
    a `VALID_PIPELINE_ADAPTERS` whitelist (`noop`, `github-actions`).
    Clones the project repo, reads + parses `HARNESS.json`, mutates
    `pipeline.adapter`, writes the file back, commits as
    `chore: update pipeline adapter to <adapter> [gestalt]`, pushes
    to the default branch. Returns `{ updated: true, adapter,
    commitSha }`. Short-circuit `{ updated: false, reason: 'no-change' }`
    when the file already has the requested adapter. Temp dir cleaned
    in `finally`. Audit-logs `project.config-updated` with previous +
    new values
  - `buildAgentsMd()` extended with an **"Operator notes — Git
    credential scopes"** section documenting the PAT scope requirements
    for GitHub (classic + fine-grained) / GitLab / Azure DevOps and
    explaining that missing the `workflow` scope produces a
    `GOLDEN_PRINCIPLE_BREACH` + escalation
- `packages/cli/src/api/client.ts`: new `updateProjectConfig(projectId,
  config)` typed wrapper for the new route
- `packages/cli/src/commands/projects.ts`: new `setAdapterCommand(name,
  adapter)`. Client-side adapter whitelist (mirrors the server's) so
  typos fail fast before the network round-trip. Resolves project ID
  by name (consistent with `projects use`), prints commit SHA on
  success, reminds the operator to `git pull` to receive the
  HARNESS.json update locally
- `packages/cli/src/index.ts`: registered
  `gestalt projects set-adapter <name> <adapter>`. Updated the
  command list at the top of the file
- `docs/guides/quick-start.md`: Step 7 rewritten — the PAT-scope
  requirements (repo + workflow for GitHub, fine-grained equivalents,
  GitLab, Azure DevOps) now appear inline. Added the new
  `set-adapter` command to the Summary table
- `docs/guides/deployment.md`: new **Step 10 — Connect to your CI/CD
  system (optional)** that links to the GitHub Actions guide and notes
  the planned-but-not-built status of the other adapters
- `docs/guides/ci-cd/github-actions.md` (new): the standalone GitHub
  Actions integration guide. Covers PAT scope creation (classic +
  fine-grained), the project-repo prerequisites (lockfile + test
  script + workflow file), the `gestalt projects set-adapter`
  command, how to verify the integration end-to-end against
  `deployment_events` + the GitHub Actions tab, and a troubleshooting
  section for the auth-error signal, missing workflow file, lingering
  NoOp adapter, and 10-minute polling timeout

Verified live against `trackeros`:
- Fresh `docker-compose up -d --build` (volumes recreated, no prior
  data). Migrations 001–005 applied on first start; server reaches
  `Up (healthy)`; `/health` returns 200
- Admin created via `POST /auth/admin/setup`; login token persisted
  to `~/.gestalt/config.json`
- Registered `trackeros` via `POST /projects` with a real GitHub PAT
  (`ghp_…145klzw`). The token never appears in logs or responses —
  `/projects` and `/projects/:id` strip credentials by design via
  `toPublic()`
- `POST /projects/<id>/init-harness` cloned, wrote the harness
  (including `.github/workflows/gestalt.yml`), pushed
  `a77b0517` to `main`
- Manually committed a minimal `package.json` (with
  `"test": "echo \"no tests yet\" && exit 0"`) + `pnpm-lock.yaml` so
  the workflow's `pnpm install --frozen-lockfile && pnpm test` step
  has something to run. Commit `e614760`
- `gestalt projects set-adapter trackeros github-actions` — the new
  CLI command. The route cloned the repo, flipped
  `pipeline.adapter` from `noop` to `github-actions` in
  `HARNESS.json`, committed `37e91f31` (commit subject:
  `chore: update pipeline adapter to github-actions [gestalt]`),
  pushed to `main`. `git pull` locally confirmed the file content
- Submitted intent "Add a kebab-case utility under
  src/shared/utils/kebab-case with kebabCase(s: string): string"
- Correlation id `67e5ee02-a325-4a6d-b554-92d03856690a`
- Full cycle: generate 12 s → gate 1 s → deploy 30 s. Intent →
  `deployed` in 49 s wall-clock
- `agent_executions`: 12 rows, all green or skipped as expected:
  intent (4.0 s) / design (1.6 s) / context (0.7 s) / lint-config
  (skipped) / code (1.3 s) / test (4.4 s) / constraint (3 ms) / review
  (0.9 s) / pr-agent (4.6 s) / pipeline-agent (21.0 s) / promotion
  staging (1.8 s) / promotion production (1.8 s)
- `deployment_events`: 5 rows in order — `pr-opened` (PR #1),
  `pipeline-triggered` (runId `26689527360`), `pipeline-passed`
  (same runId, 16 s after trigger), `promoted-staging`,
  `promoted-production`
- **GitHub side confirmed via REST API.** PR
  `https://github.com/afarahat-lab/trackeros/pull/1` is open against
  `main`, head branch
  `gestalt/67e5ee02-add-a-kebab-case-utility-under`, title
  `Add a kebab-case utility under src/shared/utils/kebab-case with kebab...`.
  Workflow run `26689527360` shows `status: completed`,
  `conclusion: success`, `event: workflow_dispatch`, html_url
  `https://github.com/afarahat-lab/trackeros/actions/runs/26689527360`.
  This is the first time a Gestalt cycle has driven a real CI run
  end-to-end

Decisions made:
- **PAT-scope error becomes a typed `PipelineAdapterAuthError`, not a
  return value.** Auth errors can happen at any adapter call; making
  the agent return signatures wear an `auth-error` kind would force
  three different shape changes (pr-agent returns plain on success,
  pipeline-agent returns a result with outcome union, promotion-agent
  same as pipeline). A typed throw at the adapter + a single
  `instanceof` catch in the orchestrator concentrates the handling and
  leaves the agent contracts alone
- **PAT-scope error is GOLDEN_PRINCIPLE_BREACH, not CONSTRAINT_VIOLATION
  / CONTEXT_GAP.** The signal explicitly tells the operator the system
  cannot proceed and what change to make. No retry will fix it — same
  shape as ADR-034's "production without staging" enforcement. Mapping
  to GP_BREACH plus `escalated` status ensures the human-only
  resolution path
- **Detection signature is the `'Resource not accessible'` substring.**
  GitHub returns two near-identical 403 bodies for missing scopes
  (`"Resource not accessible by personal access token"` for classic
  PATs and `"Resource not accessible by integration"` for fine-grained
  /  apps). Substring match covers both without parsing the JSON or
  caring about apostrophes / casing changes
- **`triggerPipeline` retry budget is 3 s + 10×2 s.** Picked to cover
  the GitHub run-creation latency we observe in practice (1–4 s) with
  generous headroom while staying inside the 60 s BullMQ worker
  default. If the run never appears within ~23 s, the dispatch
  probably failed silently (rare but possible if the workflow file is
  malformed) — we throw with a clear message and let the orchestrator
  fail the intent
- **`set-adapter` validation lives both client-side and server-side.**
  The CLI rejects bad adapter names before the network call (fast
  failure for operator typos) and the server re-validates in case the
  route is called from somewhere other than the CLI. Both lists are
  the same hardcoded `['noop', 'github-actions']` for now — when a new
  adapter ships, both edits will be needed
- **`set-adapter` commits HARNESS.json straight to the default
  branch.** Same model as `init-harness`. This is configuration of the
  platform-controlled file; opening a PR for the operator to review
  would defeat the purpose of a CLI command. The audit-log entry
  captures who-when-what for accountability
- **Set the `branch` input on the trigger dispatch.** The harness
  template's `gestalt.yml` declares a `branch` input; previously the
  adapter only sent `correlationId` + `environment` and the workflow
  saw an empty `branch`. Sending the PR branch makes the workflow's
  branch input usable for projects that customise the workflow (e.g.,
  to comment on the PR with build status)
- **Did NOT extend the existing `/projects/:id/config` route to
  monitoring / qualityGate fields.** Out of scope for this session;
  the body shape is generic (`{ pipeline?: ... }`) so monitoring +
  qualityGate fields can be added without changing the API surface.
  When they're added, the adapter whitelist pattern carries over

Build status: `pnpm -r build` clean across all 12 packages. Full
SDLC slice — generate → gate → deploy → real GitHub Actions run →
staging promote → production promote → `deployed` — verified live
in 49 s wall-clock. PR open and visible; CI run visible in the
Actions tab. The GitHub PAT used for verification
(`ghp_…145klzw`) was scoped `repo` + `workflow` and is now stored in
`project_git_credentials` for project `a5ed81a5-…`. **Operator
action:** rotate or revoke this PAT after the session per standard
hygiene; the next `gestalt init` or a re-run of `POST /projects` (the
PAT is captured per-project, not at the user level) will pick up the
replacement.

Follow-ups added to Pending enhancements:
- **`set-adapter` for monitoring + qualityGate fields.** The route
  body is generic, but only `pipeline.adapter` is validated +
  applied today. Same pattern (whitelist + clone-edit-commit) will
  cover the maintenance monitoring adapter and the
  `qualityGate.maxRetries` field once they need to be operator-
  settable
- **Promotion workflow `ref` is hardcoded to `'main'`.** Projects
  whose default branch is not `main` (e.g., `master`, `trunk`) will
  see promotion dispatches against a non-existent ref. Read
  `project.defaultBranch` through to the promotion-agent and forward
  it via the adapter call
- **Adapter resolver does not yet validate the PAT proactively.** A
  PAT missing `workflow` scope only fails on the first dispatch. A
  startup-time `GET /user` or `GET /repos/:o/:r` check could surface
  the misconfiguration to the operator at `gestalt init` /
  `set-adapter` time, before any cycle starts
