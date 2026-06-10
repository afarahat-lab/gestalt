# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md

_Auto-regenerated after every session by Claude Code. Do not edit by hand._

_Generated: 2026-06-10_

---


_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-10 (after TR_037 — planner-agent now injects architecture-agent's full JSON as a "Canonical type and symbol names" block at the top of its prompt, plus a HARNESS rule telling the planner to use those exact names. Architecture flows from architecture-agent → planner-agent → intent-agent without symbol-name drift. **Verified end-to-end on trackeros feature `ce9d1b80`**: planner-agent emitted Phase 1 scope "Create … defining the **canonical LeaveRequest type** … using the **fields id, employeeId, leaveType, startDate, endDate, and status**" matching architecture-agent's emitted entity verbatim; 5-phase plan (vs prior 7-8) with 4 interfaces + 5 success criteria + SQL schema in Phase 1's per-phase architecture; intent-agent did NOT escalate on a symbol-name conflict. Cycle still blocked at intent-agent, but on a DIFFERENT, more nuanced ambiguity — "The concrete persistence implementation backing LeaveRepository is not specified" — i.e. architecture-agent defined the `LeaveRepository` interface but didn't pin the concrete DB driver. New HIGH follow-up: architecture-agent should specify the concrete persistence implementation (e.g. `pg` Pool) from `HARNESS.stack.database`. Template `0.21.0 → 0.22.0`. Build clean across all 13 packages. **Earlier (TR_036 — gate-side fixes shipped, verification blocked at intent-agent before reaching the gate)** — four fixes against TR_035 verification findings. (Fix 1) Constraint-agent + review-agent rules in HARNESS rewritten to abstract layer-role language ("data access layer", "business logic layer"); concrete `pool.query` / `*.repository.ts` matchers removed. Both verificationGuidance blocks rewritten to "read ARCHITECTURE.md first; a finding is only valid if it violates a rule given the actual structure of this project". (Fix 2) New `buildProjectStructureBrief(projectRoot)` helper in `gate-orchestrator.ts` reads ARCHITECTURE.md (truncated to 2000 chars) + enumerates a depth-2 directory tree under `src/` using Node's `readdir` (equivalent to `find src -maxdepth 2 -type d`, bounded to 30 entries). The brief is set on `GateTask.projectStructureBrief` (new optional field on the type); constraint-agent's `buildVerificationPrompt` injects it before the rules section, llm-review-agent's `buildReviewPrompt` injects it at the top of the prompt. (Fix 3) Planner's `maxPhaseRetries` exhaustion path in `planning-orchestrator.ts` now creates a `feature-blocked` alert + emits `alert.created` SSE — previously it marked the feature `blocked` silently and operators only saw the failure via `gestalt feature show`. (Fix 4) trackeros `agents.yaml` `test-agent.goal` switched Vitest → Jest to align with the rest of the project's already-Jest tooling. Template `0.20.0 → 0.21.0`. Build clean across all 13 packages. **Live verification cycle escalated at intent-agent on a planner/architecture-agent symbol-name inconsistency BEFORE reaching the gate**, so Fixes 1+2 (gate-side) didn't get an LLM-level test; Fix 3's new alert call didn't fire (the cycle escalated via the existing TR_033 `waiting-for-clarification` path which already has its own alert). New HIGH follow-up: cross-check planner-agent vs architecture-agent symbol names. **Earlier (TR_035 — mechanisms 6/8 PASS, feature blocked by orthogonal gate constraint-agent false-positives)** — dynamic five-layer token budget management + phase-evaluator git detection via squash-merge SHA + architecture-agent 12k fallback floor. ADR-057 appended to `docs/DECISIONS.md` before implementing. **Part A**: `BaseLLMAgent` gains a five-layer pipeline on every LLM call. Layer 1 — model-aware defaults (reasoning models `o1`/`o3`/`gpt-5*` get 8k vs 2k standard). Layer 2 — dynamic budget (input × 1.5 for reasoning, × 0.5 standard, clamped by per-model hard limits). Layer 3 — scope reduction with three structural rewrites (`summarisePriorPhaseHistory`, `compressRulesSection`, `trimArchitectureContext`) when estimated input tokens exceed the configurable threshold (default 6000). Layer 4 — JSON response guard (`addJsonResponseGuard()` appended to prompts by the six structured-output agents: architecture-agent's `designFeature`+`designPhase`, planner-agent, phase-evaluator-agent, constraint-agent, review-agent, self-healing-agent). Layer 5 — truncation retry (re-issues the call on `finish_reason: 'length'` with a doubled budget, up to 3 attempts). `LLMResponse` extended with `finishReason`. New `HarnessConfig.tokenManagement` block (`promptCompressionThreshold` / `maxRetryBudgetMultiplier` / `enableDynamicBudget` / `enableScopeReduction`) tunes thresholds per project. Per-call telemetry persisted into `agent_execution_logs.token_management` (JSONB; migration 029). **Part B**: (B1) `architecture-agent.max_tokens` bumped 6k → 12k in trackeros `agents.yaml` as the fallback floor; Layers 2 + 5 handle higher cases. (B2) Phase-evaluator now prefers `git show --name-only --format= <mergeCommitSha>` over `git diff` — the existing `mergePullRequest` already returns the squash-merge SHA, so the promotion-agent's `maybeAutoMerge` now resolves `findPhaseByIntent → updatePhaseMergeCommit(phase.id, sha)` after the merge succeeds. New `FeaturePhaseRecord.mergeCommitSha` column (migration 029) + `FeatureRepository.updatePhaseMergeCommit` (postgres impl + oracle/mssql stubs). `PhaseBranchContext` extended; `evaluator-prompt.ts` prefers `git show` when SHA present, falls back gracefully. HARNESS template + trackeros `phase-evaluator-agent.rules` updated to teach the agent the new command. Template 0.19.0 → 0.20.0. Build: `pnpm -r build` clean across all 13 packages. **Live verification pending** for all 10 parts — needs `gestalt feature submit` cycle on trackeros to observe Layer N firings + `git show` path.

**Earlier (TR_034 — mechanisms verified, autonomous completion not achieved)** — scoped per-phase architecture replaces the full architecture context in the Aider message. `buildAiderMessage` dropped `## Project architecture` and `## Design context` in favor of a `## Scoped architecture for this phase` block built from architecture-agent's `designPhase()` JSON. New `updatePhaseArchitecture` repo method persists the JSON; `aider-code-agent.loadPhaseArchitectureForCycle()` reads it back. Template 0.18.0 → 0.19.0. Verified live on trackeros feature `45fe91b3`: per-phase pass fires, `readFiles` includes real shared/db paths, `messageBytes` 5705 → 2922, Phase 1 deployed via PR #119. **Same TR_033 failure mode persisted**: gpt-5.5 + Aider produced zero source code; architecture-agent's `designPhase` returned empty arrays so the scoped block was empty and dropped — Aider got task + rules + readFiles only. TR_035 Part B1 raises the floor to 12k; TR_035 Layer 4 frames the JSON contract.

**Earlier (TR_033 — partially verified)** — four targeted fixes pushing for full autonomous feature completion. **Verified live on trackeros feature `7ab81ea3`**: Fix 1 (`readFiles` now includes `PLAN.md + package.json + tsconfig.json + cross-language manifests`, existsSync drops Python/Go/Java on the TS project) and Fix 4 (escalation → phase failed + feature blocked + `feature-blocked` alert in one atomic sequence, zero manual cleanup) both confirmed end-to-end. Fix 2 + Fix 3 shipped in template + trackeros HARNESS but not verified live because the feature blocked at Phase 1 before reaching the routes phase. **Feature did NOT reach `completed`** — gpt-5.5 + Aider produced zero source code across 4 attempts (each PR added only `.aider.*` history + `.gestalt/` metadata + DOMAIN.md edits, nothing in `src/`), a new failure mode separate from the TR_028-32 hallucination pattern. Operator-side preflight cost three extra submissions: gpt-5.5 needs `responses` apiShape in `platform_llms` (brief was wrong), `max_tokens: 3000` truncated planner JSON at 74s (reasoning tokens count toward the budget — bumped to 6k/12k/8k/6k), and one transient `TypeError: fetch failed` killed an attempt because `classifyError` treats it as `retryable: false`. **Fix 1**: the base `readFiles` list in `aider-message-builder.ts` expanded from `['PLAN.md']` to also include `package.json` + `tsconfig.json` + `pyproject.toml` + `requirements.txt` + `go.mod` + `pom.xml` + `mypy.ini` + `.eslintrc(.json)`. The `existsSync` filter in `runAider` drops anything not present, so the same list works on TypeScript / Python / Go / Java projects without language-tagging the platform code. **Fix 2**: three language-agnostic rules appended to `agentConfig.code-agent.rules` in the **template** HARNESS — read dependency source before calling methods; read compiler/linter config before generating; read dependency manifest before importing. Examples list multiple ecosystems so the LLM doesn't pattern-match to TypeScript. **Fix 3**: one new rule on `agentConfig.phase-evaluator-agent.rules` in the template — when adjusting a routes/controller phase scope, cite the service/handler file it depends on. Closes the TR_032 Phase 3 root cause (routes scope didn't cite `leave.service.ts`, so `--read` couldn't inject it, so Aider invented method names). **Fix 4**: structural — `AlertType` gains `'feature-blocked'`, and the planning orchestrator's `intent.status-changed` subscriber now treats `waiting-for-clarification` + `escalated` as terminal-failure phase outcomes. New helper `markFeatureBlockedAfterEscalation` marks phase failed + feature blocked + appends `phase-escalated` to the plan log + emits a `feature-blocked` alert in one sequence. Closes the TR_032 gap where stuck intents left features `in-progress` indefinitely. Template 0.17.0 → 0.18.0. **Build**: `pnpm -r build` clean across all 13 packages. **trackeros HARNESS.json revert respected** — operator/linter rolled back the trackeros code-agent + phase-evaluator edits; template rules ship forward but trackeros needs manual operator patching before TR_033 Fix 2 + Fix 3 take effect there. **Live verification pending** for all four fixes.)

**Earlier (TR_032 — verified)** — three targeted Aider compliance fixes (Fix 1 `--read` flag; Fix 2 preservation in `.ts` schema; Fix 3 fix-intent broken-state framing). Template 0.16.0 → 0.17.0. **Verified end-to-end on trackeros 2026-06-09 (feature `fd844f7d`)**: Phase 1 + Phase 2 both deployed cleanly via the full Aider → CI → PR-Agent → gate → squash-merge chain (Phase 2 was the killer phase in TR_028 → TR_031 — first time it shipped). `readFiles` array log line confirms `--read` flag on every Aider invocation. Preservation footer present on both fix-intents. Phase 3 escalated on unrelated TS strict-mode + missing-service-method issues (the root cause TR_033 Fix 1 + Fix 3 target). Cascade brake at depth 2 fired correctly. Wall-clock submission → Phase 3 escalation: ~13 minutes. Detailed report at the prior session entry in `sessions/RECENT.md` (or archived to `sessions/archive/2026-06-w2.md` after rotation).

**Earlier (TR_030 + TR_031)** — combat Aider DTO-drift via Aider-message-builder additions and PLAN.md "What has been built" + context-only fix-intent. TR_030 added two generic behavioural prose blocks to `aider-message-builder.ts` (read-existing-files-before-generating; architecture-context-is-reference-only). TR_031 added a `## Read PLAN.md first` block to the message-builder (later removed by TR_032 Fix 1), extended `PhaseEvaluation` with a `builtFiles` field that the phase-evaluator-agent populates via git diff + readFile, and rewrote the `fixIntent` JSON-schema description in `self-healing-agent.ts` to require CONTEXT not PRESCRIPTION ("CI failed: TS error X. Files involved Y. Analyse and fix" — not "Update Z to add A"). Template 0.15.0 → 0.16.0. **Verified end-to-end on trackeros**: (a) PLAN.md gets a `**What has been built:**` section under each deployed phase listing files + key exports — confirmed on the third verification cycle (clean trackeros main, feature `35fb580e`); (b) fix-intent dispatched text is now context-only on both fix-intents in the cycle — no prescriptive "Update X to add Y" framing; (c) self-healing routes to fix-intent immediately on first CI failure; (d) TR_025 cascade-depth brake fires at depth 2. **Not verified**: Aider still didn't comply with read-before-generate consistently — Phase 2 service code hallucinated `ILeaveRepository` + imported non-existent sibling modules `../balance/`, `../employee/` despite PLAN.md's "What has been built" being on disk. The HARNESS preservation rule didn't reach the dispatched fix-intent text. Aider also inverted negation: fix-intent said "ILeaveRepository does not exist" → Aider created `ILeaveRepository`. **All three findings became TR_032 fixes above.**

**Earlier (TR_029) — added explicit "include prior-phase file paths in scope text" rules to `planner-agent.phaseScopingRules` + `phase-evaluator-agent.rules` to fix the TR_028 Aider DTO-drift blocker. Template 0.14.0 → 0.15.0. **Planner-side change verified end-to-end** — Phase 2's scope on the re-submitted leave-management feature explicitly cites `src/modules/leave/leave.model.ts` + `leave.repository.ts` by full path; Phase 1 correctly bundled model+repository (TR_023 rule honoured). Phase 1 deployed cleanly (PR #88, ~3m). **Aider-side gap surfaced**: even with the scope text explicitly saying "depends on src/modules/leave/leave.model.ts", Aider's Phase 2 service code hallucinated against the deployed Phase 1 files (`ILeaveRepository` vs `LeaveRepository`, `LeaveRequest.leaveType` vs `leaveTypeId`, imports of non-scheduled sibling modules `../balance/`, `../employee/`). 6 Aider runs across 3 phase attempts; self-healing chose pure `retry` every time (not fix-intent). Feature blocked at 1/4 phases. Two new HIGH follow-ups: (1) code-agent prompt must mandate readFile() on every cited path before generating; (2) architecture-agent's high-level module list is leaking into code-agent context and Aider imports from un-scheduled sibling modules.) Last full session report at `docs/claude/TEST_REPORT_028.md`; TR_028 is the prior milestone for end-to-end machinery.

**Earlier (TR_028) — milestone planning-loop re-test on the leave-management feature, verifying every TR_020 through TR_027 mechanism end-to-end in a single 19-min autonomous cycle. Phase 1 (model) deployed cleanly (Aider 5s → CI pass → PR-Agent 27s → verdict `none` → gate (constraint-agent only) → squash-merge, ~2m 44s). Phase 2 (repository) hit the known TR_023 Aider DTO-drift issue: repository code references model fields that don't exist (`leaveType` vs deployed `leaveTypeId`; `totalDays/usedDays/year` vs deployed `balance`). Self-healing's diagnostician correctly chose `action: 'retry'` for the first two cycles, then `action: 'fix-intent'` on the third (systemic gap detected). Fix-intent child dispatched + deployed in ~2m 25s (Aider 4s → CI pass → PR-Agent 24s → deploy → onSuccessDispatch envelope fired → parent resumed). But the fix-intent prompt didn't include a file path; Aider wrote a stray `/leave.model.ts` at repo root that tsc never resolves. Parent Phase 2 resumed → failed → planner retry budget exhausted → feature `blocked` at 1/4 phases. Two NEW HIGH follow-ups: (1) promoted TR_023 — planner must put model+repository in same phase OR code-agent must read existing model first; (2) self-healing fix-intent prompt enrichment — must include the failing import path and existing field shape. Architecture-agent / planner-agent / phase-evaluator-agent / PR-Agent / self-healing fix-intent + onSuccessDispatch / cascade-depth brake / phase retry budget all VERIFIED working as designed. TEST_REPORT_028.md in `docs/claude/`.)
**Repo:** https://github.com/afarahat-lab/gestalt
**Migrations:** 027 (latest: `027_self_healing_pr_agent`)

---

## What is built and verified

### Platform foundations

- All 13 buildable packages compile (`pnpm -r build`).
- `docker-compose up -d` brings server + postgres + redis healthy.
- All 27 migrations apply on first start.
- Server reachable on `http://localhost:3000`; `/health` returns 200;
  protected routes return 401 without a JWT.
- Dashboard SPA served at `/app/*`; shareable deep-link URLs work.
- First-boot bootstrap verified: `gestalt init-admin` → `gestalt login`
  → `/auth/me` returns the user.

### Five SDLC layers (all wired end-to-end)

- **generate** — intent → design → context → lint-config → code → test;
  custom agents in `agents.yaml` interleave via `runs_after`.
- **quality-gate** — constraint-agent (always) + review-agent
  (only on non-github-actions adapters or when `prAgent.enabled`
  is false). ADR-041 — gate runs AFTER CI, not before pr-agent.
  ADR-051 — when `prAgent.enabled && pipeline.adapter ===
  'github-actions'`, the gate skips review-agent because
  PR-Agent already reviewed the PR server-side between CI-pass
  and gate-dispatch. Gate clones the PR branch, checks it out,
  and reads source files directly from the working tree
  (`readFromBranch: true`). On pass dispatches `deploy:promotion`
  (staging); on fail forwards `resumeOnBranch` so the retry leg
  pushes to the same PR. Verdict: `pass` / `fail` (auto-retry) /
  `escalate` (GP_BREACH). Max gate retries: 3. Pre-CI lint/
  security/test-runner stubs deleted — CI uses the project's own
  ESLint / Vitest / Semgrep via the comprehensive `gestalt.yml`
  workflow template.
- **PR-Agent (ADR-051)** — CodiumAI PR-Agent invoked server-side
  by deploy-orchestrator between CI-pass and gate-dispatch as a
  subprocess (`/opt/pr-agent` venv via `pr-agent --pr_url=...
  review`). Receives Gestalt's resolved LLM credentials (Azure /
  OpenAI / Ollama) + project PAT via subprocess env vars for that
  one invocation only — never sees the vault or the registry.
  Posts a "PR Reviewer Guide" comment on the PR. pipeline-agent
  polls verdict via `GitHubActionsAdapter.getPrAgentVerdict` for
  up to 30s; `approved`/`none` → proceed to gate;
  `changes-requested` → invoke self-healing's `fix-intent` path
  via failure type `review-requested-changes` (migration 027).
  `.pr_agent.toml` generated at init time from HARNESS rules
  drives per-project review focus; regeneratable via
  `gestalt project config push-pr-agent-config`. Best-effort
  on subprocess failure (warns + proceeds).
