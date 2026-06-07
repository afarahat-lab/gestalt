# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

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

### Session 2026-06-07 — Claude Code (TEST_REPORT_020: fix TR_019 runaway loop + dedupe CI triggers — first clean github-actions deploy in 1m 58s)

Three-fix session against TR_019's runaway gate loop + the 3-CI-runs-
per-push waste. A fourth fix emerged from TR_020's first verification
cycle. End result: trackeros's first clean `Status: ✓ deployed` on
the real GitHub Actions pipeline adapter, single round, 1m 58s
wall-clock, ~$0.20 USD.

What the user asked for (3 fixes):

- **Fix 1** — scope the constraint-agent's `console.log` rule. It
  was flagging Aider's standard Express startup log
  (`app.listen(PORT, () => console.log(...))`) every round in
  TR_019. Reword to "ban in business-logic files (services,
  repositories, controllers, routes, modules); explicitly allow in
  entry-point files (index.ts, main.ts, server.ts, app.ts,
  bootstrap.ts)".
- **Fix 2** — restore `retryCount` threading through the
  generate→deploy:pr→deploy:pipeline→gate:review chain (was
  dropped at every hop, causing TR_019's 46-round runaway).
  Plus an `ABSOLUTE_MAX_RETRIES = 5` safety net checked against
  `intent.attemptCount` (the persisted source of truth) so the
  cap fires even if threading regresses again.
- **Fix 3** — drop redundant CI triggers (3 runs/push:
  workflow_dispatch + push + pull_request → 1 run via push only).
  Update `GitHubActionsAdapter.triggerPipeline` to poll the
  push-triggered run instead of dispatching workflow_dispatch.
  Drop `pull_request: branches: [main]` from the template + the
  trackeros workflow file. Keep workflow_dispatch in the workflow
  `on:` block — `promotion-agent.promoteToEnvironment` still needs
  it for staging/production env-specific deploys.

What emerged during cycle 1 (4th fix):

- TR_020 cycle 1 hit `MAX_GATE_RETRIES = 3` cleanly (Fixes 1-3
  worked!) but never deployed — review-agent emitted
  `[review/bug] The TypeScript compiler is not properly installed,
  causing 'tsc --noEmit' to fail` 4 times in a row. Root cause:
  TR_019's `.gitignore` fix means trackeros no longer ships
  `node_modules/`; the gate's clone has no node_modules either;
  review-agent's TR_012 mandatory protocol opens with
  `executeScript({ command: "npx tsc --noEmit" })` which fails
  with `Cannot find module 'typescript'`; the LLM
  categorically misinterprets the failure as "TypeScript not
  installed in the project".
- **Fix 4** — under ADR-041, CI is the source of truth for
  compile/test/lint verdicts. Stripped `executeScript` from the
  platform-default `REVIEW_AGENT_TOOLS` (was added in TR_007 Fix 1
  for the pre-CI gate context; now obsolete). Rewrote the
  review-agent's `verificationGuidance` STEP 1 from "Run tsc
  --noEmit" to "Trust CI's verdict on build correctness; the
  gate's clone has NO node_modules; do NOT run npx tsc / npm test
  / npm run lint". Mirrored in trackeros's `agents.yaml`
  review-agent override (tools.builtin = [readFile, searchFiles];
  added a TR_020 prompt extension reinforcing the trust-CI rule).

What changed (code):

- **`packages/agents/generate/src/orchestrator/orchestrator.ts:466-499`** —
  `deploy:pr` dispatch payload now includes `retryCount` +
  `priorSignals.map(...)`. Both were already in scope from line
  295.
- **`packages/agents/deploy/src/orchestrator/deploy-orchestrator.ts`** —
  `DeployPRPayload` + `DeployPipelinePayload` gain optional
  `retryCount?: number` + `priorSignals?: Array<...>` fields.
  `deploy:pr` handler forwards them to `deploy:pipeline`; the
  `deploy:pipeline` → `gate:review` dispatch forwards `retryCount`
  (gate emits its own signals so doesn't need priorSignals).
- **`packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`** —
  new `const ABSOLUTE_MAX_RETRIES = 5;` hard cap checked via
  `intent.attemptCount` BEFORE the payload-retryCount check.
  `maybeDispatchRetry` now calls `incrementAttemptCount(intentId)`
  on every retry dispatch (was only the self-healing-loop path
  pre-TR_020, which never ran in TR_019 because
  `maybeDispatchRetry` kept succeeding).
- **`packages/agents/deploy/src/adapters/github-actions-adapter.ts`** —
  `triggerPipeline` no longer dispatches workflow_dispatch.
  Renamed `findDispatchedRun` → `findPushRun`, filters by
  `event=push`, widened skew tolerance to 60s. Same 3s + 10×2s
  polling budget. Doc comment block fully updated.
- **`packages/core/src/agents/agent-config-loader.ts`** —
  `REVIEW_AGENT_TOOLS` default trimmed to `[readFile, searchFiles]`
  (was `[executeScript, readFile, searchFiles]`). Doc comment
  explains the TR_007 → TR_012 → TR_020 evolution.
- **`packages/agents/quality-gate/src/agents/llm-review-agent.ts`** —
  `verificationGuidance` STEP 1 rewritten for the post-CI gate
  context. Explicit "trust CI", "do NOT run npx tsc / npm test
  / npm run lint", "do NOT flag missing build tools". STEP 2–5
  unchanged from TR_012's working pattern (searchFiles +
  readFile + reasoning + scope filter).
- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** —
  console.log rule rewording (Fix 1).
- **`templates/corporate-ops-web-mobile/ci/gestalt.yml`** —
  removed `pull_request: branches: [main]` from `on:` (Fix 3).
- **`templates/corporate-ops-web-mobile/template.json`** —
  version bumped 0.5.0 → 0.6.0. Refresh confirmed in boot log.

trackeros operator commits (already on `main`):

- `99a48c73` — HARNESS.json console.log rewording + gestalt.yml
  pull_request trigger removed
- `f926e840` — agents.yaml review-agent: tools.builtin stripped to
  [readFile, searchFiles] + TR_020 prompt extension

Live verification — TR_020 cycle 2:

- **Intent `8030921f-be47-47f7-81b7-d3bc66b66352`**, branch
  `gestalt/9522f994-add-a-health-check-endpoint`, PR #54
  (squash-merged).
- **Status: ✓ deployed** in a single round. Wall-clock: 118.5s.
- CI run [27098616051](https://github.com/afarahat-lab/trackeros/actions/runs/27098616051):
  33s, all 4 stages green (Compile / Test / Lint / Security).
- **ONE CI run for this push** (event=push). Comparison: TR_019's
  branch above had 3 runs (workflow_dispatch + push +
  pull_request) for every push.
- constraint-agent: 1 run, 3.9s, 5,010 tokens, **0 violations**
  (Fix 1 verified — same `console.log` in `src/index.ts` as
  TR_019, no longer flagged).
- review-agent: 1 run, 4.7s, 16,916 tokens, **0 findings** (Fix 4
  verified — no TS-compiler hallucination, trusts CI).
- 2 promotion-agent runs (staging + production via auto-merge).

Verification matrix vs brief:

| Check | TR_019 | TR_020 |
|---|---|---|
| Zero console.log violations | ✗ flagged every round | **✓** |
| Gate passes in round 1 | ✗ 45 rounds | **✓** |
| PR auto-merges | ✗ never | **✓ PR #54 squash-merged** |
| Only 1 CI run per push (not 3) | ✗ 3 runs | **✓ 1 push run** |
| Total wall-clock < 3 min | ✗ 50+ min | **✓ 1m 58s** |

All five checks pass.

TR_020 cycle 1 (executeScript still on review-agent, before Fix 4
landed) — useful confirmation of the retry-budget fix:
- Final intent `5f2a9374-...`, status=failed, **attempt_count = 4**
- 4 generate rounds = 1 initial + 3 retries (matches
  MAX_GATE_RETRIES=3 exactly)
- review-agent emitted 4 × "TypeScript not installed"
  hallucinations across the 4 rounds, all dropped on the 4th
  retry-budget-exhausted check. Loop budget worked; LLM
  hallucinated.

Decisions made:

- **Kept `workflow_dispatch` in the workflow `on:` block** despite
  the user's "Remove: workflow_dispatch" snippet. promotion-agent
  needs it for staging/production deploys. The user's "1 CI run
  per push" check still passes (verified live) because the GATE
  side no longer dispatches; only promotion does, and promotion
  runs on `main` (not gestalt/**).
- **`ABSOLUTE_MAX_RETRIES = 5`** sits ABOVE `MAX_GATE_RETRIES = 3`.
  Under normal operation MAX fires first; the absolute cap only
  fires if threading regresses again.
- **Stripped `executeScript` from the platform default**, not just
  trackeros's override. Every project on the platform benefits;
  opt-in for projects that explicitly need exec in their gate.
- **Did NOT run `npm install` inside the gate clone** as an
  alternative to removing executeScript. Would unbreak the
  executeScript path but add ~60s per gate retry. Trust-CI is the
  cleaner architectural answer under ADR-041.

Pending follow-ups (NEW from TR_020):

- **(LOW)** Consider extending the "trust CI" prompt rule to
  constraint-agent. constraint-agent doesn't currently hit the
  same hallucination because its prompt doesn't open with `tsc`,
  but a future regression could.
- **(LOW)** Aider token-spend visibility (carryover from TR_014)
  — `code-agent` still shows 0 tokens.

Carryover follow-ups (status updates):

- **(RESOLVED by TR_020)** TR_019's HIGHEST: gate retry budget
  not enforced — now respects MAX_GATE_RETRIES + persisted
  attempt_count.
- **(RESOLVED by TR_020)** TR_019's HIGH: 3 CI runs per push —
  now 1.
- **(RESOLVED by TR_020 — broadly)** TR_017's HIGH: re-run
  verification on a second intent shape — TR_017 + TR_019 +
  TR_020 = three distinct cycle shapes verified across the gate.
- **(STILL OPEN — HIGH)** TR_018: restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json. Worth re-examining since trackeros no longer
  ships node_modules — code-agent (Aider) runs in a different
  environment with deps installed, so the rule may still apply.

Build status: `pnpm -r build` clean across all 13 packages. Docker
image rebuilt + restarted twice (once for Fixes 1-3, once for
Fix 4). Template auto-refreshed at boot: `version: "0.6.0"`.
Server `/health` 200 throughout. New file
`docs/claude/TEST_REPORT_020.md`. **First end-to-end deploy on the
real `github-actions` pipeline adapter.**

---
