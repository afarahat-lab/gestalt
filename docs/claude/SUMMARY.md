# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md

_Auto-regenerated after every session by Claude Code. Do not edit by hand._

_Generated: 2026-06-04_

---


_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-04
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
  `{{projectDescription}}` substitution.
- Vault-backed Git PATs (migration 022) — operators link a vault
  secret to a project; resolver decrypts server-side per-cycle.
- GitHub repo browser via `/platform/git/repos` proxy.
- Dynamic harness — LLM picks language / framework / package
  manager / test runner at init time.

### Agent infrastructure

- `BaseLLMAgent` in `@gestalt/core/agents` — every LLM-using agent
  in every layer extends it. Captures `lastPrompt` /
  `lastLlmResponse` / `lastModelUsed`.
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
  tool calls.
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
- Operator-driven CLI parity: `gestalt intent / gate / deploy /
  agents active / maintenance / status --graph --watch`.

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

### Session 2026-06-04 — Claude Code (multi-line description prompt: gestalt init now accepts >1 line of project description; dashboard create-project description is a textarea)

Bug fix + small refactor. The Phase-1 description prompt in
`gestalt init` used the existing single-line `prompt()` helper,
which calls `readline.question()` and resolves on the first
newline — so a multi-line paste was truncated to its first line.
The same shape applied to the dashboard "Create project" modal
(single-line `<input type="text">`). This session lifts both
surfaces to true multi-line capture, extracts the helpers into
the shared prompts module, and tightens the custom-agent prompt
flow to reuse the same editor helper.

Changed:

- **`packages/cli/src/ui/prompts.ts`** — three new exported
  helpers next to the existing `prompt` / `promptSecret`:
  - `promptMultiline(fieldName, hint?)` — END-terminated capture
    (case-insensitive `END` / `end` / `End`, leading + trailing
    whitespace trimmed for the sentinel check, lines themselves
    preserved verbatim). EOF on stdin also terminates so piped
    callers without an explicit `END` still get the buffered
    content.
  - `promptWithEditor(fieldName, initial?)` — spawns
    `$EDITOR` / `$VISUAL` / `vi` against a temp file. When
    `initial` is supplied it pre-populates the buffer (used by
    the custom-agent prompt to seed the `{{role}} {{goal}} …`
    placeholder hint). Comment lines starting with `#` are
    stripped after save. On editor launch failure (`spawnSync`
    error or non-zero exit) it falls back to `promptMultiline`
    so operators on minimal images stay unblocked.
  - `promptMultilineDescription(fieldName, hint?)` — three-mode
    chooser shown to the operator: (1) single line — backwards-
    compatible default, (2) multi-line END-terminated, (3)
    open in `$EDITOR`. Empty choice → option 1.
