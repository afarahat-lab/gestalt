# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-09 — Claude Code (TR_029: planner+evaluator prior-phase path rules — planner side verified; Aider code-agent prompt does not honour scope-cited paths; new HIGH follow-up captured)

Brief: add explicit "include prior-phase file paths in scope
text" rules to `agentConfig.planner-agent.phaseScopingRules`
and `agentConfig.phase-evaluator-agent.rules` to fix the
TR_028 Aider DTO-drift blocker. Push to template +
trackeros, re-submit the leave-management feature, verify
Phase 2 scope cites `src/modules/leave/leave.model.ts` by
full path.

What changed (HARNESS edits only — no platform code change,
no migration):

- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** —
  two new `agentConfig.planner-agent.phaseScopingRules` items
  (verbatim from the brief): one mandating per-phase explicit
  prior-file-path lists, one specifically for repository-phase
  scopes referencing the prior model path. One new
  `agentConfig.phase-evaluator-agent.rules` item mandating
  full-path replacement when adjusting scopes after a partial
  verdict.
- **`/Users/amrmohamed/Work/trackeros/HARNESS.json`** —
  identical edits committed as `cf35c03b`.
- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.14.0` → `0.15.0`.
- **trackeros cleanup** — `git rm leave.model.ts` to remove
  the stray repo-root file TR_028's fix-intent created.
  Committed alongside the HARNESS edit.

Test cleanup:

- Closed TR_028 stranded PRs #83 #84 #85 #87 (already
  closed; idempotent).
- Closed TR_029 stranded PRs #89 #90 #91 with
  `--delete-branch`.

Live verification (Step 2 + Step 3 of the brief):

- `gestalt feature submit "..."` returned feature
  `068adb58-cf71-43b6-993f-ed4889a861c7`, status `planning`.
- architecture-agent 21:38:21; planner-agent 21:38:29.
- Planner emitted 4 phases. **The planner-side change worked
  end-to-end** — PLAN.md `Phase 2` carries:
  > _Depends on: src/modules/leave/leave.model.ts,
  > src/modules/leave/leave.repository.ts_
  >
  > "This phase depends on src/modules/leave/leave.model.ts
  > and src/modules/leave/leave.repository.ts from Phase 1."
- **Phase 1 (model + repository in same phase) → ✓ deployed**
  at 21:41:45 via the full Aider 9s → CI pass → PR-Agent 33s
  → verdict `none` → gate (constraint-agent only, ADR-051
  skip) → squash-merge chain (PR #88). TR_023's "model +
  repository together" rule was actually applied this time
  because the rule had been in HARNESS.json for prior cycles
  but the planner wasn't honouring it before — TR_029's
  additional phaseScopingRules tipped it over.
- **Phase 2 (service) → blocked** after 3 attempts × 2
  self-healing retries each (6 total Aider runs in ~10
  minutes). PRs #89, #90, #91 all failed CI. **The
  Aider-side gap surfaced** — even with Phase 2's scope text
  explicitly saying "This phase depends on
  src/modules/leave/leave.model.ts...", Aider's generated
  service code hallucinated against the deployed Phase 1
  files:
  - Imported `ILeaveRepository` from `./leave.repository`
    (Phase 1 exports `LeaveRepository`, not `ILeaveRepository`)
  - Referenced `LeaveRequest.leaveType` (Phase 1 model has
    `leaveTypeId`)
  - Tried to import `../balance/balance.model` and
    `../employee/employee.model` — sibling modules that the
    planner never scheduled. The architecture-agent's
    high-level model list mentions balance/employee modules
    at the FEATURE level; the planner only scheduled 4
    phases (model+repo / service / routes / tests). Aider
    read the architecture description, not the actual phase
    scope.
- Self-healing this cycle chose **pure retry** every time
  (not `fix-intent`). The diagnostician's call wasn't
  unreasonable — the errors looked like "code mistake" not
  "systemic gap" — but on the same Aider-quality failure
  pattern as TR_028, a fix-intent dispatch wouldn't have
  unblocked the cycle either (TR_028 verified that path).
- Phase 2 hit `Phase retry budget exhausted — marking phase
  failed and feature blocked` at 21:52:54. Wall-clock
  submission → blocked: ~14m 33s.

What this VERIFIES:

- ✅ Planner correctly emits prior-phase file paths in scope
  text after the TR_029 rule additions. Visible in PLAN.md
  on trackeros main.
- ✅ Planner correctly bundles model + repository in a
  single phase (TR_023 rule + TR_029 reinforcement).
- ✅ Phase 1 deploys end-to-end through Aider → CI →
  PR-Agent → gate → promotion in <3 minutes — same shape
  as TR_028 Phase 1.
- ✅ PR-Agent posts the "PR Reviewer Guide" comment on PR
  #88; verdict `none` → proceed.
- ✅ Phase-evaluator returns `partial` (1 adjustment
  applied) and updates PLAN.md with the actual paths.
- ✅ Phase 2 auto-dispatched after Phase 1 deploys.
- ✅ Phase retry budget exhausts cleanly (`Phase retry
  budget exhausted` log line + feature `blocked` state).

What this DOES NOT verify (regression-equivalent of
TR_028):

- ❌ End-to-end multi-phase autonomous completion. Phases
  3 + 4 never reached.
- ❌ Aider reading the files the scope text names. Even
  with a verbatim "read it before generating any code that
  references its types" instruction, Aider hallucinates
  field names and import paths.

Decisions made:

- **Did not extend the code-agent prompt in this session.**
  The brief asked for HARNESS edits only; the Aider
  code-agent gap is a NEW finding from TR_029 verification,
  not part of the brief. Captured as a new HIGH follow-up
  for a future TR_xxx session.
- **Did not advance phase retry budget** above 2. The
  underlying failure is Aider's reading discipline, not
  budget; more retries would just multiply cost.

Pending follow-ups (NEW from TR_029):

- **(HIGH — NEW from TR_029)** Aider code-agent prompt must
  mandate `readFile()` on every path mentioned in the phase
  scope BEFORE generating code. Today the scope text says
  "depends on src/modules/leave/leave.model.ts" verbatim;
  Aider receives this and starts generating without
  reading. Options: (a) add a code-agent rule to HARNESS
  ("Before writing any code, call readFile() on every path
  mentioned in the scope under 'Depends on:'"); (b) modify
  code-agent's prompt assembler to pre-fetch the contents
  of cited paths and inline them; (c) Aider's `--read`
  flag for explicit file-list injection.
- **(HIGH — NEW from TR_029)** Architecture-agent's
  module-level high-level description ("Modules: leave /
  balance / policy / employee — each owns these files...")
  feeds into Phase 2's prompt context. Aider treats this as
  ground truth and tries to import from sibling modules
  that the planner never scheduled. Either (a) the
  architecture-agent's output shouldn't be in the
  code-agent's context (only the planner's phase scope
  should be), or (b) the planner's scope text must
  explicitly say "DO NOT import from modules outside this
  phase's file list".
- **(MEDIUM — NEW from TR_029)** Self-healing's `retry` vs
  `fix-intent` routing decision is opaque. In TR_028 the
  diagnostician chose `fix-intent` for the same class of
  Aider-quality failure; in TR_029 it chose `retry` every
  time. The decision is LLM-driven (ADR-050, no hardcoded
  pattern matching) so variance is expected — but
  operators should see WHY in the alert body
  (`technicalDetail` is populated but not surfaced on the
  current alert page).

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH)** TR_023/TR_028 Aider DTO drift —
  PROMOTED again as TR_029 confirmed the planner-side fix
  is necessary but not sufficient.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010
  mandatory `executeScript tsc --noEmit` code-agent rule on
  trackeros's HARNESS.json. Would have caught Phase 2's TS
  errors pre-emit before Aider committed each round.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture in `agent_executions.tokens_used`.

Build status: unchanged. `pnpm -r build` not re-run (no
source files modified). Server state unchanged. Docker
image unchanged. Template auto-refreshes on next server
boot to `0.15.0`.

trackeros operator commits in this session:
- `cf35c03b` — HARNESS.json TR_029 rules + remove stray
  repo-root `leave.model.ts`.

trackeros planning-loop commits (auto-merged):
- `c44960f7` — Phase 1 deployed (model + repository
  together in `src/modules/leave/`).
- (PLAN.md updates — `git pull` to see exact SHAs.)

PR-Agent's review comment confirmed on PR #88. PRs #89,
#90, #91 closed during cleanup.

---
### Session 2026-06-08 — Claude Code (TR_028: full planning loop re-test with PR-Agent on leave-management feature — autonomous machinery verified end-to-end; Phase 2 blocked by known TR_023 Aider DTO-drift)

Milestone test (per the brief): submit the leave management
feature to trackeros and verify the full planning loop runs
autonomously with PR-Agent, fix-intent self-healing, git-based
file detection, and phase evaluation all wired together.

Pre-flight (Step 1 + Step 2 of the brief):

- main was already at `8f17ef9` from the prior session — no
  branch merge needed. `pnpm -r build` clean; `docker compose
  ps` showed server / postgres / redis healthy. `/health` 200.
- trackeros main carried no stale `src/modules/leave/`
  directory (the brief's Step 2 cleanup was already current).
  Closed three pre-existing stranded PRs: #78 (earlier leave
  Phase 1), #53 (old health check), #48 (old scaffold).
- HARNESS.json verified: `planner.maxPhasesPerFeature: 10`,
  `maxFilesPerPhase: 5`, `maxPhaseRetries: 2`,
  `prAgent.enabled: true`, `pendingTimeoutSeconds: 90`.

Feature submission (Step 3):

- `gestalt feature submit "Build the leave management
  module..."` returned feature `e9240cb6-0533-4e0d-a372-
  f13e297debdd`, status `planning`.
- architecture-agent ran at 20:27:53, planner-agent at
  20:28:01 — both clean.
- Planner emitted 4 phases: model / repository / service /
  routes. PLAN.md committed to trackeros main + `_Adjustment:_`
  annotations added by phase-evaluator's `partial` verdict on
  Phase 1.

Per-phase timeline:

- **Phase 1 (model) — `94f1c8b7` → PR #82 → ✓ deployed.**
  Aider 5s → CI pass → PR-Agent 27s → verdict `none` → gate
  (constraint-agent only, ADR-051 skip) → squash-merged
  20:31:04. Wall-clock submit-to-deploy ~2m 44s. PR-Agent's
  "PR Reviewer Guide" comment confirmed on the PR.
- **Phase 2 (repository) — three attempts × 2 self-healing
  retries each, plus 1 fix-intent cycle — feature blocked.**

The autonomous machinery exercised exactly as designed:

- Phase 2 attempt 1 (`af45fd70` / PR #83) — CI failed on
  `TS2339 Property 'leaveType' does not exist on LeaveRequest`.
  Self-healing chose `retry` → retry failed → escalated as
  "retry introduced new violations" → planner-level retry
  fired (1/2).
- Phase 2 attempt 2 (`f777f69a` / PR #84) — same TS2339
  family of errors. Same retry-then-escalate cycle. Planner
  retry 2/2 fired.
- Phase 2 attempt 3 (`13d7ac9c` / PR #85) — same failure
  pattern. At 20:40:57 the self-healing-agent diagnostician
  chose **`action: 'fix-intent'`** ("systemic gap detected").
  Parent intent parked; child intent `53347035` dispatched
  with `source: 'self-healing-fix'`, `parent_intent_id` →
  13d7ac9c.
- **Fix-intent child — `53347035` → PR #86 → ✓ deployed.**
  Aider 4s → CI pass → PR-Agent 24s → verdict `none` → gate
  → squash-merged 20:43:18. Wall-clock fix-dispatch →
  fix-deployed → parent resumed ~2m 25s. `onSuccessDispatch`
  envelope fired at 20:43:22 — "Fix deployed — resuming
  original intent via onSuccessDispatch".
- **Parent Phase 2 resumed → also failed.** Aider's next
  generation drifted to a different mismatched field set
  (`totalDays / usedDays / year` on LeaveBalance). Self-
  healing burned another retry pair. 20:46:53 — "Phase retry
  budget exhausted — marking phase failed and feature
  blocked".

Final state: feature `e9240cb6` status `blocked`, 1/4 phases
deployed. Phases 3 + 4 not reached. Total wall-clock submission
→ blocked: ~19 minutes.

Root cause:

- **Aider DTO drift between phases — the known TR_023
  follow-up.** Phase 1's `src/modules/leave/leave.model.ts`
  defines `LeaveRequest.leaveTypeId` + `LeaveBalance.balance`.
  Every Phase 2 Aider run wrote a repository referencing
  DIFFERENT field names (`leaveType`, `totalDays`, `usedDays`,
  `year`). Aider isn't reading the existing model before
  writing the repository.
- **Fix-intent prompt quality gap — NEW from TR_028.** The
  diagnostician correctly chose `fix-intent` and dispatched a
  well-formed-sounding intent ("Define the LeaveBalance type
  to include properties: remainingLeaves, usedLeaves,
  totalLeaves"). But the prompt didn't include the file path
  the repository was importing from. Aider wrote a stray
  `/leave.model.ts` at the **repository root**, not at
  `src/modules/leave/leave.model.ts`. tsc never picked it up.
  PR #86 merged cleanly because the new isolated file
  compiles fine; the failing Phase 2 import still resolves
  to the old Phase 1 model. So the resumed Phase 2 failed
  identically to before the fix-intent.

What this VERIFIES architecturally (every TR_020–TR_027
mechanism actually fired in this single 19-min cycle):

- ✅ architecture-agent → planner-agent → PLAN.md commit
- ✅ TR_026 git-based file discovery via
  `AiderCodeAgent.discoverAiderWrites`
- ✅ TR_027 PR-Agent server-side invocation in /opt/pr-agent
  venv with per-call LLM creds — TWO clean runs on PRs #82
  and #86, both posted the "PR Reviewer Guide" comment
- ✅ ADR-051 gate skip: review-agent omitted, constraint-
  agent ran in parallel
- ✅ TR_026 phase-evaluator-agent calling git diff via
  executeScript (`partial` verdict emitted on Phase 1
  with 3 scope adjustments)
- ✅ Phase 2 event-bus auto-dispatch after Phase 1 deploy
- ✅ Self-healing diagnostician routing between `retry` and
  `fix-intent` (TR_024 + ADR-050)
- ✅ TR_024 fix-intent dispatch with `parent_intent_id`
  linkage + `onSuccessDispatch` envelope + parent resume
- ✅ TR_025 cascade-depth brake (`MAX_FIX_INTENT_DEPTH = 2`)
  — chain depth stayed at 1, no runaway
- ✅ TR_022 planner phase retry budget honoured (3 attempts
  total = 1 initial + 2 retries)

What this DOES NOT verify:

- ❌ End-to-end multi-phase autonomous completion. Phases 3
  + 4 never dispatched.
- ❌ Fix-intent prompt quality. The routing decision was
  correct; the resulting child prompt was too vague.

Test cleanup:

- Closed stranded Phase 2 PRs #83, #84, #85, #87 with
  `--delete-branch`.
- PR #86 (fix-intent's stray `/leave.model.ts` at repo root)
  left merged; it doesn't break anything because tsc never
  loads it, but trackeros's next planner cycle should be
  prefaced with a `git rm leave.model.ts` cleanup.
- TEST_REPORT_028.md committed in `docs/claude/` with the
  full per-phase log, root-cause analysis, and a cost
  envelope.

Pending follow-ups (NEW from TR_028):

- **(HIGH — promotes TR_023)** Aider DTO/repository drift
  remains the single hardest blocker for end-to-end
  autonomous feature completion. Either (a) extend
  code-agent's prompt with a mandatory "READ the imported
  model file before writing the repository" pre-step, or
  (b) require the planner to put `model + repository` in
  the same phase. The existing TR_023 rule isn't being
  enforced by the planner — Phase 1 ran model in isolation,
  Phase 2 ran repository in isolation.
- **(HIGH — NEW)** Self-healing fix-intent prompt
  enrichment. When choosing `fix-intent`, the diagnostician
  should include the exact failing import path and the
  deployed model's actual field shape. The TR_028 fix-intent
  dispatched a path-less "Define type X with properties A,
  B, C" prompt; Aider made the simplest interpretation and
  landed a stray root-level file.
- **(MEDIUM — NEW)** Phase-evaluator's `partial` verdict
  + scope adjustments work — PLAN.md was updated — but
  the adjustments don't feed back into the planner's
  "phase grouping" decisions. If the evaluator notices
  "Phase 1 only created the model, repository still
  needed", it could merge "model + repository" into one
  phase rather than annotating Phase 2.
- **(LOW — NEW)** The fix-intent flow logs "Fix deployed
  — resuming original intent via onSuccessDispatch" but
  doesn't emit a clear "parent resumed → Aider running"
  message at the resume point. Operators see two
  `Running Aider` log lines back-to-back and have to
  correlate by intent ID.

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH)** TR_023 / TR_028 Aider DTO drift —
  PROMOTED to a TR_028-priority blocker.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010
  mandatory `executeScript tsc --noEmit` code-agent rule
  on trackeros's HARNESS.json. Would have caught Phase 2's
  TS errors pre-emit before Aider committed each round.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture in `agent_executions.tokens_used` — TR_028's
  cost envelope had to be order-of-magnitude estimated
  because code-agent rows still show 0 tokens.

Build status: unchanged from TR_027. `pnpm -r build` not
re-run (no source files modified). Server state unchanged.
Docker image unchanged.

trackeros operator commits in this session: none (the
test only writes via the autonomous loop — PRs #82 (Phase 1
deployed) and #86 (fix-intent deployed)).

---
### Session 2026-06-08 — Claude Code (TR_027 / ADR-051: PR-Agent replaces review-agent — server-side direct invocation; venv isolation; verified end-to-end on trackeros PR #81)

Brief: replace Gestalt's custom review-agent with CodiumAI
PR-Agent invoked directly by the pipeline-agent as a server-side
`executeScript` subprocess after CI passes. No webhook, no
separate Docker service, no GitHub Secrets for LLM keys —
PR-Agent receives Gestalt's resolved LLM credentials via
subprocess environment variables for that one invocation only.

What changed (server-side architecture):

- **`packages/agents/deploy/src/adapters/pr-agent-adapter.ts`** —
  NEW. `runPrAgentReview()` resolves LLM env vars per call
  (Azure: `OPENAI__API_TYPE=azure` + `OPENAI__API_VERSION`;
  OpenAI/Ollama/compatible: `OPENAI__API_BASE` + `OPENAI__KEY`);
  invokes `pr-agent --pr_url="<url>" review` via `executeScript`
  with 60s default timeout. Returns typed `PrAgentResult` —
  never throws.
- **`packages/agents/deploy/src/orchestrator/deploy-orchestrator.ts`** —
  added `maybeRunPrAgentAndRoute()` between CI-passed and
  gate-dispatch. Clones a shallow workdir, calls `runPrAgentReview`
  with credentials resolved via `getLLMClientForModel()`, then
  polls the PR via `GitHubActionsAdapter.getPrAgentVerdict` for
  up to 30s (6 × 5s). Three outcomes: `approved`/`none` → proceed
  to gate; `changes-requested` → invoke `attemptSelfHealingForDeploy({
  failureType: 'review-requested-changes', ... })` (reuses
  existing fix-intent mechanism); `pending` after poll budget → proceed
  with warning. PR-Agent exit-non-zero ⇒ proceed (best-effort,
  don't block the cycle).
- **`packages/agents/deploy/src/adapters/github-actions-adapter.ts`** —
  added `getPrAgentVerdict()` + `getPrAgentComment()` polling the
  GitHub PR Reviews + Comments APIs. Recognised PR-Agent bot logins:
  `pr-agent[bot]` / `codiumai-pr-agent[bot]` / `qodo-merge-pro[bot]`.
- **`packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`** —
  `shouldSkipReviewAgent(projectRoot)` reads HARNESS.json; when
  `prAgent.enabled && pipeline.adapter === 'github-actions'` the
  orchestrator skips review-agent entirely. constraint-agent
  still runs in parallel (HARNESS-rule enforcement remains
  Gestalt's responsibility, not PR-Agent's).
- **`packages/agents/quality-gate/src/agents/llm-review-agent.ts`** —
  `@deprecated` JSDoc block added at the top. The file is kept
  as a fallback path for non-github-actions adapters.

Server image + subprocess isolation:

- **`packages/server/Dockerfile`** — PR-Agent installed alongside
  Aider via `pip`, but in its own venv (`/opt/pr-agent`) because
  PR-Agent's `litellm` version has exception classes that
  Aider's exception adapter doesn't recognise — Aider would
  crash at import time if they shared a venv. Aider lives in
  `/opt/aider`. `/usr/local/bin/aider` is a symlink to the
  Aider venv binary; `/usr/local/bin/pr-agent` is a shell shim
  invoking the PR-Agent venv's `python -m pr_agent.cli`.
  Required Alpine deps for the wheel build: `gfortran` +
  `openblas-dev` (PR-Agent's numpy/scipy transitive deps).
  `--prefer-binary` on the pip install keeps the image lean.

Harness + config:

- **`packages/core/src/harness/index.ts`** — `HarnessConfig` gained
  optional `prAgent?: { enabled, blockOnChangesRequested?,
  pendingTimeoutSeconds? }` block.
- **`packages/server/src/templates/pr-agent-toml.ts`** — NEW.
  `generatePrAgentToml(harnessConfig)` builds `.pr_agent.toml`
  from `agentConfig['review-agent'].rules` +
  `agentConfig['constraint-agent'].rules` (deduped); outputs
  `[pr_reviewer]`, `[pr_description]`, `[pr_code_suggestions]`
  sections so the rules drive PR-Agent's per-project focus.
- **`packages/server/src/routes/projects.ts`** — init-harness
  now writes `.pr_agent.toml`; new
  `POST /projects/:id/push-pr-agent-config` regenerates +
  pushes the toml on harness updates.
- **`packages/cli/`** — `gestalt project config push-pr-agent-config`
  command + `pushPrAgentConfig()` API client method.

Self-healing:

- **`packages/core/src/agents/self-healing-loop.ts`** — added
  `'review-requested-changes'` to `FailureType` union + title
  template. **`packages/core/src/repository/index.ts`** — added
  same to `AlertType` union.
- **`packages/adapters/postgres/src/migrations/027_self_healing_pr_agent.sql`** —
  NEW. Seeds a self-healing config row for the new failure
  type (retry type = `fix-intent`).

Templates:

- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** +
  **`/Users/amrmohamed/Work/trackeros/HARNESS.json`** — added
  `prAgent: { enabled: true, blockOnChangesRequested: true,
  pendingTimeoutSeconds: 30 }` block + a self-healing-agent rule
  for `review-requested-changes`.
- **`templates/corporate-ops-web-mobile/ci/gestalt.yml`** —
  reverted to TR_020 shape (push-only trigger, no PR-Agent CI
  step). PR-Agent runs server-side now.
- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.13.0` → `0.14.0`.

