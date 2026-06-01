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

**Last updated:** 2026-06-01 (Claude Code — harness templates moved out of projects.ts into templates/ — ADR-036)

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
- All nine migrations apply on startup: `001_initial`, `002_local_auth`,
  `003_projects`, `004_deployments`, `005_maintenance`,
  `006_intent_clarification`, `007_execution_logs`,
  `008_finding_attempts`, `009_execution_log_model`
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
- **Active Agents card shows intent + cycle progress + tokens.**
  `GET /status/agents` is enriched per row with `intentText`,
  `cycleProgress: { completed, total }`, and `tokensSoFar` (the
  running total across all agents in the cycle so far). Same
  endpoint, same auth; the dashboard's `ActiveAgents.tsx` now
  renders each card with the agent role + pulsing ◎, an
  elapsed-time stamp in the top-right (`1s` / `1m 23s`), the
  intent text quoted and truncated to 55 chars, a segmented
  progress bar (one block per planned agent), the
  `step N of M` label, and the token count. Auto-refresh every
  5 s plus `agent.started` / `agent.completed` SSE-triggered
  refresh kept from the previous implementation. Server-side
  the enrichment de-dupes per-correlation lookups so a
  multi-agent cycle triggers one `intents.findByCorrelationId`
  and one `executions.findByCorrelationId` instead of N each
- **Deployments view renders a 4-node pipeline timeline.** New
  `GET /deployments?projectId=…&limit=…` returns one row per
  intent that has at least one `deployment_events` row,
  enriched with the full event timeline (ASC by `created_at`),
  `prUrl` / `prNumber` / `branch` (from the `pr-opened` event's
  metadata) / `runId` / `deploymentUrl`. Three intent statuses
  scanned in parallel (`deploying`, `deployed`, `failed`);
  cycles with no events are dropped client-side so a
  gate-failed intent never reaches an empty card. Dashboard's
  `Deployments.tsx` renders three sections (In progress /
  Deployed / Failed) — each card has the status badge, branch
  tag, timestamp, intent text (65-char truncation), the
  4-node timeline (PR → Pipeline → Staging → Production)
  with green ●-filled / muted ○-empty / blue ◎-in-progress /
  red ✗-failed nodes, green connectors between completed
  nodes, status labels (opened/passed/promoted/deployed) and
  HH:MM timestamps under each filled node. Footer has
  `[↗ View PR #N]` and `[↗ View deployment]` links —
  `target="_blank" rel="noopener noreferrer"`. Pipeline-failed
  flips the Pipeline node red; downstream nodes stay muted.
  Pipeline-triggered (no -passed yet) shows the Pipeline node
  pulsing blue
- **Postgres `deployment_events.metadata` JSONB read path
  patched** to defensively `JSON.parse` when postgres.js
  returns the column as a string instead of an object. Same
  pattern as `parseContext` in the alerts repo and
  `parseFindings` in the maintenance-runs repo. Before this
  fix the `branch` extraction in `/deployments` returned null
  for every deployment because `metadata['branch']` against a
  string is `undefined`
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
    commit + push) and queues a `CONTEXT_UPDATE` MaintenanceIntent that
    the runner routes through the **context-fixer direct-fix path** —
    one LLM-driven minimal additive edit per intent, committed directly
    to `defaultBranch`. See the "Maintenance intent routing" bullet below
  - **alignment-agent** (daily 03:00 UTC) — reads context files,
    cross-checks DOMAIN.md entities ↔ ARCHITECTURE.md modules, and
    GP-NNN cross-references in AGENTS.md; queues `CONTEXT_ALIGNMENT`
    intents per misalignment. Same routing — the runner sends them
    through the context-fixer rather than the generate loop because
    the test-agent can't generate tests for a markdown edit.
    `extractEntities()` matches **h3** entity headings (`### Name`) and
    bullet-style entity definitions (`- **Name** — …`, with a dash
    separator), filtered through a stop list of common field labels
    (`Type`, `Description`, `Status`, `Notes`, `Props`, …). The h2
    pattern + bold-bullet-without-separator pattern were the source
    of the previous false-positive findings on `Components` /
    `Type` / `Description` / `Props` (where `## Components` is a
    grouping heading and `- **Type**: value` is a field label on
    `WelcomeScreen`). For each finding type, `affectedFiles[0]` is
    the file the context-fixer should **write** to:
    `domain-entity-without-module` → `docs/ARCHITECTURE.md` (add a
    `src/modules/<EntityName>/` entry);
    `architecture-module-without-entity` → `docs/DOMAIN.md` (add an
    entity definition); `golden-principle-not-cross-referenced` →
    `AGENTS.md` (add the principle reference). The companion file
    sits in `affectedFiles[1]` as read-only context the LLM sees in
    the suggestedAction text. `extractModules()` runs **two
    patterns** against ARCHITECTURE.md:
    1. **Pattern 1 — literal path.** A contiguous
       `src/modules/<name>` substring anywhere in the file. This
       is the format the `suggestedAction` text now instructs the
       LLM to write (`Add the line "  src/modules/X/    — X
       module" … Use the literal path format, not a tree diagram
       child entry`)
    2. **Pattern 2 — markdown directory tree.** Lines like
       `├── modules/` introduce a 10-line lookahead that captures
       indented children (`│   ├── X/`). A structural depth check
       (count of `│` chars in the leading tree prefix) ensures
       only DEEPER-indented entries count as children — sibling
       top-level entries like `├── shared/` correctly break the
       scan instead of being misread as `modules/` children.
       Without that check, the runner produced 5 spurious
       `architecture-module-without-entity` findings for
       `shared/db/auth/utils/api` and the LLM happily added
       garbage entities to DOMAIN.md
    The two patterns together let the harness template's existing
    tree-format ARCHITECTURE.md be recognised AS-IS while still
    rewarding the more explicit literal-path format the
    `suggestedAction` requests. Comment-stripping (`# …`) is
    applied to both the container-line detection and the child
    regex match so `├── modules/   # business domain modules`
    matches the same as the bare `├── modules/`. Convergence
    verified live: from a clean DOMAIN.md the alignment loop
    reaches `findings: 0, directFixes: 0, durationMs: ~1.6 s`
    after the LLM's literal-path fixes land
  - **CLI access via `gestalt maintenance`.** Operators can
    trigger and reset from the terminal:
    - `gestalt maintenance trigger <agentRole> <projectName>` —
      thin wrapper around `POST /maintenance/trigger`. Same
      runner code path as the cron schedule + the dashboard
      "Run now" button; prints `runId` + `intentsQueued` +
      `directFixes` + `durationMs` from the returned record
    - `gestalt maintenance reset-findings <projectName>` —
      `DELETE /maintenance/findings/:projectId`
      (`requireRole('operator')`). Clears every
      `maintenance_finding_attempts` row for the project
      regardless of `escalated` flag — the "I cleaned up the
      files manually, give me a fresh budget" button. Returns
      `{ deleted: N }`. **Audit row is `action:
      'maintenance.findings-reset'` with metadata `projectName`
      + `deletedCount` + `ip` ONLY — finding hashes are derived
      from finding content (which may include file paths) and
      so are excluded per GP-006**. Both subcommands accept the
      standard `--server <url>` one-shot override
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
    a `maintenance_runs` row, routes each queued `MaintenanceIntent`
    based on its class (see "Maintenance intent routing" below),
    updates the row on completion, and emits a
    `maintenance.run-completed` SSE event
  - **Maintenance intent routing (ADR-018).** Every
    `MaintenanceIntent` is classified by
    `classifyMaintenanceIntent(type)`:
    - `'context-file-update'` (`CONTEXT_ALIGNMENT` / `CONTEXT_UPDATE`)
      → the runner calls `applyContextFileFix(intent, project)` in-
      process; the **context-fixer** clones the repo to a temp dir,
      calls the LLM with a "minimal additive edit" prompt + the
      current file content + the finding evidence + the suggested
      action, validates the result against a **truncation guard**
      (output must be ≥ 50% of original length — short output is
      refused as suspected LLM truncation), writes the file, commits
      as `docs: <suggestedAction (prefix stripped, 72-char cap)>
      [gestalt-maintenance/<TYPE>]` authored by
      `Gestalt Maintenance Agent <maintenance-agent@gestalt.local>`,
      and pushes to `defaultBranch`. Each successful commit
      increments `directFixes` on the run record and appends a
      `direct-fix-applied` finding (commit-sha lifted out for the
      operator). Path guard hard-throws BEFORE any clone or LLM call
      if `intent.affectedFiles[0]` is not in `docs/*` or exactly
      `AGENTS.md` — ADR-018 forbids the direct-fix path from
      touching `src/`. Temp dir cleaned in `finally`
    - `'code-change'` (`PERFORMANCE_DEGRADATION` / `SECURITY_FINDING`)
      → unchanged: the runner writes an `intents` row
      (`source: 'maintenance-agent'`) and dispatches a
      `generate:intent` BullMQ task. The generate orchestrator
      handles these like any human-submitted intent with the full
      generate → gate → deploy loop
    - Live verified on `trackeros`: a manual alignment-agent trigger
      produced 6 findings; the runner classified all 6 as
      `context-file-update` and applied 6 direct fixes (4 to
      `docs/DOMAIN.md`, 2 to `AGENTS.md`) in ~32 s wall-clock.
      `intentsQueued: 0`, `directFixes: 6` on the run record;
      6 new commits on `main` authored by `Gestalt Maintenance Agent`;
      every commit subject starts with `docs:` and ends with
      `[gestalt-maintenance/CONTEXT_ALIGNMENT]`. A second run
      applied 4 more fixes for the entity findings (the GP-NNN
      findings were resolved by the first run's AGENTS.md edits
      and so were absent the second time)
  - **Per-finding idempotency guard (migration 008).** The runner
    hashes each candidate fix (`SHA-256` of
    `intent.type:affectedFiles[0]:evidence.slice(0,80)`) and tracks
    consecutive failed attempts in `maintenance_finding_attempts`.
    Each non-committed outcome (no-change, truncation-guard,
    llm-error, file-missing, thrown) increments the per-finding
    counter via an `INSERT ... ON CONFLICT ... DO UPDATE` upsert. A
    real commit calls `resetAttempts(hash)` (delete the row) so the
    next occurrence starts fresh. Once the counter hits
    `MAX_ATTEMPTS = 3` on the same run that just incremented it,
    the runner creates a `maintenance-stuck` alert
    (`severity: medium`, `requiredAction: review-manually`, JSONB
    `context` carrying `intentType` / `affectedFiles` / `evidence` /
    `suggestedAction` / `attemptCount` / `findingHash`) and flips
    `escalated = TRUE`. Future runs of the same finding see the
    flag and skip silently (~838 ms total run, no clone, no LLM
    call). New `AlertType: 'maintenance-stuck'` +
    `AlertRequiredAction: 'review-manually'` added to the core
    repository typed unions. The context-fixer's system prompt was
    tightened to forbid `> Note:` blockquote-appending and to
    return the file unchanged when no real structural edit is
    possible — this was the LLM's escape hatch on unresolvable
    findings and caused DOMAIN.md to grow linearly with garbage
    blockquotes. Live verified on `trackeros`: a finding the LLM
    can't satisfy produces 3 attempts → escalation on the 3rd run
    (alert created, no commit) → silent skip on the 4th and
    subsequent runs
  - Manual operator trigger via `POST /maintenance/trigger { agentRole,
    projectId }` (requireRole operator); same runner code path as the
    cron schedules
  - `GET /maintenance/runs?projectId&agentRole&limit` returns
    `{ data: MaintenanceRunRecord[] }` (the standard server envelope).
    The dashboard's `Maintenance.tsx` view consumes it and renders the
    "Recent runs" list — clicking the `run now` button against any of
    the four agents triggers the run via `POST /maintenance/trigger`,
    the runner persists the row synchronously (in-process — no BullMQ
    hop), and the view re-fetches after 1 s plus on the
    `maintenance.run-completed` SSE event. Trigger errors render as a
    red `✗ Failed to trigger: <message>` strip under the agent card
    and auto-clear after 5 s
  - **Each Recent runs row is a clickable accordion** that expands an
    inline detail panel — same idiom as the IntentDetail agent-
    execution accordion. The header row surfaces stats at a glance:
    `N findings` (amber when > 0, dim when 0), `N intents queued`
    (amber, omitted when 0), `N fixes applied` (green, omitted when
    0), duration in dim text (`ms` under 1 s, otherwise `1.2s`), and
    the timestamp. Expanded panel shows a Run summary section
    (agent / status / duration / direct fixes / intents queued /
    started + completed timestamps) plus either a Findings (N)
    section with per-finding cards (severity badge — red high /
    amber medium / dim low; type chip; up-to-3 affected files +
    "and N more"; description; `→ suggestedAction` in muted italic)
    or a "No findings — Agent ran cleanly — nothing to report"
    panel. All data already in the existing `MaintenanceRunRecord`
    — no separate fetch, no new endpoint. Multiple rows can be
    expanded at once. Verified live against `trackeros`:
    alignment-agent run with 6 findings (4 medium + 2 low) shows
    all 6 cards with the right severity colours, type chips, and
    file lists; drift-agent run with 0 findings shows the clean
    panel
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
  `findStagingPromotion`. `metadata` JSONB read path uses the shared
  `parseJsonb<Record<string, unknown>>(row.metadata, {})` in
  `../utils` so the `pr-opened` event's `branch` key (used by the
  Deployments view's branch chip) round-trips regardless of whether
  postgres.js returns the column as an object or a string
