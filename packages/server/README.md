# @gestalt/server

The self-hosted Fastify server. The coordination hub for everything. Receives
intent from the CLI, dispatches to the BullMQ queue, drives the generate-layer
orchestrator worker, persists state via the repository, serves the dashboard,
and exposes the oversight API.

---

## Responsibilities

- REST API — consumed by the CLI and dashboard
- Auth — first-boot admin bootstrap, local-provider login, JWT-based RBAC
  (admin / operator / viewer), provider abstraction for SAML / OIDC / Kerberos
- Intent lifecycle management — receives, tracks, and reports on intent cycles
- Queue dispatch — translates API requests into typed `TaskMessage`s on the
  BullMQ queue (`bull:gestalt-{layer}:*`)
- Generate-layer orchestrator worker — registered at startup via
  `startOrchestratorWorker(config.queue)`, drains the `gestalt-generate` queue
- Project state management — registers projects, stores Git credentials, and
  runs Git operations (clone + commit + push) via `simple-git` for the
  ADR-032 harness-init flow
- Dashboard serving — serves the built React dashboard as static assets +
  Server-Sent Events stream for live updates
- Oversight API — alerts, intervention endpoints, audit query

## Key exports (from `src/index.ts`)

- `createApp` — Fastify app factory
- `startServer` — full startup sequence (config → DB → repos → LLM client →
  auth manager → orchestrator worker → Fastify app + graceful shutdown)
- `registerAuthMiddleware`, `requireRole` — JWT preHandler + role guard
- `createAuthManager` — orchestrates provider registration
- `issueToken`, `verifyToken`, `extractToken` — JWT helpers
- `resolveRole`, `isDenied`, `hasPermission` — group → role resolution
- `emitLiveEvent`, `eventBus` — server-internal event bus for SSE fanout
- `registerOversightRoutes`, alert-router helpers + types

## Must never

- Import agent implementation code — agents run as separate workers and
  communicate only through the BullMQ queue
- Call LLM providers directly — LLM calls are agent responsibilities via
  `@gestalt/core/llm`
- Bypass the repository pattern for database access
- Echo Git PATs or other credentials in API responses, audit metadata, or
  log lines (see the harness-init route for the established `toPublic()` +
  cloneUrl-redaction pattern)
- Write files to a developer's local machine. The harness-init route writes
  to a **server-side clone** of the project Git repo (a temp dir cleaned up
  in `finally`), then commits and pushes — developers receive changes via
  `git pull` (ADR-032). This is the only place the server writes files to a
  project, and they only land in Git, never on the developer's machine

## Structure

```
src/
├── server.ts                # entry point (CMD in Dockerfile points here)
├── index.ts                 # public re-exports
├── app.ts                   # Fastify factory, hook + route registration
├── types.ts                 # PlatformUser, LiveEvent, ApiSuccess/Error
├── events.ts                # in-process event bus consumed by SSE
├── auth/
│   ├── auth-manager.ts      # provider orchestration + session creation
│   ├── config-loader.ts     # loads IdentityConfig from HARNESS.json
│   ├── middleware.ts        # JWT preHandler + requireRole guard
│   ├── role-mapper.ts       # group → role resolution
│   ├── routes.ts            # POST /auth/login, GET /auth/me, /auth/logout,
│   │                        # SAML/OIDC redirect+callback stubs
│   ├── session.ts           # JWT issue/verify (jose, HS256)
│   ├── types.ts             # provider configs, VerifiedIdentity, sessions
│   └── providers/           # local (bcrypt) + kerberos + oidc + saml
├── middleware/
│   ├── audit.ts             # GP-002 audit hook on non-GET 2xx responses
│   └── correlation.ts       # x-correlation-id injection
├── routes/
│   ├── admin.ts             # POST /auth/admin/setup (zero-user guarded)
│   ├── events.ts            # GET /events (SSE; token via query param)
│   ├── intents.ts           # POST /intents, GET /intents/:id, /clarify
│   ├── projects.ts          # POST /projects, GET /projects[/:id],
│   │                        # POST /projects/:id/init-harness (ADR-032)
│   └── status.ts            # GET /health, /status, /status/agents
└── oversight/
    ├── alert-router.ts      # alert build + channel resolution
    ├── routes.ts            # oversight API
    └── types.ts             # alert / intervention shapes
```

## Endpoint summary

| Method + path                       | Auth          | Purpose                                          |
|-------------------------------------|---------------|--------------------------------------------------|
| `GET  /health`                      | public        | liveness probe                                   |
| `POST /auth/admin/setup`            | public (0-user) | first-boot admin bootstrap                     |
| `POST /auth/login`                  | public        | local-provider login                             |
| `GET  /auth/me`                     | authenticated | current user                                     |
| `POST /auth/logout`                 | authenticated | client-side token discard                        |
| `GET  /events`                      | token (query) | SSE stream                                       |
| `POST /intents`                     | operator+     | submit intent → queue                            |
| `GET  /intents` / `:id` / `/clarify`| authenticated | intent listing, detail, clarification            |
| `POST /projects`                    | operator+     | register project + store PAT                     |
| `GET  /projects` / `:id`            | authenticated | list / detail (token never returned)             |
| `POST /projects/:id/init-harness`   | operator+     | clone → write harness → commit → push (ADR-032)  |
| `GET  /status` / `/status/agents`   | authenticated | platform overview, active agents                 |

## Agent orientation

For agents working on this package:

1. Read this file first to understand the package's role and boundaries
2. Read `src/types.ts` to understand the data structures
3. Read `src/index.ts` to understand what is publicly exported
4. Check `../../docs/ARCHITECTURE.md` for system-wide architectural rules
5. Check `../../AGENTS.md` for platform-wide coding conventions
6. Emit `CONTEXT_GAP` if anything needed to complete your task is missing from context