Pivots:

- **v1 → v2**: original brief had PR-Agent run as a GitHub
  Actions step gated by a `GESTALT_LLM_API_KEY` repo secret. User
  rejected the secret-distribution model and provided a v2 brief
  requiring server-side invocation with credentials resolved
  per-call from Gestalt's vault/registry. v1 plumbing (CI step,
  pull_request trigger) was reverted on both the template and
  trackeros's workflow.
- **Single-venv → dual-venv**: an early `pip install aider-chat
  pr-agent` in the Dockerfile broke Aider at runtime
  (`ValueError: PermissionDeniedError is in litellm but not in
  aider's exceptions list` — PR-Agent's litellm exception
  classes Aider's adapter doesn't know). Fix was venv isolation;
  cleaner than version-pinning either tool.
- **CLI flag form**: first verification attempt failed with
  `argument command: invalid choice: 'https://...'` because the
  adapter used `--pr-url URL` (hyphen, space) but PR-Agent's CLI
  expects `--pr_url=URL` (underscore, equals). One-line fix in
  `pr-agent-adapter.ts`.

Live verification — trackeros intent
`1ba554af-f1d0-445b-94d2-46b3a62f0b27` (correlation
`3648e162-...`, PR #81):

- 20:01:59 — Aider code generation start
- 20:02:05 — Aider complete (6s)
- 20:02:0_ — pr-agent push → CI workflow_dispatch
- 20:03:08 — Running PR-Agent review (server-side)
- 20:03:31 — PR-Agent review complete (23.5s)
- 20:03:43 — PR-Agent verdict resolved (`verdict: "none"` —
  PR-Agent posts a comment, not a formal review approval; `none`
  routes the same as `approved`: proceed to gate)
- 20:03:52 — ADR-051 — PR-Agent enabled; gate skipping
  review-agent (constraint-agent still runs)
- 20:04:03 — PR #81 squash-merged via auto-merge
- **Status: ✓ deployed**, single round, attempt_count=0,
  wall-clock 2m 04s.

PR-Agent's "PR Reviewer Guide" comment confirmed on PR #81:
estimated effort 1🔵 / no security concerns / table of findings.
Posted under the project PAT's identity (the operator's bot
account, not a dedicated pr-agent[bot] login — both work; the
adapter recognises either).

