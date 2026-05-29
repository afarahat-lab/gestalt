# CLAUDE.md — Gestalt platform

This file orients Claude Code when working on this repository.
Read it completely before taking any action.

---

## What this project is

Gestalt is a self-hosted agent-first platform that automates the full Software
Development Lifecycle. It is a TypeScript monorepo using pnpm workspaces.

The platform is built on the same principles it enforces in client projects:
context files guide agents, the harness is a first-class artifact, and every
package has a README.md that is the agent's local orientation document.

---

## Before doing anything

1. Read this file completely — especially **Current state** and **Session log**
2. Read `AGENTS.md` (platform-wide coding conventions)
3. Read the relevant package `README.md` for the package you are working in
4. Read `docs/ARCHITECTURE.md` for system-wide context
5. If anything needed is missing from context, state it before proceeding

## After every session — mandatory

Before ending any session, append an entry to the **Session log** section
at the bottom of this file. Include:
- Every file changed and why
- Any decision that deviated from or extended the original design
- Current build status (which packages compile, which don't)
- What remains to be done

This keeps the design chat aligned with what was actually built.

---

## Critical constraints

- **pnpm 9.x only** — pnpm 10+ requires Node 22; this project uses Node 20
  ```bash
  npm install -g pnpm@9.15.4
  ```
- **TypeScript strict mode** — all packages use `strict: true`
- **No `any`** — use `unknown` with type guards instead
- **Named exports only** — no default exports except React components
- **No `console.log`** — use `createContextLogger` from `@gestalt/core`
- **No `process.env` directly** — use `loadConfig()` from `@gestalt/core/config`

---

## Monorepo structure

```
packages/
  core/               — shared types, LLM, queue, repository, harness engine
  server/             — Fastify server, auth, oversight API
  cli/                — gestalt CLI tool
  dashboard/          — React oversight dashboard
  adapters/
    postgres/         — PostgreSQL adapter (reference implementation)
    oracle/           — Oracle adapter (stub)
    mssql/            — SQL Server adapter (stub)
  agents/
    generate/         — intent, design, context, code, test agents + orchestrator
    quality-gate/     — lint, security, constraint, test-runner, review agents
    deploy/           — PR, pipeline, promotion agents
    maintenance/      — drift, alignment, GC, evaluation agents
templates/
  corporate-ops-web-mobile/   — Tier 1 harness template
docs/
  guides/             — quick-start, running (dev setup), deployment, identity
  reference/          — harness-config.md
  runbooks/           — common-issues.md
  ARCHITECTURE.md     — full system design
  DECISIONS.md        — all ADRs
```

---

## Package dependency order

Build in this order:

```
@gestalt/core
  └── @gestalt/adapter-postgres
  └── @gestalt/agents-generate
  └── @gestalt/agents-quality-gate
  └── @gestalt/agents-deploy
  └── @gestalt/agents-maintenance
        └── @gestalt/server
              └── @gestalt/cli
@gestalt/dashboard   (no internal package deps — talks to server via HTTP)
```

---

## Key type alignment rules

The `@gestalt/agents-generate` package has its own local `ContextSnapshot` and
`FeedbackSignal` types in `packages/agents/generate/src/types.ts`. These must
stay aligned with `@gestalt/core` types:

- `FeedbackSignal` must include `autoResolvable: boolean` and `createdAt: Date`
- `ContextSnapshot` must include `projectRoot`, `architectureMd`, `domainMd`
- `AgentRole` values must match the union in `@gestalt/core/src/types.ts`

---

## How to run builds

```bash
# Type check a package
pnpm --filter @gestalt/core typecheck

# Build a package
pnpm --filter @gestalt/core build

# Build all in order
pnpm build

# Run tests
pnpm test

# Docker (requires Docker Desktop running)
docker-compose up -d
docker-compose logs -f server
```

---

## Current build status

`pnpm -r build` compiles cleanly across all 12 buildable workspace packages.
The most recent verifying build is from the 2026-05-28 first-boot admin
setup session — see the **Current state** section below for the
authoritative snapshot and the **Session log** for what changed since.

| Package | Status |
|---|---|
| `@gestalt/core` | ✅ compiles |
| `@gestalt/adapter-postgres` | ✅ compiles |
| `@gestalt/adapter-oracle` | ✅ compiles (stub) |
| `@gestalt/adapter-mssql` | ✅ compiles (stub) |
| `@gestalt/agents-generate` | ✅ compiles |
| `@gestalt/agents-quality-gate` | ✅ compiles (stub) |
| `@gestalt/agents-deploy` | ✅ compiles (stub) |
| `@gestalt/agents-maintenance` | ✅ compiles (stub) |
| `@gestalt/registry` | ✅ compiles |
| `@gestalt/server` | ✅ compiles |
| `@gestalt/cli` | ✅ compiles |
| `@gestalt/dashboard` | ✅ builds (Vite) |

`docker-compose up -d` brings server + postgres + redis up `Up (healthy)`;
`/health` returns 200; protected routes return 401 without a JWT.

## Known issues to resolve

None blocking the build today. Areas to keep in mind when working in this repo:

1. **`UserRepository` extensions touch every adapter.** Adding a method to
   the interface (as the `count()` addition for first-boot admin setup did)
   means the Oracle and SQL Server stubs must learn the same method when
   they leave stub state.
2. **Type alignment between `@gestalt/agents-generate` and `@gestalt/core`.**
   The local `ContextSnapshot` and `FeedbackSignal` types in
   `packages/agents/generate/src/types.ts` must keep matching the core types
   — see the **Key type alignment rules** section above.
3. **CLI pins chalk@4 / ora@5 for CJS compatibility.** Do not upgrade either
   without performing the full ESM migration (`"type": "module"`, `.js`
   extensions on relative imports, Dockerfile update). The pin is
   intentional, not a bug.
4. **`toTaskPriority()` mapper in `packages/server/src/routes/intents.ts`.**
   Bridges `IntentRecord.priority` (`'low'`) and core `TaskPriority`
   (`'background'`). If priority levels are extended, both types must move
   together.

---

## Architecture decisions to respect

All ADRs are in `docs/DECISIONS.md`. Key ones:

- ADR-002: Ephemeral workers — agents are stateless BullMQ workers
- ADR-003: BullMQ + Redis for the message queue
- ADR-004: Repository pattern — no direct DB access outside adapters
- ADR-006: pnpm workspaces monorepo
- ADR-007: Five typed feedback signals — never generic errors
- ADR-025: Local auth non-production only
- ADR-026: PlatformUser is a shadow record

---

## What to do if context is missing

If you need information about a layer, component, or decision that isn't in
this file or in `AGENTS.md`, check:

1. The relevant `docs/` file
2. The package `README.md`
3. The source file itself — it has JSDoc comments
4. Ask in your response before making assumptions

---

## Session log

This section is maintained by both this chat and Claude Code.
Every session that modifies the codebase appends an entry here.
When returning to the design chat, paste this section so the context is current.

**Format for Claude Code — at the end of every session, append:**
```
### Session [date] — [Claude Code]
Changed:
- <file>: <what changed and why>
Decisions made:
- <any architectural decision that deviated from or extended the design>
Build status:
- <which packages compile, which don't, what errors remain>
```

---

### Session 2026-05 — Design chat
Status: All 8 layers designed and documented. Phase 2 build started.

Packages implemented:
- `@gestalt/core` — config, logger, LLM client, BullMQ queue, repository interfaces, harness engine
- `@gestalt/adapter-postgres` — connection pool, migrations, intent/audit/user repositories
- `@gestalt/server` — Fastify app, JWT auth, correlation/audit middleware, intent routes, SSE
- `@gestalt/cli` — login, init, run, status, logs, dashboard commands
- `@gestalt/agents-generate` — orchestrator, all 6 specialist agents, all prompts, validators
- `@gestalt/dashboard` — all 8 views, API client, SSE hooks, layout

Type fixes applied (not yet verified in Docker):
- `packages/core/tsconfig.json`: removed `exactOptionalPropertyTypes`
- `packages/agents/generate/src/types.ts`: added `projectRoot`, `architectureMd`, `domainMd` to `ContextSnapshot`; added `autoResolvable`, `createdAt` to `FeedbackSignal`
- `packages/agents/generate/src/orchestrator/context-assembler.ts`: added `IntentSpec` import, type assertion, new snapshot fields
- All agent files: added `autoResolvable` and `createdAt` to `FeedbackSignal` literals

Build status:
- `@gestalt/core`: should compile (type errors fixed)
- `@gestalt/agents-generate`: type fixes applied, verify with `pnpm --filter @gestalt/agents-generate build`
- All other packages: not yet verified in Docker
- `docker-compose up -d`: failing at agents-generate build step

Next task for Claude Code:
1. Run `pnpm --filter @gestalt/agents-generate build` and fix remaining errors
2. Build each package in dependency order, fix errors
3. Get `docker-compose up -d` fully passing
4. Run `gestalt init local-admin` and verify the platform starts

---

## Current state (keep this section current)

**Last updated:** 2026-05-29 (Claude Code — postgres repo stubs implemented)

**Repo:** https://github.com/afarahat-lab/gestalt

**What is built and working:**
- All 8 architecture layers fully designed and documented
- All 12 buildable workspace packages compile clean (`pnpm -r build`)
- `docker-compose up -d` succeeds — server, postgres, redis all `Up (healthy)`
- Database migrations apply on startup — `users`, `local_auth`, `audit_log`,
  etc. all created; `schema_migrations` tracks `001_initial` + `002_local_auth`
- Server reachable on http://localhost:3000 — `/health` returns 200
- Auth middleware active — protected routes return 401
- First-boot bootstrap verified end-to-end with curl: `POST /auth/admin/setup`
  → 201 + JWT, second call → 403 `ADMIN_ALREADY_EXISTS`, `POST /auth/login`
  with correct creds → 200 + JWT (role 'admin' preserved), wrong password →
  401 `PROVIDER_ERROR`, `GET /auth/me` with token → 200
- `gestalt init-admin` exercised in a real terminal — admin created, JWT
  stored in `~/.gestalt/config.json`
- `POST /intents` (which `gestalt run` calls) accepted and BullMQ-queued.
  Job lands at `bull:gestalt-generate:*` in Redis. **No worker is registered
  yet** to drain the queue, so submitted intents sit in `generating` status
  forever until the generate-orchestrator runtime is wired up at server
  startup
- `GET /status`, `GET /status/agents`, `GET /intents`, `GET /intents/:id`
  all return 200 (verified with curl). Previously `/status` and intent
  detail returned 500 because `executions`, `artifacts`, and `signals`
  were stub repos in the postgres adapter — now real PG implementations
- CLI installed via `pnpm --filter @gestalt/cli build && cd packages/cli && npm link`
- `gestalt init-admin` is **TTY-only** — `prompt`/`promptSecret` use readline
  + raw-mode stdin, so the command cannot be driven from piped input. Works
  fine in a real terminal; would need a non-interactive `--email/--password`
  mode for scripted use (not implemented)
- Old broken command `gestalt init local-admin` is still accepted because
  Commander silently ignores extra positionals on a no-arg `init` command.
  It runs the project-init wizard (which writes `AGENTS.md` / `HARNESS.json`
  / etc. into `cwd`), never prompts for credentials. Users coming from the
  old docs hit this — they get no admin and no token, then `gestalt run`
  responds "Not authenticated". A `program.command('init').allowExcessArguments(false)`
  or an explicit error-on-extra-arg would surface the typo

**What is not yet built:**
- `@gestalt/agents-quality-gate` — stubs only
- `@gestalt/agents-deploy` — stubs only
- `@gestalt/agents-maintenance` — stubs only
- `@gestalt/adapter-oracle` — stub
- `@gestalt/adapter-mssql` — stub
- `@gestalt/registry` — types and client only

**Postgres adapter repository coverage (all real, no remaining stubs):**
- `intents`     — full CRUD + list with paging
- `executions`  — create, updateStatus, findByCorrelationId, findActive
- `artifacts`   — save, findByCorrelationId (typed filter), findById
- `signals`     — save, findByCorrelationId, findUnresolved, markResolved
  (with GOLDEN_PRINCIPLE_BREACH human-only guard)
- `audit`       — append-only, query with filters
- `users`       — upsert, findById, findByIdpSubject, list, count
- `localAuth`   — create, findByEmail

**CLI install:**
- `@gestalt/cli` is private — not on npm
- Install: `pnpm --filter @gestalt/cli build && cd packages/cli && npm link`

**First-boot admin setup:**
- `gestalt init-admin` posts to `POST /auth/admin/setup` (public, zero-user guarded)
- Creates a `users` row (role: admin, authProvider: local) plus a `local_auth`
  row holding the bcrypt password hash, writes an audit record, and returns a JWT
- On subsequent calls the endpoint returns 403 (`ADMIN_ALREADY_EXISTS`)
- `POST /auth/login` is now wired up: routes through AuthManager → LocalProvider →
  bcrypt.compare against local_auth.password_hash
- AuthManager preserves the existing role for local-provider logins (so the
  first admin stays admin and is not downgraded to operator on next login)
- **Operator setup requirement:** the local `.env` must set
  `NODE_ENV=development`. docker-compose now reads `NODE_ENV=${NODE_ENV:-production}`
  so production deployments are unchanged; local-only auth (ADR-025) refuses
  to register the LocalProvider when NODE_ENV=production unless an operator
  explicitly sets `allowedInProduction: true`

**Pending enhancements (design in chat first):**
- Non-interactive mode for `gestalt init-admin` (CLI flags or stdin JSON) so
  it can be scripted. Current implementation is TTY-only by design of
  `promptSecret`
- Generate-orchestrator worker registration at server startup. The intents
  route dispatches `generate:*` task messages to BullMQ but no consumer
  exists, so cycles never progress past `generating`. `@gestalt/agents-generate`
  exports the orchestrator; the wiring lives in `server.ts` between
  "Auth manager ready" and "Fastify app"
- `init` command should reject extra positionals so `gestalt init local-admin`
  fails fast instead of running the project wizard with the arg ignored

**Known architectural constraints Claude Code must respect:**
- pnpm 9.x only (Node 20 compatibility)
- No direct DB access outside adapter packages
- No direct LLM calls outside @gestalt/core/llm
- GOLDEN_PRINCIPLE_BREACH signals are never auto-resolved
- All state-changing operations write an audit record (GP-002)
- Server must not import from packages/dashboard/src — use server-local type mirrors
- /events SSE route is canonical in routes/events.ts — do not re-register elsewhere

---

### Session 2026-05-28 — Claude Code (CLI install fix)
Changed:
- `packages/cli/package.json`: flipped `"private": false` → `"private": true`
  so `npm publish` will not be suggested and the package's intent (local
  workspace only) matches reality
