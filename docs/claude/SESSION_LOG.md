# SESSION_LOG.md — chronological session history

This file is maintained by both the design chat and Claude Code.
Every session that modifies the codebase appends an entry here.
When returning to the design chat, paste the most recent entries so
the context is current.

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

---

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

---

### Session 2026-05-31 — Claude Code (persist clarification text on the intents row)

Closes the gate-retry follow-up from the previous session: the
operator's clarification was previously threaded only through the
BullMQ payload, and on the gate's retry leg the orchestrator
re-dispatched `generate:intent` without it. The intent-agent then
re-ran on the original vague text and produced a second
clarification alert. Making the DB the source of truth fixes the
issue at every retry hop with no special-casing.

Changed:
- `packages/adapters/postgres/src/migrations/006_intent_clarification.sql`
  (new): `ALTER TABLE intents ADD COLUMN clarification TEXT;`
  Pure schema. Nullable — existing rows keep NULL forever and
  intents that never paused for clarification also stay NULL
- `packages/core/src/repository/index.ts`:
  - `IntentRecord` gained `clarification: string | null`
  - `IntentRepository.create()` Omit type now also excludes
    `clarification` (column defaults to NULL on insert)
  - New `IntentRepository.saveClarification(id, text)` →
    `IntentRecord`
- `packages/adapters/postgres/src/repositories/intents.ts`:
  - `saveClarification` impl — `UPDATE intents SET clarification,
    updated_at = NOW() RETURNING *`. Throws if id not found
  - `SELECT *` continues to work (postgres.js maps the new column
    automatically — no per-row mapper)
- `packages/adapters/oracle/src/repositories/intents.ts` (new) +
  `packages/adapters/mssql/src/repositories/intents.ts` (new): full
  `IntentRepository` throw-stubs so future interface drift surfaces
  here. Matches the established alerts / deployment-events /
  maintenance-runs / projects stub pattern. Re-exported from each
  adapter's `index.ts`
- `packages/server/src/routes/intents.ts` POST /clarify:
  - Calls `intents.saveClarification` immediately after the
    waiting-for-clarification status guard, BEFORE the BullMQ
    dispatch. If the dispatch races ahead of the UPDATE the
    orchestrator still finds the row populated by the time it
    actually reads it (postgres MVCC + the orchestrator's
    `findById` is a fresh transaction). If the UPDATE failed the
    dispatch never fires
  - Audit metadata reshaped: `clarificationLength: N` (number, not
    the text), `ambiguityId`, `acknowledgedAlertIds`, `ip`. Action
    name changed to `intent.clarification-provided` per the
    brief. The clarification text itself is NOT written to the
    audit row — GP-006 (no sensitive data in logs). Forensics
    that need the text query `intents.clarification` directly
- `packages/agents/generate/src/orchestrator/orchestrator.ts`:
  Replaced `clarification: payload.clarification` in the
  drivePlan options with
  `clarification: intentRecord.clarification ?? payload.clarification ?? undefined`.
  Comment explains the DB is the source of truth; the payload
  fallback only matters for a fractional-millisecond race where
  the worker pulled the message before the UPDATE committed (very
  rare; harmless if it loses)

Verified live against `trackeros`, correlationId
`63bc2a3b-d6a4-4e34-b165-3b55d0fd1a3d`:
- `pnpm -r build` clean across all 12 packages
- Docker server image rebuilt; migration 006 applied on first
  boot (`schema_migrations` now lists six versions through
  `006_intent_clarification`)
- `intents.clarification` column exists, `text`, nullable
- Submitted "make it better" → intent → `waiting-for-clarification`
  in 2 s; `clarification` column still NULL
- `POST /intents/<id>/clarify` with a 156-character clarification
  returned `{ resumed: true, acknowledgedAlerts: 1 }`. DB row
  immediately shows `length(clarification) = 156`
- **Audit row contents** (GP-006 verification):
  `{"clarificationLength":156, "ambiguityId":null,
  "acknowledgedAlertIds":["be7c6bb6-…"], "ip":"192.168.65.1"}`.
  No clarification text anywhere in the audit_log
