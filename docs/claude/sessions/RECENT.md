# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-14 — Claude Code (TR_056 Part 2a: gateNode lifted from handleGateTask; build clean across 13 packages; handleGateTask untouched; legacy gate path still routes 100% of traffic)

Brief: write `packages/agents/quality-gate/src/graphs/gate/nodes.ts`
containing the verdict-producing `gateNode`. Lift the agent-run +
verdict-synthesis tail of `handleGateTask:397→675` verbatim, replace
the dispatch tail with state return, and add a TODO for the 2b
wire to DeployGraph entry. **Strictly additive — no deletions and
no modification of `handleGateTask`.**

**Decisions baked into the lift:**

- **Pass branch**: `transitionIntent('approved')` only. The promotion
  / deploy:pr dispatch is NOT invoked from the graph. TODO marker in
  the code at the pass branch. Legacy `handleGateTask` still
  dispatches through the existing path, so trackeros traffic is
  unaffected.
- **Escalate branch**: `transitionIntent('escalated')` AND
  GP_BREACH alert creation inline in `gateNode`. Per TR_053 Fix 6,
  the deciding node owns the alert — never a future interrupt node.
  The legacy `createBreachAlert` is untouched and still fires from
  `handleGateTask`. (When 2c deletes the legacy tail, that
  duplication ends.)
- **Fail branch**: NO transition in `gateNode`. `selfHealingNode`
  (Part 1) owns the fail/retry split. The legacy
  `transitionIntent('failed')` tail in `handleGateTask`'s catch
  block remains unchanged.
- **Synthetic-fail verdict on thrown errors**: any throw inside
  `gateNode`'s body is caught; `workDir` is cleaned in `finally`;
  a synthetic `{verdict:'fail', signalsJson:'[]'}` is emitted so
  the future conditional edge routes to `selfHealingNode`
  deterministically. The node never re-throws (LangGraph treats
  thrown nodes as unrecoverable graph errors).
- **Observability preserved verbatim**: Promise.all of constraint
  + review with `runWithObservability` decoration (lastPrompt /
  llmResponse / modelUsed / tokensUsed / tokenManagement /
  toolCalls). TR_053 NRB-1 completed-with-warning patch on
  pass-with-errored-agent. `gate.completed` SSE event.

**Type bridge that didn't need a contract change:**

`GateSignal` (gate-internal, `agentRole: GateAgentRole`) vs
`PlatformSignal` (core, `sourceAgent: AgentRole`) bridged via the
pre-existing `gateSignalToPlatformSignal` (one `export` keyword
added to make it visible from `nodes.ts`). `FeedbackSignal` is a
type alias of `PlatformSignal` in `core/src/types.ts:176`, so
`state.priorSignals: FeedbackSignal[]` accepts the conversion
output directly.

**Build:** `pnpm -r build` clean across all 13 packages on first
pass. No type errors surfaced. `git diff --stat HEAD~1 --
gate-orchestrator.ts` shows 1 insertion + 1 deletion — the single
`export` keyword.

**Not landed (pending TR_056 Part 2b / 2c / 2d):**
- `graphs/gate/graph.ts` (compileGraph + runGateGraph +
  conditional edges + interrupt detection — mirroring the planning
  graph pattern).
- `handleGateTask` thin-invoker refactor.
- Deletion of `dispatchPromotion` / `dispatchDeployPR` /
  `maybeDispatchRetry` / `attemptSelfHealingForGate` /
  `createBreachAlert`.
- §5 forced-failure suite (Scenarios 1, 2, 4, 6 in-process;
  Scenario 5 needs a real-process kill).

Commit: `d396e76 feat(TR_056-2a)`.

---
### Session 2026-06-14 — Claude Code (TR_056 Part 1: gate-subgraph foundation — state + shared selfHealingNode + checkpointer singleton move; build clean; TR_055/TR_055b investigation reports + uncommitted carryover from TR_051→TR_054 bundled in the same commit)

Brief: build the gate-subgraph foundation per the TR_055b §4
mapping. Land state + shared `selfHealingNode`. Don't convert
generate or deploy this session. Don't touch the template
version until the §5 suite passes.

**B-i/B-ii decision: B-i.** TR_054 #40 (server-restart resume on
the planning graph after a phase deploys) was still `in_progress`
at session start. Per the TR_056 prerequisite: implement Path B
(fix-intent) as B-i — the existing TR_024 mechanism (child intent
inserted with `parent_intent_id`, `onSuccessDispatch` envelope
minted on the child, BullMQ `generate:intent` dispatched, parent
parked at `waiting-for-clarification`). Two
`// TR_054-PENDING: revisit B-ii once restart-resume verified`
markers in `shared/self-healing-node.ts` at the fix-intent +
retry branches.