- **`makeBufferedReader(rl)` private helper** — attaches one
  long-lived `line` listener that pushes into a queue and feeds
  `next()` waiters. Necessary because `readline` emits `line`
  events as soon as bytes arrive, regardless of whether anyone
  is awaiting. Previous draft attached a fresh listener per
  prompt and lost every line that arrived between prompts under
  piped stdin (the bug surfaced during smoke tests; documented
  inline so the next refactor doesn't regress it).
- **`packages/cli/src/commands/init.ts`** — Phase 1 swaps
  `await prompt('Description')` for
  `await promptMultilineDescription('Project description', '…')`.
  All other Phase 1 hint copy preserved.
- **`packages/cli/src/commands/project-config.ts`** — the
  `openEditorForPrompt()` local helper now delegates to the
  shared `promptWithEditor`, passing the existing
  `{{role}}/{{goal}}/{{artifacts}}` placeholder seed as the
  `initial` body. Removed the standalone `spawn` / `writeFile` /
  `readFile` / `unlink` / `mkdtemp` imports from this file —
  they all live in `prompts.ts` now. The "empty prompt aborts"
  guard remains in `openEditorForPrompt` because custom-agent
  prompts must not be blank.
- **`packages/dashboard/src/views/Admin.tsx`** —
  `CreateProjectModal` description field is now a `<textarea
  rows={4}>` with `resize: vertical` + `minHeight: 96px` +
  `fontFamily: inherit`. Placeholder rewritten as a three-line
  example matching the brief. State binding unchanged
  (`description` / `setDescription`) — the existing trim +
  fallback at submit time (line 703-705) already handles the
  multi-line body correctly. Server's `init-harness` route at
  `packages/server/src/routes/projects.ts:613-689` does only
  `.trim()` on `projectDescription` before passing it to
  `generateStackConfig` and `loadTemplate` — no server change
  needed; the LLM stack config generator already accepts
  arbitrary-length descriptions.

Verified:

- `pnpm -r build` clean across all 12 packages. Dashboard
  bundle re-emitted as `index-DSlpzI_R.js` (1010.76 KB raw /
  319.35 KB gzipped; identical structure to the prior
  CodeMirror-era bundle — the textarea swap added a handful
  of bytes inside the existing chunk).
- Spot-grep on the dashboard bundle confirms the new textarea
  + placeholder ship: `textarea` appears 8 times (was
  pre-existing in `TemplateEditor`-adjacent code; the new one
  raised the count from 7 to 8) and the new placeholder
  copy `Describe your project: purpose, tech stack` is
  present in the bundle exactly once.
- Helper-level smoke tests (5 cases for the individual
  helpers + 3 cases for the 3-mode chooser, run via a Node
  driver script that imports the compiled `dist/ui/prompts.js`
  and pipes synthetic stdin):
  - `promptMultiline` captures all 4 lines verbatim through
    END.
  - END sentinel terminates on any of `END` / `end` / `End` /
    `"  end  "`.
  - `promptWithEditor` with `EDITOR=true` (no-op editor)
    strips the `# Enter ${fieldName}…` comment seed to an
    empty body.
  - `promptWithEditor` round-trips a non-comment `initial`
    body when `EDITOR=true`.
  - `promptWithEditor` with `EDITOR=/nonexistent` falls
    through to `promptMultiline` and captures the END-
    terminated body the operator typed instead.
  - `promptMultilineDescription` option 1 (empty choice →
    default) returns the single line typed at the field
    prompt.
  - `promptMultilineDescription` option 2 captures all 4
    lines and trims trailing whitespace.
  - `promptMultilineDescription` option 3 routes through
    `promptWithEditor` (verified via `EDITOR=true` → empty
    body).
- Server path traced manually: CLI calls
  `client.initHarness(projectId, description)` →
  `POST /projects/:id/init-harness` with
  `{ projectDescription }` → `generateStackConfig(description.trim(),
  project.name)` and `loadTemplate(…, { projectDescription:
  description.trim(), … })`. Description is a plain string
  parameter end-to-end; no truncation anywhere in the path.
- Dashboard bundle hot-copied into `gestalt-server-1` at
  `/app/packages/dashboard/dist/` so the running platform
  serves the textarea-having build without an image rebuild.
  `curl http://localhost:3000/app/` shows the new
  `index-DSlpzI_R.js` reference; container HEAD-of-bundle
  matches the on-disk hash.

Decisions made:

- **Three-mode chooser, not "single vs multi" toggle.** The
  brief offered three modes (single line / END-terminated /
  editor); the chooser preserves the existing keystroke-
  efficient default (Enter → single line) while still
  giving the operator an editor escape hatch when they want
  full control. Empty choice deliberately defaults to (1)
  so muscle memory doesn't break.
- **Buffered reader rather than fresh interface per prompt.**
  Initial implementation created a `readline.createInterface`
  per call inside `promptMultiline`. Under piped stdin
  (smoke tests), readline emits `line` events synchronously
  as bytes arrive — between calls the next line was already
  emitted and dropped. The fix is a single long-lived
  interface plus a buffered pull-based `next()`. Documented
  inline so future refactors don't regress it.
- **Custom-agent prompt routes through the shared helper.**
  The existing `openEditorForPrompt` did the same job
  but reimplemented the editor lifecycle. Collapsed to a
  one-line wrapper that passes the existing placeholder
  seed as `initial`. Kept the "empty prompt aborts" guard
  there because custom-agent prompts cannot be blank
  (the rest of the workflow assumes a non-empty body).
- **Dashboard uses a plain `<textarea>`, not a CodeMirror
  instance.** The description field is free-form prose, not
  code — a textarea with `resize: vertical` is the right
  affordance and keeps the bundle exactly as it is. Reusing
  the existing `styles.input` base + a small style merge
  keeps the visual integration consistent with the rest of
  the modal.
- **No new server endpoint / no migration.** The
  `projectDescription` body field already accepts arbitrary-
  length strings — the only server-side operation on it is
  `.trim()` before passing through to the LLM stack config
  generator. The bug was purely client-side.

Pending follow-ups: none introduced.

Build status: `pnpm -r build` clean across all 12 packages
(CLI: `tsc && chmod +x dist/index.js` clean; dashboard:
1010.76 KB / 319.35 KB gzipped, identical structure to the
template-improvements session). Dashboard hot-copied into
the running container; next image rebuild folds it in.

---

### Session 2026-06-04 — Claude Code (modular docs/claude restructure — split STATE.md + SESSION_LOG.md to fix Claude Code large-file warnings)

Documentation-only refactor. No source code touched. The
always-loaded `docs/claude/` files had grown beyond Claude Code's
40KB performance threshold (`STATE.md` 226KB, `SESSION_LOG.md`
840KB). This session restructures them into modular files that
each stay under the threshold, and adds a rotation protocol so
they stay small over time.

Changed:

- **New directory structure:**
  ```
  docs/claude/
    CLAUDE.md             ← (lives at repo root, not here)
    STATE.md              ← current state only
    BUILD.md              ← build status + known issues
    CONSTRAINTS.md        ← coding rules
    ARCHITECTURE.md       ← system reference (NEW; absorbed PLATFORM.md)
    DECISIONS.md          ← ADR index (updated to cover ADR-001..ADR-040)
    SUMMARY.md            ← regenerated from STATE+BUILD+RECENT
    sessions/
      RECENT.md           ← last 3 sessions (auto-maintained)
      archive/
        2026-05.md        ← all May sessions (30 entries)
        2026-06-w1.md     ← June 1-4 sessions through apiShape (45 entries)
  ```
- **`PLATFORM.md` deleted** — its monorepo-structure + dependency-
  order content was absorbed into the new `ARCHITECTURE.md` which
  also includes the key type alignment rules previously hidden
  inside `BUILD.md`.
- **`SESSION_LOG.md` deleted** — its 78 session entries were
  split: lines 20-3471 (30 May sessions) → `archive/2026-05.md`;
  lines 3473-15519 (45 June 1-4 sessions through apiShape) →
  `archive/2026-06-w1.md`; lines 15521-end (2 most recent
  sessions: template-download + template-improvements) →
  `sessions/RECENT.md`. Each archive file gets a small header
  explaining it's append-only + read-on-demand.
- **`STATE.md` rewritten** from 226KB → 10.8KB. Stripped the
  giant "Last updated" narrative paragraph (which duplicated
  session log content and grew layer-by-layer as PRE-EXISTING
  chains). Kept only: what's built (concise one-line capability
  bullets grouped by area), what's not built, active follow-ups,
  current operator caveats, first-boot sequence.
