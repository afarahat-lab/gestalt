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

**Last updated:** 2026-05-31 (Claude Code — agent execution logs + IntentDetail accordion)

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
- All seven migrations apply on startup: `001_initial`, `002_local_auth`,
  `003_projects`, `004_deployments`, `005_maintenance`,
  `006_intent_clarification`, `007_execution_logs`
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
  - **Clarification text persists across gate retries
    (migration 006).** `intents.clarification TEXT NULL`;
    `POST /intents/:id/clarify` writes the column via
    `intents.saveClarification(id, text)` BEFORE dispatching the
    resume task. The orchestrator reads `intentRecord.clarification`
    on every dispatch (including the gate-retry leg, whose BullMQ
    payload does not carry the text) and threads it into the
    intent-agent's task. Audit-log records only
    `{ clarificationLength: N, acknowledgedAlertIds, ip }` — the
    text itself never leaves the DB (GP-006). Verified live
    (`63bc2a3b`): intent-agent ran 3 times across the cycle
    (initial pause, post-clarify resume, gate retry); each run
    saw the persisted 156-char clarification; only ONE
    clarification alert was ever created (the original — the
    pre-fix bug would have created a second one on the retry
    leg); intent reached `escalated` for an unrelated review-agent
    GP_BREACH after the second gate review
- **Dashboard Intent Feed now shows ALL intents, including failed
  and waiting-for-clarification.** Pre-existing bug: the feed read
  `projectId` from `localStorage.getItem('gestalt_project')` with
  fallback `'default'` — that string never matched a real
  `project_id` and `listIntents` always returned zero rows (so
  failed intents had no trace in the dashboard). No status filter
  is applied to `listIntents` — the feed shows the full intent
  timeline for the project
- **Agent execution logs populated for every agent run, accordion
  in IntentDetail.** Migration 007 added `agent_execution_logs`
  (1:1 with `agent_executions`, FK cascades on delete). All three
  orchestrators (generate / quality-gate / deploy) persist one log
  row per execution capturing the prompt, the LLM response, the
  result status, the artifact paths the agent produced, the signal
  types it emitted, and the error message on failure. LLM-backed
  agents (intent / design / context / code / test in generate,
  review-agent in gate) fill the prompt + response columns;
  non-LLM agents (lint-config when skipped, constraint-agent in
  gate, pr-agent / pipeline-agent / promotion-agent in deploy)
  leave both null. New `GET /executions/:id/log` returns the
  execution + log + filtered artifacts + filtered signals
  (filtered by `producedBy === agentRole` and
  `sourceAgent === agentRole` respectively). Returns 200 with
  `log: null` for pre-migration-007 executions so the dashboard
  can render a placeholder without confusing "intent missing"
  with "feature didn't exist yet". The dashboard's IntentDetail
  rewrote the agent timeline as a clickable accordion — click a
  row → first-time fetch shows a loading state → subsequent
  clicks use cached state. Expanded panel renders Agent meta
  (role / status / duration / started time), Prompt (with copy
  button + truncate-to-400-chars-with-show-full toggle), LLM
  response (same controls), Artifacts produced, Signals emitted,
  and an error box at the top when present. Verified live
  (`9c28d399` cycle, titleCase utility): full deploy cycle in
  ~17 s, 12 executions / 12 log rows; LLM agents show
  prompt-length 1300–3469 chars and response-length 31–1654
  chars; non-LLM agents show `prompt = NULL`,
  `llmResponse = NULL`, `resultStatus = passed/completed`;
  endpoint returns the full prompt and response bytes;
  dashboard renders the expanded panel with copy + show-full
  buttons and the "Not applicable" placeholders on the
  constraint-agent row
