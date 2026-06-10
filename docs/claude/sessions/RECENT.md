# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

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
### Session 2026-06-10 — Claude Code (TR_036: abstract constraint+review rules + auto-generated project-structure brief at gate runtime + maxPhaseRetries alert path + trackeros Jest alignment — build clean across all 13 packages; live verification cycle blocked at intent-agent on a planner/architecture-agent naming inconsistency before TR_036's gate-side code paths could execute; alert path verified via the existing TR_033 helper that fired on the cascade-brake escalation)

Brief: four fixes targeting the constraint-agent false-positive
cascade surfaced by TR_035's verification + the alert gap I
captured at terminal `blocked`.

What changed (4 fixes):

**Fix 1 — Abstract constraint+review rules (HARNESS-only)**

- `templates/corporate-ops-web-mobile/harness/HARNESS.json` and
  `/Users/amrmohamed/Work/trackeros/HARNESS.json` —
  `agentConfig.constraint-agent.rules` rewritten from concrete
  `pool.query`/`*.repository.ts`-by-name rules to abstract
  layer-role rules (data access layer, business logic layer,
  presentation/routing layer). 8 rules → 5 rules.
- `agentConfig.review-agent.rules` similarly abstracted from
  6 rules → 3 rules.
- Both agents' `verificationGuidance` rewritten to "read
  ARCHITECTURE.md first; a finding is only valid if it
  violates a rule given the actual structure of this project".
- Key change: HARNESS no longer hardcodes paths, class names,
  or method names. ARCHITECTURE.md is the authoritative
  source for layer boundaries — agents read it; rules don't
  duplicate it. Per ADR-042 the platform mechanics
  (evidence requirement, severity ceiling, JSON schema)
  remain in `.ts`.

**Fix 2 — Auto-generated project-structure brief at gate runtime**

- `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts` —
  new `buildProjectStructureBrief(projectRoot)` helper. Reads
  `ARCHITECTURE.md` (truncated to 2000 chars) + enumerates a
  depth-2 directory tree under `src/` using Node's `readdir`
  (equivalent to `find src -maxdepth 2 -type d`, bounded to
  30 entries). Returns an empty string when both sources are
  absent — callers test `length > 0` and omit the section
  cleanly. Brief is assembled BEFORE the GateTask is built
  and stored on `GateTask.projectStructureBrief`.
- `packages/agents/quality-gate/src/types.ts` — `GateTask`
  gains optional `projectStructureBrief?: string`.
- `packages/agents/quality-gate/src/agents/constraint-agent.ts`
  `buildVerificationPrompt` injects
  `${task.projectStructureBrief}` BEFORE the rules section
  when present.
- `packages/agents/quality-gate/src/agents/llm-review-agent.ts`
  `buildReviewPrompt` gains a `projectStructureBrief?: string`
  param and injects it at the top of the prompt (between the
  persona and the role description).
- The brief is conceptual `executeScript` output for the
  agent to interpret — the platform enumerates the tree as
  plain text and hands it over; per ADR-050 the agent
  decides what each path means.

**Fix 3 — maxPhaseRetries exhaustion creates `feature-blocked` alert**

- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
  — the planner's phase-retry-budget exhaustion path
  (line ~666-678) was previously silent on the alerts feed:
  it called `updatePhaseStatus(failed)` +
  `updateStatus(blocked)` + `appendLog(phase-failed)` but
  did NOT route through `markFeatureBlockedAfterEscalation`
  (the helper that creates the `feature-blocked` alert and
  emits the SSE `alert.created` event). Inlined the alert
  creation directly after the existing block:
  ```ts
  const alert = await alerts.create({
    correlationId,
    intentId: phase.intentId,
    type: 'feature-blocked',
    severity: 'high',
    title: `Feature blocked at phase ${phase.phaseIndex + 1}`,
    description: `Phase N (...) failed after M retry attempts.
                  Human review required to resume.`,
    requiredAction: 'review-manually',
    context: { featureId, phaseId, phaseIndex, phaseTitle,
               intentId, retryCount, maxPhaseRetries },
  });
  emitLiveEvent('alert.created', ...);
  ```

**Fix 4 — trackeros Jest/Vitest alignment**

- `/Users/amrmohamed/Work/trackeros/agents.yaml` — the
  `test-agent.goal` mentioned "Vitest" while every other
  piece of the trackeros project is Jest-aligned
  (`package.json scripts.test: jest --passWithNoTests`,
  `jest.config.js`, `devDependencies: jest + ts-jest +
  @types/jest`, HARNESS.json `stack.testFramework: Jest`).
  Switched the goal to "Generate comprehensive Jest tests
  mapped to success criteria".
- This is the actual source of the previous run's "test
  file uses Vitest, project config specifies Jest"
  violation — the test-agent's goal mentioned Vitest so
  the LLM happily generated Vitest imports.

**Template version bumped 0.20.0 → 0.21.0.**

Both commits pushed to `gestalt` main + `trackeros` main:
- `0505434 feat(TR_035): ...` (prior session impl)
- `db68f8e docs(TR_035): verification results ...` (prior session)
- _TR_036 impl + verify commits prepared this session;
  trackeros side at `b5396160 chore(TR_036): abstract
  constraint+review rules + align test-agent to Jest`._

What's verified:

- ✅ `pnpm -r build` clean across all 13 packages.
- ✅ `feature-blocked` alert visible in `gestalt alerts
  list` post-block (the alert came via the existing
  TR_033 cascade-brake `markFeatureBlockedAfterEscalation`
  helper that fires on `waiting-for-clarification`).