- **deploy** — pr-agent → pipeline-agent → promotion-agent
  (staging → production). `PipelineAdapter` interface;
  `GitHubActionsAdapter` + `NoOpPipelineAdapter` implemented.
  ADR-034 production-requires-staging enforced. Auto-merge supported
  via `pipeline.autoMerge` in HARNESS.json.
- **maintenance** — drift / alignment / gc / evaluation, scheduled via
  `node-cron`. Context-file intents take a direct-fix path via
  context-fixer (path-guarded to `docs/*` + `AGENTS.md`).
  `MonitoringAdapter` (Prometheus / Datadog / NoOp).
- **planning** (migration 024) — three agents (architecture-agent /
  planner-agent / phase-evaluator-agent) drive an autonomous feature
  decomposition loop. Operator submits a feature; orchestrator clones
  the repo, runs architecture-agent for the high-level design, runs
  planner-agent for the phase plan, commits `PLAN.md` + appends to
  `docs/ARCHITECTURE.md`, then dispatches phase 1 as a regular
  `generate:intent`. The in-process event bus subscriber maps each
  phase intent's terminal status (`deployed` / `failed`) into a
  `planning:evaluate` dispatch; phase-evaluator-agent decides whether
  to continue, adjust remaining phases, or escalate. Bounded by
  `HARNESS.json.planner` (`maxPhasesPerFeature`, `maxFilesPerPhase`,
  `architectureReviewPerPhase`). All LLM guidance prose lives in
  `agents.yaml` (`prompt_extensions`) + `HARNESS.json.agentConfig`
  (`rules` / `architectureGuidance` / `phaseScopingRules` /
  `evaluationCriteria`) per ADR-042 — `.ts` carries only structural
  framing + JSON schemas.

### Identity + auth

- Local auth (non-production only, ADR-025).
- Kerberos / SAML / OIDC providers (ADR-024); `auth.config.json`
  primary source, HARNESS.json `identity` block fallback (ADR-040).
- Two-tier role model: platform roles (`platform-admin` | `user`),
  project roles (`project-admin` | `editor` | `reader`).
- Platform groups for bulk assignment (Brief 1, migration 018);
  effective project role = max of direct + group-derived.
- Server-side membership enforcement on every read + write endpoint;
  no-enumeration-leak rule (empty array, not 403).
- Hot-reload of identity providers without server restart
  (`POST /platform/identity/reload`).

### Platform admin surfaces

- **Users** — CRUD + deactivate + self-protection guards.
- **Projects** — platform-admin create / delete (with active-intents
  guard) / list with cross-project enrichment (members / intents /
  last activity).
- **Groups** — CRUD, members, project assignments with role
  precedence.
- **LLM registry** (migration 014) — per-row baseUrl / apiKeyEnv /
  apiShape (`chat-completions` vs `responses` for gpt-5/o1/o3).
- **Secrets vault** (migrations 015+016) — AES-256-GCM encrypted,
  master key at `/etc/gestalt/master.key` or
  `GESTALT_MASTER_KEY` env; rotation tooling (migration 021).
- **Self-healing** (migration 020) — 7 per-failure-type configs;
  diagnostician picks `retryTaskType` + hints; alerts auto-resolve
  at high confidence.
- **Templates** — harness templates table (migration 017) +
  download / duplicate / edit / push / diff (dashboard + CLI).
  Built-in templates read-only; duplicate first to customise.
- **MCP servers** — platform-wide MCP servers (`platform_mcp_servers`).
- **Self-healing** + **identity** dashboard tabs.

### Project lifecycle

- `gestalt init` registers project; server clones repo, generates
  stack config via LLM (`generateStackConfig`), substitutes
  variables into harness template, commits + pushes.
- Phase-1 project description accepts multi-line input via a
  three-mode chooser (single-line default / END-terminated /
  `$EDITOR`). The full body is passed verbatim into
  `generateStackConfig` and into the template's
  `{{projectDescription}}` substitution. Template engine
  JSON-escapes substituted values when the target file is `.json`
  (engine.ts `substitute(..., { jsonEscape: true })`) so newlines
  + quotes + control chars in the description land safely inside
  HARNESS.json string literals; markdown / yaml files keep raw
  newlines.
- Vault-backed Git PATs (migration 022) — operators link a vault
  secret to a project; resolver decrypts server-side per-cycle.
- GitHub repo browser via `/platform/git/repos` proxy.
- Dynamic harness — LLM picks language / framework / package
  manager / test runner at init time.

### Agent infrastructure

