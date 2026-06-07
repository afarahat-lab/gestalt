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

### TR_019 — Real GitHub Actions CI integration verified

Architectural chain (Aider → pr-agent → GH Actions → pipeline-agent
→ gate → promotion) verified end-to-end on trackeros's first
`github-actions` adapter cycle. CI runs 4 stages (Compile / Test /
Lint / Security) green in 35s; gate clones PR branch + reads source
files; both gate agents run on gpt-4o. **Cycle did NOT deploy** —
46 retry rounds before manual termination at ~$10 USD. See
`docs/claude/TEST_REPORT_019.md`.

- **HIGHEST — TR_019:** Gate retry budget not respected. Live cycle
  ran 46 rounds vs `MAX_GATE_RETRIES = 3`. `retryCount` is set in
  the new generate task payload when gate-fail dispatches retry,
  but is dropped during the deploy:pr → deploy:pipeline →
  gate:review response path. Trace through
  `generate-orchestrator.handleIntentTask` end-of-cycle dispatch
  + deploy-orchestrator's pipeline-pass → gate:review dispatch +
  the gate's next entry payload. Likely root cause: TR_018's
  generate→deploy:pr direct dispatch dropped the retryCount
  threading that the older generate→gate:review chain had.
- **HIGH — TR_019:** Three CI runs per push (workflow_dispatch +
  push + pull_request) all do identical work in 35–53s.
  Recommend dropping `pull_request: branches: [main]` from the
  template — push already covers it.
- **MEDIUM — TR_019:** `gestalt init` should scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest versions with
  TypeScript. trackeros's jest@27 + TS@5 mismatch was latent
  under `noop` and only surfaced when CI ran jest.
- **LOW — TR_019:** Template `{{ciSetupSteps}}` for Node/npm
  should include `--legacy-peer-deps` on `npm install` until the
  upstream npm arborist `Link.matches` bug is fixed.
- **LOW — TR_019:** Add a `tsc --noEmit` sanity check on
  scaffolded tests in `gestalt init` so future meta-test debris
  is caught before commit.

### TR_019 trackeros operator commits (already pushed)

Four commits on trackeros `main` between `e926f7a8` and `c93a12e5`:
- comprehensive `gestalt.yml` workflow (push trigger + 4-stage job)
- package.json scripts + jest/ts-jest/@types/jest 27 → 29
- HARNESS.json `qualityGate.required` trimmed; stale
  `agentConfig['test-runner-agent']` removed
- `npm install --legacy-peer-deps`
- proper `.gitignore` + untrack 9,379 `node_modules/` files
- delete 5 broken pre-existing meta-tests in `tests/unit/`

### Carryovers (TR_018 / TR_017 / TR_014)

- **HIGH — TR_018:** Restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json (dropped per the TR_015 brief). CI's `Compile`
  catches the same errors post-hoc, but the TR_010 rule catches
  them pre-emit.
- **MEDIUM — TR_014:** Aider token-spend capture. Parse
  `Tokens: N sent / M received` from Aider's stdout and surface
  as `tokens_used` on the execution row. code-agent rows still
  show 0 across all rounds.
- **MEDIUM — TR_018 (RESOLVED by TR_019):** Switch trackeros's
  `pipeline.adapter` to `github-actions` — done.
- **LOW — TR_018 (RESOLVED by TR_019):** Clean up trackeros's
  stale `test-runner-agent` references — done.

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