**Landed (gate-subgraph foundation):**

- `packages/core/src/graphs/checkpointer.ts` — process-wide
  `PostgresSaver` singleton moved here from
  `packages/agents/planning/src/graphs/checkpointer.ts` (which
  becomes a re-export) so quality-gate can share the same
  instance without inverting the package dep direction. One
  `pg.Pool` per process across all layer subgraphs.
- `packages/agents/quality-gate/src/graphs/gate/state.ts` —
  `Annotation.Root` schema (intentId / correlationId / branch /
  prNumber / prUrl / retryCount / readFromBranch / artifacts /
  priorSignals / gateVerdict / selfHealingOutcome / errors).
- `packages/agents/quality-gate/src/graphs/shared/self-healing-node.ts`
  — wraps `runSelfHealingLoop`. **TR_020 `ABSOLUTE_MAX_RETRIES = 5`
  DB cross-check enforced BEFORE the loop call** so a checkpoint
  restore can never silently reset the budget (per TR_055b §5
  invariant). Translates loop result to
  `Command({update: {selfHealingOutcome}})`. Edge guards
  (unrecoverable → hallucination-loop → cascade-depth) preserved
  in the loop's canonical order. Auto-resolve branch (Path C)
  surfaces as `outcome: 'autoResolved'`.
- 9 helpers in `gate-orchestrator.ts` made `export`-able
  (`defaultGateHarnessConfig`, `loadHarnessStack`,
  `shouldSkipReviewAgent`, `readSourceFilesFromWorkDir`,
  `runWithObservability`, `buildProjectStructureBrief`,
  `authenticatedGitUrl`, `resolveProjectFor`, `transitionIntent`)
  so the forthcoming `gateNode` (Part 2a) can call them.
- LangGraph deps added: `@langchain/langgraph-checkpoint-postgres`
  to `@gestalt/core`; `@langchain/langgraph` + `@langchain/core`
  to `@gestalt/agents-quality-gate`.

**Same-commit carryover** (the entire LangGraph Option A arc was
uncommitted at session start — TR_051 architecture graph, TR_052
verification report, TR_053 initial + amendment work, TR_054 doc
reconciliation + adapter restore, TR_055 + TR_055b investigation
reports). All bundled in commit `3728561` because they all
typecheck together and splitting at this point would have meant
hours of `git rebase -i` archeology.

**Build:** `pnpm -r build` clean across all 13 packages.

**Not landed:** `nodes.ts` (Part 2a), `graph.ts` (Part 2b),
thin-invoker refactor + dispatch-helper deletions (Part 2c), §5
forced-failure suite (Part 2d). Template version NOT bumped.

Commit: `3728561 feat(TR_051..TR_056-WIP)`.

---
### Session 2026-06-14 — Claude Code (TR_054 / TR_055 / TR_055b combined: doc reconciliation, restart-resilience verification, Option A coupling assessment, self-healing protocol deep trace)

Three closely related no-or-investigation-only sessions
collapsed into one entry. None ship runtime code beyond the
TR_054 rename.

**TR_054 — doc reconciliation + staged restart-resilience
verification.**

- **A1 / A2 / A3 / A4 / A5** — doc reconciliation pass after
  TR_053 amendment. `planner.engine: 'langgraph' | 'orchestrator'`
  (default `'langgraph'`) is the live shipped surface;
  `useLangGraph?: boolean` retained as `@deprecated` alias in
  `core/src/harness/index.ts` and respected by
  `readPlanningEngine` as a fallback. Strengthened "PLANNING-PATH"
  / "RESUME-PATH" log lines in `planning-orchestrator.ts` so
  routing is visible without DB inspection. Restored trackeros
  `pipeline.adapter` from `noop` back to `github-actions` +
  `autoMerge: true` (trackeros commit
  `6fa6c597 chore(TR_054): restore pipeline adapter to
  github-actions + autoMerge`). STATE.md operator-state section
  refreshed with current DeepInfra / DeepSeek configuration.
- **B1 — gate path log verification on the legacy orchestrator**:
  IN PROGRESS at session end. Confirmed `PLANNING-PATH langgraph`
  is logged at planning-start; ready to flow through gate.
- **B3 / B4-resume / B5 — restart-resume after deploy**: NOT
  REACHED. The B4-immediate variant (kill server mid-await before
  any deploy) PASSED with 12s recovery + checkpoints preserved
  across kill. The full B3 / B4-resume / B5 path (kill AFTER a
  phase deploys, verify the planning graph resumes from the
  correct checkpoint without re-dispatching the deployed
  intent) was NOT exercised end-to-end. Tasks #39 / #40 / #41
  remain `in_progress` / `pending`.

