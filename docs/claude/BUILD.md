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

### TR_019 — Real GitHub Actions CI integration verified (superseded by TR_020 deploy)

### TR_020 — First clean github-actions deploy

trackeros's first `Status: ✓ deployed` against the real
`github-actions` adapter: 1m 58s, single round, PR #54
squash-merged. Four fixes against TR_019's runaway: console.log
rule scope, retryCount threading, CI trigger dedupe (3→1),
executeScript stripped from review-agent + "trust CI" prompt.
Template bumped 0.5.0 → 0.6.0. See
`docs/claude/TEST_REPORT_020.md`.

**Resolved by TR_020:**
- ~~HIGHEST — TR_019: gate retry budget not enforced~~ — fixed
  via retryCount threading through
  generate→deploy:pr→deploy:pipeline→gate:review +
  `ABSOLUTE_MAX_RETRIES = 5` safety net + `incrementAttemptCount`
  on every gate retry.
- ~~HIGH — TR_019: 3 CI runs per push~~ — fixed via
  `GitHubActionsAdapter.triggerPipeline` polling push-triggered
  run + `pull_request` trigger removed from template.

**New from TR_020:**
- **LOW — TR_020:** Consider extending the "trust CI" prompt rule
  to constraint-agent. Doesn't currently hit the same TS-compiler
  hallucination because its prompt doesn't open with `tsc`, but a
  future regression could.

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

### TR_020 trackeros operator commits (already pushed)

Two commits on trackeros `main`:
- `99a48c73` — HARNESS.json console.log rewording + gestalt.yml
  pull_request trigger removed
- `f926e840` — agents.yaml review-agent tools stripped +
  trust-CI prompt extension

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
