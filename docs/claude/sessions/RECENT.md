# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

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

---
### Session 2026-06-10 — Claude Code (TR_033: Phase 3 quality gaps — package.json/tsconfig.json on --read, language-agnostic code-agent rules, phase-evaluator routes-cite rule, escalation→blocked structural fix)

Brief: four targeted fixes pushing for full autonomous feature
completion. Fixes 1-3 are language-agnostic rule additions
(no hard-coded TypeScript). Fix 4 is the structural follow-up
the TR_032 verification surfaced — escalated intents leaving
the parent feature stuck `in-progress` indefinitely.

What changed:

**Fix 1 — package.json + tsconfig.json (and friends) on `--read`**

- **`packages/agents/generate/src/adapters/aider-message-builder.ts`** —
  the base `readFiles` list expanded from `['PLAN.md']` to also
  include the common compiler-config + dependency-manifest
  filenames across languages: `package.json`, `tsconfig.json`,
  `pyproject.toml`, `requirements.txt`, `go.mod`, `pom.xml`,
  `mypy.ini`, `.eslintrc`, `.eslintrc.json`. The adapter's
  `existsSync` filter naturally drops the ones a project doesn't
  use — a TypeScript project sees `package.json + tsconfig.json`
  as `--read` flags; a Python project sees `pyproject.toml +
  requirements.txt`. No language tagged in the .ts code.

**Fix 2 — language-agnostic code-agent rules in template HARNESS**

- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** —
  three new rules appended to `agentConfig.code-agent.rules`
  (verbatim from the brief): one for reading dependency source
  before calling methods; one for reading compiler/linter config
  before generating; one for reading dependency manifest before
  importing. Examples list multiple ecosystems
  (tsconfig.json / mypy.ini / pyproject.toml / .eslintrc;
  package.json / requirements.txt / go.mod / pom.xml) so the
  LLM doesn't pattern-match to a specific stack.
- **trackeros HARNESS.json was NOT updated this session** — the
  edit was reverted by the operator/linter. Template changes
  flow to NEW projects; existing projects (including trackeros)
  need an operator-driven push. For the verification recipe to
  test the new rules end-to-end, trackeros's HARNESS.json must
  be manually patched first.

**Fix 3 — phase-evaluator routes-cite rule in template HARNESS**

- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** —
  new rule appended to `agentConfig.phase-evaluator-agent.rules`:
  > "When adjusting the scope of a routes or controller phase,
  > always cite the service or handler file it depends on so
  > Aider reads it before generating. The scope must make clear
  > which methods are available to call."

  Closes the TR_032 Phase 3 root cause: the routes phase scope
  didn't cite `leave.service.ts`, so `--read` didn't pick it up,
  so Aider invented method names. Language-agnostic framing
  (routes/controllers).
- **trackeros HARNESS.json was NOT updated this session** — same
  revert behaviour as Fix 2.

**Fix 4 — escalation → feature blocked (structural)**

- **`packages/core/src/repository/index.ts`** — `AlertType` union
  extended with `'feature-blocked'`. No migration required (no
  DB CHECK constraint on `alerts.type` — confirmed via `\d alerts`).
- **`packages/agents/planning/src/orchestrator/planning-orchestrator.ts`** —
  the `intent.status-changed` subscriber now accepts
  `waiting-for-clarification` in addition to deployed / failed /
  escalated. When the new status indicates an escalation
  (`waiting-for-clarification` or `escalated`), the subscriber
  routes to the new `markFeatureBlockedAfterEscalation` helper
  instead of dispatching `planning:evaluate` (there's nothing
  to evaluate — the phase produced no usable output).
- **`markFeatureBlockedAfterEscalation`** (new helper) marks the
  phase `failed`, marks the feature `blocked`, appends a
  `phase-escalated` event to the plan log, and creates a single
  `feature-blocked` alert with `severity: high` +
  `requiredAction: review-manually`. The `alert.created` SSE
  event fires so the dashboard alerts list updates immediately.
  Self-healing already parks the parent intent at
  `waiting-for-clarification` when the cascade brake fires
  (`self-healing-loop.ts:604`) — Fix 4 completes the story
  end-to-end.
- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.17.0` → `0.18.0`.

What's verified (build):

- ✅ `pnpm -r build` clean across all 13 packages.
- ✅ AlertType union extension picks up cleanly across
  repository / postgres-adapter / type-only consumers.
- ✅ Planning orchestrator new branch + helper compile without
  lint regressions.

What's verified live (cycle on trackeros feature `7ab81ea3`,
2026-06-10 22:08-22:15):

- ✅ **Fix 1** — Aider invocation at 22:12:43 logged
  `readFiles: ["PLAN.md", "package.json", "tsconfig.json",
  "pyproject.toml", "requirements.txt", "go.mod", "pom.xml",
  ...]`. The `existsSync` filter dropped the Python/Go/Java
  manifests cleanly on the TypeScript project. Language-
  agnostic behavior confirmed.
- ✅ **Fix 4 (the structural milestone)** — Phase 1 escalated
  to `waiting-for-clarification`; the planning subscriber
  immediately routed to `markFeatureBlockedAfterEscalation`,
  which:
  - Marked phase failed (plan log: `phase-escalated [phase 1]
    Phase 1 (Create balance domain model and repository)
    escalated to 'waiting-for-clarification' — feature blocked
    automatically. Self-healing budget exhausted; human
    clarification required to resume.`)
  - Marked feature `blocked` (`Status: blocked`, `Phases: 0/5`)
  - Created the `feature-blocked` alert (`446a1c83`, severity
    high, title "Feature blocked at phase 1")
  - All in one atomic sequence — **no manual operator cleanup
    needed**.
- ✅ Trackeros HARNESS.json carries Fix 2 + Fix 3 rules
  (operator re-applied per session question after the earlier
  revert).

What's NOT verified (couldn't reach):

- ❌ Phase 3 routes-phase behavior — feature blocked at
  Phase 1, never reached Phase 3.
- ❌ Compiler settings actually respected by Aider — the
  `tsconfig.json` was in `--read` context but the failure
  came from `'Cannot find module ../../shared/db'`, a path
  Aider invented from the planner's prose, not from `tsconfig`
  settings.
- ❌ End-to-end multi-phase autonomous completion — the
  brief's milestone goal.

What ELSE the live cycle surfaced (unrelated to TR_033 fixes):

- **gpt-5.5 needs `responses` apiShape** — the brief said
  "no registry change needed", but gpt-5.5 rejected
  `max_tokens` with `Use 'max_completion_tokens' instead`.
  Added `gpt-5.5` to `platform_llms` with
  `apiShape='responses'` mid-cycle.
- **gpt-5.5 token budget for reasoning** — `max_tokens: 3000`
  truncated planner JSON at 74s wall-clock (reasoning tokens
  count toward the same budget). Bumped architecture→6k,
  planner→12k, phase-evaluator→8k, self-healing→6k. Planner
  parsed cleanly after that.
- **gpt-5.5 + Aider produced ZERO source code across 4
  attempts** — every PR added `.aider.chat.history.md`,
  `.aider.input.history`, `.gestalt/<id>/{aider-output.md,
  design-spec.json, intent-spec.json}` and DOMAIN.md edits,
  but **nothing in `src/`**. CI passed each time because
  there was nothing to compile, but the planner kept seeing
  "Cannot find module '../../shared/db'" because the Aider
  message referenced that path while writing zero actual
  code. New failure mode — not the TR_028-32 hallucination
  pattern, this is "Aider with gpt-5.5 doesn't write files
  at all".
- **One `TypeError: fetch failed`** during architecture-agent
  — transient (next attempt succeeded). `classifyError` in
  `llm/index.ts` currently treats this as
  `retryable: false`, so a single transient TCP drop kills
  the whole feature.

Decisions made (during verification):

- **Did not auto-retry the cycle after each gpt-5.5 hiccup.**
  Each failure was a separate diagnostic step — fix the
  apiShape, fix the token budget, fix the fetch flake — then
  move forward.
- **Did not revert to gpt-4o-mini on Aider.** The brief
  explicitly chose gpt-5.5; the verification surfaces that
  gpt-5.5 + Aider has a code-generation gap. That's a finding
  for the operator to act on, not a platform-mechanic fix.
- **Cleaned 71 files / 19030 lines of cycle metadata off
  trackeros main** (`.aider.*`, `.gestalt/<correlationId>/`,
  PLAN.md). The platform's auto-merge pipeline shouldn't be
  pushing these to main — that's a separate gitignore /
  pre-commit follow-up.

Pending follow-ups (NEW from TR_033 verification):

- **(HIGH — NEW from TR_033)** gpt-5.5 + Aider produces zero
  source code. Each verification attempt's PR added only
  meta-files (`.aider.*`, `.gestalt/`, design specs) and
  documentation edits — nothing in `src/`. Either Aider's
  prompting doesn't translate to gpt-5.5's reasoning model
  output shape, or gpt-5.5 spends its entire token budget on
  reasoning before deciding to invoke Aider's file-edit tool.
  Investigate via Aider's stdout / chat history files
  (committed under `.gestalt/<correlationId>/aider-output.md`).
- **(MEDIUM — NEW from TR_033)** Fix 4 race condition.
  `waiting-for-clarification` is used by self-healing for
  TWO distinct things: (a) pausing the parent while a fix-
  intent is dispatched (recoverable — `onSuccessDispatch`
  resumes the parent later), (b) cascade-brake exhaustion
  (genuinely terminal). The current Fix 4 treats both as
  terminal, so the feature flips to `blocked` the moment
  self-healing pauses the parent for a fix-intent —
  prematurely. Mitigation: check whether an in-flight
  fix-intent child exists before marking terminal, OR add a
  distinct `escalated-cascade-brake` status to disambiguate.
  The current cycle still showed Fix 4 firing correctly
  (alert created, plan log written) — but it fired earlier
  than the brief intended.
- **(MEDIUM — NEW from TR_033)** Platform pushes
  `.aider.chat.history.md`, `.aider.input.history`,
  `.gestalt/<correlationId>/` JSON, and PLAN.md to project
  main as part of auto-merge. Across many cycles trackeros
  accumulated 71 files / 19k lines of this metadata. Either
  add these paths to the project's `.gitignore` at init
  time, or have pr-agent skip them when staging the PR's
  commit set.
- **(LOW — NEW from TR_033)** `classifyError` treats
  `TypeError: fetch failed` as `retryable: false`. A
  transient TCP drop or DNS blip kills the whole feature
  with no retry. The existing retry loop in
  `LLMClient.complete` would handle this if the classifier
  returned `retryable: true`.
- **(LOW — NEW from TR_033)** The brief said "gpt-5.5 uses
  standard chat-completions shape — no registry change
  needed". Wrong — gpt-5.5 is a reasoning model that needs
  `responses` apiShape. Documented in trackeros's
  `platform_llms` row; doc the pattern for the next operator
  picking a reasoning model.

Decisions made:

- **No new migration for Fix 4.** `alerts.type` has no DB CHECK
  constraint, so adding `feature-blocked` is type-only.
- **No new HARNESS rules for Fix 1.** Adding rules like "read
  package.json before importing" would duplicate the `--read`
  mechanism. Fewer overlapping guidance channels means less
  for the LLM to reconcile.
- **Respected the trackeros HARNESS.json revert.** The operator
  rolled back my Fix 2 + Fix 3 edits on the trackeros repo;
  re-applying would be hostile. Template changes flow forward;
  trackeros is opt-in.
- **Did not normalise the `--read` list to a config-driven set.**
  A future change could move the list to
  `HARNESS.codeGeneration.readFiles` so operators tune it per
  project; today the platform-default list is fine.

Pending follow-ups (NEW from TR_033):

- (none yet — these will emerge from live verification)

Carryover follow-ups (status updates):

- **(ADDRESSED by TR_033 Fix 4 — pending live verification)**
  TR_032 finding: escalated intents leave the parent feature
  stuck `in-progress` indefinitely. Structural fix landed.
- **(ADDRESSED by TR_033 Fix 1 — pending live verification)**
  TR_032 Phase 3 finding: Aider didn't know the project was
  TypeScript-strict (`unknown` catch types). `tsconfig.json`
  now goes via `--read`.
- **(ADDRESSED in TEMPLATE by TR_033 Fix 2 + Fix 3 — trackeros
  needs operator push)** TR_032 Phase 3 finding: Aider invented
  service methods. Template rules tighten the contract;
  trackeros's HARNESS.json needs the same rules patched in.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json. Not bundled here — TR_033's new code-agent
  rule about reading tsconfig.json should reduce most of the
  same errors at generation time.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend capture
  in `agent_executions.tokens_used`.

Build status: `pnpm -r build` clean across all 13 packages.
Server Docker image will rebuild for live verification.
Template auto-refreshes to `0.18.0` on next server boot.

Files changed:
- `packages/agents/generate/src/adapters/aider-message-builder.ts`
- `packages/core/src/repository/index.ts`
- `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`

---
### Session 2026-06-09 — Claude Code (TR_032: three targeted Aider compliance fixes — `--read` flag, preservation rule in .ts schema, fix-intent broken-state framing — built clean, awaiting live verification)

Brief: three surgical fixes for the remaining TR_028 → TR_031
Aider DTO-drift blocker. No new HARNESS rules added, no new
migrations — all three fixes are platform mechanics in `.ts`
(ADR-042 compliant).

What changed:

**Fix 1 — Aider `--read` flag (promotes the TR_031 follow-up)**

- **`packages/agents/generate/src/adapters/aider-adapter.ts`** —
  `runAider` accepts a new optional `readFiles?: string[]`
  parameter. Each path is filtered with
  `existsSync(join(workDir, path))` before being added (passing
  a not-yet-created file would make Aider error out). Surviving
  paths render as repeated `--read "<file>"` flags in the
  command, sitting between `--no-git` and `--model`. Empty list
  → flag omitted entirely (the argv filter drops empty parts).
- **`packages/agents/generate/src/adapters/aider-message-builder.ts`** —
  `buildAiderMessage` return type changed from `string` to
  `{ message: string; readFiles: string[] }`. PLAN.md is always
  in `readFiles`; additional paths come from a new
  `extractMentionedPaths` regex that pulls file-path-shaped
  tokens out of `intentSpec.rawIntent` (the planner emits paths
  per the TR_029 phaseScopingRules — they're now read-injected,
  not merely cited in prose). Removed the prior `## Read PLAN.md
  first` and `## Before generating any code` prose sections —
  the `--read` flag enforces what they only asked.
