# Session 001 — Architecture brainstorm and platform decisions

**Date:** 2026-05
**Participants:** Platform founder + Claude (Anthropic)
**Topics covered:** Agent-first development, OpenAI harness engineering article analysis,
platform vision, architecture decisions, Layer 1 (core harness engine), Layer 2 (harness initializer), project setup

---

## Key references

- OpenAI article: https://openai.com/index/harness-engineering/
- Repository: https://github.com/afarahat-lab/agentforge-sdlc

---

## Platform vision

A self-hosted, closed-loop agent-first platform that automates the full SDLC for
corporate operations web and mobile applications.

- Human sets intent and guardrails
- Agents handle all generation, quality enforcement, deployment, and maintenance
- Closed loop: generate → quality gate → deploy → maintain → evaluate → generate
- Human intervention minimized; oversight via dashboard and alerts
- Target market: corporate enterprises in GCC/MENA region

---

## Architecture decisions locked

| # | Decision | Choice |
|---|---|---|
| ADR-001 | Runtime model | Self-hosted server + CLI interface (`agentforge` command) |
| ADR-002 | Agent execution | Ephemeral workers |
| ADR-003 | Message queue | BullMQ + Redis |
| ADR-004 | Database abstraction | Repository pattern, PostgreSQL default |
| ADR-005 | LLM provider | Configurable abstraction in core |
| ADR-006 | Monorepo | pnpm workspaces |
| ADR-007 | Feedback signals | Five typed classes |
| ADR-008 | Target domain | Corporate ops web and mobile |

---

## Harness tier model

- **Tier 1** — Standard library (framework ships with, maintainer-curated)
- **Tier 2** — Verified registry (community-contributed, reviewed and badged)
- **Tier 3** — Community registry (open, no guarantee)

Governance: open ecosystem with tight Tier 1 curation (Linux/Linus model).

---

## Layer 1 — Core harness engine (designed)

Four responsibilities:
1. Context management — canonical context files, schema enforcement, staleness detection
2. Agent communication protocol — BullMQ message envelope with typed TaskMessage
3. Feedback signal taxonomy — five typed signals: LINT_FAILURE, TEST_FAILURE,
   CONSTRAINT_VIOLATION, CONTEXT_GAP, GOLDEN_PRINCIPLE_BREACH
4. Harness versioning — Git history as version store

---

## Layer 2 — Harness initializer (designed)

Mode: intent-first (Option C) — operator describes project in natural language,
LLM extracts structured answers.

Four phases:
- Phase 0: LLM bootstrap (provider config, no LLM needed)
- Phase 1: Intent capture (natural language → structured extraction → confirmation)
- Phase 2: Harness generation (fully populated artifacts, not generic templates)
- Phase 3: Validation (coherence check, CONTEXT_GAP signals resolve gaps)

Full spec: docs/INITIALIZER.md

---

## Layers remaining

3. ⬜ Generate layer
4. ⬜ Quality gate layer
5. ⬜ Merge and deploy layer
6. ⬜ Continuous maintenance layer
7. ⬜ Human oversight layer
8. ⬜ Registry and ecosystem

---

## Naming history

- Started as `openharness` → renamed to `agentforge-sdlc` to avoid name collision
  with existing GitHub projects and to better reflect full SDLC scope

---

## Layer 3 — Generate layer (designed + partially implemented)

**Status:** Designed, orchestrator and intent-agent implemented, remaining agents stubbed

**Key decisions:**
- ADR-009: Fixed execution graph with skip logic (Option A)
- ADR-010: IntentSpec as inter-agent contract
- ADR-011: High-impact ambiguity stops the loop

**Execution order:** intent → design → [context, lint-config] (parallel) → code → test

**Implemented:**
- `packages/agents/generate/src/types.ts` — all generate layer types
- `packages/agents/generate/src/orchestrator/plan-builder.ts` — fixed graph, ready-step resolution
- `packages/agents/generate/src/orchestrator/feedback-router.ts` — signal → agent routing
- `packages/agents/generate/src/orchestrator/state-machine.ts` — valid state transitions
- `packages/agents/generate/src/agents/intent-agent.ts` — first agent, always runs
- `packages/agents/generate/src/prompts/intent-prompt.ts` — LLM prompt for intent parsing
- `docs/GENERATE-LAYER.md` — full layer specification

**Stubbed (Phase 2 implementation):**
- design-agent, context-agent, lint-config-agent, code-agent, test-agent
- design-prompt, context-prompt, lint-config-prompt, code-prompt, test-prompt
- intent-validator, design-validator, artifact-validator

**Next:** Layer 4 — Quality Gate Layer