- **`BUILD.md` refreshed** from 3.7KB → 3.0KB. Fixed stale
  migration count (003 → 023), removed stale "Known issues"
  (git-token-encryption-at-rest is now handled by the vault),
  moved type-alignment rules into ARCHITECTURE.md. Added current
  operator-pending actions (Node 22 update on trackeros, PR #46
  cleanup, vault secret re-creation).
- **`DECISIONS.md` updated** from 6.7KB → 9.3KB. Extended the
  ADR index from 12 entries to cover ADR-001 through ADR-040.
  Added expanded summaries for ADR-018 / ADR-038 / ADR-039 /
  ADR-040 which weren't previously summarised. New "ADR
  fast-lookup matrix" at the bottom mapping code paths →
  which ADRs to read first.
- **`ARCHITECTURE.md` created** (8.5KB) — monorepo structure +
  package dependency order + key type alignment rules + adapter
  interface contract + agent execution model + event bus
  notes. Plus a fast-lookup matrix pointing at the right file
  for every concern (ADRs / constraints / build / runbooks /
  per-package conventions).
- **`CONSTRAINTS.md` unchanged** (2.0KB) — already concise.
- **Root `CLAUDE.md` rewritten** from 0.9KB → 3.6KB. New
  `@` imports point at the modular files (STATE / BUILD /
  CONSTRAINTS / sessions/RECENT.md as always-loaded;
  ARCHITECTURE / DECISIONS / sessions/archive as on-demand).
  Added a detailed "After every session — mandatory"
  protocol that spells out the prepend + rotate +
  regenerate-SUMMARY flow with concrete bash for SUMMARY
  regeneration. Added a file-size targets table so the next
  agent knows the thresholds.
