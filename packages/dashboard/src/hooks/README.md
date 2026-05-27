# Dashboard — Hooks

React hooks for API access and live events. Shared across all views.

---

## Files

| File | Purpose |
|---|---|
| `useApi.ts` | useDashboardApi() — returns the shared API client from context. |
| `useLiveEvents.ts` | useLiveEvents() and useLiveEvent() — SSE subscription with auto-cleanup. |

## Rules for agents working here

- useDashboardApi() throws if used outside ApiProvider — always wrap at app root
- useLiveEvent() takes a specific event type — never subscribe to all events in one component
- SSE cleanup is automatic on unmount — no manual cleanup needed by consumers

## Context needed

- `../types.ts` — all types used in this directory
- `../../../README.md` — package-level orientation
- `../../../../../docs/ARCHITECTURE.md` — system-wide rules
- `../../../../../AGENTS.md` — platform conventions
