# BUILD.md — Build status + known issues

## How to run builds

```bash
pnpm -r build                 # build all packages (topological order)
pnpm --filter @gestalt/core typecheck

docker-compose up -d          # postgres + redis + server (production stage)
docker-compose logs -f server
```

---

## Current build status

| | |
|---|---|
| `pnpm -r build` | ✅ clean (13 packages) |
| `docker-compose up -d` | ✅ healthy (server / postgres / redis) |
| Migrations applied | 029 (latest: `029_token_management_and_phase_merge`) — no new migration in TR_036 |
| Server reachable | `http://localhost:3000/health` returns 200 |
| Dashboard | served at `http://localhost:3000/app/` |

The 13 buildable packages: `@gestalt/core`, `@gestalt/adapter-postgres`,
`@gestalt/adapter-oracle` (stub), `@gestalt/adapter-mssql` (stub),
`@gestalt/agents-generate`, `@gestalt/agents-quality-gate`,
`@gestalt/agents-deploy`, `@gestalt/agents-maintenance`,
`@gestalt/agents-planning` (migration 024), `@gestalt/registry`,
`@gestalt/server`, `@gestalt/cli`, `@gestalt/dashboard`.

---

## Known issues

None blocking the build. Areas to keep in mind:

1. **`UserRepository` / `ProjectRepository` extensions touch every
   adapter.** Adding a method means Oracle + MSSQL stubs must add the
   same method (as throw-stubs is fine). Build will fail until every
   adapter implements the new surface.
2. **CLI pins chalk@4 / ora@5 for CJS compatibility.** Do not upgrade
   either without performing the full ESM migration (`"type":
   "module"`, `.js` extensions on relative imports, Dockerfile
   update). The pin is intentional.
3. **Dashboard bundle 1010 KB raw / 319 KB gzipped** after the
   CodeMirror addition. Above Vite's 500 KB warning. Acceptable for an
   admin-only feature.
4. **LLM model name not validated at startup.** `loadConfig` accepts
   any non-empty string for `LLM_MODEL`. Invalid model surfaces as a
   404 on the first LLM call.

---

## Pending operator actions

### TR_041 — Stack compliance check at TOP of review prompt + lifecycle coverage as 5th checklist item + lifecycle architectureGuidance rule (template 0.26.0, build clean, feature-level pipeline fully cleaned of framework leak)

Three fixes against TR_040's two HIGH NEW follow-ups (Vitest
binding still leaking; lifecycle-coverage gap).

- **Fix 1** —
  `packages/agents/planning/src/prompts/architecture-prompt.ts`
  `buildArchitectureReviewPrompt` restructured. The
  `## Stack compliance check (read this first)` block is now
  rendered FIRST in the prompt (before persona, harness
  section, draft JSON, feature description). The block
  wording strengthened: "REWRITE the relevant field with the
  declared stack value. Do not preserve the original."
- **Fix 2** — same function. The four-point review checklist
  gains a 5th item: "Lifecycle coverage — for every entity
  whose state changes during the feature lifecycle, verify
  that at least one phase in `recommendedPhases` includes a
  method to perform that mutation. If a state transition
  exists in the feature description but no phase adds the
  corresponding mutation method, ADD it to the most
  appropriate phase."
- **Fix 3** — `agentConfig.architecture-agent.architectureGuidance`
  in template + trackeros HARNESS appended with: "Every state
  transition described in the feature must have a
  corresponding method in at least one phase. If an entity
  changes state during the feature lifecycle, ensure the
  phase plan includes a method for each transition — not
  just the initial creation."

Template `0.25.0 → 0.26.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — TR_041 Fix 1 works end-to-end on the
FEATURE-level pipeline:** trackeros feature
`595033ff-99b2-460a-b532-70b99e6fed3d` on `chat-latest`:
- ✅ Post-review feature architecture is FRAMEWORK-FREE.
  DB query for framework refs: `jest=0 vitest=0 fastify=0
  express=0`. Compare to TR_040 which still had
  `vitest=1`. The TOP-positioned stack compliance check
  conditions the LLM strongly enough that it doesn't even
  reach for framework names in the draft.
- ✅ Planner's Phase 1 scope text says "Jest" (not
  "Vitest", not "Jest or Vitest" hedge).
- ✅ 8-phase bottom-up dependency-ordered plan:
  Employee → LeavePolicy → LeaveBalance → balance ops →
  LeaveRequest → submission → approval → notification.
  Phase 7 IS the mutation phase the lifecycle-coverage
  rule asked for — verified at the plan level.

**Cycle still blocked at intent-agent on two NEW gaps:**
- ❌ Per-phase `designPhase` STILL emits "Vitest tests" in
  success criteria. TR_041's review enhancements apply only
  to `reviewDesign` (feature-level), not `designPhase`
  (per-phase). The per-phase pass has the stack section +
  architectureGuidance rules but NO review pass.
- ❌ Intent-agent caught a scope-vs-architecture file-count
  mismatch — Phase 1 scope text lists 2 files
  (`employee.model.ts` + `employee.repository.ts`); the
  per-phase architecture lists 3 files (adds
  `postgres-employee.repository.ts`) + a SQL schema.

**New HIGH follow-ups for TR_042:**
- Add `reviewPhaseDesign` mirroring `reviewDesign` so the
  per-phase pass gets the same stack compliance gate. Or
  extend `designPhase` to internally re-run with a
  compliance/scope-alignment instruction appended.
- Planner-agent must mirror architecture-agent's file list,
  not just symbol names. Options: planner-prompt rule
  forcing it to reference the per-phase architecture's
  file list verbatim, or a post-process substitution.

**Operator action — trackeros:** none new beyond the
already-pushed `aec2340f chore(TR_041): architecture-agent —
lifecycle coverage rule`.

**Operator action — other projects:** Append the
lifecycle-coverage rule to
`HARNESS.json.agentConfig.architecture-agent.architectureGuidance`.
Template auto-refreshes to `0.26.0` at next server boot.

### TR_040 — Architecture-agent binds to HARNESS.stack declared values (template 0.25.0, build clean, partial verification: Fastify bound end-to-end, Vitest binding deferred)

Two changes against TR_039's HIGH NEW follow-up
(architecture-agent ignores `HARNESS.stack`).

- **Fix 1** — `agentConfig.architecture-agent.architectureGuidance`
  in template + trackeros HARNESS gains two new abstract rules
  (no framework names hardcoded): one declaring the
  HARNESS.stack as authoritative for all technology choices;
  one telling the agent to verify every framework reference
  matches the declared stack before emitting the response.
- **Fix 2** — `buildArchitectureReviewPrompt` gains a
  `## Stack compliance check` block rendered IMMEDIATELY
  before the JSON output schema, listing `HARNESS.json.stack`
  as pretty-printed JSON and telling the agent to correct any
  mismatch in success criteria, interface names, or
  implementation notes. Empty string when `HARNESS.stack` is
  absent — the section is omitted cleanly.

