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

**Last updated:** 2026-05-31 (Claude Code — clarification flow + IntentFeed projectId bug fix)

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
- **Intent clarification flow wired end-to-end.** A vague intent
  (e.g. "make it better") no longer fails silently at the test-agent —
  the intent-agent runs, sees `successCriteria.length === 0` (or a
  high-impact ambiguity), and returns a new typed
  `AgentStatus = 'clarification-needed'` with a `{ reason, suggestions }`
  payload. The orchestrator:
  - creates an `alerts` row (`type: 'clarification-needed'`,
    `severity: high`, `requiredAction: 'provide-clarification'`,
    `context.intentId` + `context.suggestions[]` JSONB-stashed)
  - emits an `alert.created` SSE event so the dashboard updates
    without a refresh
  - transitions the intent to `waiting-for-clarification`
  - flips `plan.state = 'waiting_for_clarification'` so the outer
    while-loop bails before any downstream agent runs
  The maintenance-sourced intent guard (ADR-035 prefix
  `[gestalt-maintenance/<type>]`) short-circuits the clarification
  check — those are typed `MaintenanceIntent` objects and never
  need operator clarification. Dashboard Alerts view renders the
  card with the `?` badge, suggestions list, textarea, and a
  "resume intent" button. Resume flow:
  - `POST /intents/:id/clarify { clarification }` acknowledges every
    unacknowledged `clarification-needed` alert for the
    correlationId, audit-logs the operator's clarification text
    (GP-002), and re-dispatches a `generate:intent` task with
    `clarification` threaded through
  - orchestrator hydrates the missing `projectId` + `text` from
    the persisted intent row, calls `runIntentAgent` with the
    clarification text appended to the prompt under an "Operator
    clarification" heading; downstream agents proceed normally
  - the `intent-agent` clarification gate runs AFTER the LLM call
    (we trust the LLM to drive the decision, not a pre-flight
    regex)
  - Verified live (`61fd59a6`): submitted "make it better" against
    `trackeros`; intent paused in ~2 s, alert visible in dashboard
    with three suggestions, textarea, and resume button; submitted
    "Add a slugify utility under src/shared/utils/slugify with
    slugify(s: string): string"; alert disappeared, cycle resumed,
    all six generate agents ran in ~22 s; intent reached
    `in-review`. Browser screenshots captured of alert card + post-
    submit empty state
