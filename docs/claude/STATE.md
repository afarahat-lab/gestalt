# STATE.md — current platform state

_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-10 (after TR_033 — four targeted fixes pushing for full autonomous feature completion. **Fix 1**: the base `readFiles` list in `aider-message-builder.ts` expanded from `['PLAN.md']` to also include `package.json` + `tsconfig.json` + `pyproject.toml` + `requirements.txt` + `go.mod` + `pom.xml` + `mypy.ini` + `.eslintrc(.json)`. The `existsSync` filter in `runAider` drops anything not present, so the same list works on TypeScript / Python / Go / Java projects without language-tagging the platform code. **Fix 2**: three language-agnostic rules appended to `agentConfig.code-agent.rules` in the **template** HARNESS — read dependency source before calling methods; read compiler/linter config before generating; read dependency manifest before importing. Examples list multiple ecosystems so the LLM doesn't pattern-match to TypeScript. **Fix 3**: one new rule on `agentConfig.phase-evaluator-agent.rules` in the template — when adjusting a routes/controller phase scope, cite the service/handler file it depends on. Closes the TR_032 Phase 3 root cause (routes scope didn't cite `leave.service.ts`, so `--read` couldn't inject it, so Aider invented method names). **Fix 4**: structural — `AlertType` gains `'feature-blocked'`, and the planning orchestrator's `intent.status-changed` subscriber now treats `waiting-for-clarification` + `escalated` as terminal-failure phase outcomes. New helper `markFeatureBlockedAfterEscalation` marks phase failed + feature blocked + appends `phase-escalated` to the plan log + emits a `feature-blocked` alert in one sequence. Closes the TR_032 gap where stuck intents left features `in-progress` indefinitely. Template 0.17.0 → 0.18.0. **Build**: `pnpm -r build` clean across all 13 packages. **trackeros HARNESS.json revert respected** — operator/linter rolled back the trackeros code-agent + phase-evaluator edits; template rules ship forward but trackeros needs manual operator patching before TR_033 Fix 2 + Fix 3 take effect there. **Live verification pending** for all four fixes.)

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
