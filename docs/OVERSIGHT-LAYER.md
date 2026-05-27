# Human Oversight Layer — AgentForge SDLC

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