- ⚪ Fix 2 (`Project structure (read before evaluating)`
  brief injection into gate prompts) — NOT EXERCISED.
  The verification cycle escalated at intent-agent before
  ever reaching the gate. Static verification: the new
  helper assembles + ships into `GateTask`, and both
  prompt builders accept + inject it. No gate prompts in
  `agent_execution_logs` contain the new section because
  no gate ran on the new cycle.
- ⚪ Fix 1 (abstract rules) — shipped to template + trackeros
  remote (commit `b5396160`), but the gate never ran so
  the new rule text never reached an LLM.
- ⚪ Fix 3 (my new alert path) — NOT EXERCISED. The cycle
  escalated via Fix 4's existing `waiting-for-clarification`
  path, NOT via the planner's `maxPhaseRetries` exhaustion.
  Static verification: the new `alerts.create({type:
  'feature-blocked', ...}) + emitLiveEvent` block sits
  directly after the `updateStatus('blocked')` call and
  shares its conditional.
- ✅ Fix 4 (trackeros Jest goal) — pushed; not yet observed
  in a test-agent generation cycle (no Phase 1 ever
  reached test-agent).

What blocked the verification cycle (NEW finding):

The trackeros feature `b58ee152-4f5b-4dd5-8d72-39816149fbae`
ran on `chat-latest` and produced:
- 7-phase plan (planner correctly bundled model+repository
  into Phase 1; the TR_028 follow-up about that bundling
  is now satisfied at the plan level — different from prior
  TR_035 verification which had 8 phases).
- Phase 1 architecture: 2 interface(s), 5 criteria (better
  than TR_035's 1 interface + 1-2 criteria).
- Phase 1 dispatched → intent-agent fired → returned
  `CLARIFICATION_NEEDED`:

  > "High-impact ambiguity: The intent requests LeaveStatus
  > and CreateLeaveRequestDto, while the architecture
  > specification defines LeaveRequestStatus and
  > CreateLeaveRequestInput."

  i.e. the planner-agent and architecture-agent emitted
  DIFFERENT symbol names for the same concepts within the
  same phase plan. The intent-agent correctly caught the
  inconsistency.
- Self-healing-agent diagnostician → `waiting-for-clarification`
  cascade brake → feature blocked → `markFeatureBlockedAfterEscalation`
  fires → `feature-blocked` alert `430ed09a` created.

Plan log:
```
10:45:19  architecture-designed    5 module(s), 5 recommended phase(s)
10:45:27  plan-built               7 phase(s)
10:49:07  phase-architecture-designed [phase 1]  2 interface(s), 5 criteria
10:49:07  phase-submitted          intent de91983b
10:52:13  phase-escalated          waiting-for-clarification — feature blocked
```

Wall-clock: ~7 minutes total. Intent-agent's correctness
caught the upstream consistency bug before the cycle could
exercise the TR_036 gate-side fixes.

**Pending follow-ups (NEW from TR_036 verification):**

- **(HIGH — NEW)** planner-agent ↔ architecture-agent
  symbol-name inconsistency. Both agents emit type/field
  names independently for the same phase; nothing
  cross-checks. In this run: planner referenced
  `LeaveStatus` + `CreateLeaveRequestDto` while
  architecture-agent emitted `LeaveRequestStatus` +
  `CreateLeaveRequestInput`. Either (a) planner reads
  architecture-agent's output and uses its symbol names
  verbatim, or (b) architecture-agent reads the planner's
  scope text and reconciles names before emitting.
  Without this, every cycle on chat-latest will be
  blocked at intent-agent on the same kind of mismatch.
- **(MEDIUM — NEW)** intent-agent's `CLARIFICATION_NEEDED`
  on planner/architecture inconsistency triggers cascade
  brake → block, but the diagnosis-level severity is
  arguably "fix upstream and retry the phase" rather than
  "escalate to human". Self-healing's diagnostician
  should reconcile-and-retry on intra-plan symbol
  conflicts (the planner can re-run the per-phase
  architecture pass) before declaring waiting-for-clarification.
- **(MEDIUM — NEW)** test-agent goal field used to seed
  the test framework choice. Operators may not realise
  changing the description string changes the
  test-framework signal. Either (a) the
  `generateStackConfig` LLM pass should be deterministic
  about which test framework it picks AND mirror the
  choice into both `HARNESS.stack.testFramework` AND
  `agents.yaml test-agent.goal`, or (b) a single source
  of truth (HARNESS.stack.testFramework) and the
  test-agent goal is built from it at runtime instead
  of being embedded in agents.yaml at init time.

Carryover follow-ups (status updates):

- **(ADDRESSED by TR_036 Fix 3 — code, NOT YET LIVE
  VERIFIED)** TR_035 HIGH finding: maxPhaseRetries
  exhaustion silent on alerts feed. Code path landed;
  this cycle escalated via the OTHER path (existing
  TR_033 Fix 4 helper) so the new alert call didn't
  fire. Will exercise next time a phase actually
  exhausts the planner retry budget.
- **(STILL OPEN — HIGH from TR_035 verification)**
  Gate constraint-agent false-positives on
  `src/shared/db/connection.ts`. TR_036 Fix 1 (abstract
  rules) is intended to close this; not verified live
  because gate never ran.

Build status: `pnpm -r build` clean across all 13
packages. Server Docker image rebuilt with TR_036 code.
Template auto-refreshes to `0.21.0` at next server boot.

Files changed:
- `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`
- `packages/agents/quality-gate/src/agents/constraint-agent.ts`
- `packages/agents/quality-gate/src/agents/llm-review-agent.ts`
- `packages/agents/quality-gate/src/types.ts`
- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`
- `/Users/amrmohamed/Work/trackeros/HARNESS.json` (separate repo)
- `/Users/amrmohamed/Work/trackeros/agents.yaml` (separate repo)

---
---
