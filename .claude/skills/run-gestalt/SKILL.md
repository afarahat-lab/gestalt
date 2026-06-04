---
name: run-gestalt
description: Build, run, smoke-test, and screenshot the Gestalt platform end-to-end. Use when asked to start gestalt, bring up the platform, run the server, take a dashboard screenshot, or verify the docker-compose stack.
---

Gestalt is a TypeScript monorepo that runs as a Fastify server + React
dashboard (`/app/*`) on top of Postgres + Redis. Everything ships in one
Docker image; the agent path is `.claude/skills/run-gestalt/smoke.sh`,
which orchestrates the full bring-up plus a dashboard screenshot via
headless Chrome.

All paths below are relative to the repo root (this is a single-unit
repo; the unit IS the repo).

## Prerequisites

- **Docker Desktop** running (macOS host detected; the script also
  works on Linux Docker).
- **Node 20+, pnpm 9.15.4** for building the workspace. pnpm 10+
  needs Node 22 — don't upgrade without coordinating; see CLAUDE.md.
- **`jq`** for the JWT plumbing inside `smoke.sh`.
- **`curl`** for the API probes.
- **`.env`** at repo root with these populated:
  - `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB`
  - `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (any OpenAI-compatible
    endpoint; without it the platform boots but every LLM call 401s)
  - `JWT_SECRET` (32-byte random hex; any value if you don't care
    about persistent JWTs across boots)

Copy `.env.example` to `.env` and fill the gaps if it isn't already
there.

## Run (agent path) — the smoke script

One command brings everything up, probes it, and (optionally) captures
a screenshot of the dashboard:

```bash
SCREENSHOT=yes .claude/skills/run-gestalt/smoke.sh
```

What it does (in order, with output on stdout):

| step | what it verifies |
|---|---|
| 1. Prerequisites | docker / pnpm / node / jq / curl present, daemon up, `.env` exists |
| 2. Build         | `pnpm -r build` produces dist/ for all 12 packages |
| 3. Compose up    | `docker compose up -d` (postgres + redis + server) |
| 4. Health        | poll `GET /health` for up to 60s |
| 5. JWT           | reuse `~/.gestalt/config.json` if valid, else admin-setup, else login |
| 6. REST surface  | `/auth/me`, `/projects`, `/platform/secrets`, `/platform/llms`, `/status`, `schema_migrations` count |
| 7. CLI           | `gestalt --help` + `gestalt projects list` |
| 8. Screenshot    | `--headless=new` Chrome → PNG of `/app/` login page (skipped if `SCREENSHOT=no`) |

Exit code 0 = green; non-zero = red text on the last failure with
enough context to debug. Build / compose / chrome logs land under
`/tmp/gestalt-smoke/`; screenshots under `/tmp/gestalt-shots/`.

### Env knobs

| variable | default | purpose |
|---|---|---|
| `SERVER_URL`     | `http://localhost:3000` | where the server lives |
| `SCREENSHOT`     | `no` | set `yes` to capture a dashboard PNG |
| `SMOKE_EMAIL`    | `smoke@gestalt.local` | admin to create on a fresh platform |
| `SMOKE_PASSWORD` | `smoke-password-please-change` | the admin's password |
| `SMOKE_DISPLAY`  | `Smoke Test Operator` | display name |
| `SHOTS_DIR`      | `/tmp/gestalt-shots` | where PNGs land |
| `LOG_DIR`        | `/tmp/gestalt-smoke` | where build/chrome/compose logs land |
| `CHROME`         | (probed) | override the Chrome binary used for the screenshot |

### Steady-state operation

The script is idempotent. Re-running on a platform that's already up:

1. Build is fast (TypeScript incremental cache)
2. `docker compose up -d` is a no-op
3. JWT acquired from `~/.gestalt/config.json` (no new admin created)
4. All probes pass
5. Fresh screenshot lands in `$SHOTS_DIR`

Stop the platform with `docker compose down` (or `docker compose down
-v` to wipe the Postgres volume, which forces a clean re-bootstrap on
next run).

## Run (human path)

For interactive development:

```bash
docker compose up -d --build server   # → server on :3000 with rebuilt image
# Open http://localhost:3000/app/ in a browser
docker compose logs -f server          # tail logs
docker compose down                    # stop everything
```

The CLI hits the same server:

```bash
pnpm --filter @gestalt/cli build
node packages/cli/dist/index.js login   # interactive
node packages/cli/dist/index.js projects list
```

(Or `cd packages/cli && npm link` once to put `gestalt` on PATH.)

## Test

```bash
pnpm -r test
```

Most packages have minimal test surface today — the real verification
is the live smoke. `pnpm -r build` is the strict compile check; it
catches every type-level regression.

## Direct invocation

To exercise an internal function without spinning up the full
platform — e.g. when a PR touches one helper:

