# Registry — API client

Typed HTTP client for the AgentForge registry service. Used by the CLI and harness initializer to search, pull, and submit registry entries.

---

## Files

| File | Purpose |
|---|---|
| `client.ts` | RegistryClient — search, install, submit. Configurable base URL for internal mirrors. |

## Rules for agents working here

- Default registry URL is https://registry.agentforge.dev — overridable for air-gapped environments
- Tier 1 entries are bundled with the platform — registry call is for version checking only
- Tier 3 installations show an explicit warning before proceeding
- All git clones are verified against checksumSha256 before installation

## Context needed

- `../types.ts` — all types
- `../../../README.md` — package orientation
- `../../../../../docs/ARCHITECTURE.md` — system-wide rules