Template `0.24.0 → 0.25.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — PARTIAL:** trackeros feature
`8900ab21-bc26-4f89-a000-7c74e02aaa24` on `chat-latest`:
- ✅ **Fastify binding worked end-to-end.** DB query for
  framework refs in the post-review feature architecture:
  `fastify=1 express=0` (vs prior cycles which had
  `express=1`). Phase 8 title literally reads "Expose Fastify
  APIs and workflow integration tests".
- ❌ **Vitest binding did NOT work.** Same DB query:
  `jest=0 vitest=1`. Phase 1 success criteria still says
  "Vitest tests for the repository verify successful create
  and findById persistence". The Phase 1 scope text reads
  "Include Jest or Vitest unit tests" — hedge phrasing
  showing the LLM read both signals and split the difference.
- ⚪ **reviewDesign ran (5s, before/after counts 5→5)** but
  didn't observably rewrite the framework references — the
  stack compliance check is in the prompt but didn't override
  chat-latest's Vitest bias.

**Cycle blocked at intent-agent on a separate finding:**
`LeaveRequestRepository` has only `create + findById` and
no later phase ever adds `update`, even though Phase 5
("manager approval and rejection workflow") needs to mutate
`LeaveRequest.status`. Architecture-agent regressed on
coverage vs TR_038/039 — possibly misreading TR_039's
deferred-section text as a license to minimize Phase 1's
interface and forgetting to add the methods in later phases.

**New HIGH follow-ups for TR_041:**
- Vitest binding: move the stack compliance check to the
  TOP of the review prompt, or add a regex post-processing
  pass after reviewDesign that reads `HARNESS.stack.testFramework`
  and substitutes any other test-framework name in the
  result JSON.
- Lifecycle coverage rule: every domain entity whose state
  transitions during the feature lifecycle must have a phase
  where the corresponding mutation method is added to its
  repository. Either a new `architectureGuidance` rule or a
  5th checklist item in `reviewDesign`.

**Operator action — trackeros:** none new beyond the
already-pushed `6c76cc2f chore(TR_040): architecture-agent must
bind to HARNESS.stack declared values`.

**Operator action — other projects:** Append the two new
architectureGuidance items to existing projects'
`HARNESS.json.agentConfig.architecture-agent.architectureGuidance`.
Template auto-refreshes to `0.25.0` at next server boot.

### TR_039 — Phase intent text declares deferred scope; intent-agent rules tell it not to flag deferred work (template 0.24.0, build clean, TR_038 follow-up CLOSED; cycle reached the GATE for the first time)

One platform change + one HARNESS rules block. Closes TR_038's
HIGH follow-up (intent-agent CRUD-completeness rigor on phased
delivery).

- **Fix 1** —
  `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
  queries `features.listPhases(featureId)` before dispatching
  each phase intent, filters to `phaseIndex > current &&
  status === 'pending'`, and passes that to
  `buildPhaseIntentText` as a new required parameter. The
  builder appends `## Deferred to later phases` listing each
  later-pending phase as
  `- Phase N — <title>: <scope snippet, 100 chars>`. The
  section becomes part of the intent text the pipeline
  already persists; no new field on the intent record.