```bash
# After pnpm --filter <pkg> build:
docker exec gestalt-server-1 node -e '
  const m = require("/app/packages/core/dist/index");
  // call into m.* directly
'
```

The dev-override pattern in this skill's history (`docker-compose
-f ... -f docker-compose.dev-override.yml up -d`) mounts the
host-side `dist/` over the image so you can iterate on TypeScript
changes without rebuilding the image. The override file is NOT
committed — recreate when the network is unreachable for
`docker compose build` cycles:

```yaml
# docker-compose.dev-override.yml
services:
  server:
    image: gestalt-server:latest
    build: !reset null
    volumes:
      - ./packages/core/dist:/app/packages/core/dist:ro
      - ./packages/server/dist:/app/packages/server/dist:ro
      - ./packages/adapters/postgres/dist:/app/packages/adapters/postgres/dist:ro
      - ./packages/adapters/postgres/src/migrations:/app/packages/adapters/postgres/src/migrations:ro
      - ./packages/adapters/postgres/dist/migrations:/app/packages/adapters/postgres/dist/migrations:ro
      - ./packages/agents/generate/dist:/app/packages/agents/generate/dist:ro
      - ./packages/agents/quality-gate/dist:/app/packages/agents/quality-gate/dist:ro
      - ./packages/agents/deploy/dist:/app/packages/agents/deploy/dist:ro
      - ./packages/agents/maintenance/dist:/app/packages/agents/maintenance/dist:ro
      - ./packages/dashboard/dist:/app/packages/dashboard/dist:ro
      - ./templates:/app/templates:ro
      - projects_data:/app/projects
```

Then `docker compose -f docker-compose.yml -f docker-compose.dev-override.yml up -d server`.

## Gotchas

- **`/admin/setup` returns 401, not 409, when an admin already
  exists.** First-boot only — once any admin is in the `users` table
  the route refuses unauthenticated requests. `smoke.sh` handles this
  by reusing the JWT from `~/.gestalt/config.json` when present, and
  only attempts setup on a truly fresh DB. Forcing a fresh DB:
  `docker compose down -v`.
- **CLI Node version vs platform Node version.** The Docker image is
  pinned to Node 20 + pnpm 9.15.4 (real `node:sqlite` / pnpm 9.x
  constraint). The host can be Node 20+, including newer majors — the
  CLI builds + runs fine on Node 22/24/26. pnpm 10+ requires Node 22
  for `node:sqlite`; the repo's pinned pnpm 9.15.4 keeps this stable.
- **Chrome path defaults but is overridable.** The screenshot step
  probes `$CHROME` first, then
  `/Applications/Google Chrome.app/.../Google Chrome`,
  `/usr/bin/google-chrome`, `/usr/bin/chromium`,
  `/usr/bin/chromium-browser`. Custom Homebrew prefix or Brave:
  `CHROME=/path/to/chrome SCREENSHOT=yes .claude/skills/run-gestalt/smoke.sh`.
- **`docker compose up -d --build`** can hang on `node:20-alpine` image
  pull when the registry is unreachable (DNS / VPN issue, observed
  during this skill's authoring). When the registry is back, the
  build completes normally. The dev-override workaround above lets
  you iterate without rebuilding the base image.
- **First-cycle CI on a freshly-init'd project fails by design.** A
  fresh project has no `package.json` — the seeded `gestalt.yml`
  workflow guards with `if [ -f package.json ]` and emits a
  GitHub Actions `::warning::`. The pipeline-agent treats this as
  `failed` and triggers self-healing. The fix is to submit a
  scaffolding intent FIRST so the project gets a package.json before
  the first deploy cycle reaches CI.

## Troubleshooting

- **`Docker daemon not running`** → `open -a Docker` on macOS; wait
  ~10s for it to spin up; re-run.
- **`Bad credentials` from `gestalt-server` for an LLM call** →
  `LLM_API_KEY` in `.env` is wrong/expired. The server boots fine
  without a valid key; only LLM-driven flows (intents) fail.
- **`relation "schema_migrations" does not exist`** → Postgres
  volume got nuked but server didn't restart. `docker compose
  restart server` and re-run.
- **`port is already allocated 0.0.0.0:3000`** → another process
  bound 3000. `lsof -i :3000` to find it, or override:
  `SERVER_PORT=3001 docker compose up -d` + `SERVER_URL=http://localhost:3001 ./smoke.sh`.
- **`./smoke.sh: line N: command not found: jq`** → `brew install jq`
  (or `apt-get install jq`).
- **`Failed to reach $SERVER_URL/health after 60s`** → server crashed
  during boot. `docker logs gestalt-server-1 | tail -50` shows why;
  most common is a migration that errored on a stale Postgres state
  (`docker compose down -v` to wipe + re-bootstrap from scratch).
- **CLI says `Not authenticated`** → `~/.gestalt/config.json` has a
  stale or missing token. Re-run `smoke.sh` (it rewrites the file
  with a fresh JWT) or manually `gestalt login`.
