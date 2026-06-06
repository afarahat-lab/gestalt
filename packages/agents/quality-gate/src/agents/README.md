# Quality gate — Specialist agents

Two LLM agents that validate architectural compliance and design-spec
adherence. Per ADR-041, the gate runs AFTER CI (which owns lint /
typecheck / unit tests / security). They never generate or fix —
only validate and signal.

---

## Files

| File | Purpose |
|---|---|
| `constraint-agent.ts` | Architectural rule enforcement via LLM + `executeScript` + `readFile` / `searchFiles`. Reads HARNESS.json `agentConfig['constraint-agent'].rules`. |
| `llm-review-agent.ts` | Senior-engineer code review (LLM). Synthesises with constraint-agent's signals to produce a GateResult. |
| `review-agent.ts` | Result-synthesis helpers (`synthesiseGateResult`, `summariseGateResult`) — pure functions, no I/O. |

## Rules for agents working here

- Never modify or fix artifacts — only read and validate
- Never downgrade GOLDEN_PRINCIPLE_BREACH severity
- Always include file and line in signal location when available
- Every emitted finding must carry `quotedLine` evidence (TR_013 contract)

## Context needed

- `../types.ts` — all types used in this directory
- `../../../README.md` — package-level orientation
- `../../../../../docs/ARCHITECTURE.md` — system-wide rules
- `../../../../../AGENTS.md` — platform conventions
