# Registry — Promotion engine

Manages the tier promotion pathway. Assesses whether an entry meets the criteria to advance.

---

## Files

| File | Purpose |
|---|---|
| `promotion-engine.ts` | assessPromotionReadiness(), getNextTier(). Tier 3→2 and 2→1 threshold definitions. |

## Rules for agents working here

- Promotion thresholds are non-negotiable — changing them requires a maintainer ADR
- Tier 2→1 requires 3+ production projects — this cannot be waived
- Promotion is always forward — no tier demotion except to 'deprecated'

## Context needed

- `../types.ts` — all types
- `../../../README.md` — package orientation
- `../../../../../docs/ARCHITECTURE.md` — system-wide rules
