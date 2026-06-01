# SUMMARY.md — design-chat snapshot

_Generated from STATE.md + last three SESSION_LOG entries. Do not edit by hand.
Source: docs/claude/STATE.md + docs/claude/SESSION_LOG.md._

---


## Current state (keep this section current)

**Last updated:** 2026-06-01 (Claude Code — `POST /interventions` (ADR-021): resume, abort, acknowledge-breach, request-clarification)

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
- All eleven migrations apply on startup: `001_initial`, `002_local_auth`,
  `003_projects`, `004_deployments`, `005_maintenance`,
  `006_intent_clarification`, `007_execution_logs`,
  `008_finding_attempts`, `009_execution_log_model`,
  `010_user_management`, `011_interventions`
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
- **Two-level user management wired end-to-end (migration 010).**
  Platform roles (`platform-admin` | `user`) on `users.role`; per-project
  roles (`project-admin` | `editor` | `reader`) on the new
  `project_memberships` table. Legacy `admin` / `operator` / `viewer`
  values were remapped in the migration so `gestalt init-admin`'s
  original user is now `platform-admin`; everyone else became `user`.
  - **`requireRole`** keeps the legacy string signature
    (`admin` | `operator` | `viewer`) for backward compatibility with
    every existing route guard. The mapping after 010:
    `admin` → platform-admin only; `operator` / `viewer` → platform-admin
    bypasses the project check, regular `user` must have a membership on
    the project the request targets. The middleware resolves the
    project ID from `params.id` (only when `routerPath` starts with
    `/projects/:id`) or `query.projectId` — so `/intents/:id/clarify`
    and `/executions/:id/log` are NOT mistakenly treated as project-
    scoped. Routes without a project context fall through to
    "authenticated user is enough"; route-level handlers enforce
    further checks where needed (e.g. POST /intents passes the
    projectId in the body)
  - **POST /projects** auto-assigns the creator as `project-admin` so
    they survive the new membership-aware GET /projects filter. The
    migration also backfills a project-admin row for every previously-
    registered project (keyed by `projects.created_by`)
  - **GET /projects** returns ALL projects for `platform-admin` and
    only membership-matched projects for `user`. The dashboard's
    sidebar selector + every view that uses ProjectContext picks up
    the filtered set automatically
  - **Deactivation is enforced at TWO layers.** `local-provider.authenticate`
    refuses login for any user whose `deactivated_at` is non-null
    (returns `ACCESS_DENIED`, surfaced as HTTP 403). The JWT
    validation middleware re-checks `user.deactivatedAt` on every
    request so an existing JWT cannot outlive the deactivation —
    the very next request after the soft-delete returns
    `403 ACCOUNT_DEACTIVATED`
  - **Self-protection guards** (server-side, no way to bypass via the
    API): cannot deactivate yourself, cannot demote yourself from
    platform-admin, cannot demote/remove the last project-admin from
    any project. All 400 with explicit error codes
    (`SELF_DEACTIVATE_FORBIDDEN`, `SELF_DEMOTION_FORBIDDEN`,
    `LAST_PROJECT_ADMIN`)
  - **CLI:** `gestalt users list [--search]`, `users add <email>`
    (TTY prompts for display name, role, optional password), `users
    role <email> <platform-admin|user>`, `users deactivate <email>`,
    `users assign <email> <projectName> --role <role>`,
    `users unassign <email> <projectName>`, `users members
    <projectName>`. Each command resolves the user by email via
    `GET /users?search=<email>` and the project by name via
    `GET /projects` — no UUIDs in the operator's mouth
  - **Dashboard Admin view** at `/app/admin` — platform-admin only.
    `RequirePlatformAdmin` guard on the route; the sidebar link is
    ABSENT FROM THE DOM (not just hidden) for regular users; a
    regular user typing `/app/admin` directly is bounced via
    `<Navigate to="/" replace>`. Two tabs: Users (table with
    expandable rows showing per-user project memberships, in-line
    role/membership editing, add-user modal supporting an optional
    password + initial assignments) and Projects (per-project member
    list with role change + add/remove)
  - GP-002 — every mutation (`user.created` / `user.updated` /
    `user.deactivated` / `project.member-added` /
    `project.member-role-updated` / `project.member-removed`) writes
    an audit row with previous + new values. No clarification-text-
    style content is logged
  - Verified live: migration 010 applies cleanly; the original `a@b.c`
    admin became `platform-admin`; backfilled membership for
    trackeros. Created `test@example.com` (`user`), assigned editor
    on trackeros; admin sees 2 projects (member-test + trackeros)
    while test sees only 1 (trackeros). Deactivated test user →
    login 403 + existing JWT 403. Self-protection: tried to
    deactivate / demote self → 400. Last project-admin guard:
    tried to demote and remove → 400 `LAST_PROJECT_ADMIN`. Dashboard
    drive (headless Chrome + CDP): platform-admin sees the `★ Admin`
    nav link, `/app/admin` renders Users table; regular `user` has
    NO admin link in the DOM and `/app/admin` bounces to `/app/`