- `BaseLLMAgent` in `@gestalt/core/agents` — every LLM-using agent
  in every layer extends it. Captures `lastPrompt` /
  `lastLlmResponse` / `lastModelUsed` / `lastTokensUsed`
  (accumulated across every LLM call inside one `run()`).
- Built-in file tools (ADR-038, migration 012): `readFile`,
  `listDirectory`, `searchFiles`, `getFileTree`. Read-only,
  path-traversal-guarded.
- MCP integration (ADR-039) — external tool servers per-agent in
  `agents.yaml`. Namespace prefix prevents collision with built-ins.
- Per-agent LLM model override + tools.builtin + tools.mcp +
  prompt_extensions, all driven by `agents.yaml` in the project repo.
- Custom agents (ADR-037) — prompt-only LLM runners declared by the
  project; topo-sorted via `runs_after`.
- Section-based prompts (architecture / constraints / scope /
  design / intent / principles / domain / signals / task) — every
  LLM-generating agent opens with non-negotiable rules.

### Observability + operator surfaces

- Per-agent `agent_executions` + `agent_execution_logs` rows
  (migration 007 + 009 + 012) with prompt / response / model /
  tool calls / **tokens used** (BaseLLMAgent's `lastTokensUsed`
  accumulator wired through the generate + gate orchestrators
  on 2026-06-04; deploy + maintenance are non-LLM today).
- Live event bus (`@gestalt/core/events`) → SSE at
  `/events`. Dashboard subscribes for instant updates.
- IntentDetail accordion with prompt + LLM response + tool calls
  + signals + artifacts.
- Active agents card with cycle progress + token totals.
- Deployments view: 4/5-node pipeline timeline (5th node for
  auto-merged cycles).
- Maintenance view: per-run findings expansion panel.
- Alerts: per-type bodies + interventions (ADR-021).
- Pipeline failure alerts with operator feedback → resume on the
  same branch (migration 019).
- Operator-driven CLI parity: `gestalt run --watch` /
  `gestalt intent / gate / deploy / agents active /
  maintenance / status --graph --watch`.

### CLI

- Bootstrap: `init-admin`, `login`, `init`, `run`, `status`, `logs`.
- Project: `projects list/use/set-adapter/update-token`;
  `project config show/set-agent/set-pipeline/add-custom-agent/...`
- Alerts: `alerts list/show/fix/dismiss/resume/abort/acknowledge/
  pipeline-feedback`.
- Platform admin (gated to platform-admin): `users`,
  `platform llms / secrets / projects / templates / mcp /
  tools / identity / groups / self-healing`.
- Intent: `intent list/show/submit` with `--watch` + filters
  (`--source`, `--priority`, `--search`, `--from`, `--to`).
- Templates push + diff (added 2026-06-04).
- Shared multi-line prompt helpers in `@gestalt/cli/ui/prompts`:
  `promptMultiline` / `promptWithEditor` /
  `promptMultilineDescription`. Used by `gestalt init` (Phase 1
  description) and `gestalt project config add-custom-agent`
  (prompt body). Backwards-compatible single-line default.

---

## Implemented with caveats

- **Quality-gate** — ADR-041 (TR_018): pre-CI lint / security /
  test-runner stubs were deleted. Gate now runs `constraint-agent`
  + `review-agent` AFTER CI passes, reading source files directly
  from the PR branch. CI owns lint / unit-tests / security scan
  via the project's own tooling.
- **Deploy** — `GitHubActionsAdapter` + `NoOpPipelineAdapter` are
  the only implementations. Azure DevOps / GitLab CI / Jenkins
  are typed stubs in the `PipelineAdapterType` union.
- **Maintenance** — `Prometheus` / `Datadog` `MonitoringAdapter`
  implementations exist but aren't yet verified against a real
  monitoring instance. NoOp is the verified path.
- **Identity** — Local + OIDC verified end-to-end via the
  Keycloak fixture. SAML compiles + the route shape is verified
  but full end-to-end against a real IdP only exercised once.
  Kerberos provider compiles; not exercised end-to-end (needs a
  real AD + krb5.keytab).

---

## What is not yet built

- `@gestalt/adapter-oracle` — every repository method throws.
- `@gestalt/adapter-mssql` — every repository method throws.
- `@gestalt/registry` — types + client only; no server, no UI.
- Non-GitHub `PipelineAdapter` impls (Azure DevOps / GitLab CI /
  Jenkins).
- GitLab / Azure DevOps / Bitbucket support in
  `/platform/git/repos` (GitHub only today).
- LDAP group lookup for Kerberos identities (Kerberos tickets
  carry user only; groups need AD query).

---

## Active follow-ups (small)

### TR_035 — Dynamic token budget management (ADR-057)

Five-layer pipeline added to `BaseLLMAgent.callLLMWithMessages`
(and `runToolLoop` for Layers 1+2): model-aware defaults,
dynamic budget, scope reduction with three structural rewrites,
JSON guard, truncation retry. Knobs in
`HARNESS.json.tokenManagement` — absent → all five layers run
with baked-in defaults. Telemetry in
`agent_execution_logs.token_management` (migration 029).
`architecture-agent` bumped to 12k as fallback floor.
Phase-evaluator now reads files via `git show <mergeCommitSha>`
when present; `feature_phases.merge_commit_sha` populated by
the promotion-agent post-merge. Template 0.19.0 → 0.20.0.
**Live verification pending** — runtime telemetry to confirm
each layer fires as designed.

### TR_030 + TR_031 — Combat Aider DTO drift (in-flight)

**TR_030**: added two generic prose instructions to
`aider-message-builder.ts` — read-existing-files-before-
generating + architecture-context-is-reference-only.
Platform mechanic, no HARNESS change, no migration.

**TR_031**: added a `## Read PLAN.md first` section to the
message-builder; extended `PhaseEvaluation` with `builtFiles`
(populated by phase-evaluator-agent via git diff + readFile);
rewrote the `fixIntent` JSON-schema description in
`self-healing-agent.ts` to require CONTEXT-only fix-intent
text (no prescriptive "Update X to add Y"). Added a HARNESS
preservation-rule bullet for self-healing-agent. Template
0.15.0 → 0.16.0.

**Verified end-to-end** on a clean trackeros main: PLAN.md's
"What has been built" section populates correctly; fix-intent
text is now context-only; self-healing routes to fix-intent
immediately on first CI failure; TR_025 cascade brake fires
at depth 2.