- `README.md`: replaced the `npm install -g @gestalt/cli` quick-start snippet
  with the `pnpm install` + `pnpm --filter @gestalt/cli build` + `npm link`
  workflow that actually works in this monorepo
- `docs/guides/quick-start.md`: same replacement, plus a forward-link to the
  new runbook entry so users who hit the 404 land on the explanation
- `docs/guides/deployment.md`: replaced the on-server install with a clone +
  build + `npm link` flow (and clarified the CLI runs on the operator
  workstation, not on the server host)
- `docs/runbooks/common-issues.md`: added a **CLI issues** section covering
  the `npm install -g @gestalt/cli` 404 and a follow-up `gestalt: command not
  found` (PATH + build prerequisite) — both are predictable from the new
  install flow

Decisions made:
- Used `npm link` rather than `pnpm link --global` because the existing docs
  reference `npm` and the CLI's package.json `bin` field is the npm
  convention. Both work, but mixing tools in user-facing instructions is the
  failure mode this session is fixing — better to stay consistent on `npm`
  for the install step even though dependency install uses pnpm
- Did not edit `packages/cli/README.md` or `docs/ARCHITECTURE.md` despite
  matching the `@gestalt/cli` grep. Those mention the package by name
  (orientation / architecture overview) but do not contain install commands

