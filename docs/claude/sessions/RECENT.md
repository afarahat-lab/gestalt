# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-09 — Claude Code (TR_030 + TR_031: combat Aider DTO drift via Aider-message-builder additions and PLAN.md "What has been built" + context-only fix-intent — structural mechanisms verified, Aider compliance still partial)

Two consecutive briefs in one day, both targeting the
TR_028/TR_029 blocker: Aider doesn't read existing files
before generating, drifts on type names, and creates
references to non-existent sibling modules. TR_030 added
two generic prose instructions to the Aider message;
TR_031 added a structured "What has been built" section
to PLAN.md and reshaped the self-healing fix-intent
contract per ADR-042.

What TR_030 changed (commit `bb70cf7`):

- **`packages/agents/generate/src/adapters/aider-message-builder.ts`** —
  added two generic behavioural instructions:
  - `## Before generating any code` — "Read every existing
    file in the repository that your generated code will
    import from or extend. Confirm the exact field names,
    exported types, and function signatures before
    referencing them. Do not assume a type's shape — read
    its definition."
  - `## Important — architecture context is reference only` —
    appended after the design context: "The architecture
    and design context above describes the intended system
    design. Many modules and types it mentions DO NOT EXIST
    YET in the repository — they are planned for future
    phases. Only import from files that actually exist in
    the repository."
- No file names, no project-specific content. Aider decides
  which files to read based on its repository map.
- Pure platform mechanic. No HARNESS change, no migration.

What TR_031 changed (commits `626957b…ff7a75c…89ba9b8…`):

- **`packages/agents/generate/src/adapters/aider-message-builder.ts`** —
  added `## Read PLAN.md first` section telling Aider to
  read PLAN.md and use the "What has been built" sub-
  sections under completed phases as the source of truth
  for what files + exports exist. Platform mechanic per
  ADR-042 (every Gestalt planning project has a PLAN.md
  committed by the orchestrator — instruction is not
  project-specific).
- **`packages/agents/planning/src/types.ts`** —
  `PhaseEvaluation.builtFiles` field added: `Array<{ path,
  exports? }>` populated by the phase-evaluator-agent from
  its existing git diff + readFile pass.
- **`packages/agents/planning/src/prompts/evaluator-prompt.ts`** —
  prompt extended: ask the agent to also extract KEY
  EXPORTS for every non-metadata file the git diff shows.
  Schema example uses placeholder strings (`"<title of a
  remaining phase>"`) instead of literal-looking paths so
  the LLM doesn't copy them verbatim. Added an emphatic
  "you MUST run executeScript BEFORE writing your JSON
  response" line after the first verification cycle's
  phase-evaluator hallucinated "Aider wrote 0 files
  (confirmed by git diff)" with `toolCallCount: 0`.
- **`packages/agents/planning/src/agents/phase-evaluator-agent.ts`** —
  `parsePhaseEvaluation` now extracts `builtFiles` from
  the LLM JSON output with defensive type guards.
- **`packages/agents/planning/src/orchestrator/planning-orchestrator.ts`** —
  `rewritePlanMd` renders a `**What has been built:**`
  bullet list under each `deployed` phase. Also moved
  PLAN.md re-emit OUT of the `if (adjustments.length > 0)`
  guard so the "What has been built" block lands on
  EVERY successful phase, not just ones that produced
  scope adjustments.