- **Handler-level project membership enforcement on body-projectId
  routes.** Closes the gap the prior user-management session left
  open: `requireRole('operator')` only resolves projectId from
  `params.id` or `query.projectId`, so a regular `user` could
  otherwise submit intents against any project ID they knew (no
  membership row required). New `requireProjectMembership(userId,
  platformRole, projectId, minRole)` helper in
  `packages/server/src/auth/middleware.ts` returns the membership
  record on success (or `null` for platform-admins who bypass) and
  throws `ProjectMembershipError` with one of
  `NOT_PROJECT_MEMBER` / `INSUFFICIENT_PROJECT_ROLE` on failure.
  `sendProjectMembershipError(reply, err)` shapes the canonical
  403 body (`{ error: 'FORBIDDEN', code, message }`).
  Five route handlers now call the helper:
  - **`POST /intents`** — editor minimum on the body's projectId
  - **`POST /intents/:id/clarify`** — editor minimum, resolved from
    the loaded intent's `projectId` (not `params.id`, which is an
    intent UUID)
  - **`POST /maintenance/trigger`** — editor minimum on the body's
    projectId
  - **`DELETE /maintenance/findings/:projectId`** — editor minimum
    (route param is `:projectId` not `:id`, so the preHandler's
    routerPath check doesn't match; same shape as the trigger gap)
  - **`POST /alerts/:id/fix-intent`** — editor minimum on the
    resolved-from-alert projectId
  - **`POST /projects/:id/config`** — **project-admin minimum**
    (editing HARNESS.json shapes deploy/maintenance for every
    operator on the project; editor isn't enough)
  Role rank `project-admin > editor > reader` is hard-coded in the
  helper as `{reader:1, editor:2, 'project-admin':3}`; comparison
  is `< minRole rank → INSUFFICIENT_PROJECT_ROLE`. platform-admin
  bypasses every check (early return inside the helper).
  CLI surfaces the new codes: new `handleMembershipForbidden(err)`
  in `packages/cli/src/ui/server-errors.ts` parses
  `ApiClientError.body` for the `{ code, message }` shape and
  prints a contextual hint (`gestalt users assign ...` for
  `NOT_PROJECT_MEMBER`; "ask a project-admin to upgrade your role"
  for `INSUFFICIENT_PROJECT_ROLE`). Wired into the catch blocks of
  `gestalt run`, `gestalt maintenance trigger`,
  `gestalt maintenance reset-findings`, and
  `gestalt projects set-adapter`. Generic 5xx / non-403 paths
  unchanged — `handleMembershipForbidden` returns false so the
  existing "Failed: ..." branch still runs.
  Verified live against `trackeros`:
  - **Reader** (`reader@example.com`, role `reader`) — `POST
    /intents` → 403 `INSUFFICIENT_PROJECT_ROLE`; `POST
    /maintenance/trigger` → same; `GET /intents?projectId=…` →
    200 with the project's intents (reader CAN view)
  - **Editor** (`editor@example.com`, role `editor`) — `POST
    /intents` → 201 (intent queued); `POST /maintenance/trigger`
    (drift-agent) → 200 with the completed run record; `POST
    /projects/:id/config` → 403 `INSUFFICIENT_PROJECT_ROLE`
    "Minimum project role required: project-admin"; trying to
    submit an intent against a different project (where they are
    NOT a member) → 403 `NOT_PROJECT_MEMBER`
  - **Platform-admin** (`a@b.c`) — every operation succeeds
    regardless of membership; created an intent against a project
    they were not a member of, set its config — both passed the
    auth check (the second 500'd on the placeholder Git URL, which
    is downstream of the auth check)
  - **CLI** — `gestalt run` / `gestalt maintenance trigger` /
    `gestalt projects set-adapter` as a non-member each print the
    typed friendly message instead of a raw JSON dump
- **`POST /interventions` (ADR-021, migration 011).** Operator
  responses to escalated intents. Four typed actions — the same
  vocabulary ADR-021 defined — implemented end-to-end:
  - `resume` — false positive; marks the GP_BREACH signal resolved
    by literal `'human'` (the repo-level guard enforces that),
    acknowledges the alert, creates the intervention row, and
    dispatches `deploy:pr` with the artifact set rebuilt from
    `artifacts.findByCorrelationId` (same shape the gate uses on a
    `pass` verdict). Intent transitions `escalated → deploying`,
    then NoOp/GitHub Actions adapter completes the cycle to
    `deployed`
  - `abort` — real breach; acknowledges the alert, creates the
    intervention row, transitions intent to `failed`. No deploy
    dispatch, no signal resolution (the breach IS the truth)
  - `acknowledge-breach` — **notes are required** (400 if
    omitted); marks the signal resolved (human), acknowledges the
    alert, creates the intervention row with the notes persisted
    to `interventions.notes`, transitions to `failed`. **GP-006:
    the audit row carries only `notesLength` + `signalId` — the
    note text never reaches `audit_log`**. The text is auditable
    via direct query against `interventions`
  - `request-clarification` — creates a `clarification-needed`
    alert (severity `high`) carrying `triggeredBy: 'intervention'`
    + the breach signal ids in JSONB context, transitions intent
    to `waiting-for-clarification`. The existing
    `POST /intents/:id/clarify` flow then resumes the cycle on
    operator follow-up
  - All four write an `interventions` row (migration 011 —
    `(intent_id, correlation_id, alert_id, action, actor_id,
    notes, created_at)`) plus an audit row
    (`intervention.resume` / `.abort` / `.acknowledge-breach` /
    `.request-clarification`). The `alert_id` is nullable —
    `resume` and `abort` populate it from the open GP_BREACH
    alert when present; `request-clarification` creates a new
    alert so the audit metadata carries that id instead
  - **Edge cases:**
    - Intent not in `escalated` status → 409
      `INVALID_INTENT_STATUS` with the current status surfaced in
      the message. Verified live for `failed` and `deployed`
      callers
    - Intent not found → 404
    - Unknown action → 400 with the four valid values listed
    - `acknowledge-breach` with empty notes → 400
    - Non-member tries to intervene → 403
      `INSUFFICIENT_PROJECT_ROLE` (the helper from the prior
      session — editor minimum)
  - **`GET /interventions?intentId=<id>`** — viewer minimum.
    Returns the intent's intervention history (one row per
    operator decision; ascending by `created_at`) for the
    dashboard's IntentDetail Interventions section
  - **Dashboard.** Alerts view: GP_BREACH alert cards render a
    new `BreachInterventionBlock` with three buttons — `▶ Resume
    (false positive)`, `✗ Abort intent`, and an `⚑ Acknowledge
    breach` button gated on a required notes textarea. Submitting
    sends the typed `POST /interventions` call; on success the
    card disappears, a green confirmation banner shows for 1.5 s,
    then the list refreshes. Abort confirms via the browser
    confirm dialog before firing. The fourth action
    (request-clarification) is reachable only from the CLI today
    — the dashboard rarely needs it (operator can submit a fresh
    intent / use the existing clarification flow)
  - **IntentDetail Interventions section.** When the intent is in
    a status where interventions could exist (`escalated`,
    `failed`, `deploying`, `deployed`,
    `waiting-for-clarification`), `GET /interventions?intentId=`
    fetches the history and renders one card per intervention
    with a coloured action chip, the actor's id-prefix, the
    timestamp, and the notes prose (or `(no notes)` when null)
  - **CLI `gestalt alerts`:** three new subcommands —
    `resume <alertId>`, `abort <alertId>` (prompts `y/N`
    confirmation), `acknowledge <alertId>` (prompts for required
    notes when `--notes` is omitted). Each resolves the
    `intentId` by re-using the existing
    `fetchAlertByIdOrPrefix(client, alertIdPrefix)` helper and
    lifting `alert.intentId` (or
    `alert.context.intentId`) — same 8-char prefix surface the
    other alerts subcommands use
  - All four `POST /interventions` actions verified live against
    `trackeros`: `abort` and `acknowledge-breach` ran against
    pre-existing escalated intents from prior sessions
    (`562efa69`, `cd4c1846`); `request-clarification` against a
    third (`b86e010f` → transitioned to
    `waiting-for-clarification` with a fresh clarification alert
    created); `resume` against a synthetic
    `verify-intervention-resume` intent — full deploy chain
    completed (5 `deployment_events` rows in order
    `pr-opened → pipeline-triggered → pipeline-passed →
    promoted-staging → promoted-production`; intent reached
    `deployed`). GP_BREACH signal flipped to
    `resolved_by = 'human'`, alert acknowledged, intervention
    row carries `alert_id` populated. Audit for the
    `acknowledge-breach` test: `metadata = {"notesLength": 123,
    "signalId": "432b33d9-…", "alertId": null, "ip": "…"}` —
    no `notes` text anywhere in the audit row.
    `GET /interventions?intentId=<resume_id>` returned the
    intervention record with the expected shape. CLI
    `alerts abort` and `alerts acknowledge --notes` both
    succeeded against synthetic GP_BREACH alerts seeded for
    each
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
- `users`       — upsert, findById, findByIdpSubject, findByEmail,
  list (with search + includeDeactivated filters), count, updateRole,
  updateDisplayName, deactivate. `role` column constrained to
  (`platform-admin` | `user`); `deactivated_at` column nullable, set
  by the soft-delete path; auth middleware rejects any request whose
  user has a non-null value
- `memberships` — addMember (UPSERT on `(user_id, project_id)` — second
  call updates the role and `assigned_by`), updateRole, removeMember,
  findByProject, findByUser, findMembership, countAdmins (used by the
  last-project-admin guard in the route). Migration 010 backfills a
  `project-admin` row for every existing project keyed on
  `projects.created_by` so previously-registered projects survive the
  membership-aware GET /projects filter
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
- `interventions` — create, findByIntentId, findByCorrelationId.
  Migration 011 (ADR-021). One row per `POST /interventions`
  call; `(intent_id, alert_id)` FK both to live tables (alert_id
  nullable). `action` constrained to the four ADR-021 values via
  CHECK; `notes` nullable and stores the operator's
  acknowledge-breach text (audit_log carries only the length,
  per GP-006)

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

## Recent session entries

### Session 2026-06-01 — Claude Code (user management v1)

Closes the long-standing "every authenticated operator sees every
project" model the platform shipped with. Introduces a two-level role
model — platform roles on the `users` table and per-project roles on a
new `project_memberships` table — plus deactivation, the `gestalt
users` CLI, and a platform-admin-only Admin view in the dashboard.

Changed:
- `packages/adapters/postgres/src/migrations/010_user_management.sql`
  (new): drops the old role default, remaps legacy values
  (`admin` → `platform-admin`; `operator` / `viewer` → `user`), adds
  the `users_role_check` constraint, sets the new column default to
  `user`, adds the `deactivated_at TIMESTAMPTZ` column, creates the
  `project_memberships` table (UNIQUE on `(user_id, project_id)`),
  and backfills a `project-admin` row for every existing project
  (keyed on `projects.created_by`) so previously-registered projects
  survive the membership-aware GET /projects filter
- `packages/core/src/types.ts`: `UserRole` narrowed to
  `'platform-admin' | 'user'`; new `ProjectRole`
  (`'project-admin' | 'editor' | 'reader'`). Re-exported from
  `@gestalt/core`
- `packages/core/src/repository/index.ts`: `UserRecord` gained
  `deactivatedAt`. `UserRepository` gained `findByEmail`,
  `updateRole`, `updateDisplayName`, `deactivate`; `list()` widened
  with optional `{ search, includeDeactivated }`. New
  `ProjectMembershipRecord` + `ProjectMembershipRepository` (8
  methods: `addMember` upserts on `(user_id, project_id)`,
  `updateRole`, `removeMember`, `findByProject`, `findByUser`,
  `findMembership`, `countAdmins`). `RepositoryRegistry` gained
  `memberships`
- `packages/adapters/postgres/src/repositories/users.ts`: rewrote to
  expose the new methods. **postgres.js auto-camelCases column names
  at the client level** (`transform: { column: postgres.toCamel }` in
  `client.ts`) — the returned row already matches `UserRecord`, so
  the `rowToRecord` helper only normalises the nullable `idp_groups
  → idpGroups` array. An earlier draft hand-mapped `row.display_name
  → displayName` and the field went out as `undefined`, causing
  postgres.js to reject the upsert with `UNDEFINED_VALUE` on every
  login. Same trap applied to memberships.
  `packages/adapters/postgres/src/repositories/memberships.ts` (new):
  `PostgresProjectMembershipRepository` — no row→record mapping
  needed (postgres.js camelCases the column names automatically);
  the helper is just `(row) => row` shaped
- `packages/adapters/postgres/src/index.ts`: wires
  `PostgresProjectMembershipRepository` into `createPostgresAdapter`
- `packages/adapters/{oracle,mssql}/src/repositories/memberships.ts`
  (new): throw-stub `*ProjectMembershipRepository` classes so
  interface drift forces a build break in both. Re-exported from
  each adapter's `index.ts`
- `packages/server/src/auth/types.ts`: `UserRole` narrowed;
  `PlatformUser` gained `deactivatedAt`
- `packages/server/src/auth/role-mapper.ts`: rewritten — `hasPermission`
  removed (its old role-hierarchy lookup no longer matches the new
  model); `resolveRole` for local auth now defaults to `user`; new
  `isPlatformAdmin(role)` helper. The server's public `index.ts` now
  re-exports `isPlatformAdmin` in place of `hasPermission`
- `packages/server/src/auth/middleware.ts`: `requireRole` rewritten.
  Keeps the legacy `'viewer' | 'operator' | 'admin'` parameter so
  every existing route guard continues to compile. The mapping after
  migration 010:
  - `'admin'` → platform-admin only; everyone else 403
  - `'operator'` → platform-admin bypasses; regular `user` must have
    a membership AND its role must NOT be `reader`
  - `'viewer'` → platform-admin bypasses; regular `user` must have
    any membership
  The project ID is resolved via a new `getProjectIdForCheck` helper:
  `params.id` is used ONLY when `routerPath` starts with
  `/projects/:id`, so `POST /intents/:id/clarify` and
  `GET /executions/:id/log` are never misread as project-scoped.
  Routes without a project context fall through to "authenticated
  user is enough"; route-level handlers still enforce specifically
  where the projectId lives in the body. **A deactivated-user check
  is in the JWT validation preHandler itself** — `if (user.deactivatedAt)
  return 403 ACCOUNT_DEACTIVATED;` — so an existing JWT cannot
  outlive a deactivation
- `packages/server/src/auth/auth-manager.ts`: `createSession` local-
  auth default role changed from `'operator'` to `'user'`; existing
  user's role is still preserved. `upsertUser` callback type now
  Omits `deactivatedAt`
- `packages/server/src/auth/providers/local.ts`: rejects login for
  deactivated users with `AuthenticationError('ACCESS_DENIED')`
- `packages/server/src/auth/routes.ts`: `ACCESS_DENIED` now surfaces
  as HTTP 403 (alongside `LOCAL_IN_PRODUCTION`)
- `packages/server/src/auth/config-loader.ts`: default identity
  config `defaultRole: 'viewer'` → `'user'`
- `packages/server/src/routes/admin.ts`: first-boot setup writes
  `role: 'platform-admin'` instead of `'admin'`; comments + audit
  metadata updated to match
- `packages/server/src/routes/projects.ts`:
  - **POST /projects** auto-assigns the creator as `project-admin`
    right after the project is created (without it, a non-platform-
    admin user who registered a project would immediately lose access
    on the next `GET /projects` call)
  - **GET /projects** returns ALL projects for `platform-admin` and
    only membership-matched projects for `user`. The previous "every
    authenticated operator sees every project" rule (introduced after
    the original owner-only filter was found too restrictive) is now
    too permissive for the corporate use case
