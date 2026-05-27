# AGENTS.md — Corporate Operations Web & Mobile Template

This file is the agent orientation document for projects using the
AgentForge SDLC corporate operations web & mobile template.

Read this file before taking any action on this project.

---

## What this project is

A corporate operations web and mobile application. Common patterns include:
approval workflows, role-based dashboards, HR/Finance/Procurement self-service,
reporting, enterprise system integrations, and audit-required operations.

---

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode) |
| Backend | Node.js 20+ / Fastify |
| Frontend web | React 18 + Vite |
| Frontend mobile | React Native (Expo) |
| Database | See HARNESS.json adapters config |
| Auth | Corporate SSO (SAML/OIDC/Kerberos) |
| Testing | Vitest (unit/integration), Playwright (E2E) |

---

## Architecture: modular monolith

```
src/
├── modules/
│   ├── auth/          # authentication, sessions, RBAC
│   ├── users/         # user management, profiles
│   ├── workflows/     # approval workflow engine
│   ├── audit/         # audit trail (GP-002)
│   ├── notifications/ # in-app and email notifications
│   └── [domain]/      # your business domain modules
├── shared/
│   ├── db/            # repository pattern implementations
│   ├── queue/         # background job queue
│   └── utils/         # shared utilities
└── api/               # API route registration
```

---

## Module boundary rules (enforced by linter)

1. Modules never import from each other's internals — only from index.ts exports
2. Shared utilities live in `src/shared/` — never duplicated in modules
3. Database access only through repository pattern in `src/shared/db/`
4. No circular dependencies between modules

---

## Domain model primitives (always present)

Every corporate ops project starts with these entities:
- `User` — platform user with role and organisation
- `Organisation` — tenant (single or multi-tenant)
- `Role` — RBAC role definition
- `Permission` — granular permission
- `AuditLog` — immutable operation record (GP-002)
- `Notification` — in-app notification
- `WorkflowInstance` — approval workflow state

---

## Coding conventions

- TypeScript strict mode — no `any`, explicit return types
- Repository pattern for all data access
- Every state-changing API endpoint writes an AuditLog record
- RBAC enforced via middleware — never inline in route handlers
- Input validation at API boundary using Zod schemas

---

## What agents must never do

- Bypass the repository pattern for data access
- Write route handlers without RBAC middleware
- Create state-changing operations without audit logging
- Add direct database queries outside repository classes
- Store user passwords (SSO only — no local passwords in the application)
- Expose internal database IDs in API responses (use UUIDs)

---

## Context files

| File | Purpose |
|---|---|
| `AGENTS.md` | This file |
| `ARCHITECTURE.md` | Full modular architecture spec |
| `DOMAIN.md` | Business domain model |
| `DECISIONS.md` | Architecture decisions |
| `GOLDEN_PRINCIPLES.md` | Non-negotiables for this project |
| `HARNESS.json` | Machine-readable configuration |
