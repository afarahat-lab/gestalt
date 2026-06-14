# Agent Teams — LangGraph Migration Blueprint

_This document maps every agent team and their relationships.
It is the blueprint for the LangGraph graph-of-graphs
implementation (ADR-056). Each team listed here maps to
a LangGraph StateGraph or subgraph node._

---

## Platform graph (top level)

The platform is a master StateGraph that routes between
five layer subgraphs based on intent classification:

```
PlatformGraph
├── IntentClassifierNode
│     single-intent → GenerateGraph
│     complex-feature → PlanningGraph
├── PlanningGraph (subgraph)
├── GenerateGraph (subgraph)
├── GateGraph (subgraph)
├── DeployGraph (subgraph)
└── MaintenanceGraph (subgraph)
```

---

## Planning graph

_**Implemented in TR_053 (ADR-056 Phase 2)** —
`packages/agents/planning/src/graphs/planning/`. Live verification
is the TR_054 carryover; both legacy and graph paths run in
parallel during the rollout window, gated by
`harnessConfig.planner.engine: 'langgraph' | 'orchestrator'`
(default `'langgraph'` — TR_053 amendment)._

```
PlanningGraph (StateGraph — packages/agents/planning/src/graphs/planning/)
├── ArchitectureGraph (subgraph — see below)  ← architectureNode invokes runArchitectureGraph()
├── PlannerNode
│     reads: ArchitectureGraph output
│     persists: feature_phases rows + saveArchitectureAndPlan
│     emits: ordered phase list with deferred context
├── PhaseDispatchNode
│     reads: current phase, prior built files
│     (optional) per-phase architecture pass via designPhase + reviewPhaseDesign
│     creates: intent row + dispatches generate:intent to BullMQ
├── AwaitPhaseNode  ← LangGraph interrupt() — BullMQ job returns here
│     resumes: when the intent reaches `deployed` (event-bus subscriber
│              detects the LangGraph checkpoint exists and dispatches
│              `planning:graph-resume`)
├── PhaseEvaluatorNode
│     reads: phase result envelope ({success, mergeCommitSha})
│     runs: phase-evaluator-agent (tool-loop with git diff)
│     decides: continue | adjust | complete | escalate
└── HumanFeedbackNode  ← LangGraph interrupt()
      surfaces: feature-blocked alert
      resumes: when operator provides clarification via /interventions
```

Implementation notes (TR_053):

- Each node clones the project repository inside the node (not
  across the interrupt boundary) because the graph runs across
  multiple BullMQ jobs separated by `interrupt()`.
- `awaitPhaseNode` and `humanFeedbackNode` call
  `interrupt(payload)` — the call serialises state to the
  PostgreSQL checkpointer keyed by `thread_id = featureId` and
  returns the resume value on continuation. The BullMQ job
  hosting the call completes normally when interrupt fires.
- The event-bus subscriber in `planning-orchestrator.ts`
  (kept alive on the legacy path) checks
  `checkpointer.getTuple({thread_id: featureId})` on each
  `intent.status-changed` event: if a checkpoint exists, dispatch
  `planning:graph-resume`; otherwise dispatch `planning:evaluate`.
- Resume happens via `graph.invoke(new Command({resume: value}))`.
  The brief's "plain `graph.invoke({payload})`" snippet does NOT
  resume an interrupt — that would re-enter the graph from START.
  `Command({resume})` is the correct LangGraph TS API.
- All 4 LangGraph checkpoint tables created in TR_052 are reused
  by Phase 2 — same singleton `PostgresSaver`. Phase 1 (architecture
  crew) uses `thread_id = correlationId`; Phase 2 (planning loop)
  uses `thread_id = featureId`. The two thread spaces don't collide.