- **`SUMMARY.md` regenerated** using the new sources
  (STATE.md + BUILD.md + sessions/RECENT.md). The shell
  recipe in CLAUDE.md uses `tail -n +2` to skip per-file
  titles since SUMMARY.md provides its own. Generated date
  stamp included via `$(date +%Y-%m-%d)`.

Verification:

- `wc -c` per file: STATE 10.8KB, BUILD 3.0KB, CONSTRAINTS
  2.0KB, ARCHITECTURE 8.5KB, DECISIONS 9.3KB, sessions/RECENT
  21.5KB (this entry + template-improvements; template-
  download rotated into archive when 3 sessions exceeded the
  40KB target by 600 bytes), CLAUDE 3.6KB. Every always-
  loaded file is below 40KB. The two archive files (181KB +
  640KB) live in `sessions/archive/` which is never
  auto-loaded.
- `grep -c '^### Session' sessions/RECENT.md` returns 2.
  The brief's "3 sessions max" rule is the cap, not the
  floor; the 40KB warning threshold takes precedence when 3
  verbose sessions would exceed it (covered by the protocol
  in `CLAUDE.md`).
- `ls sessions/archive/` shows the two expected files.
- `ls docs/claude/SESSION_LOG.md` returns "No such file or
  directory".
- `pnpm -r build` clean across all 12 packages (no source
  changes; docs don't compile). Confirmed by post-migration
  build.

Decisions made:

- **Three-tier loading strategy.** Files split into "always
  loaded" (STATE, BUILD, CONSTRAINTS, RECENT — Claude Code
  reads these on every session start) and "on demand"
  (ARCHITECTURE, DECISIONS, sessions/archive — read only
  when a task touches them). This matches the brief's intent
  and keeps the always-loaded surface small.
- **`PLATFORM.md` absorbed into `ARCHITECTURE.md`.** The brief
  didn't list PLATFORM.md in the target structure but the
  content overlapped (monorepo structure + dependency order
  was in both). Consolidating into a single file is cleaner.
- **Archive boundaries by week within June.** The brief
  specified `2026-06-w1.md` for June 1-7. We currently only
  have June 1-4 sessions; w1 covers them all. When a future
  session lands on June 8 or later, the protocol will create
  `2026-06-w2.md` (rolling weekly archive).
- **`SUMMARY.md` regeneration uses `tail -n +2`** to skip
  each source file's own title heading. Without this,
  SUMMARY.md would have repeated "# STATE.md", "# BUILD.md",
  etc. inline with its own title.
