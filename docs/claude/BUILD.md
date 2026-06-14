# BUILD.md — Build status + known issues

## How to run builds

```bash
pnpm -r build                 # build all packages (topological order)
pnpm --filter @gestalt/core typecheck

docker-compose up -d          # postgres + redis + server (production stage)
docker-compose logs -f server
```

---

## Current build status

| | |
|---|---|
| `pnpm -r build` | ✅ clean (13 packages) |
| `docker-compose up -d` | ✅ healthy (server / postgres / redis) |
| Migrations applied | 029 (latest: `029_token_management_and_phase_merge`) — no new Gestalt migration in TR_053 (PlanningGraph reuses TR_051 PostgresSaver tables; new `ExecutionStatus = 'completed-with-warning'` is additive on a column with no CHECK constraint) |
| Server reachable | `http://localhost:3000/health` returns 200 |
| Dashboard | served at `http://localhost:3000/app/` |

The 13 buildable packages: `@gestalt/core`, `@gestalt/adapter-postgres`,
`@gestalt/adapter-oracle` (stub), `@gestalt/adapter-mssql` (stub),
`@gestalt/agents-generate`, `@gestalt/agents-quality-gate`,
`@gestalt/agents-deploy`, `@gestalt/agents-maintenance`,
`@gestalt/agents-planning` (migration 024), `@gestalt/registry`,
`@gestalt/server`, `@gestalt/cli`, `@gestalt/dashboard`.

---

## Known issues

None blocking the build. Areas to keep in mind:

1. **`UserRepository` / `ProjectRepository` extensions touch every
   adapter.** Adding a method means Oracle + MSSQL stubs must add the
   same method (as throw-stubs is fine). Build will fail until every
   adapter implements the new surface.
2. **CLI pins chalk@4 / ora@5 for CJS compatibility.** Do not upgrade
   either without performing the full ESM migration (`"type":
   "module"`, `.js` extensions on relative imports, Dockerfile
   update). The pin is intentional.
3. **Dashboard bundle 1010 KB raw / 319 KB gzipped** after the
   CodeMirror addition. Above Vite's 500 KB warning. Acceptable for an
   admin-only feature.
4. **LLM model name not validated at startup.** `loadConfig` accepts
   any non-empty string for `LLM_MODEL`. Invalid model surfaces as a
   404 on the first LLM call.

---

## Pending operator actions

### TR_053 amendment — 8 correctness fixes to the PlanningGraph + refined event-based resume plumbing (no template bump; verification steps 1-2 LIVE-PASSED, 3-5 + full run = TR_054 carryover)

The TR_053 initial brief had architectural bugs in the
interrupt/resume path. This amendment fixes them and ships the
verification mechanics. Step 0 trace report determined that the
deploy pipeline does NOT propagate the parent `featureId` to the
promotion-agent; it's reconstructed via SQL JOIN at the planning
subscriber. User chose event-based routing (Refined Option 2) over
DB lookup.

**Refined Option 2 — event-based resume plumbing:**

- **Migration 030** — `intents.parent_context JSONB` column.
  Discriminated envelope `{kind: 'planning-phase', featureId,
  phaseIndex}` stamped by `phaseDispatchNode` at intent create
  time. Existing intents (parent_context = NULL) fall back to the
  JOIN.
- **`@gestalt/core` `IntentRecord`** gains optional `parentContext`
  field; new `IntentParentContext` discriminated-union type.
- **`IntentRepository.create`** signature accepts optional
  `parentContext`; postgres adapter writes via `db.json(...)`.
- **`transitionIntent`** (3 copies — deploy, gate, generate) reads
  the persisted column on its `intents.updateStatus` return value
  and includes `parentContext` in the `intent.status-changed`
  event payload.
- **Planning subscriber** routes by `event.parentContext.kind`
  WITHOUT any DB JOIN on the hot path. Legacy fallback retained
  for older intents.

**8 correctness fixes per the amendment brief:**

- **Fix 1 (resume API)** — `Command({resume})` is the correct API
  in `@langchain/langgraph@0.2.74`. Smoke-tested with a throwaway
  2-node graph: `interrupt()` pauses, `Command({resume:value})`
  resumes, node observes the value. The earlier code's check on
  `result.__interrupt__` was wrong — that key is NOT surfaced on
  the invoke return value in v0.2.74. Correct detection:
  `graph.getState(cfg).tasks[*].interrupts[*]` or
  `state.next` non-empty. `runPlanningGraph` fixed.
- **Fix 2 (both terminal outcomes resume)** — the subscriber now
  dispatches `planning:graph-resume` on `deployed`
  (`success:true`) AND on `failed`/`escalated`/
  `waiting-for-clarification` (`success:false` +
  `failureReason`). `phaseEvaluatorNode` handles the
  `success:false` branch via the `maxPhaseRetries` budget. The
  previous "deployed only" routing would have left the graph
  parked at `awaitPhaseNode` forever on phase failure — the same
  indefinite-hang class fixed in TR_032/TR_036 for the legacy
  orchestrator.
- **Fix 3 (single engine, default langgraph)** —
  `harnessConfig.planner.engine: 'langgraph'|'orchestrator'`
  (default `'langgraph'`) replaces the deprecated
  `useLangGraph` boolean. `handlePlanningStart` logs
  `planning engine selected: <engine>` then re-dispatches as
  `planning:graph-start` when `langgraph`. The unchosen engine is
  inert for the feature — `planning:phase`/`planning:evaluate`
  never dispatched for graph features;
  `planning:graph-start`/`graph-resume` never dispatched for
  orchestrator features.
- **Fix 4 (resume runs in planning worker via queue)** —
  confirmed by inspection. Already implemented in TR_053 initial:
  `planning:graph-resume` is a BullMQ task on the planning queue;
  the deploy layer only emits `intent.status-changed`; deploy and
  planning stay decoupled.
- **Fix 5 (interrupt return is BullMQ success)** — confirmed in
  `packages/core/src/queue/index.ts:184-189`. The worker treats
  any non-throwing handler return as job COMPLETED;
  `result.status: 'failed'` is observability-only. `runPlanningGraph`
  returns normally on both END and interrupt paths. Comment in
  `handleGraphStart` locks in the rule for future readers.
- **Fix 6 (no side effects before interrupt)** — `humanFeedbackNode`
  was creating a feature-blocked alert (DB write + SSE) BEFORE
  the `interrupt()` call; on resume LangGraph re-executes the
  node from the top → duplicate alert. Moved the alert creation
  to `phaseEvaluatorNode`'s `escalate` branch (the deciding node,
  runs exactly once per phase outcome). `awaitPhaseNode` reduced
  to log + interrupt only. Explicit rule comments on both
  interrupt nodes documenting the constraint. `phaseDispatchNode`
  audited for crash-mid-node idempotency; documented as
  acceptable tradeoff during rollout (mid-node window is ~ms;
  the verified scenario is server-restart-while-parked, where
  await-phase is the running node).
- **Fix 7 (adjust/continue/escalate index semantics)** — explicit
  comment block on `phaseEvaluatorNode`. `planningAction` now
  returns `'adjust'` (vs `'continue'`) when the evaluator
  applied scope adjustments to remaining phases. Both advance
  the index identically; the distinction is observability-only.
  `escalate` does not advance.
- **Fix 8 (architecture function-call vs subgraph)** —
  documented in `AGENT_TEAMS.md` as a conscious tradeoff:
  `runArchitectureGraph` keeps its own `thread_id =
  correlationId` (separate checkpoint thread), trading
  non-resumable architecture (~4 min re-work on restart) for
  simpler debugging. Promotion to a true subgraph deferred until
  empirical use surfaces the need.

**BullMQ lockDuration bump (discovered during verification):**

- The platform default `lockDuration: 600000` (10 min, tuned for
  legacy `planning:start`) was too short for `planning:graph-start`
  (~24 min on the trackeros baseline, including the
  ArchitectureGraph crew). BullMQ marked the job
  `failed:stalled` AFTER successful handler return (observability
  noise; not retried due to `maxStalledCount: 0`). Bumped to
  `1800000` (30 min) on the planning queue worker.

**trackeros chief-architect switched to DeepSeek-V3.2:**

- During verification, Kimi-K2.6 timed out twice in a row on the
  12k chief reconciliation call (TR_050 known issue; ~50% timeout
  rate observed). Operator committed an `agents.yaml` change to
  switch the chief to DeepSeek-V3.2 for verification cycles.
  Pushed to trackeros `origin/main` as
  `df04b85a chore(TR_053-verify): switch chief-architect to DeepSeek-V3.2`.

**Live verification status:**

- **Step 1 (throwaway interrupt/resume script)** — **PASSED**.
- **Step 2 (graph parks + checkpoint written)** — **PASSED** on
  trackeros feature `ff4e32f4-9385-4244-af78-f49f2458500b`:
  engine selection logged
  (`planning engine selected: langgraph`); ArchitectureGraph
  fired through chief; planner ran (6 phases); Phase 1 intent
  dispatched with `parent_context` JSONB correctly populated
  (DB-confirmed: `{"kind":"planning-phase","featureId":"...","phaseIndex":0}`);
  `planning-graph awaitPhaseNode interrupting` log fired;
  `PlanningGraph step complete` confirms graph returned at
  interrupt; `Task completed` confirms BullMQ saw success.
  `p1_intent_count=1` — Phase 1 intent dispatched exactly once
  (Fix 6 working).
- **Step 3 (Phase 1 deploys → resume → Phase 2 dispatched)** —
  IN FLIGHT at report-final. Phase 1 generation underway.
  Carryover to TR_054.
- **Steps 4-5** — pending verification by TR_054. Code paths
  exist and were audited (Fix 2 for failure branch, Fix 6 for
  restart-resume idempotency).
- **Template version stays at 0.38.0** per the brief's "bump
  only after verification passes" rule. **Template 0.39.0 bump
  + full feature run = TR_054**.

**Build status:** `pnpm -r build` clean across all 13 packages.
Migration 030 applied at server boot.

**Operator action — trackeros:** my edits pushed.
- `0404a6e9 chore(TR_053): switch planner.engine to langgraph`
- `df04b85a chore(TR_053-verify): switch chief-architect to DeepSeek-V3.2`

### TR_053 — LangGraph migration Phase 2: PlanningGraph + three NRB fixes (ADR-056)

_**Note (TR_054 reconciliation):**_ this entry describes the
**TR_053 initial** design where the engine flag was a boolean
`planner.useLangGraph` (default `false`) and the template
proposed a `0.38.0 → 0.39.0` bump. The **TR_053 amendment**
within the same session renamed the flag to `planner.engine:
'langgraph' | 'orchestrator'` (default `'langgraph'`) and held
the template at `0.38.0` until verification passes (TR_054 B6).
The old `useLangGraph` mentions below are retained as a record
of the initial design; the live shipped surface uses
`planner.engine`. See the TR_053 amendment block above for the
current as-shipped semantics.



**Three TR_052 NRB fixes — done and clean:**

- **NRB-1 — review-agent completed-with-warning in gate.**
  `ExecutionStatus` gains the new value (additive — no
  CHECK constraint on `agent_executions.status` so no
  migration needed). `gate-orchestrator.ts`
  `runWithObservability` attaches `_executionId` +
  `_errorMessage` to the errored `GateAgentResult`. After
  `synthesiseGateResult` returns a `pass` verdict, the
  orchestrator iterates the agent results and patches any
  with `status === 'errored'` to
  `completed-with-warning` on `agent_executions` +
  appends a `completed-with-warning` row to
  `agent_execution_logs` explaining "non-blocking failure;
  other gate agent passed". Emits `agent.completed` SSE
  with the new status so the dashboard sees it. Symmetric
  for constraint-agent or review-agent — whichever
  threw, the surviving agent's pass is treated as
  sufficient.
- **NRB-2 — structured specialist errors in architecture
  nodes.** New `SpecialistResponseError` class in
  `graphs/architecture/agents.ts` with `kind:
  'parse-failure' | 'parsed-to-empty'` + `role:
  'domain' | 'data' | 'app'`. Parsers no longer swallow
  failure — `parseDomainDesign`, `parseDataDesign`,
  `parseAppDesign` throw on either kind. The existing
  node `try/catch` (TR_051) catches and emits a structured
  sentinel into `state.errors[]`. `chiefArchitectNode`
  gains a new `log.info` showing slice presence
  (`present` | `empty`) for each of the three inputs +
  `priorErrors` before invoking the chief.
- **NRB-3 — buildStackSubstitutions removed.**
  `ArchitectureAgent.buildStackSubstitutions` method
  deleted; `buildStackSubstitutionPrompt` +
  `applyStackSubstitutions` deleted from
  `architecture-prompt.ts`; the two
  `planning-orchestrator` call sites deleted; the
  `applyStackSubstitutions` import + the `architectureAgent`
  outer instance removed.
  `FeatureArchitecture.stackSubstitutions` kept as
  `@deprecated` for back-compat with persisted JSON.
  The architecture crew enforces stack compliance
  structurally (`renderStackSection` + per-specialist
  HARNESS rules + chief reconciliation); the regex
  post-processing fallback was redundant after TR_051 +
  failed on DeepInfra anyway.

**Phase 2 of the LangGraph migration — PlanningGraph
code landed (parallel rollout, flag-gated):**

- **New package layout:**
  ```
  packages/agents/planning/src/graphs/planning/
  ├── state.ts                — Annotation.Root schema
  └── nodes.ts                — 6 node functions (with helpers)
  graph.ts                    — StateGraph + runPlanningGraph()
  ```
  (`agents.ts` from the brief isn't needed — the existing
  `PlannerAgent` + `PhaseEvaluatorAgent` + `ArchitectureAgent`
  classes are called directly by the nodes.)
- **State** (`PlanningGraphState`): `featureId`,
  `correlationId`, `featureArchitecture` (JSON),
  `phasesJson`, `currentPhaseIndex`, `currentIntentId`,
  `phaseResult`, `currentPhaseRetries`, `planningAction`
  (`continue|adjust|complete|escalate|null`),
  `humanFeedback`, `errors[]` (with `[...a,...b]`
  reducer), `tokensUsed` (with `a+b` reducer).
- **Nodes** (`nodes.ts`):
  - `architectureNode` — clones repo, calls
    `runArchitectureGraph()` (Phase 1 subgraph),
    persists architecture summary, appends to
    `docs/ARCHITECTURE.md` when relevant.
  - `plannerNode` — calls `PlannerAgent.planFeature`,
    persists `feature_phases` rows + the architecture
    summary via `saveArchitectureAndPlan`.
  - `phaseDispatchNode` — clones repo, runs optional
    per-phase architecture pass (designPhase +
    reviewPhaseDesign), builds intent text incl.
    TR_039 deferred section, creates intent row,
    dispatches `generate:intent` to BullMQ.
  - `awaitPhaseNode` — calls `interrupt({type:
    'await-intent', featureId, phaseIndex, intentId})`.
    BullMQ job returns; state checkpointed to postgres.
  - `phaseEvaluatorNode` — clones repo, on
    `result.success: false` honours `maxPhaseRetries`;
    on success runs `PhaseEvaluatorAgent.evaluatePhase`,
    persists evaluation, applies adjustments, marks phase
    deployed, bumps `current_phase`, returns
    `continue|complete|escalate`.
  - `humanFeedbackNode` — creates a `feature-blocked`
    alert, calls `interrupt({type: 'human-feedback'})`.
