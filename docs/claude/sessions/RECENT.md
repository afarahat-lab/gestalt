# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-07 — Claude Code (TR_022: scaffolding fixes + phase retry budget + per-phase architecture verification — full planning loop live-tested on leave management feature)

Follow-up to PLANNING_LAYER. Three fixes plus four verification
runs against trackeros to confirm the planning loop is fully
operational under real CI.

What changed (code):

- **Migration 025** — `ALTER TABLE feature_phases ADD COLUMN
  retry_count INTEGER NOT NULL DEFAULT 0`. Existing rows
  start at 0 so the semantics on the next cycle match
  pre-TR_022 behaviour exactly.
- **`@gestalt/core`** — `HarnessConfig.planner` gains optional
  `maxPhaseRetries` (default 2 — one initial attempt + 2
  retries = 3 total per phase). `FeaturePhaseRecord` gains
  `retryCount: number`. `FeatureRepository` gains
  `incrementPhaseRetry(phaseId): Promise<number>`. Postgres
  impl plus Oracle/MSSQL throw-stubs all updated.
- **`@gestalt/agents-planning`** — `handlePlanningEvaluate`'s
  failure branch rewritten. Instead of immediately marking the
  feature blocked, the orchestrator reads
  `planner.maxPhaseRetries` via a fast shallow-clone helper
  (`readMaxPhaseRetries` — appended at the bottom of
  `planning-orchestrator.ts`), compares to `phase.retryCount`,
  and either dispatches a fresh `planning:phase` for the same
  phase (logged as `phase-retry`) or transitions to
  `phase-failed` with budget exhausted. The retry uses the
  same phase row — same scope, same architecture notes — so
  the next-round Aider sees identical inputs.
- **`packages/server/src/templates/stack-config.ts`** —
  `buildStackPrompt` extended with a TypeScript-specific
  paragraph instructing the LLM to include the JSON-import rule
  in `agentPromptExtensions`. `parseStackConfig` defensively
  injects the rule (via the new `TS_JSON_IMPORT_RULE` const)
  whenever `language === 'TypeScript'` and the LLM forgot it.
  `DEFAULT_AGENT_PROMPT_EXTENSIONS` updated so the failure-
  default path also carries the rule.
- **Template (`templates/corporate-ops-web-mobile/harness/HARNESS.json`)** —
  `planner.maxPhaseRetries: 2` added; `agentConfig.code-agent.rules`
  gains the JSON-import rule. Template bumped 0.8.0 → 0.9.0.

trackeros operator commits (already on `main`):

- `a7494aaa` — tsconfig.json `resolveJsonModule` +
  `allowSyntheticDefaultImports`; HARNESS.json
  `code-agent.rules` JSON-import rule; planner block bumped
  to `{maxPhasesPerFeature: 10, maxFilesPerPhase: 5,
  architectureReviewPerPhase: false, maxPhaseRetries: 2}`.
- `b99e1716` — revert of the temporary
  `architectureReviewPerPhase: true` test toggle.

Live verification matrix:

| Check (from brief) | Verified? | Evidence |
|---|---|---|
| architecture-agent runs | ✓ | Feature `1a5dcfc5`: log entry `architecture-designed Feature architecture: 4 module(s), 2 recommended phase(s)` at 19:12:53 |
| PLAN.md committed to repo | ✓ | trackeros commit `ebd5bbdf` |
| docs/ARCHITECTURE.md updated | ✓ | "Leave Management Module" section appended in same commit |
| Phase 1 intent submitted automatically | ✓ | Plan log `phase-submitted [phase 1] … intent 8f93f513` at 19:13:10 |
| **TR_022 — retry budget honoured** | ✓ | Plan log shows `phase-retry 1/2` at 19:16:22 and `phase-retry 2/2` at 19:19:41 before `phase-failed after 2 retries` at 19:22:44 |
| **TR_022 — per-phase architecture review fires when opted in** | ✓ | Feature `37799ea9` (test-only flag flip): log entry `phase-architecture-designed [phase 1] Phase 1 architecture: 1 interface(s), 3 criteria` at 19:24:59 between `plan-built` and `phase-submitted` |
| CI passes after tsconfig fix | ✗ partial | The TS5083 `resolveJsonModule` class is fixed (no longer flagged). New failures are property-mismatch errors in Aider's generated code (e.g. `Property 'employeeId' does not exist on type 'CreateLeaveRequestDto'`) — a pre-existing code-agent / Aider problem, not a tsconfig issue |
| Phase 1 deploys | ✗ | Blocked by the Aider issue above |
| Phase evaluator runs | ✗ | Only runs on successful deploy — guarded by design |
| Phase 2 submitted | ✗ | Same reason |
| `gestalt feature show <id>` renders progress correctly | ✓ | Three live polls in this session, including the retry events |

