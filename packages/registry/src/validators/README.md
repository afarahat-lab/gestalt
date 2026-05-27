# Registry — Entry validators

Automated checks run on all registry submissions. Must pass before any tier acceptance.

---

## Files

| File | Purpose |
|---|---|
| `entry-validator.ts` | Schema validation, harness completeness, secret detection, README check. |

## Rules for agents working here

- All checks must pass for Tier 3 acceptance
- Additional checks required for Tier 2 promotion
- No check result can be overridden without a maintainer decision
- Secret detection patterns are conservative — false positives are acceptable

## Context needed

- `../types.ts` — all types
- `../../../README.md` — package orientation
- `../../../../../docs/ARCHITECTURE.md` — system-wide rules
