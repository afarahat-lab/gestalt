# AGENTS.md — AgentForge SDLC platform repository

This file is the primary orientation document for any AI agent working on this repository.
Read this file completely before taking any action.

---

## What this repository is

AgentForge SDLC is a self-hosted agent-first software development platform. It is a monorepo containing:
- The core harness engine
- A CLI tool
- A self-hosted server
- A React dashboard
- Agent implementations (generate, quality-gate, deploy, maintenance)
- Database adapters (PostgreSQL, Oracle, SQL Server)
- Tier 1 standard library harness templates

---

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode, no `any`) |
| Runtime | Node.js 20+ |
| Package manager | pnpm workspaces |
| Backend framework | Fastify |
| Frontend framework | React 18 + Vite |
| Database (default) | PostgreSQL 15 |
| Message queue | BullMQ + Redis 7 |
| Testing | Vitest |
| Linting | ESLint + Prettier |
| Containerization | Docker + Docker Compose |

---

## Architecture rules (enforced by constraint linter)

1. **Packages never import from each other's `src/` directly.** Only from published package interfaces (index.ts exports).
2. **Agents never import from other agents.** All inter-agent communication goes through the message queue via `@agentforge-sdlc/core`.
3. **Adapters implement the repository interface defined in `@agentforge-sdlc/core`.** No adapter-specific code outside the adapter package.
4. **No direct database calls outside adapter packages.** All data access through the repository pattern.
5. **No LLM provider SDK imported outside `@agentforge-sdlc/core/llm`.** Provider abstraction lives in core only.
6. **Every exported function must have a JSDoc comment** describing its purpose, parameters, and return value.
7. **Every agent task must emit structured logs** using the platform logger, never `console.log`.

---

## Folder conventions

```
packages/<name>/
├── src/
│   ├── index.ts          # public exports only — this is the package interface
│   ├── types.ts          # all TypeScript types and interfaces for this package
│   └── ...               # implementation files
├── tests/
│   └── ...               # Vitest test files mirroring src/ structure
├── package.json
└── README.md
```

---

## Coding conventions

- **Functional style preferred** over class-based where it makes sense. Classes for stateful services (queue workers, server).
- **Explicit return types** on all exported functions.
- **Named exports** only — no default exports except React components.
- **Error handling**: never swallow errors silently. All errors are either returned as typed `Result<T, E>` or thrown with structured context.
- **Environment variables** accessed only through `@agentforge-sdlc/core/config`, never `process.env` directly.
- **No magic strings** — all constants defined in `types.ts` as string literal unions or enums.

---

## Feedback signal vocabulary

When an agent encounters a failure, it must emit one of these typed signals — never a generic error:

| Signal | When to use |
|---|---|
| `CONSTRAINT_VIOLATION` | Code broke an architectural rule |
| `GOLDEN_PRINCIPLE_BREACH` | Non-negotiable violated (security, compliance, audit) |
| `TEST_FAILURE` | A test failed |
| `LINT_FAILURE` | Style or static analysis failure |
| `CONTEXT_GAP` | Task could not complete due to missing context |

---

## What agents must never do

- Write directly to the database outside adapter packages
- Call an LLM provider directly — always use `@agentforge-sdlc/core/llm`
- Merge a PR with an open `GOLDEN_PRINCIPLE_BREACH` signal
- Modify `GOLDEN_PRINCIPLES.md` without creating a corresponding ADR in `docs/DECISIONS.md`
- Delete or overwrite `AGENTS.md`, `ARCHITECTURE.md`, or `GOLDEN_PRINCIPLES.md`
- Suppress TypeScript errors with `@ts-ignore` or `as any`

---

## Context files

| File | Purpose |
|---|---|
| `AGENTS.md` | Agent orientation (this file) |
| `docs/ARCHITECTURE.md` | Full system architecture |
| `docs/DECISIONS.md` | Architecture decision records |
| `docs/DOMAIN.md` | Platform domain model |
| `docs/GOLDEN_PRINCIPLES.md` | Non-negotiable invariants |
| `HARNESS.json` | Machine-readable harness metadata |

---

## When context is missing

If a task cannot be completed because context is missing or ambiguous:
1. Do not guess or hallucinate structure
2. Emit a `CONTEXT_GAP` signal with the specific missing information identified
3. Suggest what context file should be updated to resolve the gap
