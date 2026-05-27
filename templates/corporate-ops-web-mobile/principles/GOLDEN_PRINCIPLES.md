# Golden Principles — Corporate Operations Web & Mobile

These principles are non-negotiable for all corporate operations applications
built with this template. They reflect the compliance and security requirements
common to enterprise operations software.

Violations produce `GOLDEN_PRINCIPLE_BREACH` and require human review.

---

## GP-001 — Every state-changing operation produces an audit record

Any API endpoint that creates, updates, or deletes data must write an
`AuditLog` record before the operation completes.

The audit record must include:
- Actor (user ID + role)
- Action (typed enum — never a free-form string)
- Affected entity (type + ID)
- Timestamp (UTC)
- Request correlation ID
- IP address (for compliance)

**Enforcement:** AuditLog middleware on all non-GET routes.

---

## GP-002 — RBAC enforced at middleware, never inline

Role-based access control is enforced by middleware on every route.
Route handlers never contain `if (user.role === ...)` checks.

**Enforcement:** ESLint rule banning `user.role` comparisons outside middleware files.

---

## GP-003 — No plaintext passwords

The application never stores, processes, or logs passwords.
Authentication is delegated entirely to the corporate IdP (SSO).
If a route receives a `password` field, it must reject the request.

**Enforcement:** ESLint rule banning any variable or property named `password`
outside the auth module's SSO integration.

---

## GP-004 — UUIDs in all external interfaces

Database internal IDs (auto-increment integers, Oracle sequences) are never
exposed in API responses, URLs, or client-side code.
All external identifiers are UUIDs.

**Enforcement:** API response validator checks for numeric `id` fields.

---

## GP-005 — Input validated at API boundary

All incoming data is validated against a Zod schema at the API boundary,
before it reaches business logic or the database.
No raw `request.body` access in route handlers or service functions.

**Enforcement:** ESLint rule requiring Zod validation before request body usage.

---

## GP-006 — Sensitive data never in logs

User personal data (names, emails, phone numbers), financial data, and
health data must never appear in application logs.
Log the entity ID — never the entity content.

**Enforcement:** Logger wrapper that strips known sensitive field names.

---

## GP-007 — Approval workflows are immutable once completed

A completed approval workflow instance cannot be modified or deleted.
Status transitions are one-way: `draft → submitted → approved/rejected`.
Reversals require creating a new workflow instance with a reference to the original.

**Enforcement:** Repository layer rejects updates to completed workflow instances.
