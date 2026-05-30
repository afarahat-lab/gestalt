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

**Last updated:** 2026-05-30 (Claude Code — SPA mounted under /app/* for shareable deep links)

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
- **Dashboard SPA reachable in the browser, deep-linkable, no path
  collisions with the API.** `gestalt dashboard` opens
  `<serverUrl>/app/`; the server serves the React SPA from
  `packages/dashboard/dist/` via `fastify-static` mounted at the
  `/app/` prefix. Vite is built with `base: '/app/'` so asset URLs in
  the built `index.html` reference `/app/assets/<hash>.{js,css}`.
  React Router uses `<BrowserRouter basename="/app">`, so every
  `navigate('/intents/${id}')` inside the SPA resolves to
  `/app/intents/${id}` in the URL bar. The API still owns the root
  and bare paths (`/intents/:id`, `/alerts`, etc.) — the URL spaces
  are now fully disjoint, which means **dashboard URLs are
  shareable**: copy from the address bar, paste in a new tab, and
  the dashboard loads that exact view (RequireAuth bounces to
  `/app/login` if no token, otherwise renders the deep-linked
  component). The auth preHandler bypasses GET requests under
  `/app/*` only; non-GET methods always require auth. The bare
  server URL (`/`) issues a 302 redirect to `/app/` for convenience.
  The not-found handler is the SPA fallback only for `/app/*` GETs;
  any other unknown GET (e.g. a typo at `/intnts`) returns 404 JSON
  instead of silently serving the SPA shell (whose asset refs would
  break)
- First-boot bootstrap verified end-to-end: `gestalt init-admin` creates
  admin + JWT; `gestalt login` authenticates; `GET /auth/me` returns user
- **CLI server URL is fully configurable.** `gestalt config show` /
  `gestalt config set-server <url>` / `gestalt config reset` let
  operators inspect and change `~/.gestalt/config.json` without going
  through the auth flow. Every CLI command that contacts the server
  (`login`, `init`, `init-admin`, `run`, `status`, `logs`,
  `dashboard`, `projects list|use|set-adapter`) accepts an optional
  `--server <url>` flag — one-shot override on all of them; only
  `login` and `init-admin` persist the URL to config on success
  (those are the bootstrap commands). All commands route URL
  selection through one helper (`resolveServerUrl`); no remaining
  direct `config.serverUrl` reads in command files. `gestalt status`
  prints the active server URL in its header
  (`Gestalt — http://localhost:3000`). Every connectivity failure
  surfaces the attempted URL through a shared formatter and, when
  the URL is still the local-dev default
  (`http://localhost:3000`), adds a first-run hint nudging the user
  to `gestalt config set-server` + `gestalt login`. URL validation
  (`http://` or `https://` only, trailing slash stripped) lives in
  `normaliseServerUrl`. `gestalt config show` never prints the token
  itself — only `set` / `not set`
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
- **Return-URL preservation across login.** Pasting `/app/intents/<id>`
  in a fresh tab today bounces to `/app/login` and after sign-in
  lands on `/app/` (the intent ID is dropped). Small SPA-only change —
  `useLocation()` + `?from=` query param in the `RequireAuth` Navigate
  and the Login view's post-success `navigate(...)`. ~10 minutes
- **Vite dev-server proxy `/api` entry is dead.** The proxy in
  `packages/dashboard/vite.config.ts` forwards `/api → localhost:3000`
  but the server has no routes under `/api`. Pre-existing dead
  config; remove on the next dashboard-config touch
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

### Session 2026-05-30 — Claude Code (configurable server URL across the CLI)

Closes the most common production misconfiguration: the CLI defaults to
`http://localhost:3000` but the server lives on a remote host
(`https://gestalt.company.com`). Every CLI command now reads the URL
through one helper, accepts a `--server` one-shot override, and shows
the attempted URL on connectivity failure. A new `gestalt config`
parent command lets operators inspect and change the persisted URL
without going through the auth flow.

Changed:
- `packages/cli/src/ui/config.ts`:
  - New `resolveServerUrl(options, config)` helper — single source of
    truth for "which URL does this invocation talk to". `options.server`
    (the `--server` flag) wins; otherwise falls back to
    `config.serverUrl`. Every command imports this; no `config.serverUrl`
    direct reads remain in command bodies after the change
  - New `normaliseServerUrl(input)` — trims trailing slashes, validates
    `http://` / `https://` prefix, throws a clear `Error` on bad input.
    Used by `config set-server`
  - New `isDefaultServerUrl(url)` — flags whether the active URL is
    still `DEFAULT_CLI_CONFIG.serverUrl`. Drives the first-run hint
- `packages/cli/src/ui/server-errors.ts` (new): shared
  `printConnectionError(url)` formatter. Always echoes the attempted
  URL; when the URL is the local-dev default, appends the first-run
  hint nudging the operator to `gestalt config set-server` then
  `gestalt login`. Also exports `isConnectivityError(err)` — heuristic
  that distinguishes a reachable server returning an HTTP error
  (`ApiClientError`, presented verbatim) from an unreachable server
  (`ECONNREFUSED`, `ENOTFOUND`, etc., routed through the formatter)
- `packages/cli/src/commands/config.ts` (new): three subcommands —
  - `gestalt config show` — prints `serverUrl`, `currentProjectId`,
    and `token: set | not set`. The token value itself is NEVER
    printed; only its presence
  - `gestalt config set-server <url>` — validates via
    `normaliseServerUrl`, persists via `updateCliConfig`. Auth-free
  - `gestalt config reset` — prompts `y/N`, then writes
    `DEFAULT_CLI_CONFIG` via `saveCliConfig` so previously persisted
    fields are dropped, not just nulled. Aborts cleanly on `N`
- `packages/cli/src/commands/{login,init-admin,init,run,status,logs,
  projects}.ts`: every command threaded through `resolveServerUrl(...)`.
  Every API client constructor now reads from the resolved URL instead
  of `config.serverUrl`. Connectivity errors route through
  `printConnectionError(serverUrl)` for a consistent presentation
- `packages/cli/src/commands/status.ts`: the platform-status path now
  starts with a header line `Gestalt — <serverUrl>`, so operators can
  see at a glance which server they're talking to. Same idea as
  psql's connection prompt
- `packages/cli/src/commands/logs.ts`: `dashboardCommand()` also
  accepts a `--server` override (it opens the dashboard URL in a
  browser; a remote operator wants the remote URL, not localhost)
- `packages/cli/src/commands/login.ts` + `init-admin.ts`: persist
  `serverUrl` on success (these are the bootstrap commands). Every
  other command treats `--server` as one-shot only — no write-through.
  Both fail through the new connection-error formatter
- `packages/cli/src/index.ts`: new `gestalt config` parent +
  three subcommands. `--server <url>` flag added to every command
  that talks to the server. Updated top-of-file command list and
  added a paragraph documenting the persist-on-bootstrap-only rule.
  Defaults removed from `--server` declarations so commander forwards
  `undefined` to the command, letting `resolveServerUrl` distinguish
  "no flag" from "flag with the default value"
- `packages/cli/src/types.ts`: `RunOptions` gained `server?: string`
  so `--server` propagates through the same shape every other command
  uses
- `docs/guides/quick-start.md` Step 6 rewritten to show all three sign-in
  flows (local-only / `config set-server` + login / `login --server …`)
  with a note that the URL persists to `~/.gestalt/config.json`. The
  Summary table gained `gestalt config show` / `set-server` / `reset`
- `docs/runbooks/common-issues.md`: new entry **"CLI connects to wrong
  server / localhost instead of remote"** under CLI issues —
  symptom, cause, resolution (`config show` then `config set-server`),
  plus the `gestalt status` header trick for spot-checking the active
  server URL

Verified live:
- `pnpm --filter @gestalt/cli build` clean; `pnpm -r build` clean
  across all 12 packages
- `gestalt config show` against a fresh HOME prints the default
  config with `token: not set`
- `gestalt config set-server https://gestalt.company.com` → `✓
  Server URL set to https://gestalt.company.com`. Trailing slash is
  stripped (`https://gestalt.company.com/` normalises to the same
  result). `ftp://nope` rejected with `Server URL must start with
  http:// or https://`
- `gestalt config show` after the set call confirms the new
  `serverUrl`. Token still `not set`
- `gestalt login --server http://127.0.0.1:65530` (deliberate
  unreachable port) prints the new formatter output exactly:
  ```
  ✗ Cannot reach server at http://127.0.0.1:65530
    Check the server is running and the URL is correct.
    Current server: http://127.0.0.1:65530
    To change: gestalt config set-server <url>
  ```
  No persisted config change after the failure
- Direct call to `printConnectionError('http://localhost:3000')`
  appends the first-run hint:
  ```
    If your Gestalt server is running on a different machine, set the URL first:
      gestalt config set-server https://gestalt.company.com
      gestalt login
  ```
  Direct call against `https://gestalt.company.com` does NOT append
  the hint (correct: the URL is no longer the default)
- `gestalt status` against the running local platform prints the
  header `Gestalt — http://localhost:3000` followed by the existing
  active-agents and recent-intents output
- `gestalt status --server http://127.0.0.1:3000` prints
  `Gestalt — http://127.0.0.1:3000` for the single invocation; the
  persisted `serverUrl` in `~/.gestalt/config.json` stays at
  `http://localhost:3000` (one-shot non-persistence confirmed)

Decisions made:
- **`login` and `init-admin` persist `--server`; everything else
  doesn't.** The brief's exception was only `login`, but
  `init-admin` is the same kind of bootstrap command — it
  presupposes you have NO config yet and want it pinned to this
  server. Persisting on both keeps the bootstrap UX consistent. Every
  non-auth command stays one-shot per the brief
- **Connectivity heuristic by `Error.name === 'ApiClientError'` and
  errno code, not URL-class introspection.** `ApiClientError` is
  thrown for any non-2xx HTTP response — that's a reachable server
  with an error, not a connectivity problem. Anything raised by
  `fetch` itself (DNS, refused connection, TLS, timeout) sets a
  recognisable errno code on `err.code` or `err.cause.code`. We
  fall back to a regex on the message text to cover environments
  where the codes aren't exposed
- **`config show` prints `token: set | not set`, never the value.**
  The brief required this; reinforced by GP-004 (no sensitive data
  in logs). The constant is the field name only — the actual JWT
  never crosses the terminal even on a verbose user dump
- **`config reset` confirms with `y/N`, defaults to NO.** The
  operation is destructive (signs the user out, clears their
  current project, restores the local-dev default URL). A bare
  Enter cancels — same shape as `rm -i` and `git reset --hard`
  guards
- **`init` got `--server` as a one-shot too**, even though it
  requires an existing token. The use case: an operator with a
  saved token for `https://gestalt.company.com` wants to register
  a project against a *staging* instance at
  `https://gestalt-staging.company.com` — `--server` lets them do
  that for one invocation. The existing token still goes into the
  Authorization header; if the staging server rejects it that's a
  surfaced 401, not a connectivity error
- **Status header lives in `showPlatformStatus`, not
  `showIntentDetail`.** Intent detail is invoked with a specific
  correlationId — the operator already knows which server holds
  that intent because they got the id from somewhere. The
  platform-status flow is the one operators reach for when
  something feels off, so that's the right place to spotlight
  which server we're hitting
- **`isConnectivityError` lives in `server-errors.ts`, not
  `api/client.ts`.** Originally it was inline in `run.ts`. Moved
  to the shared module so every command checks the same heuristic
  and updates land in one place if the fetch error shapes change

Build status: `pnpm -r build` clean across all 12 packages. CLI
manually exercised against a real running platform (admin login,
status, config show / set-server / reset, `--server` one-shot
override against the platform on `127.0.0.1`). The platform-side
endpoints are unchanged — this is entirely a CLI concern as the
brief stated.

---

### Session 2026-05-30 — Claude Code (dashboard login page reachable + SPA fallback fix)

Bug report from the operator: running `gestalt dashboard` opened a
browser tab to `http://localhost:3000` which returned
`{"error":"Authentication required"}` as JSON. No login page.

Root cause was two separate bugs in the server stack:

1. **Auth `preHandler` blocked every URL, including dashboard assets.**
   The middleware compared the requested route key against a hard
   `PUBLIC_ROUTES` set; everything else returned 401. `/`,
   `/login`, `/assets/index-*.js`, `/agents`, `/gate` — all 401. The
   browser never received `index.html`, so the React SPA never booted
   to render its own `Login` view
2. **`setNotFoundHandler` called `reply.sendFile('index.html')` while
   the static plugin was registered with `decorateReply: false`.** That
   option disables the `sendFile` helper, so the SPA fallback handler
   threw `TypeError: reply.sendFile is not a function` for every path
   that fell through to the fallback (including legitimate dashboard
   client-side routes like `/login`)

Changed:
- `packages/server/src/auth/middleware.ts`:
  - New `API_PATH_PREFIXES` list — `/auth`, `/admin`, `/health`,
    `/status`, `/intents`, `/projects`, `/maintenance`, `/events`,
    `/alerts`, `/interventions`. Mirrors the actual API surface
    registered by the route plugins
  - New `isApiPath(url)` helper — strips the query string, then
    matches against the prefix list
  - `preHandler` rewritten to bypass auth when
    `request.method === 'GET' && !isApiPath(request.url)`. SPA paths
    and static assets reach `fastify-static` / the SPA fallback
    without auth; non-GET methods to non-API paths still get
    rejected (a stray write should never land in the SPA bucket)
- `packages/server/src/app.ts`:
  - Removed `decorateReply: false` from the `fastify-static`
    registration so `reply.sendFile()` is available to the fallback
  - SPA fallback in `setNotFoundHandler` now guards on method —
    `GET` falls through to `index.html`, everything else returns
    a 404 JSON

Verified live:
- `pnpm --filter @gestalt/server build` clean
- `docker-compose up -d --build server` healthy
- `curl http://localhost:3000/` → `200 text/html` (the SPA HTML;
  693 bytes — only the empty shell, the asset URLs are filled in
  client-side by Vite)
- `curl http://localhost:3000/login` → `200 text/html` (SPA fallback
  serving `index.html`)
- `curl http://localhost:3000/agents` → `200 text/html`
- `curl http://localhost:3000/assets/index-<hash>.js` →
  `200 application/javascript; 198,685 bytes` (static plugin serves
  the real bundle)
- `curl http://localhost:3000/assets/index-<hash>.css` →
  `200 text/css; 1,770 bytes`
- `curl http://localhost:3000/intents` → `401 application/json`
  (API auth still enforced)
- `curl -X POST http://localhost:3000/intents` → `401`
  (write-side auth still enforced)
- `curl -X POST http://localhost:3000/` → `401` (correct — non-GET
  to a non-API path still falls under auth, not the SPA fallback)
- `gestalt dashboard` opens `http://localhost:3000`; the SPA boots,
  `RequireAuth` sees no token in localStorage and redirects to
  `/login` where the existing `Login` view renders. Operators can
  now sign in via the dashboard

Decisions made:
- **Path-prefix split, not Accept-header sniffing.** Considered
  `Accept: text/html`-based routing (browser vs API), but Fastify
  routes the registered API handler before the static plugin no
  matter what `Accept` is — the Accept check would only matter for
  unmatched paths, which is exactly where prefix matching already
  works. Prefix matching is also explicit and grep-able
- **Bypass applies to GET only.** A POST to `/` could otherwise
  silently succeed via the SPA fallback (returning `index.html` as
  the response body); guarded that in the fallback handler too,
  belt-and-braces. The `isApiPath` check in middleware blocks the
  preHandler from skipping for non-GET methods regardless
- **Did NOT move the dashboard under a `/dashboard/*` prefix.** The
  obvious "real" fix to the SPA-vs-API collision at `/intents/:id`
  and `/alerts` is a path-prefix move, but that requires changing
  Vite's `base`, the SPA's `<base href>`, every `<Link to=...>` in
  the codebase, and the CLI's dashboard URL. Out of scope for a
  bug-fix session. Captured as a Pending enhancement so the next
  refactor session picks it up. Today's compromise: typing
  `/intents/123` into the browser address bar hits the API handler
  and returns JSON 401; navigate via the SPA's own links instead
- **Static plugin's `decorateReply: false` was a latent bug.** The
  previous setup never actually served the SPA fallback in
  production because no unauthenticated request ever made it past
  the auth middleware to call `sendFile`. Removing the flag fixes
  both the asset path and the fallback path

Build status: `pnpm -r build` would compile clean across all 12
packages (only `@gestalt/server` changed). The platform's bug
report is resolved end-to-end: dashboard reachable, login page
renders, SPA client-side routing works, API auth unchanged for
unauthenticated requests.

---

### Session 2026-05-30 — Claude Code (SPA mounted under /app/* for shareable deep links)

Closes the Pending enhancement from the previous session: dashboard
URLs were not shareable because the SPA's `/intents/:id` and `/alerts`
routes collided with API routes at the same paths. Pasting a URL
copied from the dashboard into a new tab hit the API handler and
returned JSON 401 instead of the dashboard view. Operator-flagged as
a real UX issue; resolved by moving the entire SPA under a `/app/*`
prefix so the URL spaces are disjoint.

Changed:
- `packages/dashboard/vite.config.ts`: added `base: '/app/'`. The
  built `index.html` now references `/app/assets/<hash>.{js,css}`
  instead of `/assets/<hash>.{js,css}`. Vite handles every absolute
  asset URL in the bundle automatically — no per-file edits needed
- `packages/dashboard/src/App.tsx`:
  `<BrowserRouter>` → `<BrowserRouter basename="/app">`. Every
  `navigate(...)`, `<Link to=...>`, `<NavLink to=...>`, and
  `<Navigate to=...>` in the SPA is now interpreted relative to
  `/app`; e.g. the Login view's post-success `navigate('/')`
  resolves to `/app/` in the URL bar, the Layout's `navigate('/login')`
  becomes `/app/login`, IntentFeed's
  `navigate(\`/intents/${id}\`)` becomes `/app/intents/${id}`. The
  audit upfront (grep across the SPA) confirmed no string-
  concatenated absolute URLs would need separate edits
- `packages/server/src/app.ts`:
  - `staticPlugin` prefix changed from `/` to `/app/`
  - New `app.get('/', ...)` handler 302-redirects to `/app/`. The
    bare URL is what operators type by hand and what older sessions
    of `gestalt dashboard` left in their history; the redirect lands
    them in the SPA without an opaque 401
  - `setNotFoundHandler` rewritten as a three-branch dispatch:
    non-GET → 404 JSON; GET under `/app/` (or exact `/app`) → serve
    `index.html` (SPA fallback for client-side routes like
    `/app/login`, `/app/intents/:id`); anything else → 404 JSON.
    Without that last branch, a typo at `/intnts` would silently
    serve the SPA shell whose asset refs now point at
    `/app/assets/...` and so the browser would render a blank page
- `packages/server/src/auth/middleware.ts`:
  - Dropped the `API_PATH_PREFIXES` list and `isApiPath` helper —
    no longer needed because the SPA bucket is now a single prefix
  - New `isSpaPath(url)` matches `/app` or `/app/*`
  - Auth preHandler bypass simplified to
    `if (request.method === 'GET' && isSpaPath(request.url)) return;`
  - Added `'GET /'` to `PUBLIC_ROUTES` so the new redirect handler
    can fire without auth (it's a registered route, so the preHandler
    runs before the handler)
- `packages/cli/src/commands/logs.ts`: `dashboardCommand` now opens
  `${resolveServerUrl(...)}/app/` instead of the bare URL. The 302
  on `/` would still get operators there if they type the bare URL,
  but the CLI shows the canonical path so users learn the URL shape
  their copied URLs will carry
- `docs/guides/quick-start.md`: Step 9 dashboard snippet updated —
  the comment now reads "Opens http://localhost:3000/app/" and a
  short paragraph explains the shareable-URL property

Verified live end-to-end. Dashboard image rebuilt
(`pnpm --filter @gestalt/dashboard build` regenerates the asset
hashes), server image rebuilt
(`docker-compose up -d --build server`). Server running healthy.

Server-side smoke (curl, every routing branch):
- `GET /` → `302  Location=http://localhost:3000/app/` ✅
- `GET /app/` → `200 text/html; 701 bytes` ✅
- `GET /app/login` → `200 text/html; 701 bytes` (SPA fallback) ✅
- `GET /app/intents/abc-123` → `200 text/html; 701 bytes`
  (deep-link via SPA fallback) ✅
- `GET /app/assets/index-BpHu9QYW.js` → `200 application/javascript;
  198,701 bytes` ✅
- `GET /intents` → `401 application/json` (API unchanged) ✅
- `GET /alerts` → `401 application/json` (was the SPA collision;
  now unambiguously API) ✅
- `GET /intnts` (typo, unauthenticated) → `401 application/json`
  (auth fires before the not-found handler) ✅
- `GET /intnts` (typo, WITH auth) → `404 application/json`
  (proves the not-found handler returns proper 404 instead of
  silently serving the SPA shell) ✅
- `POST /` → `401` ✅
- `POST /app/something` (with auth) → `404 application/json` ✅

Browser flow (headless Chrome via CDP):
- A. Bare `http://localhost:3000/` → 302 → `/app/login`; Login
     view renders with email + password fields
- B. Submit `admin@test.local` + `localadmin123` → `POST /auth/login`
     returns 200, URL transitions to `/app/` after 400 ms, IntentFeed
     view renders with "0 total" and "connected" SSE pill
- C. Deep link probe in same session — navigated to `/app/agents` →
     ActiveAgents view renders ("Active agents — idle — No agents
     running — platform is idle") at URL `/app/agents`
- D. **Share-URL probe** (the actual bug):
  opened `/app/intents/share-test-id` in a fresh tab (new
  `Target.createTarget`, no inherited localStorage) → server
  served the SPA HTML → SPA boots, `RequireAuth` sees no token →
  `<Navigate to="/login" replace>` runs through basename, URL
  becomes `/app/login`, login form renders. Operator can sign in
  exactly as if they'd opened the dashboard normally. **Before
  this session, the same paste hit the API at `/intents/:id` and
  returned `{"error":"Authentication required"}` JSON with no way
  to recover in-browser.**
- E. Inverse check — `fetch('/intents/share-test-id')` from the
     SPA (i.e. the bare API path) still returns `401 application/json
     {"error":"Authentication required"}`. API contract unchanged

Decisions made:
- **SPA path is `/app/*`, not `/dashboard/*` or `/ui/*`.** Three
  characters, one syllable. The exact prefix isn't load-bearing for
  the implementation — the operator's previous note suggested
  `/app/*` so kept it
- **Bare `/` gets a 302 redirect, not the SPA at `/`.** Two reasons:
  (1) it lets operators type the bare hostname and land somewhere
  useful; (2) it surfaces the canonical URL shape in the address
  bar after the redirect, so the first thing they copy is already
  `/app/...`. Considered serving the SPA at both `/` and `/app/*`
  but that would resurrect the collision risk for any future
  bare-path SPA route
- **The not-found handler refuses to serve the SPA for non-`/app/*`
  GETs**, even though that means a typo at `/intnts` shows JSON
  404 rather than the SPA. The alternative (serve `index.html`
  for everything) means the SPA's `<link>` + `<script>` tags
  reference `/app/assets/...` while the URL bar shows `/intnts` —
  if React Router can't match, the user gets a blank dashboard.
  A clear 404 is better than that silent breakage
- **Auth middleware: `GET /` is in `PUBLIC_ROUTES`, not bypassed
  via `isSpaPath`.** They're semantically different — `GET /` is
  a registered route that exists to redirect; `isSpaPath` bypasses
  the auth check entirely for fastify-static's static-asset reads.
  Keeping them separate documents the intent
- **CLI opens `<url>/app/` explicitly** rather than relying on the
  302. The redirect would still get operators there, but the CLI's
  output (`Dashboard opened at http://localhost:3000/app/`) is what
  most users will copy to share with teammates, so it should show
  the canonical URL
- **Did NOT add return-URL preservation across the post-login
  redirect.** The SPA's Login view does `navigate('/')` on success
  (which resolves to `/app/`). A share-URL flow currently: paste
  `/app/intents/foo` → bounce to `/app/login` → after login, land
  on `/app/` (Intents list), NOT back on the original intent.
  This is a pre-existing UX gap (the basename move didn't change
  it) — flagged as a smaller follow-up if it matters

Pending-enhancement entry **"SPA deep-link collisions with API
paths"** removed from `STATE.md` — resolved.

Build status: `pnpm -r build` clean across all 12 packages. Docker
server image rebuilt; container `Up (healthy)`. All four CLI
layers (generate / gate / deploy / maintenance) unchanged and
running. Dashboard SPA reachable at `/app/*` with shareable
deep-link URLs; API contract at bare paths unchanged.

Follow-ups added to Pending enhancements:
- **Return-URL preservation through the post-login redirect.** Today
  pasting `/app/intents/<id>` in a fresh tab bounces to `/app/login`
  then lands on `/app/` after sign-in (the intent ID is dropped).
  React Router's `useLocation()` + a `?from=` query param in the
  Navigate call would preserve it. ~10 min change in `App.tsx` +
  `Login.tsx`
- **Vite dev-server proxy has a dead `/api` entry.** The proxy in
  `packages/dashboard/vite.config.ts` lists `/api → localhost:3000`
  but the server has no routes under `/api` (every API route is at
  the root level). Pre-existing dead config noticed during the
  audit for this session; cleanup, not a behavior change