- **Architecture invoked as a function call, not a nested subgraph
  (TR_053 amendment Fix 8 — conscious choice).** The PlanningGraph's
  `architectureNode` calls `runArchitectureGraph(...)` directly,
  which compiles and invokes its own checkpointed graph keyed by
  `thread_id = correlationId`. That gives the architecture crew its
  own checkpoint thread; a planning resume that interrupts mid-
  architecture would re-run architecture from scratch (~4 min on
  the trackeros baseline). The alternative — nesting as a true
  LangGraph subgraph under the parent feature thread — would let
  partial architecture work survive restart but couples the two
  thread namespaces and complicates `getState()` debugging.
  Tradeoff accepted: architecture runs are short and rare relative
  to phase runs (one per feature vs. one per phase); a mid-
  architecture crash forces ~4m of re-work, which is a tolerable
  cost during the rollout window. If empirical use shows
  architecture crashes are common enough to matter, promote to a
  true subgraph node in a follow-up.

---

## Architecture graph (subgraph of Planning)

_**Implemented in TR_051 (ADR-056 Phase 1).** Replaces the single
architecture-agent's feature-level `designFeature` + `reviewDesign`
pass with a LangGraph `StateGraph` crew. Per-phase `designPhase` +
`reviewPhaseDesign` remain on the single architecture-agent until
Phase 2 of the migration._

```
ArchitectureGraph (StateGraph — packages/agents/planning/src/graphs/architecture/)
├── [Parallel nodes]
│     ├── DomainArchitectNode
│     │     focus: entities, relationships, lifecycle states, business rules
│     ├── DataArchitectNode
│     │     focus: SQL schema, repositories, concrete implementations
│     └── AppArchitectNode
│           focus: modules, services, dependency direction, phase plan
└── ChiefArchitectNode (supervisor)
      receives: all three parallel outputs
      resolves: conflicts, naming inconsistencies,
                missing implementations
      enforces: stack compliance, lifecycle coverage,
                symbol name consistency
      emits: single reviewed FeatureArchitecture (canonical shape)
```

State flows:
- All three architect nodes receive the same feature description,
  existing ARCHITECTURE.md excerpt, GOLDEN_PRINCIPLES.md, and
  HARNESS.json stack
- LangGraph fan-in: ChiefArchitectNode runs after ALL three
  specialists complete (regardless of order)
- ChiefArchitect's output flows back to `planning-orchestrator.ts`
  → planner-agent → planning:phase

Implementation notes:
- Every node extends `BaseLLMAgent` → ADR-057 token management
  applies automatically
- Each node has a `RetryPolicy` (3 attempts specialists, 2 attempts
  chief, exponential backoff on transient errors)
- PostgreSQL checkpointer reuses `DATABASE_URL` → LangGraph 0.2
  creates **four** tables on first `setup()` call:
  `checkpoints`, `checkpoint_writes`, `checkpoint_blobs`,
  `checkpoint_migrations`. No Gestalt migration needed
- Specialist errors don't throw — they surface as `state.errors` so
  the chief can reconcile around a missing slice. **Caveat
  (verified TR_052):** a JSON-parse failure on a non-empty LLM
  response falls through to the parser's empty-fallback path
  silently — `state.errors` stays empty even though the slice is
  empty. The chief still reconciles successfully but operators
  don't see the parse failure on the dashboard. TR_053 follow-up:
  parsers should emit a sentinel error into `state.errors`.
- All four agents declared in `agents.yaml` + `HARNESS.json` per
  ADR-042 — only structural framing + JSON schemas in `.ts`
- **TR_052 live verification result:** all four nodes fired
  end-to-end on a fresh feature; specialists fan-out in parallel
  (≤67s wall-clock for slowest); chief reconcile took 3m 19s on
  Kimi-K2.6 (12k max_tokens). Phase 1 of the leave-management
  feature deployed in 19m 27s end-to-end without any HARNESS-rule
  intervention on intent-agent — TR_036→TR_050 rigor bars
  structurally absorbed.

---

## Generate graph

