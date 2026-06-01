# Golden Principles

These invariants are non-negotiable. Violations produce
`GOLDEN_PRINCIPLE_BREACH` signals and require human review.

## GP-001 — Every state-changing operation produces an audit record

Any API endpoint that creates, updates, or deletes data must write an
`AuditLog` record before the operation completes.

## GP-002 — RBAC enforced at middleware, never inline

Role-based access control is enforced by middleware on every route.

## GP-003 — Input validated at the API boundary

All request bodies validated with Zod (or equivalent) before reaching
handlers.

## GP-004 — No sensitive data in logs

PII, tokens, passwords, and PCI/PHI data must never appear in log lines.