Build status:
- No source changes — TypeScript build is unaffected
- `docker-compose up -d` state from the prior session is unchanged

### Session 2026-05-28 — Claude Code (first-boot admin setup)
Changed:
- `packages/adapters/postgres/src/migrations/002_local_auth.sql`: new migration
  adding the `local_auth` table (user_id FK → users with ON DELETE CASCADE,
  unique email, bcrypt password_hash). Runner tracks application — no manual
  INSERT into schema_migrations inside the file
- `packages/core/src/repository/index.ts`: added `LocalAuthRepository`
  interface + `LocalAuthRecord` type; added `count()` to `UserRepository`
  (zero-user guard for /auth/admin/setup); added `localAuth` to
  `RepositoryRegistry`
- `packages/core/src/index.ts`: re-exported `LocalAuthRepository` and
  `LocalAuthRecord`
- `packages/adapters/postgres/src/repositories/users.ts`: implemented
  `count()`
- `packages/adapters/postgres/src/repositories/local-auth.ts`: new
  `PostgresLocalAuthRepository` (create + findByEmail)
- `packages/adapters/postgres/src/index.ts`: wired `PostgresLocalAuthRepository`
  into the registry returned by `createPostgresAdapter`
- `packages/server/package.json`: added `bcrypt@^5.1.1` runtime dep and
  `@types/bcrypt@^5.0.2` dev dep