- **Full cycle: intent-agent ran THREE times.** First on the
  pause (vague text → clarification-needed). Second on the
  post-`/clarify` resume (clarification populated via direct
  payload). **Third on the gate retry** (the previous
  session's bug case). All three runs read
  `intentRecord.clarification` from the DB — the gate-retry
  intent-agent run returned `status: completed` (NOT
  `clarification-needed`), proving the persistence chain
  works
- **Only ONE alert in `alerts` for the full cycle.** The
  pre-fix bug would have created a second clarification alert on
  the gate-retry leg. The DB shows exactly one row, acknowledged
- Intent reached `escalated` for an unrelated review-agent
  GP_BREACH on the generated slugify implementation. The
  clarification persistence carried clean through all retries;
  the terminal escalation was a separate, code-quality issue out
  of scope for this fix

Decisions made:
- **DB column, not Git-tracked artifact.** Considered persisting
  the clarification text alongside `.gestalt/intent-spec.json` in
  the project repo. The DB is simpler (no Git race with the
  orchestrator's per-cycle clone), and clarification text is
  metadata about the cycle rather than something the next git
  pull should surface to developers. A column on `intents` keeps
  it discoverable via the same SQL operators already use
- **Payload still carries `clarification` even though the DB is
  the source of truth.** The dispatch fires in the same handler
  that just called `saveClarification`, so the UPDATE is in
  flight when the worker picks up the task. In the common case
  the DB read still wins. The payload fallback only matters for
  a worker that pulls the task between BEGIN and COMMIT — vanishingly
  unlikely with one server + one DB, but the cost is zero and the
  belt-and-braces guarantee is real
- **Audit metadata only carries length, not text** (GP-006). The
  audit row records the *event* — operator X clarified intent Y
  at time Z with N characters. The *content* of the clarification
  lives on the intent row and can be queried by a forensics
  operator. Splitting these surfaces aligns with the existing
  pattern (audit_log never contains the artifact content, only the
  reference)
- **Orchestrator uses `??` chain, not `||` chain.** Empty string
  is a valid clarification (theoretically), so falsy-coalesce
  via `||` would drop it; `??` only swallows null/undefined
- **Did NOT change the gate-retry payload shape.** It already
  carries `intentId`, which is all the orchestrator needs to
  hydrate via `intents.findById`. Adding clarification text to
  the retry payload would duplicate state and re-introduce the
  drift the DB fixes
- **Oracle and MSSQL got new full `IntentRepository` throw-stubs.**
  The brief asked for "saveClarification throw-stub for parity";
  there were no existing intent stubs in those adapters (only
  the four later additions had stubs). Adding full stubs follows
  the established convention and means the next interface change
  to IntentRepository also surfaces at oracle/mssql build time
- **Removed the resolved follow-up** ("clarification text lost on
  a gate retry") from `STATE.md`. Logged under the previous
  session's "Follow-ups added to Pending enhancements" list

Build status: `pnpm -r build` clean across all 12 packages.
Migration 006 applied. Full vague-intent → clarify → resume →
gate-retry cycle verified end-to-end; the clarification text
persists on the intents row through every dispatch leg.

---

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

---

### Session 2026-05-31 — Claude Code (richer ActiveAgents + Deployments + JSONB metadata fix)

Both views had everything they needed in the database already; this
session surfaces it. No new migrations, no new DB tables.

Changed:
- `packages/server/src/routes/status.ts` — `GET /status/agents`
  enriched per-row with `intentText`, `cycleProgress` (completed
  vs total executions in the cycle), and `tokensSoFar` (running
  total across the cycle's executions). De-dupes per-correlation
  lookups via two `Map`s so a six-agent cycle triggers two
  queries, not twelve
- `packages/server/src/routes/deployments.ts` (new) — new
  `GET /deployments?projectId=<id>&limit=20`,
  `requireRole('viewer')`. Returns `DeploymentSummary[]`:
  intentId / correlationId / intentText / status / events
  (ASC by createdAt) / prUrl / prNumber / branch / runId /
  deploymentUrl / startedAt / completedAt. Fetches the three
  deploy-related status buckets (`deploying`, `deployed`,
  `failed`) in parallel via `intents.list` (the repo only
  takes one status at a time), merges, sorts newest-first,
  caps to `limit`. Per-intent `deploymentEvents.findByCorrelationId`,
  drops cycles with no events (gate-failed intents that never
  reached pr-agent). Branch lifted from the `pr-opened`
  event's `metadata['branch']`; `prUrl` / `prNumber` from
  `pr-opened`; `runId` from `pipeline-passed` (fallback to
  triggered / failed); `deploymentUrl` from production
  promotion (fallback to staging)
- `packages/server/src/app.ts` — registers the new route
- `packages/adapters/postgres/src/repositories/deployment-events.ts`
  — new `parseMetadata` helper. postgres.js returns the JSONB
  `metadata` column as either an object OR a JSON-encoded
  string depending on how the row was written and what type
  adapters are registered. Same trap as the alerts repo
  (`parseContext`) and maintenance-runs repo
  (`parseFindings`). Without it, the `branch` extraction in
  `/deployments` returned null for every cycle because
  `metadata['branch']` against a string is `undefined`. The
  helper short-circuits on object / null / undefined, then
  defensively `JSON.parse`s strings and falls back to `{}` on
  any failure. Mirrors the pattern in the other two repos
- `packages/dashboard/src/types.ts`:
  - `AgentExecutionSummary` gained optional `intentText`,
    `cycleProgress`, `tokensSoFar`. Optional so the
    IntentDetail timeline (which doesn't need them) is
    unchanged
  - new `DeploymentEvent`, `DeploymentEventType`,
    `DeploymentSummary` types
  - kept the old Phase-2-aspirational `DeploymentStatus` /
    `PendingPromotion` / `PromotionHistoryItem` types since
    `IntentDetail.deploymentStatus` still references them.
    Marked with a comment for the next cleanup pass
- `packages/dashboard/src/api/client.ts` — new
  `listDeployments({ projectId, limit? })` method
- `packages/dashboard/src/views/ActiveAgents.tsx` — rewrote
  the card:
  - Header row: agent role + elapsed time (top-right,
    `1s` / `1m 23s` formatter)
  - Intent text line: 55-char truncation, muted monospace,
    quoted, omitted if `intentText` is null
  - Progress row: segmented bar (one `var(--green)` block
    per completed step, muted bordered block for each
    remaining step), `step N of M` label, token count
    `2,847 tokens` formatted with `toLocaleString()`
  - Progress row omitted entirely when `cycleProgress.total
    === 0`
  - Auto-refresh 5 s + SSE refresh kept
- `packages/dashboard/src/views/Deployments.tsx` — rewrote:
  - Three sections: In progress / Deployed / Failed (each
    only rendered when non-empty, except Deployed which
    always renders with empty-state hint)
  - Each row: top row with status badge + branch tag (small
    monospace chip) + timestamp; intent text (65-char
    truncation); 4-node pipeline timeline; footer links
  - Timeline node states: filled (green ●), in-progress
    (blue ◎ with pulse animation), failed (red ✗), empty
    (muted ○). `classifyNode` maps node index → event type;
    Pipeline node has the most failure modes (failed
    overrides passed overrides triggered)
  - Connectors between nodes turn green when both ends are
    filled; otherwise muted
  - HH:MM time under each filled node from the event's
    `createdAt`
  - `[↗ View PR #N]` link uses `prUrl` + `prNumber` (the PR
    number appears only when known). `[↗ View deployment]`
    link uses `deploymentUrl`. Both
    `target="_blank" rel="noopener noreferrer"`

Verified live against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt
- `GET /deployments?projectId=...&limit=20` returned 9 deployments,
  every one with a real `branch` value (e.g.
  `gestalt/9c28d399-add-a-titlecase-utility-under`), a real
  `prUrl` (NoOp adapter produces `noop://pr/<projectId>/<n>`),
  a real `runId` (`noop-run-9c28d399-<ts>`), and 5 events per
  cycle in the right order (`pr-opened`,
  `pipeline-triggered`, `pipeline-passed`, `promoted-staging`,
  `promoted-production`). Pre-`parseMetadata`-fix the same
  call returned `"branch":null` for every row
- **Browser drive (headless Chrome):**
  - `/app/deployments`: subtitle reads
    "9 total · 0 in progress · 9 deployed"; each card shows
    the deployed badge, the branch chip, the timestamp, the
    truncated intent, and the four-node pipeline (`PR ●
    PIPELINE ● STAGING ● PRODUCTION ●`) with the green
    connectors between every filled node, status labels
    underneath (opened / passed / promoted / deployed), and
    `08:20 PM` timestamps. Both `View PR #N` and
    `View deployment` buttons render. Screenshot captured
  - `/app/agents` first navigation: idle ("No agents
    running · platform is idle"). Submitted a fresh intent
    via the in-page API client, refreshed → "1 running"
    with the intent-agent card showing `1s` elapsed, the
    intent text quoted and truncated, and `step 0 of 1`
    (the cycle was on its first agent at the moment of the
    query). Two pulsing dots in the DOM (the agent ◎ and
    the connection pill). Screenshot captured

Decisions made:
- **De-dupe per-correlation lookups in `/status/agents`** via
  two Maps. A cycle with six concurrent agents would
  otherwise fire twelve queries (one `intents.findByCorrelationId`
  and one `executions.findByCorrelationId` per row). With
  the cache it's two queries per unique correlationId
- **Drop cycles with no events** in `/deployments` rather
  than rendering empty cards. A gate-failed intent that
  never reached pr-agent has no deployment_events but its
  status is `failed` — the dashboard's Deployments view
  should not show it. Gate failures live in QualityGate
- **`metadata.branch` extracted server-side**, not in the
  dashboard. The route owns the JSONB parse (via
  `parseMetadata` in the repo) so the dashboard receives a
  flat `branch: string | null` and doesn't have to do
  another JSON parse client-side. Keeps the dashboard
  decoupled from the JSONB shape
- **Pipeline node has its own state machine.** The other
  three nodes are a single event type → filled. Pipeline
  has three possible events (`pipeline-triggered`,
  `pipeline-passed`, `pipeline-failed`) with priority:
  `failed` wins, then `passed`, then `triggered` (which
  maps to in-progress). Captured in `classifyNode`'s
  index === 1 branch
- **Old `DeploymentStatus` types kept** for
  back-compat with `IntentDetail.deploymentStatus`. That
  field on `IntentDetail` was never populated by any
  current API path; removing the types would require
  touching `IntentDetail.tsx` too. Out of scope. Marked
  with a "delete when IntentDetail stops referencing it"
  comment so the next cleanup pass picks it up

Build status: `pnpm -r build` clean. Server image rebuilt;
both views render with real deployment_events + active
executions data. The JSONB-metadata-as-string bug is fixed
on the same pattern as the prior alerts + maintenance-runs
fixes.

No new follow-ups. The old `DeploymentStatus` /
`PromotionHistoryItem` types are flagged in a code comment
rather than the Pending enhancements list — they're
mechanical cleanup that doesn't need design conversation.

---

### Session 2026-05-31 — Claude Code (consolidated postgres JSONB parser into shared parseJsonb)

Refactor only. Pre-fix: three repo-local helpers (`parseContext`
in alerts, `parseFindings` in maintenance-runs, `parseMetadata` in
deployment-events) all solved the same problem — postgres.js can
return JSONB as either a parsed JS value or a raw JSON-encoded
string, and the read path has to defend against both. Every time
a new JSONB column landed on the schema (latest: deployment_events
`metadata` in the prior session) the same fix had to be copy-
pasted, and the JSON-shape-rejection logic (object vs array) drifted
slightly between the three.

Changed:
- `packages/adapters/postgres/src/utils.ts` (new): shared
  `parseJsonb<T>(value: unknown, fallback: T): T`. Returns the
  fallback on null/undefined input, on non-string non-object
  input, on a `JSON.parse` failure, and on a parsed value whose
  shape doesn't match the fallback's. Shape is inferred from
  `fallback`: array fallback → only accept arrays (preserves the
  prior `parseFindings` "non-array → []" rule); non-null object
  fallback → accept any non-null object including arrays
  (preserves `parseContext` / `parseMetadata`). Signature note
  in the JSDoc — the user's brief sketched
  `parseJsonb<T>(value): T`, but a single-arg version can't
  carry shape information to runtime, so `fallback: T` was
  added; the three call sites are still one line each
- `packages/adapters/postgres/src/repositories/alerts.ts`:
  removed local `parseContext` helper. `rowToRecord` now calls
  `parseJsonb<Record<string, unknown>>(row.context, {})`. Same
  result on every input the prior helper handled
- `packages/adapters/postgres/src/repositories/deployment-events.ts`:
  removed local `parseMetadata` helper. `rowToRecord` now calls
  `parseJsonb<Record<string, unknown>>(row.metadata, {})`. The
  Deployments view's branch chip (extracted from
  `pr-opened.metadata['branch']`) continues to work
- `packages/adapters/postgres/src/repositories/maintenance-runs.ts`:
  removed local `parseFindings` helper. `rowToRecord` now calls
  `parseJsonb<MaintenanceFinding[]>(row.findings, [])`. The
  array fallback tells the helper to reject non-array parsed
  values, preserving the legacy `Array.isArray(parsed) ? parsed
  : []` rule

Verified live (refactor must preserve every read path):
- `pnpm -r build` clean across all 12 packages; `tsc` happy
  with the new generic
- Server image rebuilt
- `GET /deployments?projectId=…&limit=2` returned both
  recent cycles with `branch` populated as real strings
  (`'gestalt/45b71ffc-add-a-humanreadable-bytes-formatter'`,
  `'gestalt/9c28d399-add-a-titlecase-utility-under'`). Pre-
  refactor and pre-fix: this was `null`. Post-refactor: still
  populated correctly
- `GET /maintenance/runs?limit=4` returned 4 runs with
  `findings` rendered as real JS arrays (length 0 for the
  recent evaluation-agent / drift-agent runs that had no
  findings to record). Pre-refactor: also worked. Confirmed
  the array-shape rejection path still functions
- `GET /alerts/<acknowledged-id>` (direct fetch on a
  previously-acknowledged clarification alert) returned
  `context` as a real object with the original `intentId` +
  `suggestions[3]` keys intact. Pre-refactor: also worked.
  Confirmed the object-shape acceptance path still functions

Decisions made:
- **`parseJsonb<T>(value, fallback)`, not the brief's
  single-arg `parseJsonb<T>(value)`.** The brief said "no
  behaviour change". A single-arg generic helper can't preserve
  the per-repo shape-rejection logic — `parseFindings` rejected
  non-array parsed JSON (returned `[]`); `parseContext` and
  `parseMetadata` rejected non-object parsed JSON (returned
  `{}`). Without runtime shape information the helper can't
  pick the right rejection rule. Adding `fallback: T` carries
  the shape implicitly (via `Array.isArray(fallback)`) AND
  gives the caller a typed, non-null return value. JSDoc on
  the helper documents the deviation
- **Object fallback accepts arrays.** Mirrors the previous
  `parseContext` behaviour exactly — `typeof === 'object' &&
  !== null` is true for arrays. If a caller passes `{}` as
  fallback and the column holds an array, they get the array
  back as a cast. None of the three current callers exercise
  this path, but documenting it now prevents the next JSONB
  column from being surprised
- **Did NOT introduce a generic `parsedShapeMatches(T)` type
  guard.** Could have built a richer signature with a
  user-supplied predicate; over-engineered for three call
  sites that all want either "is array" or "is non-null
  object". The `matchesShape(value, fallback)` two-line
  helper does exactly what's needed and is readable at the
  glance the next reviewer will give it

Build status: `pnpm -r build` clean. No behaviour change at
any of the three read paths.

No follow-ups. The shared helper is the canonical answer for
the next JSONB column; the per-row `::jsonb` cast on the WRITE
path remains the matching write-side defence (see the
maintenance-runs and alerts repos).

---

### Session 2026-05-31 — Claude Code (Maintenance view: Recent Runs populated + Run now error UX)

Two adjacent dashboard bugs in the Maintenance view, both rooted
in a single response-envelope mismatch and a small UX gap.

Investigation (the brief asked for it explicitly):
- `GET /maintenance/runs` returned `{ data: MaintenanceRunRecord[] }`
  on the server (matching every other route's envelope), but the
  dashboard's `DashboardApiClient.listMaintenanceRuns` was typed
  as `Promise<{ runs, total }>`. The view read `res.runs ?? []`
  which was permanently `undefined → []`. Recent runs section
  was always empty — not because runs didn't exist (they did:
  8 cron-driven evaluation-agent rows, 1 prior manually-
  triggered drift-agent) but because the dashboard's parse was
  for a phantom key
- The "Run now" button itself worked — server returned 200 with
  the completed `MaintenanceRunRecord` synchronously (the
  runner is in-process, not BullMQ). The actual gap was that
  `handleTrigger` used `try/finally` without `try/catch`, so
  any rejection from the API call would surface as an
  unhandled promise rejection from an event handler and the
  operator would see nothing
- The SSE subscription to `maintenance.run-completed` and the
  post-trigger `setTimeout(load)` were both already wired in
  the prior implementation. The brief asked to drop the delay
  from 2 s to 1 s

Changed:
- `packages/dashboard/src/api/client.ts`:
  - `listMaintenanceRuns` return type fixed to
    `{ data: MaintenanceRunSummary[] }` — matches the actual
    server envelope. JSDoc explains the prior bug so the next
    edit doesn't regress
  - `triggerMaintenanceAgent` return type fixed to
    `{ data: MaintenanceRunSummary }` — the server returns the
    completed run record. Comment notes the runner is
    in-process so the row exists by the time the response lands
- `packages/dashboard/src/views/Maintenance.tsx`:
  - `load` reads `res.data ?? []` instead of `res.runs ?? []`
  - new `triggerErrors: Record<string, string>` state, keyed by
    agentRole (so an in-flight retry on one agent doesn't blow
    away another agent's lingering error)
  - `handleTrigger` rewrapped as `try/catch/finally`. On
    catch: sets the error, schedules a 5 s auto-clear with a
    guard that doesn't clobber a newer error from a retry. On
    success: 1 s delayed `load()` (brief's value) — covers the
    SSE event path with a backstop and shaves a second off
    the prior 2 s
  - red `✗ Failed to trigger: <message>` strip renders under the
    agent card when `triggerErrors[agent]` is populated. Styled
    with `var(--red)` on a translucent red background using
    existing CSS variables only
  - empty-state hint updated: "Agents run on their configured
    schedule or via 'run now' above"

Verified live against `trackeros`:
- `pnpm --filter @gestalt/dashboard build` clean; full
  workspace build clean
- Server image rebuilt
- **Database state before fix:** 8 maintenance_runs rows
  (7 cron-scheduled evaluation-agent runs with
  `project_id = NULL`; 1 prior manually-triggered drift-agent
  with the project's id). With strict project filter only
  the 1 project-scoped row qualifies
- **API smoke:**
  - `GET /maintenance/runs?projectId=<id>&limit=3` returned
    `{ data: [drift-agent record] }` — confirms the server
    envelope (not `{ runs: [...] }`)
  - `POST /maintenance/trigger` with valid body returned 200 +
    the completed MaintenanceRunRecord (status='completed',
    duration ~1 s, project_id populated)
  - `POST /maintenance/trigger` with missing projectId
    returned 400 with `{"error":"projectId is required"}` —
    the dashboard's catch block will surface this verbatim
- **Browser drive (headless Chrome):**
  - `/app/maintenance` renders the four "Scheduled agents"
    cards each with a `run now` button. Recent runs section
    initially shows 4 rows (3 prior drift-agent triggers + 1
    alignment-agent with "6 intents queued" tag) — the empty
    state is GONE
  - Clicked `run now` on the drift-agent card → button text
    transitioned to `triggering...` → re-enabled after ~1 s →
    a fresh drift-agent row appeared in Recent runs at
    10:23:29 PM (the new row joined the list, total now 4
    visible)
  - Screenshot captured. The "Scheduled agents" section shows
    drift-agent mid-trigger (`triggering...` button still
    rendered when the screenshot fired). The 4 recent-runs
    rows all show green ● dots, agent role, optional intent-
    queued tag, and HH:MM timestamp
  - `docker-compose logs server | grep -iE "(maintenance|trigger).*error|error.*(maintenance|trigger)"`
    returned no matches — the trigger fired cleanly with no
    server-side warnings or errors

Decisions made:
- **`listMaintenanceRuns` aligned to `{ data: ... }` (server's
  convention), not the server changed to `{ runs, total }`.**
  Every other route in the server uses `{ data: ... }` (intents
  list, projects list, alerts list, deployments, executions).
  Aligning the one outlier to the convention was clearly
  cheaper than introducing a divergence
- **Strict project filter, no inclusion of `project_id IS NULL`
  cron rows.** The brief says "show runs from the currently
  selected project". Cron-scheduled evaluation runs have NULL
  project_id by design (they're global, not per-project), and
  including them would clutter the per-project view with rows
  the operator didn't trigger and that don't pertain to their
  specific project. The dashboard surface is the operator's
  per-project lens; the global cron history is observable via
  the existing `GET /maintenance/runs` without a projectId
  filter (CLI / curl / dashboard-future-feature). Logged a
  follow-up so the next iteration of the Maintenance view
  could surface a "show all" toggle if operators ask for it
- **1 s reload after trigger** (brief's value), with the SSE
  event as a backstop. The runner is in-process so the row
  exists immediately when the HTTP response lands; the
  `setTimeout` is a defensive belt against the SSE bus being
  briefly slow. Could be dropped to 0 in principle — kept as a
  small margin
- **Per-agent error map**, not a single error string. If the
  operator clicks `run now` on two agents in quick succession
  and the first fails, then the second succeeds, a single
  error string would either show stale data after the second
  call or get cleared by the success — both bad. Keyed by
  agentRole, each row owns its own visibility
- **Auto-clear guard: don't overwrite a newer error.** The
  5 s `setTimeout` reads the error message at schedule time
  and only clears if the current state still matches. A
  retry-during-clear cycle keeps the newer message visible
  for its own 5 s window
- **No change to the server route or repo query.** The
  permissive `WHERE TRUE / AND project_id = ...` SQL in
  `maintenance-runs.ts` is already correct; the only bug was
  the dashboard's response-envelope mistype. Repo + route
  untouched

Build status: `pnpm -r build` clean. Server image rebuilt;
Maintenance view fully functional end-to-end against real
data on `trackeros`. Bug 1 (trigger button + error UX), Bug 2
(Recent runs always empty), Bug 3 (post-trigger refresh
timing) all resolved.

Follow-up logged:
- A "show all" / "scope: this project" toggle in the
  Maintenance view would let operators see the global
  cron-scheduled evaluation-agent rows alongside their
  per-project runs. Today the per-project filter strictly
  excludes `project_id IS NULL` runs (which is the right
  default per the brief); the global view is reachable only
  via `GET /maintenance/runs` without a projectId arg, which
  the dashboard doesn't currently call

---

### Session 2026-05-31 — Claude Code (Maintenance run detail — expandable findings)

Closes the "what did this maintenance agent actually find?" gap.
The Recent Runs section now shows each run as a clickable accordion
that expands an inline detail panel — agent meta + findings cards
(or a "ran cleanly" panel when the findings array is empty). Same
data the server already returns; same idiom as the IntentDetail
agent-execution accordion landed earlier today.

Investigation:
- `GET /maintenance/runs` already returned `findings` /
  `durationMs` / `completedAt` / `runAt` / `intentsQueued` /
  `directFixes` on every row in the `{ data: ... }` envelope.
  Verified live: a real alignment-agent row in the DB had 6
  findings populated; a real drift-agent row had `findings: []`.
  The repo's `complete()` method persists everything via
  `${JSON.stringify(findings)}::jsonb`; the route returns the
  full `MaintenanceRunRecord[]`. No backend changes needed
- The dashboard's `MaintenanceRunSummary` type was the missing
  link — `findings`, `completedAt`, and `projectId` were not
  declared, and `durationMs` was non-nullable when the core type
  has `number | null`. Adding those fields was enough to thread
  the existing data into the view

Changed:
- `packages/dashboard/src/types.ts`:
  - New `MaintenanceFinding` interface mirroring the `@gestalt/core`
    shape (`type` / `description` / `affectedFiles` / `severity` /
    `suggestedAction`). The repo's shared `parseJsonb` already
    normalises postgres.js's object-vs-string return — no parse
    needed on the dashboard side
  - `MaintenanceRunSummary` extended: `projectId: string | null`,
    `status` widened to include `'running'`, `findings:
    MaintenanceFinding[]`, `durationMs: number | null`,
    `completedAt: string | null`
- `packages/dashboard/src/views/Maintenance.tsx`: rewrote the
  Recent runs row. Top-level accordion state is a
  `Set<string>` of expanded run ids (multiple rows can be open
  at once). Row header:
  - Status glyph (`●` completed green / `✗` failed red / `◎`
    running blue / `–` other dim)
  - `agentRole` in muted monospace
  - **New stats row**: `N findings` (amber when > 0, dim when 0
    so the operator can scan for "interesting" runs at a glance);
    `N intents queued` (amber, omitted when 0 — existing tag kept);
    `N fixes applied` (green, omitted when 0); duration in dim
    text formatted via `formatDuration` (`<1 s` shows `Nms`,
    otherwise `N.Ns`); timestamp; ▼/▲ chevron
  - Click toggles the expanded set
  - Expanded panel renders a Run summary `Section` (the same
    `Section` + `KV` helpers IntentDetail uses, lifted into this
    file so the two views stay independent) listing agent /
    status (glyph + word) / duration / direct fixes / intents
    queued / started + completed timestamps
  - Findings list: when `findings.length === 0`, a "No findings"
    Section with the body "Agent ran cleanly — nothing to report".
    When > 0, a "Findings (N)" Section with one `FindingCard` per
    finding
  - `FindingCard`: severity badge `⚠ {severity}` coloured red /
    amber / dim by severity; finding type as a small monospace
    chip on a `var(--bg-subtle)` background; first 3 affected
    files as a muted `<li>` list with "and N more" when there
    are more; description as readable text; if
    `suggestedAction` is present, a `→ <action>` line in muted
    italic. Defensive `?? []` on `affectedFiles` so a missing
    array doesn't crash the render

Verified live against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt; dashboard bundle is the new
  `index-CmtUBgy-.js` (220 KB, +15 KB for the panel code)
- **DB state used for verification (no new triggers needed):**
  - 1 alignment-agent run, 6 findings (4 `medium /
    domain-entity-without-module` against
    `docs/DOMAIN.md` + `docs/ARCHITECTURE.md`, 2 `low /
    golden-principle-not-cross-referenced` against `AGENTS.md` +
    `docs/GOLDEN_PRINCIPLES.md`), 6 intents queued, duration
    1307 ms
  - 4 drift-agent runs, all `findings: []`, durations
    1143–1720 ms
- **API smoke** (curl, the alignment row):
  - `GET /maintenance/runs?projectId=…&limit=20` returns
    `findings: [6 objects]`, `durationMs: 1307`, `completedAt:
    "2026-05-31T19:33:02.334Z"`, `intentsQueued: 6` on the
    alignment row; `findings: []` on every drift row. The
    server has been returning the full shape; the dashboard
    just wasn't reading it
- **Browser drive (headless Chrome via CDP):**
  - `/app/maintenance` renders. Each Recent runs row shows the
    new stats: `6 findings` in amber + `6 intents queued` in
    amber + `1.3s` + `10:33:01 PM` for the alignment row;
    `0 findings` in dim + `1.7s` + `10:26:42 PM` for each
    drift row
  - Clicked the alignment row → row expanded inline; Run
    summary panel rendered all 7 KV pairs (Agent / Status /
    Duration / Direct fixes / Intents queued / Started /
    Completed); Findings (6) Section rendered all 6 cards
  - DOM probe confirmed: 6 severity badges (`⚠ medium` × 4,
    `⚠ low` × 2), 2 type chips
    (`domain-entity-without-module` and
    `golden-principle-not-cross-referenced`), 3 captured
    suggested-action lines starting with `→ Either add an
    architecture module for 'components' / 'type' /
    'description' in docs/ARCHITECTURE.md…`, 4 distinct
    affected files in the file-line lists (docs/DOMAIN.md,
    docs/ARCHITECTURE.md, AGENTS.md,
    docs/GOLDEN_PRINCIPLES.md)
  - Clicked a drift row in parallel → the alignment row stayed
    open; the drift row expanded showing the Run summary +
    "No findings — Agent ran cleanly — nothing to report"
    Section. DOM probe found the exact text in the DOM
  - Full-page screenshot at 1400×2400 viewport captures both
    expanded panels stacked plus the remaining collapsed
    rows

Decisions made:
- **No new endpoint. No new migration.** The brief was explicit
  — the server already returns everything via the
  `MaintenanceRunRecord` shape. Confirmed by inspection of
  `maintenance-runs.ts` `complete()` (persists all 5 result
  fields with `::jsonb` cast) + the route's
  `reply.send({ data: records })`. The whole fix is dashboard-side
- **`findings` count is muted when zero, amber when > 0.** Brief
  said "amber if N > 0, dim if 0". A successful clean run
  shouldn't pull operator attention; a run with findings should.
  The chip is always rendered (even at 0) so the operator can
  see at a glance that the agent did run and the count
- **All data already loaded — no lazy fetch.** The runs array
  comes from `listMaintenanceRuns` with the full record. Clicking
  a row is pure UI state; no API call. Multiple rows can be
  expanded at once (matches the IntentDetail accordion idiom).
  No loading state, no error state in the panel — the data is
  either there or the row would not exist
- **`Section` + `KV` helpers re-implemented locally**, not
  imported from IntentDetail. IntentDetail's are not exported
  (they're file-local), and lifting them into a shared module
  for two callers is premature abstraction. If a third view
  ever wants the same pattern, factor then. For now the two
  copies are mechanically identical and ~12 lines each
- **`affectedFiles` truncates at 3 with "and N more".** Brief's
  value. Most findings list 2 files (the document and the
  source); the cap matters for drift-agent's `gestalt/*` branch
  cleanup list which can have many entries
- **Severity badge uses `⚠ {severity}` for every level**, not
  different glyphs per severity. The brief sketched the same
  glyph for all three; varying the glyph wouldn't add
  information past the colour
- **`status` widened to include `'running'`.** The core type has
  it (the `create()` method writes `'running'` before
  `complete()` flips to `'completed'` or `'failed'`). The
  dashboard would never see a running row today — the runner is
  in-process so by the time the response lands the row is
  already complete — but if maintenance moves to BullMQ later
  the dashboard would have to refresh and might catch the
  in-progress state. Typing it correctly today avoids a
  type-narrowing rework then
- **`durationMs: number | null`.** The core has it nullable. A
  `running` row has `null` duration; nothing in the wild does
  today, but typing it correctly tracks the schema

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; dashboard bundle live under `/app/`.
Full SDLC slice unchanged — this is a dashboard-only
enhancement that reads existing data. Both empty and populated
findings render correctly in the live browser; DOM probe
confirms every expected element shape.

No follow-ups added — feature is self-contained.

---

### Session 2026-05-31 — Claude Code (context-file maintenance intents take the direct-fix path)

Fixed a long-standing routing bug in the maintenance layer. Both
`alignment-agent` and `drift-agent` queue `CONTEXT_ALIGNMENT` /
`CONTEXT_UPDATE` intents whose suggested-action text is a *documentation
instruction* ("Update AGENTS.md to reference GP-003 …"). Previously the
runner unconditionally dispatched every queued intent into the generate
queue. The generate loop is the wrong tool — design-agent has no
architecture to design, code-agent produces nothing actionable, and
test-agent has nothing to test. Cycles either failed silently or burned
LLM budget producing no value. ADR-018 explicitly permits maintenance
agents to apply direct fixes for additive context-file edits; this
session wires that path through the runner.

Changed:
- `packages/agents/maintenance/src/types.ts`:
  - New `MaintenanceIntentClass` union
    (`'context-file-update' | 'code-change'`) + a pure switch
    `classifyMaintenanceIntent(type)` that maps `CONTEXT_UPDATE` /
    `CONTEXT_ALIGNMENT` → `'context-file-update'` and
    `PERFORMANCE_DEGRADATION` / `SECURITY_FINDING` → `'code-change'`.
    Both exported from the package's public surface
- `packages/agents/maintenance/src/agents/context-fixer.ts` (new):
  - `applyContextFileFix(intent, project)` — the direct-fix path.
    Signature returns
    `{ committed: boolean; commitSha?: string; reason?: 'no-change' |
    'truncation-guard' | 'file-missing' | 'llm-error' }` so the
    runner can branch on the outcome without catching the success
    case as an error
  - **Path guard runs BEFORE the clone OR the LLM call.** If
    `intent.affectedFiles[0]` is not in `docs/*` and is not exactly
    `AGENTS.md`, throws with a clear ADR-018 reference. Empty
    `affectedFiles` also throws. ADR-018 forbids the direct-fix path
    from touching `src/`; the guard makes that structural
  - Clone via `simple-git` to a `mkdtemp` dir; checkout
    `defaultBranch` (best-effort — a brand-new repo may have an
    unborn branch); read the target file, return `file-missing`
    cleanly if not present
  - LLM prompt: system message instructs "preserve all existing
    content … return the complete updated file content with no
    commentary or fences"; user message includes the current
    content wrapped in `<<<FILE` / `FILE>>>` markers + the
    finding's `evidence` + the `suggestedAction` (maintenance
    prefix stripped). `getLLMClient().complete()` with
    `maxTokens: 8192`, `temperature: 0.2`,
    `correlationId: 'ctxfix-<projectId>-<TYPE>'`. Defensive
    `stripFences` on the response just in case
  - **Truncation guard.** If the LLM-generated content is shorter
    than 50% of the original, log a warning and return
    `{ committed: false, reason: 'truncation-guard' }`. The most
    common LLM failure mode for "return the full file" tasks is to
    return only the delta or a summary; the guard catches that
    before the wrong content reaches Git
  - No-op short-circuits — `newContent === currentContent` and
    `repo.status().files.length === 0` both return cleanly without
    a commit
  - Commit author is `Gestalt Maintenance Agent
    <maintenance-agent@gestalt.local>`; subject is
    `docs: <cleanSubject (72-char cap)>
    [gestalt-maintenance/<TYPE>]` so
    `git log --grep='[gestalt-maintenance]'` enumerates every
    direct-fix commit. Push goes to `defaultBranch`. Temp dir
    cleaned in `finally` on every path
- `packages/agents/maintenance/src/runner/index.ts`:
  - Imports `classifyMaintenanceIntent` and `applyContextFileFix`
  - In the per-project loop, replaced the unconditional
    `dispatchMaintenanceIntent(intent)` call with a switch on
    `classifyMaintenanceIntent(intent.type)`:
    - `'context-file-update'`: call `applyContextFileFix` in-process;
      on success, increment `totalDirectFixes` and append a typed
      `direct-fix-applied` finding (with commit-sha lifted out for
      the operator). On thrown failure, append a typed
      `direct-fix-failed` finding (`severity: 'high'`,
      `suggestedAction: 'Check server logs for the full error and
      apply the fix manually.'`) and continue — one fix failing
      should not blow up an alignment-agent run with 6 candidates.
      On non-thrown skip (`reason !== undefined`), log at info and
      continue
    - `'code-change'`: unchanged path through
      `dispatchMaintenanceIntent` (writes an `intents` row + a
      `generate:intent` BullMQ task)
  - `dispatchMaintenanceIntent` is now only called for code-change
    intents
- `packages/agents/maintenance/src/index.ts`:
  - Re-exports `applyContextFileFix` + types so tests / advanced
    wiring can call it without going through the runner
  - Re-exports `MaintenanceIntentClass` + `classifyMaintenanceIntent`
- The alignment-agent and drift-agent themselves are unchanged —
  they already accumulated `intentsQueued: MaintenanceIntent[]` and
  returned it (they never called `dispatch()` directly). The brief's
  "Change 4" (turn the agents into pure detectors) was already true
  in the codebase

Verified live against `trackeros`:
- `pnpm -r build` clean across all 12 packages
- Server image rebuilt; `Up (healthy)`. Pre-trigger `main` HEAD on
  GitHub: `7feaf3d9`
- **First manual trigger** of alignment-agent via
  `POST /maintenance/trigger`. Response shape:
  ```
  status: completed
  intentsQueued: 0          (was 6 before this session)
  directFixes:   6          (was 0 before this session)
  findings:     12          (6 alignment findings + 6 direct-fix-applied)
  durationMs:    ~32 s
  ```
- Server logs show the expected sequence: `Applying direct context
  fix` × 6 / `Direct context fix committed` × 6, all from the
  `module: "context-fixer"` logger, with no errors or warnings.
  Each fix took 5–7 s end-to-end (clone + LLM call + commit + push)
- Post-trigger `main` HEAD: `46cace91`. Re-cloning the repo
  anonymously shows 6 new commits on top of `7feaf3d9` in the
  expected order, each authored by `Gestalt Maintenance Agent
  <maintenance-agent@gestalt.local>`, each with a subject starting
  `docs:` and a `[gestalt-maintenance/CONTEXT_ALIGNMENT]` trailer:
  - 4 commits to `docs/DOMAIN.md` (1–2 line additive tweaks for
    the four `entity-without-module` findings: `components`,
    `type`, `description`, `props`)
  - 2 commits to `AGENTS.md` (1-line additions adding `GP-003`
    and `GP-004` references for the orphan-principle findings)
- **Second manual trigger** to confirm the routing holds and that
  prior fixes carried through: `intentsQueued: 0`,
  `directFixes: 4` (the entity findings re-fire because the
  regex extractor still finds them in DOMAIN.md after the LLM's
  minimal edits — the LLM chose to refine descriptions rather
  than remove the entities; the GP-003 / GP-004 findings did NOT
  re-fire because the first run's AGENTS.md edits resolved them
  permanently). Four additional commits on `main`, same shape.
  The path guard, truncation guard, no-change short-circuit, and
  Git author config all continued to work as designed
- Final `main` HEAD: `af8d5747`. Ten total
  `[gestalt-maintenance]` commits landed in the two runs
- The Maintenance dashboard view already renders both stats
  (`intents queued` + `fixes applied`); no UI change was needed.
  The dashboard now shows `0 intents queued · 6 fixes applied
  · 32.1 s` on the post-fix runs, which is exactly the correct
  reading

Decisions made:
- **Path guard runs BEFORE the clone**, not before the LLM call only.
  Cloning a multi-MB repo to attempt a fix to a file the path guard
  would reject anyway is pointless. The guard's purpose — "this code
  path will never touch src/" — is best expressed by failing as
  early as possible. The LLM call is bypassed as a consequence
- **`MaintenanceIntent.affectedFiles[0]` is the canonical target.**
  Every existing call site for `CONTEXT_ALIGNMENT` / `CONTEXT_UPDATE`
  puts the file to *update* in slot 0 and the file *to compare
  against* in slot 1 (alignment-agent's three branches: DOMAIN.md
  first / ARCHITECTURE.md first / AGENTS.md first, depending on
  which side has the orphan). Documented in the agent's signal
  generation code. The fixer treats slot 0 as the authority
- **Truncation floor 50%** matches the brief. Empirically, even
  the most minimal LLM additive edit to a typical context file
  produces output > 95% of the original length (you have to copy
  the whole file just to add one line). 50% is generous against
  legitimate edits and decisive against "the LLM returned only
  the new section" failures
- **No-op short-circuits return reasons, not throws.** The runner
  needs to log "fix-not-needed" cases as info, not as errors —
  treating "the LLM happened to produce the same content" as a
  failure would noise the alerts view. The `reason: 'no-change'`
  / `'file-missing'` / `'truncation-guard'` / `'llm-error'` union
  gives the runner enough to record cleanly without an exception
  catch
- **`direct-fix-applied` and `direct-fix-failed` are surfaced as
  `MaintenanceFinding` rows on the run.** The dashboard's
  per-run findings panel already renders them — they show up
  alongside the original alignment findings so the operator can
  see the full causal chain in one expanded panel. `severity:
  'low'` on applied (informational) and `severity: 'high'` on
  failed (operator needs to intervene)
- **Commit author is `Gestalt Maintenance Agent`.** drift-agent's
  pre-existing additive-note path uses `Gestalt Drift Agent`;
  consistent naming pattern. Email is `*@gestalt.local`, same
  as drift-agent — the platform doesn't talk to a real mail
  server so the local TLD is fine
- **Failures are per-intent, not per-run.** A single intent failing
  (LLM error, push rejected, etc.) records a `direct-fix-failed`
  finding and continues to the next intent. The brief's "alignment
  agent produces 6 findings → 6 fixes" pattern only works if one
  bad fix doesn't abort the other 5. A try/catch around each
  applyContextFileFix call gives us that
- **`PERFORMANCE_DEGRADATION` / `SECURITY_FINDING` continue to
  flow through the generate orchestrator unchanged.** These need
  real code changes, real tests, real review — the generate →
  gate → deploy loop is correct for them. The classification
  switch is the *only* control flow change in the runner; the
  legacy `dispatchMaintenanceIntent` is still called for those
  cases

Build status: `pnpm -r build` clean across all 12 packages.
Server image rebuilt; manual triggers verified end-to-end.
Pending alignment-agent regex tightening (already on the
follow-ups list) would reduce repeat fixes per run, but the
routing fix is correct independently.

No new follow-ups added — feature is self-contained and lives
behind the existing ADR-018 / classification surface.

