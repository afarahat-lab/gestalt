# CONSTRAINTS.md — Hard rules Claude Code must follow

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

## Architecture decisions to respect

All ADRs live in `docs/DECISIONS.md`. The subset Claude Code most needs
to keep in mind on every change is summarised in
[@docs/claude/DECISIONS.md](./DECISIONS.md). Read that file before
editing the deploy layer, the maintenance layer, the orchestrator, or
anything that touches a project's Git tree.

---

## What to do if context is missing

If you need information about a layer, component, or decision that isn't in
this file or in `AGENTS.md`, check:

1. The relevant `docs/` file
2. The package `README.md`
3. The source file itself — it has JSDoc comments
4. Ask in your response before making assumptions

---

## Known architectural constraints Claude Code must respect

- pnpm 9.x only (Node 20 compatibility)
- No direct DB access outside adapter packages
- No direct LLM calls outside @gestalt/core/llm
- GOLDEN_PRINCIPLE_BREACH signals are never auto-resolved
- All state-changing operations write an audit record (GP-002)
- Server must not import from packages/dashboard/src — use server-local type mirrors
- /events SSE route is canonical in routes/events.ts — do not re-register elsewhere
- Git token must never appear in API responses or logs
- `simple-git` for all Git operations — never child_process.exec('git ...')
- Temp dirs must be cleaned in a finally block — always, even on error
- Migration files must NOT contain CREATE TABLE schema_migrations or INSERT
  INTO schema_migrations — the runner handles that