**Not verified**: Aider compliance with the read-before-
generate prose. Phase 2 still hallucinated `ILeaveRepository`
and imported non-existent sibling modules. The HARNESS
preservation rule didn't reach the dispatched fix-intent
text (the LLM didn't append the preservation footer). Two
new HIGH follow-ups in the carryover bullets list.

### TR_029 — Planner+evaluator prior-phase path rules (HARNESS only)

Two `phaseScopingRules` items and one `phase-evaluator-agent`
rule added to mandate explicit prior-phase file paths in scope
text. Template 0.14.0 → 0.15.0. **Planner-side verified
end-to-end** on the re-submitted leave-management feature:
PLAN.md `Phase 2` cites `src/modules/leave/leave.model.ts` +
`leave.repository.ts` by full path; Phase 1 correctly bundled
model+repository (TR_023 rule honoured this time); Phase 1
deployed in ~3 minutes through Aider → CI → PR-Agent → gate
(PR #88). **Aider-side gap surfaced**: even with the scope text
explicitly saying "depends on src/modules/leave/leave.model.ts",
Aider hallucinated `ILeaveRepository` (vs `LeaveRepository`),
`LeaveRequest.leaveType` (vs `leaveTypeId`), and imports from
non-scheduled `../balance/` `../employee/` modules. 6 Aider runs
× 3 phase attempts; self-healing chose `retry` every time; feature
blocked at 1/4 phases. The fix in this session is partial; the
deeper fix is in the new HIGH follow-ups below (code-agent prompt
+ architecture-agent context scoping).

### TR_028 — Full planning-loop re-test (TEST_REPORT_028.md)

Milestone test on the leave-management feature. Every TR_020
through TR_027 platform mechanism verified working end-to-end
in a single 19-minute autonomous cycle. Phase 1 deployed
cleanly through architecture-agent → planner-agent → PLAN.md
commit → Aider → CI → PR-Agent → gate (constraint-agent only,
ADR-051 skip) → promotion. Phase 2 hit the known TR_023 Aider
DTO-drift; self-healing's diagnostician routed retry → retry →
**fix-intent** as designed; fix-intent child deployed in
~2m 25s with `onSuccessDispatch` envelope resuming the parent;
but the fix-intent prompt lacked path specificity so Aider
landed a stray repo-root file. Feature blocked at 1/4 phases.
Full report at `docs/claude/TEST_REPORT_028.md`.

### TR_027 — PR-Agent replaces review-agent (ADR-051)

CodiumAI PR-Agent invoked server-side via `executeScript` after CI
passes; replaces Gestalt's custom review-agent on the github-actions
adapter. No CI step, no webhook, no GitHub Secrets for LLM keys —
credentials forwarded per invocation via subprocess env vars.
PR-Agent runs in `/opt/pr-agent` venv (isolated from Aider's
`/opt/aider` because of incompatible litellm versions);
`/usr/local/bin/pr-agent` is a shell shim. Verdict polled via
GitHub PR-Reviews/Comments API; `changes-requested` routes through
self-healing's `fix-intent` mechanism (new failure type
`review-requested-changes`, migration 027). `.pr_agent.toml`
generated from HARNESS rules at init time. New
`gestalt project config push-pr-agent-config` for harness updates.
Gate orchestrator skips review-agent under prAgent.enabled +
github-actions; constraint-agent still runs. llm-review-agent.ts
`@deprecated` (kept for non-GH adapters). Template 0.12.0 →
0.14.0. Live verified on trackeros PR #81: Aider 6s → CI pass →
PR-Agent 23.5s → verdict `none` → gate (constraint-agent only) →
deploy. Wall-clock 2m 04s.

### TR_026 — Remove platform file-change detection (ADR-050 enforcement)

The platform no longer parses Aider's stdout or computes
file-change diffs. Agents discover changes via git.

- **AiderAdapter**: `parseAiderChangedFiles` deleted,
  `filesChanged` removed from `AiderResult`, `--yes` →
  `--yes-always`.
- **AiderCodeAgent**: new `discoverAiderWrites` helper runs
  `git status --porcelain` in the Aider work-dir and emits
  the changed files as code artifacts. The AGENT calls git
  (per ADR-050); the platform never interprets natural
  language.
- **Phase-evaluator-agent**: signature changed to take
  `branchContext: { defaultBranch, phaseBranch }`; prompt
  rewritten to instruct the agent to run `git diff` via
  executeScript; switched to `callLLMWithTools` so the
  tool-use loop runs.
- **PER_ROLE_DEFAULTS** extended with architecture-agent /
  planner-agent / phase-evaluator-agent so executeScript is
  available out of the box for the planning layer.
- **HARNESS.json + agents.yaml** updated on template +
  trackeros with the new git-diff-only rules.

**Live verified**: feature `7d77f659` — Aider's writes
(`leave.model.ts` + test) now make it into the PR commit
end-to-end. Phase-evaluator's verdict text quotes the
HARNESS.json git-diff rule, confirming the agent followed
the new path. Full feature completion still blocked by
trackeros's stale `leave.repository.ts` from earlier cycles.

### TR_025 — Cascade-depth brake + phase-evaluator file-list (RESOLVED structurally by TR_026)

The TR_025 file-list logic was platform code interpreting git
output — TR_026 deleted it and gave the work to the agent.
The cascade-depth brake (`MAX_FIX_INTENT_DEPTH = 2`) stays
in `self-healing-loop.ts`.

### TR_024 — Autonomous systemic gap detection (migration 026)

Self-healing diagnostician extended with `action: 'retry' |
'fix-intent' | 'escalate'`. When the LLM picks `fix-intent` it
writes a complete Aider-ready intent text; the platform submits
it as a separate `source: 'self-healing-fix'` cycle, links via
`parent_intent_id`, and persists an `on_success_dispatch`
envelope. After production promotion, the deploy-orchestrator
dispatches the envelope verbatim to resume the parent.
ADR-050 — the `action` field is the SOLE routing decision; no
hardcoded failure-pattern matching anywhere. Live verified on
trackeros with a prom-client missing-dependency intent —
self-healing correctly chose `fix-intent` and submitted a child
intent. Template 0.10.0 → 0.11.0.

### PLANNING_LAYER — Autonomous feature decomposition (migration 024)

New `@gestalt/agents-planning` package + `planning:start` / `planning:phase`
/ `planning:evaluate` task types on a new `gestalt-planning` BullMQ
queue. Three new agent roles (architecture-agent / planner-agent /
phase-evaluator-agent), three new postgres tables (features /
feature_phases / feature_plan_log), `POST /features` route, and
`gestalt feature submit/list/show` CLI commands. The orchestrator
loop: clone repo → architecture-agent → planner-agent → write
PLAN.md → commit + push → dispatch phase 1 as `generate:intent` →
event-bus subscriber catches terminal status → planning:evaluate
→ phase-evaluator-agent → either next phase, mark feature
completed, or block. Strict ADR-042 compliance — every guidance
prose string lives in `agents.yaml.prompt_extensions` or
`HARNESS.json.agentConfig[role]` (`rules` / `architectureGuidance`
/ `phaseScopingRules` / `evaluationCriteria`); only structural
framing + JSON schemas live in `packages/agents/planning/src/prompts/`.
Live verified on trackeros: feature `ea19b18e` ran the full loop
end-to-end against real GitHub Actions CI (CI failed due to a
pre-existing code-agent issue; the planning loop correctly marked
the phase failed and the feature blocked). Template bumped
0.7.0 → 0.8.0.

### Historical (TR_020 / TR_021)

Rotated to `sessions/archive/`. TR_020 was trackeros's first
clean `Status: ✓ deployed` on the real `github-actions` adapter
(PR #54, 1m 58s). TR_021 externalised verificationGuidance to
HARNESS.json. See `docs/claude/TEST_REPORT_020.md` and the
archive for the full diffs.

### Active follow-ups (carryover or NEW)

- **(HIGH — NEW from TR_031)** Move the preservation
  requirement from the HARNESS `self-healing-agent.rules`
  bullet into the `fixIntent` JSON-schema description in
  `buildDiagnosisPrompt`. The HARNESS rule was added in
  TR_031 but the diagnostician LLM didn't honour it in
  two consecutive fix-intent dispatches — neither ended
  with the preservation footer. Schema-string guidance
  reliably influences output; HARNESS bullets are advisory.
- **(HIGH — NEW from TR_031)** Pass `--read PLAN.md` and
  `--read <every-scope-cited-path>` to Aider's CLI
  invocation. Forcing a file into Aider's context window
  is dramatically stronger than a prose "please read this
  first" instruction. TR_030's read-before-generate
  instruction is in the prompt; TR_031's PLAN.md "What
  has been built" is on disk; Aider still hallucinates
  symbol names.
- **(MEDIUM — NEW from TR_031)** Stale-file pollution on
  trackeros main. When a feature is blocked, files from
  deployed phases stay on main. The next cycle's Aider
  reads them as ground truth and tries to compose around
  them, introducing new conflicts. Options: (a) a
  `gestalt feature reset` command that un-merges deployed
  phases; (b) PLAN.md tracks "files owned by this feature"
  and a cleanup-on-block step git-rms them.
- **(MEDIUM — NEW from TR_031)** Phase-evaluator-agent
  hallucinated `verdict: escalate` with `toolCallCount: 0`
  on the first verification cycle. The `callLLMWithTools`
  loop should reject responses where the agent's JSON
  claims tool-derived evidence ("confirmed by git diff")
  but the model didn't invoke any tools.
- **(MEDIUM — NEW from TR_030/TR_031)** Aider doesn't
  reliably parse negated assertions. Fix-intent text said
  "X does not exist" — Aider created X. The diagnostician's
  prompt should be framed as POSITIVE assertions ("Use
  `LeaveRepository` which exists at `src/modules/leave/
  leave.repository.ts`") rather than negations.
- **(LOW — NEW from TR_031)** Phase-branch is deleted on
  squash-merge before phase-evaluator runs against it.
  `git diff origin/<default>...origin/<phaseBranch>`
  returns empty when the branch is gone. Pass the merge
  SHA in `branchContext` instead.
- **(HIGH — NEW from TR_029)** Aider code-agent prompt must
  mandate `readFile()` on every path mentioned in the phase
  scope BEFORE generating any code. TR_029 verified the
  planner now emits prior-phase paths verbatim ("This phase
  depends on src/modules/leave/leave.model.ts"), but Aider
  receives this text and proceeds to generate without
  reading the cited files. Result: hallucinated symbol names
  (`ILeaveRepository` vs deployed `LeaveRepository`) and field
  names (`leaveType` vs deployed `leaveTypeId`). Options:
  (a) extend HARNESS `code-agent.rules` with a "Before
  writing any code, call readFile on every path mentioned
  under 'Depends on:' in the scope" rule; (b) pre-fetch
  cited-path contents and inline them in the code-agent
  prompt assembler; (c) use Aider's `--read` flag for
  explicit file-list injection.
- **(HIGH — NEW from TR_029)** Architecture-agent's
  high-level module list ("Modules: leave / balance /
  policy / employee — each owns these files...") leaks into
  Phase N's code-agent context. Aider treats it as ground
  truth and tries to import from sibling modules the
  planner never scheduled (e.g. `../balance/balance.model`,
  `../employee/employee.model`). Either (a) scope the
  code-agent context strictly to the planner's phase
  description (exclude architecture-agent's broader output),
  or (b) the planner's scope text must explicitly say "DO
  NOT import from modules outside this phase's file list".
- **(MEDIUM — NEW from TR_029)** Self-healing's `retry` vs
  `fix-intent` routing decision is opaque to operators. In
  TR_028 the diagnostician chose `fix-intent` for an Aider-
  quality failure; in TR_029 it chose `retry` every time on
  a similar failure pattern. Decision is LLM-driven
  (ADR-050) so variance is expected, but the `technicalDetail`
  field populated by `collectCiTechnicalDetail` should be
  surfaced on the alert page so operators can see the
  diagnostician's reasoning chain.
- **(HIGH — NEW from TR_028, promotes TR_023)** Planner must
  reliably put `model + repository` in the same phase, OR
  code-agent prompt must mandate "READ the imported model
  file before writing the repository". Partially addressed
  by TR_029 — the planner now bundles model+repo, but
  Aider still doesn't read the model when writing the
  service in the next phase. The "READ the imported model"
  half of this item is now the TR_029 follow-up above.
- **(HIGH — NEW from TR_028)** Self-healing fix-intent prompt
  enrichment. When the diagnostician chooses `fix-intent` it
  should include the exact failing import path + the deployed
  model's actual field shape in the child intent text. TR_028's
  fix-intent dispatched a "Define type X with properties A, B,
  C" prompt without saying WHERE to put the file. Aider wrote
  a stray `/leave.model.ts` at repo root that tsc never
  resolves, so the resumed parent failed identically.
- **(MEDIUM — NEW from TR_028)** Phase-evaluator's `partial`
  verdict + scope adjustments work — PLAN.md gets updated —
  but the adjustments don't feed back into the planner's
  "phase grouping" decisions. If the evaluator notices "Phase
  1 only created the model, repository still needed", it
  could merge model+repository into one phase rather than
  annotating the next.
- **(LOW — NEW from TR_028)** The fix-intent flow logs "Fix
  deployed — resuming original intent via onSuccessDispatch"
  but doesn't emit a clear "parent resumed → Aider running"
  message at the resume point. Operators see two `Running
  Aider` log lines back-to-back and have to correlate by
  intent ID.
- **(HIGH — NEW from TR_026/TR_027)** Stale repository files
  on trackeros main keep returning from earlier auto-merged
  Phase 1 cycles. Either planner must reliably put model+
  repository in the same phase (TR_023's rule enforced),
  or self-healing-agent needs to recognise "TS error in
  file Aider didn't write this cycle = systemic gap" and
  choose fix-intent. Today every cycle on trackeros loops
  in this state.
- **~~(HIGH — TR_025/TR_026)~~ RESOLVED by TR_026.** Aider's
  "Files changed: 0" silent failure — now caught by git
  status in `discoverAiderWrites`. The Aider stdout
  pathology is bypassed entirely.
- **(LOW — TR_027)** PR-Agent verdict-poll budget (30s, 6×5s)
  is fixed in code; could be threaded into HARNESS.json's
  `prAgent.pendingTimeoutSeconds` (field already exists in the
  type).
- **(LOW — TR_027)** `chat-latest` works as a litellm model
  alias because OpenAI resolves it at the API edge. Other
  providers (Anthropic, Ollama) need their own alias semantics —
  document as a known constraint of per-project LLM choice.
- **(MEDIUM — TR_025)** Cascade-depth brake escalation path
  (MAX_FIX_INTENT_DEPTH) only verified at build/typecheck; a
  targeted force-fail-twice test would close it.
- **(MEDIUM — TR_024)** `collectCiTechnicalDetail` is GH-only.
  Azure DevOps / GitLab adapters silently lose the actual error
  text.
- **(LOW — TR_024)** Dashboard could render the full fix-intent
  chain on IntentDetail (today: direct parent/child only).
- **(HIGH — TR_022)** Aider DTO-field hallucination — generated
  code references fields not present on the DTO. Either extend
  code-agent prompt with a "READ the DTO file first" rule or
  require model + repository in the same Aider call. Tracked as
  TR_023.
- **(LOW — TR_022)** `readMaxPhaseRetries` re-clones HARNESS.json
  on every failure dispatch; cacheable per-feature.
- **(LOW — PLANNING_LAYER)** Phase scope adjustments stored under
  `feature_phases.result.pendingScopeAdjustment`. Consider a
  dedicated `scope_history` array if operators need full history.
- **(LOW — TR_021)** Consider migrating `consistencySection`
  cross-artifact checks out of `llm-review-agent.ts` into
  HARNESS.json verificationGuidance (borderline platform-mechanic).
- **(MEDIUM — TR_019)** `gestalt init` should scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest with TypeScript.
- **(LOW — TR_019)** Template `{{ciSetupSteps}}` for Node/npm
  should add `--legacy-peer-deps` until the upstream npm
  arborist bug is fixed.
- **(LOW — TR_019)** Add a `tsc --noEmit` sanity check on
  scaffolded tests in `gestalt init`.

### Carryovers (TR_018 / TR_014)

- **(HIGH — TR_018)** Restore TR_010 mandatory `executeScript tsc
  --noEmit` code-agent rule on trackeros's HARNESS.json. Pre-emit
  during Aider's generation (CI catches the same post-hoc).
- **(MEDIUM — TR_014)** Aider token-spend visibility. Parse
  `Tokens: N sent / M received` from stdout. code-agent rows
  still show 0 tokens.

### Tool integration roadmap

These integrations are agreed and recorded here so future
Claude Code sessions know the intent. Implement in priority order
after current work stabilises.

**Priority 1 — Qodo Gen (test generation)**
Replace the custom test-agent with Qodo Gen (by CodiumAI,
same vendor as PR-Agent). Qodo Gen analyses generated code
and produces comprehensive unit tests, mocks, and edge cases.
Supports local models via Ollama/vLLM — compatible with
enterprise data residency requirements.
Integration path: run via executeScript after Aider generates
implementation files. Same pattern as Aider integration.
ADR candidate: "Qodo Gen replaces test-agent in generate layer"
(ADR-053 — Accepted, pending implementation).

**Priority 2 — SWE-agent (bug fixing)**
Princeton's autonomous bug-fixing agent. Given a bug report,
it reproduces the error, writes a failing test, fixes the code,
and verifies the fix. Complement to Gestalt's maintenance layer.
Integration path: dispatch SWE-agent for bug-fix MaintenanceIntents
instead of Aider. Fix still goes through Gestalt CI + gate pipeline.
Prerequisite: verify self-hosted support for Azure OpenAI / Ollama backends.
ADR candidate: "SWE-agent handles bug-fix maintenance intents"
(ADR-054 — Accepted, pending implementation).

**Priority 3 — K8sGPT (Kubernetes operations layer)**
CNCF project that scans Kubernetes clusters, diagnoses failing
pods, crash loops, and misconfigured ingress in plain English.
Native support for Ollama and LocalAI — cluster telemetry
never leaves the infrastructure. Directly addresses enterprise
operations teams in the GCC/MENA target market.
Integration path: K8sGPT webhook → Gestalt maintenance layer
webhook endpoint → MaintenanceIntent → Aider fixes K8s manifests
→ CI validates → deploys.
Requires: new Kubernetes operations layer in the platform.
ADR candidate: "K8sGPT feeds Gestalt Kubernetes operations layer"
(ADR-055 — Accepted, pending implementation).

**Deferred — Sourcegraph (code search for drift-agent)**
Self-hosted code intelligence platform with MCP server.
Intended to replace executeScript/ripgrep for drift-agent
and alignment-agent when codebase scale demands it.
Integration path: add Sourcegraph service to docker-compose.yml,
register MCP server in platform_mcp_servers, give drift-agent
and alignment-agent access via agents.yaml.
Prerequisite: current executeScript/ast-grep approach is
sufficient at trackeros scale. Revisit when project codebases
exceed ~100 files.
ADR candidate: "Sourcegraph provides semantic code search for maintenance agents"

**Ruled out — Bloop.ai**
BloopAI/bloop repository archived January 2, 2025. Company
pivoted to a different product. Do not use.

**Ruled out — OpenHands (formerly OpenDevin)**
General-purpose autonomous agent — competitor to Gestalt's
planning layer, not a complement. Lacks governance, quality
gate, audit trails, and enterprise identity integration.

**Ruled out (for now) — GitHub Spec Kit**
Not self-hostable — blocked for GCC/MENA enterprise customers
with data residency requirements. Revisit if self-hosted option
becomes available.

### Architecture follow-ups (all LOW unless marked)

Pruned to top items; see `sessions/archive/` for the full
historical list.

- Retry cycle full re-runs all generate agents — skip
  intent/design/context when artifacts in Git tip.
- `qualityGate.maxRetries` + `planner.maxPhasesPerFeature`
  hardcoded fallbacks (3 / 10) — wire through HARNESS reads
  for projects that override.
- Promotion workflow dispatches against hardcoded `'main'` ref.
  Projects on `master` / `trunk` will fail.
- No proactive PAT-scope validation at registration.
- Encrypt Git PATs at rest in legacy `project_git_credentials`.
- LLM model name not validated at startup.
- (MEDIUM, TR_004) test-agent punts on method coverage.

### Product backlog

Forward-looking product work — items that change platform UX
or surface area beyond bug-fixes and Aider-quality follow-ups.
Grouped by surface (Dashboard, CLI, etc).

#### Dashboard

#### HIGH — Dashboard: feature/intent tracking redesign

The current dashboard tracking is agent-centric and hard to
interpret. Required redesign keeps agents visible but makes
them expandable with a full execution trace.

**Feature view:**
- Feature card shows: title, description, overall status,
  phase progress (e.g. "3 of 5 phases deployed")
- Expanding a feature shows phases in order
- Each phase shows: status, PR link, deploy time, files created
- Phase in progress shows live agent activity
- Files accessible from phase: PLAN.md, phase scope,
  architecture, phase result — readable in dashboard

**Intent/phase detail view — agent tree with execution trace:**
- Starts with the input (what was submitted)
- Shows agents in execution order as an expandable list
- Each agent row shows: name, status (running/complete/
  skipped/failed), duration, token count
- Expanding an agent shows its full execution trace,
  sorted by time:
  - Prompt sent to LLM (rendered as readable text,
    with option to view raw)
  - Each tool call: tool name, input, output, duration
  - LLM response: rendered as readable narrative,
    with option to expand to raw JSON
  - Decisions made: what the LLM decided and why
    (extracted from the response)
  - Artifacts created: files written, signals emitted
  - Self-healing actions: what failed, what the
    diagnostician decided, what fix-intent was submitted,
    what happened to it — fully audited and visible

**Readable format principle:**
- LLM output rendered as formatted text by default
- "View raw JSON" toggle available on every LLM response
- "View file" link on every artifact reference
- Tool call inputs/outputs collapsed by default,
  expandable inline

**Alerts redesign (aligned with above):**
- Full failure trace: which agent, which step, what error
- LLM RCA and recommendations visible inline
- Self-healing action audit: what was diagnosed, what
  action was taken, what the outcome was
- Links to relevant files directly from the alert
- "What do I need to do" section when human action required

#### LOW — Dashboard: agents view as interactive tree

Replace the current flat agents card with a hierarchical
tree view showing all available agents organised by layer:

```
Platform agents
├── Planning layer
│   ├── architecture-agent     ● active — feature ea19b18e
│   ├── planner-agent          ○ idle
│   └── phase-evaluator-agent  ○ idle
├── Generate layer
│   ├── intent-agent           ○ idle
│   ├── design-agent           ○ idle
│   ├── context-agent          ○ idle
│   ├── code-agent (Aider)     ● active — intent 3a114a1d
│   └── test-agent             ○ skipped (Aider mode)
├── Gate layer
│   ├── constraint-agent       ○ idle
│   └── review-agent           ○ deprecated (PR-Agent active)
├── Deploy layer
│   ├── pr-agent               ○ idle
│   ├── pipeline-agent         ○ idle
│   └── promotion-agent        ○ idle
├── Maintenance layer
│   ├── drift-agent            ○ idle
│   ├── alignment-agent        ○ idle
│   ├── gc-agent               ○ idle
│   └── evaluation-agent       ○ idle
└── Self-healing
    └── self-healing-agent     ○ idle
```

Behaviour:
- Active agents show a live indicator (●) with the intent
  or feature ID they are currently processing
- Hovering over an active agent opens a small popover with:
  current step, tokens used so far, elapsed time, and
  the intent text (truncated)
- Clicking an active agent navigates to the IntentDetail
  view for the intent it is processing
- Idle agents show (○) — clicking shows the agent's last
  execution (most recent IntentDetail that used this agent)
- Skipped/deprecated agents shown in muted style with reason
- Custom agents (from agents.yaml) appear under their
  respective layer with a "custom" badge
- Tree state persists across navigation (collapsed/expanded)
- Updates in real time via SSE — no polling needed

This replaces the current "Active agents" card on the
dashboard home and the flat agent list in the agents tab.

#### Platform

#### MEDIUM — LangGraph.js migration (ADR-056)

Replace custom agent orchestration with LangGraph.js. See
ADR-056 for full rationale and what was evaluated.

Prerequisites:
- TR_034 complete (planning loop reaches `completed`).
- At least one full feature completes autonomously.

Phase 1 — Generate layer:
- `BaseLLMAgent` becomes a LangGraph node.
- Generate orchestrator becomes a `StateGraph`.
- LangGraph PostgreSQL checkpointer handles state
  persistence. No custom checkpoint table is added.
- File tools replaced with LangChain `FileManagementToolkit`.
- Aider wrapped as a LangChain `StructuredTool`.
- `executeScript` kept as a custom `StructuredTool` (preserves
  the ADR-050 safety blocklist).

Phase 2 — Planning layer:
- Planning orchestrator becomes a `StateGraph`.
- architecture-agent becomes a subgraph (enables architecture
  crew in future per ADR-049).
- LangGraph `interrupt()` replaces custom escalation.

Phase 3 — Gate layer.
Phase 4 — Deploy layer.
Phase 5 — Maintenance layer.

BullMQ stays as the inter-layer transport. LangGraph runs
inside BullMQ workers. TypeScript server, dashboard, CLI
unchanged. HARNESS.json + agents.yaml unchanged (ADR-042).

---

## Operator caveats / pending actions

### trackeros state (current)

- **trackeros `main`** at commit `b99e1716` (post-TR_022
  HARNESS.json restored — `architectureReviewPerPhase: false`,
  `maxPhaseRetries: 2`). Pipeline adapter `github-actions` +
  autoMerge true. tsconfig.json carries `resolveJsonModule` +
  `allowSyntheticDefaultImports`.
- **PR cleanup**: TR_019 + PLANNING_LAYER stranded PRs (#49–#52,
  #57) closed with `--delete-branch` during TR_022. New PRs from
  TR_022's verification cycles (#58–#62) currently open under
  the blocked leave-management feature — leave until TR_023
  lands the Aider DTO fix.
- **Re-create vault secret for OpenAI API key** if the operator
  wants vault-backed routing. Both LLMs currently in env-var
  mode (`apiKeyEnv: 'LLM_API_KEY'`) and working.
- **Open alerts to dismiss**: cycle alerts from TR_010–TR_019.
  Dismissable with `gestalt alerts dismiss <id>`.
- **`.env`**: `LLM_MODEL=gpt-4o` (operator default).
- **`master.key`** generated locally (workspace root, mode 600,
  gitignored) + mounted into the container via
  `docker-compose.yml`. Survives `docker compose up -d --build`.
  Back up out-of-band; losing it makes every vault-encrypted
  secret unreadable.

---

## CLI install

`@gestalt/cli` is private — not on npm.
```bash
pnpm --filter @gestalt/cli build && cd packages/cli && npm link
```

---

## First-boot sequence

1. `docker-compose up -d` — start platform.
2. `gestalt init-admin` — create admin user (TTY only, once
   per server).
3. `gestalt login` — authenticate CLI.
4. `mkdir my-project && cd my-project && git init && git remote
   add origin <url>`.
5. `gestalt init` — register project + server pushes harness.
6. `git pull` — receive harness files locally.
7. `gestalt run "<intent>"` — submit work to agents.

---


## How to run builds

```bash
pnpm -r build                 # build all packages (topological order)
pnpm --filter @gestalt/core typecheck

docker-compose up -d          # postgres + redis + server (production stage)
docker-compose logs -f server
```

---

## Current build status

| | |
|---|---|
| `pnpm -r build` | ✅ clean (13 packages) |
| `docker-compose up -d` | ✅ healthy (server / postgres / redis) |
| Migrations applied | 029 (latest: `029_token_management_and_phase_merge`) — no new migration in TR_036 |
| Server reachable | `http://localhost:3000/health` returns 200 |
| Dashboard | served at `http://localhost:3000/app/` |

The 13 buildable packages: `@gestalt/core`, `@gestalt/adapter-postgres`,
`@gestalt/adapter-oracle` (stub), `@gestalt/adapter-mssql` (stub),
`@gestalt/agents-generate`, `@gestalt/agents-quality-gate`,
`@gestalt/agents-deploy`, `@gestalt/agents-maintenance`,
`@gestalt/agents-planning` (migration 024), `@gestalt/registry`,
`@gestalt/server`, `@gestalt/cli`, `@gestalt/dashboard`.

---

## Known issues

None blocking the build. Areas to keep in mind:

1. **`UserRepository` / `ProjectRepository` extensions touch every
   adapter.** Adding a method means Oracle + MSSQL stubs must add the
   same method (as throw-stubs is fine). Build will fail until every
   adapter implements the new surface.
2. **CLI pins chalk@4 / ora@5 for CJS compatibility.** Do not upgrade
   either without performing the full ESM migration (`"type":
   "module"`, `.js` extensions on relative imports, Dockerfile
   update). The pin is intentional.
3. **Dashboard bundle 1010 KB raw / 319 KB gzipped** after the
   CodeMirror addition. Above Vite's 500 KB warning. Acceptable for an
   admin-only feature.
4. **LLM model name not validated at startup.** `loadConfig` accepts
   any non-empty string for `LLM_MODEL`. Invalid model surfaces as a
   404 on the first LLM call.

---

## Pending operator actions

### TR_037 — Planner-agent uses architecture-agent's canonical type names (template 0.22.0, build clean, symbol-name conflict resolved end-to-end)

Two fixes against the TR_036 NEW HIGH follow-up:

- **Fix 1** — `packages/agents/planning/src/prompts/planner-prompt.ts`
  injects the full `FeatureArchitecture` JSON (sliced to 2000
  chars) as a `## Canonical type and symbol names` section above
  the HARNESS rules and above the task description. The planner
  sees architecture-agent's canonical names before it starts
  planning. No threading through `task.context` needed — the
  planner-agent already receives `architecture` as a positional
  parameter via `planFeature(feature, architecture, …)`.
- **Fix 2** — `agentConfig.planner-agent.rules` in template +
  trackeros HARNESS appended with: "The architecture specification
  provided above defines the canonical type names, interface
  names, and symbol names for this feature. Use these exact names
  in all phase scopes. Do not invent alternative names or rename
  types." Abstract — no hardcoded type names.

Template bumped 0.21.0 → 0.22.0. `pnpm -r build` clean across
all 13 packages.

**Live verification — symbol-name conflict resolved:** trackeros
feature `ce9d1b80-b442-4547-afcf-d389e4aa8b63` on `chat-latest`
produced a 5-phase plan with Phase 1 scope using
architecture-agent's canonical `LeaveRequest` type + field list
verbatim. Phase 1's per-phase architecture: 4 interfaces +
5 success criteria + full SQL schema. Cycle proceeded into
`generating` without intent-agent escalation on symbol names.

**Cycle still blocked at intent-agent — NEW orthogonal finding:**
After the symbol-name conflict was resolved, intent-agent escalated
on a different ambiguity: "The concrete persistence implementation
backing `LeaveRepository` is not specified." Architecture-agent
defines the interface but doesn't pin the concrete DB
driver/package. This is a stricter intent-agent bar than the prior
symbol-name conflict — and TR_037's fix doesn't address it.

**Operator action — trackeros:** none new beyond the already-pushed
`5f083345 chore(TR_037): planner-agent canonical-names rule`.

**Operator action — other projects:** Existing projects adopt the
canonical-names rule by appending to
`HARNESS.json.agentConfig.planner-agent.rules`:
> "The architecture specification provided above defines the
> canonical type names, interface names, and symbol names for
> this feature. Use these exact names in all phase scopes. Do
> not invent alternative names or rename types."

Template auto-refreshes to `0.22.0` at next server boot.

### TR_036 — Abstract gate rules + auto-generated project-structure brief + maxPhaseRetries alert path (template 0.21.0, build clean, live verification partial)

Four fixes against TR_035 verification findings:

- **Fix 1** — HARNESS `constraint-agent.rules` + `review-agent.rules`
  rewritten to abstract layer-role language (data access layer,
  business logic layer, presentation/routing layer). Both agents'
  `verificationGuidance` rewritten to "read ARCHITECTURE.md first;
  a finding is only valid if it violates a rule given the actual
  structure of this project". The HARNESS no longer hardcodes
  paths, class names, or method names — ARCHITECTURE.md is the
  authoritative source for layer boundaries.
- **Fix 2** — new `buildProjectStructureBrief(projectRoot)` helper
  in `gate-orchestrator.ts`. Reads `ARCHITECTURE.md` (truncated to
  2000 chars) + enumerates a depth-2 directory tree under `src/`
  using Node's `readdir` (equivalent to `find src -maxdepth 2
  -type d`, bounded to 30 entries). Set on
  `GateTask.projectStructureBrief` (new optional field on the
  type); constraint-agent injects it before the rules section,
  llm-review-agent injects it at the top of the prompt. Empty
  string when neither source exists — section is omitted.
- **Fix 3** — planner's `maxPhaseRetries` exhaustion path in
  `planning-orchestrator.ts` now creates a `feature-blocked`
  alert + emits `alert.created` SSE. Previously this path was
  silent on the alerts feed (operators only saw the block via
  `gestalt feature show` / dashboard).
- **Fix 4** — trackeros `agents.yaml` `test-agent.goal` switched
  from Vitest → Jest to align with the rest of the project's
  Jest-only tooling.

Template bumped 0.20.0 → 0.21.0. `pnpm -r build` clean across
all 13 packages.

**Live verification — partial:** trackeros feature
`b58ee152-4f5b-4dd5-8d72-39816149fbae` ran on `chat-latest`,
produced a 7-phase plan (model+repo bundled into Phase 1) with
non-empty per-phase architecture (2 interfaces + 5 criteria),
then escalated at intent-agent on an upstream
planner-vs-architecture-agent symbol-name inconsistency
(`LeaveStatus` vs `LeaveRequestStatus`, `CreateLeaveRequestDto`
vs `CreateLeaveRequestInput`). Self-healing → cascade brake →
`feature-blocked` alert `430ed09a` created via the EXISTING
TR_033 helper. Gate never ran, so Fixes 1 + 2 did not get an
LLM-level test. Fix 3's new alert call sat alongside the
existing one; the cycle escalated via the existing path so my
new code didn't fire.

**New HIGH follow-up:** cross-check planner-agent vs
architecture-agent symbol names. Both currently emit type/field
names independently; nothing reconciles them. This blocks every
cycle on chat-latest at intent-agent before the gate-side
TR_036 fixes get exercised.

**Operator action — trackeros:** none new beyond the
already-pushed `b5396160 chore(TR_036): abstract
constraint+review rules + align test-agent to Jest`.

**Operator action — other projects:** Existing projects can
adopt the abstract rules by replacing their
`HARNESS.json.agentConfig.constraint-agent.rules` +
`review-agent.rules` blocks with the abstract versions from
the template. Template auto-refreshes to `0.21.0` at next
server boot.

### TR_035 — Dynamic token budget management + phase merge SHA (ADR-057, template 0.20.0, build clean, live verification pending)

Two categories of work. Part A — platform-level five-layer
token management in `BaseLLMAgent`:

- Layer 1 (model-aware defaults: reasoning models get 8k,
  standard 2k).
- Layer 2 (dynamic budget: input × 1.5 reasoning / × 0.5
  standard, clamped by per-model hard limits).
- Layer 3 (scope reduction: three structural rewrites for
  prompts above the threshold).
- Layer 4 (JSON response guard appended to six structured-
  output agents: architecture-agent `designFeature` +
  `designPhase`, planner-agent, phase-evaluator-agent,
  constraint-agent, review-agent, self-healing-agent).
- Layer 5 (truncation retry doubling the budget on
  `finish_reason: 'length'`, up to 3 attempts).

Knobs configurable in `HARNESS.json.tokenManagement`
(`promptCompressionThreshold` / `maxRetryBudgetMultiplier` /
`enableDynamicBudget` / `enableScopeReduction`).

Part B — three TR_034 follow-up fixes:

- **B1** — `architecture-agent.max_tokens: 12000` in
  trackeros `agents.yaml` as the fallback floor. Layers 2 +
  5 in BaseLLMAgent handle higher cases.
- **B2** — phase-evaluator prefers `git show --name-only
  --format= <mergeCommitSha>` over the prior `git diff`
  fallback. The existing `mergePullRequest` already returns
  the squash-merge SHA, so the promotion-agent's
  `maybeAutoMerge` now `findPhaseByIntent → updatePhaseMergeCommit`
  after a successful merge. New `feature_phases.merge_commit_sha`
  column (migration 029). Phase-evaluator-agent rules in the
  template + trackeros HARNESS updated to teach the agent the
  new command (with fallback when SHA is null).
- **B3** — single migration `029_token_management_and_phase_merge.sql`
  bundles both new columns.

Template bumped 0.19.0 → 0.20.0. `pnpm -r build` clean across
all 13 packages. Migration 029 applied at next server boot.
Live verification pending — runtime telemetry will show each
layer firing.

**Operator action — trackeros:** the operator may patch the
phase-evaluator-agent rule into `trackeros/HARNESS.json` if it
gets reverted (precedent from TR_033). The `tokenManagement`
block + `architecture-agent` 12k bump are already in trackeros.

**Operator action — other projects:** Existing projects can
opt in by adding a `tokenManagement` block to `HARNESS.json`.
Absent → all five layers run with the defaults baked into
`BaseLLMAgent` (threshold 6000, multiplier 2.0, both feature
flags on). Template auto-refreshes to `0.20.0` at next server
boot for new projects.

### TR_034 — Scoped per-phase architecture replaces full architecture context in Aider message (template 0.19.0, mechanisms verified)

Replaces the heavyweight `## Project architecture` + `## Design
context` blocks in the Aider message with a single
`## Scoped architecture for this phase` block built from
architecture-agent's `designPhase()` JSON (interfaces +
importStatements + sqlSchema + successCriteria). Closes the
TR_033 root cause where Aider hallucinated `../../shared/db`
from module-name references in the full ARCHITECTURE.md.

- `buildAiderMessage` signature: `(intentSpec, phaseArchitecture:
  string | null, snapshot)`. New `renderPhaseArchitecture()` helper.
- New `FeatureRepository.updatePhaseArchitecture` method (no
  migration — uses existing column). Postgres impl + oracle/mssql
  stubs.
- `runPerPhaseArchitecture` persists JSON to `phase.architecture`.
- `aider-code-agent.loadPhaseArchitectureForCycle` resolves
  correlationId → intent → phase → architecture, parses with
  shape guard.
- Template HARNESS + agents.yaml gain new architecture-agent
  scoping rules (architectureGuidance + prompt_extensions) with
  WRONG/CORRECT examples banning module-name-only references.

Template bumped 0.18.0 → 0.19.0. **Verified live on trackeros
2026-06-10** — per-phase architecture pass fires,
`updatePhaseArchitecture` persists JSON, message body shrank
5705 → 2922 bytes, Phase 1 deployed via PR #119. **Feature did
NOT complete** — gpt-5.5 + Aider produced zero source code
(same TR_033 mode), and architecture-agent's `designPhase`
returned empty arrays so the scoped block was empty too.

**Operator action — trackeros:** none new beyond the brief's
HARNESS + agents.yaml edits (committed by the verification
cycle as `e7db89dd` + `4eb7637c` cleanup).

**Operator action — other projects:** Existing projects can
opt into the per-phase architecture pass by setting
`HARNESS.json.planner.architectureReviewPerPhase: true` and
ensuring `architectureGuidance` includes the path/exports/
import-statement rules from the template. Template auto-
refreshes at server boot to `0.19.0`. The Aider message
behaviour change is fully backward-compatible — projects
without per-phase architecture get `null` from
`loadPhaseArchitectureForCycle` and the message drops the
section entirely.

### TR_033 — Phase 3 quality gaps + escalation→blocked structural fix (template 0.18.0, partially verified)

Four targeted fixes pushing toward full autonomous feature
completion. **Verified live on trackeros feature `7ab81ea3`
(2026-06-10)**: Fix 1 + Fix 4 confirmed end-to-end; Fix 2 +
Fix 3 shipped but not reached (feature blocked at Phase 1
before routes phase). Feature did not reach `completed` —
gpt-5.5 + Aider produced zero source code across 4 attempts
(new failure mode separate from TR_028-32 hallucination).
Full report in `sessions/RECENT.md`. Fixes 1-3 are language-agnostic rule additions;
Fix 4 is the structural follow-up to the TR_032 verification
gap (escalated intents leaving features stuck `in-progress`).

- **Fix 1** — `aider-message-builder.ts` base `readFiles` list
  expanded to include `package.json`, `tsconfig.json`,
  `pyproject.toml`, `requirements.txt`, `go.mod`, `pom.xml`,
  `mypy.ini`, `.eslintrc(.json)`. The adapter's `existsSync`
  filter naturally drops files a project doesn't use, so the
  same list works on TypeScript / Python / Go / Java without
  language-tagging the platform code.
- **Fix 2** — three language-agnostic rules added to
  `agentConfig.code-agent.rules` in the **template** HARNESS:
  read dependency source before calling its methods; read
  compiler/linter config before generating; read dependency
  manifest before importing. Examples in the rule text list
  multiple ecosystems (`tsconfig.json / mypy.ini / pyproject.toml`,
  `package.json / requirements.txt / go.mod`).
- **Fix 3** — new rule on
  `agentConfig.phase-evaluator-agent.rules` (template) — when
  adjusting a routes/controller phase scope, cite the
  service/handler file it depends on. Closes the TR_032 Phase 3
  root cause.
- **Fix 4** — structural. `AlertType` gains `'feature-blocked'`
  (no migration — no DB CHECK constraint on `alerts.type`).
  Planning orchestrator's `intent.status-changed` subscriber
  now treats `waiting-for-clarification` + `escalated` as
  terminal phase outcomes via a new
  `markFeatureBlockedAfterEscalation` helper: phase → failed,
  feature → blocked, `phase-escalated` log entry, a single
  `feature-blocked` alert. Self-healing already parked the
  parent intent at `waiting-for-clarification` when the
  cascade brake fired (`self-healing-loop.ts:604`) — Fix 4
  completes the story.

Template bumped 0.17.0 → 0.18.0. Build clean across all 13
packages. Live verification pending.

**Operator action — trackeros:** my Fix 2 + Fix 3 edits on
trackeros's `HARNESS.json` were reverted by the operator/linter
this session. The new code-agent + phase-evaluator rules only
ship via the template; existing projects (including trackeros)
need a manual patch on their own `HARNESS.json` to opt in. For
the live verification recipe to test Fix 2 + Fix 3 end-to-end,
trackeros's HARNESS must be patched first with the three
code-agent rules and the one phase-evaluator rule from the
template.

**Operator action — other projects:** None on the platform.
Template auto-refreshes at server boot to `0.18.0`. New
projects pick up the rules automatically.

### TR_032 — Aider `--read` flag + preservation in schema + broken-state framing (template 0.17.0, verified)

Three targeted platform-mechanic fixes addressing the
TR_028 → TR_031 Aider DTO-drift blocker. No new HARNESS
rules, no new migrations.

- **Fix 1** — `runAider` accepts `readFiles?: string[]`;
  `buildAiderMessage` returns `{ message, readFiles }`
  (PLAN.md + paths regex-extracted from the intent's scope
  text). The adapter renders each as a `--read "<path>"`
  flag, existsSync-filtered against `workDir`. Removed the
  TR_030/TR_031 prose `## Read PLAN.md first` and
  `## Before generating any code` sections — `--read`
  enforces what they only asked.
- **Fix 2** — preservation sentence ("Preserve all existing
  exports, types, interfaces, and imports. Only add or
  modify what is needed to resolve the CI failure shown
  above.") hard-coded as the closing sentence of the
  `fixIntent` JSON-schema description in
  `self-healing-agent.ts`. HARNESS preservation rule
  removed from the template.
- **Fix 3** — `fixIntent` description now requires BROKEN
  STATE framing (not MISSING STATE) with verbatim
  WRONG/CORRECT examples. Addresses the TR_031 cycle-3
  finding that Aider inverts negation.

Template bumped 0.16.0 → 0.17.0. Build clean across all 13
packages. **Verified end-to-end on trackeros 2026-06-09** —
feature `fd844f7d` Phase 1 + Phase 2 both deployed cleanly
(Phase 2 was the killer phase across TR_028-31, first ship);
Phase 3 escalated on unrelated TS-strict + missing-method
issues (the TR_033 fixes target those). `readFiles` array
present on every Aider invocation. Preservation footer
present on both fix-intents. Cascade brake at depth 2 fired
correctly. Operator had to manually clean up the escalated
feature after the cycle — Fix 4 above closes that gap.

**Operator action:** None new. The TR_032 preservation rule
removal already shipped via the template.

Three targeted platform-mechanic fixes addressing the
TR_028 → TR_031 Aider DTO-drift blocker. No new HARNESS
rules, no new migrations.

- **Fix 1** — `runAider` accepts `readFiles?: string[]`;
  `buildAiderMessage` returns `{ message, readFiles }`
  (PLAN.md + paths regex-extracted from the intent's scope
  text). The adapter renders each as a `--read "<path>"`
  flag, existsSync-filtered against `workDir`. Removed the
  TR_030/TR_031 prose `## Read PLAN.md first` and
  `## Before generating any code` sections — `--read`
  enforces what they only asked.
- **Fix 2** — preservation sentence ("Preserve all existing
  exports, types, interfaces, and imports. Only add or
  modify what is needed to resolve the CI failure shown
  above.") hard-coded as the closing sentence of the
  `fixIntent` JSON-schema description in
  `self-healing-agent.ts`. HARNESS preservation rule
  removed from the template.
- **Fix 3** — `fixIntent` description now requires BROKEN
  STATE framing (not MISSING STATE) with verbatim
  WRONG/CORRECT examples. Addresses the TR_031 cycle-3
  finding that Aider inverts negation.

Template bumped 0.16.0 → 0.17.0. Build clean across all 13
packages. Live verification pending — operator runs the
brief's `gestalt feature submit` recipe on trackeros.

**Operator action:** Existing projects can prune the now-
redundant preservation rule from
`HARNESS.json.agentConfig.self-healing-agent.rules` (it's
in the platform schema now). The rule is harmless if left
in — both fire. trackeros not auto-migrated; operator can
clean up on next HARNESS edit.

### TR_030 + TR_031 — Aider-message-builder + PLAN.md "What has been built" + context-only fix-intent (template 0.16.0)

Two consecutive briefs targeting Aider DTO drift. TR_030
added two generic prose blocks to `aider-message-builder.ts`
(read-existing-files; architecture-is-reference-only).
TR_031 added a `Read PLAN.md first` block to the message-
builder; extended `PhaseEvaluation` with `builtFiles` (the
phase-evaluator-agent now also lists exports per built file
in its git-diff pass); rewrote the `fixIntent` JSON-schema
description in `self-healing-agent.ts` to require CONTEXT
only (no prescriptive "Update X to add Y"). HARNESS
preservation-rule bullet added for self-healing-agent.
Template 0.15.0 → 0.16.0.

Verified end-to-end on a clean trackeros main: PLAN.md
populates the `**What has been built:**` section under each
deployed phase with files + key exports; fix-intent text
is now context-only; self-healing routes to fix-intent
immediately on first failure; cascade brake fires at depth 2.

**Operator action:** Existing projects can adopt the new
preservation rule by appending to
`HARNESS.json.agentConfig.self-healing-agent.rules`:
"Fix-intent context must end with a preservation statement.
For TypeScript projects: 'Do not remove or rename existing
exports, types, or interfaces. Only add or modify what is
needed to resolve the CI failure.'" Python or other
language projects substitute their own preservation clause.
trackeros migrated in commit `7d94746a`.

### TR_029 — Planner+evaluator prior-phase path rules (template 0.15.0)

Two new `agentConfig.planner-agent.phaseScopingRules` items and
one `agentConfig.phase-evaluator-agent.rules` item added,
requiring per-phase explicit prior-file-path lists and full-path
replacement when adjusting scopes after a partial verdict.
Template bumped 0.14.0 → 0.15.0. Pure HARNESS edit — no platform
code change, no migration.

Planner-side verified end-to-end on the re-submitted
leave-management feature: PLAN.md `Phase 2` carries the exact
`src/modules/leave/leave.model.ts` + `leave.repository.ts`
paths the planner was instructed to include. Phase 1 deployed
in ~3 minutes (PR #88). Phase 2 still blocked by Aider
code-agent reading discipline — captured as two NEW HIGH
follow-ups in STATE.md (code-agent prompt mandate + architecture-
agent context scoping).

**Operator action:** Existing projects can adopt the new rules
by merging them into `HARNESS.json.agentConfig.planner-agent.phaseScopingRules`
and `agentConfig.phase-evaluator-agent.rules`. trackeros migrated
as part of this session (commit `cf35c03b`).

### TR_028 — Full planning-loop re-test (TEST_REPORT_028.md)

Milestone test on the leave-management feature, verifying every
TR_020 through TR_027 mechanism in a single 19-minute autonomous
cycle. Phase 1 (model) deployed cleanly. Phase 2 (repository)
hit the known TR_023 Aider DTO-drift; self-healing's
diagnostician correctly chose `retry` then `fix-intent`;
fix-intent child deployed via the `onSuccessDispatch` envelope
in ~2m 25s. But the fix-intent prompt lacked path specificity
so Aider wrote a stray repo-root `/leave.model.ts` that tsc
never resolves. Parent Phase 2 resumed → failed again → planner
retry budget exhausted → feature blocked at 1/4 phases. Two new
HIGH follow-ups captured: (1) promoted TR_023 — planner must
keep model+repository in same phase OR code-agent must read
existing model first; (2) self-healing fix-intent prompt
enrichment — must include the failing import path and existing
field shape. Architecture-agent / planner-agent /
phase-evaluator-agent / PR-Agent / self-healing + onSuccessDispatch /
cascade-depth brake / phase retry budget all verified.

**Operator action:** None on the platform. trackeros next
planner cycle should be prefaced by `git rm leave.model.ts`
(the stray repo-root file fix-intent created). Full
per-phase log at `docs/claude/TEST_REPORT_028.md`.

### TR_027 — PR-Agent replaces review-agent (ADR-051)

CodiumAI PR-Agent invoked server-side via `executeScript` after CI
passes. No webhook, no CI step, no GitHub Secrets for LLM keys —
LLM credentials forwarded per invocation via subprocess env vars.
Dockerfile installs PR-Agent in its own venv (`/opt/pr-agent`)
isolated from Aider's because of incompatible litellm versions;
PATH shims (`/usr/local/bin/{aider,pr-agent}`) keep call sites
unchanged. New `prAgent` block on HarnessConfig + `.pr_agent.toml`
generated from HARNESS rules at init time (regeneratable via
`gestalt project config push-pr-agent-config`). Gate orchestrator
skips review-agent when prAgent.enabled + adapter=github-actions;
constraint-agent still runs. `changes-requested` routes through
self-healing's `fix-intent` path via new failure type
`review-requested-changes` (migration 027). Template 0.12.0 →
0.14.0. Live verified end-to-end on trackeros PR #81: Aider 6s →
CI pass → PR-Agent 23.5s → verdict `none` → gate (constraint-agent
only) → deploy. Wall-clock 2m 04s.

**Operator action:** Existing projects can adopt PR-Agent by
adding `prAgent: { enabled: true, blockOnChangesRequested: true,
pendingTimeoutSeconds: 30 }` to HARNESS.json + a self-healing-agent
rule for `review-requested-changes`. Absent → review-agent fallback
path still runs (llm-review-agent.ts kept as `@deprecated` but
functional). trackeros migrated as part of the verify cycle
(commits pending push).

### ADRs 053–055 — Tool integration roadmap

Documentation-only session. Three ADRs appended to
`docs/DECISIONS.md` capturing strategic tool integrations
agreed in the design chat: ADR-053 (Qodo Gen replaces
test-agent in the generate layer), ADR-054 (SWE-agent handles
bug-fix MaintenanceIntents), ADR-055 (K8sGPT feeds a future
Kubernetes operations layer via webhook → MaintenanceIntent).
A new `### Tool integration roadmap` section under
`STATE.md` "Active follow-ups" documents priority order plus
ruled-out alternatives (Bloop.ai — archived; OpenHands —
competitor; GitHub Spec Kit — not self-hostable). All three
ADRs are **Accepted — pending implementation**; no code
change, no migration.

Cross-reference note: ADR-052 (external scanner webhook →
MaintenanceIntent pattern) is referenced by ADR-055 but has
not yet been authored. Backfill when the next session touches
that code. ADR-051 (PR-Agent) was authored alongside this
session.

**Operator action:** None. ADRs are forward-looking contracts;
implementation will land in a later session.

### TR_026 — Remove platform file-change detection (ADR-050 enforcement)

ADR-050 enforcement: the platform must NOT detect, parse, or
interpret which files changed. Two surgical removals plus an
agent-side replacement.

- **AiderAdapter**: `parseAiderChangedFiles` deleted,
  `filesChanged` removed from `AiderResult`. `--yes-always`
  replaces `--yes` to prevent mid-session confirmation hangs.
- **AiderCodeAgent**: new `discoverAiderWrites` helper runs
  `git status --porcelain` in the work-dir and emits each
  changed file as a code artifact. An AGENT calling git —
  not platform code parsing Aider stdout.
- **Phase-evaluator-agent**: 3-stage TR_025 fallback deleted.
  Agent signature changed to take `branchContext`; prompt
  rewritten to instruct it to run `git diff` via
  executeScript. Switched to `callLLMWithTools` so the
  tool-use loop fires.
- **PER_ROLE_DEFAULTS** in `agent-config-loader.ts` extended
  with the three planning agents so executeScript is
  available out of the box.
- **HARNESS.json + agents.yaml** updated on template +
  trackeros: phase-evaluator-agent rules + evaluationCriteria
  rewritten with verbatim git-diff guidance.
- **Template bumped 0.11.0 → 0.12.0**.

Verified live: feature `7d77f659` Phase 1 PR commit
`ce3f3721` contains the real code files (`leave.model.ts` +
test). Phase-evaluator's verdict text quotes the
HARNESS.json git-diff rule, confirming the agent followed
the new path. Full feature completion blocked by
pre-existing trackeros operator state (stale
`leave.repository.ts` from earlier auto-merged cycles) —
captured as TR_027.

**Operator action:** None. Pure platform changes (plus the
trackeros HARNESS.json edit committed by the verification
cycle as `897bcf06`).

### TR_025 — Cascade-depth brake + phase-evaluator file-list fix

Two surgical hardening fixes (no migration):

- **`MAX_FIX_INTENT_DEPTH = 2`** + `getFixIntentChainDepth` walker
  in `packages/core/src/agents/self-healing-loop.ts`. Force-
  escalates when `parent_intent_id` chain depth ≥ 2. Closes
  TR_024's cascading-runaway gap.
- **Planning orchestrator built-file list** sourced from
  `git diff` against the PR branch (filtered to non-
  `.gestalt/` paths). Three-stage fallback: PR-branch diff →
  merged-commit scan → legacy artifacts-table read.

Verified live: feature `eed75889` Phase 1 → success → Phase 2
auto-dispatched. End-to-end autonomous transition confirmed.
Phase 2 hit an unrelated Aider "0 files written" quirk
(TR_026 follow-up).

**Operator action:** None. Pure platform fixes.

### TR_024 — Autonomous systemic gap detection (migration 026)

Self-healing diagnostician can now choose between **retry /
fix-intent / escalate**. When it picks `fix-intent` it writes an
Aider-ready intent the platform submits as a separate generate
cycle, links via `parent_intent_id`, and persists an
`on_success_dispatch` envelope that resumes the parent after
the fix's production promotion. Per ADR-050: no hardcoded
failure-pattern matching anywhere.

- **Migration 026** — `intents.parent_intent_id` (UUID FK
  `ON DELETE SET NULL`) + `intents.on_success_dispatch`
  (JSONB). NULL on every existing intent.
- **`HarnessAgentConfig.self-healing-agent`** added to both
  the template and trackeros: six rules covering the action
  vocabulary + fix-intent quality bar.
- **agents.yaml self-healing-agent block** in template (uses
  platform default model). trackeros overrides `model:
  chat-latest`. The LLM registry handles the
  `apiShape: 'responses'` wire-shape — agent code untouched.
- **`collectCiTechnicalDetail`** (deploy-orchestrator) —
  fetches the failed CI run's GitHub Actions annotations and
  passes them to the diagnostician as `technicalDetail`.
  github-actions only today.
- **Dashboard panels**: 🔧 Auto-fix intent (on `source: 'self-
  healing-fix'` intents); ⏳ Awaiting auto-fix (on parents with
  in-flight fix children).
- **Template bumped 0.10.0 → 0.11.0**.

**Operator action:** Existing projects can adopt the
self-healing-agent rules + agents.yaml block by editing their
own HARNESS.json + agents.yaml. Absent → diagnostician uses
the platform default LLM (no agents.yaml override needed
when the platform default is already chat-latest or similar).
trackeros migrated as part of the verify cycle (commit
`1a4fe16e` on `main`).

### TR_022 — Scaffolding fixes + phase retry budget (migration 025)

Three operator-facing changes plus a verified end-to-end retest
of the planning loop on a 5-phase feature.

- **Migration 025** — `feature_phases.retry_count INTEGER NOT NULL
  DEFAULT 0`. Existing rows start at 0.
- **`HarnessConfig.planner.maxPhaseRetries`** — new optional field,
  default 2 (one initial attempt + 2 retries). Set to 0 to
  restore pre-TR_022 single-attempt behaviour.
- **Template HARNESS.json** — `agentConfig.code-agent.rules` gets
  the JSON-import rule; `planner.maxPhaseRetries: 2` added.
  Template bumped 0.8.0 → 0.9.0.
- **`stack-config.ts`** — TypeScript stacks always carry the
  JSON-import rule in `agentPromptExtensions` (LLM path + the
  default-config path).

trackeros migrated as part of the verify cycle:
- `tsconfig.json` gains `resolveJsonModule` +
  `allowSyntheticDefaultImports`.
- `HARNESS.json` gets `code-agent.rules` JSON-import rule +
  planner block bumped to `{10, 5, false, 2}`.

**Operator action:** Existing projects can adopt the new
`maxPhaseRetries` field by editing `HARNESS.json.planner`.
Absent → defaults to 2 in `readMaxPhaseRetries`.

### PLANNING_LAYER — Autonomous feature decomposition (migration 024)

New package `@gestalt/agents-planning` + new BullMQ queue
`gestalt-planning` + new postgres tables (features /
feature_phases / feature_plan_log) + new server routes
(`POST/GET /features`, `GET /features/:id`) + new CLI commands
(`gestalt feature submit/list/show`). Three new agent roles
(architecture-agent / planner-agent / phase-evaluator-agent),
all extending BaseLLMAgent and reading config from agents.yaml +
HARNESS.json `agentConfig`. New `HARNESS.json.planner` block
(`enabled`, `maxPhasesPerFeature`, `maxFilesPerPhase`,
`architectureReviewPerPhase`) opt-in per project. Template
bumped 0.7.0 → 0.8.0. Live verified on trackeros — feature
`ea19b18e` ran the full architecture → plan → phase 1 → CI →
event-bus → evaluate loop end-to-end against real GitHub
Actions; phase failed because Aider's generated TS used
`require('package.json')` without `resolveJsonModule` (pre-
existing code-agent issue unrelated to planning).

**Operator action:** Add the planner block + planning
agentConfig entries to existing projects' `HARNESS.json` to
opt in. trackeros has been migrated as part of the verify
cycle (commit `3fc936fe` on `main`).

### Historical (TR_020 / TR_021 / ADRs 042–049)

Rotated to `sessions/archive/`. See `docs/DECISIONS.md` for ADRs
and the archive for the full narratives.

### Carryovers (TR_019 / TR_018 / TR_014)

- **MEDIUM — TR_019:** `gestalt init` should scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest with TypeScript.
- **LOW — TR_019:** Template `{{ciSetupSteps}}` for Node/npm
  should include `--legacy-peer-deps` until the upstream npm
  arborist `Link.matches` bug is fixed.
- **LOW — TR_019:** Add a `tsc --noEmit` sanity check on
  scaffolded tests in `gestalt init`.
- **HIGH — TR_018:** Restore TR_010 mandatory `executeScript
  tsc --noEmit` code-agent rule on trackeros's HARNESS.json.
- **MEDIUM — TR_014:** Aider token-spend capture. Parse
  `Tokens: N sent / M received` from Aider's stdout and surface
  as `tokens_used` on the execution row.

### Platform state caveats (unchanged)

- **`master.key`** generated locally (workspace root, mode 600,
  gitignored) + mounted into the server container via
  `docker-compose.yml`. Survives `docker compose up -d --build`.
  Back up out-of-band; losing it makes every vault-encrypted
  secret unreadable.
- **Open alerts to dismiss**: prior cycle alerts from
  TR_010–TR_018 (`gestalt alerts list` shows the full set).
  All dismissable with `gestalt alerts dismiss <id>`.
- **Live-verify TEST_REPORT_003 Fix 1** (env-default LLM
  apiShape) by switching `LLM_MODEL=chat-latest` + setting
  `platform_llms.chat-latest.api_shape='responses'` and
  confirming `max_completion_tokens` reaches the wire.
- **Re-create vault secret for OpenAI API key** if the operator
  wants vault-backed routing. Both LLMs currently in env-var
  mode (`apiKeyEnv: 'LLM_API_KEY'`) and working.

---

## Type alignment rules

Moved to [@docs/claude/ARCHITECTURE.md](./ARCHITECTURE.md#key-type-alignment-rules).

---


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