- **`packages/core/src/agents/self-healing-agent.ts`** —
  the `fixIntent` field in the diagnostician's response
  JSON schema was rewritten from prescriptive ("complete
  Aider-ready intent text") to context-only: "describe the
  CONTEXT and FAILURE that needs resolving. Include the CI
  error text, which files are involved, and what the code
  was trying to do. Do NOT write prescriptive instructions
  telling Aider what code to write. Provide context — let
  Aider decide the fix." Verbatim WRONG/CORRECT examples
  embedded in the schema string.
- **HARNESS.json `agentConfig.self-healing-agent.rules`**
  (template + trackeros): added a project-tunable
  preservation rule — "Fix-intent context must end with a
  preservation statement. For TypeScript projects: 'Do not
  remove or rename existing exports, types, or interfaces.
  Only add or modify what is needed to resolve the CI
  failure.'" Operators on Python projects swap the
  TypeScript-specific clause for their language.
- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.15.0` → `0.16.0`.

Live verification timeline (interleaved TR_030 + TR_031):

- **TR_030 first attempt** (feature `cb51d8fa`) — Phase 1
  deployed cleanly (Aider produced an internally-consistent
  model + repository with `leaveType: LeaveType`). Then
  feature got marked `blocked` not by Aider quality but by
  a transient DNS blip in the container (`Could not resolve
  host: github.com`) at the planning orchestrator's
  Phase-2 clone time. Once DNS recovered, the orchestrator
  had already retried twice and given up.
- **TR_030 second attempt** (feature `7d2acd20`) — Phase 1
  deployed via PR #93. Phase 2 (service) hit:
  - Aider hallucinated `ILeaveRepository` (Phase 1 exports
    `LeaveRepository`)
  - Imports `../balance/balance.model` and
    `../employee/employee.model` from the architecture
    description (Aider treats it as ground truth)
  - Added a `reason` field to LeaveRequest destructure
  - Renamed class `LeaveRepository` → `LeaveRequestRepository`
  Self-healing chose `fix-intent` on phase retry 2/2 —
  fix-intent's prompt was prescriptive ("Update LeaveRequest
  to add reason, updatedAt, leaveType"). Aider received it
  and wholesale-rewrote `leave.model.ts`, **dropping
  `CreateLeaveRequestDto`** which existing tests imported.
  Cascade fix-intent failed at depth 2 → TR_025 brake.
  Feature blocked.

This second attempt was the seed for the TR_031 brief —
the diagnostician's prescriptive prompts cause Aider to do
wholesale rewrites instead of surgical edits, dropping
sibling exports. The fix-intent contract needs to be
context-only.

- **TR_031 verification cycle 1** (feature `2998ff5e`) —
  Phase 1 deployed (PR #99 squash-merged). Then **the new
  phase-evaluator-agent hallucinated** `verdict:
  "escalate"` with `summary: "Aider completed but wrote 0
  files (confirmed by git diff)"` despite `toolCallCount:
  0` in the log. The model didn't run the executeScript
  tool — it lied about having checked. Caused by my added
  schema example using literal-looking paths
  (`src/modules/leave/leave.model.ts`) which the model
  treated as a pre-filled hint. Patched: replaced with
  placeholders + emphatic "you MUST run executeScript"
  line, rebuilt.
- **TR_031 verification cycle 2** (feature `0a9b14f6`) —
  Phase 1 deployed cleanly. Phase 2 (service) failed CI:
  same DTO drift family as TR_030. But this time **the
  test file on trackeros main was stale** from earlier
  cycles (`tests/unit/leave.model.test.ts` referenced
  `leaveType` while the new Phase 1's model wrote `reason`
  + no `leaveType`). Self-healing chose retry → retry →
  retry across phase retries 1/2 + 2/2 — never picked
  fix-intent. Phase 1 blocked.
- **Cleanup commit** `d196fc66` on trackeros main:
  `git rm src/modules/leave/ tests/unit/leave.model.test.ts`
  to clear cross-feature contamination from prior TR_028/
  TR_029/TR_030 cycles. The stale-test-pollution-on-main
  issue is a real operational gap — captured below as a
  new MEDIUM follow-up.
- **TR_031 verification cycle 3** (feature `35fb580e`) —
  with a clean trackeros main:
  - Phase 1 deployed cleanly (Aider 12s → CI pass →
    PR-Agent 37s → gate (constraint-agent only) → squash-
    merge).
  - **Phase-evaluator-agent ran git diff + readFile** and
    populated `builtFiles` correctly:
    ```
    **What has been built:**
    - `src/modules/leave/leave.model.ts` — `interface LeaveRequest`, `interface CreateLeaveRequestDto`
    - `src/modules/leave/leave.repository.ts` — `class LeaveRepository`
    ```
    Committed in PLAN.md on main. **TR_031 "What has been
    built" verified ✓**.
  - Phase 2 (service) CI failed — Aider drifted again:
    `ILeaveRepository` hallucination + sibling-module
    imports (`../balance/balance.model`,
    `../employee/employee.model`). PLAN.md's "What has been
    built" section was there but Aider didn't follow it.
  - **Self-healing chose `fix-intent` immediately on the
    first CI failure** (TR_028/TR_029 pattern took 3 attempts).
    Fix-intent text:
    > "CI failed: TypeScript errors in leave.service.ts.
    > The service references '../employee/employee.model'
    > and '../balance/balance.model', which cannot be
    > found. Additionally, it incorrectly references
    > 'ILeaveRepository' from './leave.repository', which
    > does not exist. Analyze and fix these import issues
    > to ensure the leave.service.ts file compiles
    > correctly."
    **Context-only, no prescriptive instructions.
    TR_031 fixIntent JSON-schema rewrite verified ✓**.
  - Fix-intent's Aider then **inverted the prompt** — it
    READ "ILeaveRepository does not exist" and CREATED
    `ILeaveRepository` interface anyway, plus introduced a
    `Leave` type undefined anywhere. Second fix-intent
    dispatched with identical text. **TR_025 cascade-depth
    brake fired at depth 2 — escalating ✓**. Feature
    blocked.

What's VERIFIED:

- ✅ `What has been built` populated correctly in PLAN.md
  after Phase 1 (cycle 3). Phase-evaluator-agent runs git
  diff + readFile, emits `builtFiles` JSON, orchestrator
  renders it.
- ✅ Fix-intent text is now context-only ("CI failed: TS
  errors in X. References Y. Analyse and fix.") — not
  prescriptive ("Update X to add Y"). Confirmed across
  both fix-intents in cycle 3.
- ✅ TR_025 cascade-depth brake fires at depth 2 — verified
  in cycle 3.
- ✅ Aider message-builder now includes `## Read PLAN.md
  first` + `## Before generating any code` + `## Important
  — architecture context is reference only`. Code path
  shipped; the prompt reaches Aider on every code-agent
  run (verified by the Phase 1 successful generation).
- ✅ HARNESS preservation rule landed on template + trackeros.

What's NOT VERIFIED end-to-end:

- ❌ Aider compliance with `## Before generating any code`.
  Phase 2 of cycle 3 still drifted (`ILeaveRepository`
  hallucinated, sibling modules imported). The prompt
  instruction is in Aider's context but Aider doesn't
  follow it consistently. This is the same conclusion as
  TR_029.
- ❌ HARNESS preservation rule reaching the dispatched
  fix-intent text. The HARNESS rule says "Fix-intent
  context must end with a preservation statement" but
  neither of the two fix-intents in cycle 3 had the
  preservation footer. The diagnostician LLM didn't append
  it — the HARNESS rule didn't translate into runtime
  behaviour. **The preservation requirement may need to
  live in the JSON-schema `fixIntent` description**
  (platform mechanic) rather than a HARNESS bullet
  (configurable). ADR-042 split argued for the latter; in
  practice the LLM doesn't reliably honour configurable
  HARNESS rules over schema descriptions.
- ❌ Aider's reaction to negated phrases. The fix-intent
  said "X does not exist" — Aider read that and CREATED
  X. This is a classic LLM-inversion behaviour that no
  amount of prompt engineering reliably fixes.

Decisions made:

- **Cleaned trackeros main between cycles 2 and 3.** Stale
  files from TR_028/TR_029/TR_030 (`src/modules/leave/`,
  `tests/unit/leave.model.test.ts`) were contaminating
  every fresh cycle because Aider reads them as ground
  truth. The cleanup unblocked cycle 3. This is a real
  ops gap — captured below.
- **Did not extend `BaseLLMAgent.callLLMWithTools` to
  reject responses without tool calls.** The phase-
  evaluator-agent hallucinated `toolCallCount: 0` in
  cycle 1. Could be enforced by the harness (reject + retry
  if the model emits a final answer without invoking
  required tools), but that's a bigger change deferred to
  a follow-up. For now: emphatic prompt line + placeholder
  schema strings reduce the chance.
- **Did not change Aider's invocation flags.** Aider has
  a `--read <file>` CLI flag that forces a file into its
  context. Could pass the PLAN.md `What has been built`
  paths via `--read` to make Aider literally have to read
  them. Deferred — keep the chain of changes narrow.

Pending follow-ups (NEW from TR_030 / TR_031):

- **(HIGH — NEW from TR_031)** Move the preservation
  requirement from HARNESS bullet into the `fixIntent`
  JSON-schema description in `buildDiagnosisPrompt`. The
  HARNESS rule was not honoured by the LLM in two
  consecutive fix-intent dispatches. Schema-string
  guidance reliably influences output; HARNESS bullets are
  more advisory.
- **(HIGH — NEW from TR_031)** Aider invocation could use
  `--read <file>` for every path the planner's scope cites
  under `_Depends on:_`. Forcing the file into Aider's
  context is stronger than a prose "please read this
  first" instruction. Same logic for the PLAN.md path —
  pass `--read PLAN.md` always.
- **(MEDIUM — NEW from TR_031)** Stale-file pollution on
  trackeros main from failed prior cycles contaminates
  every fresh attempt. When a feature gets blocked, the
  files committed in deployed phases stay on main. The
  next cycle's Aider reads them as ground truth and tries
  to compose around them, often introducing new conflicts.
  Options: (a) `gestalt feature` reset command that
  un-merges deployed phases of a blocked feature; (b)
  PLAN.md tracks "files this feature owns" and the
  rewritePlanMd cleanup-on-block step git-rm them.
- **(MEDIUM — NEW from TR_031)** Phase-evaluator-agent
  hallucinated `verdict: escalate` with
  `toolCallCount: 0` in cycle 1. The
  `callLLMWithTools` loop should reject responses where
  the agent's JSON claims tool-derived evidence (e.g.
  "confirmed by git diff") but the model didn't invoke
  any tools. A simple check: if the prompt says "you MUST
  run X" and the model returned a final answer without
  invoking X, retry once.