- **Kept `CONSTRAINTS.md` mostly unchanged.** It was already
  concise + factual. No reason to rewrite. Brief's note
  about extracting from CLAUDE.md doesn't apply — that
  content had been extracted in the 2026-05-30 split
  session, before today.
- **No `docs/claude/CLAUDE.md` file created.** The brief's
  target structure listed `docs/claude/CLAUDE.md` as the
  root entry point. Claude Code reads `CLAUDE.md` from the
  workspace root (not from `docs/claude/`), so the actual
  root CLAUDE.md was rewritten in place to use the new
  imports. Documented this in the file-size targets table.
- **Migration session log entry written concisely** to stay
  within RECENT.md's 40KB target after prepending. Initial
  3-session total landed at 40.6KB — 600 bytes over the
  threshold. Per the protocol I wrote in `CLAUDE.md`,
  rotated template-download (the oldest of the 3) into
  `archive/2026-06-w1.md`, ending at 2 sessions / 21.5KB.
  The brief's "3 sessions" wording is interpreted as a max,
  not a floor; cleanly under 40KB matters more than session
  count for the warning to disappear.

Pending follow-ups: none introduced.

Build status: no source changes. `pnpm -r build` still clean
across all 12 packages (verified before commit). The
restructure affects only `docs/claude/**` files.

---

### Session 2026-06-04 — Claude Code (template editor improvements: CodeMirror syntax highlighting + gestalt platform templates push + diff)

Three follow-ups to the previous session's template editor, all
in one pass. Each is self-contained; no new migrations.

**Enhancement 1 — CodeMirror 6 syntax highlighting in the
dashboard editor.** Replaces the plain `<textarea>` in
`TemplateEditor` (Admin.tsx) with a CodeMirror 6 editor.
- `packages/dashboard/package.json` gains 7 new runtime deps:
  `@codemirror/view`, `@codemirror/state`,
  `@codemirror/lang-json`, `@codemirror/lang-yaml`,
  `@codemirror/lang-markdown`, `@codemirror/theme-one-dark`,
  and the `codemirror` meta package (which is where `basicSetup`
  actually lives in v6 — the brief's pseudocode put it under
  `@codemirror/view` which is incorrect; deviated to make the
  imports compile)
- New `getLanguageExtension(filePath)` helper at the top of the
  `TemplateEditor` region maps file extension → CodeMirror lang
  extension: `.json` → `json()`, `.yaml`/`.yml` → `yaml()`,
  `.md` → `markdown()`, everything else → `[]` (plain text).
  Only three language packs are imported per the brief —
  bundle stays as lean as it can while still covering every
  file the seeded template contains