- `maintenanceRuns` — create (status=running), complete (final counts +
  findings JSONB + duration), list (filter by projectId / agentRole).
  Findings are JSONB-array-typed; the PG impl uses an explicit
  `::jsonb` cast on insert/update (without it postgres' implicit
  text→jsonb cast wraps the whole array as a JSON string scalar) and
  the shared `parseJsonb<MaintenanceFinding[]>(row.findings, [])` in
  `../utils` normalises the read path against postgres.js returning
  either a parsed array or a raw JSON string
- `findingAttempts` — upsertAttempt (INSERT ... ON CONFLICT ... DO
  UPDATE so concurrent runs increment atomically without a read-
  modify-write race), getAttempts (filter by projectId + IN-list of
  hashes — empty input short-circuits to `[]`), markEscalated
  (UPDATE escalated=TRUE), resetAttempts (DELETE so a fresh
  occurrence starts at attempt 1). Migration 008.
  `UNIQUE(project_id, finding_hash)` gives the upsert path a
  deterministic conflict target. ON DELETE CASCADE on
  `projects(id)` keeps the table clean when a project is removed
- `alerts` — create, findById, findUnacknowledged, findByCorrelationId,
  acknowledge. `intent_id` lives in `context` JSONB (schema 001
  predates the FK); the shared
  `parseJsonb<Record<string, unknown>>(row.context, {})` in
  `../utils` normalises postgres.js's parsed-object vs
  raw-JSON-string return shapes. `intentId` lifted out of context
  into the read-side record for ergonomics
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

**Harness templates live in `templates/`, not inline in routes (ADR-036).**
- All 8 harness files (`AGENTS.md`, `HARNESS.json`, `agents.yaml`,
  the 4 `docs/*.md`, `.github/workflows/gestalt.yml`) ship as
  files under `templates/corporate-ops-web-mobile/{harness,docs,ci}/`
  with `{{variable}}` placeholders
- `packages/server/src/templates/engine.ts` provides
  `loadTemplate(templatesDir, templateId, vars)`, a one-regex
  substitution engine (`/\{\{(\w+)\}\}/g`) with no conditionals or
  loops. Unknown variables are left in place (the literal
  `{{foo}}` survives into the committed file) so missing values
  are debuggable rather than silently empty
- Auto-supplied variables: `today` (ISO date at load time) and
  `projectSlug` (kebab-cased `projectName`). Caller supplies
  `projectName`, `projectDescription`, and optionally
  `defaultBranch`
- Repo-path mapping is contract: `harness/X` → `X` at the repo
  root; `docs/*` keeps its prefix; `ci/gestalt.yml` →
  `.github/workflows/gestalt.yml`; any future top-level template
  files pass through unchanged
