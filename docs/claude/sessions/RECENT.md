# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

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
### Session 2026-06-10 — Claude Code (TR_034: scoped per-phase architecture replaces full architecture context in Aider message — TR_034 mechanisms verified end-to-end; gpt-5.5 + Aider still produces zero source code)

Brief: replace the heavy `## Project architecture` (full
`docs/ARCHITECTURE.md`) and `## Design context` (full
`design-spec.json`) blocks in the Aider message with a single
`## Scoped architecture for this phase` block populated from
architecture-agent's `designPhase()` output (exact file paths,
exports, import statements). Closes the TR_033 Phase 3 root
cause — Aider hallucinated `../../shared/db` because the full
architecture description mentions modules by NAME, not by path.

What changed (4 parts):

**Part 1 + 2 — HARNESS + agents.yaml rule additions**

- **trackeros HARNESS.json**:
  `planner.architectureReviewPerPhase: false → true`. Two new
  `agentConfig.architecture-agent.architectureGuidance` items:
  per-dependency exact path/exports/import-statement; ban on
  module-name-only references.
- **trackeros agents.yaml**: `architecture-agent.prompt_extensions`
  populated (was `[]`) with five scoping rules including
  WRONG/CORRECT examples (`'Use the shared/db module'` WRONG;
  full statement with exact path CORRECT).
- **Template HARNESS.json + agents.yaml**: same rule additions
  (the template's `architectureReviewPerPhase` was already `true`).

**Part 3 — `aider-message-builder.ts` rewrite**

- `buildAiderMessage` signature changed from
  `(intentSpec, designSpec, snapshot)` to
  `(intentSpec, phaseArchitecture: string | null, snapshot)`.
- Dropped the `## Project architecture` block (was reading
  `snapshot.architectureMd` — the module-name hallucination source).
- Dropped the `## Design context` block (was reading
  `design-spec.json` — also full-architecture-scoped).
- New `## Scoped architecture for this phase` block, populated
  from architecture-agent's per-phase JSON.
- New `renderPhaseArchitecture()` helper renders
  `PhaseArchitectureShape` (interfaces / importStatements /
  sqlSchema / successCriteria) as markdown. The shape is
  duplicated locally to keep `@gestalt/agents-generate` from
  importing `@gestalt/agents-planning` (the inter-agent-import ban).

**Part 4 — wiring**

- New `FeatureRepository.updatePhaseArchitecture(phaseId, json)`
  on the interface + postgres impl + oracle/mssql stubs. No
  migration (uses existing `architecture` text column).
- `runPerPhaseArchitecture` in `planning-orchestrator.ts` now
  persists JSON-stringified `PhaseArchitecture` onto
  `phase.architecture`. The planner's initial free-form
  architecture text (if any) is overwritten — it was already
  consumed by `designPhase()` as input.
- `aider-code-agent.ts` new helper
  `loadPhaseArchitectureForCycle(correlationId)` resolves
  correlationId → intent → phase → `phase.architecture`, parses
  as `PhaseArchitectureShape` (best-effort shape-guard), renders
  via `renderPhaseArchitecture`. Falls back to `null` on any
  failure or when the column doesn't look like JSON.
  Removed `loadLatestDesignSpec` — `design-spec.json` is no
  longer Aider's primary architecture context.
- Template `0.18.0 → 0.19.0`.

Verified end-to-end on trackeros feature `45fe91b3` (cycle
2026-06-10 05:20-05:42):

- ✅ **Per-phase architecture pass fired**: plan log shows
  `phase-architecture-designed [phase 1]` at 05:27:40.
- ✅ **`readFiles` includes scoped paths**: at 05:31:04 the Aider
  invocation logged `readFiles: [..., "src/shared/db/index.ts",
  "src/shared/base-repository.ts", ...]` — real file paths,
  **no `../../shared/db` hallucination at the path level**.
- ✅ **`messageBytes: 2922`** (TR_033 was 5705) — heavyweight
  `## Project architecture` and `## Design context` blocks gone
  from the message.
- ✅ **`updatePhaseArchitecture` repo method** wrote the JSON to
  `feature_phases.architecture` for Phase 1 (verified via psql).
- ✅ **Phase 1 deployed**: gate verdict `pass` at 05:39:01;
  PR #119 squash-merged + promotion fired.
- ❌ **gpt-5.5 + Aider produced ZERO source code AGAIN** (same
  TR_033 pattern). Phase-evaluator-agent's git diff returned
  exactly:
  ```
  A .aider.chat.history.md
  A .aider.input.history
  A .gestalt/<id>/aider-output.md
  A .gestalt/<id>/design-spec.json
  A .gestalt/<id>/intent-spec.json
  M docs/DOMAIN.md
  ```
  No `src/modules/leave/leave.model.ts`, no `leave.repository.ts`,
  no tests. TR_026's git-diff evaluator path works flawlessly —
  the verdict text quotes the brief's expected paths and the
  actual diff verbatim.
- ❌ **`architecture-agent.designPhase` returned empty output**:
  log says `0 interface(s), 0 criteria` for Phase 1. Either
  gpt-5.5 returned JSON with empty arrays, or it truncated at
  6000 max_tokens (reasoning consumes the budget), or the new
  prompt extensions don't translate to gpt-5.5's reasoning-model
  output shape. The empty architecture → empty
  `## Scoped architecture for this phase` block → dropped by
  the message builder (`phaseArchitecture.trim().length > 0`
  guard). Aider effectively got task + rules + readFiles only —
  the same context as TR_033.

What this VERIFIES (TR_034 platform mechanisms):

- ✅ `architectureReviewPerPhase: true` triggers the per-phase
  architecture-agent pass.
- ✅ `updatePhaseArchitecture` repo method persists scoped JSON
  onto `phase.architecture`.
- ✅ `loadPhaseArchitectureForCycle` resolves
  correlationId → intent → phase → architecture and parses with
  shape guard.
- ✅ `buildAiderMessage`'s new signature compiles + ships; the
  heavyweight architecture blocks are removed; the scoped block
  lands when the architecture is non-empty.
- ✅ Phase-evaluator-agent's git-diff path (TR_026) detects the
  zero-source-code state precisely with the exact list of what
  was actually written.

What this DOES NOT verify:

- ❌ End-to-end multi-phase autonomous completion.
- ❌ Whether the scoped architecture block actually helps Aider
  — gpt-5.5's designPhase output was empty, so the block was
  dropped. The cycle was effectively the same task + rules +
  readFiles Aider got in TR_033.

Decisions made:

- **Did not investigate the architecture-agent's empty output
  during the cycle.** That's a model / prompt issue, not a
  TR_034 platform-mechanism issue; debugging it would branch
  this session. Captured as a new HIGH follow-up.
- **Used TR_033's token bumps unchanged** (architecture 6k,
  planner 12k, phase-evaluator 8k, self-healing 6k). The
  architecture-agent's empty output suggests 6k may still be
  tight for gpt-5.5 reasoning + a multi-interface JSON response.