- `packages/server/src/routes/admin.ts`: new route module — `POST
  /auth/admin/setup`. Public endpoint guarded by `users.count() === 0`,
  bcrypt-hashes (12 rounds) the password, upserts the user with role 'admin'
  / authProvider 'local' / idpSubject = email, inserts the local_auth row,
  writes a manual audit record (the audit hook skips because there is no
  authenticated `request.user` yet), and returns `{ token, user }`
- `packages/server/src/auth/middleware.ts`: added `POST /auth/admin/setup` to
  `PUBLIC_ROUTES` so the JWT preHandler does not block it
- `packages/server/src/auth/providers/local.ts`: replaced the
  "not yet implemented" stub. Now looks up local_auth by email,
  bcrypt.compare-s, throws `AuthenticationError` on missing creds or wrong
  password, returns a `VerifiedIdentity` with provider: 'local' on success
- `packages/server/src/auth/auth-manager.ts`: imported `getRepositories`;
  changed `createSession` so local-provider identities preserve the existing
  user's role (look up by idpSubject + 'local'), falling back to 'operator'.
  IdP identities still flow through `resolveRole` as before
- `packages/server/src/auth/routes.ts`: implemented `POST /auth/login` —
  validates body, wraps the Fastify request as `IncomingRequest`, calls
  `authManager.authenticate`, returns `{ token, user }` on success and maps
  `AuthenticationError.code === 'LOCAL_IN_PRODUCTION'` to 403, everything
  else to 401