The brief's primary verification target — the **autonomous
planning loop with retry budget** — passed every check. The
secondary target (clean deploy through CI) is gated on the
Aider behaviour follow-up, captured below.

PLAN.md produced for the leave-management feature
(5 phases, 4 modules, 3 domain entities):

```markdown
# PLAN.md — Leave management module

## Modules
- **leave** (`src/modules/leave`)
- **balance** (`src/modules/balance`)
- **policy** (`src/modules/policy`)
- **employee** (`src/modules/employee`)

## Domain entities
- **LeaveRequest** — id, employeeId, type, startDate,
  endDate, status, managerId, managerComment, createdAt
- **LeaveBalance** — employeeId, leaveType, totalDays,
  usedDays, year
- **LeavePolicy** — id, leaveType, defaultDaysPerYear,
  maxConsecutiveDays, requiresApproval, createdAt

## Phases
1. Create leave model
2. Implement leave request submission (depends on Phase 1)
3. Implement leave request approval (depends on Phase 2)
4. Create leave balance management (depends on Phase 1)
5. Implement leave policy configuration
```

Full PLAN.md text in trackeros `main`:
https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
(commit `ebd5bbdf`).

Decisions made:

- **`readMaxPhaseRetries` does its own shallow clone** rather
  than hoisting harness-read above the failure check. Cleaner
  separation — the retry branch never touches the (larger)
  evaluate-clone path. Cost: ~250ms per failure dispatch on a
  small repo; acceptable for an error path.
- **Retry preserves the original `scope` column** and
  re-dispatches the same `planning:phase` payload. The phase
  row's `scope` / `architecture` are the plan — the retry
  should not mutate the plan, just give Aider another swing
  at it. Operators who want a "smart retry" with a refined
  scope can use the existing `pendingScopeAdjustment`
  mechanism the evaluator already populates.
- **Per-phase architecture verified via a test-flip + revert**
  rather than left permanently enabled on trackeros. The flag
  multiplies architecture-agent cost N-fold per feature; the
  default `false` is the right operator choice on trackeros's
  budget. The verification proved the code path runs; the
  flag is now safe to flip true on any project that wants it.
- **`maxPhaseRetries: 0`** was used during the per-phase
  architecture verification cycle so the test feature didn't
  burn the retry budget on unrelated Aider failures while
  proving the architecture flag's behaviour. Reverted with
  the architecture flag in the same revert commit.

Pending follow-ups (NEW from TR_022):

- **(HIGH)** Aider generates code that references fields not
  present on the DTO (e.g. `employeeId`, `reason`, reason on
  `CreateLeaveRequestDto`). Three consecutive attempts on
  Phase 1 all produced the same class of error. Either
  (a) extend the code-agent prompt with a "before writing a
  service / repository, READ the DTO file and only reference
  the fields you see there" rule, or (b) require Aider to
  emit the model + repository in the same call so the model
  is in its context when writing the repository. Captured as
  TR_023 work.
- **(LOW)** `readMaxPhaseRetries` could cache HARNESS.json
  per feature for the duration of a feature lifecycle —
  today it re-clones on every failure dispatch.

Carryover follow-ups (status updates):

- **(RESOLVED by TR_022)** PLANNING_LAYER's MEDIUM follow-up:
  "phase failure → feature blocked is too eager" — now
  bounded by `planner.maxPhaseRetries`.
- **(RESOLVED by TR_022)** PLANNING_LAYER's LOW follow-up:
  per-phase architecture pass not yet live-verified —
  verified via feature `37799ea9`.
