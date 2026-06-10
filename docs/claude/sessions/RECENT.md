# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

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
### Session 2026-06-10 — Claude Code (TR_038: architecture-agent self-review + concrete-implementations stack injection — TR_037 HIGH follow-up CLOSED; the persisted architecture now names PostgresLeaveRepository as concrete impl + imports pg Pool from src/shared/db; intent-agent now blocks on a stricter CRUD-completeness check, a new orthogonal finding)

Brief: two stopgap fixes (ADR-056 — both will be replaced by the
LangGraph architecture crew). Fix 1 injects `HARNESS.stack` into the
architecture-agent's prompts so it can name concrete implementations.
Fix 2 adds a single-agent self-review pass after `designFeature`
where the SAME agent checks the draft for completeness /
consistency / ambiguity / feasibility.

What changed (2 fixes):

**Fix 1 — HARNESS.stack injection into architecture-agent prompts**

- `packages/agents/planning/src/prompts/architecture-prompt.ts` —
  new `renderStackSection(harnessConfig)` helper renders
  `HARNESS.json.stack` as a `## Project stack` block. Empty
  string when `stack` is absent. Wired into BOTH
  `buildFeatureArchitecturePrompt` AND
  `buildPhaseArchitecturePrompt` (the brief said "per-phase
  design prompt" but the same gap exists at the feature level
  where the canonical interfaces are first defined — that's
  where intent-agent's TR_037 complaint surfaced).
- New `HARNESS.json.agentConfig.architecture-agent.architectureGuidance`
  item on the template + trackeros: "For every interface or
  abstraction you define, specify the concrete implementation
  that backs it using the declared project stack. Do not
  leave implementation choices ambiguous — specify enough
  detail that a developer can implement without asking
  clarifying questions."

**Fix 2 — Architecture self-review pass (STOPGAP, ADR-056)**

- `packages/agents/planning/src/prompts/architecture-prompt.ts`
  — new exported `buildArchitectureReviewPrompt` builds the
  review prompt with: persona + agentCfg.goal, harness rules
  section, stack section, draft JSON (sliced to 3000 chars),
  feature description, the four-point review checklist
  (completeness / consistency / ambiguity / feasibility),
  and the SAME `FeatureArchitecture` JSON output schema as
  the original design (so the parse path is reused).
- `packages/agents/planning/src/agents/architecture-agent.ts`
  gains `reviewDesign(draft, feature, projectRoot,
  harnessConfig, correlationId)`. Routes through `callLLM`
  so ADR-057 token management applies automatically. Returns
  the original draft on ANY failure path: loadAgentConfig
  throws → return draft; callLLM throws → return draft; the
  reviewed output parses to empty (every parse-failure
  fallback) → return draft. Logs before/after entity + module
  counts on success so operators see the review's effect.
- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
  — the architecture-agent feature pass now goes:
  `designFeature → reviewDesign → save`. The orchestrator
  carries a STOPGAP (ADR-056) comment block above the
  reviewDesign call telling the next session to delete this
  + `buildArchitectureReviewPrompt` + `reviewDesign()` when
  the LangGraph architecture crew lands.
- New `HARNESS.json.agentConfig.architecture-agent.rules`
  item on the template + trackeros: "When reviewing a draft
  architecture: check that every interface or abstraction
  has a named concrete implementation, all symbol names are
  consistent, and no implementation choice is left open for
  a developer to decide."

**Template version bumped 0.22.0 → 0.23.0.** No new migration.
Build clean across all 13 packages.

What's verified live (trackeros feature
`d0513f28-6648-4651-bf4e-15e8771c4e5b` on `chat-latest`):

- ✅ **reviewDesign log fires** —
  `architecture-agent reviewDesign complete` log line printed
  at 14:04:37, 6 seconds after `designFeature` returned at
  14:04:31. Before/after counts logged: 5 entities → 5
  entities, 5 modules → 5 modules (review judged the
  structure complete; the LLM didn't add or remove any
  entries, just enriched the content).
- ✅ **Concrete implementation NAMED in the architecture** —
  Phase 1's persisted architecture JSON has:
  ```
  "Concrete implementation: PostgresLeaveRepository from
  src/modules/leave/postgres-leave.repository.ts"
  ```
  with the full class declaration `export class
  PostgresLeaveRepository implements LeaveRepository { … }`
  and `import { pool } from '../../shared/db/connection'` /
  `import { Pool } from 'pg'`. This is exactly what TR_037's
  HIGH NEW follow-up asked for — and it appears organically
  in the architecture without any platform-side post-
  processing of "fill in the concrete class name".
- ✅ **Stack-driven choices** — the `pg` package + `Pool`
  primitive are pulled directly from
  `HARNESS.stack.database` ("PostgreSQL"). No more "which
  DB driver" ambiguity.
- ✅ **Shared connection layer** named at
  `src/shared/db/connection.ts` — the constraint-agent +
  review-agent's TR_036 abstract rules now have a concrete
  reference point.
