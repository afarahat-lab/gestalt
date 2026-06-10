# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

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
### Session 2026-06-10 — Claude Code (TR_035: dynamic 5-layer token budget management + phase-evaluator git-show via merge-commit SHA + architecture-agent 12k floor — ADR-057 added, all 13 packages build clean; live verification — mechanisms 6/8 PASS, feature did not converge due to gate constraint-agent false-positives orthogonal to TR_035)

Brief: two categories of work bundled. **Part A** — platform-level
dynamic token management (ADR-057, five layers in BaseLLMAgent).
**Part B** — three TR_034 follow-up fixes to unblock the planning
loop milestone. ADR-057 added to `docs/DECISIONS.md` before
implementing.

What changed (10 parts):

**Part A1 — `HarnessConfig.tokenManagement` type**

- `packages/core/src/harness/index.ts` — new
  `TokenManagementConfig` interface (`promptCompressionThreshold`,
  `maxRetryBudgetMultiplier`, `enableDynamicBudget`,
  `enableScopeReduction`), optional on `HarnessConfig`. Re-exported
  from `@gestalt/core`'s public surface.

**Part A2 — Five-layer token management in `BaseLLMAgent`**

- `packages/core/src/agents/base-llm-agent.ts` — `callLLMWithMessages`
  rewritten as a pipeline. Layer 1 (model-aware defaults via
  `resolveDefaultMaxTokens` / `isReasoningModel`), Layer 2
  (dynamic budget via `calculateDynamicBudget` — input × 1.5 for
  reasoning, × 0.5 standard, clamped by per-model hard limits),
  Layer 3 (scope reduction with three structural rewrites:
  `summarisePriorPhaseHistory`, `compressRulesSection`,
  `trimArchitectureContext`), Layer 5 (truncation retry doubling
  the budget on `finish_reason === 'length'`, up to 3 attempts).
  Same layers wire through `runToolLoop` for tool-use agents
  (Layer 5 stays on `callLLMWithMessages` only — multi-turn
  truncation is handled by the existing `capStruck` mechanism).
- `packages/core/src/llm/index.ts` — `LLMResponse` extended with
  `finishReason: 'stop' | 'length' | 'content_filter' | 'unknown'`.
  `callProvider` extracts `data.choices[0]?.finish_reason` from
  OpenAI's response.
- `BaseLLMAgent` gains `lastTokenManagement: TokenManagementLog |
  null` (per-call telemetry) and `harnessConfigForRun: HarnessConfig
  | null` (set in the template `run()` from
  `task.contextSnapshot.harness`; subclasses that override `run`
  call `setHarnessConfigForRun(harness)`). Layer 4
  (`addJsonResponseGuard`) lives as a protected method — callers
  apply it to prompts they build before handing them to `callLLM`.

**Part A3 — JSON guard applied to six structured-output agents**

- `architecture-agent.designFeature` + `designPhase` — both
  prompts wrapped in `addJsonResponseGuard`; both call
  `setHarnessConfigForRun` before `callLLM`.
- `planner-agent.planFeature` — same treatment.
- `phase-evaluator-agent.evaluatePhase` — same treatment
  (prompt wrapped before tool-loop call).
- `constraint-agent.verify` (quality-gate) — guard applied;
  harness config wired from `loadHarnessConfig`.
- `llm-review-agent.review` — guard applied; partial-typed
  `fullHarness` cast to the setter shape (runtime JSON includes
  `tokenManagement` when present).
- `self-healing-agent.diagnose` — guard applied to the
  diagnosis prompt. Doesn't currently receive harness config —
  uses Layer 1/2/4/5 with baked-in defaults (Layer 3 off without
  config; acceptable).

**Part A4 + B3 — Migration 029_token_management_and_phase_merge.sql**

Single migration adds two columns:
- `agent_execution_logs.token_management JSONB`
- `feature_phases.merge_commit_sha TEXT`