**Finding #13.1 (TR_054)**: BullMQ-stall ⊥ LangGraph-checkpoint
asymmetry. Mid-generate restart: BullMQ marks the generate task
`failed: stalled` after the `lockDuration: 600000` window and —
because `maxStalledCount: 0` — does NOT retry. The generate work
silently orphans. LangGraph state survives correctly but Phase 1
stays `generating` forever from the planning graph's perspective.
This finding directly motivated the **Option A** architectural
decision later in TR_055 (LangGraph owns the flow, BullMQ → pure
transport — eliminates the stall-vs-checkpoint protocol mismatch
at its source).

**Template version `0.38.0 → 0.39.0`** bumped during TR_054. File
(`templates/corporate-ops-web-mobile/template.json`) reads
`0.39.0` as of this session. Some historical BUILD.md narrative
still says "held at 0.38.0 until verification passes" — those
are historical entries from TR_053 amendment, not current state.

**TR_055 — Option A coupling assessment (no code).**

Three transport architectures evaluated for the LangGraph
migration arc after TR_053:
- Option A: LangGraph owns all flow; BullMQ → pure transport
  (no queue-internal routing).
- Option B: Hybrid — LangGraph for in-layer state, BullMQ for
  inter-layer dispatch.
- Option C: Status quo — keep BullMQ as the routing primitive,
  add LangGraph only for in-layer state machines.

**Decision: Option A.** Eliminates the Finding #13.1 protocol
mismatch at its source. Other queues become dumb transports.
The single decision point becomes the graph's conditional
edge surface; layer subgraphs compose deterministically.

**Sequence decision: (b) unify-first.** Convert gate (easy),
then generate (the big one), then deploy (graph-of-graphs
composition). All three migrations live in parallel with the
legacy orchestrator until the §5 forced-failure suite passes
for each layer.

**Conversion order: gate → generate → deploy.** Gate is the
smallest layer (no LLM tool loop, no Aider, no PR-Agent
subprocess plumbing). Best place to land + verify the
`selfHealingNode` pattern before generate's complexity.

**TR_055b — self-healing protocol deep trace (no code).**

Six-section report on the canonical self-healing
implementation in `packages/core/src/agents/self-healing-loop.ts`:

- §1 (dispatch union): ONE diagnostician decision point at
  `self-healing-loop.ts:507`. Three durable dispatch sites —
  Path A retry (`:710`), Path B fix-intent (`:1137`), Path C
  auto-resolve (`:1032`). All paths funnel through
  `agent.diagnose()`. No hardcoded failure-pattern matching
  downstream — ADR-050 holds.
- §2 (fix-intent lifecycle): child intent + `onSuccessDispatch`
  envelope created in `submitFixIntent:1095`. The envelope's
  ONLY non-test reader is the deploy promotion path at
  `deploy-orchestrator.ts:432-462` (replays envelope verbatim
  + clears the field after dispatch).
- §3 (cascade-brake): `MAX_FIX_INTENT_DEPTH = 2` constant at
  `:97`, enforced at `:526-546` via the
  `getFixIntentChainDepth` walker (reads `parent_intent_id`
  from the DB, NOT graph-local state — cannot be bypassed by
  a checkpoint restore).
- §4 (graph-edge mapping): Path A → `Command({goto})`;
  Path B → subgraph invocation (B-i: in-process call;
  B-ii: park via `interrupt()` + event-bus resume); Path C →
  fallback branch inside `selfHealingNode`; escalate →
  `Command({goto: 'humanFeedbackNode'})`.
- §5 (regression risks): HIGH — cascade-brake silenced by
  edge-bypass; `MAX_GATE_RETRIES = 3` + the ABSOLUTE
  `agent_executions`-derived cap must both fire; TR_030 →
  TR_032 negation-framing / preservation-footer / `--read`
  fixes (all in `self-healing-agent.ts` + `aider-*` files);
  `onSuccessDispatch` envelope shape.
- §6 (verification checkpoint): forced-failure suite of six
  scenarios that any unified self-healing graph MUST pass
  before merge. Scenarios 4 and 5 (cascade-brake forced;
  restart-mid-fix-intent) are non-negotiable.

Reports inline in conversation transcripts, not separate
`.md` files under `docs/claude/`.

**No code changes from TR_055 / TR_055b.** Build status
unchanged from TR_053 amendment + TR_054.
