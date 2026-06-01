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
  "spn": "HTTP/gestalt.company.com",
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
  "issuer": "gestalt",
  "cert": "file:///etc/gestalt/certs/adfs-signing.pem",
  "callbackUrl": "https://gestalt.company.com/auth/saml/callback"
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
  "callbackUrl": "https://gestalt.company.com/auth/oidc/callback",
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
  { "idpGroup": "Gestalt-Admins",    "platformRole": "admin" },
  { "idpGroup": "Gestalt-Operators", "platformRole": "operator" },
  { "idpGroup": "Gestalt-Viewers",   "platformRole": "viewer" }
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

---

## `agents.yaml` — per-agent configuration

Lives alongside `HARNESS.json` in the project repo root. Read fresh from each
per-cycle clone (ADR-032), so edits + a push take effect on the next intent
cycle without a server restart.

```yaml
agents:
  intent-agent:
    role: "Senior software architect"
    goal: "Extract a precise, unambiguous specification from a natural language intent"
    llm:
      model: ~              # null = use platform default (LLM_MODEL env var)
      temperature: 0.1
      max_tokens: 2000
    prompt_extensions: []
  code-agent:
    role: "Senior TypeScript engineer"
    goal: "Generate production-quality TypeScript code that follows the project harness"
    llm:
      model: "gpt-4o"       # Override the default model for this agent
      temperature: 0.2
      max_tokens: 8000
    prompt_extensions:
      - "Always add a JSDoc comment to every exported function"
      - "Use Result<T,E> pattern for error handling"
```

### Schema

Each entry under `agents:` is keyed by `AgentRole` (`intent-agent`,
`design-agent`, `context-agent`, `code-agent`, `test-agent`, `review-agent`,
`drift-agent`, `alignment-agent`, `context-fixer`). Infrastructure agents
(`constraint-agent`, `test-runner-agent`, `pipeline-agent`,
`promotion-agent`, `gc-agent`) do deterministic work and ignore this file.

| Field | Type | Purpose |
|---|---|---|
| `role` | string | Becomes "You are `<role>` working on the Gestalt platform." |
| `goal` | string | One sentence appended to the persona block |
| `llm.model` | string \| null | Override the platform default model for this agent. `~` (null) means "use the default". Reuses platform `baseUrl` + `apiKey` — only the model name changes on the wire |
| `llm.temperature` | number | Override the LLM client's temperature for this agent |
| `llm.max_tokens` | number | Override the LLM client's max-tokens for this agent (camelCase `maxTokens` also accepted) |
| `prompt_extensions` | string[] | Standing project rules appended to every prompt under "Project-specific instructions" (camelCase `promptExtensions` also accepted) |

### Behaviour

- Absent file → per-role defaults (seeded by `gestalt init` would match these)
- Malformed YAML → defaults, debug-logged
- Agent absent from `agents:` map → per-role default for that agent
- Partial entry (only `role`, no `llm.temperature`) → merged with defaults
- `model: ~` (YAML null) → platform default (same as omitting the field)
- The model the orchestrator routed to is persisted into
  `agent_execution_logs.model_used` and shown in the dashboard's IntentDetail
  panel as `Model: gpt-4o-mini` / etc.