- **`GET /projects` returns ALL registered projects** to any
  authenticated user. The previous owner-only filter
  (`projects.list(request.user.id)` → only rows where
  `created_by = userId`) meant that if operator A registered
  `trackeros` and operator B logged into the dashboard, B would
  see "No projects — run gestalt init" even though
  `gestalt projects list` worked for A. Self-hosted small teams
  expect every operator to see every project; the filter has been
  switched to `projects.listAll()`. If per-project access control
  is required later, add a `project_members` table and intersect
  there — do NOT re-introduce the owner-only filter at this
  endpoint
- **ProjectContext defensively redirects to `/app/login` on 401.**
  RequireAuth at the top of the dashboard route tree only checks
  for the presence of a token, not its validity. A stale or
  expired JWT used to bounce every API call to 401, which
  ProjectContext silently caught and rendered as "No projects —
  run gestalt init". The catch block now distinguishes
  `ApiError.status === 401` (delete the token, hard-navigate to
  `/app/login`) from other failures (network down, 500 — keep
  showing the layout, set `projects: []`)
- **Project selection is global across the entire dashboard.**
  `packages/dashboard/src/context/ProjectContext.tsx` fetches
  `/projects` once on mount, hydrates from
  `localStorage.gestalt_project_id` if present, falls back to
  `projects[0]` if the stored id is missing or no longer
  resolves, and persists every change back to `localStorage`. The
  Layout sidebar renders a `<select>` between the logo and the
  navigation links — switching projects there applies
  immediately to every project-scoped view (IntentFeed / Alerts /
  Deployments / QualityGate / Maintenance). ActiveAgents stays
  global (agent executions span all projects). Window-focus
  refetch keeps the project list current when an operator runs
  `gestalt init` in another terminal (no new SSE event needed).
  The earlier per-view fetches and localStorage reads
  (`gestalt_project` with `'default'` fallback in
  Deployments / QualityGate; the per-view dropdown in IntentFeed)
  are removed. Every project-scoped view guards on
  `!currentProjectId` with an EmptyState pointing at
  `gestalt init`. Alerts are project-scoped client-side by
  joining `alert.context.intentId` against the project's intent
  list (the `/alerts` API has no `projectId` filter — captured as
  a Pending enhancement). Verified live: selector renders with
  the existing project pre-selected, the IntentFeed shows
  "3 total · trackeros" with all three intents (escalated +
  needs-input + failed) including the older `failed` one the
  operator originally reported as invisible; all five
  project-scoped views render with the selector value in the
  sidebar across navigations; reload retains the choice; clearing
  localStorage falls back to `projects[0]`; a bogus stored id
  also falls back cleanly
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
- `intents`     — full CRUD + list with paging + `saveClarification`
  (writes operator clarification text to the nullable column added
  in migration 006; orchestrator reads it on every dispatch so it
  survives gate-retry legs)
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
- `executionLogs` — save (1:1 per agent_executions row), findByExecutionId,
  findByCorrelationId. Migration 007. Foreign key cascades on delete
  matches the BullMQ removeOnComplete contract. The
  AgentExecutionRepository also gained `findById(id)` so the
  `/executions/:id/log` endpoint can fetch the join row

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
- **`GET /alerts` has no `projectId` filter.** The dashboard's
  Alerts view filters client-side by joining each alert's
  `context.intentId` against the current project's intent list,
  which costs an extra `/intents?projectId=…` call per refresh.
  A server-side query parameter that joins the alerts table to
  intents (or to a `project_id` column added directly on
  `alerts`) would let the API return the filtered set in one
  call and let the Layout's badge count match the visible list
  without extra plumbing
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

### Session 2026-05-31 — Claude Code (global dashboard project selector + per-view localStorage cleanup)

Closes the per-view project-id divergence that the previous
clarification session only partially fixed. IntentFeed had been
updated to read from `localStorage.gestalt_project_id` with a real
project hydrate, but Deployments and QualityGate still read the OLD
`gestalt_project` key with the `'default'` fallback bug. Every
project-scoped view should now derive its current project from one
shared source.