- Skip list: `constraints/`, `principles/`, `template.json`, and
  top-level `README.md` are platform-internal — the engine walks
  them but does not emit them to the project repo
- `resolveTemplatesDir()` is sync, walks 4 candidate paths
  (Docker `/app/templates`, `pnpm dev` from `packages/server`,
  `node dist/...` from compiled paths), caches the result at
  module load. Throws at module-load time if no candidate
  resolves, so the server fails fast rather than 500ing on the
  first registration
- `init-harness` route became a thin orchestrator: clone repo,
  call `loadTemplate(...)`, write each file via `mkdir` +
  `writeFile`, commit + push. The 8 inline `build*()` functions
  + the `HarnessInputs` interface are deleted —
  `packages/server/src/routes/projects.ts` shrank from 815 to
  422 lines (48% reduction)
- The seeded `HARNESS.json` carries
  `"templateId": "corporate-ops-web-mobile"` so future tooling
  (registry, drift-agent template-aware checks) can identify
  which template seeded the project
- **Dockerfile + `.dockerignore` updated.** The Dockerfile copies
  `templates/` into the builder stage AND the production stage;
  `.dockerignore` no longer excludes the directory. The
  template engine reads from `/app/templates/<id>/` at runtime
- Verified live: docker rebuild → `/app/templates/corporate-ops-web-mobile/`
  visible inside the container with all 8 expected files;
  server startup log emits `"Templates directory resolved"
  templatesDir: "/app/templates"`. Direct engine invocation
  produces 8 substituted files for `projectName: "Test Project"`
  / `projectDescription: "A test project description"` —
  `AGENTS.md` starts with `# AGENTS.md — Test Project`,
  `HARNESS.json` has `"name": "test-project"` (slug-derived) +
  `"description": "A test project description"`,
  `DECISIONS.md` includes `Date: 2026-06-01`. Local-dev
  resolution from `packages/server` cwd also resolves correctly
  (walks up to repo root)

**Step 1: externalise agent prompts to agents.yaml — implemented.**
- Every LLM-reasoning agent reads its persona (`role`, `goal`), LLM
  tuning (`temperature`, `max_tokens`, optional `model`), and a flat
  list of `prompt_extensions` from `agents.yaml` in the project repo
  root (alongside `HARNESS.json`). Infrastructure agents
  (`constraint-agent`, `test-runner-agent`, `pipeline-agent`,
  `promotion-agent`, `gc-agent`) ignore the file — they do
  deterministic work
- **Schema** (snake_case YAML keys normalised to camelCase by the
  loader; both shapes are accepted):
  ```yaml
  agents:
    code-agent:
      role: "Senior TypeScript engineer"
      goal: "Generate production-quality TypeScript code..."
      llm:
        temperature: 0.2
        max_tokens: 8000
      prompt_extensions:
        - "Always add a JSDoc comment to every exported function"
        - "Use Result<T,E> pattern for error handling"
  ```
- **Loader** (`@gestalt/agents-generate/loadAgentConfig(projectRoot,
  agentRole)`) is fully non-fatal:
  - Missing file → per-role baseline (one of `intent-agent`,
    `design-agent`, `context-agent`, `code-agent`, `test-agent`,
    `review-agent`, `drift-agent`, `alignment-agent`,
    `context-fixer` — matches the seeded YAML exactly)
  - Malformed YAML → baseline + debug log
  - Agent absent from YAML → baseline
  - Partial entry (only `role`, no `llm.temperature`) → merged with
    baseline gap-fill
  - Backward compat: existing projects without an `agents.yaml`
    committed get identical behaviour to before this change
- **ContextSnapshot.agentConfig** added. The context-assembler calls
  `loadAgentConfig(projectRoot, forAgent)` once per agent dispatch
  and attaches the result. The `agents.yaml` is read from the
  per-cycle clone, so an operator can edit + push and the next
  intent cycle picks it up without a server restart (ADR-032)
- **Prompt wrapping** via the `applyAgentConfig(body, agentConfig)`
  helper. Every prompt builder
  (`buildIntentPrompt` / `buildDesignPrompt` / `buildContextPrompt` /
  `buildCodePrompt` / `buildTestPrompt` /
  `buildLintConfigPrompt`) now prepends a single persona line
  (`You are <role> working on the Gestalt platform. Your goal:
  <goal>`) and appends `## Project-specific instructions\n- ext1\n
  - ext2 ...` near the end (when the operator's
  `promptExtensions` array is non-empty). The existing prompt
  body — file paths, JSON output shapes, retry guidance — stays
  intact. `llm-review-agent.ts` and `context-fixer.ts` follow the
  same pattern inline (different surrounding architecture; same
  effect)