```
GenerateGraph
├── IntentNode
│     validates: intent spec, detects ambiguity
│     emits: IntentSpec with outOfScope list
├── DesignNode
│     reads: IntentSpec
│     emits: DesignSpec
├── ContextNode
│     reads: IntentSpec + DesignSpec
│     emits: ContextSnapshot
└── CodeNode
      tool: AiderTool (executeScript wrapper)
      reads: ContextSnapshot + phase architecture
      emits: committed files on branch
```

Conditional edges:
- IntentNode → ambiguity detected → HumanFeedbackNode
- IntentNode → clear → DesignNode
- CodeNode → complete → GateGraph

---

## Gate graph

_**Status: 🟡 PART 1 + PART 2a FOUNDATION LANDED** (TR_056 — commits `3728561` + `d396e76`). State + shared selfHealingNode + gateNode in place; `graph.ts` / thin-invoker refactor / dispatch-helper deletions / §5 forced-failure suite remain (TR_056 Part 2b / 2c). Legacy `handleGateTask` still routes 100% of traffic — safe rollback._

_**As-implemented shape (TR_056 Part 1 + 2a):**_
- `gateNode` (single supervisor node) runs constraint-agent + review-agent in parallel inside the node body (verbatim Promise.all + ADR-051 review-skip from `handleGateTask:397→675`); the brief's separate `ConstraintNode` + `PRAgentNode` + `GateVerdictNode` triple is deferred — the existing `synthesiseGateResult` already plays the verdict-supervisor role and lifting it as three nodes would have forced an `agent_executions` row-shape change. Revisit after the §5 suite passes.
- `selfHealingNode` is layer-neutral (lives under `quality-gate/src/graphs/shared/` for now; promoted to `@gestalt/core/graphs/shared/` when generate session lands). Wraps `runSelfHealingLoop` — preserves UNRECOVERABLE / hallucination-loop / cascade-depth guards in their canonical order. **TR_020 absolute-cap check** runs as an explicit DB cross-check BEFORE the loop call so a checkpoint restore can never reset the budget.
- **B-i fix-intent path** (TR_055b §4 + TR_056 prerequisite). Two `// TR_054-PENDING` markers in `shared/self-healing-node.ts` mark the eventual B-ii conversion once TR_054 #40 restart-resume is proven.
- **GP_BREACH alert moved into `gateNode`** on `verdict === 'escalate'` per TR_053 Fix 6 — the deciding node owns the alert, never a future interrupt node.

_**Blueprint shape (the originally planned topology, kept for the 2b/2c refactor reference):**_

```
GateGraph
├── [Parallel nodes]
│     ├── ConstraintNode
│     │     tool: executeScript (git diff + project tools)
│     │     reads: ARCHITECTURE.md + project structure brief
│     │     emits: constraint signals with quoted evidence
│     └── PRAgentNode
│           tool: executeScript (pr-agent CLI)
│           reads: PR diff via GitHub API
│           emits: review verdict (approved | changes-requested)
└── GateVerdictNode (supervisor)
      receives: ConstraintNode + PRAgentNode outputs
      decides: pass | fail | escalate
```

Conditional edges:
- GateVerdictNode → pass → DeployGraph
- GateVerdictNode → fail → SelfHealingGraph
- GateVerdictNode → escalate → HumanFeedbackNode

_Note: review-agent (llm-review-agent.ts) is deprecated
(ADR-051). PRAgentNode replaces it. review-agent retained
as fallback for non-GitHub adapters._

---

## Deploy graph

```
DeployGraph
├── PRNode
│     creates PR on gestalt/* branch
├── PipelineNode
│     polls CI status (GitHub Actions / noop)
│     emits: ci-pass | ci-fail
└── PromotionNode
      stages then promotes to production
      fires onSuccessDispatch after promotion
```

Conditional edges:
- PipelineNode → ci-pass → GateGraph
- PipelineNode → ci-fail → SelfHealingGraph
- PromotionNode → promoted → PlanningGraph (next phase)
                           OR complete (single intent)

---

## Self-healing graph

