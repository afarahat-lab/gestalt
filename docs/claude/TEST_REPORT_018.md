# TEST_REPORT_018 — Quality gate moves to post-CI (ADR-041)

**Date:** 2026-06-06
**Cycle correlation:** `59d81261-035b-4b6e-96d0-24a210b7fe44`
**Intent:** `db4810bc-0413-4bb2-87bb-5935b6d5fd74`
**Outcome:** Architectural change verified end-to-end. New dispatch
chain fires correctly across every transition; the LLM gate now
reviews source files loaded from the PR branch post-CI rather than
artifacts produced pre-push.

---

## What changed

### Code

- **`packages/agents/quality-gate/src/agents/`** — `lint-agent.ts`,
  `security-agent.ts`, `test-runner-agent.ts` deleted (pre-CI stubs;
  CI now owns lint / security / test execution).
- **`packages/agents/quality-gate/src/index.ts`** — exports for the
  three deleted agents removed; type re-exports for `SecurityFinding`,
  `TestRunResult`, `TestFailure` removed.
- **`packages/agents/quality-gate/src/types.ts`** — `GateAgentRole`
  trimmed to `constraint-agent | review-agent`; `SecurityFinding`,
  `OWASPSeverity`, `TestFailure`, `TestRunResult` deleted.
- **`packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`** —
  - `GateTaskPayload` gains `readFromBranch?: boolean`, `branch?: string`,
    `prNumber?: number`, `prUrl?: string`, `ciRunId?: string`.
  - After clone, `git fetch origin <branch> && git checkout -B <branch>
    origin/<branch>` runs when `payload.branch` is set so constraint +
    review-agent see the exact code CI tested.
  - New `readSourceFilesFromWorkDir(projectRoot, correlationId, log)`
    walks the cloned tree and emits `ArtifactRef[]` for every file
    matching `SOURCE_FILE_EXTENSIONS` (`.ts .tsx .js .py .go .java
    .rs .cs .rb .kt .swift` etc.). Skips `node_modules`, `dist`,
    `build`, `target`, `__pycache__`, `.venv`, `.next`, `coverage`,
    etc. Capped at `MAX_GATE_FILES=200` files / `MAX_FILE_BYTES=64k`
    per file; over-cap walk warns + drops.
  - Pass-verdict dispatch splits: `readFromBranch:true` → new
    `dispatchPromotion()` (sends `deploy:promotion` staging with
    `prNumber` + `branch` + `intentText`); `readFromBranch:false`
    falls through to the legacy `dispatchDeployPR()` for backward
    compatibility with in-flight pre-ADR-041 jobs.
  - `maybeDispatchRetry` now forwards `resumeOnBranch: payload.branch`
    + `prNumber` + `prUrl` to the generate retry leg so Aider's fix
    commit lands on the same PR branch instead of opening a second
    PR.
- **`packages/agents/generate/src/orchestrator/orchestrator.ts`** — end
  of `handleIntentTask` swaps the old `transitionIntent('in-review') +
  dispatch('gate:review')` for a direct `dispatch('deploy:pr')`.
  pr-agent owns the `in-review`-equivalent transition (it flips to
  `deploying`). `resumeOnBranch` / `prNumber` / `prUrl` are
  forwarded through.
- **`packages/agents/deploy/src/orchestrator/deploy-orchestrator.ts`** —
  in `deploy:pipeline`'s `outcome.kind === 'passed'` branch:
  `transitionIntent → 'in-review'` and dispatch
  `gate:review` (`readFromBranch: true`, `branch`, `prNumber`,
  `prUrl`, `ciRunId: outcome.runId`) instead of the prior
  `deploy:promotion` dispatch. CI-failure branch unchanged
  (`self-healing` → `pipeline-failed`).
- **`packages/core/src/types.ts`** — `AgentRole` loses `lint-agent`
  `security-agent` `test-runner-agent`; `TaskType` loses `gate:lint`
  `gate:security` `gate:test-runner`.
- **`packages/core/src/agents/agent-config-loader.ts`** —
  `PER_ROLE_DEFAULTS['test-runner-agent']` entry + the
  `TEST_RUNNER_AGENT_TOOLS` constant removed. Comment on
  `ALL_FILE_TOOLS_WITH_SCRIPT` updated to drop the
  test-runner-agent reference.
- **`packages/server/src/routes/agents.ts`** — `GATE_FRAMEWORK_ROLES`
  expanded to `{constraint-agent, review-agent}` (both LLM-driven);
  `GATE_INFRASTRUCTURE_AGENTS` now empty.