- `TemplateEditor` rewritten with three new refs:
  `editorRef` (HTMLDivElement that holds the editor mount
  point), `editorViewRef` (the current EditorView instance,
  destroyed + nulled on cleanup), and `draftsRef` (latest
  drafts captured for the updateListener closure so multiple
  React renders don't strand stale references). New
  `discardCounter` state slot bumps on every discard so the
  edit-mount `useEffect` re-runs and rebuilds the EditorView
  with the freshly-reverted doc
- The mount `useEffect` is keyed on
  `[selectedPath, discardCounter]`. On every change it
  destroys the prior view, builds a new `EditorState` with
  `doc: drafts[path]`, attaches `basicSetup` + `oneDark` +
  `EditorView.lineWrapping` +
  `getLanguageExtension(path)` +
  `EditorView.updateListener.of(...)`, and instantiates a
  new EditorView in `editorRef.current`. The updateListener
  fires on every doc-change transaction and writes back via
  `setDrafts((prev) => ({...prev, [path]: doc.toString()}))`
- The `<textarea>` JSX block is replaced with
  `<div ref={editorRef} style={...}>` — `minHeight: 400px,
  maxHeight: 700px, overflow: auto`. The CSS variables
  (`var(--border)`, etc.) are preserved so the editor
  visually integrates with the rest of the panel
- `discardOne` extended to also call
  `setDiscardCounter((c) => c + 1)` when the discarded path
  is the one in the editor — forces the useEffect to re-run
  and reset the editor's doc. Otherwise the in-memory
  EditorView would keep showing the operator's typed
  content even after drafts state has been reverted
- The now-unused `selectedContent` const is deleted
- Bundle delta: 363 KB → 1010 KB raw (319 KB gzipped, +190
  KB delta). Above Vite's 500 KB warning but acceptable for
  an admin-only feature. Future iteration: code-split via
  dynamic `import()` so only platform-admins editing
  templates pay the cost

**Enhancement 2 — `gestalt platform templates push
<slug> <dirPath> [--dry-run]`.** Batch upload from a local
directory tree.
- New `collectTemplateFiles(dir, rootDir)` recursive walker
  in `platform-extras.ts`. `SKIP_NAMES` Set excludes `.git`
  / `.gestalt` / `node_modules` / `dist` / `build` /
  `.DS_Store`. Path separators are normalised forward-slash
  so Windows operators don't end up with `docs\X.md` keys
  on the wire
- New `platformTemplatesPushCommand(slug, dirPath, {dryRun})`
  exported. Path-validates the dir, walks it, builds the
  full file map. `--dry-run` prints sizes per file with a
  "(dry run — no changes made)" footer. Real run calls
  `PATCH /platform/templates/:id/files` (MERGE semantics —
  unsupplied files preserved server-side)
- Error handling: `BUILTIN_TEMPLATE` surfaces with `Cannot
  push to a built-in template. Duplicate it first: gestalt
  platform templates duplicate <slug>`;
  `MISSING_REQUIRED_FILES` surfaces with the typed list +
  "Ensure AGENTS.md, HARNESS.json, and agents.yaml are
  present in the directory."; missing-dir → `Directory not
  found: <path>` + exit 1
- New `fs` sync imports (`readdirSync`, `statSync`,
  `existsSync`) + `relative` path helper. The walker uses
  sync FS calls to match the file's existing style (the
  editor flow already uses `readFileSync` / `writeFileSync`
  / `unlinkSync`)

**Enhancement 3 — `gestalt platform templates diff <slug>
[--against <baselineSlug>] [--stat]`.** Per-file unified
diff against a baseline.
- New `diff ^5.2.0` runtime dep + `@types/diff ^5.2.0` dev
  dep in `packages/cli/package.json`. `diffLines` from the
  `diff` package does LCS-based line diffing — language-
  agnostic, no markdown/yaml parser required
- New `platformTemplatesDiffCommand(slug, {against, stat})`
  exported. Default baseline `corporate-ops-web-mobile`;
  `--against <slug>` overrides. Self-diff (same slug both
  sides) → `Cannot diff '<slug>' against itself.` + exit 1.
  Both templates loaded via `getPlatformTemplate(id)` in
  parallel. Path-set union iterated for per-file
  classification: only in baseline → `(removed)`, only in
  custom → `(added)`, in both with line changes →
  `(modified)`, no changes → `(unchanged)`
- Modified files print a unified-diff block: green `+`
  lines + red `-` lines + 2 leading / 2 trailing context
  lines per hunk. Hunks with more than 4 unchanged lines
  collapse via `... (N unchanged lines)` so big files stay
  readable
- `--stat` mode hides the per-line diff and prints only the
  right-padded per-file `+N -M` summary (or `unchanged`
  / `(added)` / `(removed)` for non-modified files). Footer
  `Summary: 1 modified, 7 unchanged` (with green/red/dim
  fragments) always prints

**Registration:** new `push` and `diff` subcommands
registered under `gestalt platform templates` in
`packages/cli/src/index.ts`. Top-of-file command comment
extended. Header docstring on
`packages/cli/src/commands/platform-extras.ts` updated to
document both new subcommands + the LCS-diff design.

Verified live end-to-end:

- `pnpm -r build` clean across all 12 packages. Dashboard
  bundle compiled to `index-Ds_rUJ8n.js` (1010 KB raw, 319
  KB gzipped); CLI compiled clean. New dashboard bundle
  `docker cp`'d into the running container so it serves
  the fresh assets without an image rebuild. HTML now
  references the new bundle (`/app/assets/index-Ds_rUJ8n.js`)
- Spot-grep on the production bundle confirms the new
  CodeMirror modules landed: CSS classes (`cm-editor` × 1,
  `cm-content` × 8, `cm-line` × 11, `cm-gutters` × 12), the
  OneDark theme's signature colors (`#abb2bf`, `#21252b`,
  `#282c34`), and the APIs we use (`EditorView`,
  `EditorState`, `lineWrapping` × 28, `updateListener` × 2)