Decisions made:

- **Venv isolation over version pinning.** Pinning either
  litellm or aider-chat would couple the platform's upgrade
  cadence to two upstream projects. Each `/opt/<tool>` venv
  with PATH shims keeps the dep graphs entirely independent.
- **`verdict: "none"` → proceed.** PR-Agent's `review` command
  posts an informational `## PR Reviewer Guide` comment, not a
  formal GitHub PR review with APPROVED state. The deploy
  orchestrator treats `none` identically to `approved` —
  CHANGES_REQUESTED is the only verdict that routes to
  self-healing. Avoids false-positive blocking on every PR.
- **Best-effort on PR-Agent failure.** Exit-non-zero from the
  subprocess (network blip, LLM auth issue, malformed PR diff)
  emits a WARN and proceeds. Blocking the deploy on a
  PR-reviewer adjunct would defeat the point.
- **`@deprecated` rather than delete** llm-review-agent.ts.
  Kept as the fallback path for non-github-actions adapters
  (the `getPrAgentVerdict` polling is GH-specific).
- **`.pr_agent.toml` generated from HARNESS rules.** PR-Agent
  reads `extra_instructions` from the file; deriving it from
  HARNESS rules means a single source of truth for "what does
  this project consider a violation."
- **Closed stranded PR #79** (failed first attempt with broken
  default-export edit; clean state on trackeros now).