- **Fix 2** — new `agentConfig.intent-agent` block on
  template + trackeros HARNESS (didn't exist before). Two
  abstract rules:
  1. "This intent describes a single phase of a multi-phase
     feature. If a 'Deferred to later phases' section is
     present, the items listed there are intentionally out of
     scope for this phase. Do not flag them as ambiguities
     or missing functionality."
  2. "Evaluate the intent against what this phase explicitly
     commits to delivering, not against the full feature
     description."

Template `0.23.0 → 0.24.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — TR_038 follow-up CLOSED + the cycle
finally reached the GATE:** trackeros feature
`61953f63-6655-47ae-8be9-879bcc1bffe2` on `chat-latest`:
- All 3 Phase-1 attempt-intents contained the Deferred
  section (DB-confirmed). Each retry rebuilt the section
  from scratch.
- Intent-agent passed cleanly on every attempt — no
  escalation on deferred CRUD operations.
- **The cycle reached the gate for the first time across
  TR_036 → TR_039.** Gate ran 6 times. As a side-effect,
  TR_036's project-structure brief was observed in every
  gate-agent prompt (DB-confirmed), and zero
  false-positive `pool.query`/`new Pool` violations were
  flagged — TR_036 Fix 1 + Fix 2 both verified at the LLM
  level for the first time.
- TR_022 `maxPhaseRetries` fired 2/2 correctly:
  16:18:42 phase-submitted → 16:26:01 retry 1/2 →
  16:34:44 retry 2/2 → 16:35:43 phase-escalated.
- `feature-blocked` alert visible in `gestalt alerts list`
  (TR_036 Fix 3 alert path observed at the LLM level for
  the first time too).

**Cycle still blocked — NEW orthogonal finding:** the gate's
review-agent caught a real configuration drift. Architecture-
agent emits Vitest references in success-criteria text on a
fully-Jest-aligned project (`HARNESS.stack.testFramework:
Jest`, `agents.yaml test-agent.goal: Jest`, `package.json
scripts.test: jest`). TR_038's stack-injection mechanism
reaches the prompt but doesn't BIND the LLM's framework
choice — it picks Vitest as a "modern default". Same
pattern for Fastify-vs-Express in one violation. Captured
as new HIGH follow-up for TR_040.

**Operator action — trackeros:** none new beyond the
already-pushed `f0f9e989 chore(TR_039): intent-agent rules —
deferred scope is out of phase`.

**Operator action — other projects:** Add the new
`agentConfig.intent-agent` block to existing projects'
`HARNESS.json` (it didn't exist before, so this is a NEW
section, not an append). Template auto-refreshes to
`0.24.0` at next server boot.

### TR_038 — Architecture-agent self-review + concrete-implementations stack injection (template 0.23.0, build clean, TR_037 follow-up CLOSED)

Two stopgap fixes ahead of the LangGraph architecture-crew migration
(ADR-056). Both will be deleted when Phase 1 of the migration lands.

- **Fix 1** — `renderStackSection(harnessConfig)` helper in
  `architecture-prompt.ts` injects `HARNESS.json.stack` as a
  `## Project stack` section before the task description in
  both `buildFeatureArchitecturePrompt` and
  `buildPhaseArchitecturePrompt`. New `architectureGuidance`
  rule on template + trackeros tells the agent to specify the
  concrete implementation for every interface using the
  declared stack.
- **Fix 2** — new `buildArchitectureReviewPrompt` +
  `ArchitectureAgent.reviewDesign(draft, feature, projectRoot,
  harnessConfig, correlationId)`. A single-agent self-review
  re-reads the draft and checks completeness / consistency /
  ambiguity / feasibility. Returns the original draft on ANY
  failure path so the pipeline is never blocked on a review
  parse error. The orchestrator wires
  `designFeature → reviewDesign → save` with a STOPGAP
  (ADR-056) comment block above the call. New rule on
  template + trackeros for the review pass.

Template `0.22.0 → 0.23.0`. `pnpm -r build` clean across all
13 packages. Token management (ADR-057) applies automatically
because `reviewDesign` calls `callLLM` (which routes through
the 5-layer pipeline).

**Live verification — TR_037 HIGH NEW follow-up CLOSED:**
trackeros feature `d0513f28-6648-4651-bf4e-15e8771c4e5b` on
`chat-latest`:
- `reviewDesign` log fired at 14:04:37 (6 s after
  `designFeature`).
- Phase 1 persisted architecture names `PostgresLeaveRepository`
  as the concrete class, imports `Pool` from `pg`, defines
  `src/shared/db/connection.ts`, and includes a SQL schema
  with CHECK constraints + indices. The "what concrete impl
  backs this interface" question intent-agent flagged in
  TR_037 is now answered in the architecture itself.

**Cycle still blocked at intent-agent — NEW orthogonal finding:**
After ~15 s in `generating`, intent-agent escalated with a NEW
reason: "The intent mentions repository CRUD behavior, but the
specified LeaveRepository interface only defines create and
findById methods." The architecture-agent legitimately scoped
`LeaveRepository` to Phase-1 CRUD subset (later phases extend),
but intent-agent reads the feature description as implying
full CRUD upfront. Third distinct intent-agent rigor bar
across TR_036 / TR_037 / TR_038. Captured as new HIGH
follow-up.

**Operator action — trackeros:** none new beyond the
already-pushed `22b68de6 chore(TR_038): architecture-agent —
concrete-implementations guidance + review-pass rule`.

**Operator action — other projects:** Append the two new
items (architectureGuidance + rules) to
`HARNESS.json.agentConfig.architecture-agent` on existing
projects. Template auto-refreshes to `0.23.0` at next server
boot.

### TR_037 — Planner-agent uses architecture-agent's canonical type names (template 0.22.0, build clean, symbol-name conflict resolved end-to-end)

Two fixes against the TR_036 NEW HIGH follow-up:

- **Fix 1** — `packages/agents/planning/src/prompts/planner-prompt.ts`
  injects the full `FeatureArchitecture` JSON (sliced to 2000
  chars) as a `## Canonical type and symbol names` section above
  the HARNESS rules and above the task description. The planner
  sees architecture-agent's canonical names before it starts
  planning. No threading through `task.context` needed — the
  planner-agent already receives `architecture` as a positional
  parameter via `planFeature(feature, architecture, …)`.
- **Fix 2** — `agentConfig.planner-agent.rules` in template +
  trackeros HARNESS appended with: "The architecture specification
  provided above defines the canonical type names, interface
  names, and symbol names for this feature. Use these exact names
  in all phase scopes. Do not invent alternative names or rename
  types." Abstract — no hardcoded type names.

Template bumped 0.21.0 → 0.22.0. `pnpm -r build` clean across
all 13 packages.

**Live verification — symbol-name conflict resolved:** trackeros
feature `ce9d1b80-b442-4547-afcf-d389e4aa8b63` on `chat-latest`
produced a 5-phase plan with Phase 1 scope using
architecture-agent's canonical `LeaveRequest` type + field list
verbatim. Phase 1's per-phase architecture: 4 interfaces +
5 success criteria + full SQL schema. Cycle proceeded into
`generating` without intent-agent escalation on symbol names.

**Cycle still blocked at intent-agent — NEW orthogonal finding:**
After the symbol-name conflict was resolved, intent-agent escalated
on a different ambiguity: "The concrete persistence implementation
backing `LeaveRepository` is not specified." Architecture-agent
defines the interface but doesn't pin the concrete DB
driver/package. This is a stricter intent-agent bar than the prior
symbol-name conflict — and TR_037's fix doesn't address it.

**Operator action — trackeros:** none new beyond the already-pushed
`5f083345 chore(TR_037): planner-agent canonical-names rule`.

**Operator action — other projects:** Existing projects adopt the
canonical-names rule by appending to
`HARNESS.json.agentConfig.planner-agent.rules`:
> "The architecture specification provided above defines the
> canonical type names, interface names, and symbol names for
> this feature. Use these exact names in all phase scopes. Do
> not invent alternative names or rename types."

Template auto-refreshes to `0.22.0` at next server boot.

### TR_036 — Abstract gate rules + auto-generated project-structure brief + maxPhaseRetries alert path (template 0.21.0, build clean, live verification partial)

Four fixes against TR_035 verification findings:

- **Fix 1** — HARNESS `constraint-agent.rules` + `review-agent.rules`
  rewritten to abstract layer-role language (data access layer,
  business logic layer, presentation/routing layer). Both agents'
  `verificationGuidance` rewritten to "read ARCHITECTURE.md first;
  a finding is only valid if it violates a rule given the actual
  structure of this project". The HARNESS no longer hardcodes
  paths, class names, or method names — ARCHITECTURE.md is the
  authoritative source for layer boundaries.
- **Fix 2** — new `buildProjectStructureBrief(projectRoot)` helper
  in `gate-orchestrator.ts`. Reads `ARCHITECTURE.md` (truncated to
  2000 chars) + enumerates a depth-2 directory tree under `src/`
  using Node's `readdir` (equivalent to `find src -maxdepth 2
  -type d`, bounded to 30 entries). Set on
  `GateTask.projectStructureBrief` (new optional field on the
  type); constraint-agent injects it before the rules section,
  llm-review-agent injects it at the top of the prompt. Empty
  string when neither source exists — section is omitted.
- **Fix 3** — planner's `maxPhaseRetries` exhaustion path in
  `planning-orchestrator.ts` now creates a `feature-blocked`
  alert + emits `alert.created` SSE. Previously this path was
  silent on the alerts feed (operators only saw the block via
  `gestalt feature show` / dashboard).
- **Fix 4** — trackeros `agents.yaml` `test-agent.goal` switched
  from Vitest → Jest to align with the rest of the project's
  Jest-only tooling.

Template bumped 0.20.0 → 0.21.0. `pnpm -r build` clean across
all 13 packages.

**Live verification — partial:** trackeros feature
`b58ee152-4f5b-4dd5-8d72-39816149fbae` ran on `chat-latest`,
produced a 7-phase plan (model+repo bundled into Phase 1) with
non-empty per-phase architecture (2 interfaces + 5 criteria),
then escalated at intent-agent on an upstream
planner-vs-architecture-agent symbol-name inconsistency
(`LeaveStatus` vs `LeaveRequestStatus`, `CreateLeaveRequestDto`
vs `CreateLeaveRequestInput`). Self-healing → cascade brake →
`feature-blocked` alert `430ed09a` created via the EXISTING
TR_033 helper. Gate never ran, so Fixes 1 + 2 did not get an
LLM-level test. Fix 3's new alert call sat alongside the
existing one; the cycle escalated via the existing path so my
new code didn't fire.

**New HIGH follow-up:** cross-check planner-agent vs
architecture-agent symbol names. Both currently emit type/field
names independently; nothing reconciles them. This blocks every
cycle on chat-latest at intent-agent before the gate-side
TR_036 fixes get exercised.

**Operator action — trackeros:** none new beyond the
already-pushed `b5396160 chore(TR_036): abstract
constraint+review rules + align test-agent to Jest`.

**Operator action — other projects:** Existing projects can
adopt the abstract rules by replacing their
`HARNESS.json.agentConfig.constraint-agent.rules` +
`review-agent.rules` blocks with the abstract versions from
the template. Template auto-refreshes to `0.21.0` at next
server boot.

### TR_035 — Dynamic token budget management + phase merge SHA (ADR-057, template 0.20.0, build clean, live verification pending)

Two categories of work. Part A — platform-level five-layer
token management in `BaseLLMAgent`:

- Layer 1 (model-aware defaults: reasoning models get 8k,
  standard 2k).
- Layer 2 (dynamic budget: input × 1.5 reasoning / × 0.5
  standard, clamped by per-model hard limits).
- Layer 3 (scope reduction: three structural rewrites for
  prompts above the threshold).
- Layer 4 (JSON response guard appended to six structured-
  output agents: architecture-agent `designFeature` +
  `designPhase`, planner-agent, phase-evaluator-agent,
  constraint-agent, review-agent, self-healing-agent).
- Layer 5 (truncation retry doubling the budget on
  `finish_reason: 'length'`, up to 3 attempts).

Knobs configurable in `HARNESS.json.tokenManagement`
(`promptCompressionThreshold` / `maxRetryBudgetMultiplier` /
`enableDynamicBudget` / `enableScopeReduction`).

Part B — three TR_034 follow-up fixes:

- **B1** — `architecture-agent.max_tokens: 12000` in
  trackeros `agents.yaml` as the fallback floor. Layers 2 +
  5 in BaseLLMAgent handle higher cases.
- **B2** — phase-evaluator prefers `git show --name-only
  --format= <mergeCommitSha>` over the prior `git diff`
  fallback. The existing `mergePullRequest` already returns
  the squash-merge SHA, so the promotion-agent's
  `maybeAutoMerge` now `findPhaseByIntent → updatePhaseMergeCommit`
  after a successful merge. New `feature_phases.merge_commit_sha`
  column (migration 029). Phase-evaluator-agent rules in the
  template + trackeros HARNESS updated to teach the agent the
  new command (with fallback when SHA is null).
- **B3** — single migration `029_token_management_and_phase_merge.sql`
  bundles both new columns.

Template bumped 0.19.0 → 0.20.0. `pnpm -r build` clean across
all 13 packages. Migration 029 applied at next server boot.
Live verification pending — runtime telemetry will show each
layer firing.

**Operator action — trackeros:** the operator may patch the
phase-evaluator-agent rule into `trackeros/HARNESS.json` if it
gets reverted (precedent from TR_033). The `tokenManagement`
block + `architecture-agent` 12k bump are already in trackeros.

**Operator action — other projects:** Existing projects can
opt in by adding a `tokenManagement` block to `HARNESS.json`.
Absent → all five layers run with the defaults baked into
`BaseLLMAgent` (threshold 6000, multiplier 2.0, both feature
flags on). Template auto-refreshes to `0.20.0` at next server
boot for new projects.

### TR_034 — Scoped per-phase architecture replaces full architecture context in Aider message (template 0.19.0, mechanisms verified)

Replaces the heavyweight `## Project architecture` + `## Design
context` blocks in the Aider message with a single
`## Scoped architecture for this phase` block built from
architecture-agent's `designPhase()` JSON (interfaces +
importStatements + sqlSchema + successCriteria). Closes the
TR_033 root cause where Aider hallucinated `../../shared/db`
from module-name references in the full ARCHITECTURE.md.

