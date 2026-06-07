# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

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
### Session 2026-06-07 — Claude Code (TR_021: externalise verificationGuidance from gate-agent .ts → HARNESS.json — refactor only, two clean deploys back-to-back)

Pure refactor session. The brief: lift the project-specific
"HOW to verify findings" guidance out of the platform's gate-agent
TypeScript files into HARNESS.json's
`agentConfig[role].verificationGuidance`. Platform mechanics stay
in code; domain hints become configurable per project. No
behaviour change expected; no new migrations.

What changed (code):

- **`packages/core/src/harness/index.ts`** — `HarnessAgentConfig`
  gains optional `verificationGuidance?: string[]`. Doc comment
  explains the split: rules = WHAT to enforce; verificationGuidance
  = HOW to verify before flagging. Platform mechanics (evidence
  requirement, severity ceiling, JSON schema, parser-level
  `dropUnevidencedFindings`, `ABSOLUTE_MAX_RETRIES`) stay in code.
- **`packages/core/src/agents/base-llm-agent.ts`** —
  `renderHarnessAgentRules` rewritten. Now emits a single
  `## Agent configuration (from HARNESS.json)` header with two
  sub-sections: `### Rules you must enforce` (from `.rules[]`)
  and `### Verification guidance for this project` (from
  `.verificationGuidance[]`). Empty when both are absent. Class
  wrapper `buildHarnessAgentSection` signature widened to the
  new agentCfg shape. Same call-site contract — every existing
  caller (`code-prompt.ts`, `constraint-agent.ts`,
  `llm-review-agent.ts`) gets verificationGuidance for free.
- **`packages/agents/quality-gate/src/agents/llm-review-agent.ts`** —
  the hardcoded `verificationGuidance` const (TR_020's STEP 1-5
  MANDATORY SEQUENCE: trust-CI, searchFiles for DB access,
  readFile package.json, architecture-only reasoning, scope
  filter) deleted entirely (~70 lines). Its `${verificationGuidance}`
  reference removed from the final prompt template literal.
  `loadFullHarness` + `buildReviewPrompt` parameter types widened
  to include `verificationGuidance`. Doc comment block above
  `harnessRulesSection` rewritten to capture the TR_007 → TR_011
  → TR_012 → TR_020 → TR_021 history (rules-only → STEP protocol
  → trust-CI → HARNESS.json).
- **`packages/agents/quality-gate/src/agents/constraint-agent.ts`** —
  zero code changes. The agent already calls
  `this.buildHarnessAgentSection(harnessConfig)`, which now
  automatically renders both rules + verificationGuidance from
  the updated helper. Project-specific guidance lands in the
  prompt without touching constraint-agent's prompt builder.

Templates + trackeros HARNESS.json:

- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** —
  new `verificationGuidance` arrays on `agentConfig['constraint-agent']`
  (4 hints: DB-access via searchFiles, import-resolution via
  `tsc --noEmit`, missing-dependency via package.json read,
  console.log via searchFiles with entry-point exclusion) and
  `agentConfig['review-agent']` (5 hints: trust-CI, DB-access
  via searchFiles, missing-dependency via package.json,
  evidenceless-finding downgrade, IntentSpec.outOfScope filter).
- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.6.0` → `0.7.0`. Boot log confirmed refresh
  ("Refreshed built-in template (version bump), version: 0.7.0").
- **`/Users/amrmohamed/Work/trackeros/HARNESS.json`** — same
  `verificationGuidance` arrays added to constraint-agent +
  review-agent blocks. Operator commit `13223d29` on trackeros
  `main` (rebased onto upstream `3d3f8570`).

Live verification — two trackeros cycles back-to-back:

| Cycle | Intent | PR | Result | Wall-clock |
|---|---|---|---|---|
| Pre-commit | "Add a /ready endpoint..." (715567ff-…) | [#55](https://github.com/afarahat-lab/trackeros/pull/55) | ✓ deployed, single round, attempt_count=0 | ~80s |
| Post-commit | "Add a /alive endpoint..." (87aec19c-…) | [#56](https://github.com/afarahat-lab/trackeros/pull/56) | ✓ deployed, single round, attempt_count=0 | ~80s |

Cycle 1 cloned the pre-TR_021 trackeros HARNESS.json (still missing
verificationGuidance). Gate passed cleanly anyway — confirms the
"no behaviour change" guarantee: removing the platform's hardcoded
verificationGuidance does NOT degrade the gate on projects that
have not yet added the HARNESS.json entries. (Cycle 1 had
trackeros's existing `agents.yaml` review-agent `prompt_extensions`
with the trust-CI rule, which carries the most important
hallucination-prevention hint regardless of where it lives.)

Cycle 2 cloned the post-TR_021 trackeros HARNESS.json with the new
verificationGuidance arrays. Direct prompt inspection confirms
both agents now render the new section:

- **review-agent prompt** — `grep "Verification guidance for this
  project"` → 1 hit; `grep "Trust CI for build correctness"` → 1
  hit. The TR_020 STEP 1-5 protocol content is back in the prompt,
  now sourced from HARNESS.json instead of `.ts`.
