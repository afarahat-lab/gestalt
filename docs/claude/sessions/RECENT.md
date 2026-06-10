# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-10 — Claude Code (TR_040: HARNESS architectureGuidance binding rules + reviewDesign stack-compliance check — partial verification: Fastify binding worked end-to-end, Vitest binding did NOT; new finding — architecture-agent regressed on LeaveRepository CRUD coverage)

Brief: two changes addressing TR_039's NEW HIGH follow-up
(architecture-agent emits Vitest references on a Jest-aligned
project + Express on a Fastify-aligned project — TR_038's
stack injection reaches the prompt but doesn't BIND the LLM's
output).

What changed (2 fixes):

**Fix 1 — Two new `architectureGuidance` binding rules in HARNESS**

- `templates/corporate-ops-web-mobile/harness/HARNESS.json` and
  `/Users/amrmohamed/Work/trackeros/HARNESS.json` —
  `agentConfig.architecture-agent.architectureGuidance` appended
  with two abstract rules (no framework names hardcoded):
  - "The project stack declared in HARNESS.json is the
    authoritative source for all technology choices. You MUST
    use the declared test framework, web framework, database
    client, and package manager exactly as named. Do not
    substitute alternatives based on personal preference or
    assumed defaults. If the declared stack names a specific
    framework, every reference in your output must use that
    framework's name and conventions."
  - "Before emitting your response, verify: every framework
    reference in your output matches the declared stack. If
    you find a mismatch, correct it before returning."

**Fix 2 — `reviewDesign` stack-compliance check**

- `packages/agents/planning/src/prompts/architecture-prompt.ts` —
  `buildArchitectureReviewPrompt` gains a new
  `## Stack compliance check` block rendered IMMEDIATELY before
  the JSON-output schema. The block:
  - Renders `HARNESS.json.stack` as pretty-printed JSON.
  - Tells the agent to "verify: every framework reference
    matches the declared stack ... no alternative frameworks
    appear in success criteria, interface names, or
    implementation notes ... correct any mismatch in your
    output".
  - Empty string when `harnessConfig.stack` is undefined —
    the check is skipped cleanly (no `'undefined'` text).
- Platform mechanics per ADR-042 — the rule TEXT lives in
  HARNESS (Fix 1); the wiring lives in `.ts` (Fix 2).

**Template version bumped 0.24.0 → 0.25.0.** No new migration.
Build clean across all 13 packages.

What's verified live (trackeros feature
`8900ab21-bc26-4f89-a000-7c74e02aaa24` on `chat-latest`):

- ✅ **Fastify binding worked end-to-end** — the architecture
  used Fastify (vs prior TR_036→39 cycles using Express);
  Phase 8 title literally reads "Expose Fastify APIs and
  workflow integration tests"; DB query for framework refs
  in the post-review feature architecture returned
  `fastify=1 express=0`. The previous TR_039 finding
  ("review-agent flagged Express but HARNESS says Fastify")
  is RESOLVED.
- ❌ **Vitest binding did NOT work** — same DB query returned
  `jest=0 vitest=1`. Phase 1 success criteria still says
  "Vitest tests for the repository verify successful create
  and findById persistence". Phase 1 scope text reads
  "Include Jest or Vitest unit tests" — hedge phrasing
  that suggests the LLM read both signals (HARNESS.stack
  said Jest; its own training preference said Vitest)
  and split the difference.
- ⚪ **reviewDesign log fired at 16:53:40, 5s after
  designFeature.** Before/after counts: 5 entities → 5
  entities, 5 modules → 5 modules. The review pass did NOT
  rewrite the framework references — the stack compliance
  check is in the prompt but didn't override the LLM's
  bias.
- ✅ **TR_039 deferred-summary still works** — Phase 1 intent
  text contains the full `## Deferred to later phases`
  section listing all 7 later phases with title + scope
  snippets.
- ❌ **Cycle still blocked at intent-agent** — escalation
  text: "The intent requests repository CRUD tests, but the
  provided repository contract and success criteria only
  define create and findById methods." This is NOT a TR_040
  issue — it's a real architectural gap intent-agent caught.

What blocked the cycle (NEW orthogonal finding):

Architecture-agent regressed on Phase 1's
`LeaveRequestRepository` coverage:

| Session | Phase 1 LeaveRepository methods |
|---------|-----|
| TR_038  | `create`, `findById`, `findByEmployeeId` |
| TR_039  | `create`, `findById`, `findByEmployeeId` |
| **TR_040** | **`create`, `findById` only** (regression) |