- `packages/server/src/routes/users.ts` (new):
  - `GET /users [?search]` — platform-admin only; returns the full
    user list including deactivated rows with the deactivation
    timestamp visible
  - `POST /users` — platform-admin only; creates a user with optional
    password (creates a `local_auth` row when present, otherwise the
    user can only authenticate via IdP) and optional initial
    `projectAssignments` (creates membership rows in one call)
  - `GET /users/:id` — platform-admin OR self; returns the user
    record plus their full memberships
  - `PATCH /users/:id` — platform-admin only; updates `role` and/or
    `displayName`. Self-demotion blocked with
    `SELF_DEMOTION_FORBIDDEN` (400)
  - `DELETE /users/:id` — platform-admin only; soft-deletes
    (sets `deactivated_at = NOW()`). Self-deactivation blocked with
    `SELF_DEACTIVATE_FORBIDDEN` (400). Already-deactivated users
    return 204 idempotently
- `packages/server/src/routes/memberships.ts` (new):
  - `GET /projects/:id/members` — any project member
    (`requireRole('viewer')` resolves membership via params.id)
  - `POST /projects/:id/members` — operator+ on the project OR
    platform-admin; returns 201 on insert, 200 on role change
  - `PATCH /projects/:id/members/:userId` — same auth; demoting the
    last `project-admin` returns 400 `LAST_PROJECT_ADMIN`
  - `DELETE /projects/:id/members/:userId` — same auth; removing the
    last `project-admin` returns 400 `LAST_PROJECT_ADMIN`
- `packages/server/src/app.ts`: registers the new users + memberships
  routes
- `packages/cli/src/api/client.ts`: typed wrappers for the 9 new
  endpoints (listUsers / createUser / getUserDetail / updateUser /
  deactivateUser / listProjectMembers / addProjectMember /
  updateProjectMemberRole / removeProjectMember); added a `patch`
  helper; the `delete` helper now returns void on 204
