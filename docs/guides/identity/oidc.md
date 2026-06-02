# OpenID Connect (OIDC) — Identity Integration Guide

Generic OIDC configuration applicable to any OIDC 1.0–compliant IdP
(Azure AD / Entra ID, Okta, Auth0, Google Workspace SSO, Keycloak).
For Azure AD specifics see [azure-ad.md](./azure-ad.md).

ADR references: ADR-024 (provider priority), ADR-040 (auth.config.json
schema).

---

## Flow (authorization code with PKCE)

```
1. User clicks `Sign in with Azure AD (OIDC)` on the dashboard login
2. Server generates state + PKCE verifier, stores them keyed by state,
   redirects to <issuer>/authorize
3. User authenticates at the IdP
4. IdP redirects to /auth/oidc/callback?code=...&state=...
5. Server validates state, exchanges code for ID token + access token
6. Server extracts identity from the ID token claims
7. Server issues a JWT, redirects to /app/?token=<jwt>
8. Dashboard picks up the token, stores it in localStorage
```

State + PKCE verifier are stored in-memory with a 10-minute TTL. A
server restart mid-flow invalidates pending logins (user retries —
no permanent issue). Production HA deployments (multiple replicas)
need Redis-backed state — future enhancement.

---

## Pre-flight checklist

- [ ] Public DNS for the Gestalt server (e.g. `gestalt.company.com`)
- [ ] HTTPS endpoint (the IdP requires `https://` callback URIs)
- [ ] OIDC IdP issuer URL (e.g.
      `https://login.microsoftonline.com/<tenantId>/v2.0`)
- [ ] App registration at the IdP with `client_id` + `client_secret`

---

## auth.config.json

```json
{
  "providers": {
    "oidc": {
      "enabled": true,
      "issuer": "https://login.microsoftonline.com/<tenantId>/v2.0",
      "clientId": "<azure-app-client-id>",
      "clientSecret": "<azure-app-client-secret>",
      "redirectUri": "https://gestalt.company.com/auth/oidc/callback",
      "scope": "openid profile email groups",
      "groupsClaim": "groups"
    }
  },
  "roleMapping": {
    "platformAdmin": ["gestalt-admins"],
    "defaultRole": "user"
  }
}
```

| Field | Purpose |
|---|---|
| `issuer` | The OIDC issuer base. Discovery hits `<issuer>/.well-known/openid-configuration` at startup to fetch endpoint URLs. |
| `clientId` / `clientSecret` | From the IdP app registration. |
| `redirectUri` | MUST exactly match the redirect URI registered at the IdP. |
| `scope` | Space-separated. `openid` is required; `profile` + `email` are typical; `groups` (or whatever your IdP uses) needed if you want group-based role mapping. |
| `groupsClaim` | Name of the ID-token claim that holds group IDs. Azure AD uses `groups`. Okta uses `groups`. Some IdPs use a custom claim — adjust to match. |

## Registering Gestalt at the IdP

The redirect URI MUST be added to the IdP's app registration:

```
https://gestalt.company.com/auth/oidc/callback
```

The IdP must also be configured to release the `email` and (if you
want group-based role mapping) `groups` claims to the ID token.

### Azure AD — group claim configuration

By default Azure AD only releases group IDs (GUIDs), not group names.
You can either:

1. **Use group IDs in roleMapping** — set `roleMapping.platformAdmin`
   to the Azure AD group object IDs (UUIDs).
2. **Configure Azure AD to release group names** — in the app
   registration's Token Configuration, add a Groups claim and select
   `sAMAccountName` (for synced groups) or `Name`.

## Testing

```bash
# Confirm the login redirect generates a valid OIDC authorization URL
curl -v -L https://gestalt.company.com/auth/oidc/login
# Expect a 302 with Location pointing at the IdP's /authorize endpoint
# carrying client_id, scope, state, code_challenge, redirect_uri
```

End-to-end: open `/app/login`, click `Sign in with Azure AD (OIDC)`,
complete IdP auth, land back on the dashboard.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `OIDC issuer discovery failed` at startup | The IdP issuer URL is wrong or the server can't reach the IdP. Verify `curl <issuer>/.well-known/openid-configuration` works from the server. |
| `OIDC state mismatch or expired` | Either the user took >10 minutes to complete auth, or the server restarted mid-flow. Retry. |
| `OIDC ID token missing email claim` | The IdP isn't releasing the email scope. Verify the app registration's scope grants + the scope string in `auth.config.json`. |
| `ACCESS_DENIED` after successful OIDC | User isn't in any group listed under `roleMapping.platformAdmin` AND `defaultRole` is null. Either add the group or set `defaultRole: "user"`. |
| `OIDC callback exchange failed: invalid_grant` | The `redirectUri` in `auth.config.json` doesn't EXACTLY match what's registered at the IdP (often a trailing slash or path-case mismatch). |