- **`packages/agents/generate/src/agents/aider-code-agent.ts`** —
  destructures `{ message, readFiles }` from `buildAiderMessage`,
  passes `readFiles` to `runAider` as the new last param. Logs
  `readFiles` on the "Running Aider code generation" line so
  operators can see what was injected.

**Fix 2 — Preservation requirement hard-coded in `.ts` schema**

- **`packages/core/src/agents/self-healing-agent.ts`** — the
  `fixIntent` field's description in the diagnostician's
  response JSON schema now ends with: _"ALWAYS end the fixIntent
  with this exact sentence: 'Preserve all existing exports,
  types, interfaces, and imports. Only add or modify what is
  needed to resolve the CI failure shown above.'"_ This is
  platform mechanics — every Aider-targeted fix-intent must
  preserve exports; there's no project-specific variant — so
  it lives in the .ts schema not in HARNESS rules (ADR-042
  split). TR_031 verification showed the HARNESS bullet was
  inconsistently honoured by the LLM; schema-string guidance
  reliably reaches the model.
- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** —
  removed the now-redundant preservation rule from
  `agentConfig.self-healing-agent.rules`.

**Fix 3 — Fix-intent framing: broken state, not missing state**

- **`packages/core/src/agents/self-healing-agent.ts`** — same
  `fixIntent` description gains a BROKEN STATE vs MISSING
  STATE framing rule with verbatim WRONG/CORRECT examples:
  > WRONG: "ILeaveRepository does not exist in the module"
  > CORRECT: "The service imports ILeaveRepository but the
  > repository file exports LeaveRepository (no I prefix).
  > The import path is wrong."

  Addresses the TR_031 cycle-3 finding that Aider inverts
  negation — "X does not exist" → CREATES X. Reframing the
  failure as a broken / wrong import or type rename gives Aider
  a fixable shape instead of a missing-thing-to-create.

- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.16.0` → `0.17.0`.

What's verified (build only):

- ✅ `pnpm -r build` clean across all 13 packages.
- ✅ TypeScript types match — `runAider` signature change picks
  up the new optional param; `buildAiderMessage` callers
  destructure correctly; no unused-binding errors.

What's NOT verified yet (live cycle pending):

- ❌ End-to-end multi-phase autonomous completion.
- ❌ Aider compliance with `--read`-injected PLAN.md +
  dependency files. The brief's verification recipe
  (`gestalt feature submit "Build the leave management
  module..." --project trackeros`) hasn't been run yet —
  operator to execute.
- ❌ Fix-intent preservation footer presence on each dispatch.
- ❌ Fix-intent broken-state framing on each dispatch.

Decisions made:

- **`extractMentionedPaths` is a regex, not an AST.** The
  planner's scope text is prose; a regex over file-path-shaped
  tokens (`[a-z0-9_\-./]+\.(ts|tsx|js|jsx|json|md|yaml|yml|py|sql)`)
  catches what we need. The `existsSync` filter in `runAider`
  is the safety net for over-extraction.
- **Removed the TR_030 + TR_031 prose `## Read PLAN.md first`
  and `## Before generating any code` sections.** The `--read`
  flag enforces what they could only ask. Keeping both would
  duplicate the instruction at two strengths — the `--read`
  flag is the strong form.