- **constraint-agent prompt** — `grep "Verification guidance for
  this project"` → 1 hit. Four bullets (DB-access / import /
  dependency / console.log) all present. constraint-agent
  gained the configurable verificationGuidance section "for free"
  via the shared helper, no .ts edit.

Per-agent stats for cycle 2 (intent 87aec19c-…):

| agent_role | runs | tokens | duration_ms |
|---|---:|---:|---:|
| review-agent | 1 | 10,968 | 3,228 |
| constraint-agent | 1 | 6,375 | 3,967 |
| code-agent (Aider) | 1 | 0 (TR_014 follow-up) | 5,112 |
| pr-agent | 1 | — | 13,093 |
| pipeline-agent | 1 | — | 35,825 |
| promotion-agent | 2 | — | 5,893 (staging + production) |

Token delta vs TR_020 cycle 2 (the same prompt content but
hardcoded in .ts): review-agent ~+1.5k tokens (10,968 vs 9,428 on
TR_020), constraint-agent ~+1.1k tokens (6,375 vs 5,272). Small
overhead from the markdown-header noise around the new
sub-section + slight prompt-content variance round to round. No
hit on cycle time.

Decisions made:

- **Kept the platform's `severityLimitsSection` in code.** The
  brief explicitly listed "severity cap" as a non-negotiable
  platform mechanic. It's enforced both in prompt and in
  `mapItemsToSignals` post-LLM downgrade — both stay.
- **Kept the platform's `EVIDENCE_REQUIREMENT_SECTION` in code.**
  Same — explicitly listed as platform-mechanic. The
  parser-level `dropUnevidencedFindings` enforcement is
  redundant-by-design (belt + braces). Both stay.
- **constraint-agent's prompt builder unchanged.** Already used
  the shared helper. The HARNESS.json entries flow through
  automatically with no code change.
- **Pushed trackeros HARNESS.json edit directly to `main`** (one
  commit, additive only, low blast radius). This is the same
  pattern TR_019/TR_020 used for trackeros operator fixes.
- **Did NOT delete the trust-CI prompt extension from trackeros's
  `agents.yaml` review-agent override** even though the same
  guidance now lives in HARNESS.json's verificationGuidance.
  The redundancy is intentional — operators can grep either
  location to discover the rule, and the harness owner may
  rotate one without intending to drop the other.

Pending follow-ups (NEW from TR_021):

- **(LOW)** Consider migrating the `consistencySection`
  (cross-artifact checks: test-framework match, import
  resolution, @types/* coverage, test-file placement) to
  HARNESS.json verificationGuidance too. Currently still
  hardcoded in `buildReviewPrompt`. It's borderline
  platform-mechanic / project-specific — works fine where it
  is, but a future test-framework-agnostic project might want
  to tune the rules.

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend capture
  in `agent_executions.tokens_used`.
- **(STILL OPEN — MEDIUM)** TR_019: `gestalt init` scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest with TS.
- **(STILL OPEN — LOW)** TR_019: template `{{ciSetupSteps}}`
  for Node/npm should add `--legacy-peer-deps`.
- **(STILL OPEN — LOW)** TR_019: add `tsc --noEmit` sanity check
  on scaffolded tests in `gestalt init`.
- **(STILL OPEN — LOW)** TR_020: extend the "trust CI" rule to
  constraint-agent's verificationGuidance. — **Now done in
  this session** as part of the migration: the constraint-agent
  doesn't include the trust-CI bullet today (it has its own
  executeScript pattern), but the HARNESS.json structure now
  makes adding it a one-line edit.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted once; `/health` 200
throughout. Built-in template auto-refreshed at boot (0.6.0 →
0.7.0). No test report needed — this is a refactor with the
same observable behaviour as TR_020. trackeros commit
`13223d29` pushed to `main`. Two trackeros PRs (#55 + #56) both
squash-merged via auto-merge.


---
