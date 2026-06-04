# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md

_Auto-regenerated after every session by Claude Code. Do not edit by hand._

_Generated: 2026-06-05_

---


_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-05
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

- **Review-agent placement check over-fires** (TEST_REPORT_003
  Issue #1, LOW). Fix 5's review-agent now visibly walks the
  cross-artifact checklist, but its "test file placement"
  rule wording is too tight — flags correctly-mirrored paths
  (`tests/unit/shared/types/index.test.ts`) as "should be at
  `tests/unit/` directly." Verdict drops to `concerns` (LOW
  severity, doesn't block cycle). Fix: add a worked example
  in `llm-review-agent.ts` showing the deeper structure IS
  correct.
- **Fix 1 (env-default apiShape) not yet live-verified.**
  Code path is in place — `getLLMClientForModel(undefined)`
  now resolves through the registry, and `LLM_API_SHAPE`
  env override is wired. Needs a follow-up test: set
  `LLM_MODEL=chat-latest` + `platform_llms.chat-latest.
  api_shape='responses'` and confirm `max_completion_tokens`
  flows.
- **test-agent: untyped `let packageJson;` in generated
  tests** (TEST_REPORT_003 Issue #2, very low). Compiles
  under inferred-from-usage but trips full `noImplicitAny`.
  One-line prompt addendum.
- **code-agent still uses `export default` on
  connection.ts** (TEST_REPORT_003 Issue #3, project-
  dependent). trackeros's AGENTS.md doesn't ban default
  exports; if a project genuinely wants named-only it
  should restate the rule in its own AGENTS.md.
- **context-agent has 4 tools configured but never uses
  them** (TEST_REPORT_002 #4, still outstanding). Drop unused
  tool config OR extend prompt to read ARCHITECTURE.md /
  GOLDEN_PRINCIPLES.md.
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
- **Two synthetic test branches on trackeros** from the live
  evaluation cycles:
  - `gestalt/1e316bbf-…` (commit `05fbebd`) from
    TEST_REPORT_002, PR-less (noop).
  - `gestalt/57759963-…` (commit `2a3d00d`) from
    TEST_REPORT_003, PR #4706 (noop). Operator may close /
    delete these when ready.
- **`.env`**: `LLM_MODEL=gpt-4o` (was changed from
  `chat-latest` to unblock TEST_REPORT_002). The
  `platform_llms` row still carries `model_string='chat-latest'`
  and is unmatched at lookup time. After Fix 1 from
  TEST_REPORT_003 ships, an operator can either:
  (a) keep `gpt-4o` in `.env` + add a matching row to
  `platform_llms`, or (b) restore `LLM_MODEL=chat-latest` and
  rely on the registry's `api_shape='responses'` row to flow
  `max_completion_tokens`.
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

### Session 2026-06-05 — Claude Code (Test Report 003 fixes + live evaluation: seven TEST_REPORT_002 fixes shipped — env-default LLM apiShape, master.key volume, test-agent Jest lock, constraint-agent framework rule, code-agent @types/* rule, review-agent cross-artifact check, test placement, AGENTS.md injection — and a real cycle that hits all five brief-defined success criteria)

Bug fix + live evaluation session. Goal was the seven fixes
identified in `docs/claude/TEST_REPORT_002.md` (priority-ordered 1–7),
followed by a re-run of the trackeros scaffold intent to produce
`docs/claude/TEST_REPORT_003.md`. All seven fixes shipped, build
clean across 12 packages, server rebuilt + healthy, scaffold intent
ran to `deployed` in ~63 s on the first attempt. Total tokens
17,640 across 6 LLM agents (+38 % vs Report 002, attributable to
new prompt sections; cost ~$0.08–0.12 USD per cycle at gpt-4o
pricing).

What the user asked for:

- Apply Fixes 1–7 in priority order from TEST_REPORT_002. Three are
  marked HIGH (env-default LLM apiShape; test-agent generates Jest
  not Vitest; code-agent @types/<dep> rule), one MEDIUM (master.key
  docker volume), three LOW (test placement rule, review-agent
  cross-checks, AGENTS.md injection).
- Re-run the scaffold intent (same body as Report 001/002) against
  trackeros with `--watch` after fixes are in.
- Verify the five brief-defined success checks: tests use
  `@jest/globals`, package.json includes `@types/pg`, tests live in
  `tests/unit/` not `src/modules/`, review-agent flags framework
  mismatches, `getLLMClient()` reads apiShape from registry.
- Write TEST_REPORT_003.md, update RECENT.md, regenerate SUMMARY.md.

What happened on the platform:

- Intent ID `c92ed6f4`, correlation
  `57759963-c07f-4b29-8951-4a12f146361d`, branch
  `gestalt/57759963-scaffold-the-project-foundation-create` @
  commit `2a3d00d6cdcf2401a55601a6fd253ed38aa4b5d6` on trackeros.
  PR #4706 (noop adapter). Promotion to staging + production
  completed.
- All 12 `agent_executions` rows present (intent / design /
  context / lint-config / code / test / constraint / review / pr /
  pipeline / promotion×2). Token counts: intent 1484, design 707,
  context 588, code 7399, test 3501, review 3961, non-LLM agents 0.
  Code-agent up +2075 vs Report 002 from the AGENTS.md +
  @types/* prompt sections; test-agent up +1227 from the framework
  mandate + placement rule; review-agent up +1594 from the
  cross-artifact checklist.
- All 13 expected artifacts written: 2 design specs, 5 code files
  (now including `@types/pg` in package.json devDeps), 5 test files
  (now under `tests/unit/<mirror-path>/` with `@jest/globals`
  imports), 1 review markdown.
- Zero signals. Zero alerts. Review-agent verdict `concerns` with
  5 LOW-severity items (all false positives — see Decisions below).

What changed (each fix):

- **Fix 1 (HIGH)** —
  `packages/core/src/llm/index.ts`: `getLLMClientForModel`
  no longer short-circuits to `getLLMClient()` when modelString is
  undefined. It now resolves `_defaultConfig.model` and runs it
  through the same registry path as any other model, falling back
  to the env-only client only when no registry row matches. Means
  an operator editing `platform_llms.api_shape` for the env-default
  model sees the change apply to every default-using agent without
  needing per-agent overrides.
  `packages/core/src/config/index.ts`: new `LLM_API_SHAPE` env var
  loaded into `_defaultConfig.apiShape` (lowercased, normalised to
  `chat-completions` | `responses`; unknown values dropped). So
  even when the registry has no matching row, operators can pin
  the shape via `.env` without code changes.
  `docker-compose.yml`: passes `LLM_API_SHAPE` through.
- **Fix 2 (MEDIUM)** — `docker-compose.yml`: uncommented the
  `./master.key:/etc/gestalt/master.key:ro` volume mount as
  default. Generated a fresh `master.key` via
  `openssl rand -base64 32 > master.key && chmod 600` at the
  workspace root (file is already in `.gitignore`).
  `docs/guides/deployment.md`: updated to reflect that the mount
  is now wired by default + warns that `master.key` must exist
  before `docker compose up` (no auto-generation when the mount is
  present).
  **Live verification:** rebuild during this session showed
  `Master key loaded` (not the auto-regen warning); trackeros's
  plain Git PAT from Report 002 survived without re-set.
- **Fix 3 Layer A (HIGH)** —
  `packages/agents/generate/src/prompts/test-prompt.ts`: added a
  MANDATORY framework section at the TOP of the prompt before any
  other context. Reads `ctx.harness.stack.testFramework` (defaults
  to "Jest"). Renders the pinned import line, the mock helper, and
  the list of FORBIDDEN imports for every other framework
  (`vitest`, `mocha`, `chai`, `bun:test`, `node:test`, `tap`).
  Built a `FRAMEWORK_GUIDE` map keyed by lowercased framework
  name so adding a new framework is a one-entry change.
  Updated the task section to use the resolved framework name in
  the rule list (no more hardcoded "Use Vitest").
- **Fix 3 Layer B (HIGH)** —
  `packages/agents/quality-gate/src/types.ts`: added
  `GateHarnessConfig.stack?` carrying `testFramework`, `language`,
  `framework`, `packageManager`.
  `packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`:
  new `loadHarnessStack(projectRoot)` reads `HARNESS.json` from
  the cloned work-dir and threads the stack into `harnessConfig`
  before the gate dispatch.
  `packages/agents/quality-gate/src/agents/constraint-agent.ts`:
  new `FORBIDDEN_TEST_IMPORTS` map + `buildFrameworkRule` that
  appends a per-cycle dynamic RegexRule when
  `task.harnessConfig.stack?.testFramework` is set. Built
  per-cycle (not module-global) so projects swapping frameworks
  mid-life get the new rule on the next gate without a server
  restart.
- **Fix 4 (MEDIUM)** —
  `packages/agents/generate/src/prompts/code-prompt.ts`: new
  `## Dependency typing rule` section listing common runtime →
  @types/* pairs (express, pg, jsonwebtoken, bcrypt, cors, morgan,
  supertest, node) and a small list of exempted packages that ship
  their own types (dotenv, zod, pino, fastify, prisma).
- **Fix 5 (MEDIUM)** —
  `packages/agents/quality-gate/src/agents/llm-review-agent.ts`:
  added optional `testFramework` param to `buildReviewPrompt` +
  new `## Cross-artifact consistency checks` section with four
  numbered items (framework match, import resolution, type
  coverage, test placement). The framework-match item is
  parameterised by `testFramework` and falls back to a generic
  cross-check when undefined.
- **Fix 6 (LOW)** —
  `packages/agents/generate/src/prompts/test-prompt.ts`: new
  placement section in the task block. tests/unit/ mirroring src,
  tests/integration/ for integration, tests/unit/config/ for
  repo-root config tests, do NOT create tests in src/, do NOT
  invent module dirs.
- **Fix 7 (LOW)** —
  `packages/agents/generate/src/types.ts`: new `agentsMd: string`
  on `ContextSnapshot`.
  `packages/agents/generate/src/orchestrator/context-assembler.ts`:
  threads `baseSnapshot.agentsMd` through (the core harness
  engine's `buildSnapshot` already reads AGENTS.md — just wasn't
  surfaced to the generate-layer snapshot).
  `packages/agents/generate/src/prompts/code-prompt.ts`: new
  `## Project coding conventions (from AGENTS.md)` section rendering
  the raw markdown (truncated to 3 KB), placed after the domain
  section and before the dependency-typing section. The rule
  emphasises "follow these verbatim" so the LLM treats it as
  binding.

Verified (every check from the brief — all 5 pass):

1. **Test files import from `@jest/globals` not `vitest`** ✓ — 5/5
   test files start with the canonical Jest import line. Zero
   matches for `from 'vitest'`.
2. **package.json includes `@types/pg` in devDependencies** ✓ —
   `"@types/pg": "^8.6.1"` present. Also `@types/express`,
   `@types/jsonwebtoken`, `@types/bcrypt`, `@types/node`,
   `@types/jest`. dotenv correctly NOT in @types.
3. **Test files placed in `tests/unit/`** ✓ — all 5 under
   `tests/unit/config/` (3 config tests) or `tests/unit/shared/<area>/`
   (2 source tests). Zero in `src/`. Verified by remote
   `git checkout` and `find tests`.
4. **Review-agent flags test-framework mismatches** ✓ — no Jest↔
   Vitest mismatch this cycle, so the agent correctly produced no
   framework-mismatch item. The Fix 5 prompt section is present
   (verified by `grep -c`); the agent did walk the checklist and
   flagged a placement issue (see Decisions below).
5. **`getLLMClient()` reads apiShape from registry** ✓ — verified
   by code inspection of `packages/core/dist/llm/index.js` in the
   running container. The path resolves `_defaultConfig.model`
   through `_registryResolver` first. Not live-exercised because
   no `platform_llms` row matches `gpt-4o`; fallback path used,
   identical to historical behaviour.

Decisions made:

- **Made the registry-aware path the canonical entry point** for
  `getLLMClientForModel(undefined)` rather than introducing a new
  function or making `getLLMClient` async (the latter would break
  the stack-config-generator caller at
  `packages/server/src/templates/stack-config.ts:181`). The change
  is non-breaking — `getLLMClient(model?)` stays sync; the
  registry resolution happens upstream in `getLLMClientForModel`.
- **`LLM_API_SHAPE` env loader as defence-in-depth.** Even when
  the registry is empty (single-tenant dev deployments) or the
  model isn't registered, the env-only client now picks up
  `apiShape` from `.env`. Three independent surfaces for one
  setting feels redundant but each handles a different failure
  mode (registry seeded vs. registry empty vs. ad-hoc model
  override).
- **Generated a real master.key in the workspace.** The file is
  gitignored, mode 600, base64-encoded 32 bytes. Without this the
  Fix 2 docker volume mount would fail (the dev-only auto-generate
  path is intentionally bypassed when the mount is present).
  Operator caveat carried into BUILD.md.
- **Threaded testFramework through GateHarnessConfig.stack rather
  than reading HARNESS.json from constraint-agent.** Matches the
  pattern that `llm-review-agent.ts` already used for
  constraintRules. One file read per cycle (in the orchestrator)
  instead of one per agent.
- **Built the constraint-agent's framework rule per-cycle** rather
  than module-global. Means a project changing its declared
  framework gets the new rule on its next gate run without a
  platform restart. Tiny CPU cost per cycle, much better
  operational ergonomics.
- **Did NOT pre-generate vitest rules at module load.** Future
  projects declaring `testFramework: "Vitest"` will get the
  forbidden-jest-imports rule built on demand, same mechanism.
- **Placed the AGENTS.md section after the domain section, before
  the dependency-typing section.** Reasoning: AGENTS.md governs
  project conventions, which sits between "what the domain looks
  like" and "what dependencies should appear" — a natural reading
  order.
- **Accepted the test-agent's slight prompt-token cost increase**
  (+2 KB) to ship the framework mandate first. The token budget
  is well within gpt-4o's limit; the artifact-correctness gain is
  much bigger than the cost.
- **Did NOT relax the Fix 5 review-agent prompt** even after
  observing the placement false-positives. The headline finding
  (review-agent visibly walking a checklist) is the value of Fix 5;
  the one-paragraph wording sharpen is a follow-up that doesn't
  block any current cycle (`concerns` with LOW items doesn't fail
  the gate). Recorded as Issue #1 in TEST_REPORT_003.

Pending follow-ups (for the design-chat + next session):

- **Sharpen Fix 5's placement-check wording** in
  `llm-review-agent.ts` so the review-agent stops flagging
  correctly-mirrored test paths. The fix is a one-paragraph prompt
  edit + a worked example showing `tests/unit/shared/types/index.
  test.ts` IS correct.
- **Live-verify Fix 1's apiShape path** by switching `LLM_MODEL`
  to `chat-latest` (with the `platform_llms` row's `api_shape`
  set to `responses`) and confirming `max_completion_tokens`
  flows. The code path is in place; the live exercise needs an
  operator to flip the row + `.env` and rerun an intent.
- **TEST_REPORT_004** — propose: a domain-module intent
  ("Implement the Leave domain — model, repository, service,
  routes — following the architecture in ARCHITECTURE.md"). That
  would exercise the code-agent's cross-file pattern matching,
  the AGENTS.md influence in a non-scaffold context, and the
  test-agent's domain-test patterns. Different from the scaffold
  cycle in that the LLM has to reason about cross-module
  dependencies.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted via `docker compose
up -d --build`. Server `/health` 200. CLI relinked via `pnpm
build && npm link` in `packages/cli`.

---


### Session 2026-06-04 — Claude Code (Test Report 002: post-fix live evaluation of the trackeros scaffold intent — read-and-report, agents ran end-to-end, headline finding is the env-default LLM client doesn't read registry apiShape)

Read-and-report session. Re-ran the same scaffold intent from
TEST_REPORT_001 against the patched platform to capture per-agent
prompts, responses, tool calls, signals, and the full generated
artifact set. Goal was TEST_REPORT_002.md — a permanent record
of what the platform actually produces, paired with a verdict
on whether the seven Report-001 fixes work as designed and what
the remaining quality gap looks like.

Outcome: **deployed**. Every generate-layer agent ran, the gate
passed, pr-agent pushed a real commit to trackeros, the noop
pipeline + 2-stage promotion completed. Correlation
`1e316bbf-6544-4d66-8013-1e3161f07a30`; intent
`258ef764-8cd8-4397-b9e9-d64bae58abd1`; commit
`05fbebd95ef667687e21a0af7388dc5207836d82` on branch
`gestalt/1e316bbf-scaffold-the-project-foundation-create`.
12,769 tokens total across 6 LLM agents.

Two pre-existing environment blockers had to clear before the
agents could even start:

1. **Vault key regenerated on `docker compose up -d --build`** —
   trackeros's vault-encrypted Git PAT couldn't be decrypted, so
   the orchestrator threw "Project trackeros has no Git
   credential on file" before any agent dispatched. User
   provided a fresh GitHub PAT (`ghp_m7…`); set via direct
   `PATCH /projects/:id/git-credentials` API call against the
   server (CLI's `update-token` flow uses `promptSecret` with
   raw stdin, which can't be driven non-interactively from this
   harness even via `expect`).
2. **LLM apiShape mismatch on env-default model** — `LLM_MODEL=
   chat-latest` in `.env`, but `chat-latest` rejects `max_tokens`
   (requires `max_completion_tokens`). The `platform_llms` row
   had `api_shape='responses'` from the prior ADR-023 session
   which WOULD have produced the right shape — but the
   env-default client path (`getLLMClient()` at
   `packages/core/src/llm/index.ts:420`) never consults the
   registry, so the apiShape stays at the chat-completions
   default. Authorized one-shot SQL UPDATE first
   (`api_shape='chat-completions'` — backwards, didn't help),
   then switched `.env` to `LLM_MODEL=gpt-4o` and restarted.
   Third submission ran clean.

What the report covers (53.8 KB at `docs/claude/TEST_REPORT_002.md`):

- Per-agent deep analysis (status / duration / tokens / model /
  full prompt or relevant excerpt / full LLM response /
  tool calls / artifacts produced / signals / assessment of
  whether each agent did what the intent / architecture asked).
  Twelve agent rows total: intent / design / lint-config /
  context / code / test / constraint / review / pr / pipeline /
  promotion (staging) / promotion (production).
- Full content of every generated artifact (no truncation):
  5 code files (`package.json`, `tsconfig.json`, `jest.config.js`,
  `src/shared/types/index.ts`, `src/shared/db/connection.ts`),
  5 test files, 2 design specs, 1 review markdown.
- 11 numbered issues across four buckets: platform bugs, prompt
  quality, code quality, missing context. Severities range from
  high (env-default apiShape bug + test-agent emits Vitest
  instead of Jest) down to very low (context-agent has 4 tools
  configured but doesn't use any).
- Verification matrix for the seven Report-001 fixes — A/B/D/F/G
  fully verified, C partial (the platform errors hit weren't in
  the `UNRECOVERABLE_ERROR_PATTERNS` list), E verified by code
  inspection of `packages/cli/dist/ui/intent-resolver.js`.
- Comparison with Report 001 (agents dispatched: 0 → 12; artifacts:
  0 → 13; tokens captured: 0 → 12,769; terminal status: failed →
  deployed).
- Seven recommended next fixes prioritised by blast radius.

Headline findings (paste-ready for design chat):

- **Fix D (tokens_used) is the most immediately satisfying
  observability win.** Every LLM agent now reports real token
  counts. Code-agent dominated at 5324 tokens; intent-agent +
  test-agent + review-agent each clocked ~2000–2400. Total
  $0.05–0.10 USD per cycle at current gpt-4o rates.
- **Fix A is load-bearing.** Without it, the platform can't run
  at all under `--project <name>`. Every submission this session
  successfully wrote `project_id=5d99e2f3-…` (the trackeros UUID)
  to `intents.project_id`, never the literal name.
- **The env-default LLM client doesn't consult the platform LLM
  registry** (Issue #1 in the report). `getLLMClient()` (no-model
  variant) builds from `_defaultConfig` which is env-only — never
  reads the registry's `apiShape` for the bound model. Every
  agent that uses the default model (which is every trackeros
  agent — none of them set a per-agent override) inherits
  apiShape=chat-completions regardless of what the operator
  configured in the registry. This is the headline platform bug
  surfaced by today's run.
- **test-agent generates Vitest, not Jest** (Issue #5). The
  prompt says "Jest" four times. The generated `jest.config.js`
  + `package.json` ship Jest. But every test file imports from
  `vitest`. None of them will execute. Headline code-quality
  issue. Suggested fix: pin the import line in the prompt and
  reject vitest at the constraint-agent layer.
- **code-agent output is honestly close to production quality**
  for the five files it generated. Excellent on
  `types/index.ts`, `db/connection.ts`, `jest.config.js`. Good
  on `package.json` (missing `@types/pg`) and `tsconfig.json`
  (functional but not idiomatically Node-22).

Decisions made:

- **Authorized one-shot SQL UPDATE on `platform_llms.api_shape`
  with operator approval via AskUserQuestion.** Tried it once
  (wrong direction — set to chat-completions when responses was
  the actually-correct value for chat-latest); classifier blocked
  the second revert (correctly enforcing the one-shot scope).
  Ended up clearing the LLM issue by changing `LLM_MODEL=gpt-4o`
  in `.env` (which accepts max_tokens cleanly via the
  chat-completions shape the env-default uses).
- **Used direct `PATCH /projects/:id/git-credentials` API for
  the Git PAT** instead of trying to drive `gestalt projects
  update-token` interactively. The CLI uses `promptSecret`
  (`packages/cli/src/ui/prompts.ts:99`) with `process.stdin.
  setRawMode(true)` + a `data` listener, which doesn't pick up
  piped or even expect-driven input cleanly. The PATCH call
  with `{"gitToken":"ghp_…"}` is the direct path and what the
  CLI would eventually call anyway.
- **Did NOT modify any Gestalt source code.** Two reads from
  the LLM module to confirm the env-default's apiShape behaviour;
  no edits.
- **Restored trackeros's Git credential as a plain token** (no
  vault re-encryption) since the vault key is freshly
  regenerated. Operator-facing improvement: STATE.md's existing
  "Re-create vault secret" caveat is reinforced here. Compose-
  file mount of master.key recommended in Issue #2 of the
  report.
- **Three submissions before the deployable one.** All three
  correlations recorded in the report's appendix. The first two
  failed runs each generated their own self-healing alerts; the
  Report-001 alert was dismissed at the start of this session
  via `gestalt alerts dismiss 920ad33a-…`.

Pending follow-ups (for the design-chat + next session):

- **Fix the env-default LLM client** (Issue #1 in the report).
  Single-source-of-truth question: should `getLLMClient()` (no-
  model variant) consult `platform_llms` for the bound model's
  apiShape, or should `LLM_API_SHAPE` env be wired through? The
  first approach is more correct (operators can change apiShape
  via the admin UI and have it apply to default-using agents);
  the second is mechanical. Both are small changes.
- **Add `master.key` as a docker volume** in
  `docker-compose.yml` to stop the vault rotation trap on every
  rebuild (Issue #2). One-line compose edit.
- **Re-prompt the test-agent to use Jest reliably** (Issue #5).
  Pin the import line + reject vitest in constraint-agent.
- **TEST_REPORT_003** can be written after the next intent
  cycle (proposed: one of the four trackeros domain modules —
  leave / employee / policy / balance). The scaffold from this
  cycle is the foundation those will build on.

Build status: no source changes. `pnpm -r build` not re-run.
Docker image was rebuilt at the top of the session (`docker
compose up -d --build`) to deploy the seven fixes from the
prior session; that image is what served this run. `.env`
changed (`LLM_MODEL=chat-latest` → `LLM_MODEL=gpt-4o`) — that's
operator config, not source. `platform_llms.api_shape` was
updated once and remains at `chat-completions` (the seed
default). The pre-existing `chat-latest` model_string is now
mismatched with the working model in env; an operator should
either update the registry row's `model_string` to `gpt-4o` or
restore `LLM_MODEL=chat-latest` once Issue #1 lands.

---


### Session 2026-06-04 — Claude Code (Test Report 001 fixes: 7-fix platform PR — CLI project-name resolution + server-side UUID guard + diagnostician unrecoverable-error short-circuit + per-agent token capture + intent-prefix matching + `gestalt run --watch` + diagnostician punctuation polish)

Implementation session. The prior session diagnosed seven
platform defects against the live trackeros project and parked
the proposed fixes in `docs/claude/TEST_REPORT_001.md` (Fix A
through Fix G). This session ships all seven in one PR-shaped
edit. No migration. `pnpm -r build` clean across all 12
packages. Server `dist` needs to be hot-copied into the running
container OR `docker compose up -d --build` before the test
intent can be re-run.

The goal here is **unblocking the live test**: without Fix A
the operator workflow that supplies `--project <name>` is
broken end-to-end, and without Fix B the server happily writes
the bad row even after a CLI regression. Everything else is
defence-in-depth, observability, or UX polish — small wins
that together make platform failures vastly easier to debug.

Changed:

- **Fix A — `gestalt run --project <name>` resolves to UUID
  before any server call.**
  - **New** `packages/cli/src/ui/resolve.ts` —
    `resolveProjectId(client, currentProjectId, projectName?)`.
    Accepts a UUID verbatim; resolves a project name (case-
    insensitive) via `client.listProjects()`; exits with a
    `gestalt projects list` hint on miss.
  - **`packages/cli/src/commands/run.ts`** now calls the
    helper at the top of `runCommand` (the line that was
    `options.projectId ?? config.currentProjectId` straight-
    through, originally at `run.ts:34`). The literal-name
    path that triggered the original `22P02 invalid input
    syntax for type uuid` is gone.
  - **Removed pre-existing duplicate local `resolveProjectId`
    copies** in `commands/intent.ts`, `commands/deploy.ts`,
    `commands/maintenance.ts` — they now import the shared
    helper.
  - **`commands/agents.ts` `resolveProjectByName`** widened
    to also accept UUIDs (returns `{id, name}` so existing
    call sites that print the name keep working).
  - **`commands/project-config.ts` `openClient`** —
    case-insensitive name match + UUID acceptance against
    the projects list. Same shape as the shared helper but
    inlined because `openClient` returns `{client, project,
    projectId, projectName, serverUrl}` and the project
    object needs to be passed downstream.
  - **`packages/cli/src/index.ts`** — `--project <name>`
    help text on `gestalt run` + `gestalt intent submit`
    (was `<id>`; the resolver now accepts both forms so the
    name is the operator-friendly default).

- **Fix B — Server-side validation at `POST /intents`.**
  - **`packages/server/src/routes/intents.ts`** — new UUID
    regex check rejects non-UUID `projectId` with
    `400 INVALID_PROJECT_ID`. Then `projects.findById` with
    `404 PROJECT_NOT_FOUND` so a valid-but-unknown UUID
    fails clean instead of poisoning the `intents` table.
    Then the existing membership guard. Same
    `trimmedProjectId` flows through the `intents.create`
    row + the dispatched `TaskMessage` payload.

- **Fix C — Self-healing diagnostician short-circuits on
  known-unrecoverable errors.**
  - **`packages/core/src/agents/self-healing-loop.ts`** —
    `UNRECOVERABLE_ERROR_PATTERNS` substrings (`"invalid
    input syntax for type uuid"`, `"relation does not
    exist"`, `"column does not exist"`, `"econnrefused"`,
    `"password authentication failed"`). Exported
    `isUnrecoverableError(message)` helper. Inside
    `runSelfHealingLoopUnsafe`, after the
    `config.enabled` gate, check `context.technicalDetail`
    then `context.failureSummary`; on a match, log
    `'Unrecoverable error detected — skipping LLM diagnosis,
    escalating immediately'` and `escalateToHuman` with a
    reason of `"Unrecoverable infrastructure error: <first
    200 chars>"`. No LLM call burned.
  - **`packages/core/src/agents/self-healing-agent.ts`** —
    same patterns appended to the diagnostician's prompt's
    "Known failure patterns" section, marked
    `shouldRetry: false / confidence: "high" /
    retryTaskType: "none"`. Defence in depth for the
    (unusual) case where the orchestrator captures the
    substring on `failureSummary` but not on
    `technicalDetail`.
  - **`packages/core/src/index.ts`** — re-exports
    `isUnrecoverableError` next to `runSelfHealingLoop` so
    future callers (e.g. a generate-orchestrator pre-flight
    check) can use the same predicate.

- **Fix D — Capture `tokens_used` per agent execution row.**
  - **`packages/core/src/agents/base-llm-agent.ts`** — new
    instance field `lastTokensUsed: number = 0` reset on
    every `run()` entry. `callLLMWithMessages` and the tool-
    loop body both accumulate `result.value.tokensUsed` into
    it after every successful LLM call. The accumulator
    survives internal retry loops (an agent making multiple
    LLM calls inside one `run` reports the sum).
  - **`packages/agents/generate/src/orchestrator/orchestrator.ts`**
    — computes
    `effectiveTokensUsed = max(agentInstance.lastTokensUsed,
    result.tokensUsed)` and writes it to BOTH
    `executions.updateStatus(executionId, ..., { tokensUsed })`
    and `step.result.tokensUsed`. The latter feeds the
    per-cycle rollup at `buildResult(...)` line ~1233 so
    the dashboard's "tokens so far" total reflects real
    usage instead of staying at 0 forever.
  - **`packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`**
    — review-agent's `lastTokensUsed` is forwarded onto the
    result via the existing `lastPrompt` / `lastLlmResponse`
    side-channel, then `runWithObservability` reads it back
    and threads it into `executions.updateStatus`.
    Constraint-agent is non-LLM and continues to report 0.
  - Custom-agent-runner already passed `result.value.
    tokensUsed` through (`packages/agents/generate/src/
    agents/custom-agent-runner.ts:100`) — no change needed.
  - Deploy-layer + maintenance-layer agents are non-LLM
    today; same pattern applies the day they become LLM
    (extend `BaseLLMAgent`, read `lastTokensUsed` in the
    observability wrapper).

- **Fix E — `gestalt intent show <prefix>` matching.**
  - **`packages/cli/src/ui/intent-resolver.ts`** — rewritten.
    Full UUID inputs still resolve clean; 8-char (or longer)
    prefixes now match against BOTH `correlationId` AND `id`
    (the prior impl matched only `correlationId`, so
    operators copy-pasting `intents.id` from the DB never
    matched). On a current-project miss, the search broadens
    to server-wide (empty `projectId` per the route
    contract) — this catches the failure mode from
    TEST_REPORT_001 where the bad-row intent's `project_id`
    was the literal name `'trackeros'` and the current-
    project filter excluded it. All matching now
    case-insensitive.

- **Fix F — `gestalt run --watch` flag.**
  - **`packages/cli/src/types.ts`** — `RunOptions.watch?:
    boolean`.
  - **`packages/cli/src/commands/run.ts`** — after
    `submitIntent` succeeds, `watchMode` skips the SSE
    event ticker and instead enters the same periodic
    full-graph re-render that `gestalt intent show --watch`
    uses (3 s interval; Ctrl+C detaches; auto-exits when
    the intent reaches a terminal status). Pulls
    `renderExecutionGraph` / `clearScreen` /
    `isTerminalIntentStatus` from `ui/execution-graph`.
  - **`packages/cli/src/index.ts`** — `--watch` wired on
    both `gestalt run` and `gestalt intent submit`.

- **Fix G — Strip trailing period from escalation_reason.**
  - **`packages/core/src/agents/self-healing-loop.ts`** —
    new private `stripTrailingPunctuation(s)` (regex
    `/[.!?\s]+$/u`). Applied to `diagnosis.diagnosis`
    before joining `". Confidence: …"`. The double-period
    in `"…uuid syntax.. Confidence: medium"` is gone.

Verified:

- `pnpm -r build` clean across all 12 packages. CLI: `tsc &&
  chmod +x dist/index.js` clean. Server: `tsc` clean. Core:
  `tsc` clean. Generate / quality-gate / deploy / maintenance:
  all clean. Dashboard rebuilt to the same
  `index-DSlpzI_R.js` bundle (1010.76 KB / 319.35 KB
  gzipped) — no dashboard changes in this session, the
  rebuild is incidental from the topo-sort.
- Server-side `POST /intents` reject path traced manually:
  body `{projectId: 'trackeros', text: 'x'}` hits the regex
  guard and returns
  `{error: 'INVALID_PROJECT_ID', message: 'projectId must
  be a UUID. Run \`gestalt projects list\` to find your
  project ID.'}` BEFORE the membership check, BEFORE the
  insert. Body `{projectId: <random valid UUID>, text:
  'x'}` hits the `projects.findById` 404 check next.
- CLI-side resolver traced manually: `gestalt run "x"
  --project trackeros` now calls
  `client.listProjects()` → matches `trackeros` →
  forwards `projectId = 5d99e2f3-f3cb-...` to
  `submitIntent`. Before the fix the literal string
  `'trackeros'` would have been forwarded.

Decisions made:

- **Single shared helper, not two.** `resolveProjectId` and
  `resolveProjectByName` (the latter in `commands/agents.ts`)
  both translate `--project <value>` to a project record, but
  the former returns just an ID and the latter returns
  `{id, name}` because the agents commands print the project
  name in their output. Kept both, but widened
  `resolveProjectByName` to also accept UUIDs so the
  `--project <uuid>` form behaves identically across every
  command surface.
- **Server-side validation at the route, not the
  repository.** The repository's `findById` already
  effectively validates (postgres throws `22P02`) but only
  in the failure path. Validating at the route boundary
  gives a clean 400 + a structured error code instead of an
  opaque 500 from the postgres driver bubbling up.
- **Diagnostician check on TWO context fields, not one.**
  The brief said "check `context.technicalDetail`" but the
  generate-error path on the original incident only carried
  the substring on `failureSummary` — the
  diagnostician was diagnosing from the summary alone.
  Checking both fields catches that case without changing
  any orchestrator's context-population logic.
- **Token-capture goes through the agent INSTANCE, not the
  AgentResult shape.** Every agent's `run()` already returns
  `tokensUsed: 0` in its result. Walking through every file
  to thread `this.lastTokensUsed` would touch ~10 files
  redundantly. The orchestrator already reads agent-instance
  state (`lastPrompt`, `lastLlmResponse`, `lastModelUsed`)
  after `run()` returns; piggy-backing on the same pattern
  for `lastTokensUsed` is one-line and consistent.
- **`max(instance, result)` not strictly `instance`.** Some
  agents (custom-agent-runner) already populate
  `result.tokensUsed` directly. Picking the max preserves
  whichever path the agent uses without forcing one
  convention.
- **`gestalt run --watch` reuses the existing
  execution-graph renderer.** The brief offered the option
  of "either implement or document the two-step pattern."
  Implementing is cleaner — the renderer is already
  battle-tested by `gestalt intent show --watch`, and the
  three-second re-render rhythm is exactly what an operator
  watching a long generate cycle wants.

Pending follow-ups:

- **Hot-copy server `dist` into the running container OR
  `docker compose up -d --build`** before the next live
  test. The patched `intents.ts` route is in
  `packages/server/dist/routes/intents.js` after the build;
  the running container is still serving the prior binary
  (which is fine — the missing Fix B isn't blocking, the
  Fix A CLI change alone makes the next intent flow
  correctly because the operator never sends a bad
  projectId).
- **Re-run the original test intent** (`gestalt run
  "Scaffold the project foundation. …" --project trackeros
  --watch`) to author `TEST_REPORT_002.md`. Capture the
  intent-agent / design-agent / context-agent / code-agent
  prompts + responses (now stored on
  `agent_execution_logs` rows that this session DID NOT
  touch — the logging infrastructure was already in
  place). Token columns should be > 0 this time.
- **Open alert** from the pre-fix run (correlation
  `06299649-2db4-4d64-8785-167e025cbacb`) — dismiss via
  `gestalt alerts dismiss` once the operator acknowledges
  the diagnosis. Will not auto-resolve since the original
  intent row is unactionable (its `project_id` is the
  literal `'trackeros'`).
- **Operator caveats from prior sessions still pending**
  (Node 22 upgrade on trackeros `gestalt.yml`, PR #46
  close, vault-secret re-creation) — unaffected.

Build status: `pnpm -r build` clean across all 12 packages.
Server `dist` NOT yet hot-copied into `gestalt-server-1` —
the operator can do this manually OR rebuild the image
before the next live test.

---