- **(STILL OPEN — NEW HIGH)** TR_023 — Aider DTO-field
  hallucination (described above).
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010
  mandatory `executeScript tsc --noEmit` code-agent rule on
  trackeros's HARNESS.json. Would catch this class of error
  pre-emit.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture in `agent_executions.tokens_used`.

Build status: `pnpm -r build` clean across all 13 packages.
Migration 025 applied at boot. Template auto-refreshed:
`version: "0.9.0"`. Server `/health` 200 throughout.
Stale trackeros PRs #49–52, #57 closed with
`--delete-branch` per the brief. New trackeros PRs from this
session (#58–#62) all closed automatically by the gate-
failure path or remain open under the blocked feature — not
worth closing individually until the Aider fix lands.

---
### Session 2026-06-07 — Claude Code (PLANNING_LAYER: autonomous feature decomposition + phased execution — new `@gestalt/agents-planning` package + migration 024 + first live end-to-end loop on trackeros)

Largest single-session build of the platform to date: a complete
new SDLC layer with three new agents, three new postgres tables,
new BullMQ queue, new server routes, and new CLI commands —
implemented strictly to ADR-042 (no LLM guidance prose in `.ts`).

What's new (capability):

- **Three planning agents** all extending `BaseLLMAgent` and
  reading config via the standard `loadAgentConfig` path:
  - **architecture-agent** — two entry points. `designFeature()`
    produces the high-level domain entities / modules / dependency
    map / recommended phase sequence. `designPhase()` produces
    the focused per-phase architecture (interface signatures,
    import paths, success criteria). Phased consultation matches
    ADR-049.
  - **planner-agent** — decomposes a feature into an ordered phase
    plan, bounded by `HARNESS.json.planner.maxPhasesPerFeature` +
    `maxFilesPerPhase`. Each phase is an Aider-ready brief.
  - **phase-evaluator-agent** — runs AFTER each phase deploys
    (or fails), produces a verdict (`success` / `partial` /
    `escalate`) and adjustments to remaining phases.
- **Planning orchestrator** (`@gestalt/agents-planning/dist/orchestrator/planning-orchestrator.js`)
  drains the new `gestalt-planning` BullMQ queue and handles
  three task types: `planning:start` (architecture → plan →
  PLAN.md commit → dispatch phase 0), `planning:phase` (clone →
  optional per-phase architecture pass → create generate:intent),
  and `planning:evaluate` (clone → phase-evaluator-agent → next
  phase OR mark feature completed/blocked).
- **Event-bus subscriber** in the planning worker bridges deploy
  back to planning without any coupling code in the deploy layer:
  it watches `intent.status-changed` events, looks up the phase
  row by intent id, and dispatches `planning:evaluate` on
  terminal status (`deployed` / `failed` / `escalated`).
- **`POST /features`, `GET /features`, `GET /features/:id`** routes
  with the same project-membership guards as `/intents`.
- **`gestalt feature submit/list/show`** CLI commands with a
  short-title default + plan-log rendering.

What's new (data + types):

- **Migration 024** (`024_features.sql`) — `features` (top-level
  feature row with `status`, `phase_count`, `current_phase`,
  `architecture`), `feature_phases` (one row per phase with
  `intent_id` reverse-lookup + `result` JSONB), `feature_plan_log`
  (append-only operator-visible event log). Three indexes,
  three CHECK constraints, FK CASCADE on `features.project_id`.
- **Type extensions** in `@gestalt/core`:
  - `AgentRole` gains `architecture-agent`, `planner-agent`,
    `phase-evaluator-agent`.
  - `TaskType` gains `planning:start`, `planning:phase`,
    `planning:evaluate`.
  - `HarnessAgentConfig` gains optional `phaseScopingRules?`,
    `evaluationCriteria?`, `architectureGuidance?` — same
    convention as `verificationGuidance` from TR_021.
  - `HarnessConfig` gains optional `planner` block (`enabled`,
    `maxPhasesPerFeature`, `maxFilesPerPhase`,
    `architectureReviewPerPhase`).
- **Repository surface** — new `FeatureRepository` interface in
  `@gestalt/core/repository` with 15 methods (CRUD across the
  three tables + reverse-lookup + log append). Postgres impl in
  `packages/adapters/postgres/src/repositories/features.ts`;
  Oracle + MSSQL throw-stubs added for interface-drift safety.
- **Queue** — `QUEUE_NAMES.planning = 'gestalt-planning'` +
  `resolveQueueName` updated.

What's new (template):

- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** —
  new `planner` block + new `agentConfig['architecture-agent']`,
  `agentConfig['planner-agent']`, `agentConfig['phase-evaluator-agent']`
  blocks carrying `rules` + the new field types
  (`architectureGuidance`, `phaseScopingRules`,
  `evaluationCriteria`).
- **`templates/corporate-ops-web-mobile/harness/agents.yaml`** —
  added three planning-agent entries with `prompt_extensions`
  carrying the project-specific design / planning / evaluation
  prose. Operators tune per project without touching `.ts`.
- **Template version 0.7.0 → 0.8.0** (`template.json`).

What was extended (existing code):

- **`renderHarnessAgentRules`** in `packages/core/src/agents/base-llm-agent.ts`
  rewritten to render five optional sub-sections in fixed order
  (Rules, Verification guidance, Phase scoping rules,
  Evaluation criteria, Architecture guidance). Existing
  callers (`constraint-agent`, `review-agent`, `code-prompt`)
  gain the new sections "for free" — no per-agent code change.
- **`buildHarnessAgentSection`** class method signature widened
  to match.
- **`packages/server/src/server.ts`** — calls `startPlanningWorker(config.queue)`
  after the maintenance scheduler. **`packages/server/src/app.ts`** —
  registers `/features` routes.
- **`packages/server/Dockerfile`** — adds the planning package
  to the workspace manifest copy + builder + production stages.

ADR-042 compliance (what stays in `.ts` vs what goes in
`HARNESS.json` + `agents.yaml`):

| Stays in `.ts` (platform mechanic) | Goes in `HARNESS.json` / `agents.yaml` (operator-tunable) |
|---|---|
| Role / goal framing skeleton | Role + goal text |
| JSON response schemas | All guidance prose |
| `renderHarnessAgentRules` helper | Rules + verification guidance |
| Loop logic + queue dispatch | Phase scoping examples |
| Git operations + PLAN.md writer | Evaluation criteria |
| Repository persistence | Architecture guidance |
| Parser-level evidence enforcement | (everything an operator might want to change) |

Architecture choice — the orchestrator hooks deploy → planning
via the in-process event bus rather than a queue dispatch from
the deploy layer. The deploy layer is fully unchanged: it
already emits `intent.status-changed` to the bus on every
status transition; the planning worker subscribes and decides
whether the event matches a phase intent. Zero coupling code
landed in `@gestalt/agents-deploy`.

Live verification — first end-to-end loop on trackeros:

- **Feature** `ea19b18e-e55d-4bf7-b0be-ce5f8d20b6aa` ("Add
  /version endpoint with test") submitted via
  `gestalt feature submit ... --project trackeros`.
- **`planning:start`** dispatched within milliseconds. Planning
  worker cloned trackeros, ran architecture-agent (~4s, 1 module
  + 1 recommended phase), ran planner-agent (~3s, 1 phase).
- **`PLAN.md` committed and pushed** to trackeros `main`
  (commit `6f2a500b`). Content:
  ```
  # PLAN.md — Add /version endpoint with test
  ## Modules
  - **version** (`src/modules/version/`) — owns: version.routes.ts, version.test.ts
  ## Phases
  ### Phase 1: Implement /version endpoint
  Create src/modules/version/version.controller.ts that exports
  getVersion() returning the version from package.json. Create
  version.routes.ts to define the /version endpoint. Include a
  Jest unit test in tests/unit/version.test.ts.
  ```
- **`docs/ARCHITECTURE.md` appended** with the architecture-agent's
  `architectureMdUpdate` ("Version Endpoint" section).
- **Phase 1 intent** `e00e993c-...` created with status `pending`
  → `generating`. Generate ran (intent → design → context →
  code), pr-agent opened **PR #57**, pipeline-agent triggered
  CI run `27101236260`.
- **CI failed** because Aider's generated `version.controller.ts`
  used `require('../../../package.json')` without `resolveJsonModule`
  in tsconfig. Self-healing dispatched a retry (regenerate +
  push to the same branch); CI failed identically. Intent
  transitioned to `failed`.
- **Event-bus subscriber fired** — `intent.status-changed` with
  `status=failed` matched phase `7847f...`; `planning:evaluate`
  dispatched.
- **Phase marked `failed`, feature marked `blocked`**, plan log
  appended with `phase-failed` event. End-to-end loop confirmed.

The CI failure is pre-existing code-agent / Aider behaviour
(TR_022 / TR_023 will address it) — not a planning bug. The
planning loop did exactly what it was supposed to do.

Decisions made:

- **Event bus, not deploy-layer dispatch**, for the deploy →
  planning callback. Keeps the deploy layer completely unaware
  of the planning layer.
- **Failed phase = blocked feature, no retry**. The phase-evaluator-
  agent is consulted only when the intent deploys successfully;
  on failure the orchestrator marks the phase failed without
  asking the LLM. Future iteration could add a per-feature
  retry budget that the evaluator decides — captured as a
  follow-up.
- **Per-phase architecture pass disabled for trackeros**
  (`architectureReviewPerPhase: false`). The feature-level
  architecture suffices for trackeros's 1-phase scope; the
  second architecture-agent entry point is exercised when
  operators opt in.
- **Scope adjustments stored under `feature_phases.result.pendingScopeAdjustment`**
  rather than overwriting `feature_phases.scope`. Keeps the
  original plan visible to operators; the next `planning:phase`
  reads the adjustment when assembling the intent text.

Pending follow-ups (NEW from PLANNING_LAYER):

- **(MEDIUM)** Phase failure → feature blocked is too eager.
  Add a per-feature retry budget so a single CI failure doesn't
  block the whole plan. Could be HARNESS-tunable
  (`planner.maxPhaseRetries`).
- **(LOW)** Per-phase architecture pass not yet live-verified.
  Flip `architectureReviewPerPhase: true` on a fresh trackeros
  feature to confirm the second `architecture-agent` entry
  point assembles the prompt correctly.
- **(LOW)** `feature_plan_log` is append-only. A `gestalt feature
  log <id>` CLI subcommand would let operators tail it without
  the JSON shell of `gestalt feature show`.

Carryover follow-ups (status updates):

- **(NEW — code-agent issue surfaced by planning)** Aider's
  generated TypeScript uses `require('package.json')` without
  the project's tsconfig allowing it. Either (a) scaffold
  `resolveJsonModule: true` + `esModuleInterop: true` in
  `gestalt init`, or (b) extend code-agent's prompt with an
  "Aider tips for TypeScript" section.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json. Would catch this CI failure pre-emit.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend capture
  in `agent_executions.tokens_used`.

Build status: `pnpm -r build` clean across all 13 packages
(adds `@gestalt/agents-planning`). Docker image rebuilt with
the new package wired into the multi-stage build. Migration
024 applied at boot. `gestalt-planning` BullMQ queue worker
started. Server `/health` 200 throughout. Template
auto-refreshed at boot: `version: "0.8.0"`. trackeros `main`
updated with two commits: `3fc936fe` (HARNESS.json planner +
planning agentConfig) and `6f2a500b` (PLAN.md +
docs/ARCHITECTURE.md from feature `ea19b18e`).

---
### Session 2026-06-07 — Claude Code (ADRs 042–049: codify platform/operator split + Aider backend + gate model policy + evidence requirement + LLM-driven script verification + CI-owns-runtime + LLM-driven retry routing + phased architecture)

Documentation-only session. Eight ADRs added to `docs/DECISIONS.md`
codifying principles either learned through TR_007 → TR_021 or that
govern the upcoming planning-feature implementation. No platform
code change; no migrations.

What was added:

- **ADR-042** — LLM prompt content belongs in HARNESS.json +
  agents.yaml, not in TypeScript files. Codifies TR_021's refactor
  as a permanent rule. Stays in `.ts`: schemas, framing, evidence
  enforcement, parsing, severity caps. Goes in `agents.yaml`: role
  / goal / prompt_extensions / domain guidance. Goes in
  `HARNESS.json agentConfig`: rules + verificationGuidance +
  project-specific hints. Code reviews must reject `.ts` PRs that
  add LLM guidance prose.
- **ADR-043** — Aider as opt-in code generation backend. Enabled
  per-project via `HARNESS.json codeGeneration.backend: "aider"`.
  The Aider message stays minimal — task, rules, architecture
  context only. HOW to implement is Aider's call. Custom
  code-agent retained as default for non-opt-in projects.
- **ADR-044** — Gate agents require gpt-4o; code generation uses
  gpt-4o-mini. Codifies TR_015 + TR_016 finding: gpt-4o-mini
  cannot follow rules that contradict its training bias (8 rounds
  flagging `pool.query()` in `*.repository.ts` despite explicit
  "this is CORRECT" rule). gpt-4o for the gate (small call
  volume); gpt-4o-mini for Aider's tool loop (200k TPM ceiling).
- **ADR-045** — Evidence requirement for all finding-emitting
  agents. Every finding must include `quotedLine` with the exact
  code quoted verbatim. Findings without `quotedLine` are dropped
  by `dropUnevidencedFindings()` before reaching the gate verdict.
  Eliminates hallucinated findings structurally, not via prompt
  engineering.
- **ADR-046** — LLM-driven script execution for gate verification.
  No hardcoded script commands in platform `.ts` files. LLM
  decides what to run based on project language / stack /
  finding. `HARNESS.json agentConfig.verificationGuidance` gives
  hints; the LLM picks the approach. Platform-level blocklist on
  destructive operations (rm -rf, git push, git commit, sudo,
  curl | bash) is never configurable.
- **ADR-047** — CI/CD owns runtime verification; Gestalt gate
  owns architectural review. Extends ADR-041. lint-agent /
  security-agent / test-runner-agent removed permanently. CI runs
  the project's own ESLint / Jest / Semgrep — more accurate than
  platform stubs. Re-adding those agents to the gate is
  explicitly prohibited.
- **ADR-048** — Self-healing uses LLM-driven retry routing, not
  hardcoded dispatch maps. `SelfHealingDiagnosis.retryTaskType`
  is the authoritative dispatch decision. The LLM understands
  failure semantics (git non-fast-forward → deploy-layer, TS
  compile error → generate-layer) without per-case programming.
  Unknown failures fall through to `generate:intent`.
- **ADR-049** — Architecture agent uses phased consultation, not
  single-call full design. Two modes: `designFeature()` (high-level
  — domain entities, module list, phase sequence, no impl detail)
  and `designPhase()` (focused — interface signatures, import
  paths, SQL schema, measurable success criteria; receives prior
  phases' actual code as context). High-level design committed to
  `ARCHITECTURE.md` before any code generation. Future CrewAI
  migration becomes an architecture crew (chief / data / app
  architect) on the same two-mode pattern.

Commits:

- `013e49f` — ADR-042 (committed and pushed earlier in session)
- `<TBD>` — ADRs 043–049 + RECENT.md / STATE.md / BUILD.md /
  SUMMARY.md regeneration (this commit)

Decisions made:

- **Ordered ADRs 042–049 by the principle they govern**, not
  chronologically by when the lesson was learned. ADR-042 (the
  split itself) leads because it defines the framework the others
  live within.
- **Did not change platform code.** The ADRs codify behaviour
  that's already deployed (or that governs the planning feature
  about to be built); they're a contract, not a refactor. Future
  PRs that violate any ADR must justify the deviation in their
  own ADR amendment.
- **No new follow-ups added.** Every ADR points at code that
  already exists or at the planning feature about to be built.

Build status: no platform code change. `pnpm -r build` not
re-run. Docker image untouched. No new migrations. TR_019 session
rotated to `sessions/archive/2026-06-w1.md` to keep RECENT.md
under the 3-session / 40 KB ceiling.


---