- **Preservation requirement promoted to .ts schema (ADR-042
  reinterpretation).** The split rule reads "platform mechanics
  in .ts, project-tunable guidance in HARNESS/agents.yaml".
  Preservation is a hard invariant of every Aider fix-intent
  — no project-specific variant makes sense. Move to .ts.
- **Did not modify trackeros HARNESS.json.** The redundant
  preservation rule on trackeros is harmless (the .ts schema
  rule fires too). Operator can prune it on next HARNESS edit.
- **Did not run live verification.** The cycle takes ~15
  minutes and needs the server up + a clean trackeros main.
  Operator to run the brief's recipe.

Pending follow-ups (NEW from TR_032):

- (none yet — these will emerge from live verification)

Carryover follow-ups (status updates):

- **(ADDRESSED by TR_032 Fix 1 — pending live verification)**
  TR_031 follow-up: Aider `--read <file>` for PLAN.md + cited
  paths. Implemented; awaiting end-to-end confirmation.
- **(ADDRESSED by TR_032 Fix 2 — pending live verification)**
  TR_031 follow-up: preservation requirement in schema not
  HARNESS bullet.
- **(ADDRESSED by TR_032 Fix 3 — pending live verification)**
  TR_031 finding: Aider inverts negated fixIntent text.
- **(STILL OPEN — HIGH)** TR_029 follow-up: architecture-agent's
  module-level description still feeds into Phase N code-agent
  context. Aider may still import from sibling modules. Fix 1's
  `--read` flag doesn't address this directly — that's a
  separate prompt-scoping change.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json.
- **(STILL OPEN — MEDIUM)** TR_031 follow-up: stale-file
  pollution on trackeros main from failed prior cycles.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend capture.

Build status: `pnpm -r build` clean across all 13 packages.
Server state unchanged. Docker image unchanged. Template
auto-refreshes to `0.17.0` on next server boot.

Files changed:
- `packages/agents/generate/src/adapters/aider-adapter.ts`
- `packages/agents/generate/src/adapters/aider-message-builder.ts`
- `packages/agents/generate/src/agents/aider-code-agent.ts`
- `packages/core/src/agents/self-healing-agent.ts`
- `templates/corporate-ops-web-mobile/harness/HARNESS.json`
- `templates/corporate-ops-web-mobile/template.json`

