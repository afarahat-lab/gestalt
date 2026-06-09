# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md

_Auto-regenerated after every session by Claude Code. Do not edit by hand._

_Generated: 2026-06-09_

---


_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-09 (after TR_032 — three targeted Aider compliance fixes, all in `.ts` as platform mechanics (ADR-042 compliant). **Fix 1**: `runAider` accepts a new optional `readFiles?: string[]` parameter; `buildAiderMessage` returns `{ message, readFiles }` including PLAN.md plus paths extracted from the intent's scope text via a new `extractMentionedPaths` regex. The adapter renders each as a `--read "<path>"` flag (existsSync-filtered against `workDir`) — `--read` forces files into Aider's context window, replacing the prose "please read X" instructions TR_030/TR_031 demonstrated Aider ignores. The corresponding `## Read PLAN.md first` and `## Before generating any code` prose sections were removed from the message builder. **Fix 2**: the preservation sentence ("Preserve all existing exports, types, interfaces, and imports. Only add or modify what is needed to resolve the CI failure shown above.") is now hard-coded as the closing sentence of the `fixIntent` JSON-schema description in `self-healing-agent.ts` — promoted from a HARNESS bullet (which TR_031 showed the LLM honoured inconsistently). The HARNESS preservation rule was removed from the template. **Fix 3**: the same `fixIntent` description now requires BROKEN STATE framing (not MISSING STATE) with verbatim WRONG/CORRECT examples — addresses the TR_031 cycle-3 finding that Aider inverts negation ("X does not exist" → CREATES X). Template 0.16.0 → 0.17.0. **Build**: `pnpm -r build` clean across all 13 packages. **Live verification pending** — operator runs the brief's `gestalt feature submit "Build the leave management module..." --project trackeros` recipe.)

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
| Migrations applied | 027 (latest: `027_self_healing_pr_agent`) |
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

### TR_032 — Aider `--read` flag + preservation in schema + broken-state framing (template 0.17.0)

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

---
### Session 2026-06-09 — Claude Code (TR_030 + TR_031: combat Aider DTO drift via Aider-message-builder additions and PLAN.md "What has been built" + context-only fix-intent — structural mechanisms verified, Aider compliance still partial)

Two consecutive briefs in one day, both targeting the
TR_028/TR_029 blocker: Aider doesn't read existing files
before generating, drifts on type names, and creates
references to non-existent sibling modules. TR_030 added
two generic prose instructions to the Aider message;
TR_031 added a structured "What has been built" section
to PLAN.md and reshaped the self-healing fix-intent
contract per ADR-042.

What TR_030 changed (commit `bb70cf7`):

- **`packages/agents/generate/src/adapters/aider-message-builder.ts`** —
  added two generic behavioural instructions:
  - `## Before generating any code` — "Read every existing
    file in the repository that your generated code will
    import from or extend. Confirm the exact field names,
    exported types, and function signatures before
    referencing them. Do not assume a type's shape — read
    its definition."
  - `## Important — architecture context is reference only` —
    appended after the design context: "The architecture
    and design context above describes the intended system
    design. Many modules and types it mentions DO NOT EXIST
    YET in the repository — they are planned for future
    phases. Only import from files that actually exist in
    the repository."
- No file names, no project-specific content. Aider decides
  which files to read based on its repository map.
- Pure platform mechanic. No HARNESS change, no migration.

What TR_031 changed (commits `626957b…ff7a75c…89ba9b8…`):

- **`packages/agents/generate/src/adapters/aider-message-builder.ts`** —
  added `## Read PLAN.md first` section telling Aider to
  read PLAN.md and use the "What has been built" sub-
  sections under completed phases as the source of truth
  for what files + exports exist. Platform mechanic per
  ADR-042 (every Gestalt planning project has a PLAN.md
  committed by the orchestrator — instruction is not
  project-specific).
- **`packages/agents/planning/src/types.ts`** —
  `PhaseEvaluation.builtFiles` field added: `Array<{ path,
  exports? }>` populated by the phase-evaluator-agent from
  its existing git diff + readFile pass.
- **`packages/agents/planning/src/prompts/evaluator-prompt.ts`** —
  prompt extended: ask the agent to also extract KEY
  EXPORTS for every non-metadata file the git diff shows.
  Schema example uses placeholder strings (`"<title of a
  remaining phase>"`) instead of literal-looking paths so
  the LLM doesn't copy them verbatim. Added an emphatic
  "you MUST run executeScript BEFORE writing your JSON
  response" line after the first verification cycle's
  phase-evaluator hallucinated "Aider wrote 0 files
  (confirmed by git diff)" with `toolCallCount: 0`.
- **`packages/agents/planning/src/agents/phase-evaluator-agent.ts`** —
  `parsePhaseEvaluation` now extracts `builtFiles` from
  the LLM JSON output with defensive type guards.
- **`packages/agents/planning/src/orchestrator/planning-orchestrator.ts`** —
  `rewritePlanMd` renders a `**What has been built:**`
  bullet list under each `deployed` phase. Also moved
  PLAN.md re-emit OUT of the `if (adjustments.length > 0)`
  guard so the "What has been built" block lands on
  EVERY successful phase, not just ones that produced
  scope adjustments.
- **`packages/core/src/agents/self-healing-agent.ts`** —
  the `fixIntent` field in the diagnostician's response
  JSON schema was rewritten from prescriptive ("complete
  Aider-ready intent text") to context-only: "describe the
  CONTEXT and FAILURE that needs resolving. Include the CI
  error text, which files are involved, and what the code
  was trying to do. Do NOT write prescriptive instructions
  telling Aider what code to write. Provide context — let
  Aider decide the fix." Verbatim WRONG/CORRECT examples
  embedded in the schema string.
- **HARNESS.json `agentConfig.self-healing-agent.rules`**
  (template + trackeros): added a project-tunable
  preservation rule — "Fix-intent context must end with a
  preservation statement. For TypeScript projects: 'Do not
  remove or rename existing exports, types, or interfaces.
  Only add or modify what is needed to resolve the CI
  failure.'" Operators on Python projects swap the
  TypeScript-specific clause for their language.
- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.15.0` → `0.16.0`.

Live verification timeline (interleaved TR_030 + TR_031):

- **TR_030 first attempt** (feature `cb51d8fa`) — Phase 1
  deployed cleanly (Aider produced an internally-consistent
  model + repository with `leaveType: LeaveType`). Then
  feature got marked `blocked` not by Aider quality but by
  a transient DNS blip in the container (`Could not resolve
  host: github.com`) at the planning orchestrator's
  Phase-2 clone time. Once DNS recovered, the orchestrator
  had already retried twice and given up.
- **TR_030 second attempt** (feature `7d2acd20`) — Phase 1
  deployed via PR #93. Phase 2 (service) hit:
  - Aider hallucinated `ILeaveRepository` (Phase 1 exports
    `LeaveRepository`)
  - Imports `../balance/balance.model` and
    `../employee/employee.model` from the architecture
    description (Aider treats it as ground truth)
  - Added a `reason` field to LeaveRequest destructure
  - Renamed class `LeaveRepository` → `LeaveRequestRepository`
  Self-healing chose `fix-intent` on phase retry 2/2 —
  fix-intent's prompt was prescriptive ("Update LeaveRequest
  to add reason, updatedAt, leaveType"). Aider received it
  and wholesale-rewrote `leave.model.ts`, **dropping
  `CreateLeaveRequestDto`** which existing tests imported.
  Cascade fix-intent failed at depth 2 → TR_025 brake.
  Feature blocked.

This second attempt was the seed for the TR_031 brief —
the diagnostician's prescriptive prompts cause Aider to do
wholesale rewrites instead of surgical edits, dropping
sibling exports. The fix-intent contract needs to be
context-only.

- **TR_031 verification cycle 1** (feature `2998ff5e`) —
  Phase 1 deployed (PR #99 squash-merged). Then **the new
  phase-evaluator-agent hallucinated** `verdict:
  "escalate"` with `summary: "Aider completed but wrote 0
  files (confirmed by git diff)"` despite `toolCallCount:
  0` in the log. The model didn't run the executeScript
  tool — it lied about having checked. Caused by my added
  schema example using literal-looking paths
  (`src/modules/leave/leave.model.ts`) which the model
  treated as a pre-filled hint. Patched: replaced with
  placeholders + emphatic "you MUST run executeScript"
  line, rebuilt.
- **TR_031 verification cycle 2** (feature `0a9b14f6`) —
  Phase 1 deployed cleanly. Phase 2 (service) failed CI:
  same DTO drift family as TR_030. But this time **the
  test file on trackeros main was stale** from earlier
  cycles (`tests/unit/leave.model.test.ts` referenced
  `leaveType` while the new Phase 1's model wrote `reason`
  + no `leaveType`). Self-healing chose retry → retry →
  retry across phase retries 1/2 + 2/2 — never picked
  fix-intent. Phase 1 blocked.
- **Cleanup commit** `d196fc66` on trackeros main:
  `git rm src/modules/leave/ tests/unit/leave.model.test.ts`
  to clear cross-feature contamination from prior TR_028/
  TR_029/TR_030 cycles. The stale-test-pollution-on-main
  issue is a real operational gap — captured below as a
  new MEDIUM follow-up.
- **TR_031 verification cycle 3** (feature `35fb580e`) —
  with a clean trackeros main:
  - Phase 1 deployed cleanly (Aider 12s → CI pass →
    PR-Agent 37s → gate (constraint-agent only) → squash-
    merge).
  - **Phase-evaluator-agent ran git diff + readFile** and
    populated `builtFiles` correctly:
    ```
    **What has been built:**
    - `src/modules/leave/leave.model.ts` — `interface LeaveRequest`, `interface CreateLeaveRequestDto`
    - `src/modules/leave/leave.repository.ts` — `class LeaveRepository`
    ```
    Committed in PLAN.md on main. **TR_031 "What has been
    built" verified ✓**.
  - Phase 2 (service) CI failed — Aider drifted again:
    `ILeaveRepository` hallucination + sibling-module
    imports (`../balance/balance.model`,
    `../employee/employee.model`). PLAN.md's "What has been
    built" section was there but Aider didn't follow it.
  - **Self-healing chose `fix-intent` immediately on the
    first CI failure** (TR_028/TR_029 pattern took 3 attempts).
    Fix-intent text:
    > "CI failed: TypeScript errors in leave.service.ts.
    > The service references '../employee/employee.model'
    > and '../balance/balance.model', which cannot be
    > found. Additionally, it incorrectly references
    > 'ILeaveRepository' from './leave.repository', which
    > does not exist. Analyze and fix these import issues
    > to ensure the leave.service.ts file compiles
    > correctly."
    **Context-only, no prescriptive instructions.
    TR_031 fixIntent JSON-schema rewrite verified ✓**.
  - Fix-intent's Aider then **inverted the prompt** — it
    READ "ILeaveRepository does not exist" and CREATED
    `ILeaveRepository` interface anyway, plus introduced a
    `Leave` type undefined anywhere. Second fix-intent
    dispatched with identical text. **TR_025 cascade-depth
    brake fired at depth 2 — escalating ✓**. Feature
    blocked.

What's VERIFIED:

- ✅ `What has been built` populated correctly in PLAN.md
  after Phase 1 (cycle 3). Phase-evaluator-agent runs git
  diff + readFile, emits `builtFiles` JSON, orchestrator
  renders it.
- ✅ Fix-intent text is now context-only ("CI failed: TS
  errors in X. References Y. Analyse and fix.") — not
  prescriptive ("Update X to add Y"). Confirmed across
  both fix-intents in cycle 3.
- ✅ TR_025 cascade-depth brake fires at depth 2 — verified
  in cycle 3.
- ✅ Aider message-builder now includes `## Read PLAN.md
  first` + `## Before generating any code` + `## Important
  — architecture context is reference only`. Code path
  shipped; the prompt reaches Aider on every code-agent
  run (verified by the Phase 1 successful generation).
- ✅ HARNESS preservation rule landed on template + trackeros.

What's NOT VERIFIED end-to-end:

- ❌ Aider compliance with `## Before generating any code`.
  Phase 2 of cycle 3 still drifted (`ILeaveRepository`
  hallucinated, sibling modules imported). The prompt
  instruction is in Aider's context but Aider doesn't
  follow it consistently. This is the same conclusion as
  TR_029.
- ❌ HARNESS preservation rule reaching the dispatched
  fix-intent text. The HARNESS rule says "Fix-intent
  context must end with a preservation statement" but
  neither of the two fix-intents in cycle 3 had the
  preservation footer. The diagnostician LLM didn't append
  it — the HARNESS rule didn't translate into runtime
  behaviour. **The preservation requirement may need to
  live in the JSON-schema `fixIntent` description**
  (platform mechanic) rather than a HARNESS bullet
  (configurable). ADR-042 split argued for the latter; in
  practice the LLM doesn't reliably honour configurable
  HARNESS rules over schema descriptions.
- ❌ Aider's reaction to negated phrases. The fix-intent
  said "X does not exist" — Aider read that and CREATED
  X. This is a classic LLM-inversion behaviour that no
  amount of prompt engineering reliably fixes.

Decisions made:

- **Cleaned trackeros main between cycles 2 and 3.** Stale
  files from TR_028/TR_029/TR_030 (`src/modules/leave/`,
  `tests/unit/leave.model.test.ts`) were contaminating
  every fresh cycle because Aider reads them as ground
  truth. The cleanup unblocked cycle 3. This is a real
  ops gap — captured below.
- **Did not extend `BaseLLMAgent.callLLMWithTools` to
  reject responses without tool calls.** The phase-
  evaluator-agent hallucinated `toolCallCount: 0` in
  cycle 1. Could be enforced by the harness (reject + retry
  if the model emits a final answer without invoking
  required tools), but that's a bigger change deferred to
  a follow-up. For now: emphatic prompt line + placeholder
  schema strings reduce the chance.
- **Did not change Aider's invocation flags.** Aider has
  a `--read <file>` CLI flag that forces a file into its
  context. Could pass the PLAN.md `What has been built`
  paths via `--read` to make Aider literally have to read
  them. Deferred — keep the chain of changes narrow.

Pending follow-ups (NEW from TR_030 / TR_031):

- **(HIGH — NEW from TR_031)** Move the preservation
  requirement from HARNESS bullet into the `fixIntent`
  JSON-schema description in `buildDiagnosisPrompt`. The
  HARNESS rule was not honoured by the LLM in two
  consecutive fix-intent dispatches. Schema-string
  guidance reliably influences output; HARNESS bullets are
  more advisory.
- **(HIGH — NEW from TR_031)** Aider invocation could use
  `--read <file>` for every path the planner's scope cites
  under `_Depends on:_`. Forcing the file into Aider's
  context is stronger than a prose "please read this
  first" instruction. Same logic for the PLAN.md path —
  pass `--read PLAN.md` always.
- **(MEDIUM — NEW from TR_031)** Stale-file pollution on
  trackeros main from failed prior cycles contaminates
  every fresh attempt. When a feature gets blocked, the
  files committed in deployed phases stay on main. The
  next cycle's Aider reads them as ground truth and tries
  to compose around them, often introducing new conflicts.
  Options: (a) `gestalt feature` reset command that
  un-merges deployed phases of a blocked feature; (b)
  PLAN.md tracks "files this feature owns" and the
  rewritePlanMd cleanup-on-block step git-rm them.
- **(MEDIUM — NEW from TR_031)** Phase-evaluator-agent
  hallucinated `verdict: escalate` with
  `toolCallCount: 0` in cycle 1. The
  `callLLMWithTools` loop should reject responses where
  the agent's JSON claims tool-derived evidence (e.g.
  "confirmed by git diff") but the model didn't invoke
  any tools. A simple check: if the prompt says "you MUST
  run X" and the model returned a final answer without
  invoking X, retry once.
- **(MEDIUM — NEW from TR_030/TR_031)** Aider doesn't
  reliably parse negated assertions. Fix-intent said "X
  does not exist" — Aider created X. The diagnostician's
  prompt should be framed as POSITIVE assertions: "The
  service should use `LeaveRepository` (which exists at
  `src/modules/leave/leave.repository.ts`)" rather than
  "ILeaveRepository does not exist". This is a fixIntent
  schema-description change, not a HARNESS change.
- **(LOW — NEW from TR_031)** The phase-branch is deleted
  on squash-merge before the phase-evaluator runs against
  it. `git diff origin/<default>...origin/<phaseBranch>`
  returns empty when the branch is already gone, leading
  the evaluator to a false "0 files" verdict (caught here
  by the emphatic-tool-use prompt fix, but a more robust
  path is to pass the merge SHA in `branchContext`).

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH, promoted again)** Aider DTO drift.
  TR_030's prose instruction + TR_031's PLAN.md "What has
  been built" both shipped; neither produced reliable
  end-to-end multi-phase completion. The Aider-invocation
  change (`--read <file>`) is now the leading candidate.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010
  mandatory `executeScript tsc --noEmit` code-agent rule
  on trackeros's HARNESS.json. Pre-emit TS check on each
  Aider run would catch most of the drift before commit.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture in `agent_executions.tokens_used`.

