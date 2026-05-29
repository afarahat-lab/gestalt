# @gestalt/cli

The developer-facing interface to Gestalt. Communicates with the server over HTTP. Developers interact with this daily; it should feel fast, clear, and informative.

---

## Responsibilities

- `gestalt login` — authenticate against the server, store JWT locally
- `gestalt init-admin` — bootstrap the first admin on a fresh platform
  (zero-user guarded, TTY-only)
- `gestalt init` — register a project (name + Git URL + PAT) and have the
  server clone the repo, write harness files, commit, and push (ADR-032)
- `gestalt projects list` — table of registered projects, marks the current one
- `gestalt projects use <name>` — switch the current project
- `gestalt run "<intent>"` — submit an intent to the generate layer
- `gestalt status` — current agent activity + recent intents for the
  current project
- `gestalt logs` — stream the execution log over SSE
- `gestalt dashboard` — open the oversight dashboard in the browser

## Key exports

- `loginCommand` — sign in, persist JWT to `~/.gestalt/config.json`
- `initAdminCommand` — first-boot `POST /auth/admin/setup` flow
- `initCommand` — project-registration wizard (the Git-first ADR-032 flow)
- `projectsListCommand` / `projectsUseCommand` — list and switch projects
- `runCommand` — intent submission
- `statusCommand` — platform + intent status

## Must never

- Call the database directly — always go through the server API
- Call LLM providers directly — the LLM lives on the server
- Import from agent packages — CLI has no knowledge of agent internals
- Write project harness files locally — harness creation goes through
  `POST /projects/:id/init-harness` and lands in the project's Git repo
  (ADR-032). The developer runs `git pull` to receive them
- Echo Git PATs or JWTs in any output — `promptSecret` is used for hidden
  input; tokens live only in `~/.gestalt/config.json` and never appear in
  CLI logs

## Structure

```
src/
├── index.ts                  # CLI entry point, command registration
├── types.ts                  # CliConfig, command option types
├── commands/
│   ├── login.ts              # gestalt login
│   ├── init-admin.ts         # gestalt init-admin (first-boot)
│   ├── init.ts               # gestalt init (project registration + Git)
│   ├── projects.ts           # gestalt projects list / use
│   ├── run.ts                # gestalt run
│   ├── status.ts             # gestalt status
│   └── logs.ts               # gestalt logs + gestalt dashboard
├── api/
│   └── client.ts             # typed HTTP client for the server API
└── ui/
    ├── prompts.ts            # readline + raw-mode promptSecret
    └── config.ts             # load/save ~/.gestalt/config.json
```

## Agent orientation

For agents working on this package:

1. Read this file first to understand the package's role and boundaries
2. Read `src/types.ts` to understand the data structures
3. Read `src/index.ts` to understand what is publicly exported
4. Check `../../docs/ARCHITECTURE.md` for system-wide architectural rules
5. Check `../../AGENTS.md` for platform-wide coding conventions
6. Emit `CONTEXT_GAP` if anything needed to complete your task is missing from context
