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

---

## `custom_agents` — project-defined LLM agents (ADR-037)

Add `custom_agents:` at the top level of `agents.yaml` to declare
project-specific LLM agents that run after the framework generate agents
and before dispatch to the quality gate. They receive the generated
artifacts as part of their prompt and return structured findings:

```yaml
custom_agents:
  - name: security-review-agent
    role: "Application security reviewer"
    goal: "Identify OWASP Top 10 vulnerabilities in generated code"
    runs_after: code-agent       # OPTIONAL — parsed but not enforced yet
    llm:
      model: ~                   # null = platform default
      temperature: 0.1
      max_tokens: 4000
    prompt: |
      You are {{role}}. Goal: {{goal}}.
      Review: {{artifacts}}
      Return JSON: { "passed": true|false, "findings": [...], "summary": "..." }
```

### Schema

| Field | Required | Type | Purpose |
|---|---|---|---|
| `name` | yes | string | Unique agent name; becomes `agent_executions.agent_role`. Surfaces as the row label in the dashboard's IntentDetail accordion. |
| `role` | yes | string | LLM persona (`You are <role>...`) |
| `goal` | yes | string | One-line statement of intent |
| `runs_after` | no | string | Framework agent name (e.g. `code-agent`). Parsed but not enforced in Step 2 — all custom agents run after all framework agents regardless. Captured for forward compatibility |
| `llm.model` | no | string \| null | Override the platform default model. `~` (null) means "use default" |
| `llm.temperature` | no | number | LLM temperature override |
| `llm.max_tokens` | no | number | LLM max-tokens override (camelCase `maxTokens` also accepted) |
| `prompt` | yes | string | Prompt template with `{{placeholders}}` — see below |

### Prompt placeholders

The runner substitutes the following before sending the prompt to the LLM:

- `{{role}}`, `{{goal}}` — fields on the definition
- `{{artifacts}}` — generated code files (`code` type only),
  truncated to 2000 characters per file, formatted as
  ```` ### path\n```typescript\n<content>\n``` ```` blocks
- `{{goldenPrinciples}}` — bullet list of `GP-NNN: title` lines
- `{{intentText}}` — operator's original intent string
- `{{projectName}}` — `HARNESS.json` `name` field

Unknown placeholders are left in place (`{{somethingElse}}` survives into
the prompt) so a typo is debuggable in the dashboard's execution log.

### Expected JSON response

```json
{
  "passed": true,
  "findings": [
    {
      "severity": "high|medium|low",
      "file": "src/path.ts",
      "description": "what's wrong"
    }
  ],
  "summary": "one-line overall verdict"
}
```

### Signal routing

The orchestrator maps each finding's severity to a typed signal that the
gate orchestrator evaluates:

| Finding severity | Signal type |
|---|---|
| `high` | `CONSTRAINT_VIOLATION` |
| `medium` | `LINT_FAILURE` |
| `low` | `LINT_FAILURE` |

If the LLM call fails or the response can't be parsed, the runner returns
`status: 'error'` and the orchestrator emits a single `CONTEXT_GAP` signal
carrying the error message. Custom agents never emit
`GOLDEN_PRINCIPLE_BREACH` — that signal type is reserved for framework
infrastructure agents and the review-agent (ADR-013).

### Behaviour

- Absent `custom_agents` key → no custom agents run; cycle proceeds
  directly to the gate
- Malformed YAML → no custom agents loaded, debug-logged (the loader
  never throws)
- Entry missing `name`, `role`, or `prompt` → silently dropped, debug-logged
- A failed custom agent (LLM error, parse error) does NOT block the cycle —
  the cycle continues and the resulting `CONTEXT_GAP` signal flows to the
  gate
- High-severity findings + the resulting `CONSTRAINT_VIOLATION` signals
  are auto-resolvable: the gate-↔-generate feedback loop can retry with
  the signals as priorSignals to the code-agent
- The dashboard's IntentDetail accordion renders custom-agent rows with a
  purple agent-role colour and a `custom` badge so operators can
  distinguish them at a glance