Build status: `pnpm -r build` clean across all 13 packages
on each iteration. Docker server rebuilt twice (once per
TR_030 + TR_031). All builds clean. Server `/health` 200
throughout. Template auto-refreshes on next server boot to
`0.16.0`.

trackeros operator commits in this session:
- TR_030: HARNESS edits (no new). Stranded PRs closed.
- TR_031: `7d94746a` — HARNESS preservation rule added.
  `d196fc66` — `git rm` stale leave module + test (cycle
  3 cleanup).

trackeros planning-loop commits (auto-merged on main):
- Cycle 2: PR #93 Phase 1 deploy.
- Cycle 3: PR (Phase 1 deploy with new model+repo).

Multiple stranded PRs closed during cleanup: #94–#107
range across the day.

---
### Session 2026-06-09 — Claude Code (TR_029: planner+evaluator prior-phase path rules — planner side verified; Aider code-agent prompt does not honour scope-cited paths; new HIGH follow-up captured)

Brief: add explicit "include prior-phase file paths in scope
text" rules to `agentConfig.planner-agent.phaseScopingRules`
and `agentConfig.phase-evaluator-agent.rules` to fix the
TR_028 Aider DTO-drift blocker. Push to template +
trackeros, re-submit the leave-management feature, verify
Phase 2 scope cites `src/modules/leave/leave.model.ts` by
full path.

