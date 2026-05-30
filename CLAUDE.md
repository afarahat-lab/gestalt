# CLAUDE.md — Gestalt platform

Read all imported files completely before taking any action.

@docs/claude/PLATFORM.md
@docs/claude/BUILD.md
@docs/claude/CONSTRAINTS.md
@docs/claude/DECISIONS.md
@docs/claude/STATE.md
@docs/claude/SESSION_LOG.md

## Before doing anything

1. Read all imported files above — especially `STATE.md` and `SESSION_LOG.md`
2. Read `AGENTS.md` (platform-wide coding conventions)
3. Read the relevant package `README.md` for the package you are working in
4. If anything needed is missing, state it before proceeding

## After every session — mandatory

1. Append entry to `docs/claude/SESSION_LOG.md`
2. Update `docs/claude/STATE.md`
3. Regenerate `docs/claude/SUMMARY.md` (`STATE.md` + last 3 session entries)

`SUMMARY.md` is the file the platform owner pastes into the design chat
when returning for architecture discussions. Its content is derived from
`STATE.md` and `SESSION_LOG.md` — do not edit it by hand. Do not modify
any other `docs/claude/` file unless its content is factually wrong.
