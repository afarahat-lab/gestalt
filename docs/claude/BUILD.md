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
- **TR_016 gate agents on gpt-4o; first clean deploy
  since TR_007.** trackeros `agents.yaml` (commit
  `9830241` on `main`) sets `constraint-agent` and
  `review-agent` to `model: gpt-4o`, `temperature: 0.0`.
  Platform `PER_ROLE_DEFAULTS['review-agent'].temperature`
  lowered 0.1 → 0.0. Single-round verification cycle
  deployed cleanly with zero signals from either gate
  agent. ~$0.046 USD (single round at gpt-4o beats 8
  rounds at gpt-4o-mini). **Surprise:** review-agent is
  gpt-4o; constraint-agent is still gpt-4o-mini because
  `constraint-agent.ts:64` uses a hardcoded `AGENT_CONFIG`
  constant and never calls `loadAgentConfig`. New
  HIGHEST follow-up.
- **HIGHEST follow-up — TR_016:** Fix
  constraint-agent's hardcoded `AGENT_CONFIG` — replicate
  review-agent's `loadAgentConfig` pattern so operators
  can actually configure both gate agents the same way.
- **HIGH follow-up — TR_016:** Re-verify on a second
  intent shape (sample size is one).
- **TR_015 Approach A — explicit repository-pattern rule
  wording applied** (no platform code change). trackeros
  HARNESS.json (commit `ce0c01e` on `main`) and the
  `corporate-ops-web-mobile` template (version `0.3.1` →
  `0.4.0`) carry the new wording. Server boot log confirms
  template refresh: *"Refreshed built-in template (version
  bump) — previousVersion 0.3.1, version 0.4.0"*. Live
  verification: gpt-4o-mini reads the rule (title prefix in
  26/28 signals) but emits findings that directly
  contradict the rule body. The categorical confusion is
  isolated to the LLM-reasoning layer.
- **HIGHEST follow-up — TR_015:** Switch gate-agent model
  to gpt-4o via trackeros `agents.yaml` per-agent override.
- **HIGH follow-up — TR_015:** Deterministic post-LLM
  filter for the specific
  pool.query-in-*.repository.ts-flagged-as-violation case
  (re-promoted from TR_012).
- **MEDIUM follow-up — TR_015:** Restore the TR_010
  mandatory executeScript code-agent rule (TR_015's
  trackeros HARNESS.json dropped it per the brief).
- **TR_014 Aider as a swappable code-generation backend.**
  Per-project opt-in via
  `HARNESS.json.codeGeneration.backend: 'aider' | 'gestalt'`
  (default `'gestalt'`). New
  `packages/agents/generate/src/adapters/aider-adapter.ts`
  + `aider-message-builder.ts` + `agents/aider-code-agent.ts`.
  Aider 0.86.2 in the production Docker image; test-agent
  skipped under Aider mode. trackeros opted in (`ccd99d0` on
  `main`). Verified: Aider's code-agent step runs in 6–13 s
  vs the Gestalt-native code-agent's 33–735 s (10–80×
  faster); cleaner code; zero JSON parse failures. **Same
  gate-side categorical hallucination as TR_013** —
  Approach A (rule wording fix) still required.
- **HIGH follow-up — TR_014:** Capture Aider's token spend.
  Parse `Tokens: N sent / M received` from Aider's stdout
  and surface as `tokens_used` on the execution row.
- **MEDIUM follow-up — TR_014:** Finer-grained CONTEXT_GAP
  on Aider exit codes (network / model refusal / file write).
- **TR_013 universal evidence requirement landed.** New
  `packages/core/src/agents/evidence-requirement.ts` exports
  `EVIDENCE_REQUIREMENT_SECTION`, `QUOTED_LINE_SCHEMA_FIELD`,
  and `dropUnevidencedFindings<T>`. Review-agent,
  constraint-agent, and custom-agent-runner now require every
  finding to carry `quotedLine` (the violating line, verbatim)
  and drop items missing it before they reach the gate. Live
  verification (correlation `59900af8-...`): 25/25 emitted
  signals carry `Evidence: "..."` in the message; 4 findings
  dropped at parse; LLM honestly emits `"quotedLine": ""`
  rather than fabricate a quote. Self-healing-agent gets the
  softer warn-when-missing variant.
- **HIGHEST follow-up — TR_013:** Approach A — tighten
  trackeros's HARNESS.json constraint rule wording to
  disambiguate `pool.query` use in repositories. TR_013
  proves the LLM IS finding real evidence; the remaining
  problem is categorical misinterpretation of "outside the
  repository pattern". No platform code change needed.
- **HIGH follow-up — TR_013:** Round-7 code-agent JSON parse
  failure ("Expected double-quoted property name in JSON at
  position 1001"). Separate bug — 437k tokens / 12 min ending
  in malformed JSON, likely from an unescaped quote inside an
  inlined test-file `content` string.
- **MEDIUM follow-up — TR_013:** Both review-agent and
  constraint-agent read files OUTSIDE the cycle's artifact
  set via `readFile`. Scope filter is per-finding; should
  also bound the read reach.
- **TR_012 review-agent reliability fixes landed
  (carryover).** Fix 1 (severity cap), Fix 2 (mandatory
  tool-first protocol — STEP 5 scope filter), Fix 3
  (`detectRepeatedSignalLoop` escape hatch). All continue
  to work in TR_013 — Fix 1 ✓ (0 GP_BREACH), Fix 2 ✓ (no
  audit-logging false positives), Fix 3 ✓ (fires at 84%
  repeat rate in TR_013, up from 72% in TR_012).
- **DROPPED — TR_013:** TR_012's "deterministic post-LLM
  grep filter" follow-up. Superseded by Approach B (evidence
  requirement) — instead of post-filtering with hardcoded
  patterns, the platform structurally requires quoted
  evidence and drops unevidenced findings.
- **Open alerts to dismiss**: TR_010's `GP_BREACH` for
  `7afa0886-…`, TR_011's `failed` for `11a08e08-…`, TR_012's
  `gate-max-retries` for `aac73745-…`, TR_013's
  `generate-error` for `59900af8-…`. All dismissable with
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