- `packages/server/src/app.ts`: registered the new admin route module after
  `registerAuthRoutes`
- `packages/cli/src/api/client.ts`: added `adminSetup({ email, password,
  displayName })` typed wrapper around POST /auth/admin/setup
- `packages/cli/src/commands/init-admin.ts`: new CLI command — health check,
  prompts (email, displayName, password, confirmPassword), client-side
  validation (>= 8 chars, passwords match), calls `client.adminSetup`,
  stores the JWT via `updateCliConfig`, prints the local-auth warning
  banner, special-cases a 403 with a "use gestalt login" message
- `packages/cli/src/index.ts`: registered `gestalt init-admin
  [--server <url>]` and updated the file header comment
- `docs/guides/quick-start.md`: Step 4 now uses `gestalt init-admin` (was
  `gestalt init local-admin`, which never existed); added a forward-link to
  the new runbook entry
- `docs/runbooks/common-issues.md`: added an "Admin setup fails with admin
  already exists" entry explaining the 403, the deliberate absence of a CLI
  bypass, and the three resolution paths (sign in / wipe volume in dev / new
  account via IdP)

Decisions made:
- **Separate `local_auth` table** rather than adding a nullable
  `password_hash` column to `users`. Keeps credentials isolated from the
  shadow user record (which is otherwise IdP-mirrored) and lets us drop
  `local_auth` cleanly when local mode is retired
- **`LocalAuthRepository` in core, implemented in adapter-postgres** — same
  pattern as the other repos so ADR-004 (no DB access outside adapters) still
  holds. Provider and route call through `getRepositories()`
- **Preserve role on local login** by changing `AuthManager.createSession`
  rather than the role-mapper. The role-mapper is pure logic (no DB); the
  manager already has access. This is a focused fix — IdP role re-evaluation
  is untouched
- **Manual audit write inside the admin route**, because the audit hook
  short-circuits when `request.user` is undefined. The actor on the audit
  row is the just-created admin's UUID, which is the most informative actor
  available at that moment
- **bcrypt over argon2** — bcrypt was specified in the task; matches the
  comments already in the codebase ("Phase 2: bcrypt verification")
- **12 rounds** for bcrypt — standard for new systems in 2026, balances
  CPU cost vs. brute-force resistance
- Did not migrate the CLI to ESM despite the pinned chalk@4/ora@5
  caveat flagged in the previous session — staying on CJS keeps this change
  surgical. That migration remains a separate task

Build status:
- `pnpm -r build` — all 12 buildable packages compile clean (verified)
- Migration not yet applied — `002_local_auth.sql` runs the next time the
  server starts against the postgres container
- `docker-compose up -d` not exercised in this session; expected to work
  unchanged since type-check passes and the bcrypt native binding installed
  successfully via node-pre-gyp
- End-to-end smoke test (run `gestalt init-admin`, then `gestalt login` with
  the same creds, then call a protected route with the returned token) is
  the next verification step

---

### Session 2026-05-28 — Design chat review

Evaluation: Claude Code session was clean and well-aligned. No architectural drift detected.

One item flagged for future attention:
- `packages/cli/package.json` uses chalk@4 and ora@5 (CJS-compatible downgrades).
  These are intentionally pinned. When CLI enhancement work begins, migrate the
  CLI package to ESM (add `"type": "module"` to package.json, add `.js` extensions
  to all relative imports, update Dockerfile) so chalk@5+ and ora@8+ can be used.
  Do not upgrade chalk/ora without doing the full ESM migration — it will break the build.

- `toTaskPriority()` mapper exists in `packages/server/src/routes/intents.ts`
  because `IntentRecord.priority` uses `'low'` but core `TaskPriority` uses
  `'background'`. If priority levels are ever extended, both types need updating
  together.

---