- `packages/cli/src/commands/users.ts` (new): the seven subcommands
  per the brief (`list`, `add`, `role`, `deactivate`, `assign`,
  `unassign`, `members`). User-by-email resolution goes through
  `GET /users?search=<email>`; project-by-name resolution through
  `GET /projects`. Confirmation prompt on `deactivate`
- `packages/cli/src/index.ts`: registers the new `gestalt users`
  parent + 7 subcommands
- `packages/dashboard/src/types.ts`: `UserRole` narrowed to the new
  model; new `ProjectRole`, `UserSummary`, `MembershipSummary`,
  `UserDetail`, `ProjectMember`, `CreateUserParams` types
- `packages/dashboard/src/api/client.ts`: matching set of typed
  methods (8 endpoints); new `patch` helper; `delete` returns
  `T | void` to handle the 204 path
- `packages/dashboard/src/context/CurrentUserContext.tsx` (new):
  fetches `/auth/me` once on mount, caches the role, and bounces to
  `/app/login` on 401 (mirrors `ProjectContext`'s defensive 401
  handling). Wired into `App.tsx` inside `RequireAuth` so the fetch
  only fires for signed-in sessions
- `packages/dashboard/src/components/layout/Layout.tsx`: sidebar
  conditionally renders the `★ Admin` nav link ONLY for
  `platform-admin` users — the `<li>` is completely absent from the
  DOM for everyone else (per the brief). Reads from
  `useCurrentUser()`
- `packages/dashboard/src/views/Admin.tsx` (new): two tabs:
  - **Users** — table with `+ Add user` / search / refresh toolbar;
    expandable rows showing the user's project memberships with
    in-line role change + remove + "Assign to project" picker;
    role badge (`★ Platform admin` / `User`) is clickable and
    confirms before toggling (server-side guard ensures self-
    demotion fails); red `Deactivate` button hidden for self
  - **Add user modal** — email + display name + role radio
    (User / Platform admin) + optional password (min 8 chars,
    blank for IdP-only users)
  - **Projects** — per-project member list with role change +
    add/remove. Add-member picker excludes deactivated users
  - All API errors surface either via a dismissible red strip at
    the top of the section or `window.alert` (for inline actions);
    server-side guards (last-project-admin, self-demotion) propagate
    their `code` + message verbatim
- `packages/dashboard/src/App.tsx`: registered the `/admin/*` route
  inside `<RequireAuth>` + new `<RequirePlatformAdmin>` guard that
  bounces non-admin users to `/`. `CurrentUserProvider` wraps
  `ProjectProvider` so both contexts share a single 401 contract

Verified live against the running platform:
- `pnpm -r build` clean across all 12 packages
- Migration 010 applies on first boot (`schema_migrations` lists
  ten versions). The pre-existing `a@b.c` admin row is now
  `role = platform-admin`; the trackeros project has a
  `project-admin` membership row pointing at `a@b.c` (from the
  backfill)
- Server-side smoke (curl):
  - **GET /users** as platform-admin returns the admin user
  - **POST /users** creates `test@example.com` (`user` role,
    password `testpass123`)
  - **POST /projects/:id/members** assigns test as `editor` on
    trackeros
  - **GET /projects/:id/members** returns both rows with platform
    role + project role fields populated
  - **POST /projects** as admin creates a second project
    (`member-test`); admin's `GET /projects` returns both; test's
    `GET /projects` returns ONLY trackeros — membership filter is
    enforced
  - **DELETE /users/:id** on the test user returns 204; subsequent
    `POST /auth/login` for the same email returns 403
    `ACCESS_DENIED`; existing JWT for test against `GET /projects`
    returns 403 (the middleware re-check fires before the route
    handler)
  - **Self-protection guards:** `DELETE /users/:adminId` and
    `PATCH /users/:adminId {role: user}` both return 400 with
    `SELF_DEACTIVATE_FORBIDDEN` / `SELF_DEMOTION_FORBIDDEN`
  - **Last-project-admin guard:** `PATCH /projects/:id/members/:adminId
    {role: editor}` and `DELETE /projects/:id/members/:adminId` both
    return 400 `LAST_PROJECT_ADMIN`
- **Dashboard drive (headless Chrome via CDP):** logged in as `a@b.c`,
  sidebar shows the `★ Admin` link, `/app/admin` renders the Admin
  view with the Users table containing the admin row (`★ Platform
  admin` badge + `● active`). Created `second@example.com` (`user`)
  via the API + assigned editor on trackeros. Signed out + logged in
  as the regular user: sidebar `hasAdminLink === false` (the `<li>`
  is absent from the DOM, not just hidden); navigating directly to
  `/app/admin` bounces to `/app/` (lands on the Intents view via
  `<Navigate to="/" replace>`). Screenshots captured to the CDP
  output log
- **CLI smoke:** `node packages/cli/dist/index.js users list` → table
  with the admin row + `★ platform-admin` badge + `active` status;
  `users members trackeros` → table with the admin as `project-admin`

Decisions made:
- **`requireRole` keeps its legacy string signature.** The brief
  proposed the same `('viewer' | 'operator' | 'admin')` minimum-role
  vocabulary even after migration 010. Preserving it means every
  existing route guard (admin route, intents, projects, agents,
  executions, deployments, maintenance, oversight) keeps compiling
  unchanged. The middleware translates internally
- **Project ID is resolved with a routerPath prefix check, not from
  `params.id` blindly.** The brief's pseudocode would have looked up
  membership against `POST /intents/:id/clarify` (`params.id` is an
  intent UUID) and `GET /executions/:id/log` (an execution UUID),
  always returning null → 403. Restricting the params lookup to URLs
  whose `routerPath` begins with `/projects/:id` keeps the
  semantically-correct routes auth-checked and leaves the rest as
  "authenticated user, route handler enforces specifics"
- **POST /interventions / POST /intents** are NOT changed to enforce
  membership at the route level in this session.** They still rely
  on `requireRole('operator')` and pass the project ID in the body.
  Today every regular user creates the project they care about
  themselves (so they're automatically project-admin); the
  edge case where user B tries to submit an intent against user A's
  project is left as a route-handler enhancement
- **Memberships repo uses the camelCased row directly.** The
  postgres.js client transforms column names at fetch time
  (`transform.column = postgres.toCamel`), so explicit row → record
  mapping is not just unnecessary, it's harmful — the first draft
  of `users.ts` and `memberships.ts` hand-mapped `display_name →
  displayName` and lost every field along the way (postgres.js
  rejected the upsert with `UNDEFINED_VALUE`). The fix was to
  delete the mappers and trust the camelCased row. Same trap as
  the JSONB read paths handled by `parseJsonb` — but solved by
  the client config rather than per-repo defence
- **Migration backfills project-admin from `projects.created_by`.**
  Without the backfill, every previously-registered project would
  vanish from the dashboard the moment migration 010 ran (the user
  who registered the project would have zero memberships). The
  backfill mirrors the previous "every authenticated user sees
  every project" behaviour for the rows that existed at migration
  time; the new auto-assign on `POST /projects` covers everything
  after
- **`POST /users` password field is optional.** Omitting it creates
  a user that can only authenticate via IdP — the right behaviour
  for corporate deployments where the admin pre-creates accounts
  before the user's first SAML/OIDC login. The local_auth row is
  only created when a password is supplied. `authProvider` is set
  to `'pending'` for IdP-only users (so the upsert ON CONFLICT
  target on `(idp_subject, auth_provider)` doesn't collide with a
  future SAML login from the same subject)
- **Deactivation guards live at BOTH layers.** The local provider
  refuses login when `deactivatedAt` is non-null (catches the
  password path); the JWT middleware re-checks on every authenticated
  request (catches the existing-JWT path). Either alone would leave
  a window: provider-only means a stolen JWT survives deactivation
  until expiry; middleware-only means the deactivated user could
  still pass the login flow and get a fresh JWT that immediately
  gets 403'd on the next request (confusing UX)
- **`hasPermission` removed, not aliased.** The function's role
  hierarchy lookup `(viewer: 1, operator: 2, admin: 3)` doesn't map
  onto the new two-value `UserRole`. Renaming + adjusting wouldn't
  help — every call site of `hasPermission` was inside `requireRole`
  itself. Removed instead, and `isPlatformAdmin(role)` exported in
  its place for the public API surface
- **Did NOT add stubs for the new UserRepository methods to the
  oracle/mssql adapters.** The Oracle and MSSQL adapter packages
  don't currently have UserRepository stubs at all (they only stub
  the repos that were added since the initial release); adding a
  full users stub there is a parity-cleanup task, not a regression.
  Memberships stubs WERE added because they're the entirely-new
  repository this session introduced
