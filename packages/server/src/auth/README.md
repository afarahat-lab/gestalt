# Server — Auth module

Full identity and authentication system. Three modes: Windows Kerberos (seamless), IdP via SAML/OIDC, and local fallback. All modes produce the same PlatformUser and JWT — downstream code is auth-mode agnostic.

---

## Files

| File | Purpose |
|---|---|
| `types.ts` | All auth and identity types — providers, users, sessions, verified identity. |
| `auth-manager.ts` | Orchestrates all providers in priority order. Single entry point for all auth. |
| `role-mapper.ts` | Maps IdP group claims to platform roles. Denies access if no mapping found. |
| `session.ts` | JWT issuance and validation. Extracts token from headers or query param. |
| `middleware.ts` | Fastify preHandler — validates JWT, attaches user to request, enforces RBAC. |
| `routes.ts` | Auth endpoints — SAML flow, OIDC flow, local login, /auth/me, logout. |

## Rules for agents working here

- Provider priority is fixed: Kerberos → SAML/OIDC → local — never change without new ADR
- Local auth never runs in production unless allowedInProduction: true — enforced in code
- Role mapping is the only place where IdP groups become platform roles
- PlatformUser is a shadow record — never the source of truth for identity
- JWT secret comes from environment variable JWT_SECRET — never hardcoded
- Service account tokens (used by agents) are validated separately — not through this module

## Context needed

- `./types.ts` — all types used in this module
- `../../README.md` — package-level orientation
- `../../../../docs/ARCHITECTURE.md` — system-wide rules
- `../../../../AGENTS.md` — platform conventions
