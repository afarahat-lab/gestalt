# STATE.md — current platform state

_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-07 (after TEST_REPORT_019 — TR_018's ADR-041 chain end-to-end-verified against a REAL `github-actions` pipeline adapter on trackeros. 4-stage CI (Compile / Test / Lint / Security) green in 35s; pipeline-agent polls + detects pass; gate clones PR branch + reads source files; both gate agents confirmed on gpt-4o. Cycle did NOT deploy — hit a separate runaway-loop bug: gate retries 46× vs `MAX_GATE_RETRIES=3` budget (new HIGHEST follow-up). Six trackeros operator issues fixed in four `main` commits — `.gitignore` added + 9379 node_modules untracked, `gestalt.yml` workflow replaced with post-CI template, package.json scripts/jest 27→29 + `--legacy-peer-deps`, broken pre-existing tests deleted, HARNESS.json trimmed.)
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

### TR_019 — Real GitHub Actions CI verified end-to-end

ADR-041 chain verified live with a real `github-actions` pipeline
adapter. 4-stage CI (Compile / Test / Lint / Security scan) green
in 35s; pipeline-agent polls + detects pass; gate clones PR branch
+ reads source files; both gate agents on gpt-4o (88/88 calls).
**Cycle did NOT deploy** — gate retry budget runaway (46 rounds vs
`MAX_GATE_RETRIES=3`). Six trackeros operator issues fixed in four
`main` commits. See `docs/claude/TEST_REPORT_019.md`.

- **(HIGHEST — new from TR_019)** Gate retry budget not enforced.
  `gate-orchestrator.ts:57` defines `MAX_GATE_RETRIES = 3`. Live
  cycle ran 46 rounds. Root cause hypothesis: `retryCount` is set
  in the new generate task payload when gate-fail dispatches retry,
  but the count is dropped during the deploy:pr → deploy:pipeline →
  gate:review response path. Every gate re-entry sees
  `payload.retryCount ?? 0` → 0 → ∞. `intent.attempt_count = 0`
  throughout (related). 0 self-healing-agent runs, so it's not the
  gate-fail-to-self-healing path. Bisect candidate: TR_018's
  generate→deploy:pr direct dispatch (was generate→gate:review),
  which may have dropped retryCount threading.
- **(HIGH — new from TR_019)** Three CI runs per push
  (workflow_dispatch + push + pull_request) all do identical work.
  Drop `pull_request: branches: [main]` from the template — push
  already covers the gestalt/** branches.
- **(MEDIUM — new from TR_019)** `gestalt init` should scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest versions with TS
  scaffolding time. trackeros's jest@27 + TS@5 mismatch was latent
  under `noop` and only surfaced when CI ran jest. Same scaffolding
  should also align Node 22 across project + workflow files.
- **(LOW — new from TR_019)** Template `{{ciSetupSteps}}` for
  Node/npm should add `--legacy-peer-deps` on `npm install` until
  the upstream npm arborist `Link.matches` bug is fixed.
- **(LOW — new from TR_019)** Add a `tsc --noEmit` sanity check on
  scaffolded tests in `gestalt init` so future meta-test debris is
  caught before commit.

### Resolved by TR_019

- **~~(MEDIUM — TR_018)~~ RESOLVED.** trackeros pipeline.adapter
  switched from `noop` to `github-actions` + autoMerge enabled.
- **~~(LOW — TR_018)~~ RESOLVED.** Stale trackeros
  `test-runner-agent` references removed.

### Carryovers (TR_018 / TR_014)

- **(HIGH — TR_018)** Restore the TR_010 mandatory `executeScript
  tsc --noEmit` code-agent rule on trackeros's HARNESS.json. CI's
  `Compile` step catches the same errors post-hoc but the rule
  catches them pre-emit during Aider's generation.
- **(MEDIUM — TR_014)** Aider token-spend visibility. Parse
  `Tokens: N sent / M received` from Aider's stdout. code-agent
  rows still show 0 tokens across all rounds.

### Architecture follow-ups (carryover, all LOW)

- **Tool-call persistence is incremental** in
  `BaseLLMAgent.runToolLoop()` (TR_009 Fix 1). Mid-loop throws
  preserve full tool-call logs in `agent_execution_logs`.
- **Review-agent `result_status='failed'` with successful JSON
  output** (TR_010/011). Cosmetic — verdict is correct, row label
  is wrong. Trace gate-orchestrator failure-path vs signal emit.
- **TR_004 Fix 4 self-healing escape hatch (new-violations
  detection)** still not exercised live. TR_012's
  `detectRepeatedSignalLoop` IS proven live.
- **executeScript invocation patterns** (TR_010/011/012/013).
  Code-agent ~21×/round; constraint-agent 5–25×/round. Review-agent
  zero in TR_011-013; the gpt-4o switch (TR_016) was supposed to
  fix this but has not been re-verified post-TR_017.
- **Dashboard bundle is 1010 KB raw / 319 KB gzipped** after the
  CodeMirror addition. Above Vite's 500 KB warning. Candidate for
  a future code-split via dynamic `import()`.
- **Retry cycle full re-runs all generate agents** even though only
  routed agents need fresh work. Skipping intent/design/context
  when prior artifacts are present in the Git tip would speed
  retries by ~30s.
- **`qualityGate.maxRetries` hardcoded to 3** in both gate and
  generate orchestrators; reading it per-project from HARNESS.json
  is a small follow-up.
- **Promotion workflow dispatches against a hardcoded `'main'` ref.**
  Projects on `master` / `trunk` will see promotion workflow-dispatch
  fail. Thread `project.defaultBranch` through.
- **No proactive PAT-scope validation at registration / set-adapter
  time.** A PAT missing `workflow` scope only surfaces on the first
  pipeline dispatch.
- **Return-URL preservation across login.** Pasting
  `/app/intents/<id>` in a fresh tab bounces to `/app/login` then
  lands on `/app/` (intent ID dropped).
- **Vite dev-server proxy `/api` entry is dead** — server has no
  routes under `/api`. Pre-existing dead config; remove on next
  dashboard touch.
- **Encrypt Git PATs at rest in the legacy
  `project_git_credentials` table.** Vault path is the modern flow;
  legacy plain-token path still has the TODO comment.
- **LLM model name not validated at startup** — an invalid model
  only surfaces as a 404 on the first LLM call.
- **HA replica support for OIDC state.** Today's state is
  in-memory; multi-replica deployments would need Redis-backed
  state so the callback can hit a different replica than the login.
- **Older test-report follow-ups** (all LOW): test-agent punts on
  method coverage with "// Additional tests can be added similarly"
  (TR_004); IntentSpec lacks a `dependencies` block (TR_004,
  MEDIUM); context-agent has 4 tools but never uses them (TR_002).
- **Fix 1 (env-default apiShape) not yet live-verified** — needs
  `LLM_MODEL=chat-latest` +
  `platform_llms.chat-latest.api_shape='responses'`.

---

## Operator caveats / pending actions

### TR_019 trackeros state (current)

- **trackeros `main` updated through 4 commits** ending at
  `c93a12e5`. Pipeline adapter `github-actions` + autoMerge true.
  Workflow on push (gestalt/**), pull_request (main),
  workflow_dispatch. Comprehensive 4-stage CI (Compile / Test /
  Lint / Security) green in 35s.
- **trackeros stranded PR branches** from TR_019 cycles:
  `gestalt/37bd74af-...` (PR #49 closed via gate fail),
  `gestalt/e8da427e-...` (PR #50), `gestalt/c18dcfba-...` (PR #51),
  `gestalt/91a108fb-...` (PR #52, the long runaway cycle). All
  failed; manually close + delete branch when convenient.
- **trackeros runaway alerts** from TR_019:
  `gestalt alerts list` will show the latest. Dismissable with
  `gestalt alerts dismiss <id>`.

### Older trackeros caveats (unchanged from TR_018)

- **trackeros `.github/workflows/gestalt.yml`** now uses Node 22
  via the TR_019 replacement. Done.
- **trackeros PR #46** — synthetic test PR opened during
  vault-credential live verification (2026-06-04). Close with
  `gh pr close 46 --repo afarahat-lab/trackeros --delete-branch`.
- **Re-create vault secret for OpenAI API key** if the operator
  wants vault-backed routing. Both LLMs currently in env-var
  mode (`apiKeyEnv: 'LLM_API_KEY'`) and working.
- **Synthetic trackeros branches** from older live test cycles
  (TR_002 / 003 merged; TR_004+ failed at gate and never pushed).
  Branch-name pattern: `gestalt/<correlation>-`.
- **Open alerts to dismiss**: prior cycle alerts from
  TR_010–TR_018 still in the list. All dismissable.
- **`.env`**: `LLM_MODEL=gpt-4o` (operator default). For
  `chat-latest` routing through the registry's responses
  api_shape, see TR_003 Fix 1 follow-up.
- **`master.key`**: now generated in the workspace root
  (gitignored, mode 600), mounted into the container by default
  via `docker-compose.yml` (TEST_REPORT_003 Fix 2). Survives
  `docker compose up -d --build`.

---

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