- **(MEDIUM — NEW from TR_030/TR_031)** Aider doesn't
  reliably parse negated assertions. Fix-intent said "X
  does not exist" — Aider created X. The diagnostician's
  prompt should be framed as POSITIVE assertions: "The
  service should use `LeaveRepository` (which exists at
  `src/modules/leave/leave.repository.ts`)" rather than
  "ILeaveRepository does not exist". This is a fixIntent
  schema-description change, not a HARNESS change.
- **(LOW — NEW from TR_031)** The phase-branch is deleted
  on squash-merge before the phase-evaluator runs against
  it. `git diff origin/<default>...origin/<phaseBranch>`
  returns empty when the branch is already gone, leading
  the evaluator to a false "0 files" verdict (caught here
  by the emphatic-tool-use prompt fix, but a more robust
  path is to pass the merge SHA in `branchContext`).

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH, promoted again)** Aider DTO drift.
  TR_030's prose instruction + TR_031's PLAN.md "What has
  been built" both shipped; neither produced reliable
  end-to-end multi-phase completion. The Aider-invocation
  change (`--read <file>`) is now the leading candidate.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010
  mandatory `executeScript tsc --noEmit` code-agent rule
  on trackeros's HARNESS.json. Pre-emit TS check on each
  Aider run would catch most of the drift before commit.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture in `agent_executions.tokens_used`.

Build status: `pnpm -r build` clean across all 13 packages
on each iteration. Docker server rebuilt twice (once per
TR_030 + TR_031). All builds clean. Server `/health` 200
throughout. Template auto-refreshes on next server boot to
`0.16.0`.

trackeros operator commits in this session:
- TR_030: HARNESS edits (no new). Stranded PRs closed.
- TR_031: `7d94746a` — HARNESS preservation rule added.
  `d196fc66` — `git rm` stale leave module + test (cycle
  3 cleanup).

trackeros planning-loop commits (auto-merged on main):
- Cycle 2: PR #93 Phase 1 deploy.
- Cycle 3: PR (Phase 1 deploy with new model+repo).

Multiple stranded PRs closed during cleanup: #94–#107
range across the day.

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