Pending follow-ups (NEW from TR_027):

- **(LOW)** PR-Agent's verdict polling has a 30s budget
  (6 × 5s). If PR-Agent itself takes longer than 30s (which
  rarely happens — typical wall is ~23s), the verdict falls
  through to `pending → proceed`. Could be threaded into
  HARNESS.json's `prAgent.pendingTimeoutSeconds` to make the
  poll budget project-tunable (the field already exists in
  the type, just not yet read by the orchestrator).
- **(LOW)** `chat-latest` as a litellm model alias works
  because OpenAI's `chat-latest` resolves at the API edge.
  Other providers (Anthropic, Ollama) would need their own
  alias semantics. Document as a known constraint of the
  per-project LLM choice.

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend capture in
  `agent_executions.tokens_used`.
- **(STILL OPEN — MEDIUM)** TR_019: `gestalt init` scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest with TS.
- **(STILL OPEN — LOW)** TR_019: template `{{ciSetupSteps}}` for
  Node/npm should add `--legacy-peer-deps`.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt twice (venv split + CLI flag fix); on the
final run `aider 0.86.2` + `pr-agent` (latest) both invoke
cleanly. `/health` 200 throughout. Template auto-refreshed at
boot: `version: "0.14.0"`. trackeros PRs: #80 deployed (first
flow — but PR-Agent failed silently due to CLI flag bug;
proceed-on-error path worked, deploy still succeeded). #81
deployed (full flow including PR-Agent posting its review
comment). #79 closed-stranded from the broken first attempt.

