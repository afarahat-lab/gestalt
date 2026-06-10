# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-10 — Claude Code (TR_042: per-phase architecture review pass + planner file-list mirroring rules — review-pass plumbing verified end-to-end; planner file-count rule worked; Vitest still leaks at the per-phase level even with TOP-positioned stack check; new intent-agent bar: audit records for state-changing operations)

Brief: two stopgap fixes (ADR-056) extending TR_041's
treatment to the per-phase architecture pass. TR_041 cleaned
the FEATURE-level architecture but the per-phase `designPhase`
output kept leaking Vitest references in success criteria,
and intent-agent escalated on a scope-vs-architecture
file-count mismatch.

What changed (4 fixes — 2 platform + 2 HARNESS-side):

**Fix 1a — `buildPhaseArchitectureReviewPrompt`**

- `packages/agents/planning/src/prompts/architecture-prompt.ts`
  gains a new exported builder mirroring
  `buildArchitectureReviewPrompt` for the per-phase
  `PhaseArchitecture` shape (interfaces / importStatements /
  sqlSchema / successCriteria). Same TR_041 positioning
  rules: stack compliance section rendered FIRST in the
  prompt, strengthened "REWRITE the relevant field. Do not
  preserve the original. Do not hedge with 'or'
  alternatives" language, and the same 5-point review
  checklist adapted to per-phase concerns (stack /
  file-list completeness / interface completeness / import
  accuracy / success-criteria accuracy).
- The output schema mirrors the original `PhaseArchitecture`
  shape so `parsePhaseArchitecture` parses the review
  result. On parse failure the caller returns the original
  draft.

**Fix 1b — `ArchitectureAgent.reviewPhaseDesign(draft, phase,
feature, projectRoot, harnessConfig, correlationId)`**

- `packages/agents/planning/src/agents/architecture-agent.ts`
  gains the per-phase counterpart of TR_038's
  `reviewDesign`. Same safety semantics: returns the
  original draft on ANY failure path (loadAgentConfig
  throws → return draft; callLLM throws → return draft;
  parsed result has empty `interfaces` AND empty
  `successCriteria` → return draft). Logs before/after
  counts for interfaces / importStatements /
  successCriteria so operators can see the review's
  effect.

**Fix 1c — Orchestrator wires `designPhase → reviewPhaseDesign
→ persist`**

- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
  `runPerPhaseArchitecture` now invokes `designPhase →
  reviewPhaseDesign` and persists the REVIEWED output (not
  the raw draft). Logs an explicit "Invoking
  architecture-agent reviewPhaseDesign (TR_042 stopgap)"
  line so operators can see the new step. The function
  carries a STOPGAP (ADR-056) comment block telling the
  next session to delete `reviewPhaseDesign` +
  `buildPhaseArchitectureReviewPrompt` + this call when
  the LangGraph architecture-crew migration lands.

**Fix 2 — Planner phaseScopingRules — don't contradict
architecture file list**

- Template + trackeros HARNESS gain two new abstract
  `agentConfig.planner-agent.phaseScopingRules` items:
  - "The file list in each phase scope is an estimate. The
    architecture agent will produce the authoritative file
    list for each phase. Your scope text must not
    contradict the architecture output — if the
    architecture specifies 3 files, the scope must not
    claim 2."
  - "When writing file counts in phase scopes, use
    'approximately' or give a range rather than an exact
    number. The architecture agent determines the exact
    file list."

**Template version bumped 0.26.0 → 0.27.0.** No new
migration. Build clean across all 13 packages.

What's verified live (trackeros feature
`ec42e085-47b8-4475-99cb-e8a718ed63cb` on `chat-latest`):

- ✅ **`reviewPhaseDesign` log fires** —
  `architecture-agent reviewPhaseDesign complete` printed
  at 18:37:47, ~4 seconds after Phase 1's `designPhase`
  returned. Before/after counts logged: `beforeInterfaces:
  3 → afterInterfaces: 3, beforeImports: 3 → afterImports:
  3, beforeCriteria: 5 → afterCriteria: 5`. Same shape,
  empty-fallback guard didn't trip → reviewed output
  persisted.
- ✅ **Scope-vs-architecture file-count mismatch
  (TR_041 finding) RESOLVED** — intent-agent did NOT
  escalate on a file-count mismatch this cycle. Fix 2 (the
  planner phaseScopingRules) successfully neutralised the
  conflict between planner scope text and per-phase
  architecture file list.
- ❌ **Vitest STILL leaks at the per-phase level.** DB
  query for framework refs in Phase 1's persisted
  architecture returned `Vitest=2 + vitest=1 = 3
  mentions` (all in `successCriteria` text). The
  before/after counts were identical (3→3, 3→3, 5→5) —
  the LLM judged the draft compliant and didn't rewrite
  the Vitest mentions. The TR_041 effect at the
  FEATURE-level architecture (zero framework refs) did
  NOT transfer to the per-phase scale even with the same
  prompt-top stack compliance treatment.
