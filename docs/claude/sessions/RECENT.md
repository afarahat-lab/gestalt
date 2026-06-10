# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

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
### Session 2026-06-10 — Claude Code (TR_037: planner-agent uses architecture-agent's canonical type names — TR_036 follow-up — symbol-name conflict resolved end-to-end; intent-agent now blocks on a different ambiguity — concrete persistence implementation not specified)

Brief: one-fix-one-rule directly addressing TR_036's NEW HIGH
follow-up. TR_036's verification cycle blocked at intent-agent on
`LeaveStatus vs LeaveRequestStatus` / `CreateLeaveRequestDto vs
CreateLeaveRequestInput` — the planner-agent and architecture-agent
emit type names independently with nothing reconciling them. This
session injects architecture-agent's full JSON output into the
planner-agent prompt as a "Canonical type and symbol names" block,
plus a HARNESS rule telling the planner to use those exact names.

What changed (2 fixes):

**Fix 1 — Inject canonical architecture into planner-agent prompt**

- `packages/agents/planning/src/prompts/planner-prompt.ts` —
  `buildFeaturePlanPrompt` now renders the full
  `FeatureArchitecture` object as a `## Canonical type and symbol
  names` section with the architecture JSON pretty-printed and
  sliced to 2000 chars. The section sits BETWEEN the persona/goal
  framing and the harness rules section, BEFORE the task
  description — the planner sees canonical names before it starts
  planning. Prior planner-prompt only injected
  `Domain entities: <names>` and `Modules: <name>@<path>` — the
  attributes + interface fields where canonical field names live
  were dropped.
- No threading through `task.context` needed — the planner-agent
  already receives `architecture` as a positional parameter via
  `planFeature(feature, architecture, …)`. The Fix 1 change is
  entirely inside `planner-prompt.ts`.

**Fix 2 — Abstract canonical-names rule in HARNESS**

- `templates/corporate-ops-web-mobile/harness/HARNESS.json` and
  `/Users/amrmohamed/Work/trackeros/HARNESS.json` —
  `agentConfig.planner-agent.rules` appended with: "The
  architecture specification provided above defines the canonical
  type names, interface names, and symbol names for this feature.
  Use these exact names in all phase scopes. Do not invent
  alternative names or rename types."
- Abstract — no hardcoded type names. The LLM reads the
  architecture output (now in the prompt) and applies the rule.

**Template version bumped 0.21.0 → 0.22.0.** No new migration.
Build clean across all 13 packages.

What's verified live (trackeros feature
`ce9d1b80-b442-4547-afcf-d389e4aa8b63` on chat-latest):

- ✅ **Canonical names alignment** — the architecture-agent
  defined `LeaveRequest` with attributes `id, employeeId,
  leaveType, startDate, endDate, status` and the planner emitted
  Phase 1 scope: "Create src/modules/leave/leave.model.ts
  defining the **canonical LeaveRequest type** and DTOs needed by
  persistence using the **fields id, employeeId, leaveType,
  startDate, endDate, and status**". Exact name + exact field
  list. No more `LeaveStatus` vs `LeaveRequestStatus` divergence.
- ✅ **Tighter plan** — 5 phases (vs TR_036's 7, TR_035's 8) with
  meaningful titles (e.g. "Leave Module Core Domain and
  Persistence", "Leave Request Submission Workflow") instead of
  the prior "Create leave model" / "Create leave repository"
  decomposition.
- ✅ **Richer per-phase architecture** — Phase 1 has 4 interfaces +
  5 success criteria + SQL schema (`leave_requests` table with
  full column list + indices). Vs TR_036's 2 interfaces + 5
  criteria and TR_035's 1 interface + 1-2 criteria.
- ✅ **Intent-agent did NOT escalate on symbol names** — the
  cycle proceeded into `generating` (no immediate cascade brake
  on the TR_036 symbol mismatch).
- ✅ **feature-blocked alert** fired correctly via the existing
  TR_033 helper.

What blocked the verification cycle (NEW orthogonal finding):

After ~6 minutes in `generating`, intent-agent escalated to
`waiting-for-clarification` with a DIFFERENT reason:

> "High-impact ambiguity: The concrete persistence
> implementation backing LeaveRepository is not specified."

i.e. the architecture-agent defined the `LeaveRepository`
interface but didn't pin the concrete DB driver / package
choice (`pg` Pool? Knex? Prisma?). The planner inherited this
ambiguity; intent-agent's clarification check is strict enough
to flag it. Self-healing → cascade brake → feature blocked.
Total cycle wall-clock: ~6 minutes.

What this means: TR_037 closed the symbol-name conflict gap
that TR_036 verification surfaced. A NEW, more nuanced
ambiguity is now the blocker — architectural decisions
(implementation choice) the architecture-agent doesn't pin
because they aren't strictly necessary for the interface
contract. This is a stricter intent-agent than the platform
needs for autonomous completion.

**Pending follow-ups (NEW from TR_037 verification):**

- **(HIGH — NEW)** architecture-agent should specify the
  concrete persistence implementation per repository
  interface — at minimum the DB driver/package name. The
  fix could be HARNESS-only (new
  `architecture-agent.architectureGuidance` item) or
  platform-side (a deterministic post-processing step that
  reads `HARNESS.stack.database` and appends "Implement with
  the `pg` driver targeting Postgres" to each repository
  interface description).
- **(MEDIUM — NEW)** intent-agent's clarification bar is too
  strict for autonomous planning. A `LeaveRepository` interface
  with no concrete implementation note is reasonable — the
  code-agent can pick a reasonable default based on the
  project's `package.json` + `HARNESS.stack`. Either (a)
  intent-agent's clarification scoring treats
  "implementation-detail not specified" as low-severity, or
  (b) self-healing's diagnostician dispatches a `fix-intent`
  child to add the concrete implementation note before
  cascade-braking.

Carryover follow-ups (status updates):

- **(RESOLVED by TR_037 Fix 1)** TR_036 HIGH: planner-agent ↔
  architecture-agent symbol-name inconsistency. The planner
  now sees the architecture JSON verbatim and uses the same
  names. Verified end-to-end on the live cycle.
- **(STILL OPEN — HIGH from TR_036)** Gate-side fixes (Project
  structure brief + abstract rules) still not LLM-tested — the
  gate has never run in any verification cycle since they
  landed. The new TR_037 follow-ups need to be resolved first
  to get past intent-agent.

Build status: `pnpm -r build` clean across all 13 packages.
Template auto-refreshes to `0.22.0` at next server boot.

Files changed:
- `packages/agents/planning/src/prompts/planner-prompt.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`
- `/Users/amrmohamed/Work/trackeros/HARNESS.json` (separate repo)

Live URLs:
- Dashboard: http://localhost:3000/app/
- TR_037 verification feature:
  http://localhost:3000/app/features/ce9d1b80-b442-4547-afcf-d389e4aa8b63
- PLAN.md on trackeros main:
  https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
- trackeros TR_037 HARNESS commit:
  https://github.com/afarahat-lab/trackeros/commit/5f083345
- platform feat commit (will land after this session's
  RECENT.md commit): pending

---
---