- **`POST /users` with `authProvider: 'pending'` for IdP-only
  users.** The `users.upsert` ON CONFLICT key is
  `(idp_subject, auth_provider)`. Using `'local'` for a no-password
  user would collide with a future local-login by the same email;
  using `'pending'` (the value the AuthManager will overwrite with
  the real provider on first login) leaves the row distinguishable
  during the pre-login window
- **Admin view sidebar entry uses `★`.** Mirrors the platform-admin
  badge shown in the users table — the same glyph stands for "this
  is the platform-admin surface" wherever it appears

Build status: `pnpm -r build` clean across all 12 packages.
Migration 010 applied cleanly. Full role-model verification
(membership filter, deactivation, self-protection, last-
project-admin guard, dashboard conditional rendering)
exercised end-to-end. The CLI's `users list` / `users members`
both work against the live server.

Follow-ups added to Pending enhancements:
- **POST /intents / POST /maintenance/trigger don't enforce
  per-project membership at the route level.** They check
  `requireRole('operator')` which (per the new mapping) lets
  every authenticated regular user through when there's no
  projectId in the URL. The handlers receive the projectId from
  the body and could call `memberships.findMembership` before
  dispatching the BullMQ task. Today the gap is harmless because
  every regular user is auto-assigned to the projects they
  create; if cross-project intent submission ever becomes a
  thing, this needs the handler-level check
- **Oracle / MSSQL adapters lack a `UserRepository` throw-stub.**
  Pre-existing gap (the repository was added before either Phase-2
  adapter); migration 010 widened the interface with 4 new methods
  but did not add the stub because it would have been net-new
  scope. When those adapters get any real implementation, the
  full UserRepository surface needs writing

---

### Session 2026-06-01 — Claude Code (handler-level project membership enforcement)

Closes the user-management session's follow-up: `POST /intents` and
`POST /maintenance/trigger` use `requireRole('operator')`, which —
after migration 010 — lets any authenticated regular `user` through
when the projectId is in the request body rather than the URL. A
regular user who knew (or guessed) a projectId could submit intents,
clarifications, fix-intents and maintenance triggers against a project
they had no membership on. This session shuts that down at the
handler level for every body-projectId route, plus tightens
`POST /projects/:id/config` to `project-admin`.

Changed:
- `packages/server/src/auth/middleware.ts`:
  - New `ProjectMembershipError` (Error subclass) carrying one of
    `NOT_PROJECT_MEMBER` / `INSUFFICIENT_PROJECT_ROLE` as `code`
  - New `requireProjectMembership(userId, userPlatformRole,
    projectId, minRole = 'reader')` helper. platform-admin returns
    `null` (bypass). Otherwise looks up the membership via
    `getRepositories().memberships.findMembership(...)`; missing →
    throws `NOT_PROJECT_MEMBER`; present-but-below-minRole → throws
    `INSUFFICIENT_PROJECT_ROLE`. Role rank hard-coded inside the
    helper as `{ reader: 1, editor: 2, 'project-admin': 3 }`
  - New `sendProjectMembershipError(reply, err)` — shapes the
    canonical 403 body `{ error: 'FORBIDDEN', code, message }`. The
    `code` is what the CLI parses to choose its friendly message
- `packages/server/src/routes/intents.ts`:
  - `POST /intents` — after body parse and projectId validation,
    calls `requireProjectMembership(..., 'editor')`. The membership
    check runs BEFORE any intent row is created, so a 403 leaves
    the DB untouched
  - `POST /intents/:id/clarify` — membership resolved from the
    loaded intent's `projectId` (not from `params.id`, which is an
    intent UUID — `requireRole('operator')` correctly already
    refused to misread it as a project ID). Runs BEFORE the
    `status !== 'waiting-for-clarification'` check so a reader gets
    the membership 403 regardless of intent status
- `packages/server/src/routes/maintenance.ts`:
  - `POST /maintenance/trigger` — same editor-minimum check using
    the body's projectId
  - `DELETE /maintenance/findings/:projectId` — added the same
    check. Route param is `:projectId` not `:id` so the
    `requireRole('operator')` preHandler's `routerPath.startsWith
    ('/projects/:id')` test doesn't match. Editor minimum
- `packages/server/src/oversight/routes.ts`:
  - `POST /alerts/:id/fix-intent` — membership check runs AFTER
    `resolveProjectIdForAlert` succeeds (since we need the
    projectId from the alert context or via the linked intent),
    but BEFORE the `intents.create` + BullMQ dispatch so a 403
    leaves the alert un-acked and no orphan intent row
- `packages/server/src/routes/projects.ts`:
  - `POST /projects/:id/config` — **project-admin minimum**
    (editor isn't enough because HARNESS.json changes shape
    deploy/maintenance for every operator on the project). Helper
    pulls `request.params.id` directly
- `packages/cli/src/ui/server-errors.ts`:
  - New `parseForbiddenBody(err)` — pulls the typed
    `{ code, message }` shape out of `ApiClientError.body` when
    `status === 403`. Returns null for any other shape
  - New `handleMembershipForbidden(err)` — prints a contextual
    hint for `NOT_PROJECT_MEMBER` (`gestalt users assign <email>
    <project> --role editor`) and `INSUFFICIENT_PROJECT_ROLE`
    ("Ask a platform-admin or project-admin to upgrade your
    role"). Returns true when it handled the error so the caller
    knows NOT to print its own "Failed: ..." line. False for
    everything else (so the existing generic catch arm still
    runs)
- `packages/cli/src/commands/run.ts`,
  `packages/cli/src/commands/maintenance.ts` (two catch blocks),
  `packages/cli/src/commands/projects.ts` (the `set-adapter`
  catch): each now does
  `if (isConnectivityError(err)) { ... } else if (!handleMembership
  Forbidden(err)) { console.log(c.error(...)); }`. Keeps the
  existing precedence order — connectivity wins over typed 403,
  typed 403 wins over generic

Verified live against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt
- Created `reader@example.com` (`user` / membership `reader` on
  trackeros) and `editor@example.com` (`user` / membership `editor`).
  Tokens captured for the test matrix
- **As reader:**
  - `POST /intents { projectId: trackeros }` → 403
    `INSUFFICIENT_PROJECT_ROLE` `"Minimum project role required:
    editor"` ✓
  - `POST /maintenance/trigger { agentRole: drift-agent, projectId:
    trackeros }` → same 403 ✓
  - `GET /intents?projectId=trackeros&limit=2` → 200 with two
    intents (`HTTP_STATUS=200`) — reader CAN view ✓