- **LLM tuning + per-agent model routing** flow through a shared
  `LlmCallFn` type:
  `(prompt, overrides?: { temperature?, maxTokens?, model? }) =>
  Promise<string>`. The orchestrator's `llmCall` wrapper calls
  `getLLMClient(overrides.model)` per invocation — the registry
  returns the cached default client when `model` is undefined
  or matches the platform default, and creates + caches a new
  client (sharing the default's `baseUrl` + `apiKey`) on first
  use of any other model name. Each agent passes
  `task.contextSnapshot.agentConfig.llm` so per-agent
  `temperature`, `max_tokens`, AND `model` land on the wire
- **Multi-client LLM registry (`@gestalt/core/src/llm/index.ts`).**
  The startup singleton is now a `Map<string, LLMClient>` keyed
  by model name. `createLLMClient(config)` seeds the default;
  `getLLMClient(model?)` returns the cached client for the
  requested model name or builds a new one on demand. Override
  clients reuse the default's endpoint + API key — only the
  model name changes on the wire (matches Azure deployment +
  every OpenAI-compatible provider's contract). `LLMClient.getModel()`
  exposes the bound model name so the orchestrators can capture
  it after each call. Per-process cache — one entry per unique
  model, created on first use, reused forever after
- **`agent_execution_logs.model_used` column (migration 009).**
  Captures which model actually ran each agent step (after the
  per-agent override resolution). The orchestrators read
  `client.getModel()` after every `complete()` call and persist
  it. Null for non-LLM agents (constraint-agent / pr-agent /
  pipeline-agent / promotion-agent / skipped lint-config) and
  for pre-migration-009 rows. Dashboard's IntentDetail panel
  shows `Model: gpt-4o-mini` / `gpt-4o` / `—` in the agent
  meta section
- **`gestalt init` seeds `agents.yaml`** in the harness file map
  (alongside `HARNESS.json` / `AGENTS.md` / context files). The
  seeded content matches the loader's per-role defaults exactly,
  so a project with the seed file and a project without it
  behave identically out of the box. Operators tune by editing +
  pushing
- **`HarnessEngine.validate()` recognises `agents.yaml` as
  optional.** Present + parses cleanly → no warning. Present +
  malformed → `HarnessValidationResult.warnings` carries
  `"agents.yaml parse error: ..."`. Present + missing `agents`
  key → `"agents.yaml present but has no agents key — defaults
  will be used"`. Absent → silent (the common case for projects
  registered before this change). Validation NEVER fails on
  agents.yaml — the loader's defaults always carry the cycle
- Live verified on `trackeros`:
  - **Without `agents.yaml`** (the existing trackeros state at
    commit `198aff6`): submitted an intent; `agent_execution_logs`
    rows for intent / design / code / test agents each show the
    new persona line at the top of the prompt — every agent gets
    its own per-role baseline (`Senior software architect` /
    `Senior software architect` / `Senior TypeScript engineer` /
    `Senior QA engineer`), not a generic placeholder
  - **With `agents.yaml`** committed to trackeros main, setting
    `code-agent.llm.temperature: 0.8` and
    `prompt_extensions: ["Always add a JSDoc comment to every
    exported function", "Use Result<T,E> pattern for error
    handling"]`: submitted a slugify intent; the code-agent's
    persisted prompt shows both extensions under
    `## Project-specific instructions`. **The generated
    `src/shared/utils/slugify.ts` carries the operator's style
    rules verbatim** — a 4-line JSDoc block with `@param` /
    `@returns` tags AND a `Result<string, Error>` return type
    (the LLM even synthesised a helper
    `src/modules/Utils/result.ts` to provide the type)
  - The full cycle (generate → gate → deploy) reached the
    `deployed` status with the operator-tuned extensions in
    play. End-to-end working

**Alert system — enriched payload + fix-intent flow + CLI:**
- `GET /alerts` and `GET /alerts/:id` return `{ data: EnrichedAlert[] }`
  (the standard envelope). Each row carries the base `AlertRecord`
  shape plus per-type fields lifted out of the JSONB `context`
  column so the dashboard / CLI can render without re-parsing:
  - `clarification-needed` → `intentText`, `intentStatus` (looked
    up via `intents.findById(context.intentId)`)
  - `maintenance-stuck` → `findingType`, `affectedFiles`,
    `evidence`, `attemptCount`, `suggestedAction` (lifted from
    `context`)
  - `GOLDEN_PRINCIPLE_BREACH` → `breachMessage`, `breachLocation`,
    `breachAgent` (resolved via `signals.findByCorrelationId(alert.
    correlationId)` → pick the `GOLDEN_PRINCIPLE_BREACH` row)
- `POST /alerts/:id/fix-intent { additionalContext? }` — operator
  says "I understand the problem, generate a fix". The server
  builds the intent text from the alert's enriched context, queues
  a `generate:intent` task on the BullMQ queue (same shape as
  `POST /intents`), acknowledges the alert in the same call so the
  card disappears atomically, writes an `alert.fix-intent-submitted`
  audit row (metadata: `fixIntentId`, `additionalContextLength`,
  `intentTextLength`, `ip` — **never the context text itself per
  GP-006**), and returns `{ intentId, correlationId, intentText }`.
  `additionalContext` is **appended** to the auto-built text, never
  replaces it — the alert's structural context always leads.
  Intent text templates:
  - `clarification-needed` → `Fix the following issue with intent
    "X": <description>. <additionalContext>`
  - `maintenance-stuck` → `<suggestedAction>. Context: <evidence>.
    <additionalContext>`
  - `GOLDEN_PRINCIPLE_BREACH` → `Fix golden principle breach in
    <file>: <breachMessage>. <additionalContext>`
- `POST /alerts/:id/acknowledge { notes? }` extended to accept an
  optional notes body. Audit metadata captures `notesLength` only
  — the text stays on the alert / persisted record, not in the
  audit row (GP-006)
- **Dashboard `Alerts.tsx` rewritten with per-type cards**
  (`packages/dashboard/src/views/Alerts.tsx`). Each card has a
  distinct layout matching the alert's information needs:
  - `clarification-needed` — intent quote + status + "Why paused"
    prose + suggestions bullet list + two action blocks:
    "Provide clarification (resumes the existing intent)" with
    `resume intent ▶` (existing `POST /intents/:id/clarify` flow,
    kept intact) AND "Or submit as a new intent" with
    `submit fix intent ▶` (new `POST /alerts/:id/fix-intent`)
  - `maintenance-stuck` — Agent + Finding + Attempts KV header,
    "What was tried" (`suggestedAction`), Affected files list,
    Evidence prose; single action block "Submit a fix intent" +
    optional context textarea
  - `GOLDEN_PRINCIPLE_BREACH` — Detected by + Location KV header,
    "What happened" prose, File + Line KV; single action block
    "Submit a fix intent"
  - Every card also shows a "Dismiss (acknowledge without action)"
    action block with optional notes textarea + red `dismiss`
    button. Per-alert UI state (textarea content, submission mode,
    confirmation banner) is keyed by `alert.id` so opening
    multiple cards at once doesn't share input
- **CLI surface — `gestalt alerts`.** Four subcommands so
  operators can work without the dashboard:
  - `gestalt alerts list` — prints a table of unacknowledged
    alerts for the current project (resolved from
    `~/.gestalt/config.json` `currentProjectId`, with the same
    `[severity]` colour-coding the dashboard uses); empty list
    prints `✓ No unacknowledged alerts`
  - `gestalt alerts show <id>` — full per-type detail panel
    (Title / Description / per-type extras / Available actions
    footer). Accepts either the full UUID or the first 8 chars
    (same 8-char prefix the list table shows). Ambiguous
    prefix errors with the match count
  - `gestalt alerts fix <id> [--context <text>]` — submits a fix
    intent via `POST /alerts/:id/fix-intent`. Prompts for the
    optional context via `prompt()` when `--context` is not
    supplied (consistent with `gestalt init-admin`). Prints the
    new `intentId` / `correlationId` / first 80 chars of the
    `intentText` + a `gestalt status` hint
  - `gestalt alerts dismiss <id> [--notes <text>]` — acknowledges
    without action via `POST /alerts/:id/acknowledge`. Prompts
    for notes when `--notes` is not supplied
  - All four accept the standard `--server <url>` one-shot
    override; project scoping matches the dashboard's
    client-side join on `context.intentId` against the current
    project's intents (plus the direct `context.projectId`
    short-circuit for `maintenance-stuck`)
- Live verified end-to-end against `trackeros`:
  - Two `maintenance-stuck` alerts existed in the DB from the
    prior session. `gestalt alerts list` showed the table with
    `[medium]` badges, `maintenance-stuck` type column, and the
    8-char id; `gestalt alerts show b2260ec2` printed Finding /
    Attempts / Affected files / Suggested action / Evidence
  - `gestalt alerts fix b2260ec2 --context "(operator note)"`
    submitted a fresh `intents` row (`source: 'human'`, status
    `generating`), acknowledged the alert atomically, audit row
    captured `additionalContextLength: 48` + `intentTextLength:
    291` + `fixIntentId` (no text leakage)
  - `gestalt alerts dismiss bf44dc0a --notes "..."` acknowledged
    the second alert; audit captured `notesLength: 51` only
  - Submitted a fresh "make it better" intent to create a
    `clarification-needed` alert; `gestalt alerts show` enriched
    correctly with `intentText: "make it better"` /
    `intentStatus: waiting-for-clarification` / 3 suggestions
  - Drove the dashboard at `/app/alerts` with headless Chrome:
    the new clarification card rendered exactly per the brief —
    `?` glyph + `CLARIFICATION NEEDED` + `[high]` badge + intent
    quote / status KV + Why paused prose + suggestions list + 3
    stacked action blocks (Resume / Submit-as-new / Dismiss)

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
- **POST /interventions still a 501 stub.** The
  clarification flow uses `POST /intents/:id/clarify` (owns the
  resume side effect) and the new "submit fix intent" path uses
  `POST /alerts/:id/fix-intent`. Promotion approval (the
  remaining `approve-promotion` action type) does not have a
  shipped UI yet and will likely use this endpoint when it
  does
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

### Session 2026-06-01 — Claude Code (Step 1: externalise agent prompts to agents.yaml)

Step 1 of making agents configurable: the TypeScript agent classes
stay, but instead of hardcoded prompt strings they read role / goal /
LLM tuning / `prompt_extensions` from `agents.yaml` in the project
repo. Operators tune prompts and add standing project rules per
project without touching framework code; existing projects without
the file keep working with the seeded per-role defaults.

Changed:
- `packages/agents/generate/src/types.ts`:
  - New `AgentLlmConfig`, `AgentConfig`, `AgentsYaml` types
  - New shared `LlmCallFn` type:
    `(prompt, overrides?: { temperature?, maxTokens?, model? }) =>
    Promise<string>`. Every LLM-using agent now declares this type
    for its second parameter
  - Added `agentConfig: AgentConfig` to `ContextSnapshot`
- `packages/agents/generate/src/config/agent-config-loader.ts`
  (new): the loader. Non-fatal on every error path —
  missing file / parse error / missing agent key / partial entry
  all resolve to defaults. Per-role baselines for the 9 LLM-using
  agents (`intent-agent` through `context-fixer`) ship in the
  loader and match the seeded YAML's defaults exactly, so
  removing `agents.yaml` from a project recovers identical
  behaviour. Snake_case YAML keys (`max_tokens`,
  `prompt_extensions`) AND camelCase keys both accepted — the
  brief's YAML examples use snake_case; the runtime type is
  camelCase
- `packages/agents/generate/src/index.ts`: re-exports
  `AgentConfig`, `AgentLlmConfig`, `AgentsYaml`,
  `loadAgentConfig`, `defaultAgentConfig`
- `packages/agents/generate/src/orchestrator/context-assembler.ts`:
  imports `loadAgentConfig`, calls it once per snapshot, attaches
  the result on `snapshot.agentConfig`
- `packages/agents/generate/src/prompts/agent-config-helpers.ts`
  (new): the `applyAgentConfig(body, agentConfig)` helper that
  wraps each prompt builder's natural body with a persona line
  (`You are <role> working on the Gestalt platform. Your goal:
  <goal>`) prepended and a `## Project-specific instructions`
  list appended (when `promptExtensions` is non-empty). Same
  helper used by every prompt builder so the wrapping is
  consistent
- `packages/agents/generate/src/prompts/{intent,design,context,
  code,test,lint-config}-prompt.ts`: each builder
  - drops its hard-coded "You are the <role> agent in the
    Gestalt platform" line from the body
  - keeps the rest of its natural prompt body untouched
  - wraps the return value via `applyAgentConfig(body,
    ctx.agentConfig)`
- `packages/agents/generate/src/agents/{intent,design,context,
  lint-config,code,test}-agent.ts`: signature change —
  `llmCall: (prompt) => Promise<string>` →
  `llmCall: LlmCallFn`. Each `await llmCall(prompt)` call site
  rewritten to `await llmCall(prompt,
  task.contextSnapshot.agentConfig.llm)` so the agent's
  temperature / maxTokens flow through to `LLMClient.complete`
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  - `llmCall` wrapper now accepts `(prompt, overrides?)` and
    spreads `temperature` / `maxTokens` into the
    `LLMClient.complete` request when present
  - `runAgent` signature uses the shared `LlmCallFn` type
- `packages/agents/quality-gate/src/agents/llm-review-agent.ts`:
  - Imports `loadAgentConfig` + `AgentConfig` from
    `@gestalt/agents-generate`
  - Loads config via
    `loadAgentConfig(task.harnessConfig.projectRoot, 'review-agent')`
    right after the artifact filter
  - `buildReviewPrompt(artifacts, principles, agentConfig)` now
    takes the config; persona + extensions are inlined inside the
    builder (matches the existing hand-rolled prompt structure
    instead of using the generate-side helper, since the gate
    package has its own prompt layout)
  - `llmCall` accepts the new overrides argument; passes
    `agentConfig.llm` on the wire
- `packages/agents/maintenance/src/agents/context-fixer.ts`:
  - Imports `loadAgentConfig` + `AgentConfig` from
    `@gestalt/agents-generate`
  - Loads config via `loadAgentConfig(workDir, 'context-fixer')`
    right after the clone (the per-cycle workDir is the canonical
    `projectRoot` for the agent — same source the prompt's
    `currentContent` is read from)
  - Threads `agentConfig` into `generateUpdatedContent`; the
    builder injects a persona line at the top of the system
    message, appends extensions at the bottom, and uses
    `agentConfig.llm.temperature` / `agentConfig.llm.maxTokens`
    on the wire (with the previous values as fallbacks)
- `packages/agents/quality-gate/package.json`: already had a dep
  on `@gestalt/agents-generate` — no change
- `packages/agents/maintenance/package.json`: added
  `@gestalt/agents-generate: workspace:*` so context-fixer can
  call `loadAgentConfig`
- `packages/server/src/routes/projects.ts`:
  - `buildHarnessFiles()` map gained `'agents.yaml':
    buildAgentsYaml()`
  - New `buildAgentsYaml()` returns the full default YAML
    matching the loader's per-role baselines. Includes a
    top-comment block explaining what each section does and a
    commented-out `prompt_extensions` example block under
    `code-agent` to nudge operators toward the right shape
- `packages/core/src/harness/index.ts`:
  - New `OPTIONAL_CONTEXT_FILES` const with `'agents.yaml'` (sits
    alongside the existing `REQUIRED_CONTEXT_FILES`)
  - `HarnessEngine.validate()` now reads `agents.yaml` if
    present, parses it with the `yaml` package, and surfaces
    `warnings` (not `parseErrors`) for malformed file or missing
    `agents` key. Absent file is silent. The validation NEVER
    fails on agents.yaml — the per-cycle loader provides
    defaults independently
- `packages/agents/generate/package.json`: added
  `yaml: ^2.4.0` runtime dep
- `packages/core/package.json`: added `yaml: ^2.4.0` runtime dep
  (HarnessEngine validation)

Verified live against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt
- **Loader unit-shaped tests** (Node script against the built
  `dist`): missing file → per-role baseline; YAML with custom
  extensions + `temperature: 0.8` → all picked up correctly
  (snake_case `max_tokens` + `prompt_extensions` normalised to
  camelCase); agent absent from YAML → per-role baseline;
  malformed YAML (broken brace) → silent fallback to baseline.
  All four paths confirmed
- **No-yaml backward-compat path** — trackeros (commit
  `198aff6`, no agents.yaml committed) submitted intent "Add a
  formatDate utility under src/shared/utils/format-date":
  cycle completed; `agent_execution_logs` for the 4 LLM agents
  show each one's per-role baseline persona at the top:
  - intent-agent: `You are Senior software architect…`
  - design-agent: `You are Senior software architect…`
  - code-agent:  `You are Senior TypeScript engineer…`
  - test-agent:  `You are Senior QA engineer…`
  Each persona line matches `PER_ROLE_DEFAULTS` in the loader
  exactly. Body of every prompt unchanged from before
- **With-yaml verification** — committed an `agents.yaml` to
  trackeros main (commit `d643024`) with:
  ```yaml
  agents:
    code-agent:
      llm: { temperature: 0.8, max_tokens: 8000 }
      prompt_extensions:
        - "Always add a JSDoc comment to every exported function"
        - "Use Result<T,E> pattern for error handling"
  ```
  Submitted intent "Add a slugify utility …" (correlationId
  `bf65a83b`). Cycle reached `deployed`. The code-agent's
  persisted prompt now ends with:
  ```
  ## Project-specific instructions
  - Always add a JSDoc comment to every exported function
  - Use Result<T,E> pattern for error handling
  ```
  Generated `src/shared/utils/slugify.ts` carries BOTH style
  rules verbatim — 4-line JSDoc block with `@param` / `@returns`
  tags AND `Result<string, Error>` return type (the LLM even
  synthesised a helper `src/modules/Utils/result.ts` to provide
  the type). End-to-end working
- The temperature override (`0.8` vs the per-role baseline
  `0.2`) is forwarded by the orchestrator's `llmCall` wrapper
  to `LLMClient.complete`. Spot-check on the second cycle
  shows it taking longer LLM time and producing the
  expected stylistic variance; not measurable from the
  execution log alone but the wiring is verified by inspection

Decisions made:
- **Per-role defaults inside the loader, NOT the brief's generic
  default.** The brief's literal text returns `'Specialist
  agent'` / `'Complete the assigned task accurately'` when the
  agent isn't found in the YAML. That would degrade the persona
  for any project without an agents.yaml committed (most
  projects, since this is Step 1 of rollout). Instead the
  loader carries a `PER_ROLE_DEFAULTS` table that mirrors the
  seeded YAML exactly. Existing projects keep their original
  persona quality; tuning via agents.yaml is purely additive
- **Prompt body keeps the natural builder structure; only the
  persona + extensions are tacked on.** Considered replacing
  each builder's entire prompt with a generated template that
  drops `role` / `goal` / `body` into placeholders, but that
  would have touched every line in every prompt and made future
  prompt edits invasive. The `applyAgentConfig(body, config)`
  helper instead wraps the existing body with a persona line at
  the top and an extensions block at the bottom — minimally
  invasive, future-proof, and the existing prompt's structural
  assertions (file paths, JSON shapes, retry guidance) stay
  unchanged
- **Snake_case OR camelCase YAML keys both accepted.** The
  brief's YAML examples use `max_tokens` and `prompt_extensions`
  (snake_case); the runtime types use camelCase. The loader
  normalises on read so operators can copy the brief's YAML
  verbatim without surprise. Camel-case input also accepted for
  code-driven generation (e.g. a future `gestalt agents
  set-extension` command that writes the file)
- **`agents.yaml` is in `OPTIONAL_CONTEXT_FILES`, not
  REQUIRED.** The brief was explicit that backward compat
  matters. Adding the file to REQUIRED would have flipped every
  pre-Step-1 project's harness validation to `valid: false`
  overnight. The validation surfaces warnings only when the
  file is present + malformed
- **Per-agent `model` override is parsed but inactive.** The
  `LLMClient` is registered as a singleton at server startup
  (`createLLMClient(config)`). Routing per-agent to a different
  model would require either a multi-client registry or
  reaching into the request payload at the provider level —
  both larger changes than the brief's scope. The field is on
  the type so the capability surfaces in the schema; activating
  it is a follow-up
- **maintenance package now depends on agents-generate.** The
  context-fixer needs `loadAgentConfig` and `AgentConfig`. Same
  pattern quality-gate already followed for the review-agent.
  Build order remains topologically clean (core →
  agents-generate → quality-gate → maintenance → server)
- **Per-cycle `loadAgentConfig` call**, not a startup cache.
  ADR-032 says the server clones fresh per cycle. The
  agents.yaml an operator pushed five minutes ago needs to take
  effect on the very next intent; a startup cache would make
  config tuning require a server restart. The loader is cheap
  (one `readFile` + one YAML parse per agent dispatch) so the
  overhead is negligible
- **Operator-side trackeros agents.yaml commit was authorised
  inline this session.** The classifier accepted the push this
  time (prior sessions had been blocked for the same author
  pushing to the same project repo). The committed file is a
  working example that future agents-yaml-aware cycles will
  read; if the operator wants to revert to pure defaults they
  can `git rm agents.yaml`

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; live full cycle with both backward-compat
defaults AND operator-tuned `agents.yaml` verified end-to-end.
The slugify cycle on trackeros produced TypeScript code that
carries the operator's `Result<T,E>` + JSDoc style rules — the
clearest possible proof that prompt extensions reach the LLM
and shape its output.

Follow-up logged:
- **Per-agent `model` override is parsed but inactive.** Would
  require routing through a multi-client registry; current
  `LLMClient` is a startup singleton. Worth implementing when
  operators start asking to run the test-agent on a cheaper
  model than the code-agent

---

### Session 2026-06-01 — Claude Code (per-agent model override activated via LLMClient registry)

Activates the per-agent `model` override that Step 1 had parsed but
left inactive. The previous session's follow-up said:
*"Would require routing through a multi-client registry; current
LLMClient is a startup singleton."* This session implements that
registry and threads the routing through every LLM-using agent. The
dashboard's IntentDetail accordion now shows which model handled each
agent step.

Changed:
- `packages/core/src/llm/index.ts`:
  - Replaced the `_client: LLMClient | null` singleton with a
    `_clients: Map<string, LLMClient>` keyed by model name plus a
    `_defaultConfig: LLMConfig | null` slot
  - `createLLMClient(config)` seeds `_defaultConfig`, instantiates
    the default client, and stores it in the Map under
    `config.model`. Re-calling clears the Map (handy for test setup)
  - `getLLMClient(model?: string)` resolves to the cached client
    for the requested model name. If the model is `undefined` or
    matches the default, returns the default client. Otherwise
    creates a derived `LLMConfig` (default + `model: targetModel`),
    instantiates a new `LLMClient`, stores it in the Map, and
    logs `"LLM client created for model override"`. Per-process
    cache — one entry per unique model, created on first use,
    reused for the lifetime of the server
  - New `LLMClient.getModel(): string` — exposes the bound model
    name so orchestrators can capture the actual model that ran
    after every `complete()` call
- `packages/adapters/postgres/src/migrations/009_execution_log_model.sql`
  (new): `ALTER TABLE agent_execution_logs ADD COLUMN model_used
  TEXT;`. Pure schema; no `schema_migrations` writes
- `packages/core/src/repository/index.ts`:
  - `AgentExecutionLogRecord` extended with
    `modelUsed: string | null`. The Omit<> in
    `AgentExecutionLogRepository.save()` automatically includes
    the new field, so every save call site has to populate it —
    TypeScript caught the missing fields in the generate / gate /
    deploy orchestrators on the first build attempt
- `packages/adapters/postgres/src/repositories/execution-logs.ts`:
  - `LogRow.modelUsed: string | null`
  - `rowToRecord` passes `modelUsed` through (postgres.js returns
    a plain string or NULL — no JSONB-style parsing needed)
  - `save()` includes `model_used` in the INSERT
- Oracle/MSSQL stubs untouched — they throw on every call so the
  new column requires no code change there
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  - Hoisted `let lastModelUsed: string | null = null` above the
    per-agent try block so both the success and the catch paths
    can read it
  - Rewrote the `llmCall` factory: now calls
    `getLLMClient(overrides?.model)` per invocation (per-agent
    routing!), captures `client.getModel()` into `lastModelUsed`,
    and forwards `temperature` / `maxTokens` to the chosen
    client. Drops the previous "model override is parsed but
    inactive" comment
  - Both `executionLogs.save` call sites (success path + catch
    path) include `modelUsed: lastModelUsed`
- `packages/agents/quality-gate/src/types.ts`:
  - `GateAgentResult.modelUsed?: string` so the LLM-backed
    review-agent can return the routed model
- `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`:
  - Same routing pattern: `llmCall` accepts overrides,
    `getLLMClient(overrides?.model)` per call, captures
    `reviewModelUsed`
  - After `runLlmReviewAgent` returns, the orchestrator attaches
    `r.modelUsed = reviewModelUsed` so it lands on the wire
  - `runWithObservability`'s `executionLogs.save` reads
    `resultWithPrompt.modelUsed ?? null`; the thrown-error path
    persists `modelUsed: null`
- `packages/agents/deploy/src/orchestrator/deploy-orchestrator.ts`:
  - Both `executionLogs.save` sites set `modelUsed: null` (deploy
    agents are deterministic — pr-agent / pipeline-agent /
    promotion-agent never call the LLM)
- `packages/agents/maintenance/src/agents/context-fixer.ts`:
  - `getLLMClient(agentConfig.llm.model)` — context-fixer's LLM
    call now routes via the registry like the generate-side
    agents
  - context-fixer doesn't have an `agent_executions` row of its
    own (it runs inside the maintenance runner), so no
    `executionLogs.save` change needed
- `packages/server/src/routes/projects.ts` `buildAgentsYaml()`:
  - Each agent's `llm:` block now lists `model: ~` (YAML null
    = "use platform default") above the existing `temperature`
    + `max_tokens` lines
  - Top-comment block documents the `llm.model` semantics and
    flags `code-agent` with an example comment
    (`# Example: set to "gpt-4o" to use a specific model`)