What changed (HARNESS edits only — no platform code change,
no migration):

- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** —
  two new `agentConfig.planner-agent.phaseScopingRules` items
  (verbatim from the brief): one mandating per-phase explicit
  prior-file-path lists, one specifically for repository-phase
  scopes referencing the prior model path. One new
  `agentConfig.phase-evaluator-agent.rules` item mandating
  full-path replacement when adjusting scopes after a partial
  verdict.
- **`/Users/amrmohamed/Work/trackeros/HARNESS.json`** —
  identical edits committed as `cf35c03b`.
- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.14.0` → `0.15.0`.
- **trackeros cleanup** — `git rm leave.model.ts` to remove
  the stray repo-root file TR_028's fix-intent created.
  Committed alongside the HARNESS edit.

Test cleanup:

- Closed TR_028 stranded PRs #83 #84 #85 #87 (already
  closed; idempotent).
- Closed TR_029 stranded PRs #89 #90 #91 with
  `--delete-branch`.

Live verification (Step 2 + Step 3 of the brief):

- `gestalt feature submit "..."` returned feature
  `068adb58-cf71-43b6-993f-ed4889a861c7`, status `planning`.
- architecture-agent 21:38:21; planner-agent 21:38:29.
- Planner emitted 4 phases. **The planner-side change worked
  end-to-end** — PLAN.md `Phase 2` carries:
  > _Depends on: src/modules/leave/leave.model.ts,
  > src/modules/leave/leave.repository.ts_
  >
  > "This phase depends on src/modules/leave/leave.model.ts
  > and src/modules/leave/leave.repository.ts from Phase 1."
- **Phase 1 (model + repository in same phase) → ✓ deployed**
  at 21:41:45 via the full Aider 9s → CI pass → PR-Agent 33s
  → verdict `none` → gate (constraint-agent only, ADR-051
  skip) → squash-merge chain (PR #88). TR_023's "model +
  repository together" rule was actually applied this time
  because the rule had been in HARNESS.json for prior cycles
  but the planner wasn't honouring it before — TR_029's
  additional phaseScopingRules tipped it over.
- **Phase 2 (service) → blocked** after 3 attempts × 2
  self-healing retries each (6 total Aider runs in ~10
  minutes). PRs #89, #90, #91 all failed CI. **The
  Aider-side gap surfaced** — even with Phase 2's scope text
  explicitly saying "This phase depends on
  src/modules/leave/leave.model.ts...", Aider's generated
  service code hallucinated against the deployed Phase 1
  files:
  - Imported `ILeaveRepository` from `./leave.repository`
    (Phase 1 exports `LeaveRepository`, not `ILeaveRepository`)
  - Referenced `LeaveRequest.leaveType` (Phase 1 model has
    `leaveTypeId`)
  - Tried to import `../balance/balance.model` and
    `../employee/employee.model` — sibling modules that the
    planner never scheduled. The architecture-agent's
    high-level model list mentions balance/employee modules
    at the FEATURE level; the planner only scheduled 4
    phases (model+repo / service / routes / tests). Aider
    read the architecture description, not the actual phase
    scope.
- Self-healing this cycle chose **pure retry** every time
  (not `fix-intent`). The diagnostician's call wasn't
  unreasonable — the errors looked like "code mistake" not
  "systemic gap" — but on the same Aider-quality failure
  pattern as TR_028, a fix-intent dispatch wouldn't have
  unblocked the cycle either (TR_028 verified that path).
- Phase 2 hit `Phase retry budget exhausted — marking phase
  failed and feature blocked` at 21:52:54. Wall-clock
  submission → blocked: ~14m 33s.

What this VERIFIES:

- ✅ Planner correctly emits prior-phase file paths in scope
  text after the TR_029 rule additions. Visible in PLAN.md
  on trackeros main.
- ✅ Planner correctly bundles model + repository in a
  single phase (TR_023 rule + TR_029 reinforcement).
- ✅ Phase 1 deploys end-to-end through Aider → CI →
  PR-Agent → gate → promotion in <3 minutes — same shape
  as TR_028 Phase 1.
- ✅ PR-Agent posts the "PR Reviewer Guide" comment on PR
  #88; verdict `none` → proceed.
- ✅ Phase-evaluator returns `partial` (1 adjustment
  applied) and updates PLAN.md with the actual paths.
- ✅ Phase 2 auto-dispatched after Phase 1 deploys.
- ✅ Phase retry budget exhausts cleanly (`Phase retry
  budget exhausted` log line + feature `blocked` state).

What this DOES NOT verify (regression-equivalent of
TR_028):

- ❌ End-to-end multi-phase autonomous completion. Phases
  3 + 4 never reached.
- ❌ Aider reading the files the scope text names. Even
  with a verbatim "read it before generating any code that
  references its types" instruction, Aider hallucinates
  field names and import paths.

Decisions made:

- **Did not extend the code-agent prompt in this session.**
  The brief asked for HARNESS edits only; the Aider
  code-agent gap is a NEW finding from TR_029 verification,
  not part of the brief. Captured as a new HIGH follow-up
  for a future TR_xxx session.
- **Did not advance phase retry budget** above 2. The
  underlying failure is Aider's reading discipline, not
  budget; more retries would just multiply cost.

Pending follow-ups (NEW from TR_029):

- **(HIGH — NEW from TR_029)** Aider code-agent prompt must
  mandate `readFile()` on every path mentioned in the phase
  scope BEFORE generating code. Today the scope text says
  "depends on src/modules/leave/leave.model.ts" verbatim;
  Aider receives this and starts generating without
  reading. Options: (a) add a code-agent rule to HARNESS
  ("Before writing any code, call readFile() on every path
  mentioned in the scope under 'Depends on:'"); (b) modify
  code-agent's prompt assembler to pre-fetch the contents
  of cited paths and inline them; (c) Aider's `--read`
  flag for explicit file-list injection.
- **(HIGH — NEW from TR_029)** Architecture-agent's
  module-level high-level description ("Modules: leave /
  balance / policy / employee — each owns these files...")
  feeds into Phase 2's prompt context. Aider treats this as
  ground truth and tries to import from sibling modules
  that the planner never scheduled. Either (a) the
  architecture-agent's output shouldn't be in the
  code-agent's context (only the planner's phase scope
  should be), or (b) the planner's scope text must
  explicitly say "DO NOT import from modules outside this
  phase's file list".
- **(MEDIUM — NEW from TR_029)** Self-healing's `retry` vs
  `fix-intent` routing decision is opaque. In TR_028 the
  diagnostician chose `fix-intent` for the same class of
  Aider-quality failure; in TR_029 it chose `retry` every
  time. The decision is LLM-driven (ADR-050, no hardcoded
  pattern matching) so variance is expected — but
  operators should see WHY in the alert body
  (`technicalDetail` is populated but not surfaced on the
  current alert page).

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH)** TR_023/TR_028 Aider DTO drift —
  PROMOTED again as TR_029 confirmed the planner-side fix
  is necessary but not sufficient.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010
  mandatory `executeScript tsc --noEmit` code-agent rule on
  trackeros's HARNESS.json. Would have caught Phase 2's TS
  errors pre-emit before Aider committed each round.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture in `agent_executions.tokens_used`.

Build status: unchanged. `pnpm -r build` not re-run (no
source files modified). Server state unchanged. Docker
image unchanged. Template auto-refreshes on next server
boot to `0.15.0`.

trackeros operator commits in this session:
- `cf35c03b` — HARNESS.json TR_029 rules + remove stray
  repo-root `leave.model.ts`.

trackeros planning-loop commits (auto-merged):
- `c44960f7` — Phase 1 deployed (model + repository
  together in `src/modules/leave/`).
- (PLAN.md updates — `git pull` to see exact SHAs.)

PR-Agent's review comment confirmed on PR #88. PRs #89,
#90, #91 closed during cleanup.