- **As editor:**
  - `POST /intents` → 201 (intent created in `pending` then
    transitioned to `generating`; cleaned up to `failed` via direct
    SQL to avoid the orchestrator burning LLM calls on a placeholder
    intent) ✓
  - `POST /maintenance/trigger { agentRole: drift-agent }` →
    `status: completed`, `runId: 362c154a-…`, `durationMs: 1215` ✓
  - `POST /projects/:id/config { pipeline.adapter: 'github-actions' }`
    → 403 `INSUFFICIENT_PROJECT_ROLE` `"Minimum project role
    required: project-admin"` ✓
- **As editor against an outsider project they don't belong to:**
  Admin pre-created an `outsider` project; editor's `POST /intents
  { projectId: outsider }` → 403 `NOT_PROJECT_MEMBER` `"You are not
  a member of this project"` ✓
- **As platform-admin (`a@b.c`):**
  `POST /intents { projectId: outsider }` → 201 (bypass) ✓;
  `POST /projects/:outsider/config { pipeline.adapter: noop }`
  passed the membership check (5xx'd downstream on the placeholder
  Git URL — the bypass worked, the clone step failed, which is the
  right semantics) ✓
- **`POST /intents/:id/clarify` membership check** — picked a random
  trackeros intent (status didn't matter — membership runs BEFORE
  the status check), called as reader → 403
  `INSUFFICIENT_PROJECT_ROLE` ✓ (confirms the editor-minimum check
  runs before the status branch)
- **CLI** (admin config swapped out for each scenario, then
  restored):
  - `gestalt run "..."` as reader:
    ```
    ✗ Minimum project role required: editor
      Ask a platform-admin or project-admin to upgrade your role.
    ```
  - `gestalt maintenance trigger drift-agent trackeros` as reader:
    same friendly message ✓
  - `gestalt projects set-adapter trackeros github-actions` as
    editor:
    ```
    ✗ Minimum project role required: project-admin
      Ask a platform-admin or project-admin to upgrade your role.
    ```
  In every case the CLI printed the friendly two-line block
  instead of the raw JSON error body that the previous catch arm
  would have shown

Decisions made:
- **`requireProjectMembership` is a regular function, NOT a Fastify
  preHandler.** The brief's pseudocode put the check inline inside
  the handler; the helper version follows that. preHandlers can't
  see the request body without the route's typed `Body` generic, so
  there's no clean way to express the body-projectId case as a
  preHandler factory without duplicating the body-shape per route.
  The helper instead takes the projectId as an explicit argument
  the handler already has in scope; less elegant than a preHandler
  but unambiguous and short
- **The helper THROWS rather than returns a discriminated union.**
  Callers wrap with `try { ... } catch (err) { if (err instanceof
  ProjectMembershipError) return sendProjectMembershipError(reply,
  err); throw err; }`. Three lines per call site, but it composes
  with the existing handler error-path patterns and means the
  helper can be called multiple times in one handler without
  branching ladders. The Error-subclass + `instanceof` guard is the
  same pattern `PipelineAdapterAuthError` uses in the deploy layer
- **Editor for everything except `/projects/:id/config`.**
  Submitting work (intent, maintenance, fix-intent, clarification)
  is `editor`. Mutating shared project configuration (the committed
  `HARNESS.json`) is `project-admin` — the brief's table puts
  config changes squarely in the project-admin column, and an
  editor who can't manage members shouldn't be flipping the deploy
  pipeline adapter either
- **Closed `DELETE /maintenance/findings/:projectId` too.** Not in
  the brief's enumerated five, but the same shape: route param is
  `:projectId` not `:id`, so the preHandler's
  `routerPath.startsWith('/projects/:id')` check doesn't catch
  it. Resetting another project's finding budget is operator-grade,
  same as triggering its maintenance agents — editor minimum
- **Did NOT extend `POST /alerts/:id/acknowledge` with a membership
  check.** Acknowledging an alert is a pure UI action — no work is
  queued, no state mutated except the alert's `acknowledged_at`.
  If a non-member finds an alert ID and dismisses it, they only
  hide a notification from the target project's members; they
  don't change project state. Possibly worth tightening later but
  out of scope for this brief's "writes that touch project work"
  framing
- **Reader can still GET intents.** The brief is explicit that
  readers retain read access. The list endpoint `GET /intents` has
  no preHandler at all (any authenticated user can query
  `?projectId=...`), which IS a separate pre-existing gap — but
  the brief explicitly carves it out by listing "GET /intents →
  should succeed (reader can view)" in the verification matrix.
  Tightening the list endpoint to enforce membership server-side
  is a future enhancement; today's reader leak there is by design
- **`handleMembershipForbidden` returns boolean, not throws.**
  Lets the call site keep `if/else if` precedence (connectivity →
  membership → generic) without nested try/catch. Same pattern
  `isConnectivityError` already uses
- **CLI doesn't print actionable suggestions for non-member users
  beyond "ask a project-admin to upgrade your role".** The
  `gestalt users assign` hint only fires for `NOT_PROJECT_MEMBER`
  because that's the case the user can self-trigger by knowing
  someone else's email. For role-upgrades the operator who can act
  isn't the caller, so we point upward instead of showing a
  command they can't run themselves

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; full verification matrix (reader / editor /
platform-admin / non-member-editor) exercised against the live
platform; CLI surfaces the typed friendly messages for all three
hit cases. No new migrations, no new tables, no dashboard changes
— pure auth tightening.

Follow-up from the prior user-management session resolved: "POST
/intents / POST /maintenance/trigger don't enforce per-project
membership at the route level" no longer applies. The handler-
level helper closes that gap and the role-rank check raises
`/projects/:id/config` to project-admin in the same pass.

---

### Session 2026-06-01 — Claude Code (POST /interventions: resume / abort / acknowledge-breach / request-clarification — ADR-021)

Closes the long-standing 501 stub at `POST /interventions`. ADR-021
defines exactly four typed operator responses to escalated intents;
this session implements all four end-to-end (server route + dashboard
buttons + IntentDetail history + CLI subcommands) and bumps the
schema to 11 migrations.

Changed:
- `packages/adapters/postgres/src/migrations/011_interventions.sql`
  (new): single table
  `(id, correlation_id, intent_id, alert_id, action, actor_id, notes,
  created_at)`. `intent_id` and `actor_id` non-null FKs; `alert_id`
  nullable (created on `resume`/`abort`/`acknowledge-breach` from the
  open GP_BREACH alert; null on `request-clarification` which creates
  its own new alert). `action` CHECK constraint pins the four
  ADR-021 values. Indexes on `intent_id` and `correlation_id` for
  the per-intent history fetch + the per-cycle audit join. No
  schema_migrations writes
- `packages/core/src/repository/index.ts`: new
  `InterventionAction` union (the four ADR-021 values),
  `InterventionRecord` shape, `InterventionRepository` interface
  (`create`, `findByIntentId`, `findByCorrelationId`).
  `RepositoryRegistry` gained `interventions`. Both types re-exported
  from `@gestalt/core/index.ts`
- `packages/adapters/postgres/src/repositories/interventions.ts`
  (new): `PostgresInterventionRepository`. postgres.js camelCases the
  column names at the client level so the returned rows already match
  the `InterventionRecord` shape — no per-field mapper needed (same
  pattern memberships + users use after the migration-010 trap)
- `packages/adapters/postgres/src/index.ts`: instantiates +
  registers the postgres impl
- `packages/adapters/{oracle,mssql}/src/repositories/interventions.ts`
  (new): throw-stub `*InterventionRepository` classes. Re-exported
  from each adapter's `index.ts` so interface drift in core surfaces
  as a build break here
