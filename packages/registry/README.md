# @agentforge-sdlc/registry

The harness registry and ecosystem layer. Enables the community to discover,
share, and contribute harness patterns, adapters, and golden principle packs.

---

## Responsibilities

- Registry API client — search, pull, and submit registry entries
- Entry validator — automated checks for all submissions
- Promotion engine — tier advancement criteria and assessment
- Tier 1 standard library — bundled harness templates

## Must never

- Install a Tier 3 entry without showing an explicit warning to the operator
- Skip checksum verification when installing from the registry
- Allow promotion threshold values to be configured — they are fixed in code
- Store registry API keys or credentials — the registry is public read, authenticated write

## Key exports

- `RegistryClient` — search, install, submit
- `validateEntry` — automated submission checks
- `assessPromotionReadiness` — check if entry meets promotion criteria
- `getNextTier` — returns the next tier in the promotion path

## Structure

```
src/
├── index.ts
├── types.ts
├── api/
│   └── client.ts          # RegistryClient — HTTP client for registry API
├── validators/
│   └── entry-validator.ts # Automated checks for submissions
└── promotion/
    └── promotion-engine.ts # Tier promotion criteria and assessment
```

## Tier model

| Tier | Managed by | Ships with platform |
|---|---|---|
| Tier 1 — Standard library | Core maintainers | Yes — bundled |
| Tier 2 — Verified registry | Community + review | No — pulled on demand |
| Tier 3 — Community registry | Community | No — pulled on demand |

## Agent orientation

1. Read this file first
2. Read `src/types.ts` for all registry types
3. Read `src/index.ts` for public exports
4. Check `../../docs/ARCHITECTURE.md` for system-wide rules
5. Emit `CONTEXT_GAP` if anything needed is missing from context