- ❌ **Cycle blocked at intent-agent on a NEW bar:**
  "Platform standards require audit records for
  state-changing operations, but no audit module,
  interface, or file scope is provided for this phase."

What blocked the verification cycle (NEW orthogonal finding):

Intent-agent escalated on an AUDIT requirement for the
Employee module's Phase 1 — it interprets the broader
project context (golden principles / `agents.yaml`
prompt_extensions) as requiring audit logging for every
state change, and flags the absence as a clarification
need. This is the FIFTH distinct intent-agent rigor bar
across the TR_036 → TR_042 sequence:

| Session | Intent-agent escalation reason |
|---------|--------------------------------|
| TR_036  | Symbol-name conflict |
| TR_037  | Concrete persistence implementation not specified |
| TR_038  | Repository missing CRUD methods implied by the intent |
| TR_041  | Scope-vs-architecture file-count mismatch |
| **TR_042** | **Audit records for state-changing operations not in scope** |

Each fix closes one bar; intent-agent reveals another. The
intent-agent is operating from "platform standards" that
aren't visible in the architecture-agent's pass, so the
architecture doesn't pre-empt them.

**Pending follow-ups (NEW from TR_042 verification):**

- **(HIGH — NEW)** Per-phase Vitest binding still fails
  even with TOP-positioned stack compliance check. The
  TR_041 effect (clean feature-level architecture) doesn't
  transfer to per-phase scale. Options:
  (a) regex post-processing pass in `reviewPhaseDesign`
  or in `parsePhaseArchitecture` — read
  `HARNESS.stack.testFramework`, substitute any other
  test-framework name in the result JSON; (b) inject a
  literal SAMPLE FRAGMENT in the review prompt showing
  the exact framework reference shape ("Use 'Jest tests'
  in success criteria — not 'Vitest tests'"); (c)
  schema-validation-style reject + retry: parse the
  reviewed JSON, scan for known alternative-framework
  names, if found re-issue the review call up to N times.
- **(HIGH — NEW)** Intent-agent's "audit records"
  requirement isn't reflected in the architecture pass.
  Architecture-agent should know about the project's
  "platform standards" the same way intent-agent does.
  Options: (a) feed `goldenPrinciples` into the
  architecture-agent prompt so it can pre-empt audit-
  logging concerns; (b) intent-agent prompt should treat
  "audit logging" as a CONCERN that flows into the
  current phase rather than a blocking ambiguity (this
  is what TR_038 / TR_041 attempted for other rigor bars);
  (c) self-healing's diagnostician should detect this
  class of "missing cross-cutting concern" and dispatch
  a fix-intent that adds the audit module to the phase
  architecture instead of cascade-braking.
- **(MEDIUM — NEW)** The review pass's "before/after
  count" log doesn't capture WHAT changed in the
  per-phase JSON. On this cycle counts were identical
  (the LLM judged the draft compliant), but if it had
  changed a single criterion string the log wouldn't show
  it. Add a structured before/after diff log (field-name
  level) to make review-pass effects observable.

Carryover follow-ups (status updates):

- **(RESOLVED by TR_042 Fix 2)** TR_041 HIGH NEW:
  planner-vs-architecture file-list mismatch.
  Intent-agent escalation NOT seen this cycle —
  verified end-to-end on this run.
- **(STILL OPEN — HIGH from TR_041)** Per-phase Vitest
  binding. TR_042 added the review pass but the LLM
  doesn't act on the Vitest mentions at the per-phase
  scale. Promoted as the new HIGH follow-up above.
- **(STILL OPEN — HIGH from TR_036)** Gate-side
  verification. The cycle did not reach the gate again
  (intent-agent blocked first).

Build status: `pnpm -r build` clean across all 13
packages. Template auto-refreshes to `0.27.0` at next
server boot.

Files changed:
- `packages/agents/planning/src/prompts/architecture-prompt.ts`
- `packages/agents/planning/src/agents/architecture-agent.ts`
- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`
- `/Users/amrmohamed/Work/trackeros/HARNESS.json` (separate
  repo, pushed at `7512ced5`)

Live URLs:
- Dashboard: http://localhost:3000/app/
- TR_042 verification feature:
  http://localhost:3000/app/features/ec42e085-47b8-4475-99cb-e8a718ed63cb
- trackeros PLAN.md:
  https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
- trackeros TR_042 HARNESS commit:
  https://github.com/afarahat-lab/trackeros/commit/7512ced5

---
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