- `packages/server/src/routes/interventions.ts` (new): registers
  both `POST /interventions` and `GET /interventions`.
  - **`POST /interventions`** — `requireRole('operator')` preHandler
    plus a handler-level
    `requireProjectMembership(..., intent.projectId, 'editor')`
    (the projectId lives on the intent record, not the URL —
    matches the pattern the prior membership-enforcement session
    introduced for body-projectId routes). Validation order:
    intentId present → action valid → notes present for
    `acknowledge-breach` → intent exists (404) → intent status is
    `escalated` (else 409 `INVALID_INTENT_STATUS` with the actual
    status in the message) → membership check. The four-way switch
    follows, each branch:
    - **resume:** `signals.markResolved(gpBreachSignalId, 'human')`
      (the repo's GP guard rejects anything other than the literal
      `'human'` string — the operator's user id goes on the
      intervention + audit rows instead), `alerts.acknowledge(...)`
      if a GP_BREACH alert is open, `interventions.create(...)`,
      `audit.append({ action: 'intervention.resume', metadata:
      { signalId, alertId, ip } })`. Then dispatches `deploy:pr`
      with `artifacts = artifacts.findByCorrelationId(correlationId).
      map(...)` — the same shape `dispatchDeployPR` in the gate
      orchestrator builds on a `pass` verdict. Transitions intent
      to `deploying`, emits `intent.status-changed` and (when
      applicable) `alert.acknowledged` SSE events
    - **abort:** alert ack, intervention row, audit, transition to
      `failed`, SSE. No signal resolution (the breach IS the
      truth); no deploy dispatch
    - **acknowledge-breach:** signal resolved (`'human'`), alert
      ack, intervention row with `notes: trimmedNotes`, audit row
      carrying `notesLength` + `signalId` + `alertId` (**not the
      notes content** — GP-006), transition to `failed`, SSE
    - **request-clarification:** intervention row, fresh
      `clarification-needed` alert (severity `high`,
      `requiredAction: 'provide-clarification'`,
      `context: { intentId, triggeredBy: 'intervention',
      breachSignalIds: [...] }`), transition to
      `waiting-for-clarification`, audit (`alertId` of the new
      alert + optional `notesLength`), `alert.created` +
      `intent.status-changed` SSE
  - **`GET /interventions?intentId=<id>`** —
    `requireRole('viewer')`. Returns
    `{ data: InterventionRecord[] }` ordered ASC by `created_at`.
    Used by the dashboard's IntentDetail Interventions section
  - The outer `try/catch` around the action switch returns a
    500 with the underlying error message on any thrown step so
    operators don't lose the diagnostic when something downstream
    (BullMQ enqueue, repo error) blows up mid-action
- `packages/server/src/oversight/routes.ts`: the 501 stub at
  `POST /interventions` is gone. The block is now a one-comment
  pointer telling the next reader where the typed implementation
  lives. Removed the now-unused `InterventionRequest` import
- `packages/server/src/app.ts`: registers
  `registerInterventionRoutes(app)` alongside the existing
  routes
- `packages/dashboard/src/types.ts`: replaced the aspirational
  `InterventionType` / payload-discriminated union (left over
  from the 501 era — it modelled `approve-promotion`,
  `reject-promotion`, etc. which never shipped) with the
  ADR-021-aligned shape: `InterventionAction`,
  `InterventionRequest { intentId, action, notes? }`,
  `InterventionRecord` (matches the server shape — `actorId`,
  `notes`, etc.), `InterventionResponse`
- `packages/dashboard/src/index.ts`: re-exports adjusted to the
  new type names
- `packages/dashboard/src/api/client.ts`: `submitIntervention`
  rewrapped to the new `{ data: InterventionResponse }` envelope;
  new `listInterventions(intentId)` calls
  `GET /interventions?intentId=`
- `packages/dashboard/src/views/Alerts.tsx`:
  - New `breachNotes` state slot (keyed by alert.id) for the
    `acknowledge-breach` required-notes textarea
  - New `handleIntervention(alert, action)` handler — submits the
    typed `POST /interventions` call, sets a green confirmation
    banner on success, collapses the card after 1.5 s, refreshes
    the list. Resume + abort use the shared handler; abort
    confirms via `window.confirm` before firing. `acknowledge-
    breach` requires the textarea to be non-empty (browser alert
    otherwise)
  - New `<BreachInterventionBlock>` component rendered only for
    `alert.type === 'GOLDEN_PRINCIPLE_BREACH'`. Layout: top row
    is `▶ Resume (false positive)` (primary green) + `✗ Abort
    intent` (danger red); below them a required notes textarea
    and the `⚑ Acknowledge breach` button (disabled until the
    textarea has content). Sits ABOVE the existing
    `FixIntentBlock` + `DismissBlock` so the typed intervention
    is the obvious first action for GP_BREACH alerts
- `packages/dashboard/src/views/IntentDetail.tsx`: new
  `interventions` state slot + `useEffect` that fetches the
  history when the intent's status is in the visible set
  (`escalated`, `failed`, `deploying`, `deployed`,
  `waiting-for-clarification`). Renders a new "Interventions
  (N)" Card between the Signals card and Artifacts — one row per
  intervention with a coloured action chip (resume: muted bg,
  abort: red, acknowledge-breach: amber,
  request-clarification: blue), the actor's id-prefix, the
  timestamp, and the notes prose (or `(no notes)` italic
  placeholder)
- `packages/cli/src/api/client.ts`: new
  `InterventionActionString`, `InterventionResponse`,
  `InterventionRecordDto` types and `submitIntervention` /
  `listInterventions` typed methods
- `packages/cli/src/commands/alerts.ts`: three new exports —
  `alertsResumeCommand`, `alertsAbortCommand` (prompts `y/N`),
  `alertsAcknowledgeCommand` (prompts for required notes when
  `--notes` is omitted). Each resolves the `intentId` from the
  alert id-prefix via the existing
  `fetchAlertByIdOrPrefix(client, prefix)` helper +
  `alert.intentId` / `alert.context.intentId` fallback, then
  fires the typed POST. Connection errors route through the
  shared `printConnectionError` / `isConnectivityError` helpers
- `packages/cli/src/index.ts`: registers `gestalt alerts resume
  <alertId>`, `gestalt alerts abort <alertId>`, `gestalt alerts
  acknowledge <alertId> [--notes <text>]`. All three accept the
  standard `--server <url>` one-shot override

Verified live against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt; migration 011 applied on first boot
  (`schema_migrations` now lists 11 versions). `\d interventions`
  shows the expected shape (CHECK on action, indexes on
  intent_id + correlation_id, all FK constraints present)