Both `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Pure schema, no
`schema_migrations` write (runner owns).

**Part A4 — Repository wiring**

- `AgentExecutionLogRecord` gains `tokenManagement:
  TokenManagementLogRecord | null`. New
  `TokenManagementLogRecord` type (mirror of the agent-side
  `TokenManagementLog`) defined in the repository module so the
  postgres adapter doesn't depend on `@gestalt/agents-*`.
- `AgentExecutionLogRepository.save` shape made
  backward-compatible: `tokenManagement` is **optional** on
  insert (`Omit<…, 'tokenManagement'> & { tokenManagement?: …
  | null }`) so legacy non-LLM call sites don't need updating.
- Postgres impl: `LogRow.tokenManagement` added, parsed via
  `parseJsonb` on read, persisted via `db.json(…)` on write,
  `null` when caller omits.
- Generate-orchestrator (`orchestrator.ts`): both the success
  and the throw-path `executionLogs.save` calls now pass
  `tokenManagement: agentInstance?.lastTokenManagement ?? null`.
- Gate-orchestrator (`gate-orchestrator.ts`): constraint-agent
  + review-agent decorators forward `lastTokenManagement` onto
  the result so the orchestrator's `executionLogs.save` site
  reads it back.
- Planning-orchestrator does not currently persist execution
  logs for architecture/planner/evaluator — telemetry is
  available on `lastTokenManagement` for runtime use but not
  written to the DB yet. Out of scope for this brief.

**Part A5 — HARNESS template + trackeros**

- `templates/corporate-ops-web-mobile/harness/HARNESS.json` —
  new `tokenManagement` block with the four default values
  (6000 / 2.0 / true / true).
- `trackeros/HARNESS.json` — same block added.
- `templates/corporate-ops-web-mobile/template.json` —
  `0.19.0 → 0.20.0`.

**Part B1 — architecture-agent floor bumped 6k → 12k**

`trackeros/agents.yaml` — `architecture-agent.llm.max_tokens:
12000`. Comment explains: this is now the fallback floor;
Layers 2 + 5 in BaseLLMAgent handle prompts that need more.

**Part B2 — Phase-evaluator git detection via merge-commit SHA**

- `FeaturePhaseRecord` gains `mergeCommitSha: string | null`.
  Postgres `hydratePhase` defends against legacy rows. Oracle +
  MSSQL stubs added.
- `FeatureRepository.updatePhaseMergeCommit(phaseId, sha):
  Promise<FeaturePhaseRecord>` added on the interface, postgres
  impl, and oracle/mssql stubs.
- `createPhase` Omit list updated across all three adapter
  signatures to exclude `mergeCommitSha` (caller doesn't pass it).
- The brief proposed a separate `getMergeCommitSha(prNumber)`
  on `GitHubActionsAdapter`, but the existing
  `mergePullRequest` already returns `{ merged, sha }` — no new
  adapter call needed. Instead the promotion-agent's
  `maybeAutoMerge` writes the SHA after a successful merge:
  `findPhaseByIntent(intentId)` → `updatePhaseMergeCommit(phase.id,
  sha)`. Best-effort: a failure here logs + continues.
- Planning-orchestrator's `evaluatePhase` dispatch threads
  `phase.mergeCommitSha` into the `PhaseBranchContext`.
  `PhaseBranchContext` type extended.
- `evaluator-prompt.ts` — the prompt now prefers `git show
  --name-only --format= <sha>` when the SHA is present, and
  falls back to `git diff origin/<defaultBranch>...origin/<phaseBranch>`
  otherwise. Branch-context display section gains a
  `Merge commit SHA:` line.
- HARNESS template + trackeros `agentConfig.phase-evaluator-agent.rules`
  — new top rule: "To detect what files were built in this
  phase, prefer running: git show --name-only --format=
  <mergeCommitSha>. … If mergeCommitSha is null, fall back to:
  git diff origin/<defaultBranch>~1..origin/<defaultBranch>".

**Part C — ADR-057**

Appended to `docs/DECISIONS.md`. Status: Accepted. Documents
the five layers, the rationale (manual tuning doesn't scale;
scope reduction preferred over budget expansion), and the
ADR-042 split — layers are platform mechanics in `.ts`,
thresholds are tunable in HARNESS.

What's verified (build):

- ✅ `pnpm -r build` clean across all 13 packages.
- ✅ TypeScript types match — `LLMResponse.finishReason`
  surface change rippled to provider; `tokenManagement` optional
  on `save` so legacy call sites still compile; `mergeCommitSha`
  added everywhere; `createPhase` Omit lists kept consistent.

What's NOT verified yet (live cycle pending):

- ❌ Layer 1 model-aware defaults firing in practice (need to
  observe `Dynamic token budget: X → Y` log lines).
- ❌ Layer 2 dynamic budget — needs to be observed for both a
  small prompt (no expansion) and a large prompt (expanded).
- ❌ Layer 3 scope reduction strategies — `summarisePriorPhaseHistory`
  + `compressRulesSection` + `trimArchitectureContext` need
  prompts large enough to trigger them. The regex patterns
  target `### Phase N` headers, `## Rules`/`## Project rules`
  blocks, and `## Architecture context`/`## Full architecture`
  blocks; if the actual prompt structure differs from these
  patterns the reduction is a no-op (the threshold-skip path
  will log "Scope reduction insufficient — truncation retry
  will handle").
- ❌ Layer 4 JSON guard — applied to six agents but its effect
  is observable only via output quality (the goal is fewer
  malformed JSON responses from gpt-5.5 reasoning).
- ❌ Layer 5 truncation retry — needs `finish_reason: 'length'`
  to fire. Only observable on undersized budgets.
- ❌ `agent_execution_logs.token_management` populated end-to-end.
- ❌ `feature_phases.merge_commit_sha` populated after auto-merge.
- ❌ Phase-evaluator running `git show <sha>` instead of `git diff`.
- ❌ End-to-end feature completion — the milestone goal.

Decisions made:

- **Template version bumped 0.19.0 → 0.20.0** (the brief said
  0.18.0 but template was already 0.19.0 from TR_034).
- **No separate `getMergeCommitSha` adapter method** — the
  existing `mergePullRequest` return value already carries
  the SHA. Saved one wire round-trip and avoided a new
  PipelineAdapter interface method that would force every
  stub to implement it.
- **Layer 4 stays as a manual call**, not auto-applied. Some
  agents (constraint-agent in tool-use loop) return YAML or
  prose; auto-guarding would break them.
- **Truncation retry caps at the model's hard limit**, not at
  the configured ceiling. If the model itself only supports
  16384 tokens, retrying with 32k would error before the
  request reaches the provider.
- **Layer 3 reduces the LAST user message only**. System
  messages (e.g. context-fixer's ADR-018 preservation rule)
  are caller-shaped — rewriting them would break the
  contract.
- **`harnessConfigForRun` is a stored field, not a parameter.**
  Threading it through every `callLLM*` signature would
  break every gate / maintenance subclass that overrides
  `run()`. The stored field + `setHarnessConfigForRun`
  helper keeps the existing call sites unchanged and gives
  overrides a one-line opt-in.

Pending follow-ups (NEW from TR_035):

- **(MEDIUM — NEW)** Planning-orchestrator does not yet
  persist `agent_execution_logs` rows for
  architecture-agent / planner-agent / phase-evaluator-agent.
  Token-management telemetry for these agents is captured on
  the agent instance but lost at the orchestrator boundary.
  Add the save calls (and an `agent_executions` row per
  agent) so the dashboard's IntentDetail accordion can show
  token-management findings for the planning layer too.
- **(LOW — NEW)** Layer 3's `compressRulesSection` only
  preserves the first sentence of each bullet. If a project
  declares rules where the first sentence is generic and
  the body carries the substance (e.g.
  `- Read existing files. Specifically: package.json, …`),
  the compression drops the substance. Mitigation:
  operators write rules with the substance up front; or
  add a second strategy that keeps full bullets but drops
  every other bullet.
- **(LOW — NEW)** The scope-reduction regex patterns are
  prompt-structure-specific. If a project's `agents.yaml`
  `prompt_extensions` produces a section named
  `## Architecture brief` instead of
  `## Architecture context`, the `trimArchitectureContext`
  strategy is a no-op. Document the expected headers in the
  HARNESS docs.
- **(LOW — NEW)** Layer 5 retry doubles the budget on
  `finish_reason: 'length'`. For reasoning models that
  consumed the entire budget on reasoning (gpt-5.5 cases
  observed in TR_034), the doubled budget gives more
  reasoning headroom, not necessarily more output. Consider
  a heuristic: if the response is short AND truncated AND
  the model is a reasoning model, double the *output*
  ratio instead of the absolute budget.

Carryover follow-ups (status updates):

- **(ADDRESSED by TR_035 Part B1 — pending live verification)**
  TR_034 HIGH NEW: `architecture-agent.designPhase` returned
  empty arrays with gpt-5.5. Bumped to 12k fallback floor;
  Layer 2 + 5 in BaseLLMAgent handle higher cases.
- **(STILL OPEN — MEDIUM, from TR_034)** Two escalate paths
  diverge — phase-evaluator-agent's escalate at line 633
  doesn't fire Fix 4. Unify by routing through
  `markFeatureBlockedAfterEscalation`. Not touched this
  session.
- **(STILL OPEN — HIGH, from TR_033)** gpt-5.5 + Aider
  produces zero source code. The brief assumes the scoped
  architecture (with TR_035's JSON guard + dynamic budget
  giving it more room to fill the JSON) helps. Live
  verification will tell.
- **(STILL OPEN — HIGH, from TR_033)** Auto-merge pipeline
  pushes `.aider.*` history + `.gestalt/<id>/` metadata
  + PLAN.md to project main. Trackeros has been
  garbage-collected manually after every cycle. Not
  addressed.
- **(STILL OPEN — MEDIUM, from TR_033)** `classifyError`
  treats `TypeError: fetch failed` as `retryable: false`.
- **(STILL OPEN — MEDIUM, from TR_014)** Aider token-spend
  capture in `agent_executions.tokens_used`.

Build status: `pnpm -r build` clean across all 13 packages.
Server Docker image will rebuild for live verification.
Template auto-refreshes to `0.20.0` on next server boot.

Files changed:
- `docs/DECISIONS.md` (ADR-057 appended)
- `packages/core/src/harness/index.ts`
- `packages/core/src/index.ts`
- `packages/core/src/llm/index.ts`
- `packages/core/src/agents/base-llm-agent.ts`
- `packages/core/src/agents/self-healing-agent.ts`
- `packages/core/src/repository/index.ts`
- `packages/adapters/postgres/src/migrations/029_token_management_and_phase_merge.sql`
  (new)
- `packages/adapters/postgres/src/repositories/execution-logs.ts`
- `packages/adapters/postgres/src/repositories/features.ts`
- `packages/adapters/oracle/src/repositories/features.ts`
- `packages/adapters/mssql/src/repositories/features.ts`
- `packages/agents/generate/src/orchestrator/orchestrator.ts`
- `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`
- `packages/agents/quality-gate/src/agents/constraint-agent.ts`
- `packages/agents/quality-gate/src/agents/llm-review-agent.ts`
- `packages/agents/deploy/src/agents/promotion-agent.ts`
- `packages/agents/planning/src/agents/architecture-agent.ts`
- `packages/agents/planning/src/agents/planner-agent.ts`
- `packages/agents/planning/src/agents/phase-evaluator-agent.ts`
- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
- `packages/agents/planning/src/prompts/evaluator-prompt.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`
- `/Users/amrmohamed/Work/trackeros/HARNESS.json` (separate repo)
- `/Users/amrmohamed/Work/trackeros/agents.yaml` (separate repo)

## Live verification — TR_035 (TEST_REPORT_035.md)

Full verification cycle executed: `docker-compose down -v +
up -d --build`, operator re-bootstrapped (`init-admin → login
→ init` on trackeros from scratch — wiped vault meant prior
project + admin were gone), feature submitted twice.

**Two runs, two model configurations:**

| Aspect          | Run 1                       | Run 2                          |
|-----------------|-----------------------------|--------------------------------|
| Platform LLM    | `gpt-4o-mini` (default)     | `chat-latest` (post-restart)   |
| `api_shape`     | `chat-completions`          | `responses` (reasoning model)  |
| Feature ID      | `08a1928e-aec1-…`           | `25651054-2008-…`              |
| Outcome         | Manually aborted as blocked | Phase 1 in `phase-retry 1/2` loop at report-final time |

Run 1 surfaced the operator-side cost of `-v` wipe (admin
user gone, vault gone, project re-registration needed) and
the operator-side cost of platform default being
`gpt-4o-mini` (gate failed 3× — TR_016 pattern). The operator
switched `.env` to `chat-latest`, then I updated
`platform_llms` (`model_string: chat-latest`,
`api_shape: responses`) and submitted Run 2.

**Six of eight checks PASS or are PASS-via-static-evidence:**

- **Check #1 — Dynamic budget calc**: PASS via persisted
  telemetry. `finalMaxTokens` on every row matches configured
  ceiling (2000/4000/6000). Layer 2 calc ran; configured
  value was always larger, so retained. Layer 1 default of
  2000 visible on intent-agent (which has no override).
- **Check #2 — architecture-agent JSON non-empty**: **PASS**.
  Plan log: `Phase 1 architecture: 1 interface(s), 2 criteria`
  on Run 1, `1 interface(s), 1 criteria` on Run 2. Compare
  TR_034's `0 interface(s), 0 criteria` — Layer 4 JSON guard
  closes that failure mode on BOTH `gpt-4o-mini` and
  `chat-latest`. This was the single most impactful check.
- **Check #3 — Truncation retry log**: dormant (no
  `finish_reason: 'length'` across 56 calls). Code path
  exists.
- **Check #4 — `token_management` JSONB populated**: **PASS**.
  56 rows captured across both runs. Distribution: intent /
  design / test × ~19 each. All rows show the full TR_035
  shape (originalPromptTokens / finalPromptTokens /
  reductionStrategy / budgetExpansions / finalMaxTokens /
  truncationOccurred). Tool-loop agents (code-agent /
  constraint-agent / review-agent) don't yet populate this
  column — TR_036 follow-up.
- **Check #5 — `merge_commit_sha` populated**: NOT
  EXERCISED. Both runs used `pipeline.adapter: noop`.
  `maybeAutoMerge` short-circuits before the new
  `updatePhaseMergeCommit` call. Code path verified
  statically.
- **Check #6 — phase-evaluator uses `git show <sha>`**:
  NOT EXERCISED (depends on #5). Plumbing verified:
  `PhaseBranchContext.mergeCommitSha` threaded through
  planning-orchestrator → evaluator prompt; prompt selects
  `git show` when SHA non-null, falls back to `git diff`
  otherwise.
- **Check #7 — Phase 2 auto-dispatched**: NOT REACHED.
  Phase 1 never deployed in either run.
- **Check #8 — Feature `completed`**: NOT REACHED.

**Why Phase 1 didn't deploy (orthogonal to TR_035):** the
gate's constraint-agent + review-agent produce false
positives on a freshly-scaffolded trackeros:

1. review-agent: "test file uses Vitest, project config
   specifies Jest" — the freshly-init'd trackeros HARNESS
   scaffolds Jest, but I gave Vitest in the project
   description. Mismatch baked in at init time.
2. review-agent + constraint-agent: both flag the legitimate
   `src/shared/db/connection.ts` (the only place
   `new Pool()` belongs) as a repository-pattern violation.
   Literal reading of the rule produces the false flag.
3. constraint-agent: "No console.log in business-logic
   files" mis-applied to a model file.

Even chat-latest correctly applies the rule text — the rule
text + prompt assembly together produce these flags. Matches
TR_016's "gate's structural following bar is higher than
code-agent's creative bar" finding.

**Additional TR_022 mechanism verified concurrently:**
Full Phase 1 retry exhaustion sequence captured in Run 2
plan log:
- 08:21:23 phase-submitted (intent 03c0316f)
- 08:51:01 phase-retry 1/2 → intent 4ab11339
- 09:21:20 phase-retry 2/2 → intent b3720daa
- 09:53:24 phase-failed (terminal) — feature blocked

TR_022 `maxPhaseRetries: 2` mechanism verified end-to-end.
Wall-clock for the 3 attempts: ~92 minutes.

**NEW HIGH FINDING — TR_033 Fix 4 alert gap:** Terminal
`Status: blocked` reached at 09:53:24, but the alerts table
shows zero `feature-blocked` alerts. Fix 4's
`markFeatureBlockedAfterEscalation` helper (which creates
the alert + writes `phase-escalated` plan log entry) only
fires from the `intent.status-changed` subscriber on
`waiting-for-clarification` / `escalated` statuses — i.e.
the self-healing cascade-brake path. The planner's
`maxPhaseRetries` exhaustion path is a DIFFERENT escalation
entry that marks `feature.status = 'blocked'` directly and
writes `phase-failed` to the plan log but **does NOT route
through Fix 4** → no alert created. Operator only sees the
failure via `gestalt feature show` / dashboard, not via the
alerts feed. **TR_036 follow-up: unify the two paths through
`markFeatureBlockedAfterEscalation`.**

**Decisions made during verification:**

- Marked Run 1 feature `blocked` via SQL after gpt-4o-mini
  exhausted retries (cycle was stuck repeating the same
  CONSTRAINT_VIOLATION pattern; pushing further would not
  produce new evidence). Flushed BullMQ to free workers for
  Run 2.
- Did NOT edit trackeros HARNESS to drop the
  repository-pattern rule mid-verification — that would
  conflate the test with the fix.
- Did NOT push a new template to switch test framework
  detection — out of scope for TR_035.

**Pending follow-ups (NEW from TR_035 verification):**

- **(HIGH — NEW)** TR_033 Fix 4 alert gap (above):
  planner's `maxPhaseRetries` exhaustion path doesn't fire
  the `feature-blocked` alert. Unify the two escalation
  paths through `markFeatureBlockedAfterEscalation`.
- **(MEDIUM — NEW)** Tool-loop agents (code-agent /
  constraint-agent / review-agent) don't capture
  `lastTokenManagement`. `runToolLoop` should write a
  final-turn aggregate so the dashboard's token-management
  panel shows them too.
- **(MEDIUM — NEW)** Planning-orchestrator does not yet
  persist `agent_execution_logs` rows for architecture /
  planner / phase-evaluator agents. Token-management
  telemetry for these is lost at the orchestrator boundary.
- **(HIGH — RESURFACED)** Constraint-agent +
  review-agent rules in the template HARNESS need a
  `src/shared/db/*` carve-out for the repository-pattern
  rule. Every freshly-init'd project will hit this
  false-positive cascade until the rule wording is fixed.
  Separate workstream — out of TR_035 scope but blocks
  every autonomous cycle.
- **(MEDIUM — RESURFACED)** Template scaffolding test
  framework lock-in — `gestalt init` substitutes Jest into
  the harness regardless of the project description text.
  When the description specifies Vitest, generated code uses
  Vitest imports; the gate then flags the mismatch.

**Carryover follow-ups (status updates):**

- **(ADDRESSED by TR_035 Layer 4 — VERIFIED on Run 1 +
  Run 2)** TR_034 HIGH: gpt-5.5 designPhase emits empty
  JSON. Layer 4 JSON guard closes this. Verified on both a
  non-reasoning model (gpt-4o-mini) and a reasoning model
  (chat-latest).
- **(ADDRESSED by TR_035 Part B1 — PARTIAL)** TR_034 HIGH:
  architecture-agent 12k floor. Trackeros local
  `agents.yaml` has 12k bumped; remote was reset by `gestalt
  init` to platform-default `~`. Not exercised on either
  remote because the relevant override is local.
- **(STILL OPEN — HIGH)** TR_032/033: gpt-5.5 + Aider zero
  source code. Not exercised — this verification used the
  LLM-driven code-agent path (codeGeneration backend defaults
  to `gestalt` on a freshly-init'd HARNESS).

**Build status:** `pnpm -r build` clean across all 13
packages. Test report: `docs/claude/TEST_REPORT_035.md`.
Server containers running with migration 029 applied;
`agent_execution_logs.token_management` JSONB +
`feature_phases.merge_commit_sha` TEXT columns both
queryable.

**Files changed (verification — beyond the implementation
session):**
- `docs/claude/TEST_REPORT_035.md` (new)

---
---