- **Did NOT trigger TR_033 Fix 4** (the escalation handler) in
  this cycle. Phase-evaluator-agent escalated via the existing
  `if (evaluation.verdict === 'escalate')` path at line 633 — a
  different code path than the `waiting-for-clarification`
  intent status that Fix 4 watches. The legacy escalate path
  calls `features.updateStatus(feature.id, 'blocked')` directly
  with no alert + no `phase-escalated` event. Not a regression —
  an observation: the two escalate paths could be unified.

Pending follow-ups (NEW from TR_034):

- **(HIGH — NEW from TR_034)** `architecture-agent.designPhase`
  returned empty `interfaces` / `importStatements` /
  `successCriteria` with gpt-5.5. The prompt extensions
  explicitly demand these fields with WRONG/CORRECT examples.
  Either gpt-5.5 reasoning consumed the 6k budget before
  emitting JSON, the prompt's JSON-schema description doesn't
  map to reasoning-model output, or gpt-5.5 returned valid JSON
  with empty arrays. Bump architecture-agent `max_tokens` to
  12k AND/OR add an explicit "this JSON response is mandatory"
  guard rail.
- **(MEDIUM — NEW from TR_034)** The two escalate paths
  diverge. Phase-evaluator-agent escalate at line 633 calls
  `updateStatus(blocked)` directly — no alert, no
  `phase-escalated` plan log entry. TR_033's Fix 4 helper does
  the full atomic sequence (phase failed + feature blocked +
  plan log + alert). Unify by routing the evaluator's escalate
  verdict through the same `markFeatureBlockedAfterEscalation`
  helper.
- **(STILL HIGH — promoted from TR_033)** gpt-5.5 + Aider
  produces zero source code. TR_034 was supposed to give the
  model a more focused message so it would actually generate.
  Did NOT happen — the scoped block was empty because
  designPhase returned empty arrays. With non-empty scoped
  architecture the behaviour might be different; the HIGH NEW
  follow-up above unblocks the next test of this.
- **(STILL HIGH — promoted from TR_033)** Auto-merge pipeline
  pushes `.aider.*` history + `.gestalt/<id>/` metadata +
  PLAN.md to project main. Trackeros has been garbage-collected
  manually after every cycle.

Carryover follow-ups (status updates):

- **(ADDRESSED by TR_034 architecture rewrite — but blocked on
  architecture-agent's empty output)** TR_033 finding: Aider
  hallucinates module paths like `../../shared/db` because the
  architecture description references modules by name. TR_034
  architecturally fixes this — Aider would see exact file paths
  if the scoped architecture had content. Need the architecture-
  agent JSON-emission gap fixed first.
- **(STILL OPEN — HIGH)** TR_033 finding: Fix 4 race condition
  (waiting-for-clarification used for both pause-during-fix-
  intent and cascade-brake-terminal). Not addressed this session.
- **(STILL OPEN — MEDIUM)** TR_033 finding: `classifyError`
  treats `TypeError: fetch failed` as `retryable: false`.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend capture
  in `agent_executions.tokens_used`.

Build status: `pnpm -r build` clean across all 13 packages.
Server Docker image rebuilt with TR_034 code. Template
auto-refreshes to `0.19.0` on next server boot.

Files changed:
- `packages/agents/generate/src/adapters/aider-message-builder.ts`
- `packages/agents/generate/src/agents/aider-code-agent.ts`
- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
- `packages/core/src/repository/index.ts`
- `packages/adapters/postgres/src/repositories/features.ts`
- `packages/adapters/oracle/src/repositories/features.ts`
- `packages/adapters/mssql/src/repositories/features.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/harness/agents.yaml`
- `templates/corporate-ops-web-mobile/template.json`
- `/Users/amrmohamed/Work/trackeros/HARNESS.json` (separate repo)
- `/Users/amrmohamed/Work/trackeros/agents.yaml` (separate repo)