- **abort** — `POST /interventions { action: 'abort' }` against
  pre-existing escalated intent `562efa69` (text "make it
  better"): returned
  `{ data: { action: 'abort', intentId: '562efa69-…', status:
  'failed' } }`; DB confirms intent → `failed`, intervention row
  written with `action: 'abort'`, `actor_id: a@b.c`,
  `notes: NULL`, `alert_id: NULL` (the existing intent had no
  open GP_BREACH alert, only the signal — alerts table doesn't
  have an `intent_id` column; the open-alert lookup goes via
  correlationId)
- **acknowledge-breach** — first call without notes returned 400
  `"notes are required for acknowledge-breach"`. Second call
  against `cd4c1846` with a 123-char notes payload returned
  `{ data: { action: 'acknowledge-breach', intentId: 'cd4c1846-…',
  status: 'failed' } }`. DB: intent → `failed`,
  `interventions.notes` carries the 123 chars verbatim,
  **audit_log row carries `metadata = { notesLength: 123,
  signalId: '432b33d9-…', alertId: null, ip: '…' }`** — no
  notes text anywhere in the audit metadata. GP-006 verified
- **request-clarification** — against `b86e010f` (a
  maintenance-sourced escalated intent): returned `{ data:
  { action: 'request-clarification', intentId: '…', status:
  'waiting-for-clarification' } }`. DB confirms intent
  transitioned and a NEW `clarification-needed` alert with
  severity `high` and title "Clarification requested for
  escalated intent" was created against the same correlationId
- **resume** — couldn't reuse a pre-existing intent for this
  (none had an unresolved alert AND artifacts to dispatch with),
  so seeded a synthetic `verify-intervention-resume` intent +
  GP_BREACH signal + alert + a single code artifact directly via
  SQL. `POST /interventions { action: 'resume' }` returned
  `{ data: { action: 'resume', intentId: '4768a6b4-…', status:
  'deploying' } }`. Within ~6 s the deploy chain ran end-to-end
  through the NoOp adapter: `deployment_events` shows
  `pr-opened → pipeline-triggered → pipeline-passed →
  promoted-staging → promoted-production` in order; intent
  reached `deployed`. GP_BREACH signal flipped to
  `resolved_by = 'human'`; alert acknowledged; intervention row
  carries `action: 'resume'` and a populated `alert_id`. The
  signal-resolution guard fired correctly — passing the user
  UUID instead of `'human'` would have thrown, but the route
  passes the literal as required
- **`GET /interventions?intentId=<resume_id>`** returned the
  intervention record with the expected shape — `id`,
  `correlationId`, `intentId`, `alertId`, `action: 'resume'`,
  `actorId`, `notes: null`, `createdAt`. Confirms the read path
  for the dashboard's IntentDetail section
- **Edge cases:**
  - non-existent intent id → 404 `"Intent not found"` ✓
  - already-`failed` intent → 409 `INVALID_INTENT_STATUS`
    `"Intent is not in escalated status (current: 'failed')"` ✓
  - already-`deployed` intent (the resume target after the chain
    completed) → 409 same ✓
  - bad action string → 400 `"action must be one of: resume,
    abort, acknowledge-breach, request-clarification"` ✓
- **Membership guard:** created `reader2@example.com` (`user`,
  membership `reader` on trackeros), seeded a fresh escalated
  intent + signal, then POSTed `{ action: 'abort' }` as the
  reader → 403 `INSUFFICIENT_PROJECT_ROLE` `"Minimum project
  role required: editor"`. Intent status stayed `escalated` —
  the helper short-circuits before any state mutation
- **CLI:**
  - `gestalt alerts abort <prefix>` (with `y` confirmation
    response) — seeded a fresh GP_BREACH alert + intent,
    grabbed its 8-char id-prefix, piped `y` to the prompt →
    `✓ Intent aborted` + intent transitions to `failed`
  - `gestalt alerts acknowledge <prefix> --notes "Documented
    exception for migration script - cleared with tech lead"` —
    seeded another fresh GP_BREACH escalation, ran the command
    with `--notes` → `✓ Breach acknowledged` + intent → `failed`,
    notes persisted on the intervention row
  - Both commands successfully resolved the 8-char prefix to the
    full alert + lifted the intentId from `alert.intentId`

Decisions made:
- **The repo's GP-resolution guard is honoured, not worked
  around.** `signals.markResolved` rejects anything other than
  literal `'human'` for GP_BREACH signals. The brief's
  pseudocode passed `request.user.id`, which would have thrown
  in the postgres impl. The route passes `'human'` to the repo
  and writes the actor's uuid on the intervention + audit rows
  — the operator identity is auditable via
  `interventions.actor_id` and `audit_log.actor` for the same
  cycle
- **The route handles "multiple open GP_BREACH signals"
  conservatively.** Some review-agent runs emit more than one
  GP_BREACH signal per cycle. The route resolves the FIRST
  unresolved one (the repo's per-id `markResolved` call) and
  attaches the open GP_BREACH ALERT id to the intervention row.
  Future intervention rows on the same correlationId would mark
  the next signal resolved, but since the intent transitions out
  of `escalated` on the first intervention, the 409 status guard
  prevents that path. Acceptable trade-off — operators rarely
  see N>1 GP_BREACH signals per cycle, and the audit chain
  preserves the full signal list via `signals.findByCorrelationId`
- **alerts table doesn't carry `intent_id` as a column** — the
  schema-001 design stores it in JSONB context, and the
  alerts-repo `create()` writes `intentId` there. The route's
  alert-lookup uses
  `alerts.findByCorrelationId(intent.correlationId)` instead
  (one correlationId per cycle, so this finds the right alert
  unambiguously). My synthetic seeds had to mirror this — the
  intent-id goes into `context` JSONB, not a table column
- **request-clarification creates a new alert directly** rather
  than reusing the original GP_BREACH alert. The original alert
  is acknowledged, archived, and audit-trailed — the new
  `clarification-needed` alert is a fresh actionable item for
  the next operator. Mirrors how the gate-orchestrator and
  intent-agent currently produce clarification alerts when
  cycles pause for unrelated reasons; keeps the
  alerts-life-cycle invariant ("an open alert means an
  operator decision is pending")
- **The dashboard ships three of the four actions; the fourth
  (request-clarification) is CLI-only.** Operators using the
  dashboard who want to ask for clarification typically just
  submit a fresh intent or use the existing clarification flow
  via the `clarification-needed` alert; wedging a fourth button
  into the GP_BREACH card crowds the UI and the use case is
  rare. CLI-only is documented; if a real demand surfaces, add
  a fourth button (the handler is already wired)
- **Audit metadata for `acknowledge-breach` carries `signalId`
  and `notesLength`, NOT the notes content.** Same shape as the
  clarification audit row (notesLength only). The full notes
  text lives on `interventions.notes` where it can be queried
  by a forensics operator, never in `audit_log` where it would
  be replicated into every backup pull. GP-006 compliance
  verified by direct SQL inspection
- **`resume` rebuilds the artifact payload from
  `artifacts.findByCorrelationId`, not from a cached payload.**
  The original `deploy:pr` task the gate dispatches carries the
  artifact set in its payload; on a resume after escalation we
  don't have that BullMQ message anymore. The artifacts table
  is the source of truth — the resume re-loads them and ships
  the same shape pr-agent expects. Verified end-to-end: the
  synthetic single-artifact intent's deploy chain ran to
  completion with the seeded artifact making it into the
  payload
- **Edge case ordering matters.** Validation runs intent-shape
  checks before the membership lookup so a malformed body
  doesn't accidentally cause a DB call. Membership runs AFTER
  the intent-status check so an unauthorized user can't probe
  the intent table by sending arbitrary IDs — they get the
  same 409 `INVALID_INTENT_STATUS` a legitimate but late-
  arriving operator would see (status-leak via 404 vs 409 is
  trivial in this codebase, but kept the pattern consistent)
- **CLI `acknowledge` requires `--notes` OR a prompt response;
  empty notes after the prompt → exit 1.** Mirrors the server-
  side guard. Empty `--notes ""` is treated the same as
  "no value supplied" — falls into the prompt path
- **Dashboard `BreachInterventionBlock` renders ABOVE the
  generic `FixIntentBlock` and `DismissBlock` so the typed
  ADR-021 actions are the obvious first choice for GP_BREACH
  alerts.** The existing fix/dismiss block stays available for
  consistency with other alert types (and for the rare "I want
  to submit a fresh intent describing the right approach"
  use case)

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; migration 011 applied; full four-action
matrix verified end-to-end (3 against real pre-existing
escalated intents, 1 against a synthetic seed for the resume
path). CLI subcommands exercised against fresh synthetic alerts.
The `POST /interventions still a 501 stub` Pending enhancement
is removed from STATE.md.

No new Pending enhancements introduced.