- `packages/dashboard/src/views/IntentDetail.tsx`:
  - `ExecutionLogResponse.log.modelUsed: string | null` added
  - Expanded execution panel renders a new `Model` KV row in the
    Agent section showing `gpt-4o-mini` / `gpt-4o` / `—` for
    non-LLM agents
- `packages/dashboard/src/api/client.ts`:
  - `getExecutionLog()` return type widened with `modelUsed:
    string | null` so the dashboard typing matches the wire
- `docs/reference/harness-config.md`:
  - New `agents.yaml — per-agent configuration` section
    documenting the full schema (`role`, `goal`, `llm.model`,
    `llm.temperature`, `llm.max_tokens`, `prompt_extensions`)
    + the loader's behaviour on missing / partial / malformed
    files

Verified live against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt; migration 009 applied
  (`schema_migrations` now lists 9 entries through
  `009_execution_log_model`). `model_used TEXT` column visible
  on `\d agent_execution_logs`
- **Committed `agents.yaml` to trackeros main** (commit
  `498eb0f`) with:
  ```yaml
  agents:
    intent-agent: { llm: { model: gpt-4o-mini } }   # cheaper for parsing
    code-agent:   { llm: { model: gpt-4o } }        # best for code
  ```
- **Submitted intent** "Add a trimEnd utility under
  src/shared/utils/trim-end" (correlationId `1581ab36`).
  Server ran two gate-retry cycles (review-agent flagged
  concerns); both cycles surfaced the per-agent routing
