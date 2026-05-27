# Dashboard — Views

Seven views, each answering a specific operator question. Every view is a focused, single-purpose component.

---

## Files

| File | Purpose |
|---|---|
| `IntentFeed.tsx` | What is the system working on right now? Live list with status badges. |
| `IntentDetail.tsx` | What exactly happened in this cycle? Full audit trail per intent. |
| `ActiveAgents.tsx` | Which agents are running right now? Real-time execution list. |
| `QualityGate.tsx` | What did the gate find? Signal breakdown with filter. |
| `Deployments.tsx` | What is deployed where? Pending promotions with approve/reject. |
| `Maintenance.tsx` | What did background agents find? Run history, queued intents, direct fixes. |
| `Alerts.tsx` | What requires my attention? Primary action surface — empty is the ideal state. |

## Rules for agents working here

- Every view fetches data through useDashboardApi() — never raw fetch
- Every view subscribes to relevant live events via useLiveEvent()
- Action buttons (approve, reject, clarify, acknowledge) call api.submitIntervention()
- GOLDEN_PRINCIPLE_BREACH alerts must show a mandatory notes field before submission
- Viewer role users see all views but action buttons are disabled
- Empty states must be meaningful — 'No alerts' is good news, say so

## Context needed

- `../types.ts` — all types used in this directory
- `../../../README.md` — package-level orientation
- `../../../../../docs/ARCHITECTURE.md` — system-wide rules
- `../../../../../AGENTS.md` — platform conventions