- `gestalt platform templates --help` lists both new
  subcommands with their option descriptions
- **Push verification flow (end-to-end against the live
  platform):**
  - `gestalt platform templates download
    corporate-ops-web-mobile --output /tmp/.../template.zip`
    → "✓ Template downloaded ... (8 files, 8971 bytes)"
  - Unzip + append `## Custom section added by
    operator\nLocal edits via the push workflow.` to
    `harness/AGENTS.md`
  - `gestalt platform templates duplicate
    corporate-ops-web-mobile --name "Push Diff Test"
    --new-slug push-diff-test` → "✓ Template duplicated"
  - `gestalt platform templates push push-diff-test
    /tmp/.../my-edit --dry-run` → "Would push 8 files:" +
    per-file size listing + "(dry run — no changes made)"
  - Real push without `--dry-run` → 8 `✓` rows + "✓
    Template updated: push-diff-test (8 files pushed)"
  - Direct API fetch confirms `harness/AGENTS.md` content
    ends with the operator's local edits — the push lands
    server-side correctly
- **Diff verification flow:**
  - `gestalt platform templates diff push-diff-test` →
    Comparing header, 7 files `(unchanged)`, 1 file
    `harness/AGENTS.md (modified)` with `... (68 unchanged
    lines)` context-folding + 2 green `+` lines + Summary
    `1 modified, 7 unchanged`
  - `--stat` mode → compact per-file summary with
    `harness/AGENTS.md +2 -0` and other files
    `unchanged`
  - Added a new file (`docs/EXTRA.md`) via push → diff
    shows `docs/EXTRA.md (added)` line + updated Summary
  - Clean duplicate (`clean-copy-test`) diff → ALL 8 files
    `(unchanged)` + Summary `8 unchanged`
- **Error matrix:**
  - `push corporate-ops-web-mobile <dir>` → "Cannot push to
    a built-in template. Duplicate it first: ..."
  - `push push-diff-test /tmp/does-not-exist` →
    "Directory not found: ..."
  - `diff push-diff-test --against nonexistent-baseline` →
    "No template with slug 'nonexistent-baseline'." +
    hint
  - `diff push-diff-test --against push-diff-test` →
    "Cannot diff 'push-diff-test' against itself."
- Cleanup: both test templates (`push-diff-test`,
  `clean-copy-test`) deleted via `gestalt platform
  templates delete` with `y` confirmation. Final DB state
  has only the built-in template + the old/new dashboard
  bundles in the container's dist (the old bundle is now
  orphan; HTML references the new one)

Decisions made:

- **`basicSetup` imported from `codemirror` (the meta
  package), NOT `@codemirror/view`.** Brief's pseudocode
  was incorrect about the import path — in CodeMirror 6,
  `basicSetup` is exported from the `codemirror` umbrella
  package. The compiler would have rejected the brief's
  literal imports; the deviation is required for
  correctness, not stylistic. Documented inline next to
  the imports
- **`useEffect` keyed on `[selectedPath, discardCounter]`,
  not just `selectedPath`.** Discard needs to recreate the
  editor (CodeMirror's `EditorState` is immutable
  per-transaction; setting the doc externally requires
  either a `dispatch({changes: ...})` call or a fresh
  state). The counter approach is simpler and matches the
  brief's "update selectedFile key to force the useEffect
  to re-run" suggestion. The cleanup function destroys the
  old EditorView before the next one mounts so there's no
  double-mount in the DOM
