# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md

_Auto-regenerated after every session by Claude Code. Do not edit by hand._

_Generated: 2026-06-08_

---


_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-08 (after TR_025 — two surgical fixes to the autonomous planning loop. `MAX_FIX_INTENT_DEPTH=2` + `getFixIntentChainDepth` walker in `self-healing-loop.ts` close TR_024's cascading-fix-intent runaway. Planning-orchestrator's phase-evaluator file-list rewritten to use `git diff origin/<defaultBranch>..origin/<phase.branchName>` instead of the artifacts table — Aider's code writes never landed there, so the evaluator was previously always escalating with `builtFilePaths: []`. **Live verified**: feature `eed75889` (Leave management module) on clean trackeros — Phase 1 deployed cleanly (3 files built), evaluator verdict `success`, Phase 2 **auto-dispatched** — proving the autonomous loop. Phase 2 hit a separate Aider quirk (chat output had code, `Files changed: 0`); captured as TR_026 follow-up. trackeros operator cleanup commit `cd27ed17` removed the stale TEST_REPORT_011 leave/ seed.)
**Repo:** https://github.com/afarahat-lab/gestalt
**Migrations:** 026 (latest: `026_intent_parent`)

---

## What is built and verified

### Platform foundations

- All 13 buildable packages compile (`pnpm -r build`).
- `docker-compose up -d` brings server + postgres + redis healthy.
- All 26 migrations apply on first start.
- Server reachable on `http://localhost:3000`; `/health` returns 200;
  protected routes return 401 without a JWT.
- Dashboard SPA served at `/app/*`; shareable deep-link URLs work.
- First-boot bootstrap verified: `gestalt init-admin` → `gestalt login`
  → `/auth/me` returns the user.

### Five SDLC layers (all wired end-to-end)

- **generate** — intent → design → context → lint-config → code → test;
  custom agents in `agents.yaml` interleave via `runs_after`.
- **quality-gate** — constraint-agent + review-agent (both LLM,
  ADR-041 — gate runs AFTER CI, not before pr-agent). Gate clones
  the PR branch, checks it out, and reads source files directly
  from the working tree (`readFromBranch: true`). On pass dispatches
  `deploy:promotion` (staging); on fail forwards `resumeOnBranch`
  so the retry leg pushes to the same PR. Verdict:
  `pass` / `fail` (auto-retry) / `escalate` (GP_BREACH).
  Max gate retries: 3. Pre-CI lint/security/test-runner stubs
  deleted — CI uses the project's own ESLint / Vitest / Semgrep
  via the comprehensive `gestalt.yml` workflow template.
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

### TR_025 — Cascade-depth brake + phase-evaluator file-list fix

Two fixes to harden the autonomous planning loop:

- **`MAX_FIX_INTENT_DEPTH = 2`** in `self-healing-loop.ts`.
  Before submitting a fix-intent, the loop walks
  `parent_intent_id` upward; when depth ≥ 2 it
  force-escalates instead of cascading. ADR-050 intact —
  the LLM still chooses the action; platform enforces the
  ceiling.
- **Phase-evaluator's built-file list** now sourced from
  `git diff` against the PR branch rather than the
  artifacts table (which only ever held `design`-type rows
  for Aider-codegen projects). Three-stage fallback:
  PR-branch diff → merged-commit scan → legacy
  artifacts-table read.

**Live verified**: feature `eed75889` Phase 1 deployed
successfully and Phase 2 auto-dispatched. Phase 2 failed
on a separate Aider issue (TR_026 follow-up). The
autonomous planning loop is proven end-to-end for the
phase-1-to-phase-2 transition.

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

### TR_021 — Externalise verificationGuidance to HARNESS.json

Refactor (kept brief; see `sessions/RECENT.md` for the full
narrative). Lifted project-specific "HOW to verify before
flagging" hints out of `llm-review-agent.ts` and into
`HARNESS.json.agentConfig[role].verificationGuidance`. PLANNING_LAYER
extended the same helper to render three more sub-section types
(phaseScopingRules, evaluationCriteria, architectureGuidance).
Template went 0.6.0 → 0.7.0 → 0.8.0.

### TR_020 — Real GitHub Actions deploy works end-to-end

trackeros's first `Status: ✓ deployed` against the real
`github-actions` adapter — 1m 58s, single round, PR #54
squash-merged. See `docs/claude/TEST_REPORT_020.md`.

### Resolved by TR_020 (kept brief)

Gate retry budget threading + ABSOLUTE_MAX_RETRIES + CI dedupe
all resolved. See `docs/claude/TEST_REPORT_020.md` for the full
diff.

### Active follow-ups (carryover or NEW)

- **(HIGH — NEW from TR_025/TR_026)** Aider "Files changed: 0"
  silent failure. On Phase 2 of the leave-management
  verification, Aider's chat output contained valid
  LeaveService code but reported zero file writes. Need
  to detect this pattern (parse `aider-output.md` for
  `Files changed: 0` AND non-empty chat code blocks) and
  surface as a TEST_FAILURE signal so self-healing fires.
- **(MEDIUM — NEW from TR_025)** Cascade-depth brake
  code-path verified at build/typecheck only; the
  MAX_FIX_INTENT_DEPTH escalation path has not been
  exercised on a live cascade. A targeted test (force-fail
  a fix-intent's CI twice) would close this.
- **~~(HIGH — NEW from TR_024)~~ RESOLVED by TR_025**
  (structurally — depth ceiling in place).
- **(HIGH — NEW from TR_024)** Cascading fix-intent prevention.
  Each fix-intent failing CI triggers ANOTHER fix-intent (the
  diagnostician keeps choosing `action: fix-intent`). Need to
  track chain depth on `parent_intent_id` and force escalation
  when depth ≥ 2. Captured as TR_025.
- **(MEDIUM — NEW from TR_024)** `collectCiTechnicalDetail` is
  github-only. Azure DevOps / GitLab CI adapters silently
  return undefined and the diagnostician loses the actual
  error text.
- **(LOW — NEW from TR_024)** Dashboard could render the full
  fix-intent chain on `IntentDetail` (today shows only direct
  parent / direct child).
- **(HIGH — NEW from TR_022)** Aider DTO-field hallucination —
  Aider's generated repository / service code references fields
  not present on the DTO (e.g. `Property 'employeeId' does not
  exist on type 'CreateLeaveRequestDto'`). Three consecutive
  attempts on the leave-management feature's phase 1 all
  produced the same class of error; the retry budget bailed
  cleanly, but the feature didn't progress. Either extend the
  code-agent prompt with a "READ the DTO file first" rule or
  require model + repository in the same Aider call. Tracked
  as TR_023.
- **(LOW — NEW from TR_022)** `readMaxPhaseRetries` re-clones
  HARNESS.json on every failure dispatch. Cheap (~250ms) but
  could be cached per-feature for the lifecycle.
- **~~(MEDIUM — PLANNING_LAYER)~~ RESOLVED by TR_022.**
  Phase failure → feature blocked was too eager. Now bounded
  by `planner.maxPhaseRetries` (default 2) and verified live
  on feature `1a5dcfc5`.
- **~~(MEDIUM — PLANNING_LAYER)~~ RESOLVED by TR_022.**
  Original Aider `resolveJsonModule` failure mode addressed
  in trackeros tsconfig + template default code-agent rule.
- **~~(LOW — PLANNING_LAYER)~~ RESOLVED by TR_022.** Per-phase
  architecture review verified live on feature `37799ea9`.
- **(LOW — NEW from PLANNING_LAYER)** The orchestrator stores
  phase scope adjustments under `feature_phases.result.pendingScopeAdjustment`
  and the next `planning:phase` reads them when assembling the
  intent text. The scope itself never overwrites the original
  `scope` column — by design, so the planner's first draft stays
  visible to operators. Consider a dedicated `scope_history` array
  if operators need a full history.
- **(LOW — NEW from TR_021)** Consider migrating the
  `consistencySection` block (cross-artifact checks:
  test-framework match, import resolution, @types/* coverage,
  test-file placement) out of `llm-review-agent.ts`'s
  `buildReviewPrompt` into HARNESS.json verificationGuidance.
  Borderline platform-mechanic / project-specific; works fine
  in code today but a non-Node project might want to tune it.
- **(LOW — NEW from TR_021, structurally addressed)** The TR_020
  "extend trust-CI to constraint-agent" item is now a one-line
  edit to `agentConfig['constraint-agent'].verificationGuidance`
  in HARNESS.json. Not added in TR_021 because constraint-agent
  doesn't currently hit the hallucination; documented here so
  the next regression can be fixed without a code change.
- **(MEDIUM — TR_019, still relevant)** `gestalt init` should
  scaffold a `.gitignore` + align jest/ts-jest/@types/jest
  versions with TypeScript. trackeros's jest@27 + TS@5 mismatch
  was latent under `noop`; same scaffolding should align Node 22.
- **(LOW — TR_019, still relevant)** Template
  `{{ciSetupSteps}}` for Node/npm should add `--legacy-peer-deps`
  on `npm install` until the upstream npm arborist
  `Link.matches` bug is fixed.
- **(LOW — TR_019, still relevant)** Add a `tsc --noEmit` sanity
  check on scaffolded tests in `gestalt init`.

### Carryovers (TR_018 / TR_014)

- **(HIGH — TR_018)** Restore the TR_010 mandatory `executeScript
  tsc --noEmit` code-agent rule on trackeros's HARNESS.json. CI's
  `Compile` step catches the same errors post-hoc but the rule
  catches them pre-emit during Aider's generation.
- **(MEDIUM — TR_014)** Aider token-spend visibility. Parse
  `Tokens: N sent / M received` from Aider's stdout. code-agent
  rows still show 0 tokens across all rounds.

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
| Migrations applied | 026 (latest: `026_intent_parent`) |
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

### ADRs 042–049 — Platform/operator split and related principles codified

Documentation-only session. Eight ADRs appended to
`docs/DECISIONS.md`: ADR-042 (LLM guidance prose lives in
HARNESS.json + agents.yaml, never `.ts`), ADR-043 (Aider opt-in
backend), ADR-044 (gpt-4o for gate, gpt-4o-mini for code-gen),
ADR-045 (evidence requirement — every finding needs a
`quotedLine`), ADR-046 (LLM-driven script execution for gate
verification — no hardcoded script commands), ADR-047 (CI/CD
owns runtime verification; gate owns architectural review —
extends ADR-041), ADR-048 (LLM-driven retry routing via
`SelfHealingDiagnosis.retryTaskType`, no hardcoded dispatch
maps), ADR-049 (architecture agent uses phased consultation —
`designFeature()` + `designPhase()` — not single-call full
design). No platform code change; no migrations.

**Operator action:** None. ADRs are read-only contracts the
platform already honours.

### TR_021 — Externalise gate-agent verificationGuidance to HARNESS.json

Refactor: STEP 1-5 verification protocol lifted from
`llm-review-agent.ts` into
`HARNESS.json.agentConfig[role].verificationGuidance`. Platform
mechanics (evidence requirement, severity ceiling, JSON schema,
parser-level dropUnevidencedFindings, ABSOLUTE_MAX_RETRIES) stay
in code. constraint-agent gained the configurable section "for
free" via the shared `renderHarnessAgentRules` helper. Template
bumped 0.6.0 → 0.7.0. Two trackeros cycles deployed
single-round (PR #55 pre-commit no-regression + PR #56
post-commit prompt-render verified). No new migrations.

### TR_020 — First clean github-actions deploy

trackeros's first `Status: ✓ deployed` against the real
`github-actions` adapter: 1m 58s, single round, PR #54
squash-merged. Four fixes: console.log rule scope, retryCount
threading, CI trigger dedupe (3→1), executeScript stripped +
"trust CI" prompt. Template bumped 0.5.0 → 0.6.0.

**Resolved (structurally) by TR_021:**
- ~~LOW — TR_020: extend "trust CI" rule to constraint-agent~~ —
  now a one-line edit to
  `agentConfig['constraint-agent'].verificationGuidance` in
  HARNESS.json; no platform code change required.

### Carryovers (TR_019 / TR_018 / TR_014)

- **MEDIUM — TR_019:** `gestalt init` should scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest versions with
  TypeScript. trackeros's jest@27 + TS@5 mismatch was latent
  under `noop` and only surfaced when CI ran jest.
- **LOW — TR_019:** Template `{{ciSetupSteps}}` for Node/npm
  should include `--legacy-peer-deps` on `npm install` until the
  upstream npm arborist `Link.matches` bug is fixed.
- **LOW — TR_019:** Add a `tsc --noEmit` sanity check on
  scaffolded tests in `gestalt init`.
- **HIGH — TR_018:** Restore TR_010 mandatory `executeScript
  tsc --noEmit` code-agent rule on trackeros's HARNESS.json.
- **MEDIUM — TR_014:** Aider token-spend capture. Parse
  `Tokens: N sent / M received` from Aider's stdout and surface
  as `tokens_used` on the execution row.

### Recent trackeros operator commits (already pushed)

- `13223d29` (TR_021) — HARNESS.json `verificationGuidance`
  arrays added to constraint-agent + review-agent blocks.
- `f926e840` (TR_020) — agents.yaml review-agent tools stripped
  + trust-CI prompt extension.
- `99a48c73` (TR_020) — HARNESS.json console.log rewording +
  gestalt.yml pull_request trigger removed.

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
### Session 2026-06-08 — Claude Code (TR_025: cascade-depth brake + planning evaluator file-list fix — autonomous loop verified phase 1 → auto-dispatch phase 2 on the leave management feature)

Follow-up to TR_024. Two surgical fixes plus a live test of the
full autonomous loop on the leave management feature.

What changed (code):

- **`MAX_FIX_INTENT_DEPTH = 2`** + **`getFixIntentChainDepth`**
  helper in `self-healing-loop.ts`. Before calling
  `submitFixIntent`, the loop walks the `parent_intent_id`
  chain upward (bounded to 10 hops as a cycle-safety belt).
  When depth >= 2 the loop force-escalates instead of
  cascading. ADR-050 stays intact — the LLM still chooses the
  ACTION; the platform only enforces a hard ceiling on
  recursion in the same spirit as `MAX_GATE_RETRIES`.
- **Phase-evaluator built-file list fix** in
  `planning-orchestrator.ts`. The previous code read the
  `artifacts` table filtering for `type === 'code'`, but
  Aider's code writes never land there — only `design`-type
  artifacts (intent-spec, design-spec, aider-output) do. So
  the LLM always saw `builtFilePaths: []` and (correctly given
  no evidence) escalated every phase. The fix: after the
  evaluator clones the repo, do `git diff --name-only
  origin/<defaultBranch>..origin/<phase.branchName>` filtered
  to non-`.gestalt/` paths. Falls back to a merged-commit
  scan when the branch is gone (auto-merge already squashed),
  then to the legacy artifacts-table read.

Live verification on trackeros (real GitHub Actions CI):

- Pre-cleanup: trackeros's `src/modules/leave/{leave.model,
  leave.repository}.ts` were leftover seeds from TEST_REPORT_011
  and blocked Aider from emitting new code on Phase 1 (Aider
  saw the files already existed and produced empty PRs).
  Removed via `git rm -r src/modules/leave/` on trackeros
  `main` (commit `cd27ed17`) — fresh slate for the
  verification.
- Feature `eed75889` ("Build the leave management module...")
  submitted. Planner produced a **4-phase plan**.
- **Phase 1** ("Define Leave Request Model and Repository")
  dispatched → Aider built 3 files → CI passed → gate passed
  → phase deployed → **evaluator verdict: `success`** →
  **phase 2 auto-dispatched** at 04:17:15. End-to-end
  autonomous transition CONFIRMED.
- **Phase 2** ("Implement Leave Service Logic") dispatched →
  Aider's chat output produced the LeaveService code BUT
  reported `Files changed: 0` (Aider quirk — emitted code in
  chat instead of writing files) → 0 files diffed → evaluator
  verdict: `escalate` → feature blocked. Not a TR_025 bug —
  a separate code-agent / Aider integration issue captured
  as a follow-up.

The self-healing-agent fix-intent flow was NOT exercised live
this cycle because Aider's failure was "0 files written" rather
than a CI compile error — and the evaluator escalates a
deploy-with-no-deliverables outcome rather than routing through
self-healing (which only fires on CI failures or deploy errors).
The TR_025 depth brake code is in place and unit-tested via
build/typecheck but didn't run on a live cascade.

What this verification PROVES:

- Phase 1 → Phase 2 auto-dispatch end-to-end ✓
- planning-orchestrator's git-diff path produces the correct
  file count (Phase 1: 3 files, success; Phase 2: 0 files,
  escalate)
- Phase-evaluator's LLM reasoning is sound: with concrete file
  evidence it judges accurately
- The planning loop is genuinely autonomous — no human input
  between submit and Phase 2 dispatch

What this verification does NOT prove (TR_026):

- A fix-intent cascade hitting `MAX_FIX_INTENT_DEPTH` and
  force-escalating. Code-path tested only.
- Aider's "writes code in chat, 0 files saved" pathology. This
  is a code-agent reliability issue separate from planning.
- A full multi-phase feature completing autonomously. Phase 2
  failure blocks Phases 3-4.

Decisions made:

- **Cleaned trackeros's leave/ seed files** (operator commit
  `cd27ed17` on `main`). The TEST_REPORT_011 seed was older
  than the current planner — files conflicted with
  planning-emitted code. With the user's explicit go-ahead.
- **Used `simple-git` diff against `origin/<branch>` rather
  than the local checked-out tree**. The evaluator clones at
  defaultBranch, so the phase's PR branch needs an explicit
  fetch + remote-ref diff. Cheaper than checking out the
  branch in-place.
- **Three-stage fallback in built-file resolution**: PR-branch
  diff → merged-commit scan → legacy artifacts-table read.
  Each stage handles a real edge case: auto-merge having
  cleaned the branch, no-correlation-id commits, and the
  rare pre-Aider gestalt-codegen path.
- **Did NOT modify Aider's invocation** to make it emit files
  reliably. That's a code-agent layer issue. Surfaced as
  TR_026 follow-up.

Pending follow-ups (NEW from TR_025):

- **(HIGH — TR_026)** Aider's "Files changed: 0" silent
  failure on Phase 2. The chat output contained the
  LeaveService code but Aider reported zero file writes.
  Either Aider's SEARCH/REPLACE block wasn't well-formed
  for a NEW file, or Aider's apply step silently dropped
  the change. Need to detect this pattern and surface it
  to self-healing (e.g. emit a TEST_FAILURE signal when
  `aider-output.md` shows `Files changed: 0` AND the
  intent demanded new files).
- **(MEDIUM — TR_025)** The MAX_FIX_INTENT_DEPTH brake has
  not been exercised on a live cascade. Code-path
  verification only. A targeted test (force-fail a
  fix-intent's CI twice) would prove the escalation path.
- **(LOW — TR_025)** When the legacy artifacts-table
  fallback fires, the artifact `type` filter is widened to
  include `'test'` too. Verify this is the right shape —
  it might be `'unit-test'` or similar in some adapters.

Carryover follow-ups (status updates):

- **~~(HIGH — TR_024)~~ STRUCTURALLY RESOLVED by TR_025.**
  Cascading fix-intent prevention now has a hard ceiling.
  Awaiting live verification.
- **(STILL OPEN — MEDIUM)** TR_024: pass CI logs to the
  diagnostician on non-github adapters too.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture.

Build status: `pnpm -r build` clean across all 13 packages.
No new migration in this session (depth check is platform
mechanic; no schema change). Server `/health` 200 throughout.
trackeros operator commits in this session:
- `cd27ed17` — TR_025: remove stale TEST_REPORT_011 leave/
  seed to allow planning loop fresh codegen.
trackeros planning-loop commits (auto-merged):
- `0892849e` — Phase 1: Define Leave Request Model & Repository
- `1eb3f247` — Phase 2: Implement Leave Service Logic (empty)

PLAN.md content from trackeros after planning:
https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
(4-phase plan: model+repo → service → routes → policy module).

---
### Session 2026-06-08 — Claude Code (TR_024: autonomous systemic gap detection — self-healing agent gains `action: fix-intent` and submits Aider-ready fix intents that the platform deploys, then resumes the parent automatically)

The self-healing diagnostician evolves from "retry or escalate" to
a three-way action vocabulary: **retry / fix-intent / escalate**.
When the LLM decides a failure reveals a SYSTEMIC GAP in the
project (config flag, missing dependency, wrong scaffold) it
writes a complete Aider-ready fix intent which the platform
submits as a separate high-priority generate cycle. The original
intent is parked in `waiting-for-clarification` until the fix's
production promotion fires its `onSuccessDispatch` envelope and
resumes the parent. Strict ADR-050 compliance — no hardcoded
failure patterns, no fix templates, no `switch` on failure type.
The `action` field is the sole routing decision.

What's new (data + types):

- **Migration 026 — `026_intent_parent.sql`** adds two NULL-by-
  default columns: `intents.parent_intent_id` (UUID FK with
  `ON DELETE SET NULL`) + `intents.on_success_dispatch` (JSONB).
  Indexed partial-where on `parent_intent_id` for the
  dashboard's child-lookup. Zero behaviour change for existing
  intents.
- **`@gestalt/core` types** — `IntentRecord` gains
  `parentIntentId` + `onSuccessDispatch`. `IntentRepository`
  gains `saveOnSuccessDispatch(id, dispatch | null)` + a
  `parentIntentId?` field on the `create()` input.
  `IntentRecord.source` widened with `'self-healing-fix'` +
  `'self-healing-resume'`. `ResumeContext.waitingForFix?: boolean`.
  Same widening applied to the generate orchestrator's
  `IntentTaskPayload.source` + `intentSource` types.
- **`SelfHealingDiagnosis`** gains `action: 'retry' | 'fix-intent'
  | 'escalate'` + optional `fixIntent`, `fixIntentRationale`,
  `resumeAfterFix`. Defaults to `action: 'retry'` on parse
  failure for legacy diagnoses without the field.
- **`SelfHealingResult.pendingFix?: boolean`** — surfaces from
  the loop so callers don't trip-transition the parent intent
  to `failed`.

What's new (logic):

- **`buildDiagnosisPrompt`** in `self-healing-agent.ts` widened
  with an Action-routing block + extended JSON schema. The
  prompt content is the platform-mechanic ground (action
  vocabulary, JSON schema) — operator-tunable rules live in
  `HARNESS.json.agentConfig.self-healing-agent` per ADR-042.
- **`runSelfHealingLoopUnsafe`** intercepts `action: 'fix-intent'`
  BEFORE the legacy retry path: calls `submitFixIntent`, saves
  parent `ResumeContext` with `waitingForFix: true`, transitions
  parent to `waiting-for-clarification`. On dispatch failure
  falls through to escalation so the parent never hangs.
- **`submitFixIntent`** (new helper) — creates the fix intent
  row with `source: 'self-healing-fix'`, priority `high`,
  `parentIntentId` linking back. When `resumeAfterFix: true`
  persists the `onSuccessDispatch` envelope on the fix intent
  pointing at a `generate:intent` resume of the parent.
  Dispatches `generate:intent` for the fix on the generate
  queue so the standard SDLC chain carries it through.
- **`SelfHealingAgent.diagnose(..., projectRoot?)`** — accepts
  an optional projectRoot. When provided, loads model /
  temperature / prompt_extensions from `agents.yaml`'s
  `self-healing-agent` block (per ADR-042). When absent,
  falls back to the hardcoded `SELF_HEALING_AGENT_CONFIG`.
  Never throws — every path falls back cleanly.

What's new (deploy + promotion):

- **Promotion-agent → onSuccessDispatch firing**. After
  production promotion transitions the intent to `deployed`,
  the deploy-orchestrator reads `intent.onSuccessDispatch`,
  dispatches the envelope verbatim, and clears the column so
  a manual re-promotion doesn't re-fire. Best-effort —
  failure logs a warning and leaves the parent in waiting.
- **`collectCiTechnicalDetail(runId, projectId)`** (new
  helper in deploy-orchestrator) — fetches the failed CI run's
  GitHub Actions annotations via the GitHub API and assembles
  them as a 4 KB text block. Passed to the self-healing
  diagnostician as `technicalDetail` so it sees the actual
  error lines (TS errors, missing modules, test failures)
  instead of just `outcome=failed`. Without this the LLM
  can't tell a code bug from a systemic gap. github-actions
  only today; other adapters TBD.
- **`attemptSelfHealingForDeploy`** widened to return
  `{ retryDispatched, pendingFix? }`. Both call sites
  (CI-failure + catch-block) check both before transitioning
  the parent to `failed` — the fix-intent path is a
  SUCCESSFUL self-healing outcome, not a failed one.

What's new (template + trackeros):

- **`HARNESS.json.agentConfig.self-healing-agent`** added to
  both the template and trackeros. Six rules: action vocabulary
  ("retry / fix-intent / escalate"), the criteria for each, the
  fix-intent-must-be-Aider-ready rule, the
  `resumeAfterFix: true` default.
- **`agents.yaml` self-healing-agent block** added to template.
  trackeros overrides `model: chat-latest` for the highest
  reasoning capability. The platform LLM registry already
  carries `chat-latest` as default with `apiShape: 'responses'`
  so the `max_completion_tokens` wire-shape is handled
  registry-side — agent code never sees the difference.
- **Template version bumped 0.10.0 → 0.11.0**.

What's new (dashboard):

- **`IntentSummary` widened** — `parentIntentId?` +
  `awaitingFixIntentId?` surfaced from the server's
  `GET /intents/:id` route. The route enriches the response
  by scanning recent `self-healing-fix` intents whose
  `parentIntentId` matches the requested intent.
- **`IntentDetail.tsx`** renders two new panels:
  - 🔧 **Auto-fix intent** — when `source === 'self-healing-fix'`
    + `parentIntentId` present. Backlink to the parent.
  - ⏳ **Awaiting auto-fix** — when `awaitingFixIntentId`
    populated on a parent. Shows the diagnosis + link to
    the in-flight child.

Live verification on trackeros (real GitHub Actions CI):

- Submitted intent `587befaa` — *"Add a GET /metrics endpoint
  in src/app.ts that uses the prom-client library..."* — a
  natural systemic gap (prom-client not in package.json).
- Generate ran → pr-agent → CI failed (TS2307 Cannot find
  module 'prom-client'). CI annotations fetched.
- Self-healing diagnostician ran. **Picked `action: fix-intent`**.
  Wrote a fix intent referencing prom-client + package.json
  dependencies. Parent's `ResumeContext.waitingForFix: true`
  persisted.
- Child fix intent `2e3c46ab` created with
  `source: 'self-healing-fix'`, `parentIntentId = 587befaa`,
  `on_success_dispatch` populated with the
  `generate:intent` resume envelope.
- Verified the full child/parent chain in the database with
  a recursive CTE — 3-level chain (each level's CI failure
  spawned its own fix intent before the runaway brake
  fired).

Decisions made:

- **`projectRoot` is optional in `agent.diagnose()`**. The
  self-healing loop doesn't have a clone (it runs in the same
  worker process as the orchestrator catch block) so passing
  `projectRoot` would require additional plumbing. The
  hardcoded fallback uses no `model` override → platform
  default routes via the LLM registry to whatever the
  operator set as the default LLM (today: `chat-latest` with
  `apiShape: 'responses'`). When trackeros operators want a
  different model for self-healing, they edit
  `agents.yaml.self-healing-agent.llm.model` and the orchestrator's
  next clone-having entry point picks it up. For TR_024 today
  the platform default IS chat-latest, so the override doesn't
  matter live.
- **`onSuccessDispatch` is stored on the FIX intent, not the
  parent**. The promotion-agent already runs at fix-intent
  production promotion; reading `intent.onSuccessDispatch`
  there is cheaper than walking child→parent. Cleared after
  successful dispatch so manual re-promotion doesn't re-fire.
- **CI annotations are pulled by direct GitHub API fetch**
  rather than extending the `PipelineAdapter` interface.
  Today only github-actions is verified end-to-end; the
  abstraction can come when a second adapter is wired.
- **The cascading-fix-intent issue is surfaced as a TR_025
  follow-up**. Each fix intent failing CI causes ANOTHER
  fix intent — diagnostician chooses `fix-intent` again
  because it sees the same `Cannot find module` error.
  A cycle break needs depth tracking on the parent chain
  + force-escalate when depth > N. Captured below; not in
  scope for TR_024.

Pending follow-ups (NEW from TR_024):

- **(HIGH)** Cascading fix-intent prevention. Track
  `parent_intent_id` chain depth on dispatch; if a fix-intent's
  CI fails AND its parent chain depth >= 2, force escalation
  instead of another fix-intent. Captured as TR_025.
- **(MEDIUM)** Pass CI logs to the diagnostician on
  non-github adapters too (Azure DevOps, GitLab CI). Today
  `collectCiTechnicalDetail` is github-only — other adapters
  silently return undefined and the diagnostician is back to
  flying blind.
- **(LOW)** Add a `parent_intent_id` recursive view on the
  dashboard's IntentDetail so operators can see the full
  fix-chain at a glance instead of clicking through one
  level at a time.
- **(LOW)** When `resumeAfterFix: false`, surface the choice
  in the dashboard's Auto-fix panel so operators know the
  fix is standalone rather than auto-resuming.

Carryover follow-ups (status updates):

- **~~(HIGH — TR_023)~~ RESOLVED structurally by TR_024.**
  Aider DTO-field hallucination — the planner now keeps
  DTO + repository in the same phase (TR_023 fix). When it
  doesn't AND CI fails on a missing field, self-healing
  can now recognise the gap and submit a fix-intent
  instead of looping retries.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture.

Build status: `pnpm -r build` clean across all 13 packages.
Migration 026 applied at boot. Template auto-refreshed to
`0.11.0`. Server `/health` 200 throughout. Stale trackeros
PRs #62–#68 from the verification cascade closed with
`--delete-branch`. trackeros operator commits in this session:
`1a4fe16e` (HARNESS + agents.yaml self-healing-agent block).

---
### Session 2026-06-07 — Claude Code (TR_022: scaffolding fixes + phase retry budget + per-phase architecture verification — full planning loop live-tested on leave management feature)

Follow-up to PLANNING_LAYER. Three fixes plus four verification
runs against trackeros to confirm the planning loop is fully
operational under real CI.

What changed (code):

- **Migration 025** — `ALTER TABLE feature_phases ADD COLUMN
  retry_count INTEGER NOT NULL DEFAULT 0`. Existing rows
  start at 0 so the semantics on the next cycle match
  pre-TR_022 behaviour exactly.
- **`@gestalt/core`** — `HarnessConfig.planner` gains optional
  `maxPhaseRetries` (default 2 — one initial attempt + 2
  retries = 3 total per phase). `FeaturePhaseRecord` gains
  `retryCount: number`. `FeatureRepository` gains
  `incrementPhaseRetry(phaseId): Promise<number>`. Postgres
  impl plus Oracle/MSSQL throw-stubs all updated.
- **`@gestalt/agents-planning`** — `handlePlanningEvaluate`'s
  failure branch rewritten. Instead of immediately marking the
  feature blocked, the orchestrator reads
  `planner.maxPhaseRetries` via a fast shallow-clone helper
  (`readMaxPhaseRetries` — appended at the bottom of
  `planning-orchestrator.ts`), compares to `phase.retryCount`,
  and either dispatches a fresh `planning:phase` for the same
  phase (logged as `phase-retry`) or transitions to
  `phase-failed` with budget exhausted. The retry uses the
  same phase row — same scope, same architecture notes — so
  the next-round Aider sees identical inputs.
- **`packages/server/src/templates/stack-config.ts`** —
  `buildStackPrompt` extended with a TypeScript-specific
  paragraph instructing the LLM to include the JSON-import rule
  in `agentPromptExtensions`. `parseStackConfig` defensively
  injects the rule (via the new `TS_JSON_IMPORT_RULE` const)
  whenever `language === 'TypeScript'` and the LLM forgot it.
  `DEFAULT_AGENT_PROMPT_EXTENSIONS` updated so the failure-
  default path also carries the rule.
- **Template (`templates/corporate-ops-web-mobile/harness/HARNESS.json`)** —
  `planner.maxPhaseRetries: 2` added; `agentConfig.code-agent.rules`
  gains the JSON-import rule. Template bumped 0.8.0 → 0.9.0.

trackeros operator commits (already on `main`):

- `a7494aaa` — tsconfig.json `resolveJsonModule` +
  `allowSyntheticDefaultImports`; HARNESS.json
  `code-agent.rules` JSON-import rule; planner block bumped
  to `{maxPhasesPerFeature: 10, maxFilesPerPhase: 5,
  architectureReviewPerPhase: false, maxPhaseRetries: 2}`.
- `b99e1716` — revert of the temporary
  `architectureReviewPerPhase: true` test toggle.

Live verification matrix:

| Check (from brief) | Verified? | Evidence |
|---|---|---|
| architecture-agent runs | ✓ | Feature `1a5dcfc5`: log entry `architecture-designed Feature architecture: 4 module(s), 2 recommended phase(s)` at 19:12:53 |
| PLAN.md committed to repo | ✓ | trackeros commit `ebd5bbdf` |
| docs/ARCHITECTURE.md updated | ✓ | "Leave Management Module" section appended in same commit |
| Phase 1 intent submitted automatically | ✓ | Plan log `phase-submitted [phase 1] … intent 8f93f513` at 19:13:10 |
| **TR_022 — retry budget honoured** | ✓ | Plan log shows `phase-retry 1/2` at 19:16:22 and `phase-retry 2/2` at 19:19:41 before `phase-failed after 2 retries` at 19:22:44 |
| **TR_022 — per-phase architecture review fires when opted in** | ✓ | Feature `37799ea9` (test-only flag flip): log entry `phase-architecture-designed [phase 1] Phase 1 architecture: 1 interface(s), 3 criteria` at 19:24:59 between `plan-built` and `phase-submitted` |
| CI passes after tsconfig fix | ✗ partial | The TS5083 `resolveJsonModule` class is fixed (no longer flagged). New failures are property-mismatch errors in Aider's generated code (e.g. `Property 'employeeId' does not exist on type 'CreateLeaveRequestDto'`) — a pre-existing code-agent / Aider problem, not a tsconfig issue |
| Phase 1 deploys | ✗ | Blocked by the Aider issue above |
| Phase evaluator runs | ✗ | Only runs on successful deploy — guarded by design |
| Phase 2 submitted | ✗ | Same reason |
| `gestalt feature show <id>` renders progress correctly | ✓ | Three live polls in this session, including the retry events |

The brief's primary verification target — the **autonomous
planning loop with retry budget** — passed every check. The
secondary target (clean deploy through CI) is gated on the
Aider behaviour follow-up, captured below.

PLAN.md produced for the leave-management feature
(5 phases, 4 modules, 3 domain entities):

```markdown
# PLAN.md — Leave management module

## Modules
- **leave** (`src/modules/leave`)
- **balance** (`src/modules/balance`)
- **policy** (`src/modules/policy`)
- **employee** (`src/modules/employee`)

## Domain entities
- **LeaveRequest** — id, employeeId, type, startDate,
  endDate, status, managerId, managerComment, createdAt
- **LeaveBalance** — employeeId, leaveType, totalDays,
  usedDays, year
- **LeavePolicy** — id, leaveType, defaultDaysPerYear,
  maxConsecutiveDays, requiresApproval, createdAt

## Phases
1. Create leave model
2. Implement leave request submission (depends on Phase 1)
3. Implement leave request approval (depends on Phase 2)
4. Create leave balance management (depends on Phase 1)
5. Implement leave policy configuration
```

Full PLAN.md text in trackeros `main`:
https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
(commit `ebd5bbdf`).

Decisions made:

- **`readMaxPhaseRetries` does its own shallow clone** rather
  than hoisting harness-read above the failure check. Cleaner
  separation — the retry branch never touches the (larger)
  evaluate-clone path. Cost: ~250ms per failure dispatch on a
  small repo; acceptable for an error path.
- **Retry preserves the original `scope` column** and
  re-dispatches the same `planning:phase` payload. The phase
  row's `scope` / `architecture` are the plan — the retry
  should not mutate the plan, just give Aider another swing
  at it. Operators who want a "smart retry" with a refined
  scope can use the existing `pendingScopeAdjustment`
  mechanism the evaluator already populates.
- **Per-phase architecture verified via a test-flip + revert**
  rather than left permanently enabled on trackeros. The flag
  multiplies architecture-agent cost N-fold per feature; the
  default `false` is the right operator choice on trackeros's
  budget. The verification proved the code path runs; the
  flag is now safe to flip true on any project that wants it.
- **`maxPhaseRetries: 0`** was used during the per-phase
  architecture verification cycle so the test feature didn't
  burn the retry budget on unrelated Aider failures while
  proving the architecture flag's behaviour. Reverted with
  the architecture flag in the same revert commit.

Pending follow-ups (NEW from TR_022):

- **(HIGH)** Aider generates code that references fields not
  present on the DTO (e.g. `employeeId`, `reason`, reason on
  `CreateLeaveRequestDto`). Three consecutive attempts on
  Phase 1 all produced the same class of error. Either
  (a) extend the code-agent prompt with a "before writing a
  service / repository, READ the DTO file and only reference
  the fields you see there" rule, or (b) require Aider to
  emit the model + repository in the same call so the model
  is in its context when writing the repository. Captured as
  TR_023 work.
- **(LOW)** `readMaxPhaseRetries` could cache HARNESS.json
  per feature for the duration of a feature lifecycle —
  today it re-clones on every failure dispatch.

Carryover follow-ups (status updates):

- **(RESOLVED by TR_022)** PLANNING_LAYER's MEDIUM follow-up:
  "phase failure → feature blocked is too eager" — now
  bounded by `planner.maxPhaseRetries`.
- **(RESOLVED by TR_022)** PLANNING_LAYER's LOW follow-up:
  per-phase architecture pass not yet live-verified —
  verified via feature `37799ea9`.
- **(STILL OPEN — NEW HIGH)** TR_023 — Aider DTO-field
  hallucination (described above).
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010
  mandatory `executeScript tsc --noEmit` code-agent rule on
  trackeros's HARNESS.json. Would catch this class of error
  pre-emit.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture in `agent_executions.tokens_used`.

Build status: `pnpm -r build` clean across all 13 packages.
Migration 025 applied at boot. Template auto-refreshed:
`version: "0.9.0"`. Server `/health` 200 throughout.
Stale trackeros PRs #49–52, #57 closed with
`--delete-branch` per the brief. New trackeros PRs from this
session (#58–#62) all closed automatically by the gate-
failure path or remain open under the blocked feature — not
worth closing individually until the Aider fix lands.


---
