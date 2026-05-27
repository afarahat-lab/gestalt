# Identity Integration — Overview

AgentForge SDLC integrates with your corporate identity system. Users are managed
in your existing IdP — the platform never owns user passwords or manages
the user lifecycle.

---

## Choose your integration method

| Method | Best for | User experience |
|---|---|---|
| [Windows Kerberos SSO](./kerberos.md) | Windows domain environments | No login screen — fully seamless |
| [SAML 2.0 / ADFS](./saml-adfs.md) | ADFS, on-premise AD | Redirect to ADFS login page |
| [Azure AD / Entra ID](./azure-ad.md) | Microsoft 365 / Azure environments | Redirect to Microsoft login |
| [Okta](./okta.md) | Okta-managed environments | Redirect to Okta login |

**Recommended for GCC/MENA enterprise:** Start with Kerberos if users are on
domain-joined Windows machines (most common). Fall back to SAML/ADFS if not.

---

## Authentication priority

When multiple providers are enabled, requests are handled in this fixed order:

```
1. Windows Kerberos  — if Authorization: Negotiate header present
2. SAML or OIDC      — if IdP configured, redirect flow
3. Local fallback    — only if explicitly enabled (non-production)
```

---

## Role mapping

All IdP users are mapped to one of three platform roles:

| Role | Permissions |
|---|---|
| **admin** | Full access — manage users, trigger maintenance, all interventions |
| **operator** | Submit intents, approve promotions, provide clarifications |
| **viewer** | Read-only — view dashboard, logs, intent history |

Role assignment is controlled by AD/IdP group membership configured in HARNESS.json.
Users with no matching group are denied access by default.

---

## Local fallback

A local username/password mode is available for development and pre-IdP adoption.

**Important limitations:**
- Non-production only — blocked in production by default
- Shows a warning banner in the dashboard when active
- User management is manual — no synchronisation with corporate systems
- Use only until corporate IdP integration is configured

See [Quick Start Guide](../quick-start.md) for local fallback setup.

---

## Service accounts (agents)

Platform agents authenticate using API keys, not IdP credentials.
Service account keys are generated at init time and stored in the server environment.
They are separate from human user authentication.

---

## Deprovisioning

When a user leaves the organisation:
- Remove them from the AD groups (AgentForge-Admins/Operators/Viewers)
- Their existing JWT sessions expire within `sessionTtlMinutes` (default: 8 hours)
- No action required in AgentForge — the platform does not own the identity

For immediate access revocation, restart the server to invalidate all sessions:
```bash
docker-compose restart server
```

A token blocklist for immediate revocation without restart is planned for a future release.