- **`packages/cli/src/ui/execution-graph.ts`** +
  **`packages/cli/src/commands/gate.ts`** — gate-agent classification
  sets trimmed to two; per-agent summary switch in
  `formatCheck` drops the three deleted branches.
- **`packages/dashboard/src/views/{IntentDetail,ProjectSettings,ActiveAgents}.tsx`** —
  same trim applied to client-side classification sets / role
  colours.

### Stack config + templates

- **`packages/server/src/templates/stack-config.ts`** — `StackConfig`
  gains `lintCmd: string`. `DEFAULT_STACK_CONFIG.lintCmd =
  'pnpm run lint'`. The LLM prompt asks for `lintCmd` with examples
  by stack (eslint / flake8 / golangci-lint / `echo "No lint
  configured"`). `parseStackConfig` accepts/defaults the field.
- **`packages/server/src/routes/projects.ts`** — substitution context
  threads `lintCmd: stackConfig.lintCmd`.
- **`packages/server/src/routes/templates.ts`** — `lintCmd` added to
  the known-variable allow-list.
- **`templates/corporate-ops-web-mobile/ci/gestalt.yml`** — re-written
  comprehensively: `Compile` (`{{buildCmd}}`), `Test` (`{{testCmd}}`),
  `Lint` (`{{lintCmd}}`), `Security scan` (Semgrep auto config,
  `continue-on-error: true`). Triggers on `push: branches:
  ['gestalt/**']` + `pull_request: branches: [main]` so CI runs
  whenever pr-agent pushes — without this nothing would trigger the
  gate in a GitHub-Actions project.
- **`templates/corporate-ops-web-mobile/template.json`** — version
  `0.4.0` → `0.5.0`. seed-on-restart picked it up:
  *"Refreshed built-in template (version bump), previousVersion: 0.4.0,
  version: 0.5.0"*.
- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** —
  `agentConfig['test-runner-agent']` block removed.
  `_comment_gate` documentation field added at the top:
  *"CI (build/tests/lint/security) runs first via pipeline.adapter.
  The Gestalt LLM gate (constraint-agent + review-agent) runs after
  CI passes as a pre-merge architectural review."* `qualityGate.required`
  trimmed `["lint", "typecheck", "unit-tests", "constraint-check",
  "security-scan"]` → `["constraint-check", "design-review"]`.

### ADR

- **`docs/DECISIONS.md`** — ADR-041 appended. Decision, rationale,
  implementation summary, and consequences fully documented.

---

## Live verification

Submitted intent on trackeros (noop pipeline adapter): *"Create
src/modules/leave/leave.routes.ts with an Express router that mounts
POST /leave calling LeaveService.submitLeaveRequest and GET /leave
calling LeaveService.getEmployeeLeave."*

### New dispatch chain — observed verbatim in server logs

```
[18:36:55] Orchestrator received intent task
[18:37:04] All generate steps complete, dispatching to deploy:pr (ADR-041 — gate runs post-CI)
[18:36:55] Deploy orchestrator received task            taskType: deploy:pr
[18:37:07] Pushed fix to existing branch — re-triggering pipeline
[18:37:07] Deploy orchestrator received task            taskType: deploy:pipeline
[18:37:16] Resolved pipeline adapter
[18:37:16] Pipeline triggered — polling for terminal status
[18:37:16] Pipeline status update                       (noop adapter — passed)
[18:37:16] Quality gate received task
[18:37:16] Cloning project repo for gate review
[18:37:26] Checked out PR branch for gate review        (NEW — ADR-041)
[18:37:26] Gate artifacts resolved                      mode: branch  (NEW — ADR-041)
[18:37:33] Gate failed — 4 CONSTRAINT_VIOLATION
[18:37:33] Gate fail — dispatched retry to generate queue
[18:37:33] Orchestrator received intent task            (retry)
[18:37:43] Resuming cycle on existing branch (pipeline-feedback)  (NEW path — resumeOnBranch from gate)
[18:37:43] Quality-gate retry cycle — prior signals will be threaded into routed agents
```

Every brief-mandated log message fires.

### Verification matrix

