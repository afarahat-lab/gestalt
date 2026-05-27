# HARNESS.json Configuration Reference

Complete reference for all fields in `HARNESS.json`.

Values prefixed with `${VAR}` are read from environment variables at runtime.

---

## Top-level structure

```json
{
  "name": "string",
  "version": "string",
  "tier": "tier1 | tier2 | tier3",
  "repository": "string",
  "contextFiles": ["string"],
  "stack": { ... },
  "adapters": { ... },
  "identity": { ... },
  "pipeline": { ... },
  "promotion": { ... },
  "qualityGate": { ... },
  "maintenance": { ... },
  "oversight": { ... }
}
```

---

## `identity`

Controls user authentication and authorisation.

```json
"identity": {
  "providers": [ ... ],
  "roleMapping": [ ... ],
  "defaultRole": "admin | operator | viewer | null",
  "sessionTtlMinutes": 480
}
```

### `identity.providers`

Array of auth providers in priority order. First matching provider handles the request.

#### Windows Kerberos provider

```json
{
  "type": "windows-kerberos",
  "enabled": true,
  "spn": "HTTP/agentforge.company.com",
  "realm": "COMPANY.COM",
  "kdcHostname": "${KDC_HOSTNAME}"
}
```

| Field | Required | Description |
|---|---|---|
| `spn` | Yes | Service Principal Name registered in AD. Must match server hostname exactly. |
| `realm` | Yes | Kerberos realm (AD domain in uppercase). |
| `kdcHostname` | Yes | Hostname of the Key Distribution Center (domain controller). |

See [Kerberos Setup Guide](../guides/identity/kerberos.md) for full configuration.

#### SAML 2.0 provider

```json
{
  "type": "saml",
  "enabled": true,
  "entryPoint": "https://adfs.company.com/adfs/ls",
  "issuer": "agentforge-sdlc",
  "cert": "file:///etc/agentforge/certs/adfs-signing.pem",
  "callbackUrl": "https://agentforge.company.com/auth/saml/callback"
}
```

| Field | Required | Description |
|---|---|---|
| `entryPoint` | Yes | IdP SSO URL (ADFS: `https://adfs.company.com/adfs/ls`). |
| `issuer` | Yes | SP entity ID sent to the IdP. Must match the Relying Party identifier in ADFS. |
| `cert` | Yes | IdP signing certificate. File path (`file://...`) or PEM string. |
| `callbackUrl` | Yes | Assertion Consumer Service URL. Must match what is configured in the IdP. |

See [SAML/ADFS Setup Guide](../guides/identity/saml-adfs.md).

#### OIDC provider

```json
{
  "type": "oidc",
  "enabled": true,
  "issuer": "https://login.microsoftonline.com/<TENANT_ID>/v2.0",
  "clientId": "${OIDC_CLIENT_ID}",
  "clientSecret": "${OIDC_CLIENT_SECRET}",
  "callbackUrl": "https://agentforge.company.com/auth/oidc/callback",
  "scopes": ["openid", "profile", "email", "groups"]
}
```

| Field | Required | Description |
|---|---|---|
| `issuer` | Yes | OIDC issuer URL. Azure AD: `https://login.microsoftonline.com/{tenant}/v2.0`. |
| `clientId` | Yes | Application (client) ID from the IdP app registration. |
| `clientSecret` | Yes | Client secret. Store in environment variable — never hardcode. |
| `callbackUrl` | Yes | Redirect URI registered in the IdP app. |
| `scopes` | Yes | OIDC scopes to request. Must include `openid`. |

See [Azure AD Setup Guide](../guides/identity/azure-ad.md).

#### Local fallback provider

```json
{
  "type": "local",
  "enabled": true,
  "warningBanner": true,
  "allowedInProduction": false
}
```

| Field | Required | Description |
|---|---|---|
| `warningBanner` | Yes | Show non-production warning in dashboard. Recommended: `true`. |
| `allowedInProduction` | Yes | Allow local auth in production. **Always `false` in production.** |

### `identity.roleMapping`

Maps IdP group names to platform roles. First matching entry wins.

```json
"roleMapping": [
  { "idpGroup": "AgentForge-Admins",    "platformRole": "admin" },
  { "idpGroup": "AgentForge-Operators", "platformRole": "operator" },
  { "idpGroup": "AgentForge-Viewers",   "platformRole": "viewer" }
]
```

| Provider | Group format |
|---|---|
| Windows Kerberos | `GroupName` or `DOMAIN\GroupName` |
| SAML / ADFS | `DOMAIN\GroupName` (ADFS sends qualified names) |
| Azure AD / OIDC | Group Object ID (GUID) |
| Okta | Group name as configured in Okta |

### `identity.defaultRole`

Role assigned to authenticated users with no matching group.

- `null` — deny access (recommended for production)
- `"viewer"` — grant read-only access to all authenticated users

### `identity.sessionTtlMinutes`

Duration of dashboard sessions after authentication. Default: `480` (8 hours).

---

## `pipeline`

CI/CD pipeline configuration.

```json
"pipeline": {
  "adapter": "github-actions | azure-devops | gitlab-ci | jenkins",
  "triggerConfig": {
    "organization": "${AZDO_ORG}",
    "project": "${AZDO_PROJECT}",
    "pipelineId": "${AZDO_PIPELINE_ID}"
  },
  "stages": ["lint", "test", "security-scan", "build", "deploy-dev"],
  "securityScanner": {
    "type": "fortify | checkmarx | veracode | sonarqube | semgrep | none",
    "stage": "security-scan",
    "failureSignal": "GOLDEN_PRINCIPLE_BREACH",
    "configPath": ".fortify/ssc.yml"
  }
}
```

---

## `qualityGate`

Controls the quality gate agent behaviour.

```json
"qualityGate": {
  "required": ["lint", "typecheck", "unit-tests", "integration-tests", "constraint-check", "security-scan"],
  "blockingSignals": ["GOLDEN_PRINCIPLE_BREACH", "CONSTRAINT_VIOLATION"],
  "autoResolvableSignals": ["LINT_FAILURE", "TEST_FAILURE"],
  "maxRetries": 3
}
```

| Field | Description |
|---|---|
| `maxRetries` | Maximum generate→gate cycles before escalating to human. Default: `3`. |

---

## `maintenance`

Background agent schedules. All times are UTC.

```json
"maintenance": {
  "driftCheck":     { "enabled": true, "scheduleUtc": "0 2 * * *" },
  "alignmentCheck": { "enabled": true, "scheduleUtc": "0 3 * * *" },
  "gcCheck":        { "enabled": true, "scheduleUtc": "0 4 * * 5" },
  "monitoring": {
    "adapter": "prometheus | datadog | azure-monitor",
    "connectionConfig": { ... },
    "thresholds": {
      "errorRatePercent": 5.0,
      "latencyP99Ms": 2000,
      "alertCountWindow": "1h",
      "alertCountThreshold": 10
    }
  }
}
```

---

## `oversight`

Alert routing configuration.

```json
"oversight": {
  "alertRoutes": [
    {
      "signalType": "GOLDEN_PRINCIPLE_BREACH",
      "severity": "critical",
      "channels": ["dashboard", "slack"],
      "assignee": "security-team"
    }
  ],
  "defaultChannels": ["dashboard"]
}
```

Supported channels: `dashboard` · `email` · `slack` · `webhook`
