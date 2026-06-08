# BUILD.md — Build status + known issues

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