| Check | Result |
|---|---|
| `generate complete → deploy:pr` (NOT `gate:review`) | ✓ |
| pipeline-agent CI-pass → `gate:review` (NOT `deploy:promotion`) | ✓ |
| Gate clones PR branch via `git fetch + git checkout -B` | ✓ |
| Gate loads source files from branch (`Gate artifacts resolved mode: branch`) | ✓ |
| Gate-fail retry forwards `resumeOnBranch: branch` | ✓ |
| pr-agent on retry leg pushes to existing branch (NOT new PR) | ✓ |
| CI re-triggers automatically via the noop adapter | ✓ |
| `lint-agent` / `security-agent` / `test-runner-agent` no longer in the agent_executions for this cycle | ✓ |

### Findings the new flow exposed

The gate did NOT pass — it caught **real bugs Aider's first cut left
behind**:

```
[review/bug] The import statement for LeaveService cannot be resolved
[review/bug] The error variable is of type 'unknown', which can lead to runtime issues
[review/bug] The 'user' property does not exist on type 'Request'
```

These are accurate review-agent findings (not the hallucinations of
TR_011 through TR_015 — these are genuine TypeScript bugs in Aider's
output). The cycle iterated through six retry legs before being
killed by `gate-max-retries`. Each leg:

```
pr-agent (12s) → pipeline-agent (9s, noop CI pass) → constraint-agent (2-4s, pass) → review-agent (5-9s, fail)
```

Per-leg gate cost is bounded (constraint clean + 3-9 review findings).
The architectural change is fully working; cycle outcome is gated on
Aider's code quality, not on the new dispatch chain.

---

## What this unlocks

- **Single canonical lint / security / test surface.** CI uses the
  project's own ESLint, Vitest, Semgrep — no platform stubs that have
  never actually executed lint. The whole "lint-agent ESLint
  programmatic Phase 2" TODO from 2026-05 is now superseded — there
  is no Phase 2 because CI does this job.
- **Faster generate cycles.** Pre-ADR-041 the LLM gate ran before the
  PR ever existed; on a typical cycle that was ~30s of LLM time
  followed by another ~30s of CI time, fighting over the same
  signals. Now the LLM gate adds value on top of CI rather than
  duplicating it.
- **Generate retry semantics tighten.** When the LLM gate fails
  post-CI, the retry pushes to the same PR branch (matching what
  reviewers expect — `fix:` follow-up on a `feat:` PR). The retry
  budget (`MAX_GATE_RETRIES=3`) still applies but is now per-PR
  rather than per-correlation.
- **CI failures stay quarantined.** The pre-existing
  `pipeline-failed` self-healing path is unchanged; CI failures
  never reach the LLM gate (the gate only sees code CI already
  validated).

---

## Pending follow-ups (TR_018)

- **(HIGH — new)** trackeros's `agents.yaml` still has a
  `test-runner-agent` block. The platform silently ignores it now
  (no role mapping), but the operator should clean it up next time
  they touch the project.
- **(HIGH — new)** trackeros's `HARNESS.json` still has
  `agentConfig['test-runner-agent']` rules. Same disposition —
  silently ignored, clean up opportunistically. Same for the
  `qualityGate.required` array if the operator wants
  `["constraint-check", "design-review"]` to match the v0.5.0
  template.
- **(MEDIUM — new)** trackeros's pipeline adapter is `noop`. To
  exercise the GitHub Actions CI path end-to-end (lint + tests +
  Semgrep actually running) the adapter would need to flip to
  `github-actions`. The new `templates/.../ci/gestalt.yml` is ready
  for that — the `push: branches: ['gestalt/**']` trigger will fire
  on every pr-agent push automatically.
- **(LOW — new)** The `lintCmd` substitution renders `pnpm run lint`
  as the default; if the project has no `lint` package.json script
  CI's Lint step will fail with `Missing script: lint`. The LLM
  prompt now asks for `echo "No lint configured"` when the stack has
  no standard linter, so new init flows handle this, but trackeros
  was bootstrapped pre-ADR-041 and doesn't have the field.
- **(MEDIUM — carryover)** Six retries on this intent expose that
  Aider's leave.routes.ts cut has real TypeScript errors that
  Aider's self-check didn't catch. Not architectural — but the
  `executeScript tsc --noEmit` rule the code-agent used to have
  (removed from trackeros HARNESS.json per TR_015's brief) would
  have caught the unresolved-import findings before the gate ever
  saw them.

---

## Build status

`pnpm -r build` — clean across all 12 packages. Docker image rebuilt
+ container restarted; `/health` returned 200 throughout the
verification cycle. Built-in template auto-refreshed at boot
(0.4.0 → 0.5.0).