```
SelfHealingGraph
├── DiagnosticNode
│     model: gpt-5.5-pro (highest reasoning)
│     reads: failure context + CI output + signals
│     emits: action (retry | fix-intent | escalate)
└── [Conditional on action]
      retry → GenerateGraph (with retry context)
      fix-intent → GenerateGraph (child intent)
                   onSuccessDispatch → parent resumes
      escalate → HumanFeedbackNode
```

Depth limit: MAX_FIX_INTENT_DEPTH = 2
Retry budget: maxPhaseRetries per phase (default 2)

---

## Maintenance graph

```
MaintenanceGraph
├── [Scheduled triggers]
│     ├── DriftNode — detects ARCHITECTURE.md drift
│     ├── AlignmentNode — detects code/doc misalignment
│     ├── GCNode — cleans stale branches and alerts
│     └── EvaluationNode — monitoring metrics analysis
└── [External scan triggers]
      └── ExternalScanNode
            receives: CodeAnt/SonarQube/Semgrep findings
            emits: MaintenanceIntent → GenerateGraph
```

---

## Human feedback node (shared across graphs)

```
HumanFeedbackNode
      LangGraph interrupt() — pauses execution
      persists: current graph state to PostgreSQL
      creates: alert with full context
      waits: operator provides clarification
      resumes: from exact interrupt point
```

Used by:
- IntentNode (high-impact ambiguity)
- GateVerdictNode (GP_BREACH escalation)
- SelfHealingGraph (budget exhausted)
- PlanningGraph (phase blocked after maxPhaseRetries)

---

## Tool inventory (shared across all graphs)

Tools available to nodes via LangChain StructuredTool:

| Tool | Type | Used by |
|---|---|---|
| AiderTool | Custom StructuredTool | CodeNode |
| ExecuteScriptTool | Custom StructuredTool | ConstraintNode, PRAgentNode, PhaseEvaluatorNode |
| ReadFileTool | LangChain FileManagementToolkit | All agents |
| ListDirectoryTool | LangChain FileManagementToolkit | All agents |
| FileSearchTool | LangChain FileManagementToolkit | All agents |
| PRAgentTool | Custom StructuredTool | PRAgentNode |
| QodoGenTool | Custom StructuredTool | CodeNode (ADR-053, pending) |
| SWEAgentTool | Custom StructuredTool | MaintenanceGraph (ADR-054, pending) |
| K8sGPTTool | Custom StructuredTool | MaintenanceGraph (ADR-055, pending) |

---

## Migration order (ADR-056)

