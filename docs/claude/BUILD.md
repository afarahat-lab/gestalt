# BUILD.md — Build, types, and known issues

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
The most recent verifying build is from the 2026-05-29 ADR-032 session — see
the **Current state** section below for the authoritative snapshot and the
**Session log** for what changed since.

| Package | Status |
|---|---|
| `@gestalt/core` | ✅ compiles |
| `@gestalt/adapter-postgres` | ✅ compiles |
| `@gestalt/adapter-oracle` | ✅ compiles (stub) |
| `@gestalt/adapter-mssql` | ✅ compiles (stub) |
| `@gestalt/agents-generate` | ✅ compiles |
| `@gestalt/agents-quality-gate` | ✅ compiles |
| `@gestalt/agents-deploy` | ✅ compiles |
| `@gestalt/agents-maintenance` | ✅ compiles |
| `@gestalt/registry` | ✅ compiles |
| `@gestalt/server` | ✅ compiles |
| `@gestalt/cli` | ✅ compiles |
| `@gestalt/dashboard` | ✅ builds (Vite) |

`docker-compose up -d` brings server + postgres + redis up `Up (healthy)`;
`/health` returns 200; protected routes return 401 without a JWT.
All three migrations apply on first start: `001_initial`, `002_local_auth`,
`003_projects`.

---

## Key type alignment rules

The `@gestalt/agents-generate` package has its own local `ContextSnapshot` and
`FeedbackSignal` types in `packages/agents/generate/src/types.ts`. These must
stay aligned with `@gestalt/core` types:

- `FeedbackSignal` must include `autoResolvable: boolean` and `createdAt: Date`
- `ContextSnapshot` must include `projectRoot`, `architectureMd`, `domainMd`
- `AgentRole` values must match the union in `@gestalt/core/src/types.ts`

---

## Known issues to resolve

None blocking the build today. Areas to keep in mind when working in this repo:

1. **`UserRepository` extensions touch every adapter.** Adding a method to
   the interface (as the `count()` addition for first-boot admin setup did)
   means the Oracle and SQL Server stubs must learn the same method when
   they leave stub state. Same applies to `ProjectRepository` — oracle and
   mssql stubs already have throw-stubs added (2026-05-29 ADR-032 session).
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
5. **Git token stored plain text.** `project_git_credentials.token` has a
   `TODO: encrypt at rest before production use` comment in
   `packages/adapters/postgres/src/repositories/projects.ts`. Do not remove
   the comment; address it before any shared/production deployment.
6. **LLM model name not validated at startup.** `loadConfig` accepts any
   non-empty string for `LLM_MODEL`. An invalid model name will only surface
   as a 404 when the first LLM call is made. Set a valid model in `.env`
   before running `gestalt run`.
