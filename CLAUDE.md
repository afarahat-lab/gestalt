# CLAUDE.md — Gestalt platform

Read the imported files completely before taking any action.

## Always loaded (every session)

@docs/claude/STATE.md
@docs/claude/BUILD.md
@docs/claude/CONSTRAINTS.md
@docs/claude/sessions/RECENT.md

## Read on demand (when relevant to the task)

- `@docs/claude/ARCHITECTURE.md` — when modifying packages,
  adapters, or anything that crosses a package boundary.
- `@docs/claude/DECISIONS.md` — when making architectural decisions
  or touching code an ADR governs.
- `@docs/claude/sessions/archive/*.md` — when debugging historical
  issues or referencing past decisions that have rolled off
  `RECENT.md`.

## Before doing anything

1. Read the always-loaded files above (Claude Code does this for
   you via the `@` imports).
2. Read `AGENTS.md` (platform-wide coding conventions, at the repo
   root).
3. Read the relevant package `README.md` for the package you are
   working in.
4. If anything needed is missing, state it before proceeding.

## After every session — mandatory

1. **Update `docs/claude/STATE.md`:**
   - Mark completed items.
   - Add new pending items.
   - Remove resolved follow-ups.
   - **Target: keep the file under 15KB.** If it grows beyond
     that, prune the verbose narrative and rely on
     `sessions/RECENT.md` for the "how it was built" detail.

2. **Update `docs/claude/BUILD.md`:**
   - Refresh the build-status row + migration count.
   - Update "Pending operator actions" — remove resolved ones,
     add new ones.

3. **Update `docs/claude/sessions/RECENT.md`:**
   - **Prepend** the new session entry at the top of the file
     (just below the file header).
   - If the file now contains more than 3 session entries:
     - Move the **oldest** session entry to the correct archive
       file (`sessions/archive/<period>.md`). Create the archive
       file if it does not exist (e.g. when crossing into a new
       week/month, create `2026-06-w2.md`).
     - Remove the moved entry from `RECENT.md`.
   - **Target: keep `RECENT.md` under 40KB** (Claude Code's
     large-file warning threshold). If 3 verbose sessions exceed
     40KB, rotate the oldest into the archive even if there are
     only 3.

4. **Regenerate `docs/claude/SUMMARY.md`** from `STATE.md` +
   `BUILD.md` + `sessions/RECENT.md`:
   ```bash
   {
     printf '# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md\n\n'
     printf '_Auto-regenerated after every session by Claude Code. Do not edit by hand._\n\n'
     printf '_Generated: %s_\n\n---\n\n' "$(date +%Y-%m-%d)"
     tail -n +2 docs/claude/STATE.md
     printf '\n---\n\n'
     tail -n +2 docs/claude/BUILD.md
     printf '\n---\n\n'
     tail -n +2 docs/claude/sessions/RECENT.md
   } > docs/claude/SUMMARY.md
   ```

`SUMMARY.md` is what the platform owner pastes into the design
chat when returning for architecture discussions. Do not edit it
by hand. Do not modify any other `docs/claude/` file unless its
content is factually wrong.

## File-size targets (Claude Code performance)

Claude Code warns on files > 40KB. The modular structure exists
to keep every always-loaded file well under that.

| File | Target | Loaded |
|---|---|---|
| `STATE.md` | < 15KB | every session |
| `BUILD.md` | < 5KB | every session |
| `CONSTRAINTS.md` | < 10KB | every session |
| `sessions/RECENT.md` | < 40KB (3 sessions) | every session |
| `ARCHITECTURE.md` | < 15KB | on demand |
| `DECISIONS.md` | < 10KB | on demand |
| `sessions/archive/*.md` | append-only, any size | on demand |
| `SUMMARY.md` | regenerated | never (Claude Code) |
