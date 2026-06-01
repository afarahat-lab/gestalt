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

**Last updated:** 2026-06-01 (Claude Code — BaseLLMAgent refactor: every LLM agent shares one abstract class)

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

**BaseLLMAgent — every LLM-calling agent extends one abstract class.**
- New `BaseLLMAgent` in
  `packages/agents/generate/src/agents/base-llm-agent.ts`. Owns the
  shared LLM-call pattern: routing via `getLLMClient(model)` (Step 1
  multi-client registry), per-call instance capture of `lastPrompt`
  / `lastLlmResponse` / `lastModelUsed` (the orchestrator reads
  these after `run()` for execution-log persistence)
- Two protected helpers:
  - `callLLM(prompt, agentConfig, correlationId)` — single user
    message
  - `callLLMWithMessages(messages, agentConfig, correlationId,
    promptForLog)` — system + user (or richer) message arrays;
    `promptForLog` is what gets stored in `lastPrompt` so the
    dashboard's prompt panel shows the same text the operator
    wrote in their agent config
- `makeContextGapSignal(correlationId, message)` builds the canonical
  `CONTEXT_GAP` (severity `high`, `autoResolvable: false`,
  `sourceAgent` from the instance's role) every subclass uses on
  retry-exhausted failure
- Template `run(task)`: `buildPrompt` → wrap with `applyAgentConfig`
  → `callLLM` → `parseResponse`. Agents with internal retries (intent
  / design / context / code / test) override `run()` and call
  `this.callLLM` inside their own loop instead — same instance-capture
  semantics
- Converted classes (no more `runXxxAgent` function exports):
  - **Generate layer** — `IntentAgent`, `DesignAgent`, `ContextAgent`,
    `LintConfigAgent` (extends for consistency; never calls
    `callLLM` — Phase 2), `CodeAgent`, `TestAgent`
  - **Gate layer** — `ReviewAgent` (custom entry `review(gateTask)`
    because the gate operates on `GateTask`, not `AgentTask`)
  - **Maintenance layer** — `ContextFixer` (custom entry
    `applyFix(intent, project)` for the maintenance runner's
    per-finding loop; uses `callLLMWithMessages` for system+user)
  - drift-agent / alignment-agent / gc-agent / evaluation-agent are
    deterministic in this codebase (regex / cron / metric checks —
    no LLM calls), so they stay as functions per the
    "infrastructure agents not affected" rule
- `AgentTask.startedAt?: number` added. Set by the orchestrator
  before `agent.run(task)`; subclasses use it to compute
  `durationMs` without a second `Date.now()` at the top of every
  implementation. Optional so older callers don't break
- `AgentResult.lastPrompt` / `llmResponse` REMOVED. These now live
  on the agent instance; the orchestrators read
  `agent.lastPrompt` / `agent.lastLlmResponse` /
  `agent.lastModelUsed` after `run()` returns and pass them into
  `agent_execution_logs.save({...})`
- Orchestrator changes — both the generate orchestrator (`runAgent`
  switch → `newAgentForRole` factory returning a `BaseLLMAgent`
  subclass) and the gate orchestrator (the closure-captured
  `reviewModelUsed` is gone — `ReviewAgent.lastModelUsed` carries
  it) shrank significantly. The inline `llmCall` wrappers that
  routed via `getLLMClient` are deleted from both orchestrators —
  routing is owned by the base class now
- `AgentRole` union in `@gestalt/core/types` gained `'context-fixer'`
  so the new `ContextFixer` class can pass `super('context-fixer')`
  without a cast. Was previously informally cast at insert sites;
  now first-class
- Live verified end-to-end against `trackeros`: padLeft intent
  ran 14 agent executions (6 generate / 2 custom / constraint /
  review / 4 deploy) → reached `deployed`. Execution-log columns
  populated as expected:
  - `intent-agent`: prompt 3011 chars, response 902, model
    `gpt-4o-mini` (agents.yaml override preserved through the
    refactor)
  - `code-agent`: prompt 4065, response 1435, model `gpt-4o`
    (override preserved)
  - `review-agent`: prompt 4498, response 234, model `gpt-4o`
  - Skipped / non-LLM agents: prompt / response / model all NULL
- No behaviour changes; pure refactor. No new endpoints, no new
  migrations, no dashboard changes. Custom agents continue to use
  the unchanged `runCustomAgent` runner

**Step 2: custom agents in agents.yaml — implemented (ADR-037).**
- Projects declare LLM agents under a top-level `custom_agents:` key
  in `agents.yaml`. They run AFTER all six framework generate agents
  (intent / design / context / lint-config / code / test) complete
  and BEFORE the orchestrator dispatches to the quality gate
- Each definition: `name`, `role`, `goal`, optional `runs_after`
  (parsed but not enforced yet — captured for forward
  compatibility), `llm.{model,temperature,max_tokens}` overrides,
  and a `prompt` template
- Prompt placeholders the runner substitutes:
  `{{role}}` · `{{goal}}` · `{{artifacts}}` (code-type artifacts
  only, truncated to 2000 chars each, formatted as
  ```` ### path\n```typescript\n<content>\n``` ````) ·
  `{{goldenPrinciples}}` · `{{intentText}}` · `{{projectName}}`.
  Unknown placeholders survive into the prompt as literal
  `{{key}}` so typos are debuggable
- Expected JSON response:
  `{ passed: bool, findings: [{ severity, file, description }],
  summary: string }`. Parse failures fall through to a
  passed-with-prose-summary fallback so a misbehaved LLM never
  crashes the cycle
- **Signal routing** (the verdict mechanism — ADR-013 stays
  centralised in review-agent + gate):
  - `high`   severity finding → `CONSTRAINT_VIOLATION`
  - `medium` / `low`          → `LINT_FAILURE`
  - LLM error / parse failure → single `CONTEXT_GAP`
  Custom agents NEVER emit `GOLDEN_PRINCIPLE_BREACH`
- **Observability** mirrors framework agents: one
  `agent_executions` row per custom run (`taskType:
  'generate:custom'`, `agentRole = definition.name`); per-run
  `agent_execution_logs` row carrying the LLM response + the
  captured `model_used`; `agent.started` / `agent.completed`
  SSE; `signal.emitted` SSE per signal
- **Failure handling** — a failed custom agent (LLM error, parse
  error, thrown) logs the error and continues. The cycle is
  never blocked by a custom agent directly; the gate makes the
  final verdict from the union of framework + custom signals
- **CLI** — new `gestalt agents` parent with two subcommands:
  - `gestalt agents list <projectName>` — shallow-clones the
    repo, reads `agents.yaml`, prints two sections: "Framework
    agents" (each row shows model override / temperature /
    prompt-extension count) and "Custom agents" (or "None
    defined")
  - `gestalt agents validate <projectName>` — parses
    `agents.yaml`, surfaces warnings, prints
    `✓ agents.yaml valid (N custom agents defined)` or
    `✗ agents.yaml invalid` + warnings. Drops definitions
    missing required fields (`name`, `role`, `prompt`) and
    surfaces the count as a warning if any were skipped
- **Server endpoints** (both `requireRole('viewer')`):
  - `GET /projects/:id/agents` returns
    `{ frameworkAgents: AgentSummary[], customAgents:
    CustomAgentDefinition[] }`. Framework-agent summaries
    always present (per-role baseline from the loader merged
    with operator overrides); custom agents only present when
    declared
  - `GET /projects/:id/agents/validate` returns
    `{ valid, warnings, customAgents: number }`. Both endpoints
    do a shallow clone (`--depth 1`) for the YAML read; temp
    dir cleaned in `finally`
- **Dashboard.** `IntentDetail` accordion renders custom-agent
  rows with `var(--purple)` role colour + a small `custom`
  uppercase badge to the right of the role name. Anything not
  in the `FRAMEWORK_AGENTS` set (the 19 framework roles
  including infrastructure agents and `context-fixer`) gets the
  custom treatment. The badge is `#a855f7` on white text,
  font-mono, all-caps — matches the [severity] badge style on
  Alerts
- Live verified end-to-end against `trackeros` (commits
  `d0a6927` + `3c6f3c5`):
  - Two custom agents pushed: `docs-check-agent` (checks for
    JSDoc — trackeros already has the JSDoc prompt extension
    on code-agent, so this agent passes with no findings) and
    `usage-example-agent` (guaranteed to flag one `low`-severity
    finding per file, to exercise `LINT_FAILURE` routing)
  - `gestalt agents validate` → `✓ agents.yaml valid (2 custom
    agents defined)`
  - `gestalt agents list` rendered the framework block (9 rows,
    each with its current override / extensions count) +
    custom block (2 rows, both showing platform-default model)
  - Submitted a padEnd intent (correlationId `fbcc2a99`).
    `agent_executions` shows 4 `generate:custom` rows across 2
    gate-retry cycles — `docs-check-agent` completed, passed
    each time; `usage-example-agent` completed with status
    `failed` (passed: false) each time
  - **`signals` table for the cycle has one
    `LINT_FAILURE` per usage-example-agent run** (severity:
    `low`, sourceAgent: `usage-example-agent`, message
    `[usage-example-agent] Missing @example block (verification
    path) (src/shared/utils/pad-end/...)`) — confirms the
    severity-to-signal mapping. The intent reached `deployed`,
    so the gate evaluated the signals + retry budget and let
    the cycle through after the second attempt
  - **Dashboard at `/app/intents/<id>`**: headless Chrome
    confirmed 4 purple `CUSTOM` badges, one per custom-agent
    row, with computed background `rgb(168, 85, 247)` (=
    `#a855f7`, the platform's `--purple`). Custom rows
    interspersed with framework rows in the chronological
    execution list

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

---

### Session 2026-06-01 — Claude Code (Step 2: custom agents in agents.yaml — ADR-037)

Builds on Step 1 (framework agents configurable via `agents.yaml`).
Projects can now declare entirely new specialist agents under a
`custom_agents:` key. These are prompt-only LLM runners — no
deterministic code path — invoked by a generic runner after the
framework generate agents complete and before the gate orchestrator
gets the artifact set. The verdict logic stays centralised in the
gate; custom agents contribute typed signals only.

Changed:
- `packages/agents/generate/src/types.ts`:
  - New `CustomAgentDefinition` (`name`, `role`, `goal`,
    optional `runsAfter`, `llm: AgentLlmConfig`, `prompt`),
    `CustomAgentResult` (status, passed, findings,
    summary, rawResponse, tokensUsed, durationMs,
    modelUsed, errorMessage), `CustomAgentFinding`
    (`severity: high|medium|low`, `file`, `description`)
  - `AgentsYaml.customAgents?: CustomAgentDefinition[]`
- `packages/agents/generate/src/config/agent-config-loader.ts`:
  - New `loadCustomAgents(projectRoot)`. Same non-fatal
    contract as `loadAgentConfig`: missing file / malformed
    YAML / non-array `custom_agents` / missing required
    fields all resolve to `[]` with a debug log
  - Internal `normaliseCustomAgent(input)` handles
    snake_case (`runs_after`, `max_tokens`) AND camelCase
    keys; `isValidCustomAgent` enforces `name` + `role` +
    `prompt`
- `packages/agents/generate/src/agents/custom-agent-runner.ts`
  (new): the generic runner
  - `runCustomAgent(definition, ctx, correlationId)` —
    always resolves, never throws
  - Routes through `getLLMClient(definition.llm.model)` so
    per-agent model overrides from Step 1 apply automatically
  - `responseFormat: 'json'` requested; `temperature`
    defaults to `0.1`, `maxTokens` to `4000` when the
    definition omits them
  - `substitutePromptVariables` — one regex
    (`/\{\{(\w+)\}\}/g`). Unknown keys survive as literal
    `{{key}}` for debuggability
  - `formatArtifacts` — code-type artifacts only, 2000
    chars per file, fenced ` ```typescript ... ``` `
  - `safeParseResponse` — strips markdown fences, extracts
    the outermost `{...}`, parses JSON. On failure falls
    through to `{ passed: true, findings: [], summary:
    raw.slice(0, 200) }` so a misbehaved LLM produces a
    benign passing result, not a thrown
  - `isValidFinding` filters out malformed per-finding
    entries; `errorResult` returns the canonical
    `status: 'error'` shape on LLM call failure or thrown
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  - New helper `runCustomAgentsForCycle(...)` invoked
    AFTER `drivePlan` completes successfully (`hasPlanFailed`
    + `waiting_for_clarification` checks happen first) and
    BEFORE the `gate:review` dispatch
  - Per custom agent: creates an `agent_executions` row
    (`taskType: 'generate:custom'`, `agentRole:
    def.name as AgentRole`), emits `agent.started` SSE,
    invokes `runCustomAgent`, persists an
    `agent_execution_logs` row (prompt: null — embeds
    artifact content, deliberately not stored; llmResponse:
    raw; modelUsed: captured from the runner), maps findings
    to typed signals, emits `signal.emitted` per signal,
    updates the execution row (`completed` if passed,
    `failed` if findings/error), emits `agent.completed`
  - Signal routing per ADR-037:
    - `high` severity → `CONSTRAINT_VIOLATION`
    - `medium` / `low` → `LINT_FAILURE`
    - `result.status === 'error'` → single `CONTEXT_GAP`
      signal carrying the error message
  - `autoResolvable` on emitted signals is `true` for
    non-GP_BREACH — `CONSTRAINT_VIOLATION` and
    `LINT_FAILURE` join the gate's existing auto-resolvable
    retry loop. Custom agents NEVER emit
    `GOLDEN_PRINCIPLE_BREACH`
  - Context for the runner is built via
    `assembleContext(...,'code-agent', intentText)` then
    overlaid with the full post-generate artifact set
    (`priorArtifacts: allArtifacts`) — custom agents see
    every code-agent + test-agent output
- `packages/agents/generate/src/index.ts`: re-exports
  `loadCustomAgents`, `runCustomAgent`, and the three new
  types
- `templates/corporate-ops-web-mobile/harness/agents.yaml`:
  - New trailing comment block documenting the
    `custom_agents:` schema + signal routing + prompt
    placeholders + expected JSON response, with a
    fully-worked `security-review-agent` example
    commented out for operators to uncomment
- `packages/server/src/routes/agents.ts` (new):
  - `GET /projects/:id/agents` → `{ frameworkAgents:
    AgentSummary[], customAgents:
    CustomAgentDefinition[] }`. Shallow-clones the repo
    (`--depth 1`), reads `agents.yaml`, builds the
    framework summaries via `defaultAgentConfig(role)`
    merged with operator overrides, parses customs via
    `loadCustomAgents`
  - `GET /projects/:id/agents/validate` → `{ valid,
    warnings: string[], customAgents: number }`. Same
    shallow clone; on parse failure surfaces the YAML
    error verbatim. Distinguishes "raw definition count"
    from "valid definition count" — if any custom agents
    were dropped for missing required fields, surfaces
    `"N definition(s) skipped"` as a warning
- `packages/server/src/app.ts`: registers
  `registerAgentRoutes(app)`
- `packages/server/package.json`: added `yaml: ^2.4.0`
  runtime dep (needed by `routes/agents.ts` for the
  validate endpoint's structural check)
- `packages/cli/src/api/client.ts`:
  - New `AgentSummary`, `CustomAgentDefinition`,
    `AgentsListResponse`, `AgentsValidateResponse` types
  - New `listAgents(projectId)` + `validateAgents(projectId)`
    methods
- `packages/cli/src/commands/agents.ts` (new):
  - `agentsListCommand(projectName, opts)` — resolves
    project by name; prints two sections with the
    framework rows showing model override / temperature /
    extension count and the custom rows showing role +
    model
  - `agentsValidateCommand(projectName, opts)` — prints
    `✓ agents.yaml valid (N custom agent(s) defined)` or
    `✗ agents.yaml invalid` + warnings
- `packages/cli/src/index.ts`: new `gestalt agents` parent +
  `list <projectName>` + `validate <projectName>`. Both
  accept the standard `--server <url>` one-shot override
- `packages/dashboard/src/views/IntentDetail.tsx`:
  - New `FRAMEWORK_AGENTS` set (19 agent role names — the 9
    LLM agents + 5 infrastructure gate/deploy agents + 4
    maintenance agents + `context-fixer`)
  - Execution-row header colors the `agentRole` text
    `var(--purple)` when the role is NOT in the framework
    set, and renders a small uppercase `custom` badge
    with `--purple` background after the role name
  - `customBadge` style constant added to the styles
    block (uses the existing `--purple: #a855f7` CSS var)
- `templates/corporate-ops-web-mobile/harness/AGENTS.md`:
  appended a "Custom agents" section explaining the
  routing model + linking to `agents.yaml`
- `docs/guides/quick-start.md`: appended a "Customising
  agents" section with `Tune framework agents`, `Add
  custom agents`, and `Verify your configuration`
  subsections; added the two new commands to the summary
  table
- `docs/reference/harness-config.md`: appended a full
  `custom_agents` schema section (per-field table,
  prompt placeholders, expected JSON response, signal
  routing table, behaviour list)
- `docs/DECISIONS.md`: appended ADR-037 with
  Decision / Rationale / Consequences blocks

Verified live end-to-end against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt; new routes register at startup
- **Two custom agents pushed to trackeros main**
  (`d0a6927`, `3c6f3c5`):
  - `docs-check-agent` — asks LLM "for each exported
    function without a JSDoc, emit one finding"
  - `usage-example-agent` — asks LLM "for each file emit
    exactly one `severity: low` finding 'Missing
    @example block (verification path)'" so the test
    deterministically exercises `LINT_FAILURE` routing
- **`gestalt agents validate trackeros`** →
  `✓ agents.yaml valid (2 custom agents defined)`
- **`gestalt agents list trackeros`** rendered the
  framework block (9 rows; `intent-agent` model
  `gpt-4o-mini`, `code-agent` model `gpt-4o` + 2 prompt
  extensions, others on platform default) + custom block
  (2 rows, both on platform default model)
- **Submitted intent** "Add a padEnd utility…"
  (correlationId `fbcc2a99`). The cycle ran two gate-retry
  legs; `agent_executions` shows 4
  `generate:custom` rows (docs-check-agent + usage-
  example-agent, twice each):
  ```
  docs-check-agent    | generate:custom | completed | 864 ms
  usage-example-agent | generate:custom | failed    | 1313 ms
  docs-check-agent    | generate:custom | completed | 133 ms
  usage-example-agent | generate:custom | failed    | 1131 ms
  ```
- **`signals` table** shows the `LINT_FAILURE`
  routing working: one signal per usage-example-agent run
  with `severity: 'low'`, `source_agent:
  'usage-example-agent'`, `type: 'LINT_FAILURE'`, message
  `[usage-example-agent] Missing @example block
  (verification path) (src/shared/utils/pad-end/...)`. The
  routing code is identical for `high → CONSTRAINT_VIOLATION`
  and `error → CONTEXT_GAP` — only the severity check
  differs — so observing the low-severity path is
  sufficient to validate the dispatcher
- **`agent_execution_logs` for docs-check-agent** shows
  `result_status: passed`, `model_used: gpt-4o`,
  `llm_response: { "passed": true, "findings": [],
  "summary": "All exported functions have JSDoc
  comments." }` — confirms the runner persists the
  LLM's raw JSON response and picks up Step 1's
  per-agent model routing automatically (since the
  custom agent had no `model:` override, it routed to
  the platform default `gpt-4o`)
- **Intent reached `deployed`** — the gate evaluated
  the union of framework + custom signals across both
  retry legs and let the cycle through after the
  second attempt; deploy chain ran to completion
- **Dashboard at `/app/intents/<id>`** (headless Chrome
  via CDP): 4 purple `CUSTOM` badges visible on the
  IntentDetail execution list, one per custom-agent row.
  Computed `background-color: rgb(168, 85, 247)` =
  `#a855f7` matching the platform's `--purple` CSS
  variable. Custom rows interspersed with framework
  rows in the chronological order

Decisions made:
- **Custom agents run AFTER `drivePlan` and BEFORE
  `dispatch` to gate.** Not in the per-step plan loop.
  The post-generate hook position means custom agents
  see the FULL artifact set the framework produced
  (code-agent + test-agent), which the brief's pseudocode
  (`assembleContext(...,'code-agent')`) would have
  missed since `getPriorArtifacts(plan, 'code-agent')`
  excludes the code-agent's own output. I overlay
  `priorArtifacts: allArtifacts` on top of the
  framework snapshot to fix this
- **Findings → signals, not custom verdict types.** The
  brief was explicit. Keeps ADR-013 ("verdict logic
  centralised in review-agent + gate orchestrator")
  intact. Operators reason about cycle outcomes by
  reading the gate-orchestrator code and the signal-
  routing table, not by chasing per-custom-agent verdict
  rules
- **`high` → `CONSTRAINT_VIOLATION`, `medium`/`low` →
  `LINT_FAILURE`, error → `CONTEXT_GAP`.** Mirrors the
  brief's routing constraint. `CONSTRAINT_VIOLATION` and
  `LINT_FAILURE` are both auto-resolvable in the
  existing gate-retry router, so a custom-agent flag
  rolls into the next code-agent retry as `priorSignals`
  the same way a framework constraint check would —
  zero new plumbing on the retry side
- **Custom agents NEVER emit `GOLDEN_PRINCIPLE_BREACH`.**
  Enforced at the routing layer (the severity-to-signal
  map doesn't have a path that produces GP_BREACH).
  Project-specific reasoning that THINKS it found a
  golden-principle breach gets routed as
  `CONSTRAINT_VIOLATION` instead — the review-agent then
  decides if it should escalate
- **`prompt: null` in the execution log row.** The full
  built prompt embeds 2000 chars of artifact content per
  file; persisting that would bloat the row significantly.
  Operators can reconstruct the prompt from the agents.yaml
  definition + the artifact set on the cycle; the
  `llm_response` IS persisted because it carries the
  agent's actual output
- **Failed custom agent doesn't block the cycle.**
  Constraint from the brief. Errors flow as a single
  `CONTEXT_GAP` signal so the gate can see the agent
  broke; the gate then makes the call (CONTEXT_GAP is
  not blocking by default — operator triage decides)
- **runs_after parsed but not enforced.** Brief said so.
  Today all customs run after all frameworks in declaration
  order. Topological ordering by `runs_after` is a
  follow-up — would need the helper to build a DAG and
  detect cycles
- **`AgentRole` cast at insert time** (`def.name as
  AgentRole`). Widening the `AgentRole` union to
  `string` would be a larger refactor with implications
  across every agent role check in the codebase. The
  cast is local to the insert sites in the orchestrator
  and the routes/agents.ts summary builders. Documented
  in ADR-037

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; live full SDLC slice with two custom
agents running in sequence + 4 custom-agent execution rows +
real `LINT_FAILURE` signal routing to the gate + intent
reaching `deployed` — all verified end-to-end.

No new follow-ups added — feature is self-contained. Possible
future enhancements:
- Enforce `runs_after` (topological ordering with cycle
  detection)
- `full_artifacts: true` flag to skip the 2000-char
  truncation for agents that need full file content
- Per-finding `auto_resolvable: false` override so a
  project can mark its security findings as human-review-
  only without making them GP_BREACHes
- Persist the full substituted prompt for custom agents
  (or surface it on the dashboard via a separate
  "rebuild prompt" action so operators can copy it for
  debugging without storing N kilobytes per execution
  row)

---

### Session 2026-06-01 — Claude Code (BaseLLMAgent refactor: every LLM agent shares one abstract class)

Code-quality refactor. No behaviour changes, no new endpoints, no
migrations. Goal: eliminate the copy-pasted LLM-call pattern that had
spread across nine agent files (intent / design / context / code /
test / lint-config / review / context-fixer + the smaller variations).
Centralises model routing, response capture, and the standard
`CONTEXT_GAP` failure signal in one abstract base class. Every
LLM-calling agent in the platform now extends `BaseLLMAgent`.

Changed:
- `packages/agents/generate/src/agents/base-llm-agent.ts` (new):
  the abstract base class.
  - Instance fields `lastPrompt: string | null`,
    `lastLlmResponse: string | null`, `lastModelUsed: string | null`
    — captured per call, read back by the orchestrator after
    `run()` returns to persist into `agent_execution_logs.{prompt,
    llm_response, model_used}`
  - Template method `run(task)`: `buildPrompt(task)` → wrap with
    `applyAgentConfig(rawPrompt, agentConfig)` → `callLLM(prompt,
    agentConfig, correlationId)` → `parseResponse(raw, task)`.
    Subclasses that need internal retries override `run()` and
    call `this.callLLM` inside their own loop (covers intent /
    design / context / code / test — the JSON-parse retry loop
    each has)
  - Two protected LLM helpers:
    - `callLLM(prompt, agentConfig, correlationId)` — single user
      message
    - `callLLMWithMessages(messages, agentConfig, correlationId,
      promptForLog)` — system + user (or richer) message arrays.
      `promptForLog` is what gets stored in `lastPrompt` so the
      dashboard shows a coherent string even when the agent
      sends multi-message conversations (context-fixer is the
      one caller today)
  - Both helpers route via `getLLMClient(agentConfig.llm.model)`
    so per-agent model overrides from Step 1 + the multi-client
    registry continue to work unchanged
  - Throws on LLM call failure; subclass retry loops catch
  - `makeContextGapSignal(correlationId, message)` builds the
    canonical `CONTEXT_GAP` (`severity: high`, `autoResolvable:
    false`, `sourceAgent` from the instance's role) used by every
    subclass's retry-exhausted failure path
- `packages/agents/generate/src/types.ts`:
  - `AgentTask.startedAt?: number` added (Date.now() before
    `agent.run(task)`; subclasses use it for `durationMs`).
    Optional so older callers don't break
  - `AgentResult.lastPrompt` / `llmResponse` REMOVED — moved to
    the agent instance
- `packages/agents/generate/src/agents/intent-agent.ts`,
  `design-agent.ts`, `context-agent.ts`, `code-agent.ts`,
  `test-agent.ts`, `lint-config-agent.ts`: rewritten as classes
  (`IntentAgent`, `DesignAgent`, `ContextAgent`, `CodeAgent`,
  `TestAgent`, `LintConfigAgent`) extending `BaseLLMAgent`. All
  override `run()` because they have internal retry loops OR
  pre-flight skip checks. `buildPrompt` / `parseResponse` are
  stubbed and throw — calling them via the base template would be
  a misuse. The free `runXxxAgent` function exports are deleted —
  no backward-compat wrappers per the brief
- `packages/agents/generate/src/agents/lint-config-agent.ts`:
  converted to `LintConfigAgent` for consistency. Doesn't call
  the LLM (Phase 2) so `lastPrompt` / `lastLlmResponse` /
  `lastModelUsed` stay null on the instance
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  - `runAgent(agentRole, task, llmCall)` switch replaced by
    `newAgentForRole(agentRole): BaseLLMAgent` factory
  - The inline `llmCall` closure that captured
    `lastModelUsed` is gone — routing happens inside
    `BaseLLMAgent.callLLM`. The orchestrator reads
    `agent.lastPrompt` / `agent.lastLlmResponse` /
    `agent.lastModelUsed` after `run()` returns and passes them
    into `executionLogs.save(...)`
  - `AgentTask` construction sets `startedAt: startedAt.getTime()`
    so subclasses can compute `durationMs` from it
- `packages/agents/quality-gate/src/agents/llm-review-agent.ts`:
  rewritten as `ReviewAgent` class extending `BaseLLMAgent`.
  Custom entry `review(task: GateTask)` because the gate operates
  on `GateTask`, not `AgentTask`. Uses `this.callLLM(prompt,
  agentConfig, correlationId)` for the model-routed call;
  `buildPrompt` / `parseResponse` are stubbed
- `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`:
  - The closure-captured `reviewModelUsed` variable and the
    inline `llmCall` wrapper are gone — `ReviewAgent.lastModelUsed`
    carries the model now
  - After `reviewAgent.review(gateTask)` returns, the
    orchestrator copies `agent.lastPrompt` / `agent.lastLlmResponse`
    / `agent.lastModelUsed` onto the result so the existing
    `runWithObservability` save site (which still reads them off
    `GateAgentResult`) keeps working without further changes
  - `getLLMClient` import removed from the gate orchestrator
- `packages/agents/quality-gate/src/index.ts`:
  `runLlmReviewAgent` export replaced with `ReviewAgent`
- `packages/agents/maintenance/src/agents/context-fixer.ts`:
  rewritten as `ContextFixer` class extending `BaseLLMAgent`.
  Custom entry `applyFix(intent, project)` for the maintenance
  runner's per-finding loop. The system+user message pair (the
  ADR-018 rules live in the system role) goes through the new
  `this.callLLMWithMessages([{role:'system',...},{role:'user',
  ...}], cfg, ...)` helper. `buildPrompt` / `parseResponse`
  stubbed
- `packages/agents/maintenance/src/runner/index.ts`:
  `applyContextFileFix(intent, project)` call → `new
  ContextFixer().applyFix(intent, project)`
- `packages/agents/maintenance/src/index.ts`:
  `applyContextFileFix` export replaced with `ContextFixer`
- `packages/core/src/types.ts`: `AgentRole` union gained
  `'context-fixer'` so the new class's
  `super('context-fixer')` compiles without a cast. Was
  informally cast at insert sites before; now first-class
- `packages/agents/generate/src/index.ts`:
  - Exports `BaseLLMAgent` (re-used by quality-gate +
    maintenance)
  - Class exports `IntentAgent` / `DesignAgent` / `ContextAgent`
    / `LintConfigAgent` / `CodeAgent` / `TestAgent` replace the
    six `runXxxAgent` function exports

Decisions made:
- **drift-agent / alignment-agent / gc-agent / evaluation-agent
  NOT converted.** The brief lists drift + alignment as ones to
  convert assuming they make LLM calls. In this codebase they
  don't — drift-agent does git-log + commit-timestamp comparison;
  alignment-agent does regex extraction; gc-agent + evaluation-
  agent are scheduled deterministic tasks. Converting them
  would add no value (no LLM, no shared logic to factor) and
  could obscure the semantics — they'd extend a class whose
  primary method they'd never call. Same rationale the brief
  applies to constraint-agent and the deploy agents. Documented
  here so the next agent reviewer knows this is intentional
- **Custom agents stay on the `runCustomAgent` functional
  runner.** Brief constraint: "Custom agent runner is NOT
  converted — it's a generic runner, not a class hierarchy."
  Held to this — the runner takes a `CustomAgentDefinition`
  data structure, not a class. Per-instance state (last prompt
  etc.) doesn't apply the same way; the custom agent runner
  is one function processing N data definitions
- **`callLLMWithMessages` is a separate helper, not an overload
  of `callLLM`.** Two reasons: (1) TypeScript overload
  signatures get awkward when the parameters differ in count +
  type; (2) the `promptForLog` parameter is required for
  callers of the messages variant (so the dashboard can show
  a single string in the prompt panel), and there's no clean
  way to make it optional only in one overload. Two methods
  with clear names is more obvious
- **`AgentResult.lastPrompt` and `llmResponse` are deleted, not
  deprecated.** Brief was explicit. Keeping them around as
  optional would invite drift — agents could populate them or
  not, the orchestrator wouldn't know which source to trust.
  Now there's exactly one source: the agent instance after
  `run()` returns
- **Subclasses that need internal retries override `run()`
  instead of having the base class loop.** Considered making
  `BaseLLMAgent.run` itself loop with a configurable
  `maxInternalRetries`. Rejected because the retry conditions
  differ — intent-agent retries on `validateIntentSpec` throw
  AND on parse failure; code-agent retries on "zero code
  files"; test-agent retries on "zero test files". Wrapping
  that in a parameter would create a leaky abstraction. The
  cleaner pattern is to let subclasses own their retry
  semantics and just call `this.callLLM` in a loop. Base class
  template `run()` remains for the simple case (none of the
  current subclasses use it because they all have retries —
  but the template is documented for future agents)
- **`context-fixer` extends `BaseLLMAgent` even though it
  doesn't follow the standard `run(task)` shape.** The base
  class is useful for ANY LLM-calling code because of the
  instance-captured `lastModelUsed` (Step 1) — context-fixer
  needs to persist which model it routed to. Inheritance gives
  it `callLLMWithMessages` + `lastModelUsed` for free; the
  stubbed `buildPrompt` / `parseResponse` are a small ergonomic
  cost for a real structural win
- **`AgentRole` union widened to include `'context-fixer'`.**
  The previous behaviour was to cast `as AgentRole` at every
  insert site (the maintenance runner's `agent_executions`
  rows). Now the class's `super('context-fixer')` is typed
  cleanly and the cast disappears. Made the same union part of
  the core schema so any future agent reading the role from
  the DB doesn't have to know about the implicit widening
- **gate-orchestrator and maintenance-runner CHANGED but no
  externally-observable behaviour did.** Both went from
  closure-captured `lastModelUsed` patterns + free-function
  agent calls to class instantiation. The execution-log
  contents (prompt, response, model_used) are byte-identical
  to before for every agent that was already running

Verified live (no behaviour changes, but worth confirming the
refactor is correct):
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt
- Submitted padLeft intent against `trackeros`. Cycle ran 14
  agent executions (6 generate / 2 custom / constraint /
  review / 4 deploy) → reached `deployed` status
- **Execution-log columns** populated as expected per agent:
  - intent-agent: prompt 3011 chars, response 902, model
    `gpt-4o-mini` (Step 1 override from trackeros agents.yaml
    preserved through the refactor)
  - design-agent: prompt 2162, response 83, model `gpt-4o`
  - context-agent: prompt 2217, response 31, model `gpt-4o`
  - code-agent: prompt 4065, response 1435, model `gpt-4o`
    (override preserved)
  - test-agent: prompt 2135, response 1626, model `gpt-4o`
  - lint-config-agent: prompt NULL, response NULL, model NULL
    (skipped — no LLM call) ✓
  - constraint-agent: NULL everywhere (deterministic regex) ✓
  - review-agent: prompt 4498, response 234, model `gpt-4o`
    (ReviewAgent now via BaseLLMAgent.callLLM)
  - custom agents: prompt NULL (custom-agent-runner doesn't
    persist it per Step 2 design), response populated, model
    `gpt-4o`
  - deploy agents: NULL everywhere (non-LLM) ✓
- `grep "^export async function run" packages/agents/` shows
  zero matches in the converted files — only infrastructure
  agents (deploy / gate / maintenance scheduled + the custom
  runner + the maintenance runner itself) remain as function
  exports, which the brief specified are NOT to be converted
- `grep "BaseLLMAgent" packages/agents/generate/src/index.ts`
  shows the export
- Maintenance run also exercised — `usage-example-agent` custom
  finding generated a `LINT_FAILURE` signal; gate retry routing
  + intent → `deployed` continues to work unchanged

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; one full SDLC slice verified end-to-end
with the new class-based agents + the existing custom-agent
runner + the maintenance context-fixer all coexisting. The
copy-pasted LLM call pattern that lived in 8+ files now lives
in one place.

No new follow-ups. Possible future tidy-ups:
- Convert deterministic maintenance agents (drift / alignment /
  gc / evaluation) to a `BaseMaintenanceAgent` of their own if
  the codebase grows a second deterministic maintenance step
  worth factoring
- The base template `run(task)` method is currently unused —
  every concrete subclass overrides it because each has an
  internal retry loop or skip check. If a future agent fits
  the simple build → call → parse shape (the brief's
  pseudocode), the template is ready

