# SAML 2.0 — Identity Integration Guide

Generic SAML configuration applicable to any SAML 2.0–compliant IdP
(ADFS, Azure AD as SAML SP, Okta, PingFederate, Shibboleth). For
IdP-specific deep-dives see [saml-adfs.md](./saml-adfs.md).

ADR references: ADR-024 (provider priority), ADR-040 (auth.config.json
schema).

---

## Flow

```
1. User clicks `Sign in with Corporate SSO (SAML)` on the dashboard login
2. Server redirects browser to the IdP `entryPoint` with a SAMLRequest
3. User authenticates at the IdP
4. IdP posts a signed SAMLResponse to /auth/saml/callback
5. Server validates the signature against the IdP `cert`, extracts attributes
6. Server issues a JWT, redirects to /app/?token=<jwt>
7. Dashboard picks up the token from the URL, stores it in localStorage
```

---

## Pre-flight checklist

- [ ] Public DNS for the Gestalt server (e.g. `gestalt.company.com`)
- [ ] TLS certificate on the public hostname (the IdP requires HTTPS for ACS)
- [ ] IdP `entryPoint` URL — usually
      `https://<idp>/adfs/ls/` (ADFS) or
      `https://login.microsoftonline.com/<tenant>/saml2` (Azure AD SAML)
- [ ] IdP signing certificate exported as PEM (`-----BEGIN CERTIFICATE-----` ...)

---

## auth.config.json

```json
{
  "providers": {
    "saml": {
      "enabled": true,
      "entryPoint": "https://adfs.company.com/adfs/ls/",
      "issuer": "https://gestalt.company.com",
      "cert": "MIIBkTCB+wIJAJ...<single-line-PEM-without-BEGIN/END>...EAxYBKQ==",
      "callbackUrl": "https://gestalt.company.com/auth/saml/callback",
      "wantAssertionsSigned": true,
      "identifierFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      "attributeMapping": {
        "email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        "displayName": "http://schemas.microsoft.com/ws/2008/06/identity/claims/displayname",
        "groups": "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
      }
    }
  },
  "roleMapping": {
    "platformAdmin": ["Gestalt-Admins"],
    "defaultRole": "user"
  }
}
```

- `issuer` — the SP entity ID Gestalt presents to the IdP. Use the
  HTTPS URL you configured the IdP to recognise.
- `cert` — the IdP's signing certificate as a single-line string
  (strip the `-----BEGIN/END CERTIFICATE-----` markers and the
  newlines).
- `attributeMapping` — adjust per IdP; the defaults above match Azure
  AD's SAML claim URIs.

## Common attribute mappings

| IdP | email | displayName | groups |
|---|---|---|---|
| ADFS (default) | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `http://schemas.microsoft.com/ws/2008/06/identity/claims/displayname` | `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups` |
| Azure AD (SAML) | same as ADFS | same as ADFS | `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups` |
| Okta | `email` | `displayName` | `groups` |
| PingFederate | configurable — match your IdP setup | configurable | configurable |

## Registering Gestalt at the IdP

Most IdPs need three pieces of info to add Gestalt as a Relying Party
/ Service Provider:

1. **Entity ID** = the `issuer` field above
2. **ACS URL** (Assertion Consumer Service) = the `callbackUrl`
3. **SP metadata** — Gestalt exposes this at:
   `https://gestalt.company.com/auth/saml/metadata`

Most IdPs let you upload the SP metadata XML directly — simply hand
the metadata URL to your IdP administrator.

## Testing

```bash
# Confirm metadata is served
curl https://gestalt.company.com/auth/saml/metadata

# Confirm the login redirect generates a SAMLRequest
curl -v -L https://gestalt.company.com/auth/saml/login
# Expect a 302 with Location pointing at <entryPoint>?SAMLRequest=...
```

End-to-end: open the dashboard `/app/login`, click `Sign in with
Corporate SSO`, complete IdP auth, land back on the dashboard. The
URL bar shows `/app/?token=<jwt>` briefly before the SPA strips the
token and stores it in localStorage.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `SAML validation failed: Invalid signature` | The `cert` in `auth.config.json` doesn't match the IdP. Re-export and re-paste (strip BEGIN/END + newlines). |
| `SAML assertion missing email attribute` | IdP isn't releasing the email claim. Verify the IdP's claim/attribute release rules; check the `attributeMapping.email` URI matches what the IdP sends. |
| Browser stuck on IdP login screen | The IdP doesn't recognise our `issuer` / Entity ID. Verify the SP is registered. |
| `ACCESS_DENIED` after successful SAML | User isn't in any group listed under `roleMapping.platformAdmin` AND `defaultRole` is null. Either add the user's group or set `defaultRole: "user"`. |
