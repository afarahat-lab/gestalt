# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md

_Auto-regenerated after every session by Claude Code. Do not edit by hand._

_Generated: 2026-06-06_

---


_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-06 (after TEST_REPORT_012 — review-agent reliability fixes shipped; severity cap + self-healing loop detection working in live data; mandatory tool-first protocol delivered but ignored by gpt-4o-mini)
**Repo:** https://github.com/afarahat-lab/gestalt
**Migrations:** 023 (latest: `023_llm_api_shape`)

---

## What is built and verified

### Platform foundations

- All 12 buildable packages compile (`pnpm -r build`).
- `docker-compose up -d` brings server + postgres + redis healthy.
- All 23 migrations apply on first start.
- Server reachable on `http://localhost:3000`; `/health` returns 200;
  protected routes return 401 without a JWT.
- Dashboard SPA served at `/app/*`; shareable deep-link URLs work.
- First-boot bootstrap verified: `gestalt init-admin` → `gestalt login`
  → `/auth/me` returns the user.

### Four SDLC layers (all wired end-to-end)

- **generate** — intent → design → context → lint-config → code → test;
  custom agents in `agents.yaml` interleave via `runs_after`.
- **quality-gate** — constraint-agent (regex) + review-agent (LLM).
  Verdict: `pass` / `fail` (auto-retry) / `escalate` (GP_BREACH).
  Max gate retries: 3.
- **deploy** — pr-agent → pipeline-agent → promotion-agent
  (staging → production). `PipelineAdapter` interface;
  `GitHubActionsAdapter` + `NoOpPipelineAdapter` implemented.
  ADR-034 production-requires-staging enforced. Auto-merge supported
  via `pipeline.autoMerge` in HARNESS.json.
- **maintenance** — drift / alignment / gc / evaluation, scheduled via
  `node-cron`. Context-file intents take a direct-fix path via
  context-fixer (path-guarded to `docs/*` + `AGENTS.md`).
  `MonitoringAdapter` (Prometheus / Datadog / NoOp).

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

- **Quality-gate** — `lint-agent` / `security-agent` /
  `test-runner-agent` are stubs (need a `pnpm install` step in the
  cloned tree). The package works end-to-end via
  `constraint-agent` + `llm-review-agent`.
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

- **TR_012 review-agent reliability fixes landed.** Three
  platform changes (severity cap in `llm-review-agent.ts`
  `mapItemsToSignals` so review-agent can never emit
  `GOLDEN_PRINCIPLE_BREACH`; mandatory tool-first review
  protocol in the same file's prompt; `detectRepeatedSignalLoop`
  + escape hatch in `self-healing-loop.ts` so the cycle
  escalates when >50% of a self-healing-retry's signals
  fingerprint-match the prior attempt) + one trackeros
  operator change (`executeScript` added to
  `review-agent.tools.builtin`, commit `3500a46`). TR_012
  proved Fix 1 ✓ (0/30 review signals are GP_BREACH) and
  Fix 3 ✓ (fired at 72% repeat rate on attempt 2 with a
  specific "Review-agent loop detected" alert). Fix 2's
  STEP 5 scope-filter ✓ (audit-logging false positive
  gone — TR_011 had 8/8 rounds, TR_012 has 0/30); Fix 2's
  STEPS 1–3 tool-call mandate ✗ (gpt-4o-mini's tool-refusal
  pattern from TR_011 reconfirmed; 0/64 review-agent tool
  calls). Cycle cost -45% vs TR_011.
- **(HIGHEST follow-up — TR_012)** Deterministic post-LLM
  grep filter on review-agent findings. 28/30 of TR_012's
  review-agent signals are "Direct DB access" hallucinations
  against the repository file (which is correctly using
  pool.query — that IS the pattern). A `grep -E
  "pool\.query|db\.query|new Pool"` check on the artifact set
  excluding `shared/db/` drops the finding if no matches.
  Same treatment for "Missing dependency X" → drop if X is
  in package.json.
- **(HIGH follow-up — TR_012)** Try switching review-agent's
  model to gpt-4o. gpt-4o-mini's tool-refusal pattern is now
  well-documented across TR_011 + TR_012. ~$0.04/round still
  in budget if it converges in 1–2 rounds.
- **executeScript invocation is consistent for code-agent and
  constraint-agent** (TR_010/011/012). Code-agent ~21×/round;
  constraint-agent 5–25×/round. Review-agent: **0× in every
  round across TR_011 + TR_012** even with the new mandatory
  protocol — see TR_012 HIGHEST follow-up.
- **Tool-call persistence is incremental** in
  `BaseLLMAgent.runToolLoop()` (TR_009 Fix 1). Mid-loop
  throws preserve full tool-call logs in
  `agent_execution_logs`.
- **Trackeros code-agent runs on gpt-4o-mini** (trackeros
  `9c41633`). Zero rate-limit errors; ~3× cheaper.
- **`MAX_TOOL_CALLS` cap-inside-batch is fixed** (TR_010
  Fix 1). Cap check moved BEFORE the per-call dispatch loop;
  over-cap batches get synthesised rejection responses for
  every `tool_call_id`, then a synthesis turn with
  `tools: []` is fired so the LLM produces final text
  (`stopReason === 'stop'`). HTTP 400
  *"tool_call_ids did not have response messages"* is gone.
- **`MAX_TOOL_CALLS` raised from 10 → 20 + pre-generation
  prompt block in code-prompt.ts** (TR_010 Fix 2). Tells the
  LLM to read existing deps first, not explore non-existent
  paths. TR_011 VALIDATED this: `listDirectory` count is 0
  across all 8 TR_011 rounds (down from 14× in TR_009).
- **`VALID_BUILTIN_TOOLS` includes `executeScript`** (TR_010
  Fix 4 — latent bug; loader was silently dropping it).
- **Empty-tools wire path is safe** (TR_010 Fix 3). When
  `tools: []`, also drop `tool_choice` from OpenAI body.