### Session 2026-05-28 — Claude Code (CLAUDE.md status refresh)
Changed:
- `CLAUDE.md`: rewrote the **Current build status** section (lines ~135-143)
  to reflect that `pnpm -r build` compiles cleanly across all 12 packages and
  to list every workspace package individually instead of describing
  `agents-generate` as "type fixes applied, verify with…". Added a one-line
  pointer to the **Current state** section as the authoritative snapshot
- `CLAUDE.md`: rewrote the **Known issues to resolve** section. The old
  numbered list (FeedbackSignal / ContextSnapshot / optional-field patterns)
  described errors that were resolved in the 2026-05-28 build-fix session and
  no longer apply. Replaced with four areas to keep in mind when modifying
  this repo: `UserRepository` extensions need parity across all adapters,
  `agents-generate` ↔ `core` type alignment, the intentional CJS pin on
  chalk/ora in the CLI, and the `toTaskPriority` mapper coupling

Decisions made:
- Kept the "Known issues to resolve" heading rather than renaming it (e.g.
  to "Things to watch") — the section appears in the **Before doing
  anything** reading list, so future agents will still find it at the same
  anchor. The content under the heading now matches reality
- Did not duplicate the package status table into the **Current state**
  section. The new build-status table is granular ("compiles clean") and the
  Current state section already lists what is and isn't built feature-wise
  ("`@gestalt/agents-quality-gate` — stubs only"). They answer different
  questions, so both stay

Build status:
- No source changes — TypeScript build is unaffected

---

### Session 2026-05-29 — Claude Code (bootstrap smoke test + fixes)

Smoke-tested the first-boot admin path end-to-end inside Docker. The
HTTP-level flow now works completely: 201 + JWT on first `POST
/auth/admin/setup`, 403 `ADMIN_ALREADY_EXISTS` on a second call, 200 + JWT
on `POST /auth/login` with the admin's role preserved as 'admin' (not
downgraded to operator), 401 `PROVIDER_ERROR` on wrong password, 200 on
`GET /auth/me`. Three pre-existing platform bugs blocked the smoke test
and had to be fixed first — none were regressions from the
`feat: first-boot admin setup` work; they prevented any Docker bootstrap
from succeeding on a fresh volume.

Changed:
- `packages/adapters/postgres/package.json`: build script changed from
  `tsc` to `tsc && mkdir -p dist/migrations && cp src/migrations/*.sql
  dist/migrations/`. Without this, the compiled runner at
  `dist/migrations/runner.js` finds zero `.sql` files (tsc does not copy
  non-TS assets) and silently applies no schema — so the `users` table
  never gets created at runtime, even though `pnpm -r build` succeeds. This
  also makes the explicit `COPY ... src/migrations` line in
  `packages/server/Dockerfile` (lines 81-82) redundant, but it was left in
  place rather than touched in this session
- `packages/adapters/postgres/src/migrations/001_initial.sql`: two fixes —
  (a) the `REVOKE UPDATE, DELETE ON audit_log FROM gestalt_app;` statement
  referenced a role that never exists (POSTGRES_USER defaults to `gestalt`),
  so the migration transaction rolled back on every fresh start; wrapped in
  a `DO $$ EXECUTE format('REVOKE … FROM %I', current_user) … EXCEPTION
  WHEN OTHERS THEN NULL; END $$;` block so the audit-log protection is
  applied to whichever role connects and is tolerant of the role being
  absent. (b) Removed the file's own `CREATE TABLE schema_migrations` and
  `INSERT INTO schema_migrations (version) VALUES ('001_initial');` — the
  migration runner in `migrations/runner.ts` already does both inside the
  same transaction, so the duplicates failed with a primary-key conflict
  and an "already exists" error
- `docker-compose.yml`: `NODE_ENV=production` → `NODE_ENV=${NODE_ENV:-production}`.
  Production deployments are unchanged (still defaults to `production`); local
  smoke-testing can now set `NODE_ENV=development` in `.env` to let the
  AuthManager register the LocalProvider. ADR-025 (local auth non-production
  only) is still enforced by the existing `allowedInProduction` check
- `.env` (gitignored, local-only): added `NODE_ENV=development` with a
  comment pointing to ADR-025. This file is not committed; documented here
  so operators know what to set

Decisions made:
- **Fix migration packaging in the build script, not the Dockerfile.** The
  build-script approach makes the SQL files land in `dist/migrations/` for
  both dev (`pnpm dev`, `tsx`) and prod (Docker multi-stage). A Dockerfile-
  only fix would have left non-Docker runners broken
- **Use `current_user` in the REVOKE rather than hardcoding `gestalt` or
  reading POSTGRES_USER.** Hardcoding couples 001 to one deployment;
  reading env requires a templating step. `current_user` resolves at SQL
  execution time and works for any operator-chosen role