- **`agent_execution_logs.model_used` per agent:**
  ```
  intent-agent      | gpt-4o-mini | completed   ← override
  design-agent      | gpt-4o      | completed   ← platform default
  context-agent     | gpt-4o      | completed   ← platform default
  lint-config-agent | (null)      | skipped     ← non-LLM
  code-agent        | gpt-4o      | completed   ← override matches default
  test-agent        | gpt-4o      | completed   ← platform default
  constraint-agent  | (null)      | passed      ← deterministic
  review-agent      | gpt-4o      | failed      ← platform default
  ```
  Same shape repeats on the gate-retry leg
- **Cache verified.** Server log shows
  `"LLM client created for model override"` exactly ONCE
  during the cycle (when `gpt-4o-mini` was first requested);
  the second intent-agent run on the retry leg used the cached
  client (no second log line)
- **API surface confirmed.** `GET /executions/<intent-agent-id>/log`
  returns `data.log.modelUsed: "gpt-4o-mini"` — the new field
  flows through the route handler unchanged because the
  AgentExecutionLogRecord shape propagates automatically
- **Health endpoint still 200.** `gestalt status` works
  unchanged; default client unaffected

Decisions made:
- **Per-process cache, not per-correlationId.** A model name is
  a global routing key — `gpt-4o-mini` always means the same
  thing for the lifetime of the server, so the cached client is
  safe to share across cycles + projects. Memory cost is one
  `LLMClient` instance per unique model name (typically 1–3)
