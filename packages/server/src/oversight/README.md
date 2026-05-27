# Server — Oversight module

Routes and logic for the human oversight layer. Alerts, interventions, live event stream, and maintenance control.

---

## Files

| File | Purpose |
|---|---|
| `routes.ts` | Fastify route handlers for alerts, interventions, SSE stream, and maintenance triggers. |
| `alert-router.ts` | Converts platform signals to alerts, resolves notification channels, sends notifications. |

## Rules for agents working here

- Every intervention is written to the audit log before processing (GP-002)
- GOLDEN_PRINCIPLE_BREACH interventions require 'notes' field — validate before processing
- SSE stream sends keep-alive pings every 30 seconds
- POST /interventions is idempotent — duplicate submissions return the existing record
- Only admin and operator roles can submit interventions — viewer is read-only

## Context needed

- `../types.ts` — all types used in this directory
- `../../../README.md` — package-level orientation
- `../../../../../docs/ARCHITECTURE.md` — system-wide rules
- `../../../../../AGENTS.md` — platform conventions