- **Strip the manual schema_migrations writes from 001** rather than
  changing the runner to use `ON CONFLICT DO NOTHING`. The runner already
  owns the version-tracking contract; migrations should be pure schema
  changes. This convention is documented in a comment block where the
  removed statements used to live, so 003+ authors do not re-introduce the
  same bug
- **Make NODE_ENV overridable in compose, not edit ADR-025.** The ADR's
  intent ("local auth non-production only") is correct. The fix is just
  giving the operator a way to set NODE_ENV per environment without
  patching the compose file
- Did not touch `packages/cli/src/ui/prompts.ts` to enable scripted CLI
  use. The raw-mode `promptSecret` is intentionally interactive; a flag-
  based non-interactive mode is now listed under **Pending enhancements**
  in **Current state** instead of being smuggled in here

Build status:
- `pnpm -r build` — all 12 buildable packages compile clean
- `docker-compose up -d` (after `docker-compose down -v` on prior failed
  volumes) — server, postgres, redis all `Up (healthy)`
- Both migrations apply on first start (visible in `docker-compose logs
  server`: "Applying migration … 001_initial" → "Migration applied" →
  "Applying migration … 002_local_auth" → "Migration applied")
- End-to-end admin-setup + login smoke test via curl — all five cases
  pass (see top of session note)
- CLI `gestalt init-admin` — exits cleanly on TTY; cannot be piped (raw-
  mode password prompt is TTY-only). Real-terminal interactive use is the
  supported path

Operator caveat:
- The smoke test left one admin in the DB (`tty-admin@example.com`). Anyone
  running `gestalt init-admin` against this same stack now will hit 403.
  Run `docker-compose down -v` first to reset (this destroys all data)

---

### Session 2026-05-29 — Claude Code (BullMQ queue-name fix)

The user ran `gestalt run` against a working admin session and got
`API error 500: Queue name cannot contain :`. Pre-existing bug — would
have crashed the first dispatch on any deployment. Not a regression from
the bootstrap work; the queue path was never exercised before.

Changed:
- `packages/core/src/queue/index.ts`: `QUEUE_NAMES` constants flipped from
  `gestalt:{layer}` → `gestalt-{layer}` (generate / gate / deploy /
  maintenance). BullMQ 5.x rejects queue names containing `:` because it
  reserves the colon for its own Redis key prefix (`bull:<queue>:<key>`).
  Also updated the docstring at the top of the file to describe the new
  naming and call out the BullMQ constraint
- `docs/runbooks/common-issues.md`: the diagnostic
  `redis-cli LLEN bull:generate:wait` was already wrong (it would have
  returned 0 even before this bug because BullMQ's full key is
  `bull:<queue>:wait`, not `bull:generate:wait`). Fixed to
  `bull:gestalt-generate:wait`

Verified:
- Rebuilt core + server image, restarted server. `POST /intents` with a
  real JWT now returns 201 instead of 500, and `redis-cli --scan --pattern
  'bull:*'` shows the expected `bull:gestalt-generate:id`,
  `bull:gestalt-generate:meta`, `bull:gestalt-generate:prioritized`, etc.
  keys getting populated

Decisions made:
- **Hyphen over BullMQ's `prefix` option.** BullMQ offers a `prefix`
  QueueOptions field that adds a Redis-key prefix without restricting
  what's in the queue name. That would have preserved the colons in
  developer-facing constants, but it adds a second indirection (key
  pattern is then `<prefix>:<queue>:*`) and existing log lines / runbook
  entries reference the queue name directly. Hyphen is the cheapest
  change with the smallest mental model
- **Did not add a sanity check at queue construction time.** The new
  pattern is locked in `QUEUE_NAMES` and that's the only authority. A
  future regression would surface immediately on first dispatch, same as
  this one did

Build status:
- `pnpm --filter @gestalt/core build` — clean
- `docker-compose up -d --build server` — server `Up (healthy)`
- Verified `POST /intents` returns 201 with token, queue keys created in
  Redis

Known follow-ups (not addressed this session, listed under **Pending
enhancements** in **Current state**):
- No worker is registered for `gestalt-generate`. Submitted intents queue
  but never get drained. Server startup needs to import and start the
  generate orchestrator from `@gestalt/agents-generate` between
  "Auth manager ready" and "Fastify app"
- `gestalt init local-admin` (old broken syntax from the original task
  brief) silently runs the project-init wizard because Commander accepts
  unknown positionals. Worth a `.allowExcessArguments(false)` on the
  `init` command to fail fast