Changed:
- `packages/dashboard/src/context/ProjectContext.tsx` (new):
  Provider + `useProject()` hook. On mount it calls
  `/projects` once; selection rule is
  `localStorage.gestalt_project_id → projects[0] → null`. Writes
  the chosen id back to localStorage eagerly so the next reload
  takes the fast path. Registers a `window 'focus'` handler that
  re-fetches `/projects` — picks up a new project registered in
  another terminal without needing a server-side
  `project.created` SSE event. `setCurrentProjectId(id)` is
  exposed to consumers and persists on every change. The provider
  preserves the operator's in-session choice when the server's
  ordering of `/projects` shifts (no surprise switching mid-session)
- `packages/dashboard/src/App.tsx`: wraps the authenticated route
  tree in `<ProjectProvider>` (inside `<RequireAuth>` so the
  `/projects` fetch only fires for signed-in sessions, outside
  the `<Routes>` so every view sees the same context)
- `packages/dashboard/src/components/layout/Layout.tsx`: sidebar
  gained a `<select>` between the logo and the navigation list —
  reads from `useProject()`, calls `setCurrentProjectId` on
  change. While `projectsLoading` it shows `loading...` in
  muted text; with zero projects it shows
  `No projects — run gestalt init`. Single-project case still
  renders the select so the operator can see which project is
  active. Styled with existing CSS variables
  (`var(--bg-subtle)` / `var(--border)` / `var(--font-mono)` /
  `var(--text-primary)` / `var(--text-dim)`)
- `packages/dashboard/src/views/IntentFeed.tsx`: removed the
  per-view `/projects` fetch and the in-header `<select>` added
  in the clarification session. Now reads
  `useProject().currentProjectId` + `currentProject`. Subtitle
  becomes `${total} total · ${currentProject.name}`. Empty state
  distinguishes "no project registered" (run gestalt init) from
  "no intents yet"
- `packages/dashboard/src/views/Deployments.tsx`,
  `QualityGate.tsx`: replaced
  `localStorage.getItem('gestalt_project') ?? 'default'` (the
  pre-existing bug) with `useProject().currentProjectId` +
  guard-return EmptyState when no project is selected
- `packages/dashboard/src/views/Maintenance.tsx`: passes
  `projectId` through `listMaintenanceRuns` and
  `triggerMaintenanceAgent`. The API client's
  `triggerMaintenanceAgent(agentRole, projectId)` is now
  required-param (the server has always required `projectId`
  on `POST /maintenance/trigger`; previously the dashboard
  call would have 400'd)
- `packages/dashboard/src/views/Alerts.tsx`: project-scoped
  client-side. Loads both `/alerts?acknowledged=false` and the
  current project's intents in parallel, builds a Set of
  intent IDs, filters alerts whose `context.intentId` matches
  (alerts without an intentId pass through — none exist today
  but the contract leaves room). Guard-returns when no project
  is selected. New `intent.created` SSE subscription keeps the
  filter set fresh as new intents arrive in the project
- `packages/dashboard/src/views/ActiveAgents.tsx`: unchanged.
  Agent executions span all projects (the operator wants to
  see every running agent, not just those for the current
  project)
- `packages/dashboard/src/api/client.ts`:
  - `listMaintenanceRuns` gained `projectId?` param
  - `triggerMaintenanceAgent` signature widened to
    `(agentRole, projectId)` — required-param to match the
    server contract

Verified live against the running platform:
- `pnpm --filter @gestalt/dashboard build` clean; `pnpm -r build`
  clean across all 12 packages
- Docker server image rebuilt; the new dashboard bundle
  (`/app/assets/index-Bf8qYMe-.js`, 204 KB) lands cleanly
- **Headless Chrome drive captured** the IntentFeed with the
  sidebar selector showing `trackeros` selected, the IntentFeed
  body showing "3 total · trackeros" with three intents (`make
  it better` ×2 with `! escalated` + `? needs input` and the
  older `start implementation` `✗ failed`). Screenshot saved
- **Navigation drive** (`/app/agents`, `/app/gate`,
  `/app/deployments`, `/app/maintenance`, `/app/alerts`)
  confirmed every view renders without crashing and that the
  sidebar selector value stays at the same UUID across every
  navigation. The Alerts tab badge in the sidebar shows the
  global unack count (1) — the in-view list filters to the
  current project's alerts
- **Three reload-persistence probes:**
  - hard reload → selector + localStorage retain the chosen id
  - clear `gestalt_project_id` + reload → selector
    auto-selects `projects[0]` and writes the id back to
    localStorage so the next reload is sticky
  - set a bogus UUID + reload → selector ignores the stale
    value, picks `projects[0]`, and overwrites the storage
- The previous session's two unacknowledged data points (the
  earlier `61fd59a6` intent at `waiting-for-clarification` and
  its alert) are visible in the dashboard for the first time —
  the per-view `'default'` fallback was masking them