- **Dashboard Intent Feed now shows ALL intents, including failed
  and waiting-for-clarification.** Pre-existing bug: the feed read
  `projectId` from `localStorage.getItem('gestalt_project')` with
  fallback `'default'` — that string never matched a real
  `project_id` and `listIntents` always returned zero rows (so
  failed intents had no trace in the dashboard). Fixed by fetching
  `/projects` on mount, persisting the selected id under
  `gestalt_project_id`, and rendering a project selector dropdown
  in the page header. No status filter is applied to `listIntents`
  — the feed shows the full intent timeline for the project
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
- `alerts` — create, findById, findUnacknowledged, findByCorrelationId,
  acknowledge. `intent_id` lives in `context` JSONB (schema 001
  predates the FK); `parseContext` normalises postgres.js's
  parsed-object vs raw-JSON-string return shapes the same way
  `parseFindings` does for maintenanceRuns. `intentId` lifted out of
  context into the read-side record for ergonomics

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
- **Clarification text is lost on a gate retry.** After a successful
  resume, the gate may dispatch a `generate:intent` retry (verdict
  `fail`, auto-resolvable signals) — and that retry payload doesn't
  carry the original `clarification` text. intent-agent re-runs
  without it, sees no success criteria again, and creates a SECOND
  clarification alert. Observed live (`61fd59a6` cycle in the
  2026-05-31 session). Fix shape: persist the most recent
  clarification on the `intents` row (or as a fixed-name artifact
  the intent-agent reads from the working tree) so it survives
  retries; alternatively skip the intent-agent on retry when a
  prior `.gestalt/intent-spec.json` exists in the Git tip (this
  also closes the related "retry cycle full re-runs all generate
  agents" entry below)
- **POST /interventions still a 501 stub.** The clarification flow
  bypasses it (uses `POST /intents/:id/clarify` directly because
  that endpoint owns the resume side effect). When breach
  acknowledgement / promotion approval get UIs they'll need a
  real implementation here
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

---

### Session 2026-05-31 — Claude Code (intent clarification flow + dashboard IntentFeed bug fix)

Closes a long-standing bad UX: vague intents (e.g. "make it better")
used to grind through three generate agents and then fail at the
test-agent with `CONTEXT_GAP No success criteria`, with no actionable
operator surface. Now they pause at the intent-agent itself, create an
operator-facing alert with three suggested clarifications + a
textarea, and resume cleanly once the operator submits a refinement.
Also fixes the pre-existing IntentFeed bug (`projectId` always
`'default'` → failed intents invisible in the dashboard).

Changed:
- `packages/agents/generate/src/types.ts`:
  - `AgentStatus` gained `'clarification-needed'` — distinct from
    `failed`. The agent ran successfully but discovered the input
    is too vague to proceed; semantically the cycle "paused", not
    "failed"
  - New `ClarificationNeeded` shape `{ reason, suggestions: string[] }`
    + optional `clarificationNeeded?: ClarificationNeeded` on
    `AgentResult`. Orchestrator copies these into the alert row
  - `AgentTask` gained `intentSource?: 'human' | 'maintenance-agent'`
    and `clarification?: string` — threaded into the intent-agent's
    task so it can (a) skip the clarification gate for
    maintenance-sourced intents and (b) fold the operator's
    clarification into the prompt on resume
- `packages/agents/generate/src/agents/intent-agent.ts`:
  - New `needsClarification(spec, rawIntentText, intentSource)`
    helper. Exempts maintenance-sourced intents (the
    `[gestalt-maintenance/<type>]` prefix is the canonical
    detection per ADR-035, and `intentSource === 'maintenance-agent'`
    is a belt-and-braces second check). Returns a typed
    `ClarificationNeeded` when `spec.successCriteria.length === 0`
    or when any ambiguity has `impactIfWrong === 'high'`
  - The clarification gate runs AFTER the LLM call — we trust the
    LLM's structured output to drive the decision, not a
    pre-flight regex on the raw intent string
  - Emits a single CONTEXT_GAP signal with `autoResolvable: false`
    (the gate's retry router must never auto-resolve these — only
    a human clarification can make progress) and an `.gestalt/intent-spec.json`
    artifact carrying whatever the LLM did extract (the operator
    may want to see the half-built spec when deciding how to
    refine)
- `packages/agents/generate/src/prompts/intent-prompt.ts`: new
  optional `clarification?: string` parameter. When supplied, the
  prompt gains an "## Operator clarification" section that includes
  the text verbatim and instructs the LLM to base
  `successCriteria` on the clarification rather than the original
  intent alone
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  - `IntentTaskPayload`: `text` and `projectId` are now optional so
    the resume leg can omit them (the orchestrator hydrates both
    from `intents.findById(payload.intentId)`)
  - New `intentSource` payload field — defaults to the persisted
    `IntentRecord.source` if absent, so the gate's retry leg sees
    the right value too
  - `drivePlan` takes a `DrivePlanOptions { intentSource,
    clarification }` argument and threads both into every
    intent-agent task it creates
  - Replaced the previous CONTEXT_GAP detection block with a
    structural check `result.status === 'clarification-needed'`.
    On match: `alerts.create({ type: 'clarification-needed',
    severity: 'high', title, description, requiredAction:
    'provide-clarification', context: { suggestions, intentId } })`,
    emit `alert.created` SSE, transition intent to
    `waiting-for-clarification`, flip
    `plan.state = 'waiting_for_clarification'`
- `packages/core/src/repository/index.ts`:
  - New `AlertRecord`, `AlertType`
    (`'clarification-needed' | 'GOLDEN_PRINCIPLE_BREACH' |
    'promotion-pending'`), `AlertRequiredAction`
    (`'provide-clarification' | 'acknowledge-breach' |
    'approve-promotion' | 'reject-promotion'`), and
    `AlertRepository` interface (`create / findById /
    findUnacknowledged / findByCorrelationId / acknowledge`)
  - `RepositoryRegistry` gained `alerts`. Re-exported from
    `@gestalt/core` so consumers see the new symbols
- `packages/adapters/postgres/src/repositories/alerts.ts` (new):
  `PostgresAlertRepository`. The schema-001 `alerts` table has no
  `intent_id` column, so the repo stashes `intentId` (and
  type-specific payload such as `suggestions`) inside the
  `context` JSONB column. Insert uses an explicit `::jsonb` cast
  (without it postgres' implicit text→jsonb is a quote-wrap, not a
  parse — same trap as `maintenance_runs.findings`). New
  `parseContext` helper handles postgres.js's two possible read
  shapes (parsed object vs raw JSON string) the same way
  `parseFindings` does. Lifts `intentId` out of context onto the
  read-side record for ergonomics
- `packages/adapters/{oracle,mssql}/src/repositories/alerts.ts`
  (new): throw-stub `*AlertRepository` classes so interface drift
  in core forces a build break here
- `packages/adapters/postgres/src/index.ts`,
  `packages/adapters/{oracle,mssql}/src/index.ts`: wire the new
  `PostgresAlertRepository` / re-export the stubs
- `packages/server/src/oversight/routes.ts`:
  - Replaced the `GET /alerts` and `GET /alerts/:id` throw-stubs
    with real handlers backed by `AlertRepository`. The list
    endpoint defaults to `acknowledged=false` (matches the
    dashboard's request shape) with optional `severity` filter
  - New `POST /alerts/:id/acknowledge` for explicit dashboard
    use (the clarification flow auto-acknowledges via
    `POST /intents/:id/clarify`, so this is mostly belt-and-braces)
  - `POST /interventions` reduced to a 501 stub with a clear
    message pointing operators at `POST /intents/:id/clarify` —
    breach / promotion UIs aren't shipping yet
- `packages/server/src/routes/intents.ts`: `POST /intents/:id/clarify`
  rewritten with the full side-effect chain. Acknowledges every
  in-flight `clarification-needed` alert for the correlationId
  before dispatching the resume, omits `projectId` + `text` from
  the resume payload (orchestrator hydrates them from
  `intents.findById`), audit-logs the operator's clarification
  text via `audit.append` (GP-002 — truncated to 4 KB), and
  returns `{ resumed: true, acknowledgedAlerts: N }`. Empty
  `clarification` body → 400 with a clear message
- `packages/dashboard/src/types.ts`: new `ProjectSummary` type
- `packages/dashboard/src/api/client.ts`:
  - `clarifyIntent` body shape adjusted (`ambiguityId` now optional)
    and return shape includes `acknowledgedAlerts: number`
  - New `listProjects()` → `{ data: ProjectSummary[] }`
  - New `acknowledgeAlert(id)` → `{ data: Alert }`
- `packages/dashboard/src/views/Alerts.tsx`: clarification card
  branch added. Renders the `?` badge in addition to the existing
  severity badge, the suggestions list (defensive
  `Array.isArray` check on the JSONB context), the textarea
  with a useful placeholder, and a "resume intent" button. Submit
  flow extracts `intentId` from `alert.context.intentId`, posts
  to `/intents/:id/clarify`, shows
  "✓ Clarification submitted — resuming..." for 1.2 s, then
  removes the card. Also subscribes to `intent.status-changed`
  SSE so the list refreshes when other tabs clear an alert
- `packages/dashboard/src/views/IntentFeed.tsx`: pre-existing
  bug fixed. Was reading `projectId` from
  `localStorage.getItem('gestalt_project')` with fallback
  `'default'` — the literal string `'default'` never matched a
  real `project_id` and `listIntents` always returned zero rows
  (so failed intents had no trace in the dashboard). Now fetches
  `/projects` on mount, persists the selected id under
  `gestalt_project_id`, and renders a `<select>` dropdown in the
  page header listing every project the user can see. No status
  filter is applied — the feed shows the full intent timeline
  including `failed` and `waiting-for-clarification`. Empty
  states distinguish between "no project registered" and
  "no intents yet"

Verified live against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt, `Up (healthy)`. Login as `a@b.c`
  (existing operator, password supplied for this verification
  session and redacted from output)
- **Submitted intent "make it better"** (correlationId
  `61fd59a6-3b78-40af-9f82-d9be6364934e`). 2 s wall-clock to the
  paused state
- `agent_executions`: one row (`intent-agent / completed / 1967 ms`).
  No downstream agents ran
- `signals`: one CONTEXT_GAP row,
  `Intent requires clarification: Intent is too vague — no
  success criteria could be extracted.`, severity `high`,
  `autoResolvable: false`
- `alerts`: one row, `type: clarification-needed`, severity
  `high`, `requiredAction: provide-clarification`, context JSONB
  carries `suggestions: [...3 items]` + `intentId`
- `intents.status`: `waiting-for-clarification`
- **GET /alerts** returned the alert with `intentId` populated and
  `context` as a real object (after the `parseContext` fix —
  before it, postgres.js was returning context as a raw JSON
  string and the dashboard's
  `alert.context['suggestions']` was `undefined`)
- **Dashboard verified in a real headless Chrome:**
  - Login → Alerts tab shows "1 requiring attention"
  - Clarification card renders with `?` badge, "clarification-needed"
    tag, title, description, all three suggestion bullets, the
    textarea with placeholder, and the "resume intent" button.
    Screenshot `02-alert-expanded.png` matches the brief exactly
  - Typed clarification + clicked "resume intent" → card
    vanished, page transitioned to the empty-state
    "No alerts — platform running autonomously" within 1.2 s.
    Screenshot `03-after-submit.png`
- **Resume cycle:** intent transitioned `waiting-for-clarification
  → generating → in-review` within ~22 s. All six generate
  agents ran (intent-agent re-ran with the operator's
  clarification text in the prompt; design / context skipped;
  code-agent 12.5 s; test-agent 2.4 s); the gate then dispatched
  its own constraint-agent + review-agent and decided on a
  retry — which surfaced the gate-retry edge case noted under
  Pending enhancements
- **IntentFeed bug fix verified:** dashboard now shows "2 total ·
  trackeros" with both `make it better` (`? needs input`) and
  the older `start implementation` intent (`✗ failed` — the one
  the operator had reported as invisible). Project selector
  dropdown in the page header. Screenshot `04-intent-feed.png`

Decisions made:
- **Clarification gate runs AFTER the LLM call, not as a
  pre-flight regex.** A pre-flight word-count check would
  short-circuit useful work (an LLM may extract perfect
  successCriteria from a 4-word intent and a long-prose intent
  may still leave fields empty). Trust the structured output;
  classify based on what came back
- **`autoResolvable: false` on the CONTEXT_GAP from this gate.**
  Hard-coded in the intent-agent. The gate ↔ generate feedback
  router doesn't have a path that can satisfy a vague intent
  without a human — only `POST /intents/:id/clarify` can. If
  we ever ship an auto-clarification agent (LLM expands the
  intent itself), it should produce a NEW signal type, not flip
  this flag
- **Alert `context` JSONB stores `intentId` + `suggestions`,
  not a new schema migration.** The `alerts` table predates the
  intent FK; adding a column means a migration + back-compat
  reads for older rows. The JSONB-stash pattern matches the
  brief, keeps the migration history clean, and only adds one
  defensive `parseContext` helper on the read side
- **`POST /intents/:id/clarify` acknowledges in-flight alerts as
  part of the same call.** Alternative: have the dashboard call
  `POST /alerts/:id/acknowledge` separately. Bundling the
  acknowledgement keeps the resume atomic from the operator's
  perspective and prevents the case where the resume succeeds
  but the alert lingers because the second call dropped
- **Maintenance-sourced intents check uses BOTH `intentSource`
  and the `[gestalt-maintenance/<type>]` text prefix.** The
  prefix is the canonical ADR-035 marker; the explicit
  `intentSource` field is belt-and-braces in case a future
  caller forgets the prefix. Either is sufficient on its own
- **Did NOT persist the clarification text on the `intents` row.**
  Means the gate-retry leg (which doesn't carry clarification
  in its payload) loses it and the intent-agent re-asks. This
  edge case is logged under Pending enhancements rather than
  fixed here — the right fix is either to persist a
  per-intent `clarification` column OR to skip the
  intent-agent on retry when `.gestalt/intent-spec.json`
  already exists in the cloned tip (the existing "retry cycle
  full re-runs all generate agents" optimisation
  conveniently subsumes this)
- **Dashboard `gestalt_project` localStorage key renamed to
  `gestalt_project_id`.** The old key contained the literal
  string `'default'` which never matched a real project. The
  new key makes the contents-are-a-UUID contract obvious and
  guarantees no overlap with stale storage on existing
  operators' machines
- **POST /interventions is now an explicit 501 with a message.**
  Replaces the previous `throw new Error('not yet implemented')`
  which crashed Fastify with an Unhandled-error 500. The new
  response tells operators where the working endpoint is
  (`POST /intents/:id/clarify`)

Build status: `pnpm -r build` clean across all 12 packages.
Dashboard image rebuilt; full SDLC slice (vague intent → pause →
clarification card in dashboard → resume → cycle re-runs through
all six generate agents → gate fires) verified end-to-end. The
gate-retry-loses-clarification edge case is a real but bounded
follow-up; the operator's primary complaint (vague intents fail
silently at test-agent with no alert) is resolved.

Follow-ups added to Pending enhancements:
- Clarification text is lost on a gate retry (described in detail
  in STATE.md under Pending enhancements)
- `POST /interventions` still a 501 stub — only matters when
  breach / promotion UIs ship