Worse, **no later phase adds the missing methods.** The
plan has:
- Phase 4: "Implement leave application workflow service"
- Phase 5: "Implement manager approval and rejection workflow"

Phase 5 needs to mutate `LeaveRequest.status` from `PENDING`
to `APPROVED` / `REJECTED` — which requires an `update`
method on `LeaveRequestRepository`. But the architecture
doesn't add it in any phase. Intent-agent correctly flagged
this — the architecture itself is incomplete on the
approval path.

Why the regression: the architecture-agent appears to have
read TR_039's deferred-section text in the planner's
prompt context and minimized Phase 1's interface surface
("everything else is deferred, so I'll only add what
Phase 1 STRICTLY needs"). It then forgot to add the
deferred methods to later phases. This is a misread of
TR_039's intent — deferred SHOULD include where the work
is added, not omit it entirely.

**Pending follow-ups (NEW from TR_040 verification):**

- **(HIGH — NEW)** Vitest binding still fails. Options:
  (a) move the stack compliance check to the TOP of the
  review prompt (before the draft, where the LLM
  conditions hardest); (b) add a literal regex
  post-processing pass after `reviewDesign`: read
  `HARNESS.stack.testFramework`, replace any other
  test-framework name in the result JSON with the
  declared one; (c) inject a sample fragment showing
  the EXACT framework reference shape ("Use 'Jest tests'
  in success criteria — not 'Vitest tests' or 'Jest or
  Vitest tests'"); (d) re-examine `agents.yaml` test-
  agent goal — the trackeros goal says "Jest" but
  architecture-agent's prompt extensions might not say
  anything.
- **(HIGH — NEW)** Architecture-agent must ensure every
  domain entity that the feature description implies
  mutation on has a phase where the mutation method is
  added to its repository. Either (a)
  `architectureGuidance` rule: "For every domain entity
  whose state changes during the feature lifecycle,
  the architecture must include a phase where the
  mutation method is added to that entity's
  repository"; (b) reviewDesign's checklist gains a
  fifth item: "5. Lifecycle coverage — every state
  transition implied by the feature description has a
  phase that adds the corresponding repository method".
- **(MEDIUM — NEW)** TR_038's reviewDesign before/after
  log shows same counts (5→5 entities, 5→5 modules) on
  both this and the prior cycle. The review pass isn't
  observably making changes. Either (a) log a structured
  diff between draft and reviewed (path-by-path field
  changes); (b) the review pass is judging the draft
  correct and we're at the LLM's bias ceiling — in
  which case a regex post-processing step is the only
  reliable framework-binding mechanism.
- **(LOW — NEW)** Phase count jumped 4 → 8 this session.
  The architecture-agent's recommendedPhases said 5; the
  planner expanded to 8. With 8 phases the cycle takes
  longer in serial. Either reduce the planner's
  maxPhasesPerFeature for trackeros (current: 10) or
  improve the architecture's phase grouping guidance.

Carryover follow-ups (status updates):

- **(PARTIALLY RESOLVED by TR_040)** TR_039 HIGH NEW:
  architecture-agent ignores `HARNESS.stack`. Fastify
  binding NOW works (Express → Fastify in this cycle's
  output). Vitest binding still fails — captured as the
  new HIGH follow-up above.
- **(STILL OPEN — HIGH from TR_036)** Gate-side
  verification of TR_036 was reached for the first time
  in TR_039. The cycle didn't reach the gate this
  session (intent-agent blocked first).

Build status: `pnpm -r build` clean across all 13 packages.
Template auto-refreshes to `0.25.0` at next server boot.

Files changed:
- `packages/agents/planning/src/prompts/architecture-prompt.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`
- `/Users/amrmohamed/Work/trackeros/HARNESS.json` (separate
  repo, pushed at `6c76cc2f`)

Live URLs:
- Dashboard: http://localhost:3000/app/
- TR_040 verification feature:
  http://localhost:3000/app/features/8900ab21-bc26-4f89-a000-7c74e02aaa24
- trackeros PLAN.md:
  https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
- trackeros TR_040 HARNESS commit:
  https://github.com/afarahat-lab/trackeros/commit/6c76cc2f

---
---
### Session 2026-06-10 — Claude Code (TR_039: planning orchestrator appends a "Deferred to later phases" section to every phase intent; intent-agent rules in HARNESS tell it not to flag deferred work as ambiguity — intent-agent bar CLEARED end-to-end; cycle finally reached the GATE for the first time across TR_036 → TR_039; new blocker is real config drift in architecture-agent emitting Vitest in success criteria on a Jest-aligned project)

Brief: one platform change + one HARNESS rules block. After
TR_038 closed the persistence-implementation rigor bar,
intent-agent escalated on a yet-stricter check: "the intent
mentions repository CRUD behavior, but LeaveRepository only
defines create and findById methods". The phased plan
intentionally defers update/delete to later phases — intent-
agent reads the full feature description and flags anything
Phase 1 doesn't implement as an ambiguity. TR_039 tells
intent-agent which concerns are scheduled for later phases.

What changed (2 fixes):

**Fix 1 — Append `## Deferred to later phases` to every phase intent text**

- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
  — when dispatching `generate:intent` for a phase, the
  orchestrator now queries `features.listPhases(featureId)`,
  filters to `phaseIndex > currentPhase.phaseIndex && status
  === 'pending'`, and passes that list to `buildPhaseIntentText`
  as a new required parameter. When non-empty, the builder
  appends a `## Deferred to later phases` section listing
  each later phase as
  `- Phase N — <title>: <scope snippet, 100 chars>`.
- The deferred section is part of the intent text the
  pipeline already persists; no new field on the intent
  record, no new migration. Re-dispatches on planner-side
  retry (TR_022 maxPhaseRetries) re-build the section
  fresh — so the deferred list always reflects current phase
  status at retry time.

**Fix 2 — `intent-agent` rules block in HARNESS**

- Template + trackeros `HARNESS.json.agentConfig` gain a NEW
  `intent-agent` block (didn't exist before — the
  intent-agent had no per-project rules surface). Two
  abstract rules:
  - "This intent describes a single phase of a multi-phase
    feature. If a 'Deferred to later phases' section is
    present, the items listed there are intentionally out
    of scope for this phase. Do not flag them as ambiguities
    or missing functionality."
  - "Evaluate the intent against what this phase explicitly
    commits to delivering, not against the full feature
    description."

**Template version bumped 0.23.0 → 0.24.0.** No new migration.
Build clean across all 13 packages.

What's verified live (trackeros feature
`61953f63-6655-47ae-8be9-879bcc1bffe2` on `chat-latest`):

- ✅ **All 3 attempt-intents contain the Deferred section**
  (DB query: `SELECT text LIKE '%Deferred to later phases%'`
  on all 3 Phase-1 intents → all `t`). Each retry rebuilt
  the section from scratch — consistent across attempts.
- ✅ **Intent-agent no longer escalates on deferred work** —
  attempt-1 intent `09554668` got past intent-agent into
  `generating`, attempt-2 same. Only attempt-3 escalated,
  and that was the planner exhausting `maxPhaseRetries`
  after the gate failed too many times — not an intent-agent
  problem.
- ✅ **CYCLE REACHED THE GATE FOR THE FIRST TIME** across
  the TR_036 → TR_039 sequence. Gate ran 6 times (verdicts:
  3 → 1 → 9 → 2 → 2 → 2 CONSTRAINT_VIOLATION).
- ✅ **TR_036 mechanisms verified live as a side-effect**:
  - The constraint-agent + review-agent prompts contain the
    `Project structure (read before evaluating)` brief
    (DB query confirms).
  - Zero false-positive `pool.query`/`new Pool` violations
    on the shared/db connection file. All 6 visible
    `CONSTRAINT_VIOLATION` signals are from `review-agent`,
    none about the data-access-layer rules constraint-agent
    used to false-positive on.
- ✅ **TR_038 verified again** — Phase 1 architecture names
  `PostgresLeaveRepository` with `constructor(private
  readonly pool: Pool)` (proper DI vs prior global pool),
  3 repository methods (`create`, `findById`,
  `findByEmployeeId`), and the full SQL schema with CHECK
  constraints + indices.
- ✅ **Tighter plan** — 4 phases (vs TR_038's 5, TR_037's
  5, TR_036's 7). Plan log:
  `architecture-designed: 5 module(s), 4 recommended phase(s)`.
- ✅ **TR_022 maxPhaseRetries 2/2 fired correctly**:
  16:18:42 phase-submitted → 16:26:01 retry 1/2 →
  16:34:44 retry 2/2 → 16:35:43 phase-escalated.
- ✅ **TR_033 Fix 4 / TR_036 Fix 3 `feature-blocked` alert**
  fired correctly. Visible in `gestalt alerts list`.

What blocked the verification cycle (NEW orthogonal finding):

The gate's `review-agent` flagged a real configuration drift
in the code-agent's + test-agent's output:

> "[review/architecture] The project's declared test framework
> is Vitest, but this configuration introduces Jest/ts-jest
> tooling, creating a test-framework mismatch with the
> documented and configured stack."

Looking at trackeros's actual state:
- `package.json scripts.test`: `jest --passWithNoTests`
- `package.json devDependencies`: jest + ts-jest + @types/jest
- `jest.config.js` exists
- `HARNESS.json.stack.testFramework`: "Jest"
- `agents.yaml test-agent.goal`: "Generate comprehensive
  Jest tests" (TR_036 Fix 4)

trackeros IS fully Jest-aligned. The review-agent's claim
"project declares Vitest" must come from the architecture-
agent's `successCriteria` text — Phase 1's persisted
architecture says "Vitest tests verify PostgresLeaveRepository
can persist a LeaveRequest". The architecture-agent emits
Vitest references INTO the success criteria (which then
flow into code-agent's prompt + test-agent's output) even
though `HARNESS.stack.testFramework: "Jest"` is in the
prompt's stack section.

So: ALL THREE agents in this cycle have inconsistent test
framework signals — architecture-agent emits Vitest in
success criteria; test-agent goal says Jest; code-agent
generates a Vitest spec file. The review-agent correctly
catches the inconsistency.

The same Vitest/Jest pattern was noted in TR_038 — but it
didn't matter then because intent-agent blocked first.
TR_039 cleared intent-agent → the cycle reached the
gate → the gate caught it.

Also one Fastify/Express mismatch flagged: trackeros's
HARNESS declares Fastify but the generated app entry-point
uses Express. Same root cause — architecture-agent doesn't
read the stack section consistently.

**Pending follow-ups (NEW from TR_039 verification):**

- **(HIGH — NEW)** Architecture-agent's `successCriteria`
  strings emit Vitest references even when
  `HARNESS.stack.testFramework: "Jest"` is in the prompt's
  stack section. The TR_038 stack-injection mechanism reaches
  the prompt but doesn't bind the LLM's output consistently —
  it picks Vitest as a "modern default" override. Options:
  (a) `architecture-agent.architectureGuidance` HARNESS rule
  appended: "Every success criterion that names a test
  framework, build tool, web framework, or runtime MUST use
  the exact tool name from HARNESS.stack — never a 'modern
  default' the LLM picks independently."; (b) post-process
  the architecture JSON in `reviewDesign` to substitute
  `HARNESS.stack.testFramework` for any other test-framework
  name found in success criteria text; (c) drop framework
  references from success criteria entirely — they were
  added as motivation but not load-bearing for the
  contract.
- **(MEDIUM — NEW)** Architecture-agent emits Express in
  the app entry-point design even though HARNESS declares
  Fastify. Same root cause as (a) above — the stack
  section doesn't bind framework choice.
- **(MEDIUM — NEW)** The TR_039 deferred-summary truncates
  the scope at 100 chars. On long phase scopes the snippet
  ends mid-sentence (visible in the dispatched intent text:
  "from p" cut off). Either bump to 200 chars (the intent
  text isn't budget-constrained at this size) or end the
  snippet at the last full sentence boundary within the
  limit.

Carryover follow-ups (status updates):

- **(RESOLVED by TR_039)** TR_038 HIGH NEW: intent-agent's
  CRUD-completeness check overconstrained for phased
  delivery. Verified end-to-end — intent-agent now passes
  on deferred operations.
- **(VERIFIED LIVE — was previously SHIPPED only)** TR_036
  Fix 1 (abstract rules) + Fix 2 (project-structure brief)
  + Fix 3 (maxPhaseRetries alert). All three reached the
  LLM for the first time on this cycle. Fix 1 + Fix 2
  observably eliminated false-positives on the data-access
  layer; Fix 3 alert visible in `gestalt alerts list`.

Build status: `pnpm -r build` clean across all 13 packages.
Template auto-refreshes to `0.24.0` at next server boot.

Files changed:
- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`
- `/Users/amrmohamed/Work/trackeros/HARNESS.json` (separate
  repo, pushed at `f0f9e989`)

Live URLs:
- Dashboard: http://localhost:3000/app/
- TR_039 verification feature:
  http://localhost:3000/app/features/61953f63-6655-47ae-8be9-879bcc1bffe2
- trackeros PLAN.md:
  https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
- trackeros TR_039 HARNESS commit:
  https://github.com/afarahat-lab/trackeros/commit/f0f9e989

---
---