- `gestalt init`'s project slug logic produced `currentProjectId:
  "generate-a-full-stack,"` (trailing comma from user description). The
  init command mocks the LLM anyway, so the whole slug-builder will be
  rewritten when init is reimplemented

---

### Session 2026-05-29 — Claude Code (postgres repo stubs implemented)

The user ran `gestalt status` against a freshly-rebuilt stack and got
`API error 500: Not yet implemented`. Source: `packages/adapters/postgres/src/index.ts`
had three inline stub literals — `executions`, `artifacts`, `signals` —
whose methods all threw on call. `GET /status` and `GET /status/agents`
both hit `executions.findActive()`. Intent detail (`GET /intents/:id`)
hit all three. The PR description on `844abba` flagged "all other repos
remain stubs" but the gap was unaddressed; `gestalt status` was the
first end-user-facing command that exercised them.

Changed:
- `packages/adapters/postgres/src/repositories/executions.ts` (new):
  `PostgresAgentExecutionRepository` — `create`, `updateStatus`
  (`COALESCE`-merges optional `tokensUsed` / `durationMs` / `startedAt` /
  `completedAt` so partial updates do not clobber existing values),
  `findByCorrelationId`, `findActive` (status IN ('queued', 'running'))
- `packages/adapters/postgres/src/repositories/artifacts.ts` (new):
  `PostgresArtifactRepository` — `save`, `findByCorrelationId` with
  optional `ArtifactType` filter, `findById`
- `packages/adapters/postgres/src/repositories/signals.ts` (new):
  `PostgresSignalRepository` — `save`, `findByCorrelationId`,
  `findUnresolved`, `markResolved`. `location` is stored as JSONB and
  hydrated back into `CodeLocation`. `markResolved` enforces the platform
  invariant that `GOLDEN_PRINCIPLE_BREACH` signals can only be resolved by
  a human — refuses any non-human `resolvedBy`
- `packages/adapters/postgres/src/index.ts`: removed the inline stub
  literals and the `stub = () => { throw … }` factory; wired the three new
  repos into the registry returned by `createPostgresAdapter`. Deleted the
  outdated "implemented in full Phase 2 build" comment

Verified:
- `pnpm --filter @gestalt/adapter-postgres build` + `pnpm --filter
  @gestalt/server build` — clean
- `docker-compose up -d --build server` — server `Up (healthy)`
- `GET /status` → 200 `{"data":{"activeAgents":0,…}}`
- `GET /status/agents` → 200 `{"data":[]}`
- `GET /intents?projectId=smoke` → 200 `{"data":[],"total":0,…}`
- `POST /intents` then `GET /intents/:id` → 200 with `agentExecutions:
  []`, `signals: []`, `artifacts: []` (all three new repos called inside
  `Promise.all([...]) in `packages/server/src/routes/intents.ts:137`)

Decisions made:
- **Implemented the full interface for each repo, not just the methods
  `gestalt status` happens to need.** `findActive` alone would have fixed
  the immediate 500, but the next CLI path (`gestalt status --id <id>` →
  intent detail) would have failed on `findByCorrelationId` for all three.
  Implementing the whole repo is the same amount of effort and removes the
  next class of bug
- **`COALESCE` on `updateStatus`** for `agent_executions` — workers will
  call it multiple times per task lifecycle (start → running →
  finished), and the contract says `fields` is `Partial<AgentExecutionRecord>`.
  Without COALESCE, omitted fields would null out previously-set values
- **Enforced GOLDEN_PRINCIPLE_BREACH human-only resolution at the
  repository layer**, not just convention. This is one of the invariants
  listed under "Architecture decisions to respect" in CLAUDE.md and one
  of the platform's golden principles per AGENTS.md. Putting it here
  means any future caller (route, agent, script) is bound by it without
  having to re-implement the check
- **`location` stored as JSON-stringified JSONB and parsed on read.**
  postgres.js auto-parses JSONB columns, so the round-trip is `null` or
  `CodeLocation` — `rowToSignal` handles both. Did not lift a generic
  helper because this is the only column that needs it
- **Did not touch the audit / users / localAuth / intents repos.** They
  were already real. The session log on `844abba` already covers them

Build status:
- `pnpm -r build` — all 12 buildable packages compile clean
- `docker-compose up -d --build server` — server healthy
- Repo coverage table added to **Current state** so future agents do not
  re-stub these

Operator note:
- Existing DB state survives. The user's admin (`amr.farahat@gmail.com`)
  and JWT are untouched — the volume rebuild was server-only via
  `docker-compose up -d --build server`. No `docker-compose down -v`
  required to pick up the fix