- **Graph** (`graph.ts`): START → architecture → planner
  → phase-dispatch → await-phase → phase-evaluator →
  conditional edges (continue/adjust → phase-dispatch,
  complete → END, escalate → human-feedback). The
  conditional edge router reads `state.planningAction`.
  `runPlanningGraph({mode, featureId, ...})` accepts
  `start` or `resume`; on resume uses LangGraph's
  `Command({resume: value})` API (the brief's plain
  `graph.invoke(state)` would NOT have resumed — it
  would re-enter from START).
- **Two new BullMQ task types** added to `@gestalt/core`
  `TaskType` union: `planning:graph-start` and
  `planning:graph-resume`. Handlers live in the same
  `planning-orchestrator` worker so both paths share the
  process + queue.
- **Routing — opt-in per project**:
  - `HarnessConfig.planner.useLangGraph?: boolean`
    (default false) added to `@gestalt/core` `harness`.
  - In `handlePlanningStart`: a new
    `projectOptsIntoLangGraph` helper shallow-clones
    HARNESS.json (same pattern as `readMaxPhaseRetries`)
    and re-dispatches as `planning:graph-start` when the
    flag is true; legacy path runs otherwise.
  - In the `intent.status-changed` event subscriber:
    `featureHasGraphCheckpoint(featureId)` calls
    `PostgresSaver.getTuple({thread_id: featureId})` to
    detect whether the feature ran through the graph.
    If yes → dispatch `planning:graph-resume`; if no →
    legacy `planning:evaluate`. **Layering note**: the
    brief asked for the deploy promotion-agent to invoke
    the planning graph directly. Routing inside the
    existing subscriber instead keeps deploy decoupled
    from planning's internals — same outcome, cleaner
    layering (deploy still only fires
    `intent.status-changed`).
- **planning-orchestrator.ts marked `@deprecated`**
  (file-level JSDoc) per ADR-056 Phase 2 schedule. Kept
  fully functional until Phase 3 verification.

**Template + trackeros HARNESS:**

- Template `corporate-ops-web-mobile` HARNESS.json gets
  `"useLangGraph": false` under `planner`. Template bumped
  `0.38.0 → 0.39.0`. trackeros HARNESS adds the same
  explicit `false` so the opt-in surface is documented in
  place even when off.

**Build status:** `pnpm -r build` clean across all 13
packages. No new migration. No new env var.

**Live verification (TR_054 carryover):** trackeros HARNESS
still has `useLangGraph: false`. To exercise the graph
end-to-end:

```bash
# In trackeros HARNESS.json:
#   "planner": { ..., "useLangGraph": true }
# Push, then submit a feature:
gestalt feature submit "..." --project trackeros

# Watch for the new log lines:
docker compose logs server | grep -E "planning-graph|planning:graph"
# Expect:
#   planning:start — project opted into LangGraph PlanningGraph
#   planning-graph architectureNode invoking ArchitectureGraph
#   planning-graph plannerNode invoking planner-agent
#   planning-graph awaitPhaseNode interrupting
#   (BullMQ job returns; later promotion-agent fires resume)
#   PlanningGraph step complete
```

Check the checkpointer tables after a graph cycle:

```sql
SELECT thread_id, COUNT(*) FROM checkpoints
WHERE created_at > NOW() - INTERVAL '30 minutes'
GROUP BY thread_id;
-- Each running feature gets one row per checkpoint
-- (architecture subgraph thread_id = correlationId;
--  planning thread_id = featureId).
```

**Operator action — trackeros:** None new. Operator flips
`"useLangGraph": true` when ready to test the graph path
on a new feature submission. In-flight features stay on
the legacy path until they complete.

**Operator action — other projects:** Template auto-refreshes
to `0.39.0` at next server boot. Operators flip the flag
per project when ready.

### TR_052 — Live verification of LangGraph ArchitectureGraph (no code change; TEST_REPORT_052.md added; 3 new rigor bars surfaced as TR_053 follow-ups)

Rebuilt the gestalt server with the TR_051 source tree
(`docker compose down && docker compose up -d --build`),
fast-forwarded trackeros's `origin/main` with the
TR_051 HARNESS + agents.yaml edits as
`1f498b5b chore(TR_051): architecture-crew agentConfig + agents.yaml entries`,
then ran the leave-management verification recipe end-to-end.

**Architecture graph — confirmed working as designed.**

- Specialist fan-out parallel (all three started in the same
  scheduler tick at 11:14:35 server time; completions
  staggered 48s / 59s / 67s reflecting LLM latency only).
- Chief fan-in: ran only after all three specialists complete;
  took 198s on Kimi-K2.6 (12k max_tokens, 15,607 output
  tokens). RetryPolicy not exercised (first attempt
  succeeded).
- `state.errors` worked structurally — one specialist
  (domain-architect) returned a non-JSON response, the
  empty-fallback fired silently, chief reconciled around
  the missing slice and still emitted 6 entities.
- LangGraph 0.2 created **4 tables** on first call:
  `checkpoints`, `checkpoint_writes`, `checkpoint_blobs`,
  `checkpoint_migrations` (the TR_051 blueprint mentioned
  only the first two; corrected in AGENT_TEAMS.md).

**Chief output structurally richer than single-agent baseline.**

| Metric | TR_050 single-agent | TR_052 crew |
|---|---|---|
| domainEntities | 3 inferred | **6** named |
| modules | not enumerated | **5** with `owns` |
| dependencyMap edges | not enumerated | **7** |
| sqlSchemas | inline in archMd | **6 first-class CREATE TABLE statements** |
| architectureMdUpdate | ~750 chars | **3,396 chars**, GP-001/GP-002 references |

`AuditLog` emerged as a 6th entity even though the feature
description never mentions audit — the chief inferred it
from GP-002 loaded via `renderGoldenPrinciplesSection`. The
type-level contracts + golden-principles injection do exactly
what the TR_044 follow-up asked for.

**TR_036→TR_050 rigor bar accretion — structurally absorbed.**