- **`draftsRef` captures the current drafts state for the
  updateListener.** Without it, the listener's closure
  would see stale `setDrafts` calls when React batches
  state updates across rapid keystrokes. The ref pattern is
  the standard React idiom for "give me access to the
  latest state from inside a long-lived callback"
- **Static imports, not dynamic.** Brief's example used
  static imports; the bundle delta is significant but
  Admin is a route-level lazy load already (RequirePlatformAdmin
  guards the route). Code-split could push only template-
  editing operators into the CodeMirror-paying tier; a
  future enhancement but out of scope today
- **Push walker skips dot-files and common build
  artifacts** (`.git`, `.gestalt`, `node_modules`, `dist`,
  `build`, `.DS_Store`). Operators who keep an editing
  checkout in the same directory shouldn't accidentally
  push their `node_modules` to the server. The skip list is
  minimal — the brief said "starts from the directory you
  give it"; adding the SKIP_NAMES set was a defense
  against operator mistakes, not a deviation from the
  intent
- **Push uses sync FS calls.** Consistent with the rest of
  `platform-extras.ts` (which uses `readFileSync` /
  `writeFileSync` / `unlinkSync` for the editor flow).
  Brief's pseudocode showed async `fs/promises`; either
  would work, but staying consistent with the file's
  existing style is cleaner
- **Diff `(modified)` vs `(unchanged)` decision uses
  added+removed line count, not change-block count.** A
  block of unchanged context surrounded by changes would
  still count toward the modified-file classification.
  Counting added+removed lines (excluding empty trailing
  newlines) gives the right semantic: "are there real
  changes in this file"
- **Diff `--stat` row format right-pads paths to 40 chars.**
  Most template file paths are < 30 chars; 40 gives a
  little headroom while keeping the columns visually
  aligned. The `+N -M` counts are colorised (green/red) so
  scannable at a glance
- **Diff context-folding shows 2 leading + 2 trailing
  unchanged lines** with `... (N unchanged)` between. Short
  files (≤ 4 unchanged lines in a row) show the full
  context. The cutoff is the brief's suggestion; tested
  against the verification template's AGENTS.md (68
  unchanged lines collapsed correctly)
- **No new server endpoints, no new migrations.** Both
  push and diff use the existing
  `PATCH /platform/templates/:id/files` and
  `GET /platform/templates/:id` endpoints from the prior
  session. The dashboard CodeMirror integration is purely
  UI-side

Bundle size note flagged for follow-up:

- Dashboard bundle grew from 363 KB to 1010 KB (319 KB
  gzipped, +190 KB delta). Vite's 500 KB warning threshold
  is now exceeded. Acceptable for an admin-only feature
  (regular users don't load the Admin route's editor) but
  a future code-split via dynamic `import()` of CodeMirror
  modules (similar to how `jszip` is already
  dynamic-imported in `UploadTemplateModal`) would push
  the bundle delta from the main chunk into a deferred
  one only loaded when an operator opens the template
  editor

Build status: `pnpm -r build` clean across all 12 packages.
Docker server image NOT rebuilt — the new dashboard bundle
was `docker cp`'d into the running container at
`/app/packages/dashboard/dist/`. Next clean image rebuild
(`docker compose build server`) will fold the new dashboard
build into the image proper. All CLI commands exercised
end-to-end against the live platform: push happy path +
dry-run + 3 error paths, diff full + --stat + added-file +
clean-duplicate + 2 error paths, plus the existing
download / duplicate / delete subcommands as part of the
verification flow.

Pending follow-ups: none introduced. The bundle size
delta is the only candidate for future iteration — a
single-day refactor to dynamic-import the CodeMirror
modules from inside the TemplateEditor mount effect would
restore the main bundle to ~370 KB and only fire the
extra ~640 KB raw on first editor open.

