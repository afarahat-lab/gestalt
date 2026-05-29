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
| `@gestalt/agents-quality-gate` | ✅ compiles (stub) |
| `@gestalt/agents-deploy` | ✅ compiles (stub) |
| `@gestalt/agents-maintenance` | ✅ compiles (stub) |
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

**Last updated:** 2026-05-29 (Claude Code — gate ↔ generate feedback loop)

**Repo:** https://github.com/afarahat-lab/gestalt

**What is built and working:**
- All 8 architecture layers fully designed and documented
- All 12 buildable workspace packages compile clean (`pnpm -r build`)
- `docker-compose up -d` succeeds — server, postgres, redis all `Up (healthy)`
- All three migrations apply on startup: `001_initial`, `002_local_auth`,
  `003_projects`
- Server reachable on http://localhost:3000 — `/health` returns 200
- Auth middleware active — protected routes return 401
- First-boot bootstrap verified end-to-end: `gestalt init-admin` creates
  admin + JWT; `gestalt login` authenticates; `GET /auth/me` returns user
- `gestalt init` fully implemented — Git-backed four-phase wizard:
  registers project on server, server clones repo, commits harness files,
  pushes; developer runs `git pull` to receive harness locally
- `gestalt projects list` and `gestalt projects use <name>` working
- `gestalt run` queues intent → orchestrator picks up → clones project
  repo fresh per cycle → runs generate loop against cloned harness files
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

**What is not yet built:**
- `@gestalt/agents-quality-gate` — constraint-agent + llm-review-agent +
  gate orchestrator implemented (above). lint-agent / security-agent /
  test-runner-agent still stubs (need pnpm-install-in-clone pipeline);
  no feedback-loop-back-to-generate yet (failed verdicts mark the intent
  `failed` instead of dispatching a regenerate)
- `@gestalt/agents-deploy` — stubs only
- `@gestalt/agents-maintenance` — stubs only
- `@gestalt/adapter-oracle` — stub (builds, ProjectRepository throws)
- `@gestalt/adapter-mssql` — stub (builds, ProjectRepository throws)
- `@gestalt/registry` — types and client only

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
- **Move the artifact push from generate-orchestrator to pr-agent.**
  Per the original design, the orchestrator hands an in-memory artifact
  set to the deploy-layer pr-agent, which opens a PR rather than pushing
  to `defaultBranch`. The orchestrator currently pushes straight to
  `defaultBranch` because pr-agent does not exist yet. When pr-agent
  lands, move the commit/push logic there and have the orchestrator
  pass artifacts via the gate handoff
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
- **Real-tooling gate agents** (typecheck via `tsc`, lint via ESLint,
  tests via `vitest`). Each needs the project's deps installed in the
  cloned tree — likely a `pnpm install --frozen-lockfile` step before
  the agents run, with the install output cached
- Deploy and maintenance agent full implementations + workers wired
  into server startup (same pattern as `startOrchestratorWorker` and
  `startGateWorker`)

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