- `buildAiderMessage` signature: `(intentSpec, phaseArchitecture:
  string | null, snapshot)`. New `renderPhaseArchitecture()` helper.
- New `FeatureRepository.updatePhaseArchitecture` method (no
  migration — uses existing column). Postgres impl + oracle/mssql
  stubs.
- `runPerPhaseArchitecture` persists JSON to `phase.architecture`.
- `aider-code-agent.loadPhaseArchitectureForCycle` resolves
  correlationId → intent → phase → architecture, parses with
  shape guard.
- Template HARNESS + agents.yaml gain new architecture-agent
  scoping rules (architectureGuidance + prompt_extensions) with
  WRONG/CORRECT examples banning module-name-only references.

Template bumped 0.18.0 → 0.19.0. **Verified live on trackeros
2026-06-10** — per-phase architecture pass fires,
`updatePhaseArchitecture` persists JSON, message body shrank
5705 → 2922 bytes, Phase 1 deployed via PR #119. **Feature did
NOT complete** — gpt-5.5 + Aider produced zero source code
(same TR_033 mode), and architecture-agent's `designPhase`
returned empty arrays so the scoped block was empty too.

**Operator action — trackeros:** none new beyond the brief's
HARNESS + agents.yaml edits (committed by the verification
cycle as `e7db89dd` + `4eb7637c` cleanup).

