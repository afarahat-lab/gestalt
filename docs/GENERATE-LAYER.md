# Generate Layer — AgentForge SDLC

Version: 0.1.0
Layer: 3
Status: Designed, pending implementation

---

## Overview

The generate layer translates human intent into a coherent, ordered set of software
artifacts ready for the quality gate. It operates as a two-level system: an orchestrator
that plans and coordinates, and specialist agents that each handle one artifact type.

The layer runs as a closed inner loop — it retries internally before surfacing failures
to the quality gate, and receives typed feedback signals from the quality gate to route
fixes to the right specialist agent.

---

## Two-level architecture

### Level 1 — Orchestrator

Stateful across a single intent cycle. Responsibilities:
- Receives intent from the server
- Dispatches to `intent-agent` first
- Checks for ambiguities before proceeding (emits `CONTEXT_GAP` if found)
- Builds the fixed execution graph
- Assembles `ContextSnapshot` for each agent at dispatch time
- Tracks plan completion state in the database
- Routes quality gate feedback to the correct specialist agent
- Emits the final artifact set to the quality gate

### Level 2 — Specialist agents

Stateless, ephemeral workers. Each:
- Receives a single `TaskMessage` with a full `ContextSnapshot`
- Produces a single typed output
- Can declare `SKIPPED` if its artifact type is not needed for this intent
- Retries internally up to 2 times before emitting a failure signal
- Never communicates with other specialist agents directly

---

## Specialist agents

| Agent | Input | Output | Can skip? |
|---|---|---|---|
| `intent-agent` | Raw intent + harness | `IntentSpec` | No — always runs |
| `design-agent` | `IntentSpec` | Domain changes, API contracts, component specs | No — always runs |
| `context-agent` | `IntentSpec` + design artifacts | Updated context files | Yes — if no context changes needed |
| `lint-config-agent` | Design artifacts | Updated constraint rules | Yes — if no new module boundaries |
| `code-agent` | Design artifacts + context snapshot | Application code | No — always runs |
| `test-agent` | `IntentSpec` + design + code artifacts | Unit + integration tests | No — always runs |

---

## Execution graph

Fixed dependency order with skip logic. Each agent declares `SKIPPED` if its
output is not required for the current intent.

```
Intent received
      │
      ▼
┌──────────────┐
│ intent-agent │ → IntentSpec (+ ambiguity check)
└──────┬───────┘
       │ CONTEXT_GAP if ambiguous → human clarification → resume
       ▼
┌──────────────┐
│ design-agent │ → domain changes, API contracts, component specs
└──────┬───────┘
       │
       ├────────────────────────┐
       ▼                        ▼
┌───────────────┐    ┌────────────────────┐
│ context-agent │    │ lint-config-agent  │  parallel execution
│ (or SKIPPED)  │    │ (or SKIPPED)       │
└──────┬────────┘    └─────────┬──────────┘
       └──────────┬────────────┘
                  ▼
           ┌────────────┐
           │ code-agent │ → application code
           └──────┬─────┘
                  ▼
           ┌────────────┐
           │ test-agent │ → test suite
           └──────┬─────┘
                  ▼
           Artifact set → quality gate
```

---

## Key data structures

### IntentSpec

The structured output of `intent-agent`. Every downstream agent reads this.

```typescript
interface IntentSpec {
  id: string
  correlationId: string
  rawIntent: string
  scope: {
    affectedDomains: string[]
    affectedLayers: ArchLayer[]
    isBreakingChange: boolean
    estimatedComplexity: 'small' | 'medium' | 'large'
  }
  successCriteria: SuccessCriterion[]  // each maps to one or more test cases
  constraints: string[]                // from GOLDEN_PRINCIPLES + ARCHITECTURE
  outOfScope: string[]                 // explicit boundaries
  ambiguities: Ambiguity[]             // triggers CONTEXT_GAP if non-empty
}

interface SuccessCriterion {
  id: string
  description: string
  testable: boolean
  layer: 'unit' | 'integration' | 'e2e'
}

interface Ambiguity {
  id: string
  description: string
  options: string[]     // possible interpretations
  impactIfWrong: 'low' | 'medium' | 'high'
}
```

### ContextSnapshot

Assembled by the orchestrator at dispatch time. Agents never read files directly.

```typescript
interface ContextSnapshot {
  harness: HarnessConfig
  architecture: ArchitectureSpec
  domain: DomainModel
  goldenPrinciples: Principle[]
  relevantDecisions: ADR[]
  intentSpec: IntentSpec
  priorArtifacts: Artifact[]  // outputs from upstream agents in this cycle
}
```

### AgentResult

Every specialist agent returns this.

```typescript
interface AgentResult {
  agentRole: AgentRole
  status: 'completed' | 'skipped' | 'failed'
  skipReason?: string
  artifacts: Artifact[]
  signals: FeedbackSignal[]
  tokensUsed: number
  durationMs: number
}
```