- ✅ **5-phase plan** with model+repo bundled into Phase 1
  (TR_037 canonical-names rule still working) +
  Phase 1 architecture: 4 interfaces + 5 criteria + SQL
  schema with CHECK constraints + indices.
- ✅ **Intent-agent did NOT escalate on**:
  - Symbol-name conflict (TR_037 fix sticky)
  - Persistence implementation choice (TR_038 closed it)
- ✅ **`feature-blocked` alert fired** via the existing
  TR_033 helper.

What blocked the verification cycle (NEW orthogonal finding):

After ~15 seconds in `generating`, intent-agent escalated
to `waiting-for-clarification` with a NEW reason:

> "High-impact ambiguity: The intent mentions repository
> CRUD behavior, but the specified LeaveRepository
> interface only defines create and findById methods."

i.e. the LLM (chat-latest) interprets the feature description
"leave management module" as IMPLYING full CRUD (create /
read / update / delete) on the `LeaveRepository` interface.
The architecture-agent decided (legitimately) that Phase 1's
`LeaveRepository` only needs `create` + `findById` —
`update` is needed by the approval workflow (Phase 3) and
`delete` may never be needed at all. Self-healing → cascade
brake → feature blocked at 14:05:14.

This is the THIRD distinct intent-agent ambiguity in the
TR_036 → TR_037 → TR_038 sequence:

| Session | Intent-agent escalation reason |
|---------|--------------------------------|
| TR_036  | Symbol-name conflict (LeaveStatus vs LeaveRequestStatus) |
| TR_037  | Concrete persistence implementation not specified |
| TR_038  | Repository interface missing some CRUD methods implied by the intent |

Each fix closes one rigor bar; intent-agent reveals another.

**Pending follow-ups (NEW from TR_038 verification):**

- **(HIGH — NEW)** Intent-agent's CRUD-completeness check
  is overconstrained for phased delivery. A `LeaveRepository`
  with `create` + `findById` in Phase 1 is legitimate when
  later phases will extend it; intent-agent should treat
  "phase scope subset of full lifecycle" as a non-blocking
  partial verdict. Options: (a) `intent-agent.rules`
  injection telling it the intent text describes the FULL
  feature lifecycle, not the phase scope; (b) self-healing's
  diagnostician dispatches a `fix-intent` child that ADDS
  the missing methods to the architecture before
  cascade-braking; (c) intent-agent's prompt builder
  receives a `## Out of scope for this phase: …` block
  derived from the planner's later-phase scopes.
- **(MEDIUM — NEW)** The review pass output is identical in
  shape to the draft on this cycle. That's expected when the
  LLM judges the draft complete — but means we have no
  evidence (this cycle) that the review pass would actually
  CHANGE a flawed draft. Need a deliberately flawed draft
  (e.g. inject a fake symbol-name conflict) to observe the
  review pass correcting it. Or: log a structured diff
  between draft and reviewed so any actual change is visible.
- **(LOW — NEW)** trackeros's `architecture` JSON for Phase 1
  still mentions "Vitest" in the success-criteria text
  ("A Vitest repository test can persist a LeaveRequest…")
  even though trackeros's agents.yaml test-agent goal was
  switched to Jest in TR_037. The architecture-agent prompt
  doesn't see `agents.yaml`, only HARNESS. Either propagate
  `testFramework: Jest` more visibly into the
  architecture-agent's stack section (it's there in
  `HARNESS.stack.testFramework`), or have the architecture-
  agent reference the framework name explicitly when it
  emits test-related success criteria.

Carryover follow-ups (status updates):

- **(RESOLVED by TR_038 Fix 1)** TR_037 HIGH NEW:
  architecture-agent should specify the concrete
  persistence implementation per repository interface from
  `HARNESS.stack.database`. **VERIFIED end-to-end** —
  `PostgresLeaveRepository` named, `pg Pool` imported, full
  class declaration in the architecture JSON.
- **(STILL OPEN — HIGH from TR_036)** Gate-side fixes
  (Project structure brief + abstract rules) still not
  LLM-tested. The cycle still hasn't reached the gate; each
  of TR_036/037/038 surfaced a different intent-agent
  ambiguity. The next session's TR_039 (if it addresses the
  CRUD-completeness rigor bar) should be the one that
  finally lets the cycle through to code-agent + gate.

Build status: `pnpm -r build` clean across all 13 packages.
Template auto-refreshes to `0.23.0` at next server boot.

Files changed:
- `packages/agents/planning/src/prompts/architecture-prompt.ts`
- `packages/agents/planning/src/agents/architecture-agent.ts`
- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`
- `/Users/amrmohamed/Work/trackeros/HARNESS.json` (separate repo,
  pushed at `22b68de6`)

Live URLs:
- Dashboard: http://localhost:3000/app/
- TR_038 verification feature:
  http://localhost:3000/app/features/d0513f28-6648-4651-bf4e-15e8771c4e5b
- trackeros PLAN.md:
  https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
- trackeros TR_038 HARNESS commit:
  https://github.com/afarahat-lab/trackeros/commit/22b68de6

---
---