**Operator action — other projects:** Existing projects can
opt into the per-phase architecture pass by setting
`HARNESS.json.planner.architectureReviewPerPhase: true` and
ensuring `architectureGuidance` includes the path/exports/
import-statement rules from the template. Template auto-
refreshes at server boot to `0.19.0`. The Aider message
behaviour change is fully backward-compatible — projects
without per-phase architecture get `null` from
`loadPhaseArchitectureForCycle` and the message drops the
section entirely.

### TR_033 — Phase 3 quality gaps + escalation→blocked structural fix (template 0.18.0, partially verified)

Four targeted fixes pushing toward full autonomous feature
completion. **Verified live on trackeros feature `7ab81ea3`
(2026-06-10)**: Fix 1 + Fix 4 confirmed end-to-end; Fix 2 +
Fix 3 shipped but not reached (feature blocked at Phase 1
before routes phase). Feature did not reach `completed` —
gpt-5.5 + Aider produced zero source code across 4 attempts
(new failure mode separate from TR_028-32 hallucination).
Full report in `sessions/RECENT.md`. Fixes 1-3 are language-agnostic rule additions;
Fix 4 is the structural follow-up to the TR_032 verification
gap (escalated intents leaving features stuck `in-progress`).

- **Fix 1** — `aider-message-builder.ts` base `readFiles` list
  expanded to include `package.json`, `tsconfig.json`,
  `pyproject.toml`, `requirements.txt`, `go.mod`, `pom.xml`,
  `mypy.ini`, `.eslintrc(.json)`. The adapter's `existsSync`
  filter naturally drops files a project doesn't use, so the
  same list works on TypeScript / Python / Go / Java without
  language-tagging the platform code.
- **Fix 2** — three language-agnostic rules added to
  `agentConfig.code-agent.rules` in the **template** HARNESS:
  read dependency source before calling its methods; read
  compiler/linter config before generating; read dependency
  manifest before importing. Examples in the rule text list
  multiple ecosystems (`tsconfig.json / mypy.ini / pyproject.toml`,
  `package.json / requirements.txt / go.mod`).
- **Fix 3** — new rule on
  `agentConfig.phase-evaluator-agent.rules` (template) — when
  adjusting a routes/controller phase scope, cite the
  service/handler file it depends on. Closes the TR_032 Phase 3
  root cause.
- **Fix 4** — structural. `AlertType` gains `'feature-blocked'`
  (no migration — no DB CHECK constraint on `alerts.type`).
  Planning orchestrator's `intent.status-changed` subscriber
  now treats `waiting-for-clarification` + `escalated` as
  terminal phase outcomes via a new
  `markFeatureBlockedAfterEscalation` helper: phase → failed,
  feature → blocked, `phase-escalated` log entry, a single
  `feature-blocked` alert. Self-healing already parked the
  parent intent at `waiting-for-clarification` when the
  cascade brake fired (`self-healing-loop.ts:604`) — Fix 4
  completes the story.

Template bumped 0.17.0 → 0.18.0. Build clean across all 13
packages. Live verification pending.

**Operator action — trackeros:** my Fix 2 + Fix 3 edits on
trackeros's `HARNESS.json` were reverted by the operator/linter
this session. The new code-agent + phase-evaluator rules only
ship via the template; existing projects (including trackeros)
need a manual patch on their own `HARNESS.json` to opt in. For
the live verification recipe to test Fix 2 + Fix 3 end-to-end,
trackeros's HARNESS must be patched first with the three
code-agent rules and the one phase-evaluator rule from the
template.

**Operator action — other projects:** None on the platform.
Template auto-refreshes at server boot to `0.18.0`. New
projects pick up the rules automatically.

### TR_032 — Aider `--read` flag + preservation in schema + broken-state framing (template 0.17.0, verified)

Three targeted platform-mechanic fixes addressing the
TR_028 → TR_031 Aider DTO-drift blocker. No new HARNESS
rules, no new migrations.

- **Fix 1** — `runAider` accepts `readFiles?: string[]`;
  `buildAiderMessage` returns `{ message, readFiles }`
  (PLAN.md + paths regex-extracted from the intent's scope
  text). The adapter renders each as a `--read "<path>"`
  flag, existsSync-filtered against `workDir`. Removed the
  TR_030/TR_031 prose `## Read PLAN.md first` and
  `## Before generating any code` sections — `--read`
  enforces what they only asked.