---

## Retry and loop behaviour

### Within a single agent (internal retry)
If an agent's output fails its own validation, it retries with a refined prompt.
Maximum 2 internal retries before emitting a failure signal.

### One-level backtrack
If a downstream agent emits `CONTEXT_GAP` because an upstream artifact was
insufficient, the orchestrator re-runs the upstream agent with additional context
before retrying downstream. This is one level deep only — not recursive.

### From quality gate feedback
The orchestrator receives typed feedback signals and routes them:

| Signal | Routes to |
|---|---|
| `LINT_FAILURE` | `code-agent` with lint output |
| `TEST_FAILURE` | `code-agent` + `test-agent` with failing assertions |
| `CONSTRAINT_VIOLATION` | `code-agent` with violated rule and location |
| `CONTEXT_GAP` | `context-agent` first, then re-run affected agent |
| `GOLDEN_PRINCIPLE_BREACH` | Human escalation — loop stops |

Maximum 3 full generate→quality-gate cycles before escalating to human.

---

## Ambiguity handling

If `intent-agent` detects ambiguity with `impactIfWrong: 'high'`, the orchestrator:

1. Emits a `CONTEXT_GAP` signal
2. Creates a human notification in the oversight dashboard
3. Pauses the intent cycle (state preserved in DB)
4. Resumes when the operator provides clarification via CLI or dashboard

Low-impact ambiguities are resolved by the agent using the most conservative
interpretation, documented in the intent spec's `outOfScope` field.

---

## Orchestrator state machine

```
RECEIVED → ANALYZING → WAITING_FOR_CLARIFICATION (if ambiguous)
                     ↓ (if clear)
                  DESIGNING → GENERATING_CONTEXT (parallel)
                                              ↓
                            GENERATING_LINT_CONFIG (parallel)
                                              ↓
                                         CODING → TESTING
                                                       ↓
                                              AWAITING_GATE
                                                       ↓
                              ┌────── GATE_FAILED (retry loop)
                              ↓
                           APPROVED → handed to deploy layer
```

---

## Implementation file map

```
packages/agents/generate/src/
├── index.ts                        # package exports
├── types.ts                        # all types for this package
├── orchestrator/
│   ├── orchestrator.ts             # main orchestrator worker
│   ├── plan-builder.ts             # builds fixed execution graph
│   ├── context-assembler.ts        # assembles ContextSnapshot per agent
│   ├── feedback-router.ts          # routes quality gate signals to agents
│   └── state-machine.ts            # orchestrator state transitions
├── agents/
│   ├── intent-agent.ts             # intent parsing + ambiguity detection
│   ├── design-agent.ts             # domain model + API contracts
│   ├── context-agent.ts            # context file updates
│   ├── lint-config-agent.ts        # constraint rule updates
│   ├── code-agent.ts               # application code generation
│   └── test-agent.ts               # test suite generation
├── prompts/
│   ├── intent-prompt.ts            # LLM prompt for intent-agent
│   ├── design-prompt.ts            # LLM prompt for design-agent
│   ├── context-prompt.ts           # LLM prompt for context-agent
│   ├── lint-config-prompt.ts       # LLM prompt for lint-config-agent
│   ├── code-prompt.ts              # LLM prompt for code-agent
│   └── test-prompt.ts              # LLM prompt for test-agent
└── validators/
    ├── intent-validator.ts         # validates IntentSpec structure
    ├── design-validator.ts         # validates design artifacts
    └── artifact-validator.ts       # validates final artifact set
```

---

## ADR additions from Layer 3

### ADR-009 — Fixed execution graph with skip logic

**Decision:** The generate layer uses a fixed dependency-ordered execution graph.
Agents declare `SKIPPED` when their artifact type is not needed.

**Rationale:** Predictable, debuggable, and covers the vast majority of intent types.
LLM-planned graphs add a failure mode where the plan itself is wrong. Skip logic
handles the flexibility requirement without dynamic planning. Revisit in v2.

### ADR-010 — Intent spec as the inter-agent contract

**Decision:** `intent-agent` always runs first and produces a structured `IntentSpec`
that all downstream agents receive. Raw intent text is never passed to downstream agents.

**Rationale:** Prevents each agent from interpreting intent independently, which leads
to incoherent artifacts. The intent spec is the single source of truth for what this
cycle is trying to achieve. Success criteria in the spec map directly to test cases,
closing the loop between intent and verification.

### ADR-011 — Ambiguity stops the loop

**Decision:** High-impact ambiguities detected by `intent-agent` pause the cycle
and escalate to the human operator before any generation begins.

**Rationale:** Generating code against an ambiguous spec wastes tokens and produces
artifacts that fail quality gates for the wrong reasons. Stopping early is cheaper
than retrying downstream. Low-impact ambiguities are resolved conservatively and
documented in `outOfScope`.
