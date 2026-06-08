# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md

_Auto-regenerated after every session by Claude Code. Do not edit by hand._

_Generated: 2026-06-09_

---


_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-09 (after TR_029 — added explicit "include prior-phase file paths in scope text" rules to `planner-agent.phaseScopingRules` + `phase-evaluator-agent.rules` to fix the TR_028 Aider DTO-drift blocker. Template 0.14.0 → 0.15.0. **Planner-side change verified end-to-end** — Phase 2's scope on the re-submitted leave-management feature explicitly cites `src/modules/leave/leave.model.ts` + `leave.repository.ts` by full path; Phase 1 correctly bundled model+repository (TR_023 rule honoured). Phase 1 deployed cleanly (PR #88, ~3m). **Aider-side gap surfaced**: even with the scope text explicitly saying "depends on src/modules/leave/leave.model.ts", Aider's Phase 2 service code hallucinated against the deployed Phase 1 files (`ILeaveRepository` vs `LeaveRepository`, `LeaveRequest.leaveType` vs `leaveTypeId`, imports of non-scheduled sibling modules `../balance/`, `../employee/`). 6 Aider runs across 3 phase attempts; self-healing chose pure `retry` every time (not fix-intent). Feature blocked at 1/4 phases. Two new HIGH follow-ups: (1) code-agent prompt must mandate readFile() on every cited path before generating; (2) architecture-agent's high-level module list is leaking into code-agent context and Aider imports from un-scheduled sibling modules.) Last full session report at `docs/claude/TEST_REPORT_028.md`; TR_028 is the prior milestone for end-to-end machinery.

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

---
### Session 2026-06-08 — Claude Code (TR_028: full planning loop re-test with PR-Agent on leave-management feature — autonomous machinery verified end-to-end; Phase 2 blocked by known TR_023 Aider DTO-drift)

Milestone test (per the brief): submit the leave management
feature to trackeros and verify the full planning loop runs
autonomously with PR-Agent, fix-intent self-healing, git-based
file detection, and phase evaluation all wired together.

Pre-flight (Step 1 + Step 2 of the brief):

- main was already at `8f17ef9` from the prior session — no
  branch merge needed. `pnpm -r build` clean; `docker compose
  ps` showed server / postgres / redis healthy. `/health` 200.
- trackeros main carried no stale `src/modules/leave/`
  directory (the brief's Step 2 cleanup was already current).
  Closed three pre-existing stranded PRs: #78 (earlier leave
  Phase 1), #53 (old health check), #48 (old scaffold).
- HARNESS.json verified: `planner.maxPhasesPerFeature: 10`,
  `maxFilesPerPhase: 5`, `maxPhaseRetries: 2`,
  `prAgent.enabled: true`, `pendingTimeoutSeconds: 90`.

Feature submission (Step 3):

- `gestalt feature submit "Build the leave management
  module..."` returned feature `e9240cb6-0533-4e0d-a372-
  f13e297debdd`, status `planning`.
- architecture-agent ran at 20:27:53, planner-agent at
  20:28:01 — both clean.
- Planner emitted 4 phases: model / repository / service /
  routes. PLAN.md committed to trackeros main + `_Adjustment:_`
  annotations added by phase-evaluator's `partial` verdict on
  Phase 1.

Per-phase timeline:

- **Phase 1 (model) — `94f1c8b7` → PR #82 → ✓ deployed.**
  Aider 5s → CI pass → PR-Agent 27s → verdict `none` → gate
  (constraint-agent only, ADR-051 skip) → squash-merged
  20:31:04. Wall-clock submit-to-deploy ~2m 44s. PR-Agent's
  "PR Reviewer Guide" comment confirmed on the PR.
- **Phase 2 (repository) — three attempts × 2 self-healing
  retries each, plus 1 fix-intent cycle — feature blocked.**

The autonomous machinery exercised exactly as designed:

- Phase 2 attempt 1 (`af45fd70` / PR #83) — CI failed on
  `TS2339 Property 'leaveType' does not exist on LeaveRequest`.
  Self-healing chose `retry` → retry failed → escalated as
  "retry introduced new violations" → planner-level retry
  fired (1/2).
- Phase 2 attempt 2 (`f777f69a` / PR #84) — same TS2339
  family of errors. Same retry-then-escalate cycle. Planner
  retry 2/2 fired.
- Phase 2 attempt 3 (`13d7ac9c` / PR #85) — same failure
  pattern. At 20:40:57 the self-healing-agent diagnostician
  chose **`action: 'fix-intent'`** ("systemic gap detected").
  Parent intent parked; child intent `53347035` dispatched
  with `source: 'self-healing-fix'`, `parent_intent_id` →
  13d7ac9c.
- **Fix-intent child — `53347035` → PR #86 → ✓ deployed.**
  Aider 4s → CI pass → PR-Agent 24s → verdict `none` → gate
  → squash-merged 20:43:18. Wall-clock fix-dispatch →
  fix-deployed → parent resumed ~2m 25s. `onSuccessDispatch`
  envelope fired at 20:43:22 — "Fix deployed — resuming
  original intent via onSuccessDispatch".
- **Parent Phase 2 resumed → also failed.** Aider's next
  generation drifted to a different mismatched field set
  (`totalDays / usedDays / year` on LeaveBalance). Self-
  healing burned another retry pair. 20:46:53 — "Phase retry
  budget exhausted — marking phase failed and feature
  blocked".

Final state: feature `e9240cb6` status `blocked`, 1/4 phases
deployed. Phases 3 + 4 not reached. Total wall-clock submission
→ blocked: ~19 minutes.

Root cause:

- **Aider DTO drift between phases — the known TR_023
  follow-up.** Phase 1's `src/modules/leave/leave.model.ts`
  defines `LeaveRequest.leaveTypeId` + `LeaveBalance.balance`.
  Every Phase 2 Aider run wrote a repository referencing
  DIFFERENT field names (`leaveType`, `totalDays`, `usedDays`,
  `year`). Aider isn't reading the existing model before
  writing the repository.
- **Fix-intent prompt quality gap — NEW from TR_028.** The
  diagnostician correctly chose `fix-intent` and dispatched a
  well-formed-sounding intent ("Define the LeaveBalance type
  to include properties: remainingLeaves, usedLeaves,
  totalLeaves"). But the prompt didn't include the file path
  the repository was importing from. Aider wrote a stray
  `/leave.model.ts` at the **repository root**, not at
  `src/modules/leave/leave.model.ts`. tsc never picked it up.
  PR #86 merged cleanly because the new isolated file
  compiles fine; the failing Phase 2 import still resolves
  to the old Phase 1 model. So the resumed Phase 2 failed
  identically to before the fix-intent.

What this VERIFIES architecturally (every TR_020–TR_027
mechanism actually fired in this single 19-min cycle):

- ✅ architecture-agent → planner-agent → PLAN.md commit
- ✅ TR_026 git-based file discovery via
  `AiderCodeAgent.discoverAiderWrites`
- ✅ TR_027 PR-Agent server-side invocation in /opt/pr-agent
  venv with per-call LLM creds — TWO clean runs on PRs #82
  and #86, both posted the "PR Reviewer Guide" comment
- ✅ ADR-051 gate skip: review-agent omitted, constraint-
  agent ran in parallel
- ✅ TR_026 phase-evaluator-agent calling git diff via
  executeScript (`partial` verdict emitted on Phase 1
  with 3 scope adjustments)
- ✅ Phase 2 event-bus auto-dispatch after Phase 1 deploy
- ✅ Self-healing diagnostician routing between `retry` and
  `fix-intent` (TR_024 + ADR-050)
- ✅ TR_024 fix-intent dispatch with `parent_intent_id`
  linkage + `onSuccessDispatch` envelope + parent resume
- ✅ TR_025 cascade-depth brake (`MAX_FIX_INTENT_DEPTH = 2`)
  — chain depth stayed at 1, no runaway
- ✅ TR_022 planner phase retry budget honoured (3 attempts
  total = 1 initial + 2 retries)

What this DOES NOT verify:

- ❌ End-to-end multi-phase autonomous completion. Phases 3
  + 4 never dispatched.
- ❌ Fix-intent prompt quality. The routing decision was
  correct; the resulting child prompt was too vague.

Test cleanup:

- Closed stranded Phase 2 PRs #83, #84, #85, #87 with
  `--delete-branch`.
- PR #86 (fix-intent's stray `/leave.model.ts` at repo root)
  left merged; it doesn't break anything because tsc never
  loads it, but trackeros's next planner cycle should be
  prefaced with a `git rm leave.model.ts` cleanup.
- TEST_REPORT_028.md committed in `docs/claude/` with the
  full per-phase log, root-cause analysis, and a cost
  envelope.

Pending follow-ups (NEW from TR_028):

- **(HIGH — promotes TR_023)** Aider DTO/repository drift
  remains the single hardest blocker for end-to-end
  autonomous feature completion. Either (a) extend
  code-agent's prompt with a mandatory "READ the imported
  model file before writing the repository" pre-step, or
  (b) require the planner to put `model + repository` in
  the same phase. The existing TR_023 rule isn't being
  enforced by the planner — Phase 1 ran model in isolation,
  Phase 2 ran repository in isolation.
- **(HIGH — NEW)** Self-healing fix-intent prompt
  enrichment. When choosing `fix-intent`, the diagnostician
  should include the exact failing import path and the
  deployed model's actual field shape. The TR_028 fix-intent
  dispatched a path-less "Define type X with properties A,
  B, C" prompt; Aider made the simplest interpretation and
  landed a stray root-level file.
- **(MEDIUM — NEW)** Phase-evaluator's `partial` verdict
  + scope adjustments work — PLAN.md was updated — but
  the adjustments don't feed back into the planner's
  "phase grouping" decisions. If the evaluator notices
  "Phase 1 only created the model, repository still
  needed", it could merge "model + repository" into one
  phase rather than annotating Phase 2.
- **(LOW — NEW)** The fix-intent flow logs "Fix deployed
  — resuming original intent via onSuccessDispatch" but
  doesn't emit a clear "parent resumed → Aider running"
  message at the resume point. Operators see two
  `Running Aider` log lines back-to-back and have to
  correlate by intent ID.

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH)** TR_023 / TR_028 Aider DTO drift —
  PROMOTED to a TR_028-priority blocker.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010
  mandatory `executeScript tsc --noEmit` code-agent rule
  on trackeros's HARNESS.json. Would have caught Phase 2's
  TS errors pre-emit before Aider committed each round.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture in `agent_executions.tokens_used` — TR_028's
  cost envelope had to be order-of-magnitude estimated
  because code-agent rows still show 0 tokens.

Build status: unchanged from TR_027. `pnpm -r build` not
re-run (no source files modified). Server state unchanged.
Docker image unchanged.

trackeros operator commits in this session: none (the
test only writes via the autonomous loop — PRs #82 (Phase 1
deployed) and #86 (fix-intent deployed)).

---
### Session 2026-06-08 — Claude Code (TR_027 / ADR-051: PR-Agent replaces review-agent — server-side direct invocation; venv isolation; verified end-to-end on trackeros PR #81)

Brief: replace Gestalt's custom review-agent with CodiumAI
PR-Agent invoked directly by the pipeline-agent as a server-side
`executeScript` subprocess after CI passes. No webhook, no
separate Docker service, no GitHub Secrets for LLM keys —
PR-Agent receives Gestalt's resolved LLM credentials via
subprocess environment variables for that one invocation only.

What changed (server-side architecture):

- **`packages/agents/deploy/src/adapters/pr-agent-adapter.ts`** —
  NEW. `runPrAgentReview()` resolves LLM env vars per call
  (Azure: `OPENAI__API_TYPE=azure` + `OPENAI__API_VERSION`;
  OpenAI/Ollama/compatible: `OPENAI__API_BASE` + `OPENAI__KEY`);
  invokes `pr-agent --pr_url="<url>" review` via `executeScript`
  with 60s default timeout. Returns typed `PrAgentResult` —
  never throws.
- **`packages/agents/deploy/src/orchestrator/deploy-orchestrator.ts`** —
  added `maybeRunPrAgentAndRoute()` between CI-passed and
  gate-dispatch. Clones a shallow workdir, calls `runPrAgentReview`
  with credentials resolved via `getLLMClientForModel()`, then
  polls the PR via `GitHubActionsAdapter.getPrAgentVerdict` for
  up to 30s (6 × 5s). Three outcomes: `approved`/`none` → proceed
  to gate; `changes-requested` → invoke `attemptSelfHealingForDeploy({
  failureType: 'review-requested-changes', ... })` (reuses
  existing fix-intent mechanism); `pending` after poll budget → proceed
  with warning. PR-Agent exit-non-zero ⇒ proceed (best-effort,
  don't block the cycle).
- **`packages/agents/deploy/src/adapters/github-actions-adapter.ts`** —
  added `getPrAgentVerdict()` + `getPrAgentComment()` polling the
  GitHub PR Reviews + Comments APIs. Recognised PR-Agent bot logins:
  `pr-agent[bot]` / `codiumai-pr-agent[bot]` / `qodo-merge-pro[bot]`.
- **`packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`** —
  `shouldSkipReviewAgent(projectRoot)` reads HARNESS.json; when
  `prAgent.enabled && pipeline.adapter === 'github-actions'` the
  orchestrator skips review-agent entirely. constraint-agent
  still runs in parallel (HARNESS-rule enforcement remains
  Gestalt's responsibility, not PR-Agent's).
- **`packages/agents/quality-gate/src/agents/llm-review-agent.ts`** —
  `@deprecated` JSDoc block added at the top. The file is kept
  as a fallback path for non-github-actions adapters.

Server image + subprocess isolation:

- **`packages/server/Dockerfile`** — PR-Agent installed alongside
  Aider via `pip`, but in its own venv (`/opt/pr-agent`) because
  PR-Agent's `litellm` version has exception classes that
  Aider's exception adapter doesn't recognise — Aider would
  crash at import time if they shared a venv. Aider lives in
  `/opt/aider`. `/usr/local/bin/aider` is a symlink to the
  Aider venv binary; `/usr/local/bin/pr-agent` is a shell shim
  invoking the PR-Agent venv's `python -m pr_agent.cli`.
  Required Alpine deps for the wheel build: `gfortran` +
  `openblas-dev` (PR-Agent's numpy/scipy transitive deps).
  `--prefer-binary` on the pip install keeps the image lean.

Harness + config:

- **`packages/core/src/harness/index.ts`** — `HarnessConfig` gained
  optional `prAgent?: { enabled, blockOnChangesRequested?,
  pendingTimeoutSeconds? }` block.
- **`packages/server/src/templates/pr-agent-toml.ts`** — NEW.
  `generatePrAgentToml(harnessConfig)` builds `.pr_agent.toml`
  from `agentConfig['review-agent'].rules` +
  `agentConfig['constraint-agent'].rules` (deduped); outputs
  `[pr_reviewer]`, `[pr_description]`, `[pr_code_suggestions]`
  sections so the rules drive PR-Agent's per-project focus.
- **`packages/server/src/routes/projects.ts`** — init-harness
  now writes `.pr_agent.toml`; new
  `POST /projects/:id/push-pr-agent-config` regenerates +
  pushes the toml on harness updates.
- **`packages/cli/`** — `gestalt project config push-pr-agent-config`
  command + `pushPrAgentConfig()` API client method.

Self-healing:

- **`packages/core/src/agents/self-healing-loop.ts`** — added
  `'review-requested-changes'` to `FailureType` union + title
  template. **`packages/core/src/repository/index.ts`** — added
  same to `AlertType` union.
- **`packages/adapters/postgres/src/migrations/027_self_healing_pr_agent.sql`** —
  NEW. Seeds a self-healing config row for the new failure
  type (retry type = `fix-intent`).

Templates:

- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** +
  **`/Users/amrmohamed/Work/trackeros/HARNESS.json`** — added
  `prAgent: { enabled: true, blockOnChangesRequested: true,
  pendingTimeoutSeconds: 30 }` block + a self-healing-agent rule
  for `review-requested-changes`.
- **`templates/corporate-ops-web-mobile/ci/gestalt.yml`** —
  reverted to TR_020 shape (push-only trigger, no PR-Agent CI
  step). PR-Agent runs server-side now.
- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.13.0` → `0.14.0`.

Pivots:

- **v1 → v2**: original brief had PR-Agent run as a GitHub
  Actions step gated by a `GESTALT_LLM_API_KEY` repo secret. User
  rejected the secret-distribution model and provided a v2 brief
  requiring server-side invocation with credentials resolved
  per-call from Gestalt's vault/registry. v1 plumbing (CI step,
  pull_request trigger) was reverted on both the template and
  trackeros's workflow.
- **Single-venv → dual-venv**: an early `pip install aider-chat
  pr-agent` in the Dockerfile broke Aider at runtime
  (`ValueError: PermissionDeniedError is in litellm but not in
  aider's exceptions list` — PR-Agent's litellm exception
  classes Aider's adapter doesn't know). Fix was venv isolation;
  cleaner than version-pinning either tool.
- **CLI flag form**: first verification attempt failed with
  `argument command: invalid choice: 'https://...'` because the
  adapter used `--pr-url URL` (hyphen, space) but PR-Agent's CLI
  expects `--pr_url=URL` (underscore, equals). One-line fix in
  `pr-agent-adapter.ts`.

Live verification — trackeros intent
`1ba554af-f1d0-445b-94d2-46b3a62f0b27` (correlation
`3648e162-...`, PR #81):

- 20:01:59 — Aider code generation start
- 20:02:05 — Aider complete (6s)
- 20:02:0_ — pr-agent push → CI workflow_dispatch
- 20:03:08 — Running PR-Agent review (server-side)
- 20:03:31 — PR-Agent review complete (23.5s)
- 20:03:43 — PR-Agent verdict resolved (`verdict: "none"` —
  PR-Agent posts a comment, not a formal review approval; `none`
  routes the same as `approved`: proceed to gate)
- 20:03:52 — ADR-051 — PR-Agent enabled; gate skipping
  review-agent (constraint-agent still runs)
- 20:04:03 — PR #81 squash-merged via auto-merge
- **Status: ✓ deployed**, single round, attempt_count=0,
  wall-clock 2m 04s.

PR-Agent's "PR Reviewer Guide" comment confirmed on PR #81:
estimated effort 1🔵 / no security concerns / table of findings.
Posted under the project PAT's identity (the operator's bot
account, not a dedicated pr-agent[bot] login — both work; the
adapter recognises either).

Decisions made:

- **Venv isolation over version pinning.** Pinning either
  litellm or aider-chat would couple the platform's upgrade
  cadence to two upstream projects. Each `/opt/<tool>` venv
  with PATH shims keeps the dep graphs entirely independent.
- **`verdict: "none"` → proceed.** PR-Agent's `review` command
  posts an informational `## PR Reviewer Guide` comment, not a
  formal GitHub PR review with APPROVED state. The deploy
  orchestrator treats `none` identically to `approved` —
  CHANGES_REQUESTED is the only verdict that routes to
  self-healing. Avoids false-positive blocking on every PR.
- **Best-effort on PR-Agent failure.** Exit-non-zero from the
  subprocess (network blip, LLM auth issue, malformed PR diff)
  emits a WARN and proceeds. Blocking the deploy on a
  PR-reviewer adjunct would defeat the point.
- **`@deprecated` rather than delete** llm-review-agent.ts.
  Kept as the fallback path for non-github-actions adapters
  (the `getPrAgentVerdict` polling is GH-specific).
- **`.pr_agent.toml` generated from HARNESS rules.** PR-Agent
  reads `extra_instructions` from the file; deriving it from
  HARNESS rules means a single source of truth for "what does
  this project consider a violation."
- **Closed stranded PR #79** (failed first attempt with broken
  default-export edit; clean state on trackeros now).

Pending follow-ups (NEW from TR_027):

- **(LOW)** PR-Agent's verdict polling has a 30s budget
  (6 × 5s). If PR-Agent itself takes longer than 30s (which
  rarely happens — typical wall is ~23s), the verdict falls
  through to `pending → proceed`. Could be threaded into
  HARNESS.json's `prAgent.pendingTimeoutSeconds` to make the
  poll budget project-tunable (the field already exists in
  the type, just not yet read by the orchestrator).
- **(LOW)** `chat-latest` as a litellm model alias works
  because OpenAI's `chat-latest` resolves at the API edge.
  Other providers (Anthropic, Ollama) would need their own
  alias semantics. Document as a known constraint of the
  per-project LLM choice.

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend capture in
  `agent_executions.tokens_used`.
- **(STILL OPEN — MEDIUM)** TR_019: `gestalt init` scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest with TS.
- **(STILL OPEN — LOW)** TR_019: template `{{ciSetupSteps}}` for
  Node/npm should add `--legacy-peer-deps`.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt twice (venv split + CLI flag fix); on the
final run `aider 0.86.2` + `pr-agent` (latest) both invoke
cleanly. `/health` 200 throughout. Template auto-refreshed at
boot: `version: "0.14.0"`. trackeros PRs: #80 deployed (first
flow — but PR-Agent failed silently due to CLI flag bug;
proceed-on-error path worked, deploy still succeeded). #81
deployed (full flow including PR-Agent posting its review
comment). #79 closed-stranded from the broken first attempt.

