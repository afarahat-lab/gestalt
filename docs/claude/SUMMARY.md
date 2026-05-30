# SUMMARY.md — design-chat handoff

_Paste this file into the design chat when returning for architecture
discussions. It is the current platform state plus the last three session
entries so the design chat sees both where the platform stands and how it
got here recently._

_Regenerate after every session that updates `STATE.md` / `SESSION_LOG.md`.
Source of truth: those two files. Do not edit `SUMMARY.md` by hand — its
content is derived._

---


## Current state (keep this section current)

**Last updated:** 2026-05-30 (Claude Code — split CLAUDE.md into docs/claude/; platform capabilities unchanged)

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


---

## Recent session log entries (last 3 from SESSION_LOG.md)

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

---

### Session 2026-05-30 — Claude Code (CLAUDE.md split into docs/claude/)

Documentation-only pass. No code changes, no platform-capability
changes. The root `CLAUDE.md` had grown to 97k characters / 1796 lines
and was triggering Claude Code's large-file performance warning.
Split the file along the section boundaries the brief specified,
using the `@path/to/file` import syntax so Claude Code still loads
the full body on session start.

Changed:
- `CLAUDE.md` (root): rewritten as a 24-line index. Six `@` imports
  point at the new sub-files. Kept only the **Before doing anything**
  and **After every session — mandatory** instructions, since those
  are routing-level guidance that needs to be in the entry-point
  file. The mandatory-session-log instruction was updated to direct
  appends to `docs/claude/SESSION_LOG.md` instead of the root file
- `docs/claude/PLATFORM.md` (new): the "What this project is",
  "Monorepo structure", and "Package dependency order" sections,
  verbatim
- `docs/claude/BUILD.md` (new): "How to run builds" + the "Current
  build status" package table + "Key type alignment rules" +
  "Known issues to resolve", verbatim
- `docs/claude/CONSTRAINTS.md` (new): "Critical constraints" + "What
  to do if context is missing" + "Known architectural constraints
  Claude Code must respect" (lifted out of the old **Current state**
  block where it lived as a subsection). The "Architecture decisions
  to respect" bullet list does NOT appear here — to satisfy the
  brief's "every line appears in exactly one file" rule, the bullets
  live in `DECISIONS.md` and `CONSTRAINTS.md` carries only a pointer
  to that file
- `docs/claude/DECISIONS.md` (new): the original "Architecture
  decisions to respect" bullet list verbatim at the top, followed by
  a 2–3 line expanded summary of each ADR (002, 003, 004, 006, 007,
  025, 026, 032, 033, 034, 035). Each summary leads with the rule,
  then an *Implication* line that names the concrete coding behaviour
  Claude Code should adopt. This is the only file with net-new prose
  — about 5KB of expansion beyond what was in the original CLAUDE.md
- `docs/claude/STATE.md` (new): the entire "Current state" block —
  "What is built and working" / "Implemented with caveats" / "What
  is not yet built" / postgres coverage table / "CLI install" /
  "First-boot sequence" / "Pending enhancements". The "Known
  architectural constraints Claude Code must respect" subsection
  (which had lived inside Current state) was lifted out and moved to
  `CONSTRAINTS.md`; everything else preserved verbatim
- `docs/claude/SESSION_LOG.md` (new): the entire "Session log"
  section — the format-instruction header + every historical entry
  (2026-05-28 CLI install fix through this 2026-05-30 split entry).
  The format header was rewritten to direct future appends to
  `docs/claude/SESSION_LOG.md` instead of the root file

Verified:
- Pre-split: 1 file × 97,148 chars / 1796 lines
- Post-split: 7 files × 103,146 chars / 1914 lines (root + 6 sub-files)
- Delta is +5,998 chars / +118 lines — accounted for by the new
  per-file headings/dividers (~700 chars total) and the DECISIONS.md
  expanded ADR summaries (~5,300 chars). Confirmed via spot-grep that
  every distinctive marker from the original (intro line, section
  headings, every session entry's date+title, the Last-updated line)
  appears in exactly the expected new file
- Largest single file now is `SESSION_LOG.md` at 68,454 chars — under
  the 80,000-char performance threshold. Other files are all under
  20KB
- `@docs/claude/<name>.md` import lines use the exact path syntax
  (no Markdown link wrapping)
- No source code touched; `pnpm -r build` state unchanged

Decisions made:
- **"Architecture decisions to respect" lives in `DECISIONS.md`
  only, not duplicated in `CONSTRAINTS.md`.** The brief's wording
  ("every line appears in exactly one file") and the listing under
  CONSTRAINTS were in tension. Chose the no-duplication interpretation
  and added a short pointer in CONSTRAINTS.md so a reader scanning
  for "what ADRs constrain me" finds DECISIONS.md immediately
- **DECISIONS.md keeps the original bullet list verbatim at the top
  THEN adds the 2-3 line summaries below.** Preserves the original
  text (so future agents can find it via grep) and the brief's
  expansion requirement, without duplicating between the two views.
  Each summary ends with an explicit *Implication:* line because
  Claude Code's job is to apply the ADRs, not just recall them
- **Did not rewrite or trim historical session entries** when moving
  them into SESSION_LOG.md. Past sessions are the audit trail of how
  the project arrived at the current state — bit-rotting them into
  summaries would lose verification anecdotes (`8f53b75d` cycle
  details, etc.) that are useful for debugging
- **Did not move per-package documentation hints** (the package
  README.md references) out of `CLAUDE.md`'s "Before doing anything"
  block. That guidance is workflow-level and belongs in the entry
  file alongside the imports

Build status: no source files changed. `pnpm -r build` clean state
from the previous commit (`6b3307a`) is unchanged. This is a
documentation-only reorganisation.

Follow-up in the same session — `SUMMARY.md` for the design chat:
- `docs/claude/SUMMARY.md` (new): not loaded by Claude Code; intended
  for the platform owner to paste into the design chat when returning
  for architecture discussions. Contains the full `STATE.md` body
  followed by the last three entries from `SESSION_LOG.md`. Header
  block flags it as derived — do not edit by hand. Current size
  ~42 KB
- `CLAUDE.md` (root): the **After every session — mandatory**
  section is now a 3-step list:
  1. Append entry to `docs/claude/SESSION_LOG.md`
  2. Update `docs/claude/STATE.md`
  3. Regenerate `docs/claude/SUMMARY.md`
- `SUMMARY.md` is NOT in the root CLAUDE.md `@` import list. Pulling
  ~42 KB of duplicated state + session content into every Claude Code
  session would defeat the point of the split (and inflate the
  large-file warning back); the design chat is the only consumer

Decisions made:
- **`SUMMARY.md` is regenerated, not hand-edited.** The header block
  says so explicitly and the `tail -n +8 STATE.md` + `sed -n '<last3-
  start>,$p' SESSION_LOG.md` recipe in this entry serves as the
  regeneration script. A small `pnpm` task or shell script for it is
  an obvious follow-up but not added in this session (one-shot
  command is fine for now)
- **`SUMMARY.md` lives in `docs/claude/` alongside the source files
  it derives from.** Considered `docs/design-chat-summary.md` or a
  top-level path but co-locating with the inputs makes the
  regeneration step obvious from the directory layout