- **Fix 2** — preservation sentence ("Preserve all existing
  exports, types, interfaces, and imports. Only add or
  modify what is needed to resolve the CI failure shown
  above.") hard-coded as the closing sentence of the
  `fixIntent` JSON-schema description in
  `self-healing-agent.ts`. HARNESS preservation rule
  removed from the template.
- **Fix 3** — `fixIntent` description now requires BROKEN
  STATE framing (not MISSING STATE) with verbatim
  WRONG/CORRECT examples. Addresses the TR_031 cycle-3
  finding that Aider inverts negation.

Template bumped 0.16.0 → 0.17.0. Build clean across all 13
packages. **Verified end-to-end on trackeros 2026-06-09** —
feature `fd844f7d` Phase 1 + Phase 2 both deployed cleanly
(Phase 2 was the killer phase across TR_028-31, first ship);
Phase 3 escalated on unrelated TS-strict + missing-method
issues (the TR_033 fixes target those). `readFiles` array
present on every Aider invocation. Preservation footer
present on both fix-intents. Cascade brake at depth 2 fired
correctly. Operator had to manually clean up the escalated
feature after the cycle — Fix 4 above closes that gap.

**Operator action:** None new. The TR_032 preservation rule
removal already shipped via the template.

Three targeted platform-mechanic fixes addressing the
TR_028 → TR_031 Aider DTO-drift blocker. No new HARNESS
rules, no new migrations.

- **Fix 1** — `runAider` accepts `readFiles?: string[]`;
  `buildAiderMessage` returns `{ message, readFiles }`
  (PLAN.md + paths regex-extracted from the intent's scope
  text). The adapter renders each as a `--read "<path>"`
  flag, existsSync-filtered against `workDir`. Removed the
  TR_030/TR_031 prose `## Read PLAN.md first` and
  `## Before generating any code` sections — `--read`
  enforces what they only asked.
- **Fix 2** — preservation sentence ("Preserve all existing
  exports, types, interfaces, and imports. Only add or
  modify what is needed to resolve the CI failure shown
  above.") hard-coded as the closing sentence of the
  `fixIntent` JSON-schema description in
  `self-healing-agent.ts`. HARNESS preservation rule
  removed from the template.
- **Fix 3** — `fixIntent` description now requires BROKEN
  STATE framing (not MISSING STATE) with verbatim
  WRONG/CORRECT examples. Addresses the TR_031 cycle-3
  finding that Aider inverts negation.

Template bumped 0.16.0 → 0.17.0. Build clean across all 13
packages. Live verification pending — operator runs the
brief's `gestalt feature submit` recipe on trackeros.

**Operator action:** Existing projects can prune the now-
redundant preservation rule from
`HARNESS.json.agentConfig.self-healing-agent.rules` (it's
in the platform schema now). The rule is harmless if left
in — both fire. trackeros not auto-migrated; operator can
clean up on next HARNESS edit.

### TR_030 + TR_031 — Aider-message-builder + PLAN.md "What has been built" + context-only fix-intent (template 0.16.0)

Two consecutive briefs targeting Aider DTO drift. TR_030
added two generic prose blocks to `aider-message-builder.ts`
(read-existing-files; architecture-is-reference-only).
TR_031 added a `Read PLAN.md first` block to the message-
builder; extended `PhaseEvaluation` with `builtFiles` (the
phase-evaluator-agent now also lists exports per built file
in its git-diff pass); rewrote the `fixIntent` JSON-schema
description in `self-healing-agent.ts` to require CONTEXT
only (no prescriptive "Update X to add Y"). HARNESS
preservation-rule bullet added for self-healing-agent.
Template 0.15.0 → 0.16.0.

Verified end-to-end on a clean trackeros main: PLAN.md
populates the `**What has been built:**` section under each
deployed phase with files + key exports; fix-intent text
is now context-only; self-healing routes to fix-intent
immediately on first failure; cascade brake fires at depth 2.

**Operator action:** Existing projects can adopt the new
preservation rule by appending to
`HARNESS.json.agentConfig.self-healing-agent.rules`:
"Fix-intent context must end with a preservation statement.
For TypeScript projects: 'Do not remove or rename existing
exports, types, or interfaces. Only add or modify what is
needed to resolve the CI failure.'" Python or other
language projects substitute their own preservation clause.
trackeros migrated in commit `7d94746a`.

### TR_029 — Planner+evaluator prior-phase path rules (template 0.15.0)

Two new `agentConfig.planner-agent.phaseScopingRules` items and
one `agentConfig.phase-evaluator-agent.rules` item added,
requiring per-phase explicit prior-file-path lists and full-path
replacement when adjusting scopes after a partial verdict.
Template bumped 0.14.0 → 0.15.0. Pure HARNESS edit — no platform
code change, no migration.

Planner-side verified end-to-end on the re-submitted
leave-management feature: PLAN.md `Phase 2` carries the exact
`src/modules/leave/leave.model.ts` + `leave.repository.ts`
paths the planner was instructed to include. Phase 1 deployed
in ~3 minutes (PR #88). Phase 2 still blocked by Aider
code-agent reading discipline — captured as two NEW HIGH
follow-ups in STATE.md (code-agent prompt mandate + architecture-
agent context scoping).

**Operator action:** Existing projects can adopt the new rules
by merging them into `HARNESS.json.agentConfig.planner-agent.phaseScopingRules`
and `agentConfig.phase-evaluator-agent.rules`. trackeros migrated
as part of this session (commit `cf35c03b`).

### TR_028 — Full planning-loop re-test (TEST_REPORT_028.md)

Milestone test on the leave-management feature, verifying every
TR_020 through TR_027 mechanism in a single 19-minute autonomous
cycle. Phase 1 (model) deployed cleanly. Phase 2 (repository)
hit the known TR_023 Aider DTO-drift; self-healing's
diagnostician correctly chose `retry` then `fix-intent`;
fix-intent child deployed via the `onSuccessDispatch` envelope
in ~2m 25s. But the fix-intent prompt lacked path specificity
so Aider wrote a stray repo-root `/leave.model.ts` that tsc
never resolves. Parent Phase 2 resumed → failed again → planner
retry budget exhausted → feature blocked at 1/4 phases. Two new
HIGH follow-ups captured: (1) promoted TR_023 — planner must
keep model+repository in same phase OR code-agent must read
existing model first; (2) self-healing fix-intent prompt
enrichment — must include the failing import path and existing
field shape. Architecture-agent / planner-agent /
phase-evaluator-agent / PR-Agent / self-healing + onSuccessDispatch /
cascade-depth brake / phase retry budget all verified.

**Operator action:** None on the platform. trackeros next
planner cycle should be prefaced by `git rm leave.model.ts`
(the stray repo-root file fix-intent created). Full
per-phase log at `docs/claude/TEST_REPORT_028.md`.

### TR_027 — PR-Agent replaces review-agent (ADR-051)

CodiumAI PR-Agent invoked server-side via `executeScript` after CI
passes. No webhook, no CI step, no GitHub Secrets for LLM keys —
LLM credentials forwarded per invocation via subprocess env vars.
Dockerfile installs PR-Agent in its own venv (`/opt/pr-agent`)
isolated from Aider's because of incompatible litellm versions;
PATH shims (`/usr/local/bin/{aider,pr-agent}`) keep call sites
unchanged. New `prAgent` block on HarnessConfig + `.pr_agent.toml`
generated from HARNESS rules at init time (regeneratable via
`gestalt project config push-pr-agent-config`). Gate orchestrator
skips review-agent when prAgent.enabled + adapter=github-actions;
constraint-agent still runs. `changes-requested` routes through
self-healing's `fix-intent` path via new failure type
`review-requested-changes` (migration 027). Template 0.12.0 →
0.14.0. Live verified end-to-end on trackeros PR #81: Aider 6s →
CI pass → PR-Agent 23.5s → verdict `none` → gate (constraint-agent
only) → deploy. Wall-clock 2m 04s.

**Operator action:** Existing projects can adopt PR-Agent by
adding `prAgent: { enabled: true, blockOnChangesRequested: true,
pendingTimeoutSeconds: 30 }` to HARNESS.json + a self-healing-agent
rule for `review-requested-changes`. Absent → review-agent fallback
path still runs (llm-review-agent.ts kept as `@deprecated` but
functional). trackeros migrated as part of the verify cycle
(commits pending push).

### ADRs 053–055 — Tool integration roadmap

Documentation-only session. Three ADRs appended to
`docs/DECISIONS.md` capturing strategic tool integrations
agreed in the design chat: ADR-053 (Qodo Gen replaces
test-agent in the generate layer), ADR-054 (SWE-agent handles
bug-fix MaintenanceIntents), ADR-055 (K8sGPT feeds a future
Kubernetes operations layer via webhook → MaintenanceIntent).
A new `### Tool integration roadmap` section under
`STATE.md` "Active follow-ups" documents priority order plus
ruled-out alternatives (Bloop.ai — archived; OpenHands —
competitor; GitHub Spec Kit — not self-hostable). All three
ADRs are **Accepted — pending implementation**; no code
change, no migration.

Cross-reference note: ADR-052 (external scanner webhook →
MaintenanceIntent pattern) is referenced by ADR-055 but has
not yet been authored. Backfill when the next session touches
that code. ADR-051 (PR-Agent) was authored alongside this
session.

**Operator action:** None. ADRs are forward-looking contracts;
implementation will land in a later session.

### TR_026 — Remove platform file-change detection (ADR-050 enforcement)

ADR-050 enforcement: the platform must NOT detect, parse, or
interpret which files changed. Two surgical removals plus an
agent-side replacement.

- **AiderAdapter**: `parseAiderChangedFiles` deleted,
  `filesChanged` removed from `AiderResult`. `--yes-always`
  replaces `--yes` to prevent mid-session confirmation hangs.
- **AiderCodeAgent**: new `discoverAiderWrites` helper runs
  `git status --porcelain` in the work-dir and emits each
  changed file as a code artifact. An AGENT calling git —
  not platform code parsing Aider stdout.
- **Phase-evaluator-agent**: 3-stage TR_025 fallback deleted.
  Agent signature changed to take `branchContext`; prompt
  rewritten to instruct it to run `git diff` via
  executeScript. Switched to `callLLMWithTools` so the
  tool-use loop fires.
- **PER_ROLE_DEFAULTS** in `agent-config-loader.ts` extended
  with the three planning agents so executeScript is
  available out of the box.
- **HARNESS.json + agents.yaml** updated on template +
  trackeros: phase-evaluator-agent rules + evaluationCriteria
  rewritten with verbatim git-diff guidance.
- **Template bumped 0.11.0 → 0.12.0**.

Verified live: feature `7d77f659` Phase 1 PR commit
`ce3f3721` contains the real code files (`leave.model.ts` +
test). Phase-evaluator's verdict text quotes the
HARNESS.json git-diff rule, confirming the agent followed
the new path. Full feature completion blocked by
pre-existing trackeros operator state (stale
`leave.repository.ts` from earlier auto-merged cycles) —
captured as TR_027.

**Operator action:** None. Pure platform changes (plus the
trackeros HARNESS.json edit committed by the verification
cycle as `897bcf06`).

### TR_025 — Cascade-depth brake + phase-evaluator file-list fix

Two surgical hardening fixes (no migration):

- **`MAX_FIX_INTENT_DEPTH = 2`** + `getFixIntentChainDepth` walker
  in `packages/core/src/agents/self-healing-loop.ts`. Force-
  escalates when `parent_intent_id` chain depth ≥ 2. Closes
  TR_024's cascading-runaway gap.
- **Planning orchestrator built-file list** sourced from
  `git diff` against the PR branch (filtered to non-
  `.gestalt/` paths). Three-stage fallback: PR-branch diff →
  merged-commit scan → legacy artifacts-table read.

Verified live: feature `eed75889` Phase 1 → success → Phase 2
auto-dispatched. End-to-end autonomous transition confirmed.
Phase 2 hit an unrelated Aider "0 files written" quirk
(TR_026 follow-up).

**Operator action:** None. Pure platform fixes.

### TR_024 — Autonomous systemic gap detection (migration 026)

Self-healing diagnostician can now choose between **retry /
fix-intent / escalate**. When it picks `fix-intent` it writes an
Aider-ready intent the platform submits as a separate generate
cycle, links via `parent_intent_id`, and persists an
`on_success_dispatch` envelope that resumes the parent after
the fix's production promotion. Per ADR-050: no hardcoded
failure-pattern matching anywhere.

- **Migration 026** — `intents.parent_intent_id` (UUID FK
  `ON DELETE SET NULL`) + `intents.on_success_dispatch`
  (JSONB). NULL on every existing intent.
- **`HarnessAgentConfig.self-healing-agent`** added to both
  the template and trackeros: six rules covering the action
  vocabulary + fix-intent quality bar.
- **agents.yaml self-healing-agent block** in template (uses
  platform default model). trackeros overrides `model:
  chat-latest`. The LLM registry handles the
  `apiShape: 'responses'` wire-shape — agent code untouched.
- **`collectCiTechnicalDetail`** (deploy-orchestrator) —
  fetches the failed CI run's GitHub Actions annotations and
  passes them to the diagnostician as `technicalDetail`.
  github-actions only today.
- **Dashboard panels**: 🔧 Auto-fix intent (on `source: 'self-
  healing-fix'` intents); ⏳ Awaiting auto-fix (on parents with
  in-flight fix children).
- **Template bumped 0.10.0 → 0.11.0**.

**Operator action:** Existing projects can adopt the
self-healing-agent rules + agents.yaml block by editing their
own HARNESS.json + agents.yaml. Absent → diagnostician uses
the platform default LLM (no agents.yaml override needed
when the platform default is already chat-latest or similar).
trackeros migrated as part of the verify cycle (commit
`1a4fe16e` on `main`).

### TR_022 — Scaffolding fixes + phase retry budget (migration 025)

Three operator-facing changes plus a verified end-to-end retest
of the planning loop on a 5-phase feature.

- **Migration 025** — `feature_phases.retry_count INTEGER NOT NULL
  DEFAULT 0`. Existing rows start at 0.
- **`HarnessConfig.planner.maxPhaseRetries`** — new optional field,
  default 2 (one initial attempt + 2 retries). Set to 0 to
  restore pre-TR_022 single-attempt behaviour.
- **Template HARNESS.json** — `agentConfig.code-agent.rules` gets
  the JSON-import rule; `planner.maxPhaseRetries: 2` added.
  Template bumped 0.8.0 → 0.9.0.
- **`stack-config.ts`** — TypeScript stacks always carry the
  JSON-import rule in `agentPromptExtensions` (LLM path + the
  default-config path).

trackeros migrated as part of the verify cycle:
- `tsconfig.json` gains `resolveJsonModule` +
  `allowSyntheticDefaultImports`.
- `HARNESS.json` gets `code-agent.rules` JSON-import rule +
  planner block bumped to `{10, 5, false, 2}`.

**Operator action:** Existing projects can adopt the new
`maxPhaseRetries` field by editing `HARNESS.json.planner`.
Absent → defaults to 2 in `readMaxPhaseRetries`.

### PLANNING_LAYER — Autonomous feature decomposition (migration 024)

New package `@gestalt/agents-planning` + new BullMQ queue
`gestalt-planning` + new postgres tables (features /
feature_phases / feature_plan_log) + new server routes
(`POST/GET /features`, `GET /features/:id`) + new CLI commands
(`gestalt feature submit/list/show`). Three new agent roles
(architecture-agent / planner-agent / phase-evaluator-agent),
all extending BaseLLMAgent and reading config from agents.yaml +
HARNESS.json `agentConfig`. New `HARNESS.json.planner` block
(`enabled`, `maxPhasesPerFeature`, `maxFilesPerPhase`,
`architectureReviewPerPhase`) opt-in per project. Template
bumped 0.7.0 → 0.8.0. Live verified on trackeros — feature
`ea19b18e` ran the full architecture → plan → phase 1 → CI →
event-bus → evaluate loop end-to-end against real GitHub
Actions; phase failed because Aider's generated TS used
`require('package.json')` without `resolveJsonModule` (pre-
existing code-agent issue unrelated to planning).

**Operator action:** Add the planner block + planning
agentConfig entries to existing projects' `HARNESS.json` to
opt in. trackeros has been migrated as part of the verify
cycle (commit `3fc936fe` on `main`).

### Historical (TR_020 / TR_021 / ADRs 042–049)

Rotated to `sessions/archive/`. See `docs/DECISIONS.md` for ADRs
and the archive for the full narratives.

### Carryovers (TR_019 / TR_018 / TR_014)

- **MEDIUM — TR_019:** `gestalt init` should scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest with TypeScript.
- **LOW — TR_019:** Template `{{ciSetupSteps}}` for Node/npm
  should include `--legacy-peer-deps` until the upstream npm
  arborist `Link.matches` bug is fixed.
- **LOW — TR_019:** Add a `tsc --noEmit` sanity check on
  scaffolded tests in `gestalt init`.
- **HIGH — TR_018:** Restore TR_010 mandatory `executeScript
  tsc --noEmit` code-agent rule on trackeros's HARNESS.json.
- **MEDIUM — TR_014:** Aider token-spend capture. Parse
  `Tokens: N sent / M received` from Aider's stdout and surface
  as `tokens_used` on the execution row.

### Platform state caveats (unchanged)

- **`master.key`** generated locally (workspace root, mode 600,
  gitignored) + mounted into the server container via
  `docker-compose.yml`. Survives `docker compose up -d --build`.
  Back up out-of-band; losing it makes every vault-encrypted
  secret unreadable.
- **Open alerts to dismiss**: prior cycle alerts from
  TR_010–TR_018 (`gestalt alerts list` shows the full set).
  All dismissable with `gestalt alerts dismiss <id>`.
- **Live-verify TEST_REPORT_003 Fix 1** (env-default LLM
  apiShape) by switching `LLM_MODEL=chat-latest` + setting
  `platform_llms.chat-latest.api_shape='responses'` and
  confirming `max_completion_tokens` reaches the wire.
- **Re-create vault secret for OpenAI API key** if the operator
  wants vault-backed routing. Both LLMs currently in env-var
  mode (`apiKeyEnv: 'LLM_API_KEY'`) and working.

---

## Type alignment rules

Moved to [@docs/claude/ARCHITECTURE.md](./ARCHITECTURE.md#key-type-alignment-rules).