```
Phase 1 — Architecture graph  ✅ DONE (TR_051; live-verified TR_052)
  Replaced: architecture-agent.designFeature + reviewDesign stopgap
  With: ArchitectureGraph subgraph in @gestalt/agents-planning
        (DomainArchitect + DataArchitect + AppArchitect
         + ChiefArchitect supervisor)

Phase 2 — Planning graph  ✅ CODE LANDED + amendment verified
  (TR_053 initial + TR_053 amendment; full-feature live verification = TR_054 carryover)

  Replaced: planning-orchestrator three-task chain
  With: PlanningGraph StateGraph in @gestalt/agents-planning
        (architecture subgraph + planner + phase-dispatch +
         await-phase interrupt + phase-evaluator + human-feedback)

  Engine routing: `harnessConfig.planner.engine` selects exactly one
    of {`langgraph` (default), `orchestrator`} at feature-submit time.
    The unchosen engine is genuinely inert for the feature.

  Resume routing (event-based, no DB JOIN):
    - `intents.parent_context` JSONB (migration 030) stamped by
      `phaseDispatchNode` at intent create time:
        `{kind: 'planning-phase', featureId, phaseIndex}`
    - Every `transitionIntent` reads the column and enriches the
      `intent.status-changed` event payload.
    - The planning subscriber routes by `parentContext.kind`
      WITHOUT a JOIN. Legacy intents (parent_context = NULL) fall
      back to `findPhaseByIntent`.

  Resume API:
    - `Command({resume: value})` from `@langchain/langgraph` is the
      correct API in v0.2.74 (smoke-tested against the installed
      version). Plain `graph.invoke(state, config)` does NOT
      resume an interrupted graph.
    - Interrupt detection: `graph.getState(cfg).tasks[*].interrupts`
      and/or `state.next` non-empty. NOT `result.__interrupt__`
      (that key is not surfaced on the invoke return value in
      v0.2.74).

  Both terminal outcomes resume the graph:
    - `deployed` → resume `{success:true, mergeCommitSha}`
    - `failed`/`escalated`/`waiting-for-clarification` → resume
      `{success:false, failureReason}`
    - `phaseEvaluatorNode` handles the failure branch via the
      `maxPhaseRetries` budget; exhaustion routes to
      `human-feedback`.

  Interrupt-node side-effect rule (Fix 6):
    - LangGraph re-executes any node from the top on resume.
    - Interrupt nodes (`awaitPhaseNode`, `humanFeedbackNode`) contain
      ONLY structured log + `interrupt(...)`. NO DB writes, NO
      event emits before the interrupt call.
    - Side effects belong in the deciding node upstream
      (`phaseEvaluatorNode`'s `escalate` branch creates the
      `feature-blocked` alert).
    - Comment block on each interrupt node documents this rule.

  adjust/continue/escalate semantics (Fix 7):
    - `continue`: phase succeeded, no plan changes → advance index.
    - `adjust`:   phase succeeded, evaluator rewrote remaining
                  phases (index+1..) → advance index.
    - `escalate`: do NOT advance; route to human-feedback.

  Carryover: per-phase designPhase + reviewPhaseDesign STILL on the
             single architecture-agent class (called from
             phaseDispatchNode). They become per-phase subgraph nodes
             when Phase 3 lands.

Phase 3 — Generate graph
  Replace: generate orchestrator
  With: GenerateGraph StateGraph
        (IntentNode + DesignNode + ContextNode + CodeNode)

Phase 4 — Gate graph
  Replace: gate-orchestrator.ts
  With: GateGraph StateGraph
        (ConstraintNode + PRAgentNode + GateVerdictNode)

Phase 5 — Self-healing graph
  Replace: self-healing-loop.ts
  With: SelfHealingGraph StateGraph
        (DiagnosticNode + conditional edges)

Phase 6 — Deploy + Maintenance graphs
  Replace: remaining orchestrators
  With: DeployGraph + MaintenanceGraph
```

BullMQ stays as inter-graph transport throughout.
PostgreSQL checkpointer replaces custom agent_checkpoints.
HumanFeedbackNode uses LangGraph interrupt() throughout.

---

## State schema (Pydantic-style, for LangGraph TypedDict)

Each graph passes a typed state object. Key fields:

```typescript
interface GestaltGraphState {
  // Identity
  correlationId: string;
  projectId: string;
  featureId?: string;
  phaseId?: string;

  // Intent
  intentText: string;
  intentSpec?: IntentSpec;
  deferredToLaterPhases?: string[];

  // Architecture (planning layer)
  featureArchitecture?: FeatureArchitecture;
  phaseArchitecture?: PhaseArchitecture;

  // Code generation
  projectRoot: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  mergeCommitSha?: string;

  // Gate
  gateSignals?: FeedbackSignal[];
  gateVerdict?: 'pass' | 'fail' | 'escalate';

  // Self-healing
  selfHealingAction?: 'retry' | 'fix-intent' | 'escalate';
  fixIntentText?: string;
  fixIntentDepth: number;
  retryCount: number;

  // Human feedback
  humanFeedback?: string;
  awaitingHumanFeedback: boolean;

  // Checkpointing
  lastCompletedNode?: string;
  checkpointedAt?: string;
}
```

---

_Last updated: 2026-06-13 (TR_053 — PlanningGraph code landed + 3 NRB fixes from TR_052)._
_Update this file whenever a new agent team is designed
or an existing team changes structure._