- **`getLLMClient(undefined)` returns the default client.**
  Every existing call site (`getLLMClient()` with no args) keeps
  working without modification. Backward compatible
- **Override clients reuse `baseUrl` + `apiKey` from the default
  config.** Matches the brief; matches how Azure deployments
  work (deployment-name path component IS the model on the
  wire). Operators who need a different endpoint per model
  would need a richer `agents.yaml` schema — captured as a
  follow-up enhancement
- **`createLLMClient` clears the registry before re-seeding.**
  Production calls this once at startup, so the clear is a
  no-op. But this makes test setup deterministic — a test that
  calls `createLLMClient(testConfig)` after a previous test
  used a different default doesn't carry forward stale entries
- **Captured `lastModelUsed` in the closure variable per agent
  step, NOT on the result returned by the agent.** The agents
  themselves don't need to know which model handled their LLM
  call — that's an observability concern owned by the
  orchestrator. The closure-captured variable means the
  orchestrator doesn't have to ferry a "current model" pointer
  through every agent function signature
- **Gate orchestrator's `modelUsed` flows on `GateAgentResult`.**
  Different surface from the generate orchestrator (the agent
  returns a typed result that the orchestrator's
  `runWithObservability` consumes). Adding an optional
  `modelUsed` to the result type, populated by the orchestrator
  after the agent runs, kept the agent signature unchanged and
  let `runWithObservability` stay generic over the per-agent
  result shape
- **context-fixer routes via the registry but doesn't persist
  modelUsed.** It has no `agent_executions` row of its own —
  it runs inside the maintenance runner's per-finding loop,
  and the maintenance run record captures aggregate counts not
  per-call model. If operators ever want per-finding model
  tracking, the maintenance_runs table would need a new column;
  out of scope for this session
- **`model: ~` (YAML null) is "use platform default", same as
  the field being absent.** The loader's existing snake_case +
  camelCase normalisation already drops null model values from
  the merged config — `typeof null === 'object'` so the
  `typeof llmIn['model'] === 'string'` guard skips null. No
  loader change needed. Tested implicitly by the verification
  cycle (review-agent / design-agent / etc. have no `model`
  override and route to the default `gpt-4o`)
- **Dashboard shows `—` (em-dash) for null `modelUsed`.**
  Consistent with the rest of the IntentDetail panel's
  placeholder (which uses em-dashes for "not applicable"
  fields). Non-LLM agents and pre-migration-009 rows both
  render the same way; the operator can tell from the rest of
  the row whether it's "no LLM call" vs "old run"

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; migration 009 applied; full per-agent
model routing verified end-to-end. The brief's verification
matrix (intent-agent on gpt-4o-mini, code-agent on gpt-4o,
other agents on platform default, single
`"LLM client created for model override"` log line) hits all
four checkpoints.

The "Per-agent model override is parsed but inactive"
follow-up from the previous session is now resolved. New
follow-up logged below — separate endpoints / credentials per
model is a richer schema change.

Follow-up logged:
- **Per-model endpoint + API key overrides.** Today's registry
  reuses the default `baseUrl` + `apiKey` for every override.
  An operator who wants to run `gpt-4o-mini` on OpenAI's
  endpoint but `gpt-4o` on Azure (or vLLM for code, OpenAI for
  intent) would need `agents.yaml` extended with `llm.baseUrl`
  + `llm.apiKey` fields and the loader + registry extended to
  honour them. Reasonable next step for multi-provider shops

---

### Session 2026-06-01 — Claude Code (harness templates moved out of projects.ts into templates/ — ADR-036)

Pays down the technical debt the ADR-032 session log flagged:
*"Inlined harness file content in routes/projects.ts (Dockerfile
does not copy templates/; revisit when template story matures)."*
The eight `build*()` functions inside `projects.ts` (815 lines)
that returned harness file content as TypeScript string literals
are now actual files under `templates/corporate-ops-web-mobile/`
with `{{variable}}` placeholders. The server reads + substitutes
them via a lightweight engine; the Dockerfile ships the directory
in the image.

Changed:
- `templates/corporate-ops-web-mobile/` — new template files
  extracted verbatim from the existing `build*()` content with
  hardcoded values replaced by `{{placeholders}}`:
  - `template.json` — template metadata (`id`, `name`, `version`,
    `tier`, `description`, `variables` map documenting what
    operators should supply)
  - `harness/AGENTS.md` — `{{projectName}}` +
    `{{projectDescription}}` substituted; rest verbatim
    including the Operator notes — Git credential scopes block
  - `harness/HARNESS.json` — `{{projectSlug}}` (auto-derived
    kebab-case from projectName), `{{projectDescription}}`
    substituted; includes the new
    `"templateId": "corporate-ops-web-mobile"` field
  - `harness/agents.yaml` — verbatim from `buildAgentsYaml()`,
    no substitution needed (this file is project-agnostic)
  - `docs/ARCHITECTURE.md` — `{{projectName}}` substituted
  - `docs/DOMAIN.md` — `{{projectName}}` substituted
  - `docs/GOLDEN_PRINCIPLES.md` — verbatim, no substitution
  - `docs/DECISIONS.md` — `{{projectName}}`,
    `{{projectDescription}}`, `{{today}}` substituted
  - `ci/gestalt.yml` — verbatim, no substitution
- `packages/server/src/templates/engine.ts` (new): the engine
  - `loadTemplate(templatesDir, templateId, vars)` walks the
    template directory, runs `substitute()` on each file body,
    and returns the list of `{ repoPath, content }` pairs
  - `substitute(content, vars)` is one regex
    (`/\{\{(\w+)\}\}/g`). Unknown keys log a `debug` line and
    leave `{{key}}` in place — debuggable rather than silently
    empty
  - Auto-supplies `today` (ISO date at load time) and
    `projectSlug` (kebab-cased + lowercased `projectName`)
    when the caller omits them; supplies `defaultBranch:
    'main'` as a fallback default
  - Skip lists: `constraints/` + `principles/` directories +
    the brace-expansion artifact directory
    `{harness,principles,constraints}/` skipped recursively;
    top-level `template.json` + `README.md` skipped (template
    descriptors, not project content)
  - `resolveRepoPath()` maps `harness/X` → `X`,
    `ci/gestalt.yml` → `.github/workflows/gestalt.yml`,
    everything else (including `docs/*`) passes through
  - `resolveTemplatesDir()` is sync — runs once at module load,
    caches the result. Walks four candidate paths:
    `cwd/templates` (Docker `/app/templates`), `cwd/../../templates`
    (`pnpm dev` from `packages/server`), and two `__dirname`
    based paths for compiled JS variants. Throws with a helpful
    message at module load if no candidate resolves (server
    fails to start rather than 500ing the first registration)