Phase 1 of the leave-management feature deployed in **19m 27s
end-to-end** (vs TR_050's 20m for Phase 1 alone), with
intent-agent passing on the first attempt and NO HARNESS rule
firing to clear the symbol-name conflict / concrete-impl /
framework leak / lifecycle / SQL schema rigor bars. The
type-level contracts (`DomainDesign.lifecycleStates`,
`DataDesign.repositories[].concreteName + backing`,
`DataDesign.sqlSchemas[]`, etc.) absorb what 15+ HARNESS
rules were doing across TR_036→TR_050.

**Three new rigor bars surfaced as TR_053 follow-ups:**

- NRB-1 (MEDIUM) — review-agent failed silently on the
  large Phase 1 diff; constraint-agent's clean verdict was
  enough for the gate to pass, but the failed review-agent
  row is a confusing observable. Gate orchestrator should
  mark `skipped-on-error` when constraint-agent passes.
- NRB-2 (LOW) — specialist parse-to-empty fallback leaves
  `state.errors` empty; operators can't see which slice
  silently failed. Parsers in
  `graphs/architecture/agents.ts` should emit a sentinel
  string into `state.errors` when the response was non-empty
  but produced an empty Design.
- NRB-3 (LOW) — TR_044 `buildStackSubstitutions` hardcoded
  to `gpt-4o-mini`; fails on DeepInfra registry. Graceful
  empty-map fallback works. Now redundant since chief
  enforces stack compliance structurally — candidate for
  removal.

**Pipeline continues in background.** Phases 2-10 take an
estimated ~3 hours wall-clock and are not closed by this
session. Full completion verification is the **TR_053
carryover**.

**No platform code change. Build status unchanged from TR_051.**

**Operator action:** none new beyond the trackeros push at
`1f498b5b` (HARNESS + agents.yaml landed on `origin/main`).
TEST_REPORT_052.md added at `docs/claude/TEST_REPORT_052.md`.

### TR_051 — LangGraph migration Phase 1: ArchitectureGraph (ADR-056, template 0.38.0, build clean, live verification pending)

Replaces the single architecture-agent's feature-level
`designFeature` + `reviewDesign` pass with a LangGraph
StateGraph crew. Per-phase `designPhase` + `reviewPhaseDesign`
remain on the single architecture-agent until Phase 2 of the
migration.

**Platform code (10 changes):**

1. `@gestalt/agents-planning` adds three new dependencies:
   `@langchain/langgraph@^0.2.0`,
   `@langchain/langgraph-checkpoint-postgres@^0.0.1`,
   `@langchain/core@^0.3.0`. `pnpm install` clean.
2. `packages/agents/planning/src/graphs/architecture/state.ts`
   — LangGraph `Annotation.Root({...})` schema with `feature`,
   `existingArchitectureMd`, `goldenPrinciplesMd`,
   `harnessConfig`, `projectRoot`, `correlationId` inputs;
   `domainDesign` / `dataDesign` / `appDesign` parallel
   specialist outputs; `finalArchitecture` chief output;
   `errors[]` (with `[...a, ...b]` reducer) for specialist
   failures; `tokensUsed` (with `a + b` reducer) cumulative
   across all four agents.
3. `graphs/architecture/types.ts` — `DomainDesign` /
   `DataDesign` / `AppDesign` shapes (the LLM contract for
   each specialist; the chief receives them as JSON in its
   prompt).
4. `graphs/architecture/prompts.ts` — strict ADR-042:
   structural framing + JSON schemas only. Shared
   `renderStackSection` / `renderGoldenPrinciplesSection` /
   `renderExtensions` / `renderArchExcerpt` / `renderFeatureBlock`
   helpers reused across all four prompts. Each specialist
   prompt explicitly notes which slice it owns and which
   slices it must NOT touch.
5. `graphs/architecture/agents.ts` — `DomainArchitectAgent` /
   `DataArchitectAgent` / `AppArchitectAgent` /
   `ChiefArchitectAgent` classes, each extending
   `BaseLLMAgent`. Token management (ADR-057) +
   `lastTokensUsed` accumulator + `agents.yaml`/`HARNESS.json`
   loading inherited automatically. JSON parsers mirror the
   patterns in `agents/architecture-agent.ts`.
6. `graphs/architecture/nodes.ts` — four LangGraph node
   wrappers. Each calls its agent's `design()`/`review()`
   method, logs the result (entity / module / phase counts +
   tokens), and returns a `Partial<state>` for LangGraph's
   reducer to merge. Specialist errors surface as
   `state.errors[...]` instead of throwing — the chief can
   reconcile around a missing slice.
7. `graphs/architecture/graph.ts` — compiled `StateGraph`:
   `START` → `[domain || data || app]` → `chief` → `END`
   (LangGraph's fan-out + fan-in). Identical `RetryPolicy`
   on every specialist (3 attempts, exponential backoff,
   `retryOn` matches timeouts / sockets / 5xx / 429); chief
   capped at 2 attempts. Compiled graph cached at module
   scope. `runArchitectureGraph(input)` is the public
   interface — throws when the chief produces empty output
   so the orchestrator's outer catch blocks the feature.
8. `graphs/checkpointer.ts` — singleton `PostgresSaver`
   (process-wide because it owns a `pg.Pool`). Reads
   `DATABASE_URL` via `loadConfig()`. `setup()` is
   idempotent; LangGraph creates its own `checkpoints` +
   `checkpoint_writes` tables on first call — no Gestalt
   migration needed.
9. `packages/core/src/types.ts` — `AgentRole` literal union
   gains four new values: `domain-architect-agent` /
   `data-architect-agent` / `app-architect-agent` /
   `chief-architect-agent`.
10. `packages/core/src/agents/agent-config-loader.ts` —
    `PER_ROLE_DEFAULTS` gains entries for the four new roles
    (temperature 0.1; specialists 6k max_tokens; chief 12k;
    no file tools — the crew works from prompt context only,
    the orchestrator already provides cloned-tree files).
11. `orchestrator/planning-orchestrator.ts` — `handlePlanningStart`
    swaps `architectureAgent.designFeature(...)` +
    `architectureAgent.reviewDesign(...)` for a single
    `runArchitectureGraph({...})` call. The orchestrator
    logs specialist errors when present but proceeds —
    the chief reconciles around them. `buildStackSubstitutions`
    (TR_044) stays on the single architecture-agent class
    because it's a dedicated one-shot classification, not an
    architectural reasoning task.
12. `agents/architecture-agent.ts` — `designFeature` +
    `reviewDesign` marked `@deprecated` (TR_051 / ADR-056
    Phase 1) but retained as fallback. `designPhase` +
    `reviewPhaseDesign` untouched — Phase 2 absorbs them.
13. `src/index.ts` — public exports added for
    `runArchitectureGraph`, the four agent classes, and the
    three specialist `Design` types.

**HARNESS (template + trackeros):**

14. New `agentConfig.domain-architect-agent.rules` —
    define entities + lifecycle states, never persistence,
    everything in domainNotes.
15. New `agentConfig.data-architect-agent.rules` — every
    persistent entity gets a complete CREATE TABLE; every
    repository names its concrete backing implementation.
16. New `agentConfig.app-architect-agent.rules` — layer
    boundaries, inward-only dependency direction, no
    circular deps.
17. New `agentConfig.chief-architect-agent.rules` —
    reconciliation, not regeneration; resolve symbol-name
    conflicts; verify stack compliance; reconcile around
    missing specialist slices.

**agents.yaml (template + trackeros):**

18. Four new agent entries with `prompt_extensions`.
    Template uses `model: ~` (platform default). trackeros
    binds the specialists to `deepseek-ai/DeepSeek-V3.2`
    (TR_050's stable choice on DeepInfra, max 6k) and the
    chief to `moonshotai/Kimi-K2.6` (max 12k — same budget
    as TR_050's single-agent setting; Kimi is better at
    producing direct structured reconciliation output than
    DeepSeek per TR_050 verification cycles).

Template `0.35.0 → 0.38.0`. No new Gestalt migration.
`pnpm -r build` clean across all 13 packages.

**Live verification pending — recipe:**

```bash
docker-compose up -d --build
docker-compose logs server | grep -E "architecture-graph|langgraph|checkpoint"

gestalt feature submit \
  "Build the leave management module. Employees apply for
   annual, sick, and emergency leave. Managers approve or
   reject. System tracks leave balances." \
  --project trackeros

gestalt feature status <featureId> --watch
```

Then in psql:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE 'checkpoint%';
-- expect: checkpoints, checkpoint_writes (LangGraph-created)

SELECT agent_role, COUNT(*) FROM agent_executions
WHERE created_at > NOW() - INTERVAL '10 minutes'
GROUP BY agent_role ORDER BY agent_role;
-- expect: 1 row per architecture-crew agent per feature
```

Expected: all three specialist nodes fire in parallel (logs
within ~1s of each other); chief fires after; final feature
architecture richer than single-agent output (named
concrete repository implementations + full SQL schema +
explicit lifecycle states).

**Operator action — trackeros:** my edits to
`/Users/amrmohamed/Work/trackeros/HARNESS.json` and
`/Users/amrmohamed/Work/trackeros/agents.yaml` are unpushed.
The operator should review + commit + push so the next
planning cycle picks them up. The new specialist + chief
blocks are abstract / language-agnostic and should not
conflict with the project linter's existing rule format.

**Operator action — other projects:** Existing projects
inherit the architecture-crew defaults via
`PER_ROLE_DEFAULTS` automatically. Projects that want to
override per-agent prompt_extensions or LLM bindings add
the four new entries to their `agents.yaml` + (optional)
HARNESS rules. Template auto-refreshes to `0.38.0` at next
server boot.

### TR_050 — DeepInfra integration + Aider as the only code-generation backend + 5 cascading timeout fixes (template 0.35.0, build clean, Phase 1 deployed end-to-end on Kimi-K2.6/DeepSeek-V3.2/Aider for the FIRST EVER autonomous source-file generation on DeepInfra)

Multi-stage migration off OpenAI/Azure onto DeepInfra-hosted
open models, with 8 platform + harness changes layered to
unblock progressively-deeper timeout / config issues. The
session ran 10 cycles, each one identifying a different
layer in the cascade.

- **Operator action — LLM registry**: 3 DeepInfra LLMs
  registered via `gestalt platform llms add`:
  `deepinfra-kimi-k2` (moonshotai/Kimi-K2.6),
  `deepinfra-deepseek-v3` (deepseek-ai/DeepSeek-V3.2),
  `deepinfra-qwen-tiny` (Qwen/Qwen3.5-0.8B). All
  `chat-completions` apiShape on
  `https://api.deepinfra.com/v1/openai`, key env
  `DEEPINFRA_API_KEY`.
- **Operator action — platform default**: flipped from
  `chat-latest` → `deepinfra-deepseek-v3` via
  `gestalt platform llms set-default`. Every agent on
  `model: ~` (context-agent / test-agent / drift /
  alignment / gc) now inherits DeepSeek-V3.2.
- **trackeros agents.yaml — 9-agent matrix**:
  architecture-agent → DeepSeek-V3.2; self-healing-agent →
  Kimi-K2.6 (short prompts); planner / phase-evaluator /
  constraint / review / intent / design → DeepSeek-V3.2;
  code-agent (Aider) → Kimi-K2.6. `reasoning_effort` fields
  removed (DeepInfra OpenAI-compat doesn't support).

**Fix 1 — Aider is the only code-generation backend**

- `packages/agents/generate/src/orchestrator/orchestrator.ts`
  both `aiderBackend` checks: `(harnessConfig?.codeGeneration?.backend ?? 'aider') === 'aider'`.
  Absent block → Aider. Gestalt-native CodeAgent reachable
  only by explicit `backend: 'gestalt'` opt-out.
- `packages/core/src/harness/index.ts` JSDoc rewritten —
  Aider documented as default; `'gestalt'` value marked
  deprecated-but-retained.
- Template HARNESS.json + trackeros HARNESS.json carry
  `codeGeneration.backend: 'aider'` explicitly.

**Fix 2 — `.env` and timeouts**

- Fixed `LLM_MOCEL` typo → `LLM_MODEL`. Set `LLM_API_KEY` to
  the DeepInfra key (loadConfig requires both; server
  was in restart loop).
- `LLM_TIMEOUT_MS=300000` (5 min; default 120s was killing
  Kimi-K2.6 architecture-agent calls).

**Fix 3 — BullMQ Worker stall-retry storm fix**

- `packages/core/src/queue/index.ts` adds
  `lockDuration: 600000` (10 min) and
  `maxStalledCount: 0` to every Worker. BullMQ's default
  (30s lock + 1 stalledCount) marked long planning:start
  as stalled and dispatched a duplicate handler — both
  inserted feature_phases rows, second hit unique
  constraint, cycle died with duplicate-key error.

**Fix 4 — Retryable fetch errors**

- `packages/core/src/llm/index.ts` `classifyError` extended
  to mark `TypeError: fetch failed`, `ECONNRESET`,
  `ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN`, `socket hang up`
  as `retryable: true`. Closes the TR_033 follow-up.

**Fix 5 — Aider litellm provider prefix**

- `packages/agents/generate/src/adapters/aider-adapter.ts`
  prepends `openai/` to the model string when it lacks
  one of 17 known litellm provider prefixes. Closes the
  `LLM Provider NOT provided. You passed model=deepseek-
  ai/DeepSeek-V3.2` error that killed every DeepInfra/
  Aider call before Phase 1 could write any source.
  Validated by Aider stdout: `Model: openai/moonshotai/
  Kimi-K2.6 with whole edit format`.

**Fix 6-8 — Aider subprocess timeout cascade**

THREE nested ceilings, each one needed bumping in turn
because the inner-most was clamping all the outer
adjustments:

6. `DEFAULT_AIDER_TIMEOUT_MS`: 120_000 → 900_000 in
   aider-adapter.ts (adapter ceiling — irrelevant until
   the inner ceilings were lifted).
7. Aider CLI flag `--timeout 600` added (Aider's own
   per-LLM HTTP timeout; litellm/httpx default 120s).
8. `MAX_SCRIPT_TIMEOUT_MS` in `core/src/tools/file-tools.ts`:
   120_000 → 900_000. THE actual ceiling.
   `executeScript` (which Aider runs through) was
   clamping every timeout to 120s. Container-confirmed
   the compiled `dist/tools/file-tools.js` carries the
   new value before Phase 1 success.

Template `0.34.0 → 0.35.0`. No new migration.
`pnpm -r build` clean across all 13 packages.

**Live verification — Phase 1 DEPLOYED on DeepInfra/Aider:**
trackeros feature `523e9824-b189-42e7-9b11-efa453133db7`,
the 10th cycle of the session:

- ✅ Wall-clock 20m 03s phase-submitted → phase-evaluated:
  success.
- ✅ Path: intent-agent (DeepSeek, no escalation) →
  design-agent (DeepSeek) → context-agent (DeepSeek) →
  code-agent (Aider/Kimi — REAL source files written) →
  test-agent (skipped per Aider backend) → pr-agent →
  pipeline-agent (noop) → constraint-agent (DeepSeek,
  PASSED) → review-agent (DeepSeek, PASSED) →
  promotion-agent.
- ✅ **First successful autonomous source-file generation
  cycle on DeepInfra across TR_036 → TR_050.**
- ✅ Architecture: 3 interfaces + 7 criteria. Plan:
  6 phases.

**Cycles before the working stack landed:** session ran
10 cycles, each one revealing a different layer:

1. `a88cfb44` — default 120s LLM_TIMEOUT_MS too tight
2. `0b39864a` — test-agent retry-stormed on Kimi
3. `b560bec5` — architecture-agent timed out on Kimi (50%)
4. `e3298836` — DeepSeek code-agent worked (144k tokens)
   but gate found 9 violations → retry-exhaust
5. `a57e62c3` — BullMQ duplicate planning:start
6. `9a0df185` — transient `TypeError: fetch failed`
7. `1f24e41f` — Aider returned 3.8s (litellm prefix bug)
8. `ae9bd00b` — prefix fix landed, Phase 1 reached gate
   but review-agent found 9 violations → escalate
9. `4cd459c6` → `1a6a0bc1` → `530d359e` — three
   successive timeout layers identified
10. `523e9824` — **Phase 1 deploys.** Phase 2 escalates
    on new rigor bars (below).

**Phase 2 blocker (deferred to TR_051):**

Phase 2 (`Leave request service with validation`)
escalated 1m 50s after dispatch on three high-impact
ambiguities:

- **amb-001**: intent mentions "Jest unit tests" but the
  project uses Vitest — `testFramework` binding
  regressed vs TR_040/TR_041 because DeepSeek-V3.2 doesn't
  internalise HARNESS.stack as crisply as gpt-5.5.
- **amb-002**: ILeaveService interface shows state
  transitions but success criteria only mention
  creation — interface vs scope mismatch (lifecycle
  coverage rigor bar TR_041 closed for architecture-
  agent; recurring on DeepSeek).
- **amb-003**: architecture mentions "atomic
  transactions" without pinning the implementation
  approach — TR_046 transaction-semantics rigor bar
  resurfacing on DeepSeek.

These are the **same class** TR_036-TR_047 worked
through. HARNESS rules and review-checklist items still
in place — but DeepSeek-V3.2 doesn't follow them as
crisply.

**New HIGH follow-up for TR_051:** TR_036-TR_047
architectural rules need re-strengthening for DeepSeek-
V3.2. Three options: (a) more imperative rule wording;
(b) switch architecture-agent back to Kimi-K2.6 with
smaller max_tokens to manage cost; (c) deterministic
post-process pass catching framework/lifecycle/
transaction drift before intent-agent sees it.

**New MEDIUM follow-ups:**
- Aider model warnings on DeepInfra (litellm doesn't
  recognise the model names → falls back to "sane
  defaults" for context window / cost; functionally
  harmless, noisy in stdout).
- Switch trackeros pipeline adapter from `noop` to
  `github-actions` to verify the full deploy chain.

**Operator action — trackeros:** my commits already
pushed (HARNESS.json `de2f82c2`, agents.yaml `8985531e`,
two follow-up matrix swaps `533de072` and `823e9e66`).

**Operator action — other projects:** Existing projects
need to add `codeGeneration.backend: 'aider'` to their
HARNESS.json IF they want to be explicit about the now-
default backend, OR they can leave the block absent and
inherit the new default. Existing projects on the
Gestalt-native CodeAgent path must add
`backend: 'gestalt'` explicitly or they will silently
migrate to Aider. Template auto-refreshes to `0.35.0` at
next server boot.

### TR_049 — Mandatory SQL schema for relational-database stacks (template 0.34.0, build clean, TR_048's 10th bar CLOSED end-to-end, Phase 1 cleared the full Gestalt agent pipeline for the first time; 11th rigor bar surfaced — class shape drift across phases)

Two changes — one HARNESS rule + one platform-code
review-checklist item — closing TR_048's 10th
intent-agent rigor bar. SQL schema output is now
categorical when the declared stack includes a relational
database.

- **Fix 1** —
  `agentConfig.architecture-agent.rules` in template +
  trackeros HARNESS appended with: "When the declared
  stack includes a relational database, you MUST include
  a complete SQL schema in your output for every
  persistent domain entity you define. A domain entity
  without a corresponding table definition is incomplete.
  The schema must include column names, types,
  constraints, and indices relevant to the entity's
  lifecycle." Abstract — no DB names hardcoded; the LLM
  determines whether the declared stack qualifies.
- **Fix 2** —
  `packages/agents/planning/src/prompts/architecture-prompt.ts`
  both `buildArchitectureReviewPrompt` and
  `buildPhaseArchitectureReviewPrompt` gain a 9th item:
  "SQL schema completeness — if the declared stack
  includes a relational database, verify that every
  persistent domain entity defined in this architecture
  has a corresponding SQL table definition. If any
  entity is missing a table definition, add it before
  returning." Feature-level closing → "all eight
  checks". Per-phase closing → "all nine checks".

Template `0.33.0 → 0.34.0`. No new migration.
`pnpm -r build` clean across all 13 packages.

**Live verification — TR_048's 10th bar CLOSED
end-to-end:** trackeros feature
`dca0cb06-98bd-4720-913e-83f43359a23d` on `chat-latest`:

- ✅ Architecture-agent emitted **6 CREATE TABLE
  statements** in `architectureMdUpdate` (employees,
  leave_policies, leave_balances, leave_requests,
  notifications, audit_records) — DB-confirmed. Compare
  TR_048's zero. The mandatory-SQL rule worked.
- ✅ **TR_048's canonical-schema-reuse machinery FIRED
  for the first time across the entire TR_036 → TR_049
  sequence.** Server logs show
  `TR_048 — injecting canonical SQL schemas into
  per-phase prompts` three times (once per
  phase-architecture pass).
- ✅ **Phase 1 `sqlSchema`** populated:
  `CREATE TABLE leave_requests (id UUID PRIMARY KEY,
  employee_id UUID NOT NULL, leave_type VARCHAR(20)
  NOT NULL, status VARCHAR(20) NOT NULL, CONSTRAINT
  fk_leave_requests_employee FOREIGN KEY (employee_id)
  REFERENCES employees(id));`
- ✅ **Phase 2 `sqlSchema`** populated:
  `CREATE TABLE audit_records (id UUID PRIMARY KEY,
  entity_type VARCHAR(100) NOT NULL, entity_id UUID
  NOT NULL, action VARCHAR(100) NOT NULL);`
- ✅ **Plan: 10 phases.** Architect fanned out
  persistence into discrete per-entity phases (vs
  TR_048's 5-phase bundling) — likely a response to the
  mandatory-SQL rule combined with TR_048's
  canonical-schema-reuse, where one entity per phase
  gives the cleanest reuse story.
- ✅ Phase 1 per-phase architecture: 3 interfaces + 7
  criteria (one extra criterion from the new 9th-item
  check).
- ✅ **Phase 1 cleared the FULL Gestalt agent pipeline
  end-to-end** — intent-agent → design-agent →
  lint-config-agent → context-agent → code-agent
  (Aider) → test-agent → pr-agent → pipeline-agent →
  constraint-agent PASSED → review-agent PASSED →
  promotion-agent. **First phase across the entire
  TR_036 → TR_049 sequence to make it from intent →
  promotion without escalation.** Wall-clock 7m 03s
  (`phase-submitted 18:34:14` → `phase-evaluated:
  success 18:41:17`).

**Verification caveat — NoOp pipeline adapter on
trackeros:** trackeros's `HARNESS.json` is currently on
`pipeline.adapter: noop` (operator state since TR_043
rapid iteration). So while Phase 1 cleared every Gestalt
agent stage including constraint-agent and review-agent,
the deploy stage was a no-op — no PR created on GitHub,
no CI ran, no merge on trackeros's `main`. Phase 1 has
`status: deployed` because the NoOp adapter advertises
success. The agent-cycle validation is real; the
pipeline plumbing ran on the noop path.

**Cycle blocked at Phase 2 on a NEW 11th rigor bar
(orthogonal):**

> **amb-001 (high impact)**: "The architecture notes
> define `PostgreSqlAuditRepository` as an abstract
> class, while the detailed architecture defines it as
> a concrete class with stubbed methods throwing 'Not
> implemented in Phase 2'."

Class shape drift between the high-level
architectureMdUpdate (architecture-agent designFeature)
and the per-phase architecture (architecture-agent
designPhase). Symbolically identical to TR_036's
"symbol-name conflict" but at the level of class shape
rather than name, and across phases. The fix-intent
went all the way through to review-agent before
intent-agent clarification escalated.

**New HIGH follow-up for TR_050:** architecture-agent
must keep class shape (abstract / concrete /
interface-only) and method-body status (stubbed /
implemented / signature only) consistent for the same
class across both high-level + per-phase views.
Options:

- (a) New `architectureGuidance` rule: "When the same
  class appears in both the high-level architecture
  and a per-phase architecture, its shape and
  method-body status MUST be identical"; OR
- (b) New review-checklist item: "Class shape
  consistency"; OR
- (c) Per-phase architecture for the phase that
  CREATES a class is authoritative and supersedes the
  high-level mention — emit this rule in planner-agent
  and intent-agent.

**New MEDIUM follow-up for the operator:** switch
trackeros pipeline adapter from `noop` back to
`github-actions` so the next cycle's Phase 1 verifies
the full deploy chain (PR → CI → PR-Agent → gate →
squash-merge). Until then, "Phase deployed" means
"Gestalt agent cycle passed" not "code on main".

**Operator action — trackeros:** my edits to
`HARNESS.json` are already pushed at `fc4954ac
chore(TR_049): architecture-agent rule — SQL schema
mandatory for relational DB stacks`.

**Operator action — other projects:** Append the new
architecture-agent rule to existing projects' HARNESS.
Template auto-refreshes to `0.34.0` at next server
boot.

### TR_048 — Canonical SQL schema reuse across feature-level + per-phase architecture views (template 0.33.0, build clean, plumbing verified, architect emitted no SQL this cycle; 10th rigor bar surfaced — explicit SQL output is required-but-optional in guidance)

Three platform fixes + one HARNESS rule closing TR_047's 9th
intent-agent rigor bar (architecture-agent emitted two views
of the same `leave_requests` table with drifted column
types — `TIMESTAMP vs TIMESTAMPTZ`, `VARCHAR(32) vs
VARCHAR(20)`). The fix establishes a single source of truth:
the feature-level architecture is canonical; per-phase
references it instead of redefining.

- **Fix 1a** — `extractCanonicalSqlSchemas` helper +
  `renderCanonicalSqlSchemaSection` helper +
  `canonicalSqlSchemas: string[] = []` parameter on
  `buildPhaseArchitecturePrompt` and
  `buildPhaseArchitectureReviewPrompt`. Source 1: explicit
  `sqlSchemas[]` field (forward-compatible). Source 2:
  regex `/CREATE\s+TABLE[\s\S]+?;/gi` against
  `architectureMdUpdate`. Empty array → section omitted.
- **Fix 1b** — `designPhase` + `reviewPhaseDesign` accept
  the parameter; `runPerPhaseArchitecture` orchestrator
  extracts once and passes to BOTH.
- **Fix 2** — 8th review-checklist item ("Schema
  consistency — if a `## Canonical SQL schemas` block was
  provided, your `sqlSchema` field MUST use the EXACT same
  column names, types, and constraints…") + closing line
  "all EIGHT checks".
- **Fix 3** — `agentConfig.architecture-agent.rules` in
  template + trackeros HARNESS appended: "When a canonical
  schema is provided for a table, use it exactly. Do not
  redefine column types, sizes, or constraints. A table
  must have one definition across all architecture views."

Template `0.32.0 → 0.33.0`. No new migration.
`pnpm -r build` clean across all 13 packages.

**Live verification — TR_048 plumbing CORRECT, but
architect emitted NO SQL this cycle:** trackeros feature
`f070332a-b048-41c9-875f-0f7a4fe6a192` on `chat-latest`:

- ✅ `runPerPhaseArchitecture` ran cleanly without errors
  for Phase 1.
- ✅ `extractCanonicalSqlSchemas` returned an empty array
  (no "TR_048 — injecting canonical SQL schemas" log line),
  consistent with `architectureMdUpdate` containing zero
  CREATE TABLE statements (DB-confirmed) and
  `feature_phases[0].architecture` having no `sqlSchema`
  field at all (only `interfaces`, `successCriteria`,
  `importStatements`).
- ✅ **Plan: 5 phases — tightest plan yet** across
  TR_036 → TR_048 (vs TR_047's 8, TR_046's 6, TR_045's 7,
  TR_044's 10).
- ✅ Phase 1 architecture: 4 interfaces + 6 criteria; one
  criterion explicitly states atomic single-PostgreSQL-
  transaction semantics — TR_047's 7th checklist surfacing
  in the per-phase pass.

**Cycle blocked on a 10th intent-agent rigor bar:**

> **amb-001 (high impact)**: "The exact PostgreSQL schema
> and table definitions for LeaveRequest and
> LeaveAuditRecord persistence are not specified."

First bar in the sequence where the prior fix's machinery
worked correctly but had no input to act on. The architect
read `architectureGuidance`'s "SQL schema if needed" as
optional even with 4 interface signatures referencing a
PostgreSQL `Pool` and a `PostgreSqlLeaveRepository` class.

**New HIGH follow-up for TR_049:** architecture-agent must
categorically produce explicit CREATE TABLE statements
for every persisted entity when the project stack declares
a relational database. Options:

- (a) `architecture-agent.architectureGuidance` rule:
  "When the declared stack includes a relational database
  (Postgres, MySQL, SQL Server, Oracle), every domain
  entity that persists state MUST have a CREATE TABLE
  statement in `architectureMdUpdate` (or a
  `sqlSchemas[]` field). Do not leave persistence schemas
  implicit."; OR
- (b) Add `sqlSchemas?: string[]` as a first-class field
  on `FeatureArchitecture` with the JSON output schema
  requiring it when `HARNESS.stack.database` is set; OR
- (c) Per-phase review's 8th item promoted: "if
  `sqlSchema` is empty on a phase that creates
  persistence interfaces, REQUEST the canonical schema
  from the feature level or write the schema here".

**Observation:** TR_048's machinery (helper + threading +
section + checklist + HARNESS rule) is in place and will
fire the moment a downstream fix forces architecture-agent
to emit `CREATE TABLE` text. Verified by absence.

**Operator action — trackeros:** none beyond the
already-pushed `b1d6c878 chore(TR_048): architecture-agent
rule — canonical schema reuse across views`.

**Operator action — other projects:** Append the new
architecture-agent rule to existing projects' HARNESS.
Template auto-refreshes to `0.33.0` at next server boot.

### TR_047 — Architecture-agent rule + 7th review-checklist item: transaction semantics for cross-cutting operations (template 0.32.0, build clean, cycle reached the gate for the 3rd time with TWO consecutive 1-violation runs)

One HARNESS rule + one platform-code rule closing TR_046's
8th intent-agent rigor bar (architecture-agent bundled
`LeaveRequest` + `AuditRecord` mutations into Phase 1 without
explicit transaction semantics).

- **Fix 1** —
  `agentConfig.architecture-agent.rules` in template + trackeros
  HARNESS gains: "When a phase includes multiple domain
  mutations that must be coordinated (a primary operation plus
  a cross-cutting concern such as audit logging, event
  publishing, or cache invalidation), explicitly state the
  transaction semantics: whether the operations execute
  atomically in a single transaction, as separate
  transactions, or via a compensating pattern. Do not leave
  transaction behavior implicit."
- **Fix 2** —
  `packages/agents/planning/src/prompts/architecture-prompt.ts`
  `buildArchitectureReviewPrompt` (feature) and
  `buildPhaseArchitectureReviewPrompt` (per-phase) gain a 7th
  checklist item ("Transaction semantics") asking the review
  pass to ensure every phase with multiple coordinated
  mutations explicitly declares its transaction behavior. Both
  prompts updated to "If the draft passes all SEVEN checks,
  return it unchanged".

Abstract — no specific patterns hardcoded; the LLM picks
atomic/saga/eventual based on the stack and operations
involved.

Template `0.31.0 → 0.32.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — TR_046 8th-bar CLOSED (by structural
redesign):** trackeros feature
`d90d14b5-3632-4b6e-8711-7d7ebb846efd` on `chat-latest`:
- ✅ Architecture-agent saw the transaction-semantics
  constraint at design time and responded by SPLITTING
  `AuditRecord` into its own Phase 2 (separate from Phase
  1's `LeaveRequest`). Phase 1 became a clean single-
  mutation phase — no coordinated mutations → no
  transaction-semantics question. This is a valid
  architectural answer different from the brief's intent
  ("state the semantics") but it closes the bar.
- ✅ Phase 1 architecture: **4 interfaces + 7 criteria**
  on first attempt (the 7th criterion is the new TR_047
  transaction-semantics check).
- ✅ Plan: 8 phases with the AuditRecord-LeaveRequest
  split visible.
- ✅ **Cycle reached the gate — THIRD time across TR_036 →
  TR_047.** Gate ran 3 times with verdicts: 6 → **1**
  → **1** CONSTRAINT_VIOLATION. Two consecutive
  1-violation gate runs — closest to a clean gate pass
  the cycle has ever been.

**Cycle still blocked on the 9th and narrowest intent-agent
rigor bar yet:** "The provided SQL schemas conflict on column
types and sizes: one version uses TIMESTAMP and VARCHAR(32),
while another uses DATE/TIMESTAMPTZ and VARCHAR(20)."
Architecture-agent emitted TWO views of the same
`leave_requests` table — one in the feature-level
`architectureMdUpdate`, another in Phase 1's `sqlSchema` —
with drifted column types. Intent-agent caught the internal
inconsistency.

**New HIGH follow-up for TR_048:** schema-consistency
guardrail. Options:
- (a) architectureGuidance rule: "When the same database
  table is described in both the feature-level architecture
  and a per-phase architecture, the column types and sizes
  MUST match byte-for-byte"; OR
- (b) 8th review checklist item: "Schema consistency —
  every SQL schema mentioned across the architecture for
  the same table must declare identical column types and
  sizes"; OR
- (c) platform-side: store one canonical schema per table
  in `FeatureArchitecture.sqlSchemas` and render it the
  same way in both prompts.

**Operator action — trackeros:** none beyond the
already-pushed `b50cb7f8 chore(TR_047): architecture-agent
rule — explicit transaction semantics for coordinated
mutations`.

**Operator action — other projects:** Append the new
architecture-agent rule to existing projects' HARNESS.
Template auto-refreshes to `0.32.0` at next server boot.

### TR_046 — Architecture-agent rule + 6th review-checklist item: new domain concepts must appear in architectureMdUpdate (template 0.31.0, build clean, cycle reached the GATE for the 2nd time across TR_036 → TR_046)

One HARNESS rule + one platform-code rule. Closes TR_045's 7th
intent-agent rigor bar (architecture-agent introducing
`CANCELLED` to support a cancel workflow phase but the project
context's documented lifecycle had only three other states).

- **Fix 1** —
  `agentConfig.architecture-agent.rules` in template + trackeros
  HARNESS gains: "When your architecture introduces any new
  domain concept that does not appear in the existing project
  documentation (new lifecycle states, new enum values, new
  entity types, new relationships), you MUST include it in
  architectureMdUpdate so the project documentation stays
  consistent with the architecture. Never introduce a concept
  in code interfaces that is absent from the project docs."
- **Fix 2** —
  `packages/agents/planning/src/prompts/architecture-prompt.ts`
  both `buildArchitectureReviewPrompt` (feature) and
  `buildPhaseArchitectureReviewPrompt` (per-phase) gain a 6th
  checklist item ("Documentation consistency") asking the
  review pass to ensure every new domain concept lands in
  `architectureMdUpdate` (feature) or surfaces in a
  `successCriteria` line (per-phase).

Template `0.30.0 → 0.31.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — TR_045 7th-bar CLOSED + cycle reached
the gate (2nd time across TR_036 → TR_046):** trackeros
feature `795e1069-b25f-4426-bdc3-227aa160f3a9` on
`chat-latest`:
- ✅ Architecture-agent did NOT introduce `CANCELLED` this
  cycle. `architectureMdUpdate` documents the lifecycle
  exactly as the project context defines it (Pending /
  Approved / Rejected). No "Create AND cancel" phase in
  the plan.
- ✅ Tightest plan yet — **6 phases** (vs TR_045's 7,
  TR_044's 10). Phase 1 bundles `LeaveRequest AND
  AuditRecord domain models with persistence` — TR_044's
  goldenPrinciples injection enabling cross-cutting
  concern integration.
- ✅ Phase 1 architecture: **5 interfaces + 6 criteria**
  — richest yet across the TR_036 → TR_046 sequence. The
  6th criterion is the new doc-consistency item from Fix
  2 surfacing in the per-phase pass.
- ✅ **Cycle reached the gate — SIX gate runs across
  two phase-retry attempts** with violation counts
  trending **5 → 4 → 1 → 3 → 3 → 3** CONSTRAINT_VIOLATION.
  The single-violation run is the closest the cycle has
  ever been to a gate pass.

**Cycle still blocked on the 8th intent-agent rigor bar:**
> "Transaction behavior for createLeaveRequest and AuditRecord
> creation is not explicitly defined."

This is a genuine architectural concern surfaced by TR_044's
`AuditRecord` cross-cutting integration landing in Phase 1
ALONGSIDE `LeaveRequest`. When two domain mutations land in
the same phase, transaction semantics (atomic vs distributed
vs eventual consistency) become a real choice the
architecture should pin down.

**New HIGH follow-up for TR_047:** architecture-agent should
explicitly state transaction semantics (atomic / non-atomic /
compensating) for every cross-cutting operation that lands in
the same phase as a primary domain mutation.

**Operator action — trackeros:** none beyond the
already-pushed `645cd7cd chore(TR_046): architecture-agent
rule — new domain concepts must appear in architectureMdUpdate`.

**Operator action — other projects:** Append the new
architecture-agent rule to existing projects' HARNESS.
Template auto-refreshes to `0.31.0` at next server boot.

### TR_045 — Third intent-agent rule: interface signatures are contracts (template 0.30.0, build clean, TR_044 6th-bar CLOSED)

One abstract rule appended to
`agentConfig.intent-agent.rules` in template + trackeros
HARNESS. Closes TR_044's NEW HIGH finding (intent-agent
escalating on TypeScript interface signatures with no method
bodies as "stubs throwing 'Not implemented'"). No platform code
change. No new migration.

The rule (no TypeScript-specific language; applies to any
contract pattern in any language):

> "Interface method signatures in per-phase architecture
> specifications are CONTRACTS to be implemented by the
> code-agent during this phase. They are not stubs. An
> interface showing method signatures without bodies is
> correct and complete — do not flag missing method bodies as
> ambiguity or missing implementation."

Template `0.29.0 → 0.30.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — TR_044 6th bar CLOSED:** trackeros feature
`48aa490e-4142-442c-bab4-41c03e21e4b9` on `chat-latest`:
- ✅ Intent-agent did NOT escalate on the
  interface-signatures-as-stubs pattern. Phase 1 intent
  `5910f943` transitioned cleanly from `pending` →
  `generating` immediately on dispatch.
- ✅ Plan tightened to 7 phases (vs TR_044's 10). Phase 2
  bundles "Create AND cancel leave requests"; Phase 7
  bundles "Employee integration, RBAC, balance consumption,
  and compliance coverage".
- ✅ Phase 1 per-phase architecture: **5 interfaces + 5
  criteria** — richest across the TR_036 → TR_045 sequence.

**Cycle still blocked on a 7th rigor bar:** intent-agent
escalated on "The project context defines LeaveRequest
lifecycle states as Pending, Approved, Rejected, while the
phase architecture specifies repository model status values
PENDING, APPROVED, REJECTED, and CANCELLED". Architecture-
agent introduced `CANCELLED` to support Phase 2's cancel
workflow but the documented project lifecycle (in
ARCHITECTURE.md / GOLDEN_PRINCIPLES.md) only lists the three
other states.

**New HIGH follow-up for TR_046:**
- (a) architecture-agent rule: "If a feature requires a
  lifecycle state not in the project context, add the new
  state to `architectureMdUpdate` so docs are updated in
  lockstep"; OR
- (b) intent-agent rule: "If a phase introduces a state
  value implied by the feature scope (e.g. 'cancel' implies
  a CANCELLED state), treat the new value as consistent with
  the documented lifecycle"; OR
- (c) architecture-agent regex post-processing that
  normalises lifecycle state names against the documented
  set.

**Operator action — trackeros:** none beyond the
already-pushed `b49b65c8 chore(TR_045): intent-agent rule —
interface signatures are contracts, not stubs`.

**Operator action — other projects:** Append the third rule
to existing projects'
`HARNESS.json.agentConfig.intent-agent.rules`. Template
auto-refreshes to `0.30.0` at next server boot.

### TR_044 — LLM-generated stack-substitution map (regex post-process for per-phase architecture) + goldenPrinciples injection into architecture-agent prompts (template 0.29.0, build clean, per-phase framework leak CLOSED end-to-end)

Two fixes against TR_042's two HIGH NEW follow-ups — per-phase Vitest
leak and goldenPrinciples-aware architecture-agent.

- **Fix 1 (stack substitution)** — three parts:
  - `buildStackSubstitutionPrompt` + `applyStackSubstitutions`
    pure utility added to `architecture-prompt.ts`. The platform
    has ZERO framework knowledge baked in — the LLM enumerates
    alternatives per ecosystem; the utility receives a Map and
    applies it via case-insensitive word-boundary regex to every
    string field of a `PhaseArchitecture`.
  - `ArchitectureAgent.buildStackSubstitutions` method (gpt-4o-mini
    inline minimal AgentConfig, one-shot classification, safe-fail
    → empty Map on ANY error path).
  - `FeatureArchitecture` gains optional
    `stackSubstitutions?: Record<string, string[]>` field. The
    orchestrator generates the map ONCE per feature at
    `planning:start`, attaches to the feature architecture, and
    each `planning:phase` reads it back and applies
    `applyStackSubstitutions` to the `reviewPhaseDesign` output
    BEFORE persisting `feature_phases.architecture`.
- **Fix 2 (goldenPrinciples injection)** — new
  `renderGoldenPrinciplesSection(goldenPrinciplesMd)` helper
  (sibling to `renderStackSection`). All four architecture-agent
  prompt builders + all four agent methods accept an optional
  `goldenPrinciplesMd: string = ''` parameter. Orchestrator reads
  `docs/GOLDEN_PRINCIPLES.md` via `readFileSafe` at both
  `planning:start` and `runPerPhaseArchitecture` (per-phase clone
  is fresh) and threads it through. File absent → empty string →
  section omitted cleanly.

Template `0.28.0 → 0.29.0`. `pnpm -r build` clean across all 13
packages. No new migration.

**Live verification — PER-PHASE FRAMEWORK LEAK CLOSED:**
trackeros feature `fc99779a-b372-451d-a314-dd75301014f7` on
`chat-latest`:
- ✅ `buildStackSubstitutions complete` log fires at 19:12:54
  (gpt-4o-mini one-shot map generation worked).
- ✅ Phase 1 architecture: `jest=0 vitest=0 fastify=0 express=0`
  via DB query. Compare TR_042's `Vitest=2 + vitest=1 = 3
  mentions`. The TR_040 → TR_042 unsolved gap is structurally
  closed by the deterministic regex pass.
- ✅ Golden-principles injection observably shaped the plan:
  Phase 3 "Create AuditRecord domain model and repository"
  (the EXACT TR_042 complaint), Phase 7 RBAC, Phase 10 E2E
  coverage. 10-phase plan vs TR_042's 8.

**Cycle still blocked on a 6th intent-agent rigor bar:** "The
intent refers to PostgreSQL-backed repository operations, while
the provided architecture shows method stubs throwing 'Not
implemented'". Intent-agent reads abstract TypeScript interface
signatures (no method bodies, which is CORRECT for an
architecture phase — the code-agent implements them later) as
evidence the implementation is missing. Captured as new HIGH
follow-up for TR_045.

**Operator action — trackeros:** none. TR_044 is platform-side
only; no HARNESS changes needed.

**Operator action — other projects:** Add `docs/GOLDEN_PRINCIPLES.md`
to projects that don't have one — architecture-agent now reads it
the same way intent-agent does. Template auto-refreshes to
`0.29.0` at next server boot.

### TR_043 — `reasoning_effort` parameter per agent (template 0.28.0, build clean, live verification pending)

Feature request — GPT-5.5+ family supports a
`reasoning_effort: 'xhigh' | 'high' | 'medium' | 'low' |
'non-reasoning'` parameter on the `responses` API. Surface
it as a per-agent knob in `agents.yaml`, plumb it through
the platform, and log the chosen level on every LLM call so
operators can see which reasoning level fired for which
agent.

- **Part 1** —
  `packages/core/src/agents/agent-config.ts` gains a
  `ReasoningEffort` literal-union type + a
  `VALID_REASONING_EFFORTS` runtime set;
  `AgentLlmConfig` gains
  `reasoningEffort?: ReasoningEffort`.
  `agent-config-loader.ts` parses both `reasoning_effort`
  (snake_case, matches the OpenAI wire field) and
  `reasoningEffort` (camelCase) from YAML. Unknown values
  fall through silently — the agent inherits the model's
  default reasoning behaviour. `normaliseCustomAgent`
  (ADR-037) inherits the same parser. Both names exported
  from `@gestalt/core`.
- **Part 2** —
  `packages/core/src/llm/index.ts` — `LLMRequest` +
  `CompleteWithToolsRequest` gain `reasoningEffort?`. A
  new `reasoningEffortField(apiShape, reasoningEffort)`
  helper alongside `temperatureField` / `tokenLimitField`
  emits `reasoning_effort: <value>` ONLY when
  `apiShape === 'responses'` AND a value was supplied.
  Both `callProvider` (single-turn) and
  `callProviderWithTools` (function-calling loop) spread
  the helper into the request body. Standard
  chat-completions calls remain byte-for-byte identical.
- **Part 3** — `BaseLLMAgent` (in
  `packages/core/src/agents/base-llm-agent.ts`)
  `callLLMWithMessages` and `runToolLoop` spread
  `agentConfig.llm.reasoningEffort` into
  `client.complete(...)` / `client.completeWithTools(...)`.
  `TokenManagementLog` + `TokenManagementLogRecord` (in
  `repository/index.ts`) gain
  `reasoningEffort: 'xhigh' | 'high' | 'medium' | 'low' |
  'non-reasoning' | null` so per-call telemetry lands in
  the existing `agent_execution_logs.token_management`
  JSONB column — no migration needed. Generate +
  maintenance orchestrators pass `agent.lastTokenManagement`
  through verbatim; the gate orchestrator's inline
  structural mirror was extended to include the new field.
- **Part 4** — template `agents.yaml` preamble documents
  `reasoning_effort` (values + apiShape gating + per-level
  rationale). trackeros `agents.yaml` bound to `gpt-5.5`
  on every framework agent and `gpt-5.5-pro` on
  `self-healing-agent`, with per-agent reasoning levels
  per the brief's matrix (architecture: high,
  self-healing: high, planner: medium, phase-evaluator:
  medium, constraint: low, review: low, code-agent: none —
  Aider drives its own reasoning loop). `constraint-agent`
  is a NEW entry in trackeros's `agents.yaml` (was
  inheriting `PER_ROLE_DEFAULTS`).
- **Part 5** — covered by Part 3 — `reasoningEffort` is
  captured in `agent_execution_logs.token_management`. The
  brief explicitly excluded dashboard surfacing; operators
  read the field via direct DB query or via the existing
  `gestalt intent show` execution-log panel.

Template bumped `0.27.0 → 0.28.0`. `pnpm -r build` clean
across all 13 packages.

**Live verification — pending.** Recipe from the brief:

```bash
gestalt feature submit \
  "Build the leave management module..." \
  --project trackeros
```

then:

```sql
SELECT agent_role,
       token_management->>'reasoningEffort' AS reasoning_effort,
       token_management->>'finalMaxTokens'  AS max_tokens
  FROM agent_execution_logs
 WHERE token_management IS NOT NULL
 ORDER BY created_at DESC LIMIT 20;
```

Expected: `architecture-agent` row with
`reasoningEffort = 'high'` and `finalMaxTokens` reflecting
the new 12000 ceiling. Compare architecture output quality
against TR_041/TR_042 baselines (framework leak, file-count
mismatch).

**Constraints respected:**

- `reasoning_effort` only emitted when
  `apiShape === 'responses'` (gpt-5.5+, gpt-5.5-pro). Other
  models silently drop it — no error.
- `gpt-5.5-pro` already requires `apiShape: 'responses'`
  in `platform_llms` (set up under TR_033). No new registry
  rows required.
- No new migration — `agent_execution_logs.token_management`
  is JSONB; the new field is additive on read+write.
- ADR-042 compliance — `agents.yaml` carries the per-agent
  values; `.ts` carries only structural framing +
  validation.

**Operator action — trackeros:** my edits to
`/Users/amrmohamed/Work/trackeros/agents.yaml` are
unpushed. Operator should review + commit + push so the
next planning cycle picks them up. If the linter reverts
parts of the YAML (precedent from TR_033), re-apply the
seven blocks from the brief's Part 3 matrix.

**Operator action — other projects:** Existing projects
on GPT-5.5+ family can opt in by adding
`reasoning_effort: <level>` to relevant agent llm blocks in
their own `agents.yaml`. Absent → no behaviour change (the
field is sent only when present, and only on `responses`
apiShape). Template auto-refreshes to `0.28.0` at next
server boot for new projects.

### TR_042 — Per-phase architecture review pass + planner file-list mirroring (template 0.28.0, build clean, mixed verification: review-pass plumbing + planner file-count rule both verified; per-phase Vitest leak persists)

Two stopgap fixes (ADR-056) extending TR_041's TOP-positioned
stack compliance treatment from the FEATURE-level architecture
pass to the PER-PHASE architecture pass, plus a HARNESS-side
planner rule to stop the scope-vs-architecture file-count
mismatch surfaced by TR_041.

- **Fix 1a** — new `buildPhaseArchitectureReviewPrompt` in
  `architecture-prompt.ts` mirroring
  `buildArchitectureReviewPrompt` for the per-phase
  `PhaseArchitecture` shape. Stack compliance section
  rendered FIRST (per TR_041 finding); 5-point review
  checklist adapted to per-phase concerns (stack /
  file-list completeness / interface completeness / import
  accuracy / success-criteria accuracy).
- **Fix 1b** — `ArchitectureAgent.reviewPhaseDesign` method
  with same safety semantics as `reviewDesign` (return
  original draft on ANY failure path). Logs before/after
  counts for `interfaces`, `importStatements`,
  `successCriteria`.
- **Fix 1c** — orchestrator wires `designPhase →
  reviewPhaseDesign → persist` with a STOPGAP (ADR-056)
  comment block above the call site telling the next
  session to delete this when the LangGraph
  architecture-crew lands.
- **Fix 2** — two new abstract
  `agentConfig.planner-agent.phaseScopingRules` items in
  template + trackeros HARNESS: "The file list in each
  phase scope is an estimate. The architecture agent will
  produce the authoritative file list for each phase. Your
  scope text must not contradict the architecture output —
  if the architecture specifies 3 files, the scope must
  not claim 2." + "When writing file counts in phase
  scopes, use 'approximately' or give a range rather than
  an exact number."

Template `0.26.0 → 0.28.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — MIXED:** trackeros feature
`ec42e085-47b8-4475-99cb-e8a718ed63cb` on `chat-latest`:
- ✅ `reviewPhaseDesign` log fires at 18:37:47 (~4s after
  `designPhase`). Before/after counts logged:
  `interfaces: 3→3, imports: 3→3, criteria: 5→5`. Same
  shape, empty-fallback didn't trip, reviewed output
  persisted.
- ✅ Fix 2 worked — intent-agent did NOT escalate on the
  scope-vs-architecture file-count mismatch this cycle.
  TR_041's HIGH NEW follow-up CLOSED.
- ❌ Per-phase Vitest STILL leaks: `Vitest=2 + vitest=1
  = 3 mentions` in Phase 1's persisted architecture (all
  in `successCriteria`). The TR_041 prompt-top effect at
  the FEATURE-level scale didn't transfer to per-phase —
  the LLM judged the per-phase draft compliant and didn't
  rewrite. Likely needs regex post-processing.
- ❌ Cycle blocked at intent-agent on a NEW (fifth)
  rigor bar: "Platform standards require audit records
  for state-changing operations, but no audit module,
  interface, or file scope is provided for this phase."

**New HIGH follow-ups for TR_043:**
- Per-phase framework binding via regex post-processing in
  `reviewPhaseDesign` — read `HARNESS.stack.testFramework`,
  substitute any other test-framework name in the result
  JSON. The LLM-only approach has now failed twice at
  per-phase scale.
- Feed `goldenPrinciples` (or `agentConfig` extension)
  into the architecture-agent prompt so it can pre-empt
  cross-cutting concerns like audit logging that
  intent-agent will otherwise flag as ambiguity.

**Operator action — trackeros:** none new beyond the
already-pushed `7512ced5 chore(TR_042): planner
phaseScopingRules — file list is an estimate; architecture
is authoritative`.

**Operator action — other projects:** Append the two new
`planner-agent.phaseScopingRules` items to existing
projects' HARNESS. Template auto-refreshes to `0.28.0` at
next server boot.

### TR_041 — Stack compliance check at TOP of review prompt + lifecycle coverage as 5th checklist item + lifecycle architectureGuidance rule (template 0.26.0, build clean, feature-level pipeline fully cleaned of framework leak)

Three fixes against TR_040's two HIGH NEW follow-ups (Vitest
binding still leaking; lifecycle-coverage gap).

- **Fix 1** —
  `packages/agents/planning/src/prompts/architecture-prompt.ts`
  `buildArchitectureReviewPrompt` restructured. The
  `## Stack compliance check (read this first)` block is now
  rendered FIRST in the prompt (before persona, harness
  section, draft JSON, feature description). The block
  wording strengthened: "REWRITE the relevant field with the
  declared stack value. Do not preserve the original."
- **Fix 2** — same function. The four-point review checklist
  gains a 5th item: "Lifecycle coverage — for every entity
  whose state changes during the feature lifecycle, verify
  that at least one phase in `recommendedPhases` includes a
  method to perform that mutation. If a state transition
  exists in the feature description but no phase adds the
  corresponding mutation method, ADD it to the most
  appropriate phase."
- **Fix 3** — `agentConfig.architecture-agent.architectureGuidance`
  in template + trackeros HARNESS appended with: "Every state
  transition described in the feature must have a
  corresponding method in at least one phase. If an entity
  changes state during the feature lifecycle, ensure the
  phase plan includes a method for each transition — not
  just the initial creation."

Template `0.25.0 → 0.26.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — TR_041 Fix 1 works end-to-end on the
FEATURE-level pipeline:** trackeros feature
`595033ff-99b2-460a-b532-70b99e6fed3d` on `chat-latest`:
- ✅ Post-review feature architecture is FRAMEWORK-FREE.
  DB query for framework refs: `jest=0 vitest=0 fastify=0
  express=0`. Compare to TR_040 which still had
  `vitest=1`. The TOP-positioned stack compliance check
  conditions the LLM strongly enough that it doesn't even
  reach for framework names in the draft.
- ✅ Planner's Phase 1 scope text says "Jest" (not
  "Vitest", not "Jest or Vitest" hedge).
- ✅ 8-phase bottom-up dependency-ordered plan:
  Employee → LeavePolicy → LeaveBalance → balance ops →
  LeaveRequest → submission → approval → notification.
  Phase 7 IS the mutation phase the lifecycle-coverage
  rule asked for — verified at the plan level.

**Cycle still blocked at intent-agent on two NEW gaps:**
- ❌ Per-phase `designPhase` STILL emits "Vitest tests" in
  success criteria. TR_041's review enhancements apply only
  to `reviewDesign` (feature-level), not `designPhase`
  (per-phase). The per-phase pass has the stack section +
  architectureGuidance rules but NO review pass.
- ❌ Intent-agent caught a scope-vs-architecture file-count
  mismatch — Phase 1 scope text lists 2 files
  (`employee.model.ts` + `employee.repository.ts`); the
  per-phase architecture lists 3 files (adds
  `postgres-employee.repository.ts`) + a SQL schema.

**New HIGH follow-ups for TR_042:**
- Add `reviewPhaseDesign` mirroring `reviewDesign` so the
  per-phase pass gets the same stack compliance gate. Or
  extend `designPhase` to internally re-run with a
  compliance/scope-alignment instruction appended.
- Planner-agent must mirror architecture-agent's file list,
  not just symbol names. Options: planner-prompt rule
  forcing it to reference the per-phase architecture's
  file list verbatim, or a post-process substitution.

**Operator action — trackeros:** none new beyond the
already-pushed `aec2340f chore(TR_041): architecture-agent —
lifecycle coverage rule`.

**Operator action — other projects:** Append the
lifecycle-coverage rule to
`HARNESS.json.agentConfig.architecture-agent.architectureGuidance`.
Template auto-refreshes to `0.26.0` at next server boot.

### TR_040 — Architecture-agent binds to HARNESS.stack declared values (template 0.25.0, build clean, partial verification: Fastify bound end-to-end, Vitest binding deferred)

Two changes against TR_039's HIGH NEW follow-up
(architecture-agent ignores `HARNESS.stack`).

- **Fix 1** — `agentConfig.architecture-agent.architectureGuidance`
  in template + trackeros HARNESS gains two new abstract rules
  (no framework names hardcoded): one declaring the
  HARNESS.stack as authoritative for all technology choices;
  one telling the agent to verify every framework reference
  matches the declared stack before emitting the response.
- **Fix 2** — `buildArchitectureReviewPrompt` gains a
  `## Stack compliance check` block rendered IMMEDIATELY
  before the JSON output schema, listing `HARNESS.json.stack`
  as pretty-printed JSON and telling the agent to correct any
  mismatch in success criteria, interface names, or
  implementation notes. Empty string when `HARNESS.stack` is
  absent — the section is omitted cleanly.

Template `0.24.0 → 0.25.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — PARTIAL:** trackeros feature
`8900ab21-bc26-4f89-a000-7c74e02aaa24` on `chat-latest`:
- ✅ **Fastify binding worked end-to-end.** DB query for
  framework refs in the post-review feature architecture:
  `fastify=1 express=0` (vs prior cycles which had
  `express=1`). Phase 8 title literally reads "Expose Fastify
  APIs and workflow integration tests".
- ❌ **Vitest binding did NOT work.** Same DB query:
  `jest=0 vitest=1`. Phase 1 success criteria still says
  "Vitest tests for the repository verify successful create
  and findById persistence". The Phase 1 scope text reads
  "Include Jest or Vitest unit tests" — hedge phrasing
  showing the LLM read both signals and split the difference.
- ⚪ **reviewDesign ran (5s, before/after counts 5→5)** but
  didn't observably rewrite the framework references — the
  stack compliance check is in the prompt but didn't override
  chat-latest's Vitest bias.

**Cycle blocked at intent-agent on a separate finding:**
`LeaveRequestRepository` has only `create + findById` and
no later phase ever adds `update`, even though Phase 5
("manager approval and rejection workflow") needs to mutate
`LeaveRequest.status`. Architecture-agent regressed on
coverage vs TR_038/039 — possibly misreading TR_039's
deferred-section text as a license to minimize Phase 1's
interface and forgetting to add the methods in later phases.

**New HIGH follow-ups for TR_041:**
- Vitest binding: move the stack compliance check to the
  TOP of the review prompt, or add a regex post-processing
  pass after reviewDesign that reads `HARNESS.stack.testFramework`
  and substitutes any other test-framework name in the
  result JSON.
- Lifecycle coverage rule: every domain entity whose state
  transitions during the feature lifecycle must have a phase
  where the corresponding mutation method is added to its
  repository. Either a new `architectureGuidance` rule or a
  5th checklist item in `reviewDesign`.

**Operator action — trackeros:** none new beyond the
already-pushed `6c76cc2f chore(TR_040): architecture-agent must
bind to HARNESS.stack declared values`.

**Operator action — other projects:** Append the two new
architectureGuidance items to existing projects'
`HARNESS.json.agentConfig.architecture-agent.architectureGuidance`.
Template auto-refreshes to `0.25.0` at next server boot.

### TR_039 — Phase intent text declares deferred scope; intent-agent rules tell it not to flag deferred work (template 0.24.0, build clean, TR_038 follow-up CLOSED; cycle reached the GATE for the first time)

One platform change + one HARNESS rules block. Closes TR_038's
HIGH follow-up (intent-agent CRUD-completeness rigor on phased
delivery).

- **Fix 1** —
  `packages/agents/planning/src/orchestrator/planning-orchestrator.ts`
  queries `features.listPhases(featureId)` before dispatching
  each phase intent, filters to `phaseIndex > current &&
  status === 'pending'`, and passes that to
  `buildPhaseIntentText` as a new required parameter. The
  builder appends `## Deferred to later phases` listing each
  later-pending phase as
  `- Phase N — <title>: <scope snippet, 100 chars>`. The
  section becomes part of the intent text the pipeline
  already persists; no new field on the intent record.
- **Fix 2** — new `agentConfig.intent-agent` block on
  template + trackeros HARNESS (didn't exist before). Two
  abstract rules:
  1. "This intent describes a single phase of a multi-phase
     feature. If a 'Deferred to later phases' section is
     present, the items listed there are intentionally out of
     scope for this phase. Do not flag them as ambiguities
     or missing functionality."
  2. "Evaluate the intent against what this phase explicitly
     commits to delivering, not against the full feature
     description."

Template `0.23.0 → 0.24.0`. `pnpm -r build` clean across all
13 packages.

**Live verification — TR_038 follow-up CLOSED + the cycle
finally reached the GATE:** trackeros feature
`61953f63-6655-47ae-8be9-879bcc1bffe2` on `chat-latest`:
- All 3 Phase-1 attempt-intents contained the Deferred
  section (DB-confirmed). Each retry rebuilt the section
  from scratch.
- Intent-agent passed cleanly on every attempt — no
  escalation on deferred CRUD operations.
- **The cycle reached the gate for the first time across
  TR_036 → TR_039.** Gate ran 6 times. As a side-effect,
  TR_036's project-structure brief was observed in every
  gate-agent prompt (DB-confirmed), and zero
  false-positive `pool.query`/`new Pool` violations were
  flagged — TR_036 Fix 1 + Fix 2 both verified at the LLM
  level for the first time.
- TR_022 `maxPhaseRetries` fired 2/2 correctly:
  16:18:42 phase-submitted → 16:26:01 retry 1/2 →
  16:34:44 retry 2/2 → 16:35:43 phase-escalated.
- `feature-blocked` alert visible in `gestalt alerts list`
  (TR_036 Fix 3 alert path observed at the LLM level for
  the first time too).

**Cycle still blocked — NEW orthogonal finding:** the gate's
review-agent caught a real configuration drift. Architecture-
agent emits Vitest references in success-criteria text on a
fully-Jest-aligned project (`HARNESS.stack.testFramework:
Jest`, `agents.yaml test-agent.goal: Jest`, `package.json
scripts.test: jest`). TR_038's stack-injection mechanism
reaches the prompt but doesn't BIND the LLM's framework
choice — it picks Vitest as a "modern default". Same
pattern for Fastify-vs-Express in one violation. Captured
as new HIGH follow-up for TR_040.

**Operator action — trackeros:** none new beyond the
already-pushed `f0f9e989 chore(TR_039): intent-agent rules —
deferred scope is out of phase`.

**Operator action — other projects:** Add the new
`agentConfig.intent-agent` block to existing projects'
`HARNESS.json` (it didn't exist before, so this is a NEW
section, not an append). Template auto-refreshes to
`0.24.0` at next server boot.

### TR_038 — Architecture-agent self-review + concrete-implementations stack injection (template 0.23.0, build clean, TR_037 follow-up CLOSED)

Two stopgap fixes ahead of the LangGraph architecture-crew migration
(ADR-056). Both will be deleted when Phase 1 of the migration lands.

- **Fix 1** — `renderStackSection(harnessConfig)` helper in
  `architecture-prompt.ts` injects `HARNESS.json.stack` as a
  `## Project stack` section before the task description in
  both `buildFeatureArchitecturePrompt` and
  `buildPhaseArchitecturePrompt`. New `architectureGuidance`
  rule on template + trackeros tells the agent to specify the
  concrete implementation for every interface using the
  declared stack.
- **Fix 2** — new `buildArchitectureReviewPrompt` +
  `ArchitectureAgent.reviewDesign(draft, feature, projectRoot,
  harnessConfig, correlationId)`. A single-agent self-review
  re-reads the draft and checks completeness / consistency /
  ambiguity / feasibility. Returns the original draft on ANY
  failure path so the pipeline is never blocked on a review
  parse error. The orchestrator wires
  `designFeature → reviewDesign → save` with a STOPGAP
  (ADR-056) comment block above the call. New rule on
  template + trackeros for the review pass.

Template `0.22.0 → 0.23.0`. `pnpm -r build` clean across all
13 packages. Token management (ADR-057) applies automatically
because `reviewDesign` calls `callLLM` (which routes through
the 5-layer pipeline).

**Live verification — TR_037 HIGH NEW follow-up CLOSED:**
trackeros feature `d0513f28-6648-4651-bf4e-15e8771c4e5b` on
`chat-latest`:
- `reviewDesign` log fired at 14:04:37 (6 s after
  `designFeature`).
- Phase 1 persisted architecture names `PostgresLeaveRepository`
  as the concrete class, imports `Pool` from `pg`, defines
  `src/shared/db/connection.ts`, and includes a SQL schema
  with CHECK constraints + indices. The "what concrete impl
  backs this interface" question intent-agent flagged in
  TR_037 is now answered in the architecture itself.

**Cycle still blocked at intent-agent — NEW orthogonal finding:**
After ~15 s in `generating`, intent-agent escalated with a NEW
reason: "The intent mentions repository CRUD behavior, but the
specified LeaveRepository interface only defines create and
findById methods." The architecture-agent legitimately scoped
`LeaveRepository` to Phase-1 CRUD subset (later phases extend),
but intent-agent reads the feature description as implying
full CRUD upfront. Third distinct intent-agent rigor bar
across TR_036 / TR_037 / TR_038. Captured as new HIGH
follow-up.

**Operator action — trackeros:** none new beyond the
already-pushed `22b68de6 chore(TR_038): architecture-agent —
concrete-implementations guidance + review-pass rule`.

**Operator action — other projects:** Append the two new
items (architectureGuidance + rules) to
`HARNESS.json.agentConfig.architecture-agent` on existing
projects. Template auto-refreshes to `0.23.0` at next server
boot.

### TR_037 — Planner-agent uses architecture-agent's canonical type names (template 0.22.0, build clean, symbol-name conflict resolved end-to-end)

Two fixes against the TR_036 NEW HIGH follow-up:

- **Fix 1** — `packages/agents/planning/src/prompts/planner-prompt.ts`
  injects the full `FeatureArchitecture` JSON (sliced to 2000
  chars) as a `## Canonical type and symbol names` section above
  the HARNESS rules and above the task description. The planner
  sees architecture-agent's canonical names before it starts
  planning. No threading through `task.context` needed — the
  planner-agent already receives `architecture` as a positional
  parameter via `planFeature(feature, architecture, …)`.
- **Fix 2** — `agentConfig.planner-agent.rules` in template +
  trackeros HARNESS appended with: "The architecture specification
  provided above defines the canonical type names, interface
  names, and symbol names for this feature. Use these exact names
  in all phase scopes. Do not invent alternative names or rename
  types." Abstract — no hardcoded type names.

Template bumped 0.21.0 → 0.22.0. `pnpm -r build` clean across
all 13 packages.

**Live verification — symbol-name conflict resolved:** trackeros
feature `ce9d1b80-b442-4547-afcf-d389e4aa8b63` on `chat-latest`
produced a 5-phase plan with Phase 1 scope using
architecture-agent's canonical `LeaveRequest` type + field list
verbatim. Phase 1's per-phase architecture: 4 interfaces +
5 success criteria + full SQL schema. Cycle proceeded into
`generating` without intent-agent escalation on symbol names.

**Cycle still blocked at intent-agent — NEW orthogonal finding:**
After the symbol-name conflict was resolved, intent-agent escalated
on a different ambiguity: "The concrete persistence implementation
backing `LeaveRepository` is not specified." Architecture-agent
defines the interface but doesn't pin the concrete DB
driver/package. This is a stricter intent-agent bar than the prior
symbol-name conflict — and TR_037's fix doesn't address it.

**Operator action — trackeros:** none new beyond the already-pushed
`5f083345 chore(TR_037): planner-agent canonical-names rule`.

**Operator action — other projects:** Existing projects adopt the
canonical-names rule by appending to
`HARNESS.json.agentConfig.planner-agent.rules`:
> "The architecture specification provided above defines the
> canonical type names, interface names, and symbol names for
> this feature. Use these exact names in all phase scopes. Do
> not invent alternative names or rename types."

Template auto-refreshes to `0.22.0` at next server boot.

### TR_036 — Abstract gate rules + auto-generated project-structure brief + maxPhaseRetries alert path (template 0.21.0, build clean, live verification partial)

Four fixes against TR_035 verification findings:

- **Fix 1** — HARNESS `constraint-agent.rules` + `review-agent.rules`
  rewritten to abstract layer-role language (data access layer,
  business logic layer, presentation/routing layer). Both agents'
  `verificationGuidance` rewritten to "read ARCHITECTURE.md first;
  a finding is only valid if it violates a rule given the actual
  structure of this project". The HARNESS no longer hardcodes
  paths, class names, or method names — ARCHITECTURE.md is the
  authoritative source for layer boundaries.
- **Fix 2** — new `buildProjectStructureBrief(projectRoot)` helper
  in `gate-orchestrator.ts`. Reads `ARCHITECTURE.md` (truncated to
  2000 chars) + enumerates a depth-2 directory tree under `src/`
  using Node's `readdir` (equivalent to `find src -maxdepth 2
  -type d`, bounded to 30 entries). Set on
  `GateTask.projectStructureBrief` (new optional field on the
  type); constraint-agent injects it before the rules section,
  llm-review-agent injects it at the top of the prompt. Empty
  string when neither source exists — section is omitted.
- **Fix 3** — planner's `maxPhaseRetries` exhaustion path in
  `planning-orchestrator.ts` now creates a `feature-blocked`
  alert + emits `alert.created` SSE. Previously this path was
  silent on the alerts feed (operators only saw the block via
  `gestalt feature show` / dashboard).
- **Fix 4** — trackeros `agents.yaml` `test-agent.goal` switched
  from Vitest → Jest to align with the rest of the project's
  Jest-only tooling.

Template bumped 0.20.0 → 0.21.0. `pnpm -r build` clean across
all 13 packages.

**Live verification — partial:** trackeros feature
`b58ee152-4f5b-4dd5-8d72-39816149fbae` ran on `chat-latest`,
produced a 7-phase plan (model+repo bundled into Phase 1) with
non-empty per-phase architecture (2 interfaces + 5 criteria),
then escalated at intent-agent on an upstream
planner-vs-architecture-agent symbol-name inconsistency
(`LeaveStatus` vs `LeaveRequestStatus`, `CreateLeaveRequestDto`
vs `CreateLeaveRequestInput`). Self-healing → cascade brake →
`feature-blocked` alert `430ed09a` created via the EXISTING
TR_033 helper. Gate never ran, so Fixes 1 + 2 did not get an
LLM-level test. Fix 3's new alert call sat alongside the
existing one; the cycle escalated via the existing path so my
new code didn't fire.

**New HIGH follow-up:** cross-check planner-agent vs
architecture-agent symbol names. Both currently emit type/field
names independently; nothing reconciles them. This blocks every
cycle on chat-latest at intent-agent before the gate-side
TR_036 fixes get exercised.

**Operator action — trackeros:** none new beyond the
already-pushed `b5396160 chore(TR_036): abstract
constraint+review rules + align test-agent to Jest`.

**Operator action — other projects:** Existing projects can
adopt the abstract rules by replacing their
`HARNESS.json.agentConfig.constraint-agent.rules` +
`review-agent.rules` blocks with the abstract versions from
the template. Template auto-refreshes to `0.21.0` at next
server boot.

### TR_035 — Dynamic token budget management + phase merge SHA (ADR-057, template 0.20.0, build clean, live verification pending)

Two categories of work. Part A — platform-level five-layer
token management in `BaseLLMAgent`:

- Layer 1 (model-aware defaults: reasoning models get 8k,
  standard 2k).
- Layer 2 (dynamic budget: input × 1.5 reasoning / × 0.5
  standard, clamped by per-model hard limits).
- Layer 3 (scope reduction: three structural rewrites for
  prompts above the threshold).
- Layer 4 (JSON response guard appended to six structured-
  output agents: architecture-agent `designFeature` +
  `designPhase`, planner-agent, phase-evaluator-agent,
  constraint-agent, review-agent, self-healing-agent).
- Layer 5 (truncation retry doubling the budget on
  `finish_reason: 'length'`, up to 3 attempts).

Knobs configurable in `HARNESS.json.tokenManagement`
(`promptCompressionThreshold` / `maxRetryBudgetMultiplier` /
`enableDynamicBudget` / `enableScopeReduction`).

Part B — three TR_034 follow-up fixes:

- **B1** — `architecture-agent.max_tokens: 12000` in
  trackeros `agents.yaml` as the fallback floor. Layers 2 +
  5 in BaseLLMAgent handle higher cases.
- **B2** — phase-evaluator prefers `git show --name-only
  --format= <mergeCommitSha>` over the prior `git diff`
  fallback. The existing `mergePullRequest` already returns
  the squash-merge SHA, so the promotion-agent's
  `maybeAutoMerge` now `findPhaseByIntent → updatePhaseMergeCommit`
  after a successful merge. New `feature_phases.merge_commit_sha`
  column (migration 029). Phase-evaluator-agent rules in the
  template + trackeros HARNESS updated to teach the agent the
  new command (with fallback when SHA is null).
- **B3** — single migration `029_token_management_and_phase_merge.sql`
  bundles both new columns.

Template bumped 0.19.0 → 0.20.0. `pnpm -r build` clean across
all 13 packages. Migration 029 applied at next server boot.
Live verification pending — runtime telemetry will show each
layer firing.

**Operator action — trackeros:** the operator may patch the
phase-evaluator-agent rule into `trackeros/HARNESS.json` if it
gets reverted (precedent from TR_033). The `tokenManagement`
block + `architecture-agent` 12k bump are already in trackeros.

**Operator action — other projects:** Existing projects can
opt in by adding a `tokenManagement` block to `HARNESS.json`.
Absent → all five layers run with the defaults baked into
`BaseLLMAgent` (threshold 6000, multiplier 2.0, both feature
flags on). Template auto-refreshes to `0.20.0` at next server
boot for new projects.

### TR_034 — Scoped per-phase architecture replaces full architecture context in Aider message (template 0.19.0, mechanisms verified)

Replaces the heavyweight `## Project architecture` + `## Design
context` blocks in the Aider message with a single
`## Scoped architecture for this phase` block built from
architecture-agent's `designPhase()` JSON (interfaces +
importStatements + sqlSchema + successCriteria). Closes the
TR_033 root cause where Aider hallucinated `../../shared/db`
from module-name references in the full ARCHITECTURE.md.

- `buildAiderMessage` signature: `(intentSpec, phaseArchitecture:
  string | null, snapshot)`. New `renderPhaseArchitecture()` helper.
- New `FeatureRepository.updatePhaseArchitecture` method (no
  migration — uses existing column). Postgres impl + oracle/mssql
  stubs.
- `runPerPhaseArchitecture` persists JSON to `phase.architecture`.
- `aider-code-agent.loadPhaseArchitectureForCycle` resolves
  correlationId → intent → phase → architecture, parses with
  shape guard.
- Template HARNESS + agents.yaml gain new architecture-agent
  scoping rules (architectureGuidance + prompt_extensions) with
  WRONG/CORRECT examples banning module-name-only references.

Template bumped 0.18.0 → 0.19.0. **Verified live on trackeros
2026-06-10** — per-phase architecture pass fires,
`updatePhaseArchitecture` persists JSON, message body shrank
5705 → 2922 bytes, Phase 1 deployed via PR #119. **Feature did
NOT complete** — gpt-5.5 + Aider produced zero source code
(same TR_033 mode), and architecture-agent's `designPhase`
returned empty arrays so the scoped block was empty too.

**Operator action — trackeros:** none new beyond the brief's
HARNESS + agents.yaml edits (committed by the verification
cycle as `e7db89dd` + `4eb7637c` cleanup).

**Operator action — other projects:** Existing projects can
opt into the per-phase architecture pass by setting
`HARNESS.json.planner.architectureReviewPerPhase: true` and
ensuring `architectureGuidance` includes the path/exports/
import-statement rules from the template. Template auto-
refreshes at server boot to `0.19.0`. The Aider message
behaviour change is fully backward-compatible — projects
without per-phase architecture get `null` from
`loadPhaseArchitectureForCycle` and the message drops the
section entirely.

### TR_033 — Phase 3 quality gaps + escalation→blocked structural fix (template 0.18.0, partially verified)

Four targeted fixes pushing toward full autonomous feature
completion. **Verified live on trackeros feature `7ab81ea3`
(2026-06-10)**: Fix 1 + Fix 4 confirmed end-to-end; Fix 2 +
Fix 3 shipped but not reached (feature blocked at Phase 1
before routes phase). Feature did not reach `completed` —
gpt-5.5 + Aider produced zero source code across 4 attempts
(new failure mode separate from TR_028-32 hallucination).
Full report in `sessions/RECENT.md`. Fixes 1-3 are language-agnostic rule additions;
Fix 4 is the structural follow-up to the TR_032 verification
gap (escalated intents leaving features stuck `in-progress`).

- **Fix 1** — `aider-message-builder.ts` base `readFiles` list
  expanded to include `package.json`, `tsconfig.json`,
  `pyproject.toml`, `requirements.txt`, `go.mod`, `pom.xml`,
  `mypy.ini`, `.eslintrc(.json)`. The adapter's `existsSync`
  filter naturally drops files a project doesn't use, so the
  same list works on TypeScript / Python / Go / Java without
  language-tagging the platform code.
- **Fix 2** — three language-agnostic rules added to
  `agentConfig.code-agent.rules` in the **template** HARNESS:
  read dependency source before calling its methods; read
  compiler/linter config before generating; read dependency
  manifest before importing. Examples in the rule text list
  multiple ecosystems (`tsconfig.json / mypy.ini / pyproject.toml`,
  `package.json / requirements.txt / go.mod`).
- **Fix 3** — new rule on
  `agentConfig.phase-evaluator-agent.rules` (template) — when
  adjusting a routes/controller phase scope, cite the
  service/handler file it depends on. Closes the TR_032 Phase 3
  root cause.
- **Fix 4** — structural. `AlertType` gains `'feature-blocked'`
  (no migration — no DB CHECK constraint on `alerts.type`).
  Planning orchestrator's `intent.status-changed` subscriber
  now treats `waiting-for-clarification` + `escalated` as
  terminal phase outcomes via a new
  `markFeatureBlockedAfterEscalation` helper: phase → failed,
  feature → blocked, `phase-escalated` log entry, a single
  `feature-blocked` alert. Self-healing already parked the
  parent intent at `waiting-for-clarification` when the
  cascade brake fired (`self-healing-loop.ts:604`) — Fix 4
  completes the story.

Template bumped 0.17.0 → 0.18.0. Build clean across all 13
packages. Live verification pending.

**Operator action — trackeros:** my Fix 2 + Fix 3 edits on
trackeros's `HARNESS.json` were reverted by the operator/linter
this session. The new code-agent + phase-evaluator rules only
ship via the template; existing projects (including trackeros)
need a manual patch on their own `HARNESS.json` to opt in. For
the live verification recipe to test Fix 2 + Fix 3 end-to-end,
trackeros's HARNESS must be patched first with the three
code-agent rules and the one phase-evaluator rule from the
template.

**Operator action — other projects:** None on the platform.
Template auto-refreshes at server boot to `0.18.0`. New
projects pick up the rules automatically.

### TR_032 — Aider `--read` flag + preservation in schema + broken-state framing (template 0.17.0, verified)

Three targeted platform-mechanic fixes addressing the
TR_028 → TR_031 Aider DTO-drift blocker. No new HARNESS
rules, no new migrations.

- **Fix 1** — `runAider` accepts `readFiles?: string[]`;
  `buildAiderMessage` returns `{ message, readFiles }`
  (PLAN.md + paths regex-extracted from the intent's scope
  text). The adapter renders each as a `--read "<path>"`
  flag, existsSync-filtered against `workDir`. Removed the
  TR_030/TR_031 prose `## Read PLAN.md first` and
  `## Before generating any code` sections — `--read`
  enforces what they only asked.
- **Fix 2** — preservation sentence ("Preserve all existing
  exports, types, interfaces, and imports. Only add or
  modify what is needed to resolve the CI failure shown
  above.") hard-coded as the closing sentence of the
  `fixIntent` JSON-schema description in
  `self-healing-agent.ts`. HARNESS preservation rule
  removed from the template.
- **Fix 3** — `fixIntent` description now requires BROKEN
  STATE framing (not MISSING STATE) with verbatim
  WRONG/CORRECT examples. Addresses the TR_031 cycle-3
  finding that Aider inverts negation.

Template bumped 0.16.0 → 0.17.0. Build clean across all 13
packages. **Verified end-to-end on trackeros 2026-06-09** —
feature `fd844f7d` Phase 1 + Phase 2 both deployed cleanly
(Phase 2 was the killer phase across TR_028-31, first ship);
Phase 3 escalated on unrelated TS-strict + missing-method
issues (the TR_033 fixes target those). `readFiles` array
present on every Aider invocation. Preservation footer
present on both fix-intents. Cascade brake at depth 2 fired
correctly. Operator had to manually clean up the escalated
feature after the cycle — Fix 4 above closes that gap.

**Operator action:** None new. The TR_032 preservation rule
removal already shipped via the template.

Three targeted platform-mechanic fixes addressing the
TR_028 → TR_031 Aider DTO-drift blocker. No new HARNESS
rules, no new migrations.

- **Fix 1** — `runAider` accepts `readFiles?: string[]`;
  `buildAiderMessage` returns `{ message, readFiles }`
  (PLAN.md + paths regex-extracted from the intent's scope
  text). The adapter renders each as a `--read "<path>"`
  flag, existsSync-filtered against `workDir`. Removed the
  TR_030/TR_031 prose `## Read PLAN.md first` and
  `## Before generating any code` sections — `--read`
  enforces what they only asked.
- **Fix 2** — preservation sentence ("Preserve all existing
  exports, types, interfaces, and imports. Only add or
  modify what is needed to resolve the CI failure shown
  above.") hard-coded as the closing sentence of the
  `fixIntent` JSON-schema description in
  `self-healing-agent.ts`. HARNESS preservation rule
  removed from the template.
- **Fix 3** — `fixIntent` description now requires BROKEN
  STATE framing (not MISSING STATE) with verbatim
  WRONG/CORRECT examples. Addresses the TR_031 cycle-3
  finding that Aider inverts negation.

Template bumped 0.16.0 → 0.17.0. Build clean across all 13
packages. Live verification pending — operator runs the
brief's `gestalt feature submit` recipe on trackeros.

**Operator action:** Existing projects can prune the now-
redundant preservation rule from
`HARNESS.json.agentConfig.self-healing-agent.rules` (it's
in the platform schema now). The rule is harmless if left
in — both fire. trackeros not auto-migrated; operator can
clean up on next HARNESS edit.

### TR_030 + TR_031 — Aider-message-builder + PLAN.md "What has been built" + context-only fix-intent (template 0.16.0)

Two consecutive briefs targeting Aider DTO drift. TR_030
added two generic prose blocks to `aider-message-builder.ts`
(read-existing-files; architecture-is-reference-only).
TR_031 added a `Read PLAN.md first` block to the message-
builder; extended `PhaseEvaluation` with `builtFiles` (the
phase-evaluator-agent now also lists exports per built file
in its git-diff pass); rewrote the `fixIntent` JSON-schema
description in `self-healing-agent.ts` to require CONTEXT
only (no prescriptive "Update X to add Y"). HARNESS
preservation-rule bullet added for self-healing-agent.
Template 0.15.0 → 0.16.0.

Verified end-to-end on a clean trackeros main: PLAN.md
populates the `**What has been built:**` section under each
deployed phase with files + key exports; fix-intent text
is now context-only; self-healing routes to fix-intent
immediately on first failure; cascade brake fires at depth 2.

**Operator action:** Existing projects can adopt the new
preservation rule by appending to
`HARNESS.json.agentConfig.self-healing-agent.rules`:
"Fix-intent context must end with a preservation statement.
For TypeScript projects: 'Do not remove or rename existing
exports, types, or interfaces. Only add or modify what is
needed to resolve the CI failure.'" Python or other
language projects substitute their own preservation clause.
trackeros migrated in commit `7d94746a`.

### TR_029 — Planner+evaluator prior-phase path rules (template 0.15.0)

Two new `agentConfig.planner-agent.phaseScopingRules` items and
one `agentConfig.phase-evaluator-agent.rules` item added,
requiring per-phase explicit prior-file-path lists and full-path
replacement when adjusting scopes after a partial verdict.
Template bumped 0.14.0 → 0.15.0. Pure HARNESS edit — no platform
code change, no migration.

Planner-side verified end-to-end on the re-submitted
leave-management feature: PLAN.md `Phase 2` carries the exact
`src/modules/leave/leave.model.ts` + `leave.repository.ts`
paths the planner was instructed to include. Phase 1 deployed
in ~3 minutes (PR #88). Phase 2 still blocked by Aider
code-agent reading discipline — captured as two NEW HIGH
follow-ups in STATE.md (code-agent prompt mandate + architecture-
agent context scoping).

**Operator action:** Existing projects can adopt the new rules
by merging them into `HARNESS.json.agentConfig.planner-agent.phaseScopingRules`
and `agentConfig.phase-evaluator-agent.rules`. trackeros migrated
as part of this session (commit `cf35c03b`).

### TR_028 — Full planning-loop re-test (TEST_REPORT_028.md)

Milestone test on the leave-management feature, verifying every
TR_020 through TR_027 mechanism in a single 19-minute autonomous
cycle. Phase 1 (model) deployed cleanly. Phase 2 (repository)
hit the known TR_023 Aider DTO-drift; self-healing's
diagnostician correctly chose `retry` then `fix-intent`;
fix-intent child deployed via the `onSuccessDispatch` envelope
in ~2m 25s. But the fix-intent prompt lacked path specificity
so Aider wrote a stray repo-root `/leave.model.ts` that tsc
never resolves. Parent Phase 2 resumed → failed again → planner
retry budget exhausted → feature blocked at 1/4 phases. Two new
HIGH follow-ups captured: (1) promoted TR_023 — planner must
keep model+repository in same phase OR code-agent must read
existing model first; (2) self-healing fix-intent prompt
enrichment — must include the failing import path and existing
field shape. Architecture-agent / planner-agent /
phase-evaluator-agent / PR-Agent / self-healing + onSuccessDispatch /
cascade-depth brake / phase retry budget all verified.

**Operator action:** None on the platform. trackeros next
planner cycle should be prefaced by `git rm leave.model.ts`
(the stray repo-root file fix-intent created). Full
per-phase log at `docs/claude/TEST_REPORT_028.md`.

### TR_027 — PR-Agent replaces review-agent (ADR-051)

CodiumAI PR-Agent invoked server-side via `executeScript` after CI
passes. No webhook, no CI step, no GitHub Secrets for LLM keys —
LLM credentials forwarded per invocation via subprocess env vars.
Dockerfile installs PR-Agent in its own venv (`/opt/pr-agent`)
isolated from Aider's because of incompatible litellm versions;
PATH shims (`/usr/local/bin/{aider,pr-agent}`) keep call sites
unchanged. New `prAgent` block on HarnessConfig + `.pr_agent.toml`
generated from HARNESS rules at init time (regeneratable via
`gestalt project config push-pr-agent-config`). Gate orchestrator
skips review-agent when prAgent.enabled + adapter=github-actions;
constraint-agent still runs. `changes-requested` routes through
self-healing's `fix-intent` path via new failure type
`review-requested-changes` (migration 027). Template 0.12.0 →
0.14.0. Live verified end-to-end on trackeros PR #81: Aider 6s →
CI pass → PR-Agent 23.5s → verdict `none` → gate (constraint-agent
only) → deploy. Wall-clock 2m 04s.

**Operator action:** Existing projects can adopt PR-Agent by
adding `prAgent: { enabled: true, blockOnChangesRequested: true,
pendingTimeoutSeconds: 30 }` to HARNESS.json + a self-healing-agent
rule for `review-requested-changes`. Absent → review-agent fallback
path still runs (llm-review-agent.ts kept as `@deprecated` but
functional). trackeros migrated as part of the verify cycle
(commits pending push).

### ADRs 053–055 — Tool integration roadmap

Documentation-only session. Three ADRs appended to
`docs/DECISIONS.md` capturing strategic tool integrations
agreed in the design chat: ADR-053 (Qodo Gen replaces
test-agent in the generate layer), ADR-054 (SWE-agent handles
bug-fix MaintenanceIntents), ADR-055 (K8sGPT feeds a future
Kubernetes operations layer via webhook → MaintenanceIntent).
A new `### Tool integration roadmap` section under
`STATE.md` "Active follow-ups" documents priority order plus
ruled-out alternatives (Bloop.ai — archived; OpenHands —
competitor; GitHub Spec Kit — not self-hostable). All three
ADRs are **Accepted — pending implementation**; no code
change, no migration.

Cross-reference note: ADR-052 (external scanner webhook →
MaintenanceIntent pattern) is referenced by ADR-055 but has
not yet been authored. Backfill when the next session touches
that code. ADR-051 (PR-Agent) was authored alongside this
session.

**Operator action:** None. ADRs are forward-looking contracts;
implementation will land in a later session.

### TR_026 — Remove platform file-change detection (ADR-050 enforcement)

ADR-050 enforcement: the platform must NOT detect, parse, or
interpret which files changed. Two surgical removals plus an
agent-side replacement.

- **AiderAdapter**: `parseAiderChangedFiles` deleted,
  `filesChanged` removed from `AiderResult`. `--yes-always`
  replaces `--yes` to prevent mid-session confirmation hangs.
- **AiderCodeAgent**: new `discoverAiderWrites` helper runs
  `git status --porcelain` in the work-dir and emits each
  changed file as a code artifact. An AGENT calling git —
  not platform code parsing Aider stdout.
- **Phase-evaluator-agent**: 3-stage TR_025 fallback deleted.
  Agent signature changed to take `branchContext`; prompt
  rewritten to instruct it to run `git diff` via
  executeScript. Switched to `callLLMWithTools` so the
  tool-use loop fires.
- **PER_ROLE_DEFAULTS** in `agent-config-loader.ts` extended
  with the three planning agents so executeScript is
  available out of the box.
- **HARNESS.json + agents.yaml** updated on template +
  trackeros: phase-evaluator-agent rules + evaluationCriteria
  rewritten with verbatim git-diff guidance.
- **Template bumped 0.11.0 → 0.12.0**.

Verified live: feature `7d77f659` Phase 1 PR commit
`ce3f3721` contains the real code files (`leave.model.ts` +
test). Phase-evaluator's verdict text quotes the
HARNESS.json git-diff rule, confirming the agent followed
the new path. Full feature completion blocked by
pre-existing trackeros operator state (stale
`leave.repository.ts` from earlier auto-merged cycles) —
captured as TR_027.

**Operator action:** None. Pure platform changes (plus the
trackeros HARNESS.json edit committed by the verification
cycle as `897bcf06`).

### TR_025 — Cascade-depth brake + phase-evaluator file-list fix

Two surgical hardening fixes (no migration):

- **`MAX_FIX_INTENT_DEPTH = 2`** + `getFixIntentChainDepth` walker
  in `packages/core/src/agents/self-healing-loop.ts`. Force-
  escalates when `parent_intent_id` chain depth ≥ 2. Closes
  TR_024's cascading-runaway gap.
- **Planning orchestrator built-file list** sourced from
  `git diff` against the PR branch (filtered to non-
  `.gestalt/` paths). Three-stage fallback: PR-branch diff →
  merged-commit scan → legacy artifacts-table read.

Verified live: feature `eed75889` Phase 1 → success → Phase 2
auto-dispatched. End-to-end autonomous transition confirmed.
Phase 2 hit an unrelated Aider "0 files written" quirk
(TR_026 follow-up).

**Operator action:** None. Pure platform fixes.

### TR_024 — Autonomous systemic gap detection (migration 026)

Self-healing diagnostician can now choose between **retry /
fix-intent / escalate**. When it picks `fix-intent` it writes an
Aider-ready intent the platform submits as a separate generate
cycle, links via `parent_intent_id`, and persists an
`on_success_dispatch` envelope that resumes the parent after
the fix's production promotion. Per ADR-050: no hardcoded
failure-pattern matching anywhere.

- **Migration 026** — `intents.parent_intent_id` (UUID FK
  `ON DELETE SET NULL`) + `intents.on_success_dispatch`
  (JSONB). NULL on every existing intent.
- **`HarnessAgentConfig.self-healing-agent`** added to both
  the template and trackeros: six rules covering the action
  vocabulary + fix-intent quality bar.
- **agents.yaml self-healing-agent block** in template (uses
  platform default model). trackeros overrides `model:
  chat-latest`. The LLM registry handles the
  `apiShape: 'responses'` wire-shape — agent code untouched.
- **`collectCiTechnicalDetail`** (deploy-orchestrator) —
  fetches the failed CI run's GitHub Actions annotations and
  passes them to the diagnostician as `technicalDetail`.
  github-actions only today.
- **Dashboard panels**: 🔧 Auto-fix intent (on `source: 'self-
  healing-fix'` intents); ⏳ Awaiting auto-fix (on parents with
  in-flight fix children).
- **Template bumped 0.10.0 → 0.11.0**.

**Operator action:** Existing projects can adopt the
self-healing-agent rules + agents.yaml block by editing their
own HARNESS.json + agents.yaml. Absent → diagnostician uses
the platform default LLM (no agents.yaml override needed
when the platform default is already chat-latest or similar).
trackeros migrated as part of the verify cycle (commit
`1a4fe16e` on `main`).

### TR_022 — Scaffolding fixes + phase retry budget (migration 025)

Three operator-facing changes plus a verified end-to-end retest
of the planning loop on a 5-phase feature.

- **Migration 025** — `feature_phases.retry_count INTEGER NOT NULL
  DEFAULT 0`. Existing rows start at 0.
- **`HarnessConfig.planner.maxPhaseRetries`** — new optional field,
  default 2 (one initial attempt + 2 retries). Set to 0 to
  restore pre-TR_022 single-attempt behaviour.
- **Template HARNESS.json** — `agentConfig.code-agent.rules` gets
  the JSON-import rule; `planner.maxPhaseRetries: 2` added.
  Template bumped 0.8.0 → 0.9.0.
- **`stack-config.ts`** — TypeScript stacks always carry the
  JSON-import rule in `agentPromptExtensions` (LLM path + the
  default-config path).

trackeros migrated as part of the verify cycle:
- `tsconfig.json` gains `resolveJsonModule` +
  `allowSyntheticDefaultImports`.
- `HARNESS.json` gets `code-agent.rules` JSON-import rule +
  planner block bumped to `{10, 5, false, 2}`.

**Operator action:** Existing projects can adopt the new
`maxPhaseRetries` field by editing `HARNESS.json.planner`.
Absent → defaults to 2 in `readMaxPhaseRetries`.

### PLANNING_LAYER — Autonomous feature decomposition (migration 024)

New package `@gestalt/agents-planning` + new BullMQ queue
`gestalt-planning` + new postgres tables (features /
feature_phases / feature_plan_log) + new server routes
(`POST/GET /features`, `GET /features/:id`) + new CLI commands
(`gestalt feature submit/list/show`). Three new agent roles
(architecture-agent / planner-agent / phase-evaluator-agent),
all extending BaseLLMAgent and reading config from agents.yaml +
HARNESS.json `agentConfig`. New `HARNESS.json.planner` block
(`enabled`, `maxPhasesPerFeature`, `maxFilesPerPhase`,
`architectureReviewPerPhase`) opt-in per project. Template
bumped 0.7.0 → 0.8.0. Live verified on trackeros — feature
`ea19b18e` ran the full architecture → plan → phase 1 → CI →
event-bus → evaluate loop end-to-end against real GitHub
Actions; phase failed because Aider's generated TS used
`require('package.json')` without `resolveJsonModule` (pre-
existing code-agent issue unrelated to planning).

**Operator action:** Add the planner block + planning
agentConfig entries to existing projects' `HARNESS.json` to
opt in. trackeros has been migrated as part of the verify
cycle (commit `3fc936fe` on `main`).

### Historical (TR_020 / TR_021 / ADRs 042–049)

Rotated to `sessions/archive/`. See `docs/DECISIONS.md` for ADRs
and the archive for the full narratives.

### Carryovers (TR_019 / TR_018 / TR_014)

- **MEDIUM — TR_019:** `gestalt init` should scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest with TypeScript.
- **LOW — TR_019:** Template `{{ciSetupSteps}}` for Node/npm
  should include `--legacy-peer-deps` until the upstream npm
  arborist `Link.matches` bug is fixed.
- **LOW — TR_019:** Add a `tsc --noEmit` sanity check on
  scaffolded tests in `gestalt init`.
- **HIGH — TR_018:** Restore TR_010 mandatory `executeScript
  tsc --noEmit` code-agent rule on trackeros's HARNESS.json.
- **MEDIUM — TR_014:** Aider token-spend capture. Parse
  `Tokens: N sent / M received` from Aider's stdout and surface
  as `tokens_used` on the execution row.

### Platform state caveats (unchanged)

- **`master.key`** generated locally (workspace root, mode 600,
  gitignored) + mounted into the server container via
  `docker-compose.yml`. Survives `docker compose up -d --build`.
  Back up out-of-band; losing it makes every vault-encrypted
  secret unreadable.
- **Open alerts to dismiss**: prior cycle alerts from
  TR_010–TR_018 (`gestalt alerts list` shows the full set).
  All dismissable with `gestalt alerts dismiss <id>`.
- **Live-verify TEST_REPORT_003 Fix 1** (env-default LLM
  apiShape) by switching `LLM_MODEL=chat-latest` + setting
  `platform_llms.chat-latest.api_shape='responses'` and
  confirming `max_completion_tokens` reaches the wire.
- **Re-create vault secret for OpenAI API key** if the operator
  wants vault-backed routing. Both LLMs currently in env-var
  mode (`apiKeyEnv: 'LLM_API_KEY'`) and working.

---

## Type alignment rules

Moved to [@docs/claude/ARCHITECTURE.md](./ARCHITECTURE.md#key-type-alignment-rules).
