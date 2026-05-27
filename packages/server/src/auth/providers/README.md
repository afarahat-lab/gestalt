# Server — Auth providers

One provider per auth mode. Each implements the AuthProvider interface. The auth manager selects the right one per request.

---

## Files

| File | Purpose |
|---|---|
| `kerberos.ts` | Windows domain SSO — SPNEGO/Kerberos. Seamless for domain-joined machines. |
| `saml.ts` | SAML 2.0 — ADFS, on-premise AD, any SAML IdP. |
| `oidc.ts` | OpenID Connect — Azure AD/Entra ID, Okta, any OIDC IdP. |
| `local.ts` | Local username/password fallback. Non-production only. |

## Rules for agents working here

- Every provider must implement canHandle() and authenticate()
- canHandle() must be fast and synchronous — just inspects headers
- authenticate() returns VerifiedIdentity or null — never throws on 'not my request'
- authenticate() throws AuthenticationError on invalid credentials or tokens
- Local provider must check NODE_ENV and reject if production
- All providers extract groups — role mapping happens in role-mapper.ts, not here

## Context needed

- `./types.ts` — all types used in this module
- `../../README.md` — package-level orientation
- `../../../../docs/ARCHITECTURE.md` — system-wide rules
- `../../../../AGENTS.md` — platform conventions