- **Review-agent hallucination addressed by TR_012's three
  fixes, with the worst symptoms eliminated:**
  - GP_BREACH from review-agent — **eliminated** (Fix 1).
  - Audit-logging / RBAC / input-validation false
    positives — **eliminated** (Fix 2's STEP 5 scope filter).
  - Persistent round-over-round loops on residual
    hallucinations — **capped** (Fix 3 escape hatch).
  - **Remaining gap**: 28/30 of TR_012's review-agent
    signals are "Direct DB access" hallucinations against the
    repository file. Fix 2's mandatory tool-call instruction
    is ignored by gpt-4o-mini (0/64 review-agent tool calls
    across TR_011 + TR_012). Next step (HIGHEST follow-up)
    is the deterministic grep filter.
- **Review-agent `result_status = 'failed'` with successful
  JSON output** (TR_010 finding, TR_011 reconfirms across 8
  rounds). `agent_execution_logs` row marked failed (empty
  `error_message`) but `llm_response` is well-formed JSON
  AND signals rows are emitted with `source_agent='review-
  agent'`. Cosmetic but blocks operator triage —
  can't distinguish "review-agent crashed" from "review-agent
  emitted false positives". Fix priority: HIGH.
- **~~HIGH~~ DROPPED: Retry-budget overshoot.** TR_011
  thought 6 rounds was the budget; TR_012 proves the actual
  budget is `gateRetries × (selfHealing + 1) = 3 × 3 = 9`
  max. TR_011's 8 and TR_012's 8 both sit one round under
  that. No bug, no fix needed. Gate-orchestrator retryCount
  increment logic is correct.
- **TR_010 GP_BREACH was a FALSE POSITIVE** (TR_011 analysis).
  Review-agent's "Direct DB access in service" finding
  fired against code that correctly imports + delegates to
  `LeaveRepository`. No `pool.query` in the service.
  Three of TR_010's five review-agent findings were false
  positives or mistargeted.
- **Constraint-agent 387-second / 50k-token / 19-executeScript
  budget on TR_010's Leave intent.** TR_011 confirms similar
  pattern (8-21 tool calls / round). Restructure prompt to
  batch verifications or per-role MAX_TOOL_CALLS override.
- **Constraint-agent reviews files outside the cycle's
  artifact set** (TR_011 finding). Flagged
  `src/shared/db/connection.ts` (pre-existing infrastructure
  on main, not generated this cycle) for "hardcoded
  credentials" on its `process.env.DATABASE_URL` line.
  Constraint-agent should scope to the cycle's diff.
- **TR_004 Fix 4 self-healing escape hatch (new-violations
  detection)** still not exercised live. TR_012's new
  `detectRepeatedSignalLoop` escape hatch (repeated-signals
  detection) IS proven live (fired at 72% repeat rate on
  attempt 2). Both hatches sit in the same code path; the
  new-violations one would fire if a code-agent amendment
  introduced novel violations the diagnostician couldn't
  reason through.
- **Fix 1 (env-default apiShape) not yet live-verified.**
  Code path in place; needs `LLM_MODEL=chat-latest` +
  `platform_llms.chat-latest.api_shape='responses'` and a
  test cycle to confirm `max_completion_tokens` flows.
- **Older test-report follow-ups** (all LOW): test-agent
  punts on method coverage with
  "// Additional tests can be added similarly" (TR_004);
  IntentSpec lacks a `dependencies` block (TR_004, MEDIUM);
  context-agent has 4 tools but never uses them (TR_002 #4).
  Full detail in `TEST_REPORT_*.md`.
- **Dashboard bundle is 1010 KB raw / 319 KB gzipped** after the
  CodeMirror addition (2026-06-04). Above Vite's 500 KB warning.
  Future code-split via dynamic `import()` would restore the
  main bundle to ~370 KB.
- **Retry cycle full re-runs all generate agents** even though
  only routed agents need fresh work. Skipping intent/design/
  context when prior artifacts are present in the Git tip would
  speed retries by ~30 s.
- **`qualityGate.maxRetries` hardcoded to 3** in both gate and
  generate orchestrators; reading it per-project from
  HARNESS.json is a small follow-up.
- **Promotion workflow dispatches against a hardcoded `'main'`
  ref.** Projects on `master` / `trunk` will see promotion
  workflow-dispatch fail. Thread `project.defaultBranch` through.
- **No proactive PAT-scope validation at registration /
  set-adapter time.** A PAT missing `workflow` scope only
  surfaces on the first pipeline dispatch.
- **Return-URL preservation across login.** Pasting
  `/app/intents/<id>` in a fresh tab bounces to `/app/login`
  then lands on `/app/` (intent ID dropped).
- **Vite dev-server proxy `/api` entry is dead** — server has
  no routes under `/api`. Pre-existing dead config; remove on
  next dashboard touch.
- **Encrypt Git PATs at rest in the legacy
  `project_git_credentials` table.** Vault path is the modern
  flow; legacy plain-token path still has the TODO comment.
- **LLM model name not validated at startup** — an invalid model
  only surfaces as a 404 on the first LLM call.
- **HA replica support for OIDC state.** Today's state is
  in-memory; multi-replica deployments would need Redis-backed
  state so the callback can hit a different replica than the
  login.

---

## Operator caveats / pending actions

- **trackeros `.github/workflows/gestalt.yml`** still pins Node
  20 (project bootstrapped before the 2026-06-04 Node 22 LTS
  template change). Edit `node-version: '20'` → `'22'` + commit
  manually. Non-breaking — Node 20 still works.
- **trackeros PR #46** — synthetic test PR opened during
  vault-credential live verification (2026-06-04). Close with
  `gh pr close 46 --repo afarahat-lab/trackeros --delete-branch`.
- **Re-create vault secret for OpenAI API key** if the operator
  wants vault-backed routing. The dev-override container restart
  during ADR-023 (apiShape) verification regenerated
  `master.key`, breaking the prior vault secret. Both LLMs are
  currently in env-var mode and working.
- **Synthetic trackeros branches** from live test cycles
  (TR_002 / 003 merged; TR_004+ cycles failed at gate and
  never pushed). Branch-name pattern: `gestalt/<correlation>-`.
- **One open alert** from TR_010's escalated Leave cycle
  (correlation `7afa0886-…`, type `GP_BREACH`, severity
  `critical`). Dismiss with `gestalt alerts dismiss` after
  the architectural findings are addressed in a follow-up
  intent. (TR_009's alert may also still be open; same
  command.)
- **`.env`**: `LLM_MODEL=gpt-4o` (operator default). For
  `chat-latest` routing through the registry's responses
  api_shape, see TR_003 Fix 1 follow-up.
- **`master.key`**: now generated in the workspace root
  (gitignored, mode 600), mounted into the container by
  default via `docker-compose.yml` (TEST_REPORT_003 Fix 2).
  Survives `docker compose up -d --build`.

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
| `pnpm -r build` | ✅ clean (12 packages) |
| `docker-compose up -d` | ✅ healthy (server / postgres / redis) |
| Migrations applied | 023 (latest: `023_llm_api_shape`) |
| Server reachable | `http://localhost:3000/health` returns 200 |
| Dashboard | served at `http://localhost:3000/app/` |

The 12 buildable packages: `@gestalt/core`, `@gestalt/adapter-postgres`,
`@gestalt/adapter-oracle` (stub), `@gestalt/adapter-mssql` (stub),
`@gestalt/agents-generate`, `@gestalt/agents-quality-gate`,
`@gestalt/agents-deploy`, `@gestalt/agents-maintenance`,
`@gestalt/registry`, `@gestalt/server`, `@gestalt/cli`,
`@gestalt/dashboard`.

---

## Known issues

None blocking the build. Areas to keep in mind:

1. **`UserRepository` and `ProjectRepository` extensions touch every
   adapter.** Adding a method to the interface means the Oracle and
   SQL Server stubs must add the same method (as throw-stubs is
   fine). Build will fail until every adapter implements the new
   surface — that's the intent.
2. **CLI pins chalk@4 / ora@5 for CJS compatibility.** Do not upgrade
   either without performing the full ESM migration (`"type":
   "module"`, `.js` extensions on relative imports, Dockerfile
   update). The pin is intentional.
3. **Dashboard bundle is 1010 KB raw (319 KB gzipped)** after the
   CodeMirror addition in the 2026-06-04 template editor session.
   Above Vite's 500 KB warning. Acceptable for an admin-only feature;
   candidate for a future code-split via dynamic `import()`.
4. **LLM model name not validated at startup.** `loadConfig` accepts
   any non-empty string for `LLM_MODEL`. An invalid model only
   surfaces as a 404 on the first LLM call. Set a valid model in
   `.env` (or seed the platform LLM registry) before running
   `gestalt run`.

---

## Pending operator actions

- **`master.key`** is generated locally (workspace root, mode
  600, gitignored) and mounted into the server container by
  default via `docker-compose.yml`. Survives `docker compose
  up -d --build`. Operator should back this file up out-of-band;
  losing it means every vault-encrypted secret becomes
  unreadable.
- **Two trackeros branches from live test cycles** —
  `gestalt/1e316bbf-…` (Report 002) and `gestalt/57759963-…`
  (Report 003, PR #4706). Close or delete when done.
- **MAX_TOOL_CALLS cap-inside-batch bug fixed** in
  TEST_REPORT_010 — cap check moved to batch-level + synthesis
  turn with `tools: []`. Cap raised 10 → 20. Code-agent now
  finishes cleanly on gpt-4o-mini.
- **VALID_BUILTIN_TOOLS now includes `executeScript`**
  (TEST_REPORT_010 Fix 4 — latent bug that silently dropped
  `executeScript` from any `agents.yaml` declaration).
- **Trackeros code-agent on gpt-4o-mini + executeScript tool**
  (commits `9c41633` + `6b7e42e` on trackeros `main`). No
  platform-side action — per-project `agents.yaml`.
- **TR_010 GP_BREACH was a FALSE POSITIVE** (TR_011 analysis).
  Review-agent flagged `leave.service.ts` for direct DB
  access against code that correctly delegates to
  `LeaveRepository`. No `pool.query` in service. Critical
  driver for the review-agent fix below.
- **TR_012 review-agent reliability fixes landed.** Three
  platform changes (Fix 1 — `mapItemsToSignals` hard-codes
  `CONSTRAINT_VIOLATION` so review-agent can never emit
  GP_BREACH; Fix 2 — mandatory 5-step tool-first review
  protocol in the prompt; Fix 3 — `detectRepeatedSignalLoop`
  escape hatch in `self-healing-loop.ts` for >50% signal
  fingerprint overlap across attempts). Live-proven: Fix 1 ✓
  (0/30 review signals are GP_BREACH); Fix 3 ✓ (fired at 72%
  repeat rate on attempt 2 with a specific
  "Review-agent loop detected" alert); Fix 2's STEP 5 scope
  filter ✓ (audit-logging false positive eliminated). Fix 2's
  tool-call mandate ✗ — ignored by gpt-4o-mini (0/64
  review-agent tool calls). Operator-side: trackeros
  `agents.yaml` review-agent gains `executeScript`
  (`3500a46`).
- **HIGHEST follow-up — TR_012:** Deterministic post-LLM grep
  filter on review-agent findings to drop the residual
  "Direct DB access" hallucinations (28/30 of TR_012's
  review-agent signals). Single grep + package.json
  cross-check; cheapest high-leverage fix in the queue.
- **HIGH follow-up — TR_012:** Try switching review-agent's
  model to gpt-4o. gpt-4o-mini's tool-refusal pattern is
  reconfirmed across TR_011 + TR_012; gpt-4o follows
  imperative instructions more reliably.
- **~~Retry-budget overshoot~~ DROPPED** (TR_012 analysis).
  Actual budget is `gateRetries × (selfHealing + 1) = 9`
  max, not 6. TR_011's 8 and TR_012's 8 sit within budget.
  No bug.
- **Open alerts to dismiss**: TR_010's `GP_BREACH` for
  `7afa0886-…`, TR_011's `failed` for `11a08e08-…`, TR_012's
  `gate-max-retries` for `aac73745-…`. All dismissable with
  `gestalt alerts dismiss`.
- **Review-agent `result_status='failed'` with successful
  JSON output** (TR_010/011). Cosmetic — verdict is correct,
  row label is wrong. Trace gate-orchestrator failure-path
  vs signal emit. Fix priority: HIGH.
- **Constraint-agent reviews files outside the diff** (TR_011).
  Flagged pre-existing `src/shared/db/connection.ts` for
  "hardcoded credentials" on its `process.env.DATABASE_URL`
  line. Constraint-agent should scope to the cycle's
  artifact set.
- **Constraint-agent 387s / 50k-token / 19-executeScript
  budget** on TR_010's Leave intent (TR_011 similar pattern).
  Restructure prompt or add per-role MAX_TOOL_CALLS override.
- **Review-agent placement-check wording fix** is a small
  follow-up (TEST_REPORT_003 Issue #1) — one paragraph in
  `llm-review-agent.ts` to stop false-positive
  `concerns`-grade flags on correctly-mirrored test paths.
- **Live-verify TEST_REPORT_003 Fix 1** (env-default LLM
  apiShape) by switching `LLM_MODEL=chat-latest` + setting
  `platform_llms.chat-latest.api_shape='responses'` and
  confirming `max_completion_tokens` reaches the wire.
- **trackeros `.github/workflows/gestalt.yml`** still pins Node 20
  (project was bootstrapped before the 2026-06-04 Node 22 LTS
  template change). Edit `node-version: '20'` → `'22'` + commit.
  Non-breaking — Node 20 still works.
- **trackeros PR #46** (synthetic test PR opened during vault-
  credential live verification). Close with
  `gh pr close 46 --repo afarahat-lab/trackeros --delete-branch`.
- **Re-create vault secret for OpenAI API key** if the operator
  wants vault-backed routing. The dev-override container restart
  during ADR-023 (apiShape) verification regenerated `master.key`,
  breaking the prior vault secret. Both LLMs are currently in
  env-var mode (`apiKeyEnv: 'LLM_API_KEY'`) and working.

---

## Type alignment rules

Moved to [@docs/claude/ARCHITECTURE.md](./ARCHITECTURE.md#key-type-alignment-rules).

---


_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---

### Session 2026-06-06 — Claude Code (TEST_REPORT_012: review-agent reliability fixes — severity cap + mandatory tool-first protocol + self-healing loop detection. Fix 1 and Fix 3 work in live data; Fix 2 ineffective vs gpt-4o-mini's tool-refusal; cycle still fails 8 rounds but at -45% cost with a clean specific-reason alert.)

Three-part implementation session against TEST_REPORT_011's
review-agent hallucination findings. **Fix 1**: cap review-agent's
emittable severity so it cannot push the cycle to `escalate` via
phantom GP_BREACH. **Fix 2**: replace the advisory verification
guidance with a mandatory 5-step tool-first protocol the LLM must
follow before reasoning about findings. **Fix 3**: detect when
>50% of self-healing-driven retry's signals fingerprint-match the
prior attempt's signals and escalate immediately (review-agent
hallucination loop brake).

Outcome: **mixed but informative.** Fix 1 and Fix 3 land and are
provably working in the live verification cycle. Fix 2's prompt
is correctly delivered to the LLM but ignored — review-agent
made **0 tool calls across all 64 executions / 8 rounds**,
identical to TR_011. The cycle's failure mode shifts from
"phantom GP_BREACH escalation" (TR_010) and "8-round
hallucination loop with no specific alert" (TR_011) to **"clean
`gate-max-retries` alert with a specific 'review-agent loop
detected: 72% repeat rate' reason after 8 rounds"** (TR_012).
Cost is down 45% (~$0.41 vs $0.74).

What the user asked for:

- **Fix 1 (HIGH)** — In `packages/agents/quality-gate/src/agents/llm-review-agent.ts`,
  update the signal-mapping path so review-agent's signals are
  always `CONSTRAINT_VIOLATION` — never `GOLDEN_PRINCIPLE_BREACH`.
  GP_BREACH requires tool-verified evidence, which only
  constraint-agent (which runs executeScript deterministically)
  can produce. Also add explicit signal-severity-limits prose to
  the prompt.
- **Fix 2 (HIGH)** — Same file. Replace the advisory
  `verificationGuidance` block with `## Review protocol —
  MANDATORY SEQUENCE`: STEP 1 tsc --noEmit, STEP 2 searchFiles
  for `pool.query|db.query`, STEP 3 readFile package.json,
  STEP 4 reason about findings (no tool evidence → severity
  low/style), STEP 5 apply scope filter from
  IntentSpec.outOfScope.
- **Fix 3 (MEDIUM)** — In `packages/core/src/agents/self-healing-loop.ts`,
  detect when current attempt's signals overlap the prior
  attempt's signals by >50% (using existing `signalFingerprint`).
  Escalate immediately with a specific "Review-agent loop
  detected: N of M findings are identical to the prior attempt
  (XX% repeat rate)" reason.
- Re-run the same Leave-service intent. Verify: review-agent
  tool calls > 0, no GP_BREACH, no audit-logging finding, cycle
  in 1-2 rounds, cost < $0.10.

What changed:

- **Fix 1 (code + prompt)**: `llm-review-agent.ts`
  `mapItemsToSignals` — hard-codes `type:
  'CONSTRAINT_VIOLATION'` (no more `isBreach = severity ===
  'critical'` branch). `mapSeverity` downgrades `critical` →
  `high` so a runaway "critical"-rated item doesn't flow into
  the orchestrator's verdict logic mismatched against its CV
  type. Prompt adds `## Signal severity limits — MANDATORY`
  section explicitly forbidding severity `critical` and
  explaining why (tool-verified evidence requirement). Brief
  proposed the fix in `parseResponse`; moved it to
  `mapItemsToSignals` because the gate uses `parseReview` not
  the stubbed `parseResponse`, and `mapItemsToSignals` is where
  the signal type is actually set.
- **Fix 2 (prompt only)**: same file `buildReviewPrompt`. The
  advisory `verificationGuidance` block is REPLACED with a
  numbered `## Review protocol — MANDATORY SEQUENCE` block.
  Five imperative steps with explicit guidance to suppress
  findings the tool output doesn't support.
- **Fix 3 (code)**: `self-healing-loop.ts` — new
  `detectRepeatedSignalLoop` helper + new escape hatch in
  `runSelfHealingLoopUnsafe` BEFORE the existing
  retry-introduced-violations check. Fires when
  `priorResume.autoHealed && currentAttempt > 1` AND
  `repeatedSignals / currentSignals > 0.5`. Calls
  `escalateToHuman` with a specific "Review-agent loop detected"
  reason. Conservative 50% threshold so a single repeat
  amongst many new findings doesn't trip the brake.
- **Operator-side**: trackeros `agents.yaml`
  `review-agent.tools.builtin` gains `executeScript` (commit
  `3500a46` on trackeros `main`). Mirrors TR_010's code-agent
  fix — the platform-side loader silently strips tools the
  project's override doesn't declare, so Fix 2's STEP 1 cannot
  fire without this.

Live verification (correlation
`aac73745-fa77-43aa-9ca4-ad90515007e6`, intent_id
`f3ce3046-1e2d-4b14-90b0-ebd9a50d6c6b`):

Per-round budget across 8 rounds (compact):

| Rd | code-agent (tok/tc) | constraint (tok/tc) | review (tok/tc) | Round outcome |
|---|---|---|---|---|
| 1 | 138k/21 | 3.9k/5 | 23.4k/**0** | gate-fail → retry |
| 2 | 283k/21 | 23.5k/18 | 16.9k/**0** | gate-fail → retry |
| 3 | 149k/21 | 16.8k/25 | 17.5k/**0** | gate-fail → retry |
| 4 | 140k/21 | 25.8k/22 | 21.4k/**0** | gate exhausted → self-healing-1 |
| 5 | 54k/8 | 4.4k/5 | 24.0k/**0** | gate-fail → retry |
| 6 | 142k/21 | 8.1k/9 | 27.9k/**0** | gate-fail → retry |
| 7 | 97k/21 | 3.6k/5 | 16.3k/**0** | gate-fail → retry |
| 8 | 26.7k/5 | 35.5k/22 | 17.9k/**0** | gate exhausted → self-healing-2 → **Fix 3 escalated** |

Total: **1,379,424 tokens / ~$0.41 USD** at gpt-4o-mini pricing.

Verification matrix vs brief:

| Check | Target | Result |
|---|---|---|
| Review-agent tool calls > 0 | ✓ | **✗** 0/64 executions |
| No GP_BREACH from review-agent | ✓ | **✓** 30/30 review-agent signals are CV |
| No "audit logging" finding (OOS) | ✓ | **✓** 0/30 (TR_011 had 8/8) |
| Cycle in 1-2 rounds | ✓ | **✗** 8 rounds (Fix 3 prevented round 9+) |
| Cost < $0.10 | ✓ | **✗** $0.41 (-45% vs TR_011) |

What worked:

- **Fix 1 structurally complete.** All 30 review-agent signals
  emitted as `CONSTRAINT_VIOLATION`, severity `high` or
  `medium`. Zero `GOLDEN_PRINCIPLE_BREACH`. Review-agent can
  never push the cycle to `escalate` via its own findings
  again, period.
- **Fix 3 fired exactly as designed.** At self-healing attempt
  2 (after round 7's gate failure), the detector computed
  `repeatRatio = 42/58 = 0.72` (above the 0.5 threshold) and
  called `escalateToHuman` with the specific reason
  *"Review-agent loop detected: 42 of 58 findings are identical
  to the prior attempt (72% repeat rate) across 2 rounds.
  Likely hallucination — human review required."* — visible in
  `alerts.description` and server log
  `Review-agent hallucination loop detected — escalating instead
  of amending again` with structured fields
  `attempt=2, repeatedCount=42, totalCurrent=58, repeatRatio=0.72`.
- **Fix 2's STEP 5 (scope filter) IS being followed.**
  TR_011's 8 rounds had "Missing audit logging" 8/8;
  TR_012 has 0/30 review-agent signals mentioning audit /
  RBAC / input validation. The out-of-scope section + the
  intent-spec listing "Any other modules outside src/modules/leave"
  worked. So the protocol's effect is partial — steps 4–5 are
  followed; steps 1–3 are not.

What didn't work:

- **Fix 2's tool-mandate ignored by gpt-4o-mini.** Review-agent
  made 0 tool calls across all 64 executions despite the
  prompt's explicit "STEP 1 — Call executeScript({ command:
  \"npx tsc --noEmit\" })" instruction. Worse, round 1's
  summary hallucinates tool output: *"The TypeScript compiler
  did not report any issues, and all imports resolved
  correctly"* without having called executeScript. The LLM
  pattern is the same as TR_011 — gpt-4o-mini treats
  imperative tool-call instructions as advisory.
- **28 of 30 review-agent findings are the same false
  positive across 8 rounds**: variants of "Direct database
  access ... outside the repository pattern". The flagged
  file (`leave.repository.ts`) is on main, not in the cycle's
  artifact set, and repositories ARE supposed to use
  `pool.query` — that's the pattern. This is the persistent
  hallucination Fix 3 caught.

Decisions made:

- **Departed from the brief's `parseResponse` fix location.**
  Brief proposed downgrading severity in `parseResponse`; the
  actual signal-shape mapping happens in `mapItemsToSignals`
  (the gate uses `parseReview`, not the stubbed
  `parseResponse`). Moved the cap to `mapItemsToSignals`
  where the type is actually set. Same effect, single source
  of truth.
- **Did NOT touch the gate-orchestrator's retry counter
  logic.** TR_011 hypothesised the 8-round "overshoot" came
  from constraint-agent verdict-pass resetting the gate
  retry counter; TR_012 proves the budget is actually
  `gateRetries × (selfHealing + 1) = 3 × 3 = 9` max, with
  TR_011's 8 and TR_012's 8 sitting one round under that.
  The TR_011 follow-up "audit retryCount increment logic"
  should be demoted to LOW or dropped.
- **Wrote the report against the 8-round failing-but-
  informative cycle rather than re-running.** The cycle's
  failure mode is well-characterised; re-running with the
  same fix set would produce the same data. The next fix
  (deterministic grep filter on review-agent findings) is
  the next session's work.

Pending follow-ups:

- **(HIGHEST — new)** Deterministic post-LLM grep filter on
  review-agent findings. After `parseReview`, drop "Direct
  DB access" findings if `grep -E "pool\.query|db\.query|new
  Pool" artifact_set_excluding_shared_db/` returns zero;
  drop "Missing X" findings if X is in package.json. Single
  check addresses 28/30 of TR_012's false positives.
- **(HIGH — new)** Try switching review-agent's model to
  gpt-4o (platform default). gpt-4o-mini's tool-refusal is
  well-documented across TR_011 + TR_012; gpt-4o follows
  imperative instructions more reliably. ~$0.04/round still
  within budget.
- **(HIGH — carryover)** Review-agent `result_status='failed'`
  with successful JSON output (TR_010/011 reconfirmed in
  TR_012). Cosmetic but blocks operator triage.
- **(LOW — new, demotion)** Drop the "retry-budget overshoot
  audit" follow-up. Per TR_012's analysis the budget is
  3×3=9 max, 8 rounds is within budget.
- **(LOW — carryover)** Drop `listDirectory` from code-agent's
  `tools.builtin` — both TR_011 and TR_012 show 0 listDirectory
  calls. The pre-generation prompt block has driven it to zero.
- **(MEDIUM — carryover)** Add `n_turns` + `final_stop_reason`
  columns to `agent_execution_logs`.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted via `docker compose
up -d --build`. Server `/health` 200 throughout. Trackeros
`main` updated to `3500a46`. New file
`docs/claude/TEST_REPORT_012.md`.

---



### Session 2026-06-06 — Claude Code (TEST_REPORT_011: TR_010 escalation analysis + 8-round scoped service intent — review-agent persistently hallucinates findings across rounds, retry budget overshoots by 2, ~$0.74 USD burned chasing phantom complaints; pre-generation prompt VALIDATED (listDirectory = 0))

Two-part diagnostic session against TEST_REPORT_010's escalated cycle.
**Step 1**: analyse whether TR_010's `GP_BREACH` was a real architectural
violation or a review-agent false positive. **Step 2**: run a tightly
scoped intent (single service file + single test, against an existing
repository) and answer whether narrow scoping avoids the false-positive
pile-up. No platform code changed this session — pure observation.

Outcome: **Step 1 confirms TR_010's GP_BREACH was a FALSE POSITIVE**,
and three of TR_010's five review-agent findings were either false
positives or mistargeted. **Step 2 confirms the false-positive
pattern is structural, not scope-driven**: the scoped intent ran
**8 rounds** before failing (above the configured 6-round cap),
burning ~2.47M tokens / ~$0.74 USD chasing the same review-agent
hallucinations every round. Quality-gate's review-agent is now the
single biggest blocker to a working end-to-end cycle.

What the user asked for:

- **Step 1 — TR_010 escalation analysis.** Read the generated
  `leave.service.ts` from correlation `7afa0886-…`. Decide whether
  the review-agent's "Direct DB access in service" GP_BREACH was
  genuine (service calling `pool.query` directly) or a false
  positive (service correctly delegating to repository). Same for
  the audit-logging CV and the "Import cannot be resolved" CV.
- **Step 2 — Scoped intent.** Cherry-pick `leave.model.ts` +
  `leave.repository.ts` from `gestalt/a41959f9-...` (TR_007's
  branch) to trackeros `main` so a real dependency exists, then
  run a narrow intent for just `leave.service.ts` + its unit
  test. Verify: executeScript fires consistently, code-agent
  imports correctly from the existing repository, service uses
  the repository interface (not `pool.query`), gate passes
  cleanly, scope avoids GP_BREACH.

What changed:

- **No platform code.** Entirely diagnostic.
- **Operator setup commit on trackeros `main`** (`5e619a9`):
  cherry-picked `leave.model.ts` + `leave.repository.ts` from
  `gestalt/a41959f9-create-the-leave-module-foundation`. TR_007
  reported these were merged via PR #2801 — but the actual
  trackeros PR list shows #39–#48 with no leave-module PR
  among them. The TR_007 PR was never opened against main. This
  commit closes that gap.

Step 1 — TR_010 escalation analysis (verbatim from artifact):

```ts
// leave.service.ts (TR_010 correlation 7afa0886-…)
import { LeaveRepository } from './leave.repository';

export class LeaveService {
  constructor(private readonly leaveRepository: LeaveRepository) {}

  async submitLeaveRequest(req: LeaveRequest): Promise<LeaveRequest> {
    return this.leaveRepository.createLeaveRequest(req);
  }
}
```

No `pool.query`. No `db.query`. The service imports + delegates to
`LeaveRepository` — exactly the pattern the rule requires. **The
GP_BREACH was a false positive.**

TR_010 finding-by-finding:

| TR_010 finding | Genuine? | In scope? | Should have been |
|---|---|---|---|
| GP_BREACH "Direct DB access in service" | **No** — service delegates correctly | n/a | Not emitted |
| CV "Missing audit logging" | Yes | **Out of scope** | Suppressed per the review-agent's own outOfScope rule |
| CV "Test framework mismatch" | Mixed — `src/modules/leave/leave.test.ts` lacks the imports; the `tests/unit/*` files have them | Yes | File-scoped |
| CV "Import cannot be resolved for `LeaveRequest`" | **Wrong target** — `LeaveRequest` IS imported; the actual missing import is `LeaveRepository` in routes.ts | Yes | Right finding, wrong symbol |
| CV "Unhandled promise rejection" (constraint-agent) | **No** — routes DO have try/catch | Yes | False positive |

**Three of TR_010's five gate findings were false positives or
mistargeted.** The single critical-severity escalation was on the
single finding the review-agent should not have raised.

Step 2 — Scoped intent execution (correlation
`11a08e08-b191-48ba-b7b9-2c213123d350`):

**8 rounds** before terminal `failed` status. Total cost:
2,472,848 tokens / ~$0.74 USD.

| Round | Code-agent (tok / tc) | Constraint-agent | Review-agent |
|---|---|---|---|
| 1 | 139,587 / 21 | failed (15) | failed (0) |
| 2 | 139,808 / 21 | failed (10) | failed (0) |
| 3 | 289,228 / 21 | failed (21) | failed (0) |
| 4 | 145,138 / 21 | **passed** (5) | failed (0) |
| 5 | 379,701 / 21 | failed (8) | failed (0) |
| 6 | 159,994 / 21 | failed (13) | failed (0) |
| 7 | 106,453 / 14 | failed (9) | failed (0) |
| 8 | 115,504 / 16 | failed (9) | failed (0) |

Code-agent total tool calls across 8 rounds: 125× `executeScript`,
23× `readFile`, 8× `getFileTree`, **0× `listDirectory`**.

What worked:

- **TR_010 pre-generation prompt VALIDATED.** `listDirectory`
  dropped from 8× in TR_010 to **0× across all 8 TR_011 rounds.**
  The "do NOT explore directories that don't exist yet" instruction
  is being respected. Permanent simplification candidate: drop
  `listDirectory` from code-agent's `tools.builtin` entirely.
- **`readFile` correctly hit the existing dependency files** —
  distinct paths read across the cycle: `leave.repository.ts`,
  `leave.model.ts`, `src/shared/types/index.ts`,
  `src/shared/db/connection.ts`. The setup commit's seeded files
  were used as designed.
- **`executeScript` consistent.** 125 invocations across 8 rounds.
  The mandatory pre-emit verification block is wired and active.
- **Round 1's service.ts correctly imports `ILeaveRepository`**
  from the seeded `leave.repository.ts` and delegates correctly.
  Brief's verification questions 1–3 all pass.

What didn't work:

- **Review-agent hallucinated the SAME false positives every
  round** for 8 straight rounds:
  - "Missing audit logging" — 8/8 (out of scope per intent)
  - "DB-pattern violation" against code that correctly delegates —
    6/8 (false positive, same as TR_010)
  - "Import cannot be resolved" against resolvable imports — 5/8
  - "Missing RBAC enforcement" — 5/8 (out of scope)
- **Review-agent's `tool_calls` is 0 in every TR_011 round.**
  Despite TR_007's verification-guidance block telling it to run
  `tsc --noEmit` before flagging unresolved imports, the LLM
  never reaches for the tool. The instruction is advisory; it
  needs to be mandatory + structural.
- **Constraint-agent reviews files outside the cycle's
  diff.** Flagged pre-existing `src/shared/db/connection.ts`
  (on main since project bootstrap, not generated this cycle) for
  "hardcoded credentials" on its `process.env.DATABASE_URL`
  reference. Constraint-agent should scope to the cycle's
  artifact set.
- **Positive feedback loop induced scope creep.** By round 8 the
  service had added `updateLeaveRequest` + `deleteLeaveRequest`
  (not requested), dropped `getEmployeeLeave` (in the intent),
  added `console.log("…")` as a "fix" for the phantom
  audit-logging finding (which constraint-agent then correctly
  flagged), and referenced `LeaveStatus.Deleted` (which doesn't
  exist in shared/types).
- **Retry budget overshot by 2 rounds.** `qualityGate.maxRetries: 3`
  + `selfHealing.maxAttempts: 2` = 6 max. Cycle ran 8. Suspected
  cause: constraint-agent verdict-passed in round 4 reset the
  gate retry counter.

Brief's verification matrix:

| Question | Result |
|---|---|
| Did `executeScript` fire again? | ✓ Yes, 125× across 8 rounds |
| Did code-agent correctly import from existing `leave.repository.ts`? | ✓ Yes — readFile on it every round |
| Did the service correctly use the repository (no `pool.query`)? | ✓ Yes — delegated via repository in every round |
| Did the gate pass cleanly with no false positives? | ✗ No — same false positives every round |
| Was the intent scope narrow enough to avoid GP_BREACH? | ⚠ Mixed — no GP_BREACH escalation, but `failed` after budget exhaustion |

Decisions made:

- **Did NOT touch platform code this session.** The brief was
  diagnostic + scoped re-run; widening scope to fix the
  review-agent bug would have conflated measurement with
  iteration. Recorded as the top recommended fix in the report.
- **Did NOT abort the cycle mid-flight when it became clear the
  loop was unproductive.** User chose "let it finish naturally"
  via AskUserQuestion at round 5 → cleanest data for the report,
  even at the cost of ~$0.40 in extra spend.
- **Asked the user before pushing the setup commit to trackeros
  main.** Auto-mode classifier blocked the first attempt as
  out-of-brief; user approved via AskUserQuestion (selected
  "Push setup commit"). Documented as deliberate setup, not
  test artifact.

Recommended fixes (carried into TR_011 report):

- **(CRITICAL)** Tighten review-agent prompt: explicit "do NOT
  emit when file structurally satisfies the rule"; "if concern
  is not in IntentSpec.successCriteria AND not in
  HARNESS.json.constraints.rules, treat as out-of-scope".
- **(HIGH)** Add deterministic post-LLM grep filter on
  review-agent findings — "Import cannot be resolved for X" →
  `grep "^import.*X" <file>`; drop finding if hit. "Direct DB
  access" → `grep "pool\.query\|db\.query" <file>`; drop if
  no hits.
- **(HIGH)** Investigate the 8-round overshoot. Audit
  `gate-orchestrator.ts` retryCount increment logic.
- **(HIGH)** Fix the review-agent `result_status='failed'` bug
  (TR_010 / TR_011 reconfirmed across 64 executions).
- **(MEDIUM)** Intent-agent should populate `outOfScope` more
  generously based on the brief's narrowness.
- **(MEDIUM)** Constraint-agent should scope to the cycle's diff,
  not the whole project tree.
- **(LOW)** Drop `listDirectory` from code-agent's `tools.builtin` —
  TR_011 proves the pre-generation prompt has driven it to zero.

Build status: `pnpm -r build` clean (no platform code changed).
Docker server still on TR_010's `30b5d0b` image, healthy throughout.
Trackeros `main`: `5e619a9` (setup commit). New file
`docs/claude/TEST_REPORT_011.md`. No new commits on the gestalt repo
yet — TR_011 commit is the next step.

---



### Session 2026-06-06 — Claude Code (TEST_REPORT_010: MAX_TOOL_CALLS cap-inside-batch + pre-generation prompt + executeScript availability — code-agent invokes executeScript 5× in a single run, the first end-to-end since TR_007; cycle escalates on legitimate review-agent findings, not platform bugs)

Implementation + live verification session against
TEST_REPORT_009's two-bug landing pad. The brief: refactor the
`MAX_TOOL_CALLS` enforcement so the cap is checked
**before** the per-call dispatch loop (TR_009's HTTP 400 root
cause), add a pre-generation prompt block telling the code-agent
to read existing deps first and skip listDirectory on output
paths it's about to create, raise the cap from 10 to 20. Then
re-run the Leave-module intent and answer **"does the
tool_calls log show an executeScript call?"** — the question
TR_009 left open.

Outcome: ✓ **decisive yes.** Code-agent ran 5× `executeScript`
in a single completed round (`mkdir` scaffold ×2, `npm run lint`,
`npm run typecheck`, `npx tsc --noEmit`), emitted a structured
JSON response with a `verificationNote` field, and the parser
converted that note into a low-severity `LINT_FAILURE` signal —
the first end-to-end production observation of the TR_008
`verificationNote` schema. Cycle escalated to `escalate` on
real review-agent findings (DB access outside repository pattern
+ missing audit logging), not platform bugs.

| Phase | TR_007 | TR_008 | TR_009 | **TR_010** |
|---|---|---|---|---|
| Code-agent result | completed | failed (rate-limit) | failed (HTTP 400) | **completed** |
| `executeScript` calls in log | 0 | 0 (logged) | 0 | **5** |
| Code-agent tokens | ~25.9k | ~34.2k avg | ~137k avg | 68.5k |
| Cycle deploys | yes | no | no | no (real review findings) |

What the user asked for:

- **Fix 1 (HIGH)** — Move the `MAX_TOOL_CALLS` cap check to
  batch-level. Previous code checked the cap inside the per-call
  dispatch loop; when the cap struck mid-batch, the assistant
  message in history carried N `tool_call_ids` but only M < N
  `tool` response messages, and the next OpenAI call failed
  with HTTP 400 *"tool_call_ids did not have response
  messages"*. Synthesise rejection responses for every call in
  an over-cap batch so history stays consistent. Pseudo-code
  in the brief used `break` after rejection.
- **Fix 2 (HIGH)** — Add a `## Before generating code` block
  at the start of `code-prompt.ts`'s task section telling the
  LLM to read existing files first, not explore non-existent
  directories, not `listDirectory` on output paths it's about
  to create. Raise `MAX_TOOL_CALLS` from 10 → 20.
- Re-run the same Leave-module intent. Verify no HTTP 400,
  at least one `executeScript`, cycle deploys on first round,
  ≤ 15 code-agent tool calls.

What changed (per fix):

- **Fix 1** — `packages/core/src/agents/base-llm-agent.ts`
  `runToolLoop`. New batch-level check before the per-call
  loop: `if (totalToolCalls + toolCalls.length > MAX_TOOL_CALLS)`
  → push a synthesised `tool` response for every call in the
  batch with content *"Tool call limit reached — no further
  tool calls permitted. Return your best answer now based on
  what you have already gathered."* Each rejection is logged
  into `toolCallLog` with `toolSource: 'cap-rejected'`. Inner
  per-call cap check removed; the dispatch loop now always
  processes the entire batch.
- **Fix 1 refinement** — initial implementation followed the
  brief's `break;` literally. Live verification (correlation
  `9cafadd5-…` round 1) failed with *"Code agent failed:
  Unexpected end of JSON input"* because `finalText` stayed
  empty after the rejection (`stopReason` was `tool_calls`,
  LLM never produced text). Changed to `capStruck = true;
  continue;` so the outer loop fires once more with
  `tools: capStruck ? [] : tools` — the LLM is forced to
  produce final text (`stopReason === 'stop'`).
- **Fix 1 wire fix** — `packages/core/src/llm/index.ts`
  `callProviderWithTools`. Spreading `tools` + `tool_choice`
  into the OpenAI body is now conditional on
  `tools.length > 0` — sending `tools: []` +
  `tool_choice: 'auto'` returns HTTP 400 *"tool_choice cannot
  be specified without 'tools' parameter"*.
- **Fix 2 — prompt** — `code-prompt.ts` task section gets a
  new `preGenerationSection` prepended:
  > 1. Read existing files your generated code will import
  >    from (use readFile on each). These are listed in the
  >    IntentSpec and design spec.
  > 2. Do NOT explore directories that don't exist yet — you
  >    are about to CREATE them. Call getFileTree ONCE,
  >    then proceed directly to generation.
  > 3. Do NOT listDirectory on paths listed as OUTPUT paths.
  > 4. After emitting, verify with executeScript.
  >
  > Budget guidance: ~1 getFileTree + ~3 readFile + ~2
  > executeScript = ~6 purposeful tool calls.
- **Fix 2 — cap raised** — `MAX_TOOL_CALLS` 10 → 20 in
  `base-llm-agent.ts`. Comment explains the verification-aware
  budget: ~1 getFileTree + ~3 readFile + ~2 executeScript =
  ~6 purposeful + retries.
- **Fix 4 (latent bug uncovered during verification)** —
  `packages/core/src/agents/agent-config-loader.ts`
  `VALID_BUILTIN_TOOLS` was missing `'executeScript'`. The
  `BuiltInToolName` type already included it, but
  `extractTools()` filters `agents.yaml`-declared tools
  through this Set, so any project listing `executeScript`
  had it silently dropped. **This is why TR_007–009's
  code-agent never invoked `executeScript`:** trackeros's
  `agents.yaml` overrode `PER_ROLE_DEFAULTS` with a 4-tool
  list (no executeScript), and even if an operator had added
  it, this filter would have stripped it. Added
  `'executeScript'` with a comment pointing at TR_007–010.
- **Operator-side** — trackeros `agents.yaml` code-agent
  `tools.builtin` gains `executeScript` (commit `6b7e42e`
  on trackeros `main`).

Live verification (correlation
`7afa0886-dfef-43e4-8731-af1b48aadbd0`):

| Agent | Status | Tokens | Tool calls | Duration |
|---|---|---|---|---|
| intent-agent | completed | 1,235 | 0 | 8s |
| design-agent | completed | 1,034 | 0 | 7s |
| lint-config-agent | completed | 0 | 0 | 25ms |
| context-agent | completed | 2,773 | 1 | 11s |
| **code-agent** | **completed** | **68,527** | **21** (5× executeScript, 8× listDirectory, 7× readFile, 1× getFileTree) | **33s** |
| test-agent | completed | 3,035 | 0 | 16s |
| review-agent | failed | 111,719 | 0 | 30s |
| constraint-agent | failed | 50,748 | 21 (19× executeScript, 2× searchFiles) | 387s |

Total: **~240k tokens / ~$0.14 USD** at gpt-4o-mini pricing —
within the brief's $0.10–0.15 target.

The five `executeScript` commands the code-agent ran:
```
1-2. mkdir -p src/modules/leave && touch leave.{model,repository,service,routes,index,test}.ts
3.   npm run lint
4.   npm run typecheck
5.   npx tsc --noEmit
```

Lint + typecheck failed because trackeros's `package.json`
doesn't declare those scripts. The LLM correctly surfaced that
via a `verificationNote` field, which `parseCodeResponse`
converted into a `LINT_FAILURE` signal:
> *"Code-agent pre-emit verification did not pass: The module
> structure was created successfully, but I was unable to run
> lint and typecheck scripts as they are missing from
> package.json."*

**First observed end-to-end use of the TR_008 verificationNote
schema in production data.**

Generated artifacts: 5 source files + 5 test files for the
Leave module (model / repository / service / routes / index +
4 unit tests + 1 module test). **First time the trackeros
scaffolding has progressed past the code-agent step since
TEST_REPORT_007.**

Gate verdict: `escalate` — 1 `GOLDEN_PRINCIPLE_BREACH` (DB
access outside repository pattern) + 3 review-agent
`CONSTRAINT_VIOLATION` (missing audit logging, test framework
mismatch, unresolved import) + 2 constraint-agent
`CONSTRAINT_VIOLATION` (error shape, unhandled promise). These
are **real architectural findings** on the generated code, not
platform failures.

Brief's verification matrix:

| Check | Result |
|---|---|
| No HTTP 400 *"tool_call_ids did not have response messages"* | ✓ pass |
| Code-agent reads existing deps | ✓ pass (7× readFile) |
| At least one executeScript call | ✓ **pass (5×)** |
| No listDirectory on non-existent paths | ⚠ partial (8× — down from 14× in TR_009) |
| Cycle deploys on first round | ✗ escalated on real findings |
| Total code-agent tool calls ≤ 15 | ⚠ 21 (hit the new cap of 20 + 1 rejection batch entry) |

Decisions made:

- **Departed from the brief's literal `break` after cap
  rejection.** Live verification showed the LLM produced no
  text on the rejected turn, leaving `finalText` empty. The
  brief's intent ("LLM is explicitly told to stop requesting
  tools and return its answer") required a synthesis turn —
  changed to `continue` + empty-`tools` next call so the model
  is forced to produce text.
- **Fixed `VALID_BUILTIN_TOOLS` even though it wasn't in the
  brief.** Without it, the verification matrix mechanically
  could not pass — the LLM couldn't invoke `executeScript`
  because the loader silently stripped it. Documented as a
  scope expansion in the report.
- **Updated trackeros `agents.yaml` for the same reason.** Even
  with the loader fix, trackeros's existing 4-tool declaration
  needed `executeScript` appended to expose it.
- **Wrote the report against the escalated cycle rather than
  re-running.** The escalation is on legitimate findings; the
  fixes work. Re-running to chase deploy success would
  conflate platform observation with content-quality
  iteration.

Pending follow-ups:

- **(HIGH) Review-agent `result_status = 'failed'` with
  successful JSON output.** `agent_execution_logs` row marked
  failed (empty `error_message`) but `llm_response` is
  well-formed JSON AND 4 `signals` rows were emitted with
  `source_agent='review-agent'`. Cosmetic — verdict is correct,
  row label is wrong. Likely a race in the gate-orchestrator
  failure-path.
- **(MEDIUM) Constraint-agent 387s / 50k-token /
  19-executeScript budget** on the Leave intent. Now the
  slowest agent in the cycle by 5×. Restructure the prompt
  to batch verifications or introduce a per-role
  `MAX_TOOL_CALLS` override.
- **(MEDIUM) Code-agent still emits 8× listDirectory** despite
  the new pre-generation block. Down from 14× in TR_009,
  still significant. Options: drop `listDirectory` from
  code-agent's `tools.builtin` (lean on `getFileTree`); or
  strengthen the prompt with hard examples of unhelpful
  exploration.
- **(MEDIUM) Add `n_turns` + `final_stop_reason` columns** to
  `agent_execution_logs` (carried over from TR_008/009) — would
  make "agent hit the cap" detectable without grepping server
  logs.
- **(LOW) Update the corporate-ops-web-mobile template
  `agents.yaml`** to include `executeScript` for code-agent /
  review-agent / constraint-agent so newly-bootstrapped
  projects don't repeat this issue.
- **(LOW) trackeros `package.json`** doesn't expose `lint` or
  `typecheck` scripts. The code-agent caught it via
  `verificationNote`. Either add scripts or drive a follow-up
  intent.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted via
`docker compose up -d --build`. Server `/health` 200 throughout.
Trackeros `main` updated to `6b7e42e`. New file
`docs/claude/TEST_REPORT_010.md`.

---



