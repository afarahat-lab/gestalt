# Dashboard — API client

Typed HTTP client for all server communication. Single source for all data fetching — no raw fetch calls elsewhere.

---

## Files

| File | Purpose |
|---|---|
| `client.ts` | DashboardApiClient — typed methods for every server endpoint, SSE subscription. |

## Rules for agents working here

- All data access goes through DashboardApiClient — never raw fetch in components
- ApiError is thrown on non-2xx responses — components handle it
- Token is set once after login and stored in the client instance
- subscribeLiveEvents returns a cleanup function — always call it in useEffect cleanup

## Context needed

- `../types.ts` — all types used in this directory
- `../../../README.md` — package-level orientation
- `../../../../../docs/ARCHITECTURE.md` — system-wide rules
- `../../../../../AGENTS.md` — platform conventions
