# Human Oversight Layer — Gestalt

Version: 0.1.0
Layer: 7
Status: Designed + implemented (views and server routes stubbed for Phase 2)

---

## Overview

The oversight layer is a window and a gate, not a workflow tool. It makes the
invisible visible and makes intervention effortless when needed. The human's
primary mode is observation. Intervention is the exception.

There are exactly three reasons a human needs to act:
1. A `GOLDEN_PRINCIPLE_BREACH` — loop stopped, human decision required
2. An unresolvable `CONTEXT_GAP` — intent too ambiguous, clarification needed
3. A manual promotion gate — production promotion configured to require approval

Everything else is information, not action.

---

## Four concerns

### 1. Dashboard
React SPA served by the server at `http://localhost:3000`.
Seven views, each answering a specific operator question.

| View | Question |
|---|---|
| Intent feed | What is the system working on right now? |
| Intent detail | What exactly happened in this cycle? |
| Active agents | Which agents are running right now? |
| Quality gate | What did the gate find? |
| Deployments | What is deployed where? |
| Maintenance | What did background agents find? |
| **Alerts** | **What requires my attention?** |

The Alerts view is the most important. An empty Alerts view means the platform
is running autonomously. That is the ideal state.

### 2. Alert system
Converts platform signals to typed alerts and routes to configured channels.

Signal → alert mapping:
- `GOLDEN_PRINCIPLE_BREACH` → critical, required action: `acknowledge-breach`
- Unresolvable `CONTEXT_GAP` → high, required action: `provide-clarification`
- Manual promotion pending → medium, required action: `approve-promotion`

Notification channels: dashboard (always) · email · Slack · webhook
Configured in `HARNESS.json` under `oversight.alertRoutes`.

### 3. Intervention API
Four typed intervention actions — never free-form:

| Type | When |
|---|---|
| `approve-promotion` | Approve a pending environment promotion |
| `reject-promotion` | Reject — sends signal back to operator |
| `provide-clarification` | Resolve a CONTEXT_GAP — resumes intent cycle |
| `acknowledge-breach` | GOLDEN_PRINCIPLE_BREACH — choose resume or abort |

Every intervention creates an immutable `InterventionRecord` in the audit log.

### 4. Audit log
Every agent decision, signal, and human action is recorded. Immutable, queryable,
exportable. Satisfies corporate compliance requirements (GP-002).

---

## HARNESS.json configuration

```json
"oversight": {
  "alertRoutes": [
    {
      "signalType": "GOLDEN_PRINCIPLE_BREACH",
      "severity": "critical",
      "channels": ["dashboard", "slack"],
      "assignee": "security-team"
    },
    {
      "signalType": "CONTEXT_GAP",
      "severity": "high",
      "channels": ["dashboard", "email"]
    }
  ],
  "defaultChannels": ["dashboard"]
}
```

---

## RBAC

| Role | Can view | Can intervene | Can trigger maintenance | Can manage users |
|---|---|---|---|---|
| admin | ✅ | ✅ | ✅ | ✅ |
| operator | ✅ | ✅ | ✅ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ |

---

## Server-Sent Events

The dashboard subscribes to a live SSE stream at `GET /events`.
All platform state changes emit events — no polling required for live views.

Event types: `intent.created` · `intent.status-changed` · `agent.started` ·
`agent.completed` · `signal.emitted` · `gate.completed` · `deployment.updated` ·
`alert.created` · `maintenance.run-completed`

---

## Implementation file map

```
packages/dashboard/src/
├── types.ts                     ✅ complete — all dashboard types
├── App.tsx                      🔲 stub
├── api/
│   └── client.ts                ✅ complete — typed API client + SSE
├── hooks/
│   ├── useApi.ts                ✅ complete — context hook
│   └── useLiveEvents.ts         ✅ complete — SSE hooks
└── views/
    ├── IntentFeed.tsx            🔲 stub
    ├── IntentDetail.tsx          🔲 stub
    ├── ActiveAgents.tsx          🔲 stub
    ├── QualityGate.tsx           🔲 stub
    ├── Deployments.tsx           🔲 stub
    ├── Maintenance.tsx           🔲 stub
    └── Alerts.tsx                🔲 stub

packages/server/src/
└── oversight/
    ├── routes.ts                 ✅ complete (handlers stubbed for Phase 2)
    └── alert-router.ts           ✅ complete (channel senders stubbed for Phase 2)
```

---

## ADR additions

### ADR-021 — Four typed intervention actions only
Human interventions are typed enums — not free-form text fields. This ensures
the server can validate, route, and audit every intervention with precision.
Free-form intervention fields are limited to 'notes' on acknowledge-breach,
which is mandatory but does not affect routing logic.

### ADR-022 — SSE over WebSocket for live events
Server-Sent Events (SSE) is sufficient for the unidirectional server→client
event stream and is simpler to deploy in corporate environments (works through
standard HTTP proxies without special configuration). WebSocket would require
additional proxy configuration in many enterprise environments.

### ADR-023 — Dashboard served by the server, not separately deployed
The React dashboard is compiled to static assets and served by the Fastify server.
This keeps the self-hosted install story clean: one docker-compose up, one URL.
No separate frontend deployment for corporate IT to manage.

---

## Identity and authentication (added)

### Three auth modes

| Mode | When used | User experience |
|---|---|---|
| Windows Kerberos | Domain-joined Windows machines | No login screen — fully seamless |
| SAML 2.0 | On-premise ADFS, any SAML IdP | Redirect to corporate IdP login page |
| OIDC | Azure AD/Entra ID, Okta | Redirect to corporate IdP login page |
| Local fallback | Development, pre-IdP adoption | Username/password form, warning banner |

**Priority order:** Kerberos → SAML/OIDC → local (fixed — all downstream code is auth-mode agnostic)

### Windows Kerberos prerequisites

One-time IT setup required:
```
# Register the server as an SPN in Active Directory
setspn -A HTTP/gestalt.company.com DOMAIN\servicegestaltsvc

# DNS A record
gestalt.company.com → <server IP>
```

After setup: all domain-joined Windows users see no login prompt. Browser
handles Kerberos ticket exchange transparently.

### Role mapping

IdP group memberships → platform roles. Configured in HARNESS.json:

```json
"roleMapping": [
  { "idpGroup": "Gestalt-Admins",    "platformRole": "admin" },
  { "idpGroup": "Gestalt-Operators", "platformRole": "operator" },
  { "idpGroup": "Gestalt-Viewers",   "platformRole": "viewer" }
]
```

Users with no matching group are denied access (defaultRole: null).
Setting defaultRole: "viewer" grants read access to all authenticated corporate users.

### Local fallback

- Enabled at init time for development environments
- Shows non-production warning banner in dashboard
- Hard-blocked in production (NODE_ENV=production) unless explicitly overridden
- First admin created via: `gestalt init-admin` (zero-user-guarded `POST /auth/admin/setup`)

### Implementation file map (auth)

```
packages/server/src/auth/
├── types.ts               ✅ complete — all identity and auth types
├── auth-manager.ts        ✅ complete — provider orchestration + session creation
├── role-mapper.ts         ✅ complete — group → role resolution, permission check
├── session.ts             ✅ complete (jwt stub for Phase 2)
├── middleware.ts           ✅ complete (jwt verify stub for Phase 2)
├── routes.ts              ✅ complete (handlers stubbed for Phase 2)
└── providers/
    ├── kerberos.ts        ✅ complete (SPNEGO implementation stub for Phase 2)
    ├── saml.ts            🔲 stub
    ├── oidc.ts            🔲 stub
    └── local.ts           🔲 stub
```
