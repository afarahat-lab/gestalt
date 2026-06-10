# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-10 — Claude Code (TR_041: stack compliance check moved to TOP of review prompt + lifecycle coverage as 5th checklist item + lifecycle architectureGuidance rule — TOP-positioning works end-to-end on the feature-level pipeline; per-phase architecture still leaks Vitest because designPhase has no review pass)

Brief: three fixes against TR_040's two NEW HIGH follow-ups
(Vitest binding still leaking; lifecycle-coverage gap that let
Phase 5 require `update` while no phase ever added it). Fix 1
moves the TR_040 stack-compliance check from the END of the
review prompt to the TOP, where the LLM conditions hardest.
Fix 2 adds a 5th "Lifecycle coverage" checklist item to the
review task. Fix 3 adds an abstract HARNESS guidance rule for
the same lifecycle invariant.

What changed (3 fixes):

**Fix 1 — Stack compliance check rendered FIRST in review prompt**

- `packages/agents/planning/src/prompts/architecture-prompt.ts`
  `buildArchitectureReviewPrompt` restructured. The
  `## Stack compliance check (read this first)` block is now
  the FIRST thing in the prompt — rendered before persona,
  before harness section, before draft JSON, before
  everything. The block's wording strengthened too: "REWRITE
  the relevant field with the declared stack value. Do not
  preserve the original" (vs TR_040's "correct it in your
  output"). Header changed to `## Stack compliance check
  (read this first)` so the section can't be mistaken for
  one of many trailing instructions.

**Fix 2 — Lifecycle coverage as 5th review checklist item**

- Same file, same function. The four-point checklist
  (completeness / consistency / ambiguity / feasibility)
  gains a fifth item: "Lifecycle coverage — for every entity
  whose state changes during the feature lifecycle, verify
  that at least one phase in `recommendedPhases` includes a
  method to perform that mutation. If a state transition
  exists in the feature description but no phase adds the
  corresponding mutation method, ADD it to the most
  appropriate phase." The closing instruction also updated
  to "if the draft passes all FIVE checks, return it
  unchanged" (vs TR_040's "all four checks").

**Fix 3 — Lifecycle coverage architectureGuidance rule**

- Template + trackeros HARNESS
  `agentConfig.architecture-agent.architectureGuidance`
  gains: "Every state transition described in the feature
  must have a corresponding method in at least one phase.
  If an entity changes state during the feature lifecycle,
  ensure the phase plan includes a method for each
  transition — not just the initial creation." Abstract —
  no method names, no entity names. The LLM applies it to
  whatever transitions exist in the specific feature.

**Template version bumped 0.25.0 → 0.26.0.** No new
migration. Build clean across all 13 packages.

What's verified live (trackeros feature
`595033ff-99b2-460a-b532-70b99e6fed3d` on `chat-latest`):

- ✅ **Feature-level architecture is FRAMEWORK-FREE
  post-review.** DB query for framework refs in the
  persisted (post-reviewDesign) feature architecture
  returned `jest=0 vitest=0 fastify=0 express=0`. The LLM
  kept all technology choices abstract — no Vitest leak,
  no "Jest or Vitest" hedge, no Express slip. The TOP
  positioning of the stack compliance check conditions
  the LLM strongly enough that it doesn't even reach for
  framework names in the draft it returns. Compare to
  TR_040 which still had `vitest=1`.
- ✅ **Planner-agent's Phase 1 scope text says "Jest"** —
  not "Vitest", not "Jest or Vitest" hedge. The
  architecture-agent's stack-bound output flows through
  the TR_037 canonical-names section into the planner's
  prompt; the planner now picks Jest by reading the
  HARNESS.stack section in its own prompt.
- ✅ **`reviewDesign` ran (5s, 17:24:38 → 17:24:44).** No
  parse-fallback, no failure log.
- ✅ **Plan is dependency-ordered bottom-up** — Phase 1
  Employee → Phase 2 LeavePolicy → Phase 3 LeaveBalance →
  Phase 4 balance init/adjustment service → Phase 5
  LeaveRequest → Phase 6 submission workflow → Phase 7
  approval/rejection processing → Phase 8 notification.
  This is the cleanest plan structure across the TR_036
  → TR_041 sequence. Phase 7 IS the mutation phase the
  lifecycle-coverage rule asked for.

What blocked the cycle (NEW orthogonal finding):

- ❌ **Per-phase architecture (`designPhase`) still emits
  "Vitest tests" in success criteria.** Phase 1's
  per-phase architecture JSON has:
  > "Vitest tests verify create(), findById(), and
  > findManager() return expected Employee records ..."

  TR_041's review enhancements apply ONLY to
  `reviewDesign`, which reviews the FEATURE-level
  `designFeature` output. `designPhase` (the per-phase
  architecture pass) has the stack section + the
  architectureGuidance rules but NO review pass. It picks
  Vitest as a "modern default" the same way TR_040's
  designFeature did before TR_041 strengthened the review
  prompt.
- ❌ **Intent-agent escalated on a scope-vs-architecture
  file-count mismatch.** Phase 1 scope text says
  "Create employee.model.ts and employee.repository.ts"
  (2 files); per-phase architecture lists 3 files
  (adds `postgres-employee.repository.ts`) + a SQL schema.
  Intent-agent flagged this as ambiguity.

The escalation isn't a TR_041 regression — it's the same
class of issue (architecture-agent over-delivers vs the
planner's brief scope text) that TR_038's concrete-
implementation rule introduced. TR_037's canonical-names
rule pushed the planner to use architecture-agent's
names, but didn't push it to mirror the FILE LIST.

**Pending follow-ups (NEW from TR_041 verification):**

- **(HIGH — NEW)** `designPhase` needs its own review
  pass — the per-phase architecture is where the test
  framework leak now lives, and where the
  scope-vs-architecture mismatch surfaces. Options:
  (a) add `reviewPhaseDesign` mirroring `reviewDesign` —
  same prompt structure, same JSON schema, same return-
  original-on-failure semantics; (b) extend `designPhase`
  to internally re-run the same prompt with a "verify
  stack compliance + verify scope alignment" instruction
  appended (a single LLM call doing two passes).
- **(HIGH — NEW)** Planner-agent must mirror the
  architecture-agent's file list, not just its symbol
  names. The current planner-prompt injects the
  architecture JSON as canonical names but the planner
  emits its own scope text describing which files to
  create — without checking that those files are exactly
  the ones the per-phase architecture describes.
  Options: (a) planner-prompt rule: "Your scope text
  MUST list every file the per-phase architecture for
  this phase will create — verify against the per-phase
  architecture before returning"; (b) planner-prompt
  rule: "Reference the per-phase architecture JSON
  verbatim for file lists, modifying it only when
  necessary"; (c) post-process the planner's scope text
  to substitute the per-phase architecture's file list
  whenever it diverges.
- **(LOW — NEW)** The lifecycle-coverage rule may have
  contributed to the bottom-up decomposition (8 phases
  vs TR_039/40's 4-8). When the architecture has to
  cover ALL state transitions for every entity, the
  feature decomposes into more granular phases. This is
  good for correctness but means more sequential phase
  cycles. Consider raising `planner.maxFilesPerPhase`
  from 5 to 7-8 so the planner can bundle related
  files in fewer phases.

Carryover follow-ups (status updates):

- **(PARTIALLY RESOLVED by TR_041)** TR_040 HIGH NEW:
  Vitest binding. CLOSED at the FEATURE-level
  architecture (verified). STILL OPEN at the per-phase
  architecture (new TR_041 follow-up above).
- **(PARTIALLY RESOLVED by TR_041)** TR_040 HIGH NEW:
  lifecycle coverage. Phase 7 in the new plan IS the
  mutation phase for LeaveRequest (covers the approval
  workflow). Verified at the plan level. Per-phase
  method coverage in `designPhase` not yet measured —
  needs the cycle to reach Phase 5 / Phase 7 to confirm
  the mutation method is in the per-phase architecture
  JSON.

Build status: `pnpm -r build` clean across all 13
packages. Template auto-refreshes to `0.26.0` at next
server boot.

Files changed:
- `packages/agents/planning/src/prompts/architecture-prompt.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`
- `/Users/amrmohamed/Work/trackeros/HARNESS.json` (separate
  repo, pushed at `aec2340f`)

Live URLs:
- Dashboard: http://localhost:3000/app/
- TR_041 verification feature:
  http://localhost:3000/app/features/595033ff-99b2-460a-b532-70b99e6fed3d
- trackeros PLAN.md:
  https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
- trackeros TR_041 HARNESS commit:
  https://github.com/afarahat-lab/trackeros/commit/aec2340f

---
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