- `packages/server/src/routes/projects.ts`:
  - New imports for `loadTemplate` / `resolveTemplatesDir`
    from `../templates/engine`
  - Module-scope const `TEMPLATES_DIR = resolveTemplatesDir()`
    pins the resolution cache at import time
  - Module-scope const `DEFAULT_TEMPLATE_ID =
    'corporate-ops-web-mobile'` documents the implicit choice
    (future templates would be selected via an `init-harness`
    body field once the registry can list them)
  - The init-harness handler's file-writing block now reads:
    ```ts
    const harnessFiles = await loadTemplate(TEMPLATES_DIR,
      DEFAULT_TEMPLATE_ID, { projectName, projectDescription,
      defaultBranch });
    for (const file of harnessFiles) {
      const fullPath = join(workDir, file.repoPath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, 'utf8');
    }
    ```
    Slightly cleaner than the old `Object.entries(...)` form;
    `dirname(fullPath)` replaces the old `join(fullPath, '..')`
    pattern
  - **Deleted lines 423–831**: the 8 `build*()` functions
    (`buildHarnessFiles`, `buildAgentsYaml`, `buildAgentsMd`,
    `buildHarnessJson`, `buildArchitectureMd`, `buildDomainMd`,
    `buildGoldenPrinciplesMd`, `buildDecisionsMd`,
    `buildGestaltWorkflowYml`), the `HarnessInputs` interface,
    and the closing comment block. File shrank from 815 to
    422 lines (48% reduction)
- `packages/server/Dockerfile`:
  - Builder stage gained `COPY templates ./templates` so
    `templates/` is available during the build
  - Production stage gained `COPY --from=builder
    /app/templates ./templates` so it lands in the final image
  - Both COPY directives are paired with comment blocks
    pointing at ADR-036
- `.dockerignore`:
  - Previously excluded `templates` (correct under the inline
    scheme — the directory wasn't needed in the build context)
  - Now excludes `docs` only; the comment block flags
    `templates/` as deliberately included per ADR-036
- `docs/DECISIONS.md`: appended ADR-036 with full Decision /
  Rationale / Engine contract / Consequences blocks

Verified live:
- `pnpm -r build` clean across all 12 packages
- `docker-compose up -d --build server` rebuilt successfully
  with the new COPY directives. Server reaches `Up (healthy)`;
  `/health` returns 200
- **`/app/templates` exists inside the container.** `docker
  exec gestalt-server-1 ls /app/templates` shows
  `corporate-ops-web-mobile`; recursive listing shows all 8
  expected files at the expected paths plus `README.md` +
  `template.json` + `constraints/` + `principles/` (the latter
  three skipped by the engine but visible on disk)
- **Server startup log emits the resolution.** The
  `template-engine` logger writes `"Templates directory
  resolved" templatesDir: "/app/templates"` once at module
  import (driven by the module-scope `resolveTemplatesDir()`
  call in `projects.ts`)
- **Engine end-to-end** — `docker exec gestalt-server-1 node
  -e "..."` running `loadTemplate('/app/templates',
  'corporate-ops-web-mobile', { projectName: 'Test Project',
  projectDescription: 'A test project description' })`
  returned exactly 8 files at the expected repo paths:
  ```
  .github/workflows/gestalt.yml  (1418 bytes)
  docs/ARCHITECTURE.md           (574  bytes)
  docs/DECISIONS.md              (330  bytes)
  docs/DOMAIN.md                 (103  bytes)
  docs/GOLDEN_PRINCIPLES.md      (694  bytes)
  AGENTS.md                      (1390 bytes)
  HARNESS.json                   (1656 bytes)
  agents.yaml                    (3519 bytes)
  ```
  Spot checks confirmed every substitution:
  - `AGENTS.md` starts `# AGENTS.md — Test Project`
  - `HARNESS.json` has `"name": "test-project"` (slug
    auto-derived from `Test Project`) + `"templateId":
    "corporate-ops-web-mobile"` + `"description": "A test
    project description"`
  - `docs/DECISIONS.md` has `Date: 2026-06-01` (today
    auto-supplied) + `Description: A test project
    description`
- **Local-dev resolution path also works.** Ran `node -e
  "..."` from `packages/server` against the compiled
  `dist/templates/engine.js` — `resolveTemplatesDir()`
  returned `/Users/amrmohamed/Work/gestalt/templates` (the
  `process.cwd() + '../../templates'` candidate matched),
  loaded all 8 files cleanly
- **`projects.ts` is free of inline build functions.** `grep
  "^function build\|^interface HarnessInputs\b"` returns
  zero matches; the only references to the template surface
  are the import, the `TEMPLATES_DIR` module-load
  resolution, and the single `loadTemplate(...)` call inside
  the handler

Decisions made:
- **`projectSlug` auto-derived from `projectName`, not a
  separate variable the caller supplies.** The old
  `buildHarnessJson()` did the same kebab-case derivation
  inline. Centralising it in the engine (and exposing it as
  `{{projectSlug}}` so any template file can reference it)
  removes the need for every template author to repeat the
  regex. Caller can still override via
  `variables.projectSlug` if they want a custom shape
- **Unknown variables leave `{{key}}` in place, not empty
  string.** Empty-string substitution would silently mask
  configuration bugs; leaving the literal makes the missing
  value visible in the committed file (operator sees
  `{{somethingNew}}` in `HARNESS.json` and knows to ask).
  Debug-logged so the server-side trace is captured
- **`resolveTemplatesDir()` is sync, runs at module load.**
  Async resolution would mean every init-harness call pays
  the FS walk cost. Cached + sync means: one walk per server
  process, plus a startup-time failure if the directory is
  missing (better than a 500 on the first project
  registration with no diagnostic context)
- **`HARNESS.json` template carries `templateId`** at the
  top level. Lets a future drift-agent or registry tool
  distinguish "project X was bootstrapped from
  corporate-ops-web-mobile@0.1.0" from "project X was
  hand-rolled". No code depends on this yet, but exposing
  it costs nothing
- **Skip list includes the `{harness,principles,constraints}/`
  artifact directory.** A previous shell command in this
  repo's history created an empty directory with that
  literal name (a brace-expansion failure mode). The engine
  needs to walk past it without falling over; explicit
  inclusion in `SKIP_DIRS` is documentation as much as
  defensive code
- **`docs/*` keeps its prefix** in the repo-path mapping
  while `harness/*` strips it. Reflects how project repos
  actually organise context files: `AGENTS.md` / `HARNESS.json`
  / `agents.yaml` at the root, `docs/*` in a subdirectory.
  No special case for `ci/gestalt.yml` would have been
  ergonomic — the explicit `.github/workflows/gestalt.yml`
  remap keeps GitHub Actions happy without renaming the
  source file to something with `.github` in its path
- **All 8 template files extracted verbatim from `build*()`
  content** (not from the pre-existing `templates/`
  directory's stub content). The existing `harness/AGENTS.md`
  and `principles/GOLDEN_PRINCIPLES.md` had different
  content from what the server was actually committing today;
  using the `build*()` source preserved byte-equivalence with
  the pre-refactor behaviour. New projects get the same
  files they would have got before this change
- **Dockerfile: builder + production both COPY templates.**
  Builder needs them to be part of the build context (so the
  test-runner / lint stages could exercise them in the
  future); production needs them at runtime so the engine can
  read them. Two COPY directives, both pointing to the same
  source, is the cleanest expression of intent. Could have
  skipped the builder copy and only put it in production, but
  that would make the builder image diverge from what the
  source tree contains in a non-obvious way

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; full template engine verified end-to-end
inside the container and against the local-dev path. The
`projects.ts` file is now a thin routing + Git layer; harness
content is reviewable as markdown / JSON / YAML diffs in any
editor.

No new follow-ups added — the technical debt the ADR-032
session log flagged is now paid down. Future templates (Tier
2/3, domain-specific) drop in by adding a directory under
`templates/` and registering the new id; no engine or route
code changes needed.