Decisions made:
- **`<ProjectProvider>` lives inside `<RequireAuth>`**, not at
  the top of the tree. The `/projects` call requires an auth
  token; mounting the provider outside the auth guard would
  trigger the fetch on the public `/app/login` page and
  produce noisy 401s. Inside the guard, the provider mounts
  exactly when there's a token available
- **Selector renders even when there is only one project**, per
  the brief. Hiding a "trivial" dropdown would surprise an
  operator who registers a second project mid-session — the
  control just suddenly appears. Always-visible is the kinder
  affordance
- **Window-focus refetch, not a new SSE event.** The brief
  explicitly suggested either; window-focus is one event
  handler with zero server-side changes and catches the
  realistic case (operator runs `gestalt init` in a terminal,
  alt-tabs back to the dashboard). A `project.created` SSE
  event would be more proactive but is out of scope and would
  require server-side wiring
- **Alerts filter client-side, not via a new API parameter.**
  Brief constraint: no new endpoints. The dashboard's existing
  `/alerts` + `/intents` calls are enough to compute the
  filter; the cost is one extra `/intents` request per refresh
  on the Alerts tab. Pending enhancement logged for a
  server-side `projectId` filter on `/alerts`
- **Layout sidebar badge stays global.** It reflects the
  count of unacknowledged alerts across every project, which
  matches the bell-icon convention ("you have N things to
  attend to anywhere"). Scoping the badge to the current
  project would require the same client-side join the Alerts
  view does, plus a refresh on project change, for marginal
  UX gain. Documented this trade-off so the next refresh of
  the alerts surface picks it up
- **`gestalt_project_id` is the canonical localStorage key.**
  Established in the clarification session; this session
  fixes the two views that were still reading the legacy
  `gestalt_project` key. No old-key migration code is added —
  the legacy reads pointed at the literal string `'default'`
  which never matched a real project anyway, so there is
  nothing to migrate from

Build status: `pnpm -r build` clean across all 12 packages.
Dashboard bundle rebuilt; SPA loads under `/app/*`; the global
project selector is the new single point of truth for which
project the dashboard is showing.

Follow-up added to Pending enhancements:
- `GET /alerts` projectId filter (server-side) — would let the
  dashboard skip the client-side join and let the sidebar
  badge match the filtered list in the Alerts view

---

### Session 2026-05-31 — Claude Code (`/projects` returns all projects + 401 → /login)

Operator reported the previous session's dashboard saying
"No projects — run gestalt init" while `gestalt projects list`
on the same machine showed `trackeros`. Two root causes:

1. **Server-side, primary:** `GET /projects` was filtering by
   `created_by = request.user.id`. The CLI was signed in as
   `a@b.c` (who owns the project); the dashboard session was
   either a different user or simply the same user but the
   previous session's brief had assumed the endpoint returned
   "all projects for the authenticated user". The owner-only
   filter never made sense for a small-team self-hosted
   platform where collaborators expect every operator to see
   every registered project.
2. **Dashboard-side, defensive:** if the JWT in localStorage
   was stale (expired or signed under a wiped user), every
   API call returned 401. `RequireAuth` only checks for token
   presence, so the dashboard rendered with a useless token
   and silently failed every fetch. `ProjectContext`'s catch
   block then converted the 401 into "No projects". The user
   was stuck.

Changed:
- `packages/server/src/routes/projects.ts`:
  `GET /projects` now calls `projects.listAll()` instead of
  `projects.list(request.user.id)`. Comment on the route
  explicitly documents the model ("self-hosted small team —
  every authenticated operator can see every project") and the
  intended migration path if access control becomes a
  requirement (add a `project_members` table; intersect there;
  do NOT re-introduce the owner-only filter on this endpoint)
- `packages/dashboard/src/context/ProjectContext.tsx`: imports
  `ApiError` from the dashboard's API client. The catch block
  is now two-branched:
  - `ApiError.status === 401` → `localStorage.removeItem('gestalt_token')`
    + `window.location.href = '/app/login'`. Hard navigation so
    React Router restarts and `RequireAuth` sends the user to the
    login view
  - anything else → quiet "no projects" state (lets the operator
    refresh the tab; doesn't blow up the layout for transient
    network blips)

Verified live against the running platform:
- `pnpm -r build` clean. Server image + dashboard bundle
  (`index-DipB4z-Z.js`, 204 KB) rebuilt
- **Baseline:** logged in as `a@b.c` (project owner) → 1 project
  via `GET /projects` (trackeros). Unchanged
- **Bug reproduction + fix:**
  - Inserted a second user `second@test.local` directly into
    the DB (admin/setup is one-shot — guarded for first-boot
    only). bcrypt-hashed `opsop123` using the server image's
    bundled `bcrypt@5.1.1`
  - Confirmed via `gen_random_uuid()` UUID that the user is
    distinct from the project's creator
  - Logged in as `second@test.local` via `POST /auth/login`
    (JWT length 259, role `operator`)
  - `GET /projects` returns trackeros with
    `createdBy: 9e9c4051-…` (the OTHER user's id). Pre-fix this
    would have returned an empty array
- **Browser drive (headless Chrome):** logged in as
  `second@test.local`, sidebar shows the `trackeros` selector,
  IntentFeed header reads "3 total · trackeros" and renders all
  three existing intents (`make it better` ×2 + the older
  `start implementation` failed). Screenshot saved. Pre-fix
  this exact session would have shown "No projects — run
  gestalt init" in the sidebar
- Test user deleted afterwards; DB back to a clean
  one-user one-project state

Decisions made:
- **Server fix at the route level**, not at the repo. The
  `projects.list(userId)` method still exists in the
  `ProjectRepository` interface (could be useful for an
  "owned by me" view later) — we just don't call it from
  `GET /projects` anymore. Cheap to keep around and avoids
  an interface change that would ripple through
  oracle/mssql stubs
- **No new `?scope=mine` query parameter** to support
  "show only my projects" today. YAGNI — the operator-facing
  use case is "show me what's here so I can pick one"; the
  audit trail of who created a project lives on the row
  itself (`createdBy`). Add a query param if and when the UX
  ever differentiates
- **Dashboard 401 is a hard navigate, not a React Router
  `<Navigate>`.** A redirect from inside `ProjectContext`
  would race against the rest of the app's mounting; a
  `window.location.href` restart guarantees the RequireAuth
  guard runs from a clean state with the token removed.
  Slightly heavier than a router redirect but predictable
- **Other transient errors stay as "no projects".** The
  dashboard should be resilient to a flaky network or a
  brief server hiccup. Bouncing the operator to /login for
  a single failed fetch would be infuriating. Only 401 —
  the actual "you don't have a valid session" signal —
  triggers the bounce

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; dashboard SPA serves the new bundle
under `/app/*`. Both fixes verified live: the previously-
filtered owner-only view is gone, and an expired-token
session now bounces to login instead of showing a
misleading empty state.

---

### Session 2026-05-31 — Claude Code (agent execution logs + IntentDetail accordion)

Closes the "what did this agent actually see and say?" gap. Before
this session, the dashboard's IntentDetail listed each agent run by
role + duration + status — no way to see the prompt that was sent
to the LLM, the response that came back, the artifacts that were
produced, or the error message on failure. Now every agent run
persists a log row containing all four; clicking any row in the
dashboard expands an inline accordion with copy + show-full
controls.

Changed:
- `packages/adapters/postgres/src/migrations/007_execution_logs.sql`
  (new): `agent_execution_logs` table — `execution_id` FK with
  `ON DELETE CASCADE`, `correlation_id`, `agent_role`,
  nullable `prompt` + `llm_response` (non-LLM agents leave
  them null), `result_status` text, `artifact_paths TEXT[]`,
  `signal_types TEXT[]`, nullable `error_message`,
  `created_at`. Two indexes (`execution_id`, `correlation_id`).
  No schema_migrations writes — runner owns that
- `packages/core/src/repository/index.ts`: new
  `AgentExecutionLogRecord` + `AgentExecutionLogRepository`
  (`save / findByExecutionId / findByCorrelationId`). Added
  `findById` to `AgentExecutionRepository` so the
  `/executions/:id/log` endpoint can fetch the row directly.
  `RepositoryRegistry` gained `executionLogs`. Re-exported from
  `@gestalt/core`
- `packages/adapters/postgres/src/repositories/execution-logs.ts`
  (new): `PostgresAgentExecutionLogRepository`. Maps
  postgres-style `TEXT[]` → JS array directly; defends against
  `null` arrays by normalising to `[]` on read
- `packages/adapters/postgres/src/repositories/executions.ts`:
  added the new `findById(id)` query (`SELECT * ... LIMIT 1`)
- `packages/adapters/oracle/src/repositories/execution-logs.ts`
  + `packages/adapters/mssql/src/repositories/execution-logs.ts`
  (new): full throw-stub `*AgentExecutionLogRepository` so
  interface drift forces a build break here
- Adapter `index.ts` files updated to wire / re-export the new
  classes
- `packages/agents/generate/src/types.ts`: `AgentResult` gained
  optional `lastPrompt?: string` and `llmResponse?: string`
- All six generate agents updated to capture the most-recent
  prompt + LLM response into local vars and propagate them on
  every return path (success, retry-failure, clarification-needed,
  hard-failed):
  - `intent-agent.ts` — captures lastPrompt + lastLlmResponse
    before each `llmCall(prompt)`; threads them into all four
    exits (completed, clarification-needed, retries-exhausted,
    thrown failure)
  - `design-agent.ts` — same pattern. `failedResult` helper
    widened to accept the two new fields
  - `context-agent.ts`, `code-agent.ts`, `test-agent.ts` — same
    capture+propagate pattern
  - `lint-config-agent.ts` — unchanged. Never calls the LLM; both
    fields stay undefined → orchestrator persists them as null
- `packages/agents/quality-gate/src/types.ts`: `GateAgentResult`
  gained the same optional `lastPrompt` + `llmResponse`
- `packages/agents/quality-gate/src/agents/llm-review-agent.ts`:
  threads both fields onto every return path (passed, failed,
  errored). `constraint-agent.ts` is unchanged — regex sweeper,
  no LLM call, the orchestrator persists nulls
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  destructures `executionLogs` from `getRepositories()` inside
  the step loop. After `executions.updateStatus(...)`,
  `await executionLogs.save(...)` with the result's
  prompt/response/status, mapped artifact paths, mapped signal
  types, and error message (first signal's message on
  `failed`). Wrapped in `.catch()` so a log-save failure logs a
  warning and does not break the cycle. The thrown-agent catch
  branch also persists a row with null prompt/response,
  `resultStatus: 'failed'`, and the error message
- `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`:
  same persistence pattern inside `runWithObservability`. Both
  branches (thrown + completed) save a row. `artifactPaths`
  always empty (gate agents don't produce generate-style
  artifacts); `signalTypes` from `result.signals`
- `packages/agents/deploy/src/orchestrator/deploy-orchestrator.ts`:
  same. Deploy agents are non-LLM so prompt + response are
  always null. `artifactPaths` always empty; `signalTypes`
  reflects whatever the agent emitted
- `packages/server/src/routes/executions.ts` (new):
  `GET /executions/:id/log` (preHandler `requireRole('viewer')`).
  Fetches the execution row, finds the matching log,
  parallel-loads the artifacts + signals for the
  correlation, filters them down to
  `producedBy === agentRole` /
  `sourceAgent === agentRole`. Returns 404 if the execution
  doesn't exist; returns 200 with `log: null` for pre-007
  executions so the UI can render a placeholder without
  distinguishing "intent missing" from "feature didn't exist
  yet"
- `packages/server/src/app.ts`: registers the new routes
- `packages/dashboard/src/api/client.ts`: new
  `getExecutionLog(executionId)` typed method. Pulls
  `SignalSummary` into the import block (it was missing
  before this change)
- `packages/dashboard/src/views/IntentDetail.tsx`: rewrote
  the agent timeline as a clickable accordion. State holds
  the expanded set, a `logs` cache keyed by execution id,
  and per-execution show-full toggles for prompt and
  response. Click handler lazy-loads the log on first open
  (`'loading'` state shown inline), caches the result.
  Subsequent toggles use cached data. Prompt + LLM response
  are truncated to 400 chars by default with a "show
  full" button and a "copy" button (writes to clipboard via
  `navigator.clipboard.writeText`). Null prompts render as
  "— Not applicable (non-LLM agent)". The error box pinned
  at the top of the panel shows the agent's error message
  in red when present. Panel uses existing CSS variables;
  multiple executions can be expanded at once for
  side-by-side comparison

Verified live against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt; migration 007 applied
  (`schema_migrations` now lists seven versions). Table shape
  confirmed via `\d agent_execution_logs`
- **Submitted intent** "Add a titleCase utility under
  src/shared/utils/title-case ..." (correlationId
  `9c28d399-d160-4534-ab3e-64ee142ae5b8`). Intent reached
  `deployed` in ~17 s
- **12 agent_executions → 12 agent_execution_logs** (1:1)
- Full join query confirms the column shapes:
  - LLM agents have populated `prompt` + `llm_response`:
    - intent-agent: prompt 2818 / response 822, 1 artifact
    - design-agent: 1939 / 83, 1 artifact
    - context-agent: 1300 / 31
    - code-agent: 3243 / 426, 2 artifacts
      (`src/shared/utils/title-case/titleCase.ts`,
      `index.ts`)
    - test-agent: 1300 / 1654, 1 artifact
    - review-agent: 3469 / 266
  - Non-LLM agents have NULL prompt + NULL response, with
    the right resultStatus:
    - lint-config-agent: skipped (correctly recorded — the
      agent never called the LLM)
    - constraint-agent: passed
    - pr-agent / pipeline-agent / promotion-agent ×2: all
      `completed`, all nulls
  - No `error_message` populated anywhere — the cycle ran
    clean
- `GET /executions/<code-agent-id>/log` returned the full
  payload (3.2 KB prompt, the JSON response with the two
  generated files, the two artifacts with their content,
  empty signals list). Same call for the constraint-agent
  execution returned the expected `prompt: null,
  llmResponse: null, resultStatus: 'passed'`
- **Browser drive (headless Chrome via CDP):** logged in as
  `a@b.c`, navigated to `/app/intents/<intentId>`. All 12
  execution rows render in the timeline with statuses + role
  names + durations + ▼ chevrons. Clicked the code-agent row
  → accordion expanded inline, showed the Agent meta panel
  (Role: code-agent, Status: ● done, Duration: 1163ms,
  Started: 8:20:03 PM), the Prompt section with `copy` +
  `show full` buttons and "(2843 more chars)" truncation
  marker, the LLM Response section with the same controls,
  and the Artifacts/Signals sections. Screenshot captured.
  Clicked the constraint-agent row → expanded panel showed
  "Not applicable" placeholders for prompt and response;
  result status "passed" (13 "Not applicable" text matches
  in the DOM confirms the placeholders are everywhere they
  should be — Prompt + LLM Response × multiple expanded
  panels)

Decisions made:
- **One log row per agent_executions row, not a log stream.**
  Incremental progress already flows through the in-process
  event bus + SSE. The table captures the post-completion
  snapshot for the dashboard's drill-down view. A log-stream
  surface would balloon row counts and complicate the
  retention story without giving the dashboard anything new
- **`ON DELETE CASCADE` on the FK.** Matches the existing
  BullMQ removeOnComplete contract: if an execution row is
  pruned, its log goes with it. The audit trail of "agent X
  ran for intent Y" lives on `agent_executions`; the log
  table is the rich-text companion, not the canonical
  record
- **404 vs `log: null` for missing rows.** Returning 200
  with `log: null` lets the dashboard render a clean
  placeholder for pre-migration-007 executions without
  having to distinguish "the execution doesn't exist" from
  "the execution exists but its log was never captured".
  404 is reserved for "no execution by that id at all"
- **`TEXT[]` for artifactPaths + signalTypes, not JSONB.**
  Both are simple list-of-strings; the postgres array type
  preserves the array semantics directly and indexes
  naturally if a future query wants `WHERE 'CONSTRAINT_VIOLATION' = ANY(signal_types)`.
  JSONB would have worked but is overkill
- **Persist on log-save failures as warnings, not throws.**
  A DB blip on `executionLogs.save` should not break the
  cycle. The row's primary state (agent_executions,
  signals, artifacts) is already persisted; the log row is
  diagnostic. Caught + logged at `warn`
- **Prompt + response stored as TEXT, not JSONB.** They are
  free-form strings that the LLM produced; treating them
  as text avoids the parse-on-write cost and matches the
  diagnostic intent (operator wants to read them as-is)
- **GP-006 compliance:** prompt + response are stored in
  the DB but NOT echoed to the audit log. The audit row for
  `intent.clarification-provided` (added in the previous
  clarification session) already records only
  `clarificationLength`; this session does not touch that
  contract. The new `agent_execution_logs.prompt` /
  `llm_response` are operator-visible via the dashboard's
  IntentDetail accordion, which requires authentication +
  `requireRole('viewer')`
- **Per-execution log fetch is lazy + cached** in the
  dashboard. Opening the IntentDetail with 12 executions
  fires zero `/executions/:id/log` calls until the operator
  clicks something; clicking the same row twice in a row
  uses the cached payload
- **Truncate at 400 chars.** Picked to keep the panel
  scannable in a typical browser viewport. Both prompt and
  response can be 3+ KB on a non-trivial agent, which would
  push the rest of the page off-screen. The full text is
  always one click away via "show full"
- **Inline accordion, not a modal**, per the brief. Lets
  the operator have multiple executions expanded at once
  for cross-checking (e.g. comparing the design-agent
  prompt against what the code-agent saw)

Build status: `pnpm -r build` clean across all 12 packages.
Migration 007 applied. End-to-end verified: prompts +
responses + artifact paths + signal types persist for every
agent run; the dashboard reads them back and renders the
accordion panel with copy + show-full controls.

No follow-ups added — this feature is self-contained and
GP-006-compliant by design.

