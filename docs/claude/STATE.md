# STATE.md — current platform state

_Concise capability snapshot. For HOW each capability was built,
see [sessions/RECENT.md](./sessions/RECENT.md) (last 3 sessions) or
the `sessions/archive/` files (everything older)._

**Last updated:** 2026-06-14 (after TR_056 Part 2a — gateNode lifted from `handleGateTask:397→675`; legacy path UNCHANGED).

**Current Option A arc (TR_054 → TR_056) — concise lead, details in `sessions/RECENT.md`:**

- **TR_056 Part 2a** — `packages/agents/quality-gate/src/graphs/gate/nodes.ts` written. `gateNode(state) → Partial<state>`: clones repo, runs constraint + review-agent in parallel via `runWithObservability` (Promise.all + ADR-051 skip verbatim), synthesises verdict, applies TR_053 NRB-1 completed-with-warning patch, emits `gate.completed`. `verdict === 'escalate'` creates GP_BREACH alert in this node (TR_053 Fix-6 — deciding node owns the alert). Pass → `transitionIntent('approved')` + TODO marker for the 2b wire to DeployGraph. Fail → no transition (selfHealingNode owns the fail/retry split). Synthetic-fail verdict on any thrown error so the future conditional edge routes deterministically. `handleGateTask` body **untouched** — one `export` keyword added to `gateSignalToPlatformSignal`. Build clean. Commit `d396e76`.
- **TR_056 Part 1** — gate-subgraph foundation committed. `getCheckpointer()` singleton moved to `@gestalt/core/src/graphs/checkpointer.ts` (gate + planning share one `pg.Pool`). `packages/agents/quality-gate/src/graphs/gate/state.ts` (`Annotation.Root`). `packages/agents/quality-gate/src/graphs/shared/self-healing-node.ts` (B-i wrapper around `runSelfHealingLoop`, `ABSOLUTE_MAX_RETRIES = 5` DB cross-check BEFORE the loop, two `// TR_054-PENDING` markers at fix-intent + retry branches). 9 helpers in `gate-orchestrator.ts` made `export`. LangGraph deps added to core + quality-gate package.jsons. Legacy `handleGateTask` still routes — safe rollback. `nodes.ts` ✅ (Part 2a); `graph.ts` / thin-invoker / deletions / §5 forced-failure suite pending. Commit `3728561`.
- **TR_055 / TR_055b** — investigation only, no code. Option A coupling assessment + self-healing protocol deep trace. Decisions: Option A (LangGraph owns flow, BullMQ → pure transport); sequence (b) unify-first; conversion order **gate → generate → deploy**; **B-i chosen for fix-intent** pending TR_054 #40. Reports inline in conversation transcripts (not separate `.md` files in `docs/claude/`).
- **TR_054** — doc reconciliation + restart-resilience verification. `planner.engine: 'langgraph' | 'orchestrator'` (default `'langgraph'`) rename landed and is the live shipped surface; `useLangGraph?: boolean` retained as `@deprecated` alias in code. Trackeros `pipeline.adapter` restored `noop → github-actions` + `autoMerge: true` (commit `6fa6c597`). **B4-immediate PASSED** (12s recovery, checkpoints preserved across kill). **B3 / B4-resume / B5 (full restart-resume after deploy) NOT reached — still `in_progress`.** Finding #13.1: BullMQ-stall ⊥ LangGraph-checkpoint asymmetry — generate task orphans on mid-generate restart; planning graph parks forever. Template `0.38.0 → 0.39.0` bumped during the cycle (file confirms).

**Earlier (TR_053 amendment — **8 correctness fixes to the LangGraph PlanningGraph + refined event-based resume plumbing**. Step 0 trace report determined `featureId` is NOT propagated through deploy payloads — reconstructed via `feature_phases` JOIN at the planning subscriber. User chose event-based routing (Refined Option 2): new `intents.parent_context JSONB` column (migration 030) carries `{kind:'planning-phase', featureId, phaseIndex}`; `phaseDispatchNode` stamps it at intent create time; `transitionIntent` (deploy + gate + generate copies) enriches the `intent.status-changed` event payload with the column; the planning subscriber routes WITHOUT a DB JOIN. **Fix 1 (resume API)**: `Command({resume})` is the correct API in `@langchain/langgraph@0.2.74`; smoke-tested with a throwaway 2-node graph (PASSED). Interrupt detection corrected — NOT `result.__interrupt__` (not surfaced on invoke return), instead `graph.getState(cfg).tasks[*].interrupts` + `state.next`. **Fix 2 (both terminal outcomes resume)**: subscriber dispatches `planning:graph-resume` on `deployed` (success:true) AND on failed/escalated/waiting-for-clarification (success:false + failureReason); `phaseEvaluatorNode` handles the success:false branch via the `maxPhaseRetries` budget. **Fix 3 (single engine, default langgraph)**: `harnessConfig.planner.engine: 'langgraph'|'orchestrator'` (default `langgraph`) replaces the deprecated `useLangGraph` flag; `handlePlanningStart` logs `planning engine selected: <engine>` and re-dispatches as `planning:graph-start` when langgraph; legacy `planning:phase`/`planning:evaluate` genuinely inert for graph features. **Fix 4 (resume in planning worker via queue)**: confirmed — already implemented via `planning:graph-resume` BullMQ task; deploy layer stays decoupled. **Fix 5 (interrupt return = job success)**: confirmed at `core/src/queue/index.ts:184-189` — BullMQ marks COMPLETED on any non-throwing return; `runPlanningGraph` returns normally on both END and interrupt paths; comment block in `handleGraphStart` locks in the rule. **Fix 6 (no side effects before interrupt)**: `humanFeedbackNode`'s alert creation moved to `phaseEvaluatorNode`'s `escalate` branch (the deciding node, runs exactly once); `awaitPhaseNode` reduced to log + interrupt only; explicit rule comments on both interrupt nodes. **Fix 7 (adjust/continue/escalate semantics)**: explicit comment block on `phaseEvaluatorNode`; `planningAction` now returns `'adjust'` (vs `'continue'`) when evaluator applied scope adjustments; both advance the index; observability-only distinction. **Fix 8 (architecture function-call vs subgraph)**: documented in AGENT_TEAMS.md as a conscious tradeoff — function-call wins on simplicity (independent thread_id) at the cost of non-resumable architecture (~4 min re-work on restart). **Verification step 1 (throwaway script) PASSED**. **Verification step 2 (graph parks + checkpoint written) PASSED** on trackeros feature `ff4e32f4`: engine selection logged, ArchitectureGraph fired (Kimi chief flaked twice → operator switched chief to DeepSeek-V3.2 for verification — committed to trackeros agents.yaml), planner ran, Phase 1 intent dispatched with `parent_context` JSONB correctly populated, `awaitPhaseNode interrupting` log fired, `Task completed` confirms BullMQ saw success. **Verification step 3 (Phase 1 deploys + resume + Phase 2 dispatched)** IN FLIGHT at report-final — `p1_intent_count=1` (Phase 1 dispatched exactly once; Fix 6 working). **Discovered live**: BullMQ `lockDuration: 600000` (10min, tuned for legacy planning:start) was too short for `planning:graph-start` (~24 min wall-clock incl. ArchitectureGraph) — marked the job `failed:stalled` AFTER successful handler return (observability noise; not retried due to `maxStalledCount: 0`). **Bumped** `lockDuration` to 1800000 (30 min) on the planning queue worker. **Verification steps 3-5 + full feature run + template 0.39.0 bump = TR_054 carryover**. **Earlier (TR_053 initial — **LangGraph migration Phase 2 (ADR-056) landed** as a parallel rollout + **all three TR_052 NRBs fixed**. **PlanningGraph** is the new `StateGraph` in `packages/agents/planning/src/graphs/planning/` — 6 nodes (architecture/planner/phase-dispatch/await-phase/phase-evaluator/human-feedback) plus conditional edges (continue|adjust|complete|escalate). The await-phase + human-feedback nodes use LangGraph `interrupt()`; resume happens via `Command({resume})` on a new BullMQ task `planning:graph-resume` dispatched by the existing event-bus subscriber when a feature checkpoint exists. The graph runs **alongside** the legacy `planning-orchestrator` three-task chain, gated by `harnessConfig.planner.useLangGraph` (default `false`). Two new BullMQ task types (`planning:graph-start` + `planning:graph-resume`) in `@gestalt/core` `TaskType` union. `HarnessConfig.planner.useLangGraph?: boolean` added. `ExecutionStatus` gains `'completed-with-warning'` for **NRB-1**. **NRB-2**: architecture-graph parsers now throw `SpecialistResponseError` on JSON-parse failure OR parsed-to-empty Designs; nodes catch and emit structured sentinel into `state.errors[]`; chief logs slice presence + priorErrors before reconciling. **NRB-3**: `ArchitectureAgent.buildStackSubstitutions` + `buildStackSubstitutionPrompt` + `applyStackSubstitutions` + the two orchestrator call sites all deleted (the architecture crew enforces stack compliance structurally — substitution machinery was redundant after TR_051 + failed on DeepInfra anyway). `FeatureArchitecture.stackSubstitutions` kept as `@deprecated` for back-compat with persisted JSON. **Template version held at 0.38.0** (TR_053 initial briefly proposed bumping to 0.39.0; TR_053 amendment + TR_054 keep it at 0.38.0 until the staged verification passes — only then does the bump land). No new platform migration (LangGraph checkpointer reused from TR_051; `agent_executions.status` column has no CHECK constraint so the new ExecutionStatus value is additive). `pnpm -r build` clean across all 13 packages. **Engine routing — current as-shipped**: TR_053 amendment renamed `useLangGraph: boolean` → `planner.engine: 'langgraph' | 'orchestrator'` (default `'langgraph'`); `useLangGraph` retained as deprecated alias for forward compatibility. **Live verification = TR_054 carryover** — operator sets `planner.engine: 'langgraph'` in HARNESS (or accepts the default) to take the graph path. Reviewer-layering nuance: brief asked for promotion-agent to invoke the planning graph directly, but the event-bus subscriber routing (checkpoint lookup) keeps deploy decoupled from planning's internals — same outcome, cleaner layering. **Earlier (TR_052 — TR_051 ArchitectureGraph LIVE-VERIFIED end-to-end** on trackeros feature `e1ee9e5c`. Crew fires as designed: three specialist nodes ran in parallel (all started at 11:14:35 server time, all done within 67s; ~3× wall-clock saving vs serial); chief reconciled afterwards (Kimi-K2.6, 198s, 15,607 tokens, 6 entities + 5 modules + 7 dependency edges + 5 recommended phases + **6 first-class `sqlSchemas[]` CREATE TABLE statements** + AuditLog as a 6th entity surfacing structurally from GOLDEN_PRINCIPLES.md GP-002). **TR_036→TR_050 rigor bar accretion structurally absorbed** — intent-agent passed Phase 1 cleanly on first attempt with zero HARNESS rule intervention. **Phase 1 deployed in 19m 27s** (vs TR_050's 20m for Phase 1 alone). LangGraph `PostgresSaver` created its own 4 tables on first call (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`, `checkpoint_migrations` — LangGraph 0.2 emits two more than the AGENT_TEAMS.md blueprint stated). Three new rigor bars surfaced as follow-ups: NRB-1 (review-agent silent failure on noop-adapter gate — constraint-agent's pass was sufficient but the failed review-agent row is a confusing observable), NRB-2 (specialist parse-to-empty leaves `state.errors` empty — operators can't see which slice dropped), NRB-3 (TR_044 `buildStackSubstitutions` hardcoded to gpt-4o-mini still fails on DeepInfra registry — now redundant since chief enforces stack compliance structurally; candidate for removal). Pipeline continues in background; feature still `in-progress` at report-final (Phase 2 mid-flight; phases 3-10 pending; full completion verification deferred to TR_053). Full report in `docs/claude/TEST_REPORT_052.md`. **Earlier (TR_051 — LangGraph migration Phase 1 (ADR-056) landed**. The single architecture-agent's feature-level `designFeature` + `reviewDesign` pass is replaced by a LangGraph `StateGraph` crew in `packages/agents/planning/src/graphs/architecture/`: `DomainArchitectNode` + `DataArchitectNode` + `AppArchitectNode` fan out from START in parallel; `ChiefArchitectNode` reconciles. Per-agent `RetryPolicy` on every node (3 attempts specialists, 2 chief; backoff on timeouts / sockets / 5xx / 429). PostgreSQL checkpointer (`@langchain/langgraph-checkpoint-postgres`) reuses `DATABASE_URL`; LangGraph creates its own `checkpoints` + `checkpoint_writes` tables on first `setup()` call — no Gestalt migration needed. **4 new AgentRoles** (`domain-architect-agent` / `data-architect-agent` / `app-architect-agent` / `chief-architect-agent`) added to `@gestalt/core` `types.ts` + `PER_ROLE_DEFAULTS`. **4 new `agentConfig` blocks** (template + trackeros HARNESS.json) with rules per the brief. **4 new agents.yaml entries** — template uses platform default; trackeros binds specialists to `deepseek-ai/DeepSeek-V3.2` (6k max_tokens) and chief to `moonshotai/Kimi-K2.6` (12k max_tokens). Planning orchestrator's `handlePlanningStart` swaps `architectureAgent.designFeature + reviewDesign` for a single `runArchitectureGraph(...)` call. `ArchitectureAgent.designFeature + reviewDesign` marked `@deprecated` but retained as fallback — `designPhase + reviewPhaseDesign` remain in use (Phase 2 of the migration absorbs those). Template `0.35.0 → 0.38.0`. No new platform migration. `pnpm -r build` clean across all 13 packages. **Live verification pending** — see TR_051 entry in `BUILD.md` for the recipe. **Earlier (TR_050 — multi-stage infrastructure migration to DeepInfra, Aider promoted to the only code-generation backend, and 5 cascading timeout / config fixes that finally let Aider produce real source files end-to-end on Kimi-K2.6 via DeepInfra. **Operator action**: 3 DeepInfra LLMs registered (`deepinfra-kimi-k2` / `deepinfra-deepseek-v3` / `deepinfra-qwen-tiny`, all `chat-completions` apiShape on `https://api.deepinfra.com/v1/openai`), `DEEPINFRA_API_KEY` added to `.env`. Platform default flipped to `deepinfra-deepseek-v3` via `gestalt platform llms set-default`. **9-agent trackeros agents.yaml matrix swap** to DeepInfra: architecture-agent on DeepSeek-V3.2 (after Kimi's 12k-token design call hit 50% timeout rate), self-healing on Kimi-K2.6, planner/phase-evaluator/constraint/review/intent/design on DeepSeek-V3.2, code-agent (Aider) on Kimi-K2.6 (DeepSeek wouldn't emit Aider's SEARCH/REPLACE blocks reliably); `reasoning_effort` fields removed (DeepInfra OpenAI-compat doesn't support). **Platform code (8 changes)**: (1) Aider is now the platform default code-generation backend — `orchestrator.ts` both `aiderBackend` checks coalesce absent `codeGeneration.backend` to `'aider'`; `harness/index.ts` JSDoc rewritten ("gestalt" backend deprecated, retained for backwards compat); template + trackeros HARNESS add explicit `codeGeneration.backend: 'aider'` block. (2) `.env` fixed `LLM_MOCEL` typo → `LLM_MODEL`, set `LLM_API_KEY` to DeepInfra key (loadConfig requires both, server was in restart loop). (3) `LLM_TIMEOUT_MS=300000` (5 min, was 120s). (4) BullMQ Worker: `lockDuration: 600000` + `maxStalledCount: 0` in `queue/index.ts` — closes duplicate-handler bug where long planning:start was retried under default 30s stall detection. (5) `classifyError` in `llm/index.ts` treats `TypeError: fetch failed` + standard socket errors as retryable — closes TR_033 follow-up. (6) Aider litellm provider prefix: `aider-adapter.ts` prepends `openai/` when model lacks one of 17 known litellm provider prefixes; closes the `LLM Provider NOT provided` error that killed all DeepInfra/Aider routing. (7) Aider subprocess timeout cascade — three nested ceilings each needed bumping: `DEFAULT_AIDER_TIMEOUT_MS` 120k→900k (adapter ceiling); `--timeout 600` CLI flag (Aider's per-LLM HTTP timeout); `MAX_SCRIPT_TIMEOUT_MS` in `core/src/tools/file-tools.ts` 120k→900k — THE actual ceiling that was silently clamping every Aider run to 120s. Template `0.34.0 → 0.35.0`. Build clean. **Verified end-to-end on trackeros feature `523e9824`**: **Phase 1 DEPLOYED in 20m 03s — the FIRST EVER autonomous source-file generation cycle on DeepInfra/Aider across TR_036 → TR_050**. Path: intent (DeepSeek) → design (DeepSeek) → context (DeepSeek) → code-agent (Aider/Kimi — REAL files written) → test-agent (skipped per Aider backend) → pr-agent → pipeline-agent (noop) → constraint-agent (DeepSeek, PASSED) → review-agent (DeepSeek, PASSED) → promotion. Architecture: 3 interfaces + 7 criteria. Plan: 6 phases. Session ran 10 cycles total; each one identified a different layer in the timeout/config cascade until the final stack worked. **Phase 2 escalated 1m 50s after dispatch on three new intent-agent rigor bars** (Jest/Vitest framework regression, missing approve/reject methods in interface vs scope, transaction approach not pinned) — same class as TR_036-TR_047, surfacing again on DeepSeek-V3.2-driven architecture (doesn't internalise HARNESS rules as crisply as gpt-5.5). Deferred to TR_051. **Earlier (TR_049 — mandatory SQL schema for relational-DB stacks)** — two changes (one HARNESS rule + one platform-code review-checklist item) closing TR_048's 10th intent-agent rigor bar end-to-end. **Fix 1**: appended to `agentConfig.architecture-agent.rules` (template + trackeros HARNESS): "When the declared stack includes a relational database, you MUST include a complete SQL schema in your output for every persistent domain entity you define. A domain entity without a corresponding table definition is incomplete." Abstract — no DB names hardcoded. **Fix 2**: 9th review-checklist item ("SQL schema completeness — if the declared stack includes a relational database, verify that every persistent domain entity defined in this architecture has a corresponding SQL table definition.") added to both `buildArchitectureReviewPrompt` (closes "all eight checks") and `buildPhaseArchitectureReviewPrompt` (closes "all nine checks"). Template `0.33.0 → 0.34.0`. No new migration. Build clean across all 13 packages. **Verified end-to-end on trackeros feature `dca0cb06`**: architecture-agent emitted SIX CREATE TABLE statements in `architectureMdUpdate` (employees, leave_policies, leave_balances, leave_requests, notifications, audit_records) vs TR_048's zero. **TR_048's canonical-schema-reuse machinery FIRED for the first time across the sequence** — server logs show "TR_048 — injecting canonical SQL schemas into per-phase prompts" three times. Phase 1 and Phase 2 each have populated `sqlSchema` fields matching the feature-level canonical. Plan: 10 phases (architect fanned out persistence per-entity). Phase 1: 3 interfaces + 7 criteria. **Phase 1 cleared the FULL Gestalt agent pipeline end-to-end** — intent-agent → design → code (Aider) → CI → pr-agent → constraint-agent PASSED → review-agent PASSED → promotion. **First phase across TR_036 → TR_049 to make it intent → promotion without escalation.** Wall-clock 7m 03s. **Caveat**: trackeros pipeline adapter is on `noop` since TR_043, so no actual PR landed on GitHub; agent-cycle validation is real, deploy is noop. Phase 2 escalated on a NEW 11th rigor bar: `PostgreSqlAuditRepository` defined as abstract class in high-level architectureMdUpdate vs concrete class with stubbed methods in per-phase architecture — class shape drift across phases. The fix-intent went all the way through to review-agent before clarification escalated. New HIGH follow-up: architecture-agent must keep class shape + method-body status identical across high-level + per-phase views of the same class; OR per-phase architecture is authoritative for the phase that CREATES the class. New MEDIUM operator action: switch trackeros pipeline adapter back to `github-actions` to verify full deploy chain. **Earlier (TR_048 — three platform fixes + one HARNESS rule closing TR_047's 9th intent-agent rigor bar (architecture-agent emitted two views of the same `leave_requests` table with drifted column types). Single source of truth for SQL schema: feature-level is canonical; per-phase references it instead of redefining. **Fix 1a**: `extractCanonicalSqlSchemas(json)` helper in `architecture-prompt.ts` reads either an explicit `sqlSchemas[]` field (forward-compatible) or regex `/CREATE\s+TABLE[\s\S]+?;/gi` against `architectureMdUpdate`; empty array on any failure path. New `renderCanonicalSqlSchemaSection` helper renders the "## Canonical SQL schemas (already defined — use these exactly)" block (omitted when empty). Both `buildPhaseArchitecturePrompt` and `buildPhaseArchitectureReviewPrompt` accept new last-positional `canonicalSqlSchemas: string[] = []` parameter and inject the section between goldenPrinciples and the task. **Fix 1b**: `ArchitectureAgent.designPhase` + `reviewPhaseDesign` accept the same parameter; `runPerPhaseArchitecture` orchestrator extracts once per phase via `extractCanonicalSqlSchemas(feature.architecture)` and passes to BOTH. Logs schemaCount when > 0. **Fix 2**: 8th review-checklist item ("Schema consistency — if a `## Canonical SQL schemas` block was provided above, your `sqlSchema` field MUST use the EXACT same column names, types, and constraints…") + closing line updated to "all EIGHT checks". **Fix 3**: `agentConfig.architecture-agent.rules` in template + trackeros HARNESS gains: "When a canonical schema is provided for a table, use it exactly. Do not redefine column types, sizes, or constraints. A table must have one definition across all architecture views." Template `0.32.0 → 0.33.0`. No new migration. Build clean across all 13 packages. **Verified live on trackeros feature `f070332a`**: TR_048 PLUMBING wired correctly — `runPerPhaseArchitecture` ran cleanly without errors; `extractCanonicalSqlSchemas` correctly returned an empty array (no "TR_048 — injecting canonical SQL schemas" log line) because the architect emitted NO SQL at all. DB inspection confirms `architectureMdUpdate` has zero CREATE TABLE statements and `feature_phases[0].architecture` has no `sqlSchema` field. **Plan shrunk to 5 phases (tightest yet across TR_036 → TR_048)** vs TR_047's 8, TR_046's 6, TR_045's 7, TR_044's 10. Phase 1 architecture: 4 interfaces + 6 criteria (1 criterion explicitly states atomic single-transaction semantics — TR_047 checklist surfacing). **Cycle did NOT reach the gate** — blocked at intent-agent on a 10th rigor bar: amb-001 "The exact PostgreSQL schema and table definitions for LeaveRequest and LeaveAuditRecord persistence are not specified" — the first bar where the prior fix's machinery worked correctly but had no input to act on. **TR_048 machinery is ready**; the upstream gap is now a required-output rule. New HIGH follow-up: architecture-agent must categorically produce CREATE TABLE for every persisted entity when the project stack declares a relational database (currently architectureGuidance says "SQL schema if needed" which the LLM treats as optional). Options: (a) architectureGuidance rule forcing CREATE TABLE for every persisted entity; (b) promote `sqlSchemas?: string[]` to a first-class field on `FeatureArchitecture` with required output for relational stacks; (c) per-phase review's 8th item promoted to "if sqlSchema is empty on a phase that creates persistence interfaces, REQUEST the canonical schema or write one here". **Earlier (TR_047 — TR_046's 8th bar CLOSED by structural redesign, gate reached 3rd time)** — one HARNESS rule + one platform-code rule closing TR_046's 8th intent-agent rigor bar (architecture-agent bundled `LeaveRequest` + `AuditRecord` mutations into Phase 1 without explicit transaction semantics (architecture-agent bundled `LeaveRequest` + `AuditRecord` mutations into Phase 1 without explicit transaction semantics). **Fix 1**: appended to `agentConfig.architecture-agent.rules` (template + trackeros HARNESS): "When a phase includes multiple domain mutations that must be coordinated (a primary operation plus a cross-cutting concern such as audit logging, event publishing, or cache invalidation), explicitly state the transaction semantics: whether the operations execute atomically in a single transaction, as separate transactions, or via a compensating pattern. Do not leave transaction behavior implicit." Abstract — no specific patterns hardcoded. **Fix 2**: 7th checklist item ("Transaction semantics") added to both `buildArchitectureReviewPrompt` and `buildPhaseArchitectureReviewPrompt`. Template `0.31.0 → 0.32.0`. Build clean. **Verified end-to-end on trackeros feature `d90d14b5`**: TR_046's 8th bar CLOSED by structural redesign — the architect SPLIT AuditRecord into its own Phase 2 (separate from Phase 1's LeaveRequest), making Phase 1 a clean single-mutation phase with no transaction-semantics question to answer. Phase 1 architecture: 4 interfaces + 7 criteria (the 7th is the new TR_047 transaction-semantics check). Plan: 8 phases. **Cycle reached the gate — third time across TR_036 → TR_047** with verdicts 6 → **1** → **1** CONSTRAINT_VIOLATION. Two consecutive 1-violation gate runs — closest the cycle has ever been to a clean gate pass. Cycle still blocked on the 9th and narrowest rigor bar yet: "The provided SQL schemas conflict on column types and sizes: one version uses TIMESTAMP and VARCHAR(32), while another uses DATE/TIMESTAMPTZ and VARCHAR(20)" — architecture-agent emitted two views of the same `leave_requests` table with drifted column types. New HIGH follow-up: schema-consistency rule + 8th review-checklist item that pins identical column types/sizes for the same table across feature-level and per-phase architecture outputs. **Earlier (TR_046 — TR_045's 7th bar CLOSED, cycle reached gate 2nd time)** — one HARNESS rule + one platform-code rule closing TR_045's 7th intent-agent rigor bar (architecture-agent introduced `CANCELLED` to support a cancel workflow phase but the project context's documented lifecycle had only Pending/Approved/Rejected). **Fix 1**: appended to `agentConfig.architecture-agent.rules` (template + trackeros HARNESS): "When your architecture introduces any new domain concept that does not appear in the existing project documentation (new lifecycle states, new enum values, new entity types, new relationships), you MUST include it in architectureMdUpdate." **Fix 2**: 6th checklist item ("Documentation consistency") added to both `buildArchitectureReviewPrompt` and `buildPhaseArchitectureReviewPrompt`. Template `0.30.0 → 0.31.0`. Build clean. **Verified end-to-end on trackeros feature `795e1069`**: architecture-agent did NOT introduce `CANCELLED` this cycle — `architectureMdUpdate` documents the lifecycle exactly as the project context defines it (Pending/Approved/Rejected); plan tightened to 6 phases (vs TR_045's 7, TR_044's 10) with Phase 1 bundling `LeaveRequest AND AuditRecord` (cross-cutting concern integration paying off). Phase 1 per-phase architecture: 5 interfaces + 6 criteria (richest yet — 6th criterion is the new doc-consistency item). **The cycle REACHED THE GATE for the SECOND time across the TR_036 → TR_046 sequence** (first was TR_039). Gate ran 6 times across two phase-retry attempts with violation counts trending 5 → 4 → **1** → 3 → 3 → 3 CONSTRAINT_VIOLATION — the single-violation run is the closest the cycle has ever been to a gate pass. Cycle still blocked on an 8th intent-agent rigor bar: "Transaction behavior for createLeaveRequest and AuditRecord creation is not explicitly defined" — a genuine architectural concern when two domain mutations land in the same phase. New HIGH follow-up: architecture-agent should explicitly state transaction semantics (atomic/non-atomic/compensating) for cross-cutting operations bundled with primary domain mutations. **Earlier (TR_045 — interface-signatures rigor closed)** — single abstract rule appended to `agentConfig.intent-agent.rules` in template + trackeros HARNESS: "Interface method signatures in per-phase architecture specifications are CONTRACTS to be implemented by the code-agent during this phase. They are not stubs. An interface showing method signatures without bodies is correct and complete — do not flag missing method bodies as ambiguity or missing implementation." Abstract — no TypeScript-specific language. Template `0.29.0 → 0.30.0`. No platform code change, no migration. Build clean. **Verified end-to-end on trackeros feature `48aa490e`**: TR_044's 6th rigor bar CLOSED — intent-agent did not escalate on interface-signatures-as-stubs (Phase 1 intent went `pending → generating` immediately). Tightened plan to 7 phases (Phase 2 bundles "Create AND cancel leave requests"; Phase 7 bundles "Employee integration, RBAC, balance consumption, and compliance coverage"). Phase 1 per-phase architecture: 5 interfaces + 5 criteria — richest yet across the TR_036 → TR_045 sequence. **Cycle still blocked on a 7th distinct intent-agent rigor bar**: "The project context defines LeaveRequest lifecycle states as Pending, Approved, Rejected, while the phase architecture specifies repository model status values PENDING, APPROVED, REJECTED, and CANCELLED." Architecture-agent introduced `CANCELLED` to support Phase 2's cancel workflow, but the documented project lifecycle has only the three other states. New HIGH follow-up: architecture-agent should update `architectureMdUpdate` in lockstep with new lifecycle states, OR intent-agent should treat states implied by the feature scope as consistent. **Earlier (TR_044 — per-phase framework leak CLOSED end-to-end)** — two fixes against TR_042's two HIGH NEW follow-ups. **Fix 1**: LLM-generated `<canonical>→[alternatives]` substitution map (gpt-4o-mini one-shot classification, generated once per feature, cached on `FeatureArchitecture.stackSubstitutions`) + a pure `applyStackSubstitutions` utility that runs as a deterministic post-process on every `reviewPhaseDesign` output before persistence. Closes the per-phase Vitest leak TR_040/TR_041/TR_042 couldn't fix via LLM-only prompts. **Fix 2**: read `docs/GOLDEN_PRINCIPLES.md` from the cloned tree at planning:start AND on every planning:phase, thread `goldenPrinciplesMd` through all four architecture-agent prompts (designFeature / reviewDesign / designPhase / reviewPhaseDesign) — gives architecture-agent the same cross-cutting visibility (audit logging, RBAC, etc.) intent-agent already had. Template `0.28.0 → 0.29.0`. Build clean. **Verified end-to-end on trackeros feature `fc99779a`**: per-phase framework leak CLOSED (DB query `jest=0 vitest=0 fastify=0 express=0` in Phase 1, vs TR_042's `Vitest=2 vitest=1`); golden-principles injection observably shaped the plan — Phase 3 "Create AuditRecord domain model and repository" (the exact concern TR_042 surfaced), Phase 7 RBAC, Phase 10 E2E coverage. 10-phase plan vs TR_042's 8. Cycle still blocked at intent-agent on a 6th distinct rigor bar: "intent refers to PostgreSQL-backed repository operations, while the provided architecture shows method stubs throwing 'Not implemented'" — intent-agent reads abstract TypeScript interface signatures (no method bodies, CORRECT for an architecture phase) as evidence the implementation is missing. New HIGH follow-up: intent-agent rule injection telling it interface signatures are contracts, not stubs. **Earlier (TR_043 — operator's parallel reasoning_effort feature)** — `reasoning_effort` parameter wired per agent. GPT-5.5+ family supports `reasoning_effort: xhigh|high|medium|low|non-reasoning`. **Part 1**: `AgentLlmConfig` (in `packages/core/src/agents/agent-config.ts`) gains a `reasoningEffort?: ReasoningEffort` field + a new `VALID_REASONING_EFFORTS` runtime set; the `agent-config-loader.ts` accepts both `reasoning_effort` (snake_case, matches the OpenAI wire field) and `reasoningEffort` (camelCase) from YAML; unknown values fall through silently. `normaliseCustomAgent` (ADR-037 custom agents) inherits the same parser. **Part 2**: `LLMRequest` + `CompleteWithToolsRequest` in `packages/core/src/llm/index.ts` gain `reasoningEffort?`; a new `reasoningEffortField(apiShape, reasoningEffort)` helper alongside `temperatureField`/`tokenLimitField` emits `reasoning_effort: <value>` ONLY when `apiShape === 'responses'` AND a value was supplied. Both `callProvider` (single-turn) and `callProviderWithTools` (function-calling loop) spread the helper into the request body. Standard chat-completions clients remain byte-for-byte identical. **Part 3**: `BaseLLMAgent.callLLMWithMessages` and `runToolLoop` spread `agentConfig.llm.reasoningEffort` into `client.complete(...)` / `client.completeWithTools(...)`. `TokenManagementLog` + `TokenManagementLogRecord` extended with `reasoningEffort: 'xhigh' | 'high' | 'medium' | 'low' | 'non-reasoning' | null` so per-call telemetry is observable through `agent_execution_logs.token_management` JSONB (no migration — additive on a JSONB column). Generate + maintenance orchestrators pass `agent.lastTokenManagement` through verbatim; the gate orchestrator's inline structural mirror was extended to include the new field. **Part 4**: template `agents.yaml` preamble documents `reasoning_effort` (valid values + apiShape gating + per-level rationale: high for high-stakes, medium for planning, low for deterministic gate checks, omit for non-reasoning agents). **Part 5 (per-agent matrix on trackeros)**: trackeros `agents.yaml` bound to `gpt-5.5` on every framework agent and `gpt-5.5-pro` on `self-healing-agent` — architecture-agent: temp 0.1, max 12000, **high**; self-healing-agent: temp 0.0, max 6000, **high**; planner-agent: temp 0.1, max 12000, **medium**; phase-evaluator-agent: temp 0.1, max 8000, **medium**; constraint-agent (NEW entry — was inheriting PER_ROLE_DEFAULTS): temp 0.0, max 2000, **low**; review-agent: temp 0.0, max 4000, **low**; code-agent: temp 0.1, max 8000, **no reasoning_effort** (Aider drives its own reasoning loop). Template `0.27.0 → 0.28.0`. Build clean across all 13 packages. **Live verification pending** — the brief's recipe is: run `gestalt feature submit "Build the leave management module..." --project trackeros` and query `SELECT agent_role, token_management->>'reasoningEffort' FROM agent_execution_logs ORDER BY created_at DESC LIMIT 20;` to confirm `reasoningEffort: "high"` is logged for `architecture-agent`. **Earlier (TR_042 — review-pass plumbing verified, planner file-count rule worked, Vitest still leaks at per-phase scale)** — two stopgap fixes extending TR_041's TOP-positioned stack compliance treatment from the FEATURE-level architecture pass to the PER-PHASE architecture pass. **Fix 1a**: new `buildPhaseArchitectureReviewPrompt` in `architecture-prompt.ts` mirroring `buildArchitectureReviewPrompt` for the `PhaseArchitecture` shape (interfaces / importStatements / sqlSchema / successCriteria) with stack compliance rendered FIRST + 5-point review checklist. **Fix 1b**: `ArchitectureAgent.reviewPhaseDesign` method with same safety semantics as `reviewDesign` — returns original draft on any failure path; logs before/after counts. **Fix 1c**: orchestrator wires `designPhase → reviewPhaseDesign → persist` with a STOPGAP (ADR-056) comment block. **Fix 2**: two new abstract `planner-agent.phaseScopingRules` items in template + trackeros HARNESS — "file list in each phase scope is an estimate; the architecture agent will produce the authoritative file list … your scope text must not contradict the architecture output". Template `0.26.0 → 0.28.0`. Build clean. **Verified live on trackeros feature `ec42e085`** — **MIXED**: `reviewPhaseDesign` log fires correctly (4s after designPhase, before/after counts 3→3 interfaces / 3→3 imports / 5→5 criteria); Fix 2 (planner file-count mirroring) WORKED end-to-end (intent-agent did NOT escalate on a file-count mismatch this cycle, closing TR_041's HIGH follow-up). But per-phase Vitest STILL leaks (`Vitest=2 vitest=1` in Phase 1 architecture) — even with the same TOP-positioned stack compliance check that cleaned the feature-level pass, the per-phase LLM judged the draft compliant and didn't rewrite the framework references. Cycle blocked at intent-agent on a NEW (fifth) rigor bar: "Platform standards require audit records for state-changing operations, but no audit module, interface, or file scope is provided for this phase". New HIGH follow-ups: regex post-processing for per-phase framework binding; feed goldenPrinciples into architecture-agent so it can pre-empt cross-cutting concerns like audit logging. **Earlier (TR_041 — TOP-positioning works end-to-end on the feature-level pipeline)** — three fixes building on TR_040's partial result. **Fix 1**: `buildArchitectureReviewPrompt` restructured — the `## Stack compliance check (read this first)` block moves from the END of the prompt to the FIRST position (before persona / harness section / draft / feature description), and its language strengthened to "REWRITE the relevant field with the declared stack value. Do not preserve the original". **Fix 2**: 5th checklist item added to `reviewDesign`'s review task — "Lifecycle coverage — for every entity whose state changes during the feature lifecycle, verify that at least one phase includes a method to perform that mutation. If a state transition exists in the feature description but no phase adds the corresponding mutation method, ADD it to the most appropriate phase." **Fix 3**: matching abstract architectureGuidance rule in template + trackeros HARNESS — "Every state transition described in the feature must have a corresponding method in at least one phase." Template `0.25.0 → 0.26.0`. Build clean. **Verified live on trackeros feature `595033ff`** — **TR_041 Fix 1 (top-of-prompt) works end-to-end on the FEATURE-level pipeline**: post-review architecture is framework-free (`jest=0 vitest=0 fastify=0 express=0` — no framework names at all, vs TR_040 which had `vitest=1 fastify=1`); planner's Phase 1 scope text says "Jest" (not "Vitest" or hedge); 8-phase bottom-up dependency-ordered plan (Employee → LeavePolicy → LeaveBalance → balance ops → LeaveRequest → submission → approval → notification) — Phase 7 IS the mutation phase the lifecycle-coverage rule asked for. **Cycle still blocked at intent-agent**: (a) per-phase `designPhase` STILL emits "Vitest tests" in success criteria because the review enhancements apply only to `reviewDesign` (feature-level), not `designPhase` (per-phase); (b) intent-agent caught a scope-vs-architecture file-count mismatch — planner scope text lists 2 files, per-phase architecture lists 3 + SQL schema. NEW HIGH follow-ups: `reviewPhaseDesign` for the per-phase pass; planner-agent must mirror architecture-agent's file list verbatim. **Earlier (TR_040 — Fastify binding worked end-to-end, Vitest binding did NOT)** — two changes binding architecture-agent's output to `HARNESS.stack`. **Fix 1**: two new abstract `architectureGuidance` rules in template + trackeros HARNESS (stack is the authoritative source for all technology choices; verify every framework reference matches the declared stack before emitting). **Fix 2**: `buildArchitectureReviewPrompt` gains a `## Stack compliance check` block rendered immediately before the JSON output schema, listing `HARNESS.stack` and telling the agent to correct any mismatch in success criteria, interface names, or implementation notes. Empty string when `HARNESS.stack` is absent. Template `0.24.0 → 0.25.0`. Build clean. **Verified live on trackeros feature `8900ab21`** — **PARTIAL**: Fastify binding worked end-to-end (architecture used Fastify vs prior Express; DB confirms `fastify=1 express=0` in post-review architecture; Phase 8 title reads "Expose Fastify APIs..."); Vitest binding did NOT work (`jest=0 vitest=1`; Phase 1 success criteria still says "Vitest tests..."; scope text hedge "Include Jest or Vitest unit tests"). reviewDesign ran 5s with same entity counts — the LLM didn't act on the test-framework correction. Cycle blocked at intent-agent on a separate, real architectural gap: `LeaveRequestRepository` has only `create + findById` and no later phase ever adds `update` even though Phase 5 needs to mutate `LeaveRequest.status` for the approval workflow. Architecture-agent REGRESSED on coverage vs TR_038/039 — possibly misreading TR_039's deferred-section as a license to minimize Phase 1's interface. New HIGH follow-ups: Vitest binding (move check to top of review prompt + regex post-processing); lifecycle-coverage rule (every state transition implied by the feature must have a phase that adds the corresponding repository method). **Earlier (TR_039 — TR_038 follow-up CLOSED, cycle reached gate for first time)** — planning orchestrator appends a `## Deferred to later phases` section to every phase intent text, listing each later-pending phase as `- Phase N — <title>: <scope snippet>`; new `agentConfig.intent-agent` block in template + trackeros HARNESS with two abstract rules telling intent-agent that deferred items are out of scope. Template `0.23.0 → 0.24.0`. Build clean. **Verified end-to-end on trackeros feature `61953f63`**: all 3 Phase-1 attempt-intents contain the Deferred section; intent-agent passed cleanly on every attempt (no escalation on deferred CRUD operations — the TR_038 follow-up is CLOSED); **the cycle reached the GATE for the first time across the TR_036 → TR_039 sequence**. Gate ran 6 times. All TR_036 mechanisms verified live as a side-effect: project-structure brief present in every gate-agent prompt (DB-confirmed); zero false-positive `pool.query`/`new Pool` violations on the shared/db connection file (TR_036 Fix 1 abstract rules working); `feature-blocked` alert visible in `gestalt alerts list` (TR_036 Fix 3 alert path observed). TR_022 maxPhaseRetries fired 2/2 correctly. Cycle still blocked, but NOW at the gate's review-agent on a real configuration drift: architecture-agent emits Vitest in success-criteria text on a fully-Jest-aligned project (HARNESS.stack.testFramework: Jest, agents.yaml goal: Jest, package.json: jest). NEW HIGH follow-up: bind framework choice in architecture-agent's output to HARNESS.stack values. **Earlier (TR_038 — TR_037 HIGH follow-up CLOSED)** — two stopgap fixes ahead of the LangGraph architecture-crew migration (ADR-056). **Fix 1**: `renderStackSection(harnessConfig)` helper in `architecture-prompt.ts` injects `HARNESS.stack` into both `buildFeatureArchitecturePrompt` and `buildPhaseArchitecturePrompt`; new architectureGuidance rule on template + trackeros tells the agent to name concrete implementations for every interface. **Fix 2**: new `buildArchitectureReviewPrompt` + `ArchitectureAgent.reviewDesign(draft, feature, projectRoot, harnessConfig, correlationId)` — single-agent self-review pass that re-reads the draft and checks completeness / consistency / ambiguity / feasibility. Returns the original draft on any failure path (loadAgentConfig throw, callLLM throw, parse-to-empty) so the pipeline is never blocked on a review-only error. Orchestrator wires `designFeature → reviewDesign → save` with a STOPGAP comment block telling the next session to delete this when the LangGraph architecture crew lands. New review rule on template + trackeros: "When reviewing a draft architecture: check that every interface or abstraction has a named concrete implementation, all symbol names are consistent, and no implementation choice is left open for a developer to decide." Template `0.22.0 → 0.23.0`. Build clean across all 13 packages. **Verified end-to-end on trackeros feature `d0513f28`**: `reviewDesign` log fires at 14:04:37 (6s after designFeature) with before/after counts logged (5→5 entities + 5→5 modules); Phase 1 persisted architecture now names `PostgresLeaveRepository` as the concrete class, imports `Pool` from `pg`, references `src/shared/db/connection.ts`, includes a SQL schema with CHECK constraints + indices — exactly what TR_037's HIGH NEW follow-up asked for. **Cycle still blocked at intent-agent on a THIRD different ambiguity**: "The intent mentions repository CRUD behavior, but the specified LeaveRepository interface only defines create and findById methods". The architecture-agent legitimately scoped Phase 1 to create+findById (later phases extend), but intent-agent reads "leave management" as implying full CRUD on every repository upfront. **Earlier (TR_037 — symbol-name conflict resolved end-to-end)** — planner-agent now injects architecture-agent's full JSON as a "Canonical type and symbol names" block at the top of its prompt, plus a HARNESS rule telling the planner to use those exact names. Architecture flows from architecture-agent → planner-agent → intent-agent without symbol-name drift. **Verified end-to-end on trackeros feature `ce9d1b80`**: planner-agent emitted Phase 1 scope "Create … defining the **canonical LeaveRequest type** … using the **fields id, employeeId, leaveType, startDate, endDate, and status**" matching architecture-agent's emitted entity verbatim; 5-phase plan (vs prior 7-8) with 4 interfaces + 5 success criteria + SQL schema in Phase 1's per-phase architecture; intent-agent did NOT escalate on a symbol-name conflict. Cycle still blocked at intent-agent, but on a DIFFERENT, more nuanced ambiguity — "The concrete persistence implementation backing LeaveRepository is not specified" — i.e. architecture-agent defined the `LeaveRepository` interface but didn't pin the concrete DB driver. New HIGH follow-up: architecture-agent should specify the concrete persistence implementation (e.g. `pg` Pool) from `HARNESS.stack.database`. Template `0.21.0 → 0.22.0`. Build clean across all 13 packages. **Earlier (TR_036 — gate-side fixes shipped, verification blocked at intent-agent before reaching the gate)** — four fixes against TR_035 verification findings. (Fix 1) Constraint-agent + review-agent rules in HARNESS rewritten to abstract layer-role language ("data access layer", "business logic layer"); concrete `pool.query` / `*.repository.ts` matchers removed. Both verificationGuidance blocks rewritten to "read ARCHITECTURE.md first; a finding is only valid if it violates a rule given the actual structure of this project". (Fix 2) New `buildProjectStructureBrief(projectRoot)` helper in `gate-orchestrator.ts` reads ARCHITECTURE.md (truncated to 2000 chars) + enumerates a depth-2 directory tree under `src/` using Node's `readdir` (equivalent to `find src -maxdepth 2 -type d`, bounded to 30 entries). The brief is set on `GateTask.projectStructureBrief` (new optional field on the type); constraint-agent's `buildVerificationPrompt` injects it before the rules section, llm-review-agent's `buildReviewPrompt` injects it at the top of the prompt. (Fix 3) Planner's `maxPhaseRetries` exhaustion path in `planning-orchestrator.ts` now creates a `feature-blocked` alert + emits `alert.created` SSE — previously it marked the feature `blocked` silently and operators only saw the failure via `gestalt feature show`. (Fix 4) trackeros `agents.yaml` `test-agent.goal` switched Vitest → Jest to align with the rest of the project's already-Jest tooling. Template `0.20.0 → 0.21.0`. Build clean across all 13 packages. **Live verification cycle escalated at intent-agent on a planner/architecture-agent symbol-name inconsistency BEFORE reaching the gate**, so Fixes 1+2 (gate-side) didn't get an LLM-level test; Fix 3's new alert call didn't fire (the cycle escalated via the existing TR_033 `waiting-for-clarification` path which already has its own alert). New HIGH follow-up: cross-check planner-agent vs architecture-agent symbol names. **Earlier (TR_035 — mechanisms 6/8 PASS, feature blocked by orthogonal gate constraint-agent false-positives)** — dynamic five-layer token budget management + phase-evaluator git detection via squash-merge SHA + architecture-agent 12k fallback floor. ADR-057 appended to `docs/DECISIONS.md` before implementing. **Part A**: `BaseLLMAgent` gains a five-layer pipeline on every LLM call. Layer 1 — model-aware defaults (reasoning models `o1`/`o3`/`gpt-5*` get 8k vs 2k standard). Layer 2 — dynamic budget (input × 1.5 for reasoning, × 0.5 standard, clamped by per-model hard limits). Layer 3 — scope reduction with three structural rewrites (`summarisePriorPhaseHistory`, `compressRulesSection`, `trimArchitectureContext`) when estimated input tokens exceed the configurable threshold (default 6000). Layer 4 — JSON response guard (`addJsonResponseGuard()` appended to prompts by the six structured-output agents: architecture-agent's `designFeature`+`designPhase`, planner-agent, phase-evaluator-agent, constraint-agent, review-agent, self-healing-agent). Layer 5 — truncation retry (re-issues the call on `finish_reason: 'length'` with a doubled budget, up to 3 attempts). `LLMResponse` extended with `finishReason`. New `HarnessConfig.tokenManagement` block (`promptCompressionThreshold` / `maxRetryBudgetMultiplier` / `enableDynamicBudget` / `enableScopeReduction`) tunes thresholds per project. Per-call telemetry persisted into `agent_execution_logs.token_management` (JSONB; migration 029). **Part B**: (B1) `architecture-agent.max_tokens` bumped 6k → 12k in trackeros `agents.yaml` as the fallback floor; Layers 2 + 5 handle higher cases. (B2) Phase-evaluator now prefers `git show --name-only --format= <mergeCommitSha>` over `git diff` — the existing `mergePullRequest` already returns the squash-merge SHA, so the promotion-agent's `maybeAutoMerge` now resolves `findPhaseByIntent → updatePhaseMergeCommit(phase.id, sha)` after the merge succeeds. New `FeaturePhaseRecord.mergeCommitSha` column (migration 029) + `FeatureRepository.updatePhaseMergeCommit` (postgres impl + oracle/mssql stubs). `PhaseBranchContext` extended; `evaluator-prompt.ts` prefers `git show` when SHA present, falls back gracefully. HARNESS template + trackeros `phase-evaluator-agent.rules` updated to teach the agent the new command. Template 0.19.0 → 0.20.0. Build: `pnpm -r build` clean across all 13 packages. **Live verification pending** for all 10 parts — needs `gestalt feature submit` cycle on trackeros to observe Layer N firings + `git show` path.

**Earlier (TR_034 — mechanisms verified, autonomous completion not achieved)** — scoped per-phase architecture replaces the full architecture context in the Aider message. `buildAiderMessage` dropped `## Project architecture` and `## Design context` in favor of a `## Scoped architecture for this phase` block built from architecture-agent's `designPhase()` JSON. New `updatePhaseArchitecture` repo method persists the JSON; `aider-code-agent.loadPhaseArchitectureForCycle()` reads it back. Template 0.18.0 → 0.19.0. Verified live on trackeros feature `45fe91b3`: per-phase pass fires, `readFiles` includes real shared/db paths, `messageBytes` 5705 → 2922, Phase 1 deployed via PR #119. **Same TR_033 failure mode persisted**: gpt-5.5 + Aider produced zero source code; architecture-agent's `designPhase` returned empty arrays so the scoped block was empty and dropped — Aider got task + rules + readFiles only. TR_035 Part B1 raises the floor to 12k; TR_035 Layer 4 frames the JSON contract.

**Earlier (TR_033 — partially verified)** — four targeted fixes pushing for full autonomous feature completion. **Verified live on trackeros feature `7ab81ea3`**: Fix 1 (`readFiles` now includes `PLAN.md + package.json + tsconfig.json + cross-language manifests`, existsSync drops Python/Go/Java on the TS project) and Fix 4 (escalation → phase failed + feature blocked + `feature-blocked` alert in one atomic sequence, zero manual cleanup) both confirmed end-to-end. Fix 2 + Fix 3 shipped in template + trackeros HARNESS but not verified live because the feature blocked at Phase 1 before reaching the routes phase. **Feature did NOT reach `completed`** — gpt-5.5 + Aider produced zero source code across 4 attempts (each PR added only `.aider.*` history + `.gestalt/` metadata + DOMAIN.md edits, nothing in `src/`), a new failure mode separate from the TR_028-32 hallucination pattern. Operator-side preflight cost three extra submissions: gpt-5.5 needs `responses` apiShape in `platform_llms` (brief was wrong), `max_tokens: 3000` truncated planner JSON at 74s (reasoning tokens count toward the budget — bumped to 6k/12k/8k/6k), and one transient `TypeError: fetch failed` killed an attempt because `classifyError` treats it as `retryable: false`. **Fix 1**: the base `readFiles` list in `aider-message-builder.ts` expanded from `['PLAN.md']` to also include `package.json` + `tsconfig.json` + `pyproject.toml` + `requirements.txt` + `go.mod` + `pom.xml` + `mypy.ini` + `.eslintrc(.json)`. The `existsSync` filter in `runAider` drops anything not present, so the same list works on TypeScript / Python / Go / Java projects without language-tagging the platform code. **Fix 2**: three language-agnostic rules appended to `agentConfig.code-agent.rules` in the **template** HARNESS — read dependency source before calling methods; read compiler/linter config before generating; read dependency manifest before importing. Examples list multiple ecosystems so the LLM doesn't pattern-match to TypeScript. **Fix 3**: one new rule on `agentConfig.phase-evaluator-agent.rules` in the template — when adjusting a routes/controller phase scope, cite the service/handler file it depends on. Closes the TR_032 Phase 3 root cause (routes scope didn't cite `leave.service.ts`, so `--read` couldn't inject it, so Aider invented method names). **Fix 4**: structural — `AlertType` gains `'feature-blocked'`, and the planning orchestrator's `intent.status-changed` subscriber now treats `waiting-for-clarification` + `escalated` as terminal-failure phase outcomes. New helper `markFeatureBlockedAfterEscalation` marks phase failed + feature blocked + appends `phase-escalated` to the plan log + emits a `feature-blocked` alert in one sequence. Closes the TR_032 gap where stuck intents left features `in-progress` indefinitely. Template 0.17.0 → 0.18.0. **Build**: `pnpm -r build` clean across all 13 packages. **trackeros HARNESS.json revert respected** — operator/linter rolled back the trackeros code-agent + phase-evaluator edits; template rules ship forward but trackeros needs manual operator patching before TR_033 Fix 2 + Fix 3 take effect there. **Live verification pending** for all four fixes.)

**Earlier (TR_032 — verified)** — three targeted Aider compliance fixes (Fix 1 `--read` flag; Fix 2 preservation in `.ts` schema; Fix 3 fix-intent broken-state framing). Template 0.16.0 → 0.17.0. **Verified end-to-end on trackeros 2026-06-09 (feature `fd844f7d`)**: Phase 1 + Phase 2 both deployed cleanly via the full Aider → CI → PR-Agent → gate → squash-merge chain (Phase 2 was the killer phase in TR_028 → TR_031 — first time it shipped). `readFiles` array log line confirms `--read` flag on every Aider invocation. Preservation footer present on both fix-intents. Phase 3 escalated on unrelated TS strict-mode + missing-service-method issues (the root cause TR_033 Fix 1 + Fix 3 target). Cascade brake at depth 2 fired correctly. Wall-clock submission → Phase 3 escalation: ~13 minutes. Detailed report at the prior session entry in `sessions/RECENT.md` (or archived to `sessions/archive/2026-06-w2.md` after rotation).

**Earlier (TR_030 + TR_031)** — combat Aider DTO-drift via Aider-message-builder additions and PLAN.md "What has been built" + context-only fix-intent. TR_030 added two generic behavioural prose blocks to `aider-message-builder.ts` (read-existing-files-before-generating; architecture-context-is-reference-only). TR_031 added a `## Read PLAN.md first` block to the message-builder (later removed by TR_032 Fix 1), extended `PhaseEvaluation` with a `builtFiles` field that the phase-evaluator-agent populates via git diff + readFile, and rewrote the `fixIntent` JSON-schema description in `self-healing-agent.ts` to require CONTEXT not PRESCRIPTION ("CI failed: TS error X. Files involved Y. Analyse and fix" — not "Update Z to add A"). Template 0.15.0 → 0.16.0. **Verified end-to-end on trackeros**: (a) PLAN.md gets a `**What has been built:**` section under each deployed phase listing files + key exports — confirmed on the third verification cycle (clean trackeros main, feature `35fb580e`); (b) fix-intent dispatched text is now context-only on both fix-intents in the cycle — no prescriptive "Update X to add Y" framing; (c) self-healing routes to fix-intent immediately on first CI failure; (d) TR_025 cascade-depth brake fires at depth 2. **Not verified**: Aider still didn't comply with read-before-generate consistently — Phase 2 service code hallucinated `ILeaveRepository` + imported non-existent sibling modules `../balance/`, `../employee/` despite PLAN.md's "What has been built" being on disk. The HARNESS preservation rule didn't reach the dispatched fix-intent text. Aider also inverted negation: fix-intent said "ILeaveRepository does not exist" → Aider created `ILeaveRepository`. **All three findings became TR_032 fixes above.**

**Earlier (TR_029) — added explicit "include prior-phase file paths in scope text" rules to `planner-agent.phaseScopingRules` + `phase-evaluator-agent.rules` to fix the TR_028 Aider DTO-drift blocker. Template 0.14.0 → 0.15.0. **Planner-side change verified end-to-end** — Phase 2's scope on the re-submitted leave-management feature explicitly cites `src/modules/leave/leave.model.ts` + `leave.repository.ts` by full path; Phase 1 correctly bundled model+repository (TR_023 rule honoured). Phase 1 deployed cleanly (PR #88, ~3m). **Aider-side gap surfaced**: even with the scope text explicitly saying "depends on src/modules/leave/leave.model.ts", Aider's Phase 2 service code hallucinated against the deployed Phase 1 files (`ILeaveRepository` vs `LeaveRepository`, `LeaveRequest.leaveType` vs `leaveTypeId`, imports of non-scheduled sibling modules `../balance/`, `../employee/`). 6 Aider runs across 3 phase attempts; self-healing chose pure `retry` every time (not fix-intent). Feature blocked at 1/4 phases. Two new HIGH follow-ups: (1) code-agent prompt must mandate readFile() on every cited path before generating; (2) architecture-agent's high-level module list is leaking into code-agent context and Aider imports from un-scheduled sibling modules.) Last full session report at `docs/claude/TEST_REPORT_028.md`; TR_028 is the prior milestone for end-to-end machinery.

**Earlier (TR_028) — milestone planning-loop re-test on the leave-management feature, verifying every TR_020 through TR_027 mechanism end-to-end in a single 19-min autonomous cycle. Phase 1 (model) deployed cleanly (Aider 5s → CI pass → PR-Agent 27s → verdict `none` → gate (constraint-agent only) → squash-merge, ~2m 44s). Phase 2 (repository) hit the known TR_023 Aider DTO-drift issue: repository code references model fields that don't exist (`leaveType` vs deployed `leaveTypeId`; `totalDays/usedDays/year` vs deployed `balance`). Self-healing's diagnostician correctly chose `action: 'retry'` for the first two cycles, then `action: 'fix-intent'` on the third (systemic gap detected). Fix-intent child dispatched + deployed in ~2m 25s (Aider 4s → CI pass → PR-Agent 24s → deploy → onSuccessDispatch envelope fired → parent resumed). But the fix-intent prompt didn't include a file path; Aider wrote a stray `/leave.model.ts` at repo root that tsc never resolves. Parent Phase 2 resumed → failed → planner retry budget exhausted → feature `blocked` at 1/4 phases. Two NEW HIGH follow-ups: (1) promoted TR_023 — planner must put model+repository in same phase OR code-agent must read existing model first; (2) self-healing fix-intent prompt enrichment — must include the failing import path and existing field shape. Architecture-agent / planner-agent / phase-evaluator-agent / PR-Agent / self-healing fix-intent + onSuccessDispatch / cascade-depth brake / phase retry budget all VERIFIED working as designed. TEST_REPORT_028.md in `docs/claude/`.)
**Repo:** https://github.com/afarahat-lab/gestalt
**Migrations:** 030 (latest: `030_intent_parent_context`)

---

## What is built and verified

### Platform foundations

- All 13 buildable packages compile (`pnpm -r build`).
- `docker-compose up -d` brings server + postgres + redis healthy.
- All 27 migrations apply on first start.
- Server reachable on `http://localhost:3000`; `/health` returns 200;
  protected routes return 401 without a JWT.
- Dashboard SPA served at `/app/*`; shareable deep-link URLs work.
- First-boot bootstrap verified: `gestalt init-admin` → `gestalt login`
  → `/auth/me` returns the user.

### Five SDLC layers (all wired end-to-end)

- **generate** — intent → design → context → lint-config → code → test;
  custom agents in `agents.yaml` interleave via `runs_after`.
- **quality-gate** — constraint-agent (always) + review-agent
  (only on non-github-actions adapters or when `prAgent.enabled`
  is false). ADR-041 — gate runs AFTER CI, not before pr-agent.
  ADR-051 — when `prAgent.enabled && pipeline.adapter ===
  'github-actions'`, the gate skips review-agent because
  PR-Agent already reviewed the PR server-side between CI-pass
  and gate-dispatch. Gate clones the PR branch, checks it out,
  and reads source files directly from the working tree
  (`readFromBranch: true`). On pass dispatches `deploy:promotion`
  (staging); on fail forwards `resumeOnBranch` so the retry leg
  pushes to the same PR. Verdict: `pass` / `fail` (auto-retry) /
  `escalate` (GP_BREACH). Max gate retries: 3. Pre-CI lint/
  security/test-runner stubs deleted — CI uses the project's own
  ESLint / Vitest / Semgrep via the comprehensive `gestalt.yml`
  workflow template.
- **PR-Agent (ADR-051)** — CodiumAI PR-Agent invoked server-side
  by deploy-orchestrator between CI-pass and gate-dispatch as a
  subprocess (`/opt/pr-agent` venv via `pr-agent --pr_url=...
  review`). Receives Gestalt's resolved LLM credentials (Azure /
  OpenAI / Ollama) + project PAT via subprocess env vars for that
  one invocation only — never sees the vault or the registry.
  Posts a "PR Reviewer Guide" comment on the PR. pipeline-agent
  polls verdict via `GitHubActionsAdapter.getPrAgentVerdict` for
  up to 30s; `approved`/`none` → proceed to gate;
  `changes-requested` → invoke self-healing's `fix-intent` path
  via failure type `review-requested-changes` (migration 027).
  `.pr_agent.toml` generated at init time from HARNESS rules
  drives per-project review focus; regeneratable via
  `gestalt project config push-pr-agent-config`. Best-effort
  on subprocess failure (warns + proceeds).
- **deploy** — pr-agent → pipeline-agent → promotion-agent
  (staging → production). `PipelineAdapter` interface;
  `GitHubActionsAdapter` + `NoOpPipelineAdapter` implemented.
  ADR-034 production-requires-staging enforced. Auto-merge supported
  via `pipeline.autoMerge` in HARNESS.json.
- **maintenance** — drift / alignment / gc / evaluation, scheduled via
  `node-cron`. Context-file intents take a direct-fix path via
  context-fixer (path-guarded to `docs/*` + `AGENTS.md`).
  `MonitoringAdapter` (Prometheus / Datadog / NoOp).
- **planning** (migration 024) — three agents (architecture-agent /
  planner-agent / phase-evaluator-agent) drive an autonomous feature
  decomposition loop. Operator submits a feature; orchestrator clones
  the repo, runs architecture-agent for the high-level design, runs
  planner-agent for the phase plan, commits `PLAN.md` + appends to
  `docs/ARCHITECTURE.md`, then dispatches phase 1 as a regular
  `generate:intent`. The in-process event bus subscriber maps each
  phase intent's terminal status (`deployed` / `failed`) into a
  `planning:evaluate` dispatch; phase-evaluator-agent decides whether
  to continue, adjust remaining phases, or escalate. Bounded by
  `HARNESS.json.planner` (`maxPhasesPerFeature`, `maxFilesPerPhase`,
  `architectureReviewPerPhase`). All LLM guidance prose lives in
  `agents.yaml` (`prompt_extensions`) + `HARNESS.json.agentConfig`
  (`rules` / `architectureGuidance` / `phaseScopingRules` /
  `evaluationCriteria`) per ADR-042 — `.ts` carries only structural
  framing + JSON schemas.

### Identity + auth

- Local auth (non-production only, ADR-025).
- Kerberos / SAML / OIDC providers (ADR-024); `auth.config.json`
  primary source, HARNESS.json `identity` block fallback (ADR-040).
- Two-tier role model: platform roles (`platform-admin` | `user`),
  project roles (`project-admin` | `editor` | `reader`).
- Platform groups for bulk assignment (Brief 1, migration 018);
  effective project role = max of direct + group-derived.
- Server-side membership enforcement on every read + write endpoint;
  no-enumeration-leak rule (empty array, not 403).
- Hot-reload of identity providers without server restart
  (`POST /platform/identity/reload`).

### Platform admin surfaces

- **Users** — CRUD + deactivate + self-protection guards.
- **Projects** — platform-admin create / delete (with active-intents
  guard) / list with cross-project enrichment (members / intents /
  last activity).
- **Groups** — CRUD, members, project assignments with role
  precedence.
- **LLM registry** (migration 014) — per-row baseUrl / apiKeyEnv /
  apiShape (`chat-completions` vs `responses` for gpt-5/o1/o3).
- **Secrets vault** (migrations 015+016) — AES-256-GCM encrypted,
  master key at `/etc/gestalt/master.key` or
  `GESTALT_MASTER_KEY` env; rotation tooling (migration 021).
- **Self-healing** (migration 020) — 7 per-failure-type configs;
  diagnostician picks `retryTaskType` + hints; alerts auto-resolve
  at high confidence.
- **Templates** — harness templates table (migration 017) +
  download / duplicate / edit / push / diff (dashboard + CLI).
  Built-in templates read-only; duplicate first to customise.
- **MCP servers** — platform-wide MCP servers (`platform_mcp_servers`).
- **Self-healing** + **identity** dashboard tabs.

### Project lifecycle

- `gestalt init` registers project; server clones repo, generates
  stack config via LLM (`generateStackConfig`), substitutes
  variables into harness template, commits + pushes.
- Phase-1 project description accepts multi-line input via a
  three-mode chooser (single-line default / END-terminated /
  `$EDITOR`). The full body is passed verbatim into
  `generateStackConfig` and into the template's
  `{{projectDescription}}` substitution. Template engine
  JSON-escapes substituted values when the target file is `.json`
  (engine.ts `substitute(..., { jsonEscape: true })`) so newlines
  + quotes + control chars in the description land safely inside
  HARNESS.json string literals; markdown / yaml files keep raw
  newlines.
- Vault-backed Git PATs (migration 022) — operators link a vault
  secret to a project; resolver decrypts server-side per-cycle.
- GitHub repo browser via `/platform/git/repos` proxy.
- Dynamic harness — LLM picks language / framework / package
  manager / test runner at init time.

### Agent infrastructure

- `BaseLLMAgent` in `@gestalt/core/agents` — every LLM-using agent
  in every layer extends it. Captures `lastPrompt` /
  `lastLlmResponse` / `lastModelUsed` / `lastTokensUsed`
  (accumulated across every LLM call inside one `run()`).
- Built-in file tools (ADR-038, migration 012): `readFile`,
  `listDirectory`, `searchFiles`, `getFileTree`. Read-only,
  path-traversal-guarded.
- MCP integration (ADR-039) — external tool servers per-agent in
  `agents.yaml`. Namespace prefix prevents collision with built-ins.
- Per-agent LLM model override + tools.builtin + tools.mcp +
  prompt_extensions, all driven by `agents.yaml` in the project repo.
- Custom agents (ADR-037) — prompt-only LLM runners declared by the
  project; topo-sorted via `runs_after`.
- Section-based prompts (architecture / constraints / scope /
  design / intent / principles / domain / signals / task) — every
  LLM-generating agent opens with non-negotiable rules.

### Observability + operator surfaces

- Per-agent `agent_executions` + `agent_execution_logs` rows
  (migration 007 + 009 + 012) with prompt / response / model /
  tool calls / **tokens used** (BaseLLMAgent's `lastTokensUsed`
  accumulator wired through the generate + gate orchestrators
  on 2026-06-04; deploy + maintenance are non-LLM today).
- Live event bus (`@gestalt/core/events`) → SSE at
  `/events`. Dashboard subscribes for instant updates.
- IntentDetail accordion with prompt + LLM response + tool calls
  + signals + artifacts.
- Active agents card with cycle progress + token totals.
- Deployments view: 4/5-node pipeline timeline (5th node for
  auto-merged cycles).
- Maintenance view: per-run findings expansion panel.
- Alerts: per-type bodies + interventions (ADR-021).
- Pipeline failure alerts with operator feedback → resume on the
  same branch (migration 019).
- Operator-driven CLI parity: `gestalt run --watch` /
  `gestalt intent / gate / deploy / agents active /
  maintenance / status --graph --watch`.

### CLI

- Bootstrap: `init-admin`, `login`, `init`, `run`, `status`, `logs`.
- Project: `projects list/use/set-adapter/update-token`;
  `project config show/set-agent/set-pipeline/add-custom-agent/...`
- Alerts: `alerts list/show/fix/dismiss/resume/abort/acknowledge/
  pipeline-feedback`.
- Platform admin (gated to platform-admin): `users`,
  `platform llms / secrets / projects / templates / mcp /
  tools / identity / groups / self-healing`.
- Intent: `intent list/show/submit` with `--watch` + filters
  (`--source`, `--priority`, `--search`, `--from`, `--to`).
- Templates push + diff (added 2026-06-04).
- Shared multi-line prompt helpers in `@gestalt/cli/ui/prompts`:
  `promptMultiline` / `promptWithEditor` /
  `promptMultilineDescription`. Used by `gestalt init` (Phase 1
  description) and `gestalt project config add-custom-agent`
  (prompt body). Backwards-compatible single-line default.

---

## Implemented with caveats

- **Quality-gate** — ADR-041 (TR_018): pre-CI lint / security /
  test-runner stubs were deleted. Gate now runs `constraint-agent`
  + `review-agent` AFTER CI passes, reading source files directly
  from the PR branch. CI owns lint / unit-tests / security scan
  via the project's own tooling.
- **Deploy** — `GitHubActionsAdapter` + `NoOpPipelineAdapter` are
  the only implementations. Azure DevOps / GitLab CI / Jenkins
  are typed stubs in the `PipelineAdapterType` union.
- **Maintenance** — `Prometheus` / `Datadog` `MonitoringAdapter`
  implementations exist but aren't yet verified against a real
  monitoring instance. NoOp is the verified path.
- **Identity** — Local + OIDC verified end-to-end via the
  Keycloak fixture. SAML compiles + the route shape is verified
  but full end-to-end against a real IdP only exercised once.
  Kerberos provider compiles; not exercised end-to-end (needs a
  real AD + krb5.keytab).
- **test-agent skip (ADR-043)** — when Aider mode is enabled,
  test-agent is skipped because Aider generates tests inline
  with implementation. Aider's tests are sufficient to pass CI.
  The skip is intentional. The gap: Aider writes opportunistic
  tests, not comprehensive coverage. Qodo Gen (ADR-053) will
  replace test-agent with a purpose-built test generation pass
  after Aider completes. Until Qodo Gen is integrated, test
  coverage quality depends on Aider's judgment.

---

## What is not yet built

- `@gestalt/adapter-oracle` — every repository method throws.
- `@gestalt/adapter-mssql` — every repository method throws.
- `@gestalt/registry` — types + client only; no server, no UI.
- Non-GitHub `PipelineAdapter` impls (Azure DevOps / GitLab CI /
  Jenkins).
- GitLab / Azure DevOps / Bitbucket support in
  `/platform/git/repos` (GitHub only today).
- LDAP group lookup for Kerberos identities (Kerberos tickets
  carry user only; groups need AD query).

---

## Active follow-ups (small)

### TR_056 Part 2c — live smoke pass→promotion via graph (pending)

2c shipped at `abadda6` — `handleGateTask` is now a thin invoker
that calls `runGateGraph({mode:'start'})`; pass-branch dispatch
fires `deploy:promotion` / `deploy:pr` from inside the graph
(log line: `dispatched deploy:promotion (staging) via graph`);
escalate-branch `humanFeedbackNode` no longer interrupts (logs +
returns `{}` so the graph terminates at END — alerts are already
in place upstream). Legacy `legacyHandleGateTask` +
`dispatchPromotion` / `dispatchDeployPR` / `maybeDispatchRetry` /
`attemptSelfHealingForGate` / `createBreachAlert` all preserved
for a one-line revert; deletion is 2d.

`pnpm -r build` clean across all 13 packages.

**Live smoke INCOMPLETE.** Submitted feature `ad1a210b` on
trackeros, but pr-agent's git clone hit a transient SSL flake
(`curl 56 OpenSSL SSL_read: unexpected eof while reading`) →
deploy job stalled past `lockDuration: 600000` → self-healing
dispatched another `deploy:pr` which also stalled → planner
auto-retried Phase 1 as a fresh intent. After ~95 min wall-clock
no `gate:review` task had been dispatched. The failure pattern
is upstream of the gate worker (same class as STATE.md TR_033
`TypeError: fetch failed`); 2c's routing change is correct by
construction (only path from `startGateWorker → handleGateTask`
is `runGateGraph`; legacy helpers unreachable from the worker)
but Redis-confirmed proof remains pending.

**Action — on the next clean feature submission**, verify on
the gate-task dispatch:

- log line `Quality gate received task — invoking GateGraph`
  with `routedBy: gate-graph (TR_056 Part 2c)` fires;
- log line `Invoking GateGraph` + `gateNode started` fire;
- on pass: log line `gateNode pass (post-CI) — dispatched
  deploy:promotion (staging) via graph` fires;
- on pass: legacy log line `Gate pass (post-CI) — dispatched
  deploy:promotion (staging)` (WITHOUT `via graph`) does NOT
  fire (proof legacy `dispatchPromotion` is silent);
- Redis `gestalt-deploy:waiting` contains the deploy task
  matching the intent's correlationId.

When confirmed, mark 2c done and proceed to 2d (delete the
legacy body + five helpers).

### TR_035 — Dynamic token budget management (ADR-057)

Five-layer pipeline added to `BaseLLMAgent.callLLMWithMessages`
(and `runToolLoop` for Layers 1+2): model-aware defaults,
dynamic budget, scope reduction with three structural rewrites,
JSON guard, truncation retry. Knobs in
`HARNESS.json.tokenManagement` — absent → all five layers run
with baked-in defaults. Telemetry in
`agent_execution_logs.token_management` (migration 029).
`architecture-agent` bumped to 12k as fallback floor.
Phase-evaluator now reads files via `git show <mergeCommitSha>`
when present; `feature_phases.merge_commit_sha` populated by
the promotion-agent post-merge. Template 0.19.0 → 0.20.0.
**Live verification pending** — runtime telemetry to confirm
each layer fires as designed.

### TR_030 + TR_031 — Combat Aider DTO drift (in-flight)

**TR_030**: added two generic prose instructions to
`aider-message-builder.ts` — read-existing-files-before-
generating + architecture-context-is-reference-only.
Platform mechanic, no HARNESS change, no migration.

**TR_031**: added a `## Read PLAN.md first` section to the
message-builder; extended `PhaseEvaluation` with `builtFiles`
(populated by phase-evaluator-agent via git diff + readFile);
rewrote the `fixIntent` JSON-schema description in
`self-healing-agent.ts` to require CONTEXT-only fix-intent
text (no prescriptive "Update X to add Y"). Added a HARNESS
preservation-rule bullet for self-healing-agent. Template
0.15.0 → 0.16.0.

**Verified end-to-end** on a clean trackeros main: PLAN.md's
"What has been built" section populates correctly; fix-intent
text is now context-only; self-healing routes to fix-intent
immediately on first CI failure; TR_025 cascade brake fires
at depth 2.

**Not verified**: Aider compliance with the read-before-
generate prose. Phase 2 still hallucinated `ILeaveRepository`
and imported non-existent sibling modules. The HARNESS
preservation rule didn't reach the dispatched fix-intent
text (the LLM didn't append the preservation footer). Two
new HIGH follow-ups in the carryover bullets list.

### TR_029 — Planner+evaluator prior-phase path rules (HARNESS only)

Two `phaseScopingRules` items and one `phase-evaluator-agent`
rule added to mandate explicit prior-phase file paths in scope
text. Template 0.14.0 → 0.15.0. **Planner-side verified
end-to-end** on the re-submitted leave-management feature:
PLAN.md `Phase 2` cites `src/modules/leave/leave.model.ts` +
`leave.repository.ts` by full path; Phase 1 correctly bundled
model+repository (TR_023 rule honoured this time); Phase 1
deployed in ~3 minutes through Aider → CI → PR-Agent → gate
(PR #88). **Aider-side gap surfaced**: even with the scope text
explicitly saying "depends on src/modules/leave/leave.model.ts",
Aider hallucinated `ILeaveRepository` (vs `LeaveRepository`),
`LeaveRequest.leaveType` (vs `leaveTypeId`), and imports from
non-scheduled `../balance/` `../employee/` modules. 6 Aider runs
× 3 phase attempts; self-healing chose `retry` every time; feature
blocked at 1/4 phases. The fix in this session is partial; the
deeper fix is in the new HIGH follow-ups below (code-agent prompt
+ architecture-agent context scoping).

### TR_028 — Full planning-loop re-test (TEST_REPORT_028.md)

Milestone test on the leave-management feature. Every TR_020
through TR_027 platform mechanism verified working end-to-end
in a single 19-minute autonomous cycle. Phase 1 deployed
cleanly through architecture-agent → planner-agent → PLAN.md
commit → Aider → CI → PR-Agent → gate (constraint-agent only,
ADR-051 skip) → promotion. Phase 2 hit the known TR_023 Aider
DTO-drift; self-healing's diagnostician routed retry → retry →
**fix-intent** as designed; fix-intent child deployed in
~2m 25s with `onSuccessDispatch` envelope resuming the parent;
but the fix-intent prompt lacked path specificity so Aider
landed a stray repo-root file. Feature blocked at 1/4 phases.
Full report at `docs/claude/TEST_REPORT_028.md`.

### TR_027 — PR-Agent replaces review-agent (ADR-051)

CodiumAI PR-Agent invoked server-side via `executeScript` after CI
passes; replaces Gestalt's custom review-agent on the github-actions
adapter. No CI step, no webhook, no GitHub Secrets for LLM keys —
credentials forwarded per invocation via subprocess env vars.
PR-Agent runs in `/opt/pr-agent` venv (isolated from Aider's
`/opt/aider` because of incompatible litellm versions);
`/usr/local/bin/pr-agent` is a shell shim. Verdict polled via
GitHub PR-Reviews/Comments API; `changes-requested` routes through
self-healing's `fix-intent` mechanism (new failure type
`review-requested-changes`, migration 027). `.pr_agent.toml`
generated from HARNESS rules at init time. New
`gestalt project config push-pr-agent-config` for harness updates.
Gate orchestrator skips review-agent under prAgent.enabled +
github-actions; constraint-agent still runs. llm-review-agent.ts
`@deprecated` (kept for non-GH adapters). Template 0.12.0 →
0.14.0. Live verified on trackeros PR #81: Aider 6s → CI pass →
PR-Agent 23.5s → verdict `none` → gate (constraint-agent only) →
deploy. Wall-clock 2m 04s.

### TR_026 — Remove platform file-change detection (ADR-050 enforcement)

The platform no longer parses Aider's stdout or computes
file-change diffs. Agents discover changes via git.

- **AiderAdapter**: `parseAiderChangedFiles` deleted,
  `filesChanged` removed from `AiderResult`, `--yes` →
  `--yes-always`.
- **AiderCodeAgent**: new `discoverAiderWrites` helper runs
  `git status --porcelain` in the Aider work-dir and emits
  the changed files as code artifacts. The AGENT calls git
  (per ADR-050); the platform never interprets natural
  language.
- **Phase-evaluator-agent**: signature changed to take
  `branchContext: { defaultBranch, phaseBranch }`; prompt
  rewritten to instruct the agent to run `git diff` via
  executeScript; switched to `callLLMWithTools` so the
  tool-use loop runs.
- **PER_ROLE_DEFAULTS** extended with architecture-agent /
  planner-agent / phase-evaluator-agent so executeScript is
  available out of the box for the planning layer.
- **HARNESS.json + agents.yaml** updated on template +
  trackeros with the new git-diff-only rules.

**Live verified**: feature `7d77f659` — Aider's writes
(`leave.model.ts` + test) now make it into the PR commit
end-to-end. Phase-evaluator's verdict text quotes the
HARNESS.json git-diff rule, confirming the agent followed
the new path. Full feature completion still blocked by
trackeros's stale `leave.repository.ts` from earlier cycles.

### TR_025 — Cascade-depth brake + phase-evaluator file-list (RESOLVED structurally by TR_026)

The TR_025 file-list logic was platform code interpreting git
output — TR_026 deleted it and gave the work to the agent.
The cascade-depth brake (`MAX_FIX_INTENT_DEPTH = 2`) stays
in `self-healing-loop.ts`.

### TR_024 — Autonomous systemic gap detection (migration 026)

Self-healing diagnostician extended with `action: 'retry' |
'fix-intent' | 'escalate'`. When the LLM picks `fix-intent` it
writes a complete Aider-ready intent text; the platform submits
it as a separate `source: 'self-healing-fix'` cycle, links via
`parent_intent_id`, and persists an `on_success_dispatch`
envelope. After production promotion, the deploy-orchestrator
dispatches the envelope verbatim to resume the parent.
ADR-050 — the `action` field is the SOLE routing decision; no
hardcoded failure-pattern matching anywhere. Live verified on
trackeros with a prom-client missing-dependency intent —
self-healing correctly chose `fix-intent` and submitted a child
intent. Template 0.10.0 → 0.11.0.

### PLANNING_LAYER — Autonomous feature decomposition (migration 024)

New `@gestalt/agents-planning` package + `planning:start` / `planning:phase`
/ `planning:evaluate` task types on a new `gestalt-planning` BullMQ
queue. Three new agent roles (architecture-agent / planner-agent /
phase-evaluator-agent), three new postgres tables (features /
feature_phases / feature_plan_log), `POST /features` route, and
`gestalt feature submit/list/show` CLI commands. The orchestrator
loop: clone repo → architecture-agent → planner-agent → write
PLAN.md → commit + push → dispatch phase 1 as `generate:intent` →
event-bus subscriber catches terminal status → planning:evaluate
→ phase-evaluator-agent → either next phase, mark feature
completed, or block. Strict ADR-042 compliance — every guidance
prose string lives in `agents.yaml.prompt_extensions` or
`HARNESS.json.agentConfig[role]` (`rules` / `architectureGuidance`
/ `phaseScopingRules` / `evaluationCriteria`); only structural
framing + JSON schemas live in `packages/agents/planning/src/prompts/`.
Live verified on trackeros: feature `ea19b18e` ran the full loop
end-to-end against real GitHub Actions CI (CI failed due to a
pre-existing code-agent issue; the planning loop correctly marked
the phase failed and the feature blocked). Template bumped
0.7.0 → 0.8.0.

### Historical (TR_020 / TR_021)

Rotated to `sessions/archive/`. TR_020 was trackeros's first
clean `Status: ✓ deployed` on the real `github-actions` adapter
(PR #54, 1m 58s). TR_021 externalised verificationGuidance to
HARNESS.json. See `docs/claude/TEST_REPORT_020.md` and the
archive for the full diffs.

### Active follow-ups (carryover or NEW)

- **(HIGH — NEW from TR_031)** Move the preservation
  requirement from the HARNESS `self-healing-agent.rules`
  bullet into the `fixIntent` JSON-schema description in
  `buildDiagnosisPrompt`. The HARNESS rule was added in
  TR_031 but the diagnostician LLM didn't honour it in
  two consecutive fix-intent dispatches — neither ended
  with the preservation footer. Schema-string guidance
  reliably influences output; HARNESS bullets are advisory.
- **(HIGH — NEW from TR_031)** Pass `--read PLAN.md` and
  `--read <every-scope-cited-path>` to Aider's CLI
  invocation. Forcing a file into Aider's context window
  is dramatically stronger than a prose "please read this
  first" instruction. TR_030's read-before-generate
  instruction is in the prompt; TR_031's PLAN.md "What
  has been built" is on disk; Aider still hallucinates
  symbol names.
- **(MEDIUM — NEW from TR_031)** Stale-file pollution on
  trackeros main. When a feature is blocked, files from
  deployed phases stay on main. The next cycle's Aider
  reads them as ground truth and tries to compose around
  them, introducing new conflicts. Options: (a) a
  `gestalt feature reset` command that un-merges deployed
  phases; (b) PLAN.md tracks "files owned by this feature"
  and a cleanup-on-block step git-rms them.
- **(MEDIUM — NEW from TR_031)** Phase-evaluator-agent
  hallucinated `verdict: escalate` with `toolCallCount: 0`
  on the first verification cycle. The `callLLMWithTools`
  loop should reject responses where the agent's JSON
  claims tool-derived evidence ("confirmed by git diff")
  but the model didn't invoke any tools.
- **(MEDIUM — NEW from TR_030/TR_031)** Aider doesn't
  reliably parse negated assertions. Fix-intent text said
  "X does not exist" — Aider created X. The diagnostician's
  prompt should be framed as POSITIVE assertions ("Use
  `LeaveRepository` which exists at `src/modules/leave/
  leave.repository.ts`") rather than negations.
- **(LOW — NEW from TR_031)** Phase-branch is deleted on
  squash-merge before phase-evaluator runs against it.
  `git diff origin/<default>...origin/<phaseBranch>`
  returns empty when the branch is gone. Pass the merge
  SHA in `branchContext` instead.
- **(HIGH — NEW from TR_029)** Aider code-agent prompt must
  mandate `readFile()` on every path mentioned in the phase
  scope BEFORE generating any code. TR_029 verified the
  planner now emits prior-phase paths verbatim ("This phase
  depends on src/modules/leave/leave.model.ts"), but Aider
  receives this text and proceeds to generate without
  reading the cited files. Result: hallucinated symbol names
  (`ILeaveRepository` vs deployed `LeaveRepository`) and field
  names (`leaveType` vs deployed `leaveTypeId`). Options:
  (a) extend HARNESS `code-agent.rules` with a "Before
  writing any code, call readFile on every path mentioned
  under 'Depends on:' in the scope" rule; (b) pre-fetch
  cited-path contents and inline them in the code-agent
  prompt assembler; (c) use Aider's `--read` flag for
  explicit file-list injection.
- **(HIGH — NEW from TR_029)** Architecture-agent's
  high-level module list ("Modules: leave / balance /
  policy / employee — each owns these files...") leaks into
  Phase N's code-agent context. Aider treats it as ground
  truth and tries to import from sibling modules the
  planner never scheduled (e.g. `../balance/balance.model`,
  `../employee/employee.model`). Either (a) scope the
  code-agent context strictly to the planner's phase
  description (exclude architecture-agent's broader output),
  or (b) the planner's scope text must explicitly say "DO
  NOT import from modules outside this phase's file list".
- **(MEDIUM — NEW from TR_029)** Self-healing's `retry` vs
  `fix-intent` routing decision is opaque to operators. In
  TR_028 the diagnostician chose `fix-intent` for an Aider-
  quality failure; in TR_029 it chose `retry` every time on
  a similar failure pattern. Decision is LLM-driven
  (ADR-050) so variance is expected, but the `technicalDetail`
  field populated by `collectCiTechnicalDetail` should be
  surfaced on the alert page so operators can see the
  diagnostician's reasoning chain.
- **(HIGH — NEW from TR_028, promotes TR_023)** Planner must
  reliably put `model + repository` in the same phase, OR
  code-agent prompt must mandate "READ the imported model
  file before writing the repository". Partially addressed
  by TR_029 — the planner now bundles model+repo, but
  Aider still doesn't read the model when writing the
  service in the next phase. The "READ the imported model"
  half of this item is now the TR_029 follow-up above.
- **(HIGH — NEW from TR_028)** Self-healing fix-intent prompt
  enrichment. When the diagnostician chooses `fix-intent` it
  should include the exact failing import path + the deployed
  model's actual field shape in the child intent text. TR_028's
  fix-intent dispatched a "Define type X with properties A, B,
  C" prompt without saying WHERE to put the file. Aider wrote
  a stray `/leave.model.ts` at repo root that tsc never
  resolves, so the resumed parent failed identically.
- **(MEDIUM — NEW from TR_028)** Phase-evaluator's `partial`
  verdict + scope adjustments work — PLAN.md gets updated —
  but the adjustments don't feed back into the planner's
  "phase grouping" decisions. If the evaluator notices "Phase
  1 only created the model, repository still needed", it
  could merge model+repository into one phase rather than
  annotating the next.
- **(LOW — NEW from TR_028)** The fix-intent flow logs "Fix
  deployed — resuming original intent via onSuccessDispatch"
  but doesn't emit a clear "parent resumed → Aider running"
  message at the resume point. Operators see two `Running
  Aider` log lines back-to-back and have to correlate by
  intent ID.
- **(HIGH — NEW from TR_026/TR_027)** Stale repository files
  on trackeros main keep returning from earlier auto-merged
  Phase 1 cycles. Either planner must reliably put model+
  repository in the same phase (TR_023's rule enforced),
  or self-healing-agent needs to recognise "TS error in
  file Aider didn't write this cycle = systemic gap" and
  choose fix-intent. Today every cycle on trackeros loops
  in this state.
- **~~(HIGH — TR_025/TR_026)~~ RESOLVED by TR_026.** Aider's
  "Files changed: 0" silent failure — now caught by git
  status in `discoverAiderWrites`. The Aider stdout
  pathology is bypassed entirely.
- **(LOW — TR_027)** PR-Agent verdict-poll budget (30s, 6×5s)
  is fixed in code; could be threaded into HARNESS.json's
  `prAgent.pendingTimeoutSeconds` (field already exists in the
  type).
- **(LOW — TR_027)** `chat-latest` works as a litellm model
  alias because OpenAI resolves it at the API edge. Other
  providers (Anthropic, Ollama) need their own alias semantics —
  document as a known constraint of per-project LLM choice.
- **(MEDIUM — TR_025)** Cascade-depth brake escalation path
  (MAX_FIX_INTENT_DEPTH) only verified at build/typecheck; a
  targeted force-fail-twice test would close it.
- **(MEDIUM — TR_024)** `collectCiTechnicalDetail` is GH-only.
  Azure DevOps / GitLab adapters silently lose the actual error
  text.
- **(LOW — TR_024)** Dashboard could render the full fix-intent
  chain on IntentDetail (today: direct parent/child only).
- **(HIGH — TR_022)** Aider DTO-field hallucination — generated
  code references fields not present on the DTO. Either extend
  code-agent prompt with a "READ the DTO file first" rule or
  require model + repository in the same Aider call. Tracked as
  TR_023.
- **(LOW — TR_022)** `readMaxPhaseRetries` re-clones HARNESS.json
  on every failure dispatch; cacheable per-feature.
- **(LOW — PLANNING_LAYER)** Phase scope adjustments stored under
  `feature_phases.result.pendingScopeAdjustment`. Consider a
  dedicated `scope_history` array if operators need full history.
- **(LOW — TR_021)** Consider migrating `consistencySection`
  cross-artifact checks out of `llm-review-agent.ts` into
  HARNESS.json verificationGuidance (borderline platform-mechanic).
- **(MEDIUM — TR_019)** `gestalt init` should scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest with TypeScript.
- **(LOW — TR_019)** Template `{{ciSetupSteps}}` for Node/npm
  should add `--legacy-peer-deps` until the upstream npm
  arborist bug is fixed.
- **(LOW — TR_019)** Add a `tsc --noEmit` sanity check on
  scaffolded tests in `gestalt init`.

### Carryovers (TR_018 / TR_014)

- **(HIGH — TR_018)** Restore TR_010 mandatory `executeScript tsc
  --noEmit` code-agent rule on trackeros's HARNESS.json. Pre-emit
  during Aider's generation (CI catches the same post-hoc).
- **(MEDIUM — TR_014)** Aider token-spend visibility. Parse
  `Tokens: N sent / M received` from stdout. code-agent rows
  still show 0 tokens.

### Tool integration roadmap

These integrations are agreed and recorded here so future
Claude Code sessions know the intent. Implement in priority order
after current work stabilises.

**Priority 1 — Qodo Gen (test generation)**
Replace the custom test-agent with Qodo Gen (by CodiumAI,
same vendor as PR-Agent). Qodo Gen analyses generated code
and produces comprehensive unit tests, mocks, and edge cases.
Supports local models via Ollama/vLLM — compatible with
enterprise data residency requirements.
Integration path: run via executeScript after Aider generates
implementation files. Same pattern as Aider integration.
ADR candidate: "Qodo Gen replaces test-agent in generate layer"
(ADR-053 — Accepted, pending implementation).

**Priority 2 — SWE-agent (bug fixing)**
Princeton's autonomous bug-fixing agent. Given a bug report,
it reproduces the error, writes a failing test, fixes the code,
and verifies the fix. Complement to Gestalt's maintenance layer.
Integration path: dispatch SWE-agent for bug-fix MaintenanceIntents
instead of Aider. Fix still goes through Gestalt CI + gate pipeline.
Prerequisite: verify self-hosted support for Azure OpenAI / Ollama backends.
ADR candidate: "SWE-agent handles bug-fix maintenance intents"
(ADR-054 — Accepted, pending implementation).

**Priority 3 — K8sGPT (Kubernetes operations layer)**
CNCF project that scans Kubernetes clusters, diagnoses failing
pods, crash loops, and misconfigured ingress in plain English.
Native support for Ollama and LocalAI — cluster telemetry
never leaves the infrastructure. Directly addresses enterprise
operations teams in the GCC/MENA target market.
Integration path: K8sGPT webhook → Gestalt maintenance layer
webhook endpoint → MaintenanceIntent → Aider fixes K8s manifests
→ CI validates → deploys.
Requires: new Kubernetes operations layer in the platform.
ADR candidate: "K8sGPT feeds Gestalt Kubernetes operations layer"
(ADR-055 — Accepted, pending implementation).

**Deferred — Sourcegraph (code search for drift-agent)**
Self-hosted code intelligence platform with MCP server.
Intended to replace executeScript/ripgrep for drift-agent
and alignment-agent when codebase scale demands it.
Integration path: add Sourcegraph service to docker-compose.yml,
register MCP server in platform_mcp_servers, give drift-agent
and alignment-agent access via agents.yaml.
Prerequisite: current executeScript/ast-grep approach is
sufficient at trackeros scale. Revisit when project codebases
exceed ~100 files.
ADR candidate: "Sourcegraph provides semantic code search for maintenance agents"

**Ruled out — Bloop.ai**
BloopAI/bloop repository archived January 2, 2025. Company
pivoted to a different product. Do not use.

**Ruled out — OpenHands (formerly OpenDevin)**
General-purpose autonomous agent — competitor to Gestalt's
planning layer, not a complement. Lacks governance, quality
gate, audit trails, and enterprise identity integration.

**Ruled out (for now) — GitHub Spec Kit**
Not self-hostable — blocked for GCC/MENA enterprise customers
with data residency requirements. Revisit if self-hosted option
becomes available.

### Architecture follow-ups (all LOW unless marked)

Pruned to top items; see `sessions/archive/` for the full
historical list.

- Retry cycle full re-runs all generate agents — skip
  intent/design/context when artifacts in Git tip.
- `qualityGate.maxRetries` + `planner.maxPhasesPerFeature`
  hardcoded fallbacks (3 / 10) — wire through HARNESS reads
  for projects that override.
- Promotion workflow dispatches against hardcoded `'main'` ref.
  Projects on `master` / `trunk` will fail.
- No proactive PAT-scope validation at registration.
- Encrypt Git PATs at rest in legacy `project_git_credentials`.
- LLM model name not validated at startup.
- (MEDIUM, TR_004) test-agent punts on method coverage.

### Product backlog

Forward-looking product work — items that change platform UX
or surface area beyond bug-fixes and Aider-quality follow-ups.
Grouped by surface (Dashboard, CLI, etc).

#### Dashboard

#### HIGH — Dashboard: feature/intent tracking redesign

The current dashboard tracking is agent-centric and hard to
interpret. Required redesign keeps agents visible but makes
them expandable with a full execution trace.

**Feature view:**
- Feature card shows: title, description, overall status,
  phase progress (e.g. "3 of 5 phases deployed")
- Expanding a feature shows phases in order
- Each phase shows: status, PR link, deploy time, files created
- Phase in progress shows live agent activity
- Files accessible from phase: PLAN.md, phase scope,
  architecture, phase result — readable in dashboard

**Intent/phase detail view — agent tree with execution trace:**
- Starts with the input (what was submitted)
- Shows agents in execution order as an expandable list
- Each agent row shows: name, status (running/complete/
  skipped/failed), duration, token count
- Expanding an agent shows its full execution trace,
  sorted by time:
  - Prompt sent to LLM (rendered as readable text,
    with option to view raw)
  - Each tool call: tool name, input, output, duration
  - LLM response: rendered as readable narrative,
    with option to expand to raw JSON
  - Decisions made: what the LLM decided and why
    (extracted from the response)
  - Artifacts created: files written, signals emitted
  - Self-healing actions: what failed, what the
    diagnostician decided, what fix-intent was submitted,
    what happened to it — fully audited and visible

**Readable format principle:**
- LLM output rendered as formatted text by default
- "View raw JSON" toggle available on every LLM response
- "View file" link on every artifact reference
- Tool call inputs/outputs collapsed by default,
  expandable inline

**Alerts redesign (aligned with above):**
- Full failure trace: which agent, which step, what error
- LLM RCA and recommendations visible inline
- Self-healing action audit: what was diagnosed, what
  action was taken, what the outcome was
- Links to relevant files directly from the alert
- "What do I need to do" section when human action required

#### LOW — Dashboard: agents view as interactive tree

Replace the current flat agents card with a hierarchical
tree view showing all available agents organised by layer:

```
Platform agents
├── Planning layer
│   ├── architecture-agent     ● active — feature ea19b18e
│   ├── planner-agent          ○ idle
│   └── phase-evaluator-agent  ○ idle
├── Generate layer
│   ├── intent-agent           ○ idle
│   ├── design-agent           ○ idle
│   ├── context-agent          ○ idle
│   ├── code-agent (Aider)     ● active — intent 3a114a1d
│   └── test-agent             ○ skipped (Aider mode)
├── Gate layer
│   ├── constraint-agent       ○ idle
│   └── review-agent           ○ deprecated (PR-Agent active)
├── Deploy layer
│   ├── pr-agent               ○ idle
│   ├── pipeline-agent         ○ idle
│   └── promotion-agent        ○ idle
├── Maintenance layer
│   ├── drift-agent            ○ idle
│   ├── alignment-agent        ○ idle
│   ├── gc-agent               ○ idle
│   └── evaluation-agent       ○ idle
└── Self-healing
    └── self-healing-agent     ○ idle
```

Behaviour:
- Active agents show a live indicator (●) with the intent
  or feature ID they are currently processing
- Hovering over an active agent opens a small popover with:
  current step, tokens used so far, elapsed time, and
  the intent text (truncated)
- Clicking an active agent navigates to the IntentDetail
  view for the intent it is processing
- Idle agents show (○) — clicking shows the agent's last
  execution (most recent IntentDetail that used this agent)
- Skipped/deprecated agents shown in muted style with reason
- Custom agents (from agents.yaml) appear under their
  respective layer with a "custom" badge
- Tree state persists across navigation (collapsed/expanded)
- Updates in real time via SSE — no polling needed

This replaces the current "Active agents" card on the
dashboard home and the flat agent list in the agents tab.

#### Platform

#### HIGH — Planning layer intent-agent retry loop

When intent-agent detects a high-impact ambiguity
(CONTEXT_GAP signal), the planning orchestrator should
attempt autonomous resolution before escalating to human.

Current behaviour: intent-agent blocks → feature escalates
→ human must diagnose and fix HARNESS.json or platform code.

Required behaviour:

```
Planning orchestrator
  → architecture-agent → reviewDesign
  → planner-agent
  → intent-agent validates
    → PASS → dispatch to generate
    → CONTEXT_GAP → architecture-agent retry with gap context
      → reviewDesign again
      → intent-agent re-validates
        → PASS → dispatch
        → still blocked after maxIntentRetries → escalate
```

Why the planning orchestrator handles this (not self-healing):
- Planning orchestrator already has full context: feature
  architecture, phase plan, specific intent, CONTEXT_GAP
  signal. Self-healing would need to reconstruct all of this.
- The fix is architectural — architecture-agent is the right
  agent to address design-time specification gaps.
  Self-healing is designed for runtime failures (CI, gate,
  deploy), not design-time specification gaps.
- Aligns with LangGraph migration (AGENT_TEAMS.md) — in the
  graph-of-graphs design, intent-agent failure routes back
  to the ArchitectureGraph, exactly this Option B pattern.

Implementation:
- Intent-agent emits structured CONTEXT_GAP signal with
  exact ambiguity description
- Planning orchestrator catches CONTEXT_GAP before escalating
- Architecture-agent called again with gap as additional context:
  "The intent-agent found this ambiguity — address it"
- Architecture goes through reviewDesign and reviewPhaseDesign
- Intent-agent re-evaluates
- If still blocked after maxIntentRetries → escalate to human

New HARNESS.json config:
```json
"planner": {
  "maxIntentRetries": 2
}
```

Evidence from TR_036 to TR_047: all 9 intent-agent rigor
bars were design-time specification gaps that the
architecture-agent could have resolved autonomously with
the gap description as context. This loop would have
handled them without human intervention.

Prerequisites:
- feature `completed` milestone must be reached first
- Implement before LangGraph migration since it maps
  cleanly to ArchitectureGraph retry edges in LangGraph

#### MEDIUM — Per-project documentation emission (generated-from-source, folded into the generate pipeline)

Capability: Gestalt produces the full documentation set for
every project it builds — internal (architecture, golden
principles, plan — partly produced today), generated-from-
source (API reference from routes/handlers, DB schema from
migrations, config reference), and external (README +
usage/operator guide, narrative authored by an agent).

Approach — DECIDED: option (B), folded into the existing
pipeline. Doc emission is a responsibility of the generate /
architecture phases — each phase emits or updates docs for
what it built, and docs ship in the same PR as the code.
NOT a separate trailing documentation-agent. Rationale:
same Option-A / ADR-058 logic — a separate doc pass rebuilds
a drift seam (doc-agent's view vs. actual code); folding
emission into the phase that owns the change keeps one
source of truth and ships docs atomically with code, so docs
cannot lag.

Two governing rules:
1. Generate-from-source wherever the surface is mechanical
   (API, schema, config) so it can't drift.
2. Hand-author (by agent) only intent / usage / onboarding —
   the discriminator is "does this doc say something the
   source doesn't?"

Builds on existing: extends ADR-046 (architecture-agent
already updates ARCHITECTURE.md) and ADR-018 (maintenance
changes flow through the generate loop).

🔴 Prerequisite / sequencing: do NOT build until the first
feature reaches `completed`. This adds a responsibility to
the exact generate / architecture phases currently mid-
LangGraph-conversion (TR_056) — build it after one clean
end-to-end loop is proven, not during the conversion arc.

ADR candidate: "Gestalt emits per-project documentation as
a phase responsibility, generated-from-source (folded into
generate, not a separate doc-agent)" — Accepted-in-principle,
pending implementation, gated on the first `completed`
milestone.

#### LOW — Gestalt's own operator guide (platform-facing, separate from per-project docs)

`docs/guides/` exists but is stale (pre-DeepInfra / pre-
LangGraph era); audit and refresh, and generate CLI / config
references from source. Separate item, separate audience
(operators of Gestalt itself, not project consumers). LOW
until a second operator needs it. Do NOT merge with the
per-project documentation emission item above — different
audience, different lifecycle.

#### MEDIUM — LangGraph.js migration (ADR-056)

Replace custom agent orchestration with LangGraph.js. See
ADR-056 for full rationale and what was evaluated.

Prerequisites:
- TR_034 complete (planning loop reaches `completed`).
- At least one full feature completes autonomously.

Phase 1 — Generate layer:
- `BaseLLMAgent` becomes a LangGraph node.
- Generate orchestrator becomes a `StateGraph`.
- LangGraph PostgreSQL checkpointer handles state
  persistence. No custom checkpoint table is added.
- File tools replaced with LangChain `FileManagementToolkit`.
- Aider wrapped as a LangChain `StructuredTool`.
- `executeScript` kept as a custom `StructuredTool` (preserves
  the ADR-050 safety blocklist).

Phase 2 — Planning layer:
- Planning orchestrator becomes a `StateGraph`.
- architecture-agent becomes a subgraph (enables architecture
  crew in future per ADR-049).
- LangGraph `interrupt()` replaces custom escalation.

Phase 3 — Gate layer.
Phase 4 — Deploy layer.
Phase 5 — Maintenance layer.

BullMQ stays as the inter-layer transport. LangGraph runs
inside BullMQ workers. TypeScript server, dashboard, CLI
unchanged. HARNESS.json + agents.yaml unchanged (ADR-042).

#### Post-LangGraph migration — Two-protocol agent architecture

The agent communication layer uses two complementary
protocols for different layers of the stack:

**MCP (Model Context Protocol) — agent to tools**
The vertical connection between agents and external
resources. MCP is the standard for tool connectivity —
97M monthly downloads, 10,000+ public servers, supported
by every major AI provider. Governed by Linux Foundation.

Used in Gestalt for:
- GitHub API (already registered in platform_mcp_servers)
- PostgreSQL queries (drift-agent, alignment-agent)
- File system operations (replaces custom ReadFileTool)
- Security scanners (Semgrep, CodeAnt findings)
- K8sGPT findings (ADR-055, pending)
- Any external service integration

LangGraph support: first-class via langchain-mcp-adapters
(TypeScript). Gestalt's platform_mcp_servers table maps
directly — each registered server becomes a LangGraph
tool at agent execution time. No new infrastructure needed.

executeScript retained only for: Aider, PR-Agent, sandbox
scripts with no MCP equivalent.

**A2A (Agent-to-Agent Protocol) — agent to agent**
The horizontal coordination layer between peer agents.
Developed by Google, donated to Linux Foundation with
50+ enterprise partners (AWS, Microsoft, Salesforce, SAP).
ACP merged into A2A — now the single standard for
inter-agent coordination.

MCP was designed for agent-to-tool interactions, not
peer coordination. A2A fills this gap: delta-style
streaming, multi-agent task lifecycle management,
agent discovery via Agent Cards.

Used in Gestalt for:
- Architecture crew deliberation (Chief, Domain, Data,
  App architects coordinating via A2A)
- Planning orchestrator delegating to generate crew
- Self-healing agent consulting gate verdict agent
- Future: cross-organization agent coordination
  (enterprise customers connecting their agents to
  Gestalt's planning layer via A2A Agent Cards)

LangGraph support: LangGraph subgraphs expose A2A
Agent Cards natively. Each layer subgraph becomes an
A2A agent that accepts task delegations.

**The layered architecture:**
```
A2A layer:  PlanningGraph ←→ GenerateGraph ←→ GateGraph
                  ↕               ↕               ↕
MCP layer:  [GitHub MCP]   [File MCP]    [Semgrep MCP]
                  ↕               ↕               ↕
Custom:     [AiderTool]   [ExecScript]  [PRAgentTool]
```

**Implementation order after LangGraph migration:**
1. MCP — wire platform_mcp_servers to LangGraph tools
   (immediate, one-line per agent node)
2. A2A — expose architecture crew as A2A agent first
   (highest value for inter-crew coordination)
3. A2A Agent Cards for enterprise cross-org coordination
   (future product feature)

ADR candidates:
- "MCP for agent-to-tool connectivity (via langchain-mcp-adapters)"
- "A2A for agent-to-agent coordination (architecture crew first)"

#### FUTURE (post-LangGraph migration) — Template-defined crews and pipeline topology

Status: design captured, not scheduled. Revisit only after
the LangGraph migration (ADR-056) is complete through at
least the generate layer AND a second template is genuinely
needed. Do NOT build during the migration.

**The three-tier model:**

1. Platform tier (Gestalt-internal, NOT exposed to projects):
   Graph topology and crew composition are platform-level
   concerns — more critical and advanced than individual
   projects should manage. The set of available agents, the
   graph shape (which nodes exist, how they fan out/in, the
   conditional edges), and the pipeline step sequence live
   in platform configuration, not in project repos.

2. Template tier (per template, platform-managed):
   Each template defines its own crew roster and graph
   structure from the platform's available agents, with
   default config per agent. Examples:
   - corporate-ops-web-mobile: domain / data / app
     architect crew (today's TR_051 default)
   - gaming (hypothetical): may add graphics-architect,
     physics-architect — or may need a different
     decomposition entirely (engine / asset / gameplay)
     rather than the corporate domain/data/app split
   - data-pipeline (hypothetical): domain / data /
     orchestration architect
   The template owns: which specialists are in the crew,
   their default models and prompts, the pipeline steps.

3. Project tier (per project, constrained override):
   A project may OVERRIDE an agent's config (model,
   prompt_extensions, rules, token budget) and/or DISABLE
   specific agents the template declared. A project may NOT
   redefine the graph topology or add new agents — that
   stays at the template/platform tier.

**What this requires (when built):**

- The current ArchitectureGraph (graph.ts) wires three
  specialists as fixed nodes with fixed edges. This must
  become a dynamic builder that reads the crew roster from
  template config and constructs N parallel specialist
  nodes feeding the chief. Same pattern likely needed for
  other layer graphs.
- A template-level graph/crew descriptor format (which
  agents, which edges, which pipeline steps) — platform
  tier, versioned with the template, NOT committed to
  project repos the way agents.yaml is today.
- A project-level override file that can adjust or disable
  template-declared agents but cannot alter topology.
- Validation: a project override that disables an agent the
  graph structurally depends on (e.g. the chief) must be
  rejected, not silently break the graph.

**Recommended posture — bounded, not fully generic:**

Three postures were considered:
- (a) Fixed graph shape, per-template specialist ROSTER
  (dynamic fan-out of N specialists into a fixed chief).
  Bounded code change. Covers the gaming-template case.
- (b) Fully template-defined arbitrary topology (any nodes,
  any edges). Large machinery; harder to debug — works
  against the auditability the LangGraph migration was
  partly meant to provide. No current evidence any template
  needs a different SHAPE rather than a different ROSTER.
- (c) Keep hardcoding a new crew per template. Doesn't scale.

Recommendation: start with (a) when this is built. It lets
us LEARN what a second template's crew needs by editing
config, without committing platform code to a guess about
arbitrary topologies. Escalate to (b) only if a real
template proves it needs a fundamentally different graph
shape, not just different specialists.

**Open question to resolve at build time, not now:**
Whether a domain like gaming wants new specialists as peers
of domain/data/app, or a different decomposition entirely.
The roster approach (a) lets this be answered empirically.

**Prerequisites before scheduling:**
- LangGraph migration complete through generate layer
- First full feature reaches `completed` on corporate-ops
- A second template is actually needed (real forcing
  function, not speculative)

ADR candidate when scheduled: "Three-tier agent
configuration — platform owns topology, template selects
crew roster, project tunes/disables leaves."

---

## Operator caveats / pending actions

### trackeros state (current — refreshed in TR_054 A3)

- **trackeros `main` HEAD**: `6fa6c597 chore(TR_054): restore
  pipeline adapter to github-actions + autoMerge` (TR_054 A2,
  this session). Three commits ahead of the TR_053 entry:
  `0404a6e9 chore(TR_053): switch planner.engine to langgraph`,
  `df04b85a chore(TR_053-verify): switch chief-architect to
  DeepSeek-V3.2`, and the new `6fa6c597`.
- **HARNESS.json**: `planner.engine: "langgraph"` (TR_053
  amendment naming; default for the `langgraph` engine);
  `planner.maxPhaseRetries: 2`; `planner.architectureReviewPerPhase:
  true`; **`pipeline.adapter: "github-actions"`**;
  **`pipeline.autoMerge: true`**; `mergeMethod: "squash"`.
- **agents.yaml on trackeros**:
  - `architecture-agent`: `deepseek-ai/DeepSeek-V3.2`,
    max_tokens 12000.
  - `planner-agent`: `deepseek-ai/DeepSeek-V3.2`,
    max_tokens 12000.
  - `phase-evaluator-agent`: `deepseek-ai/DeepSeek-V3.2`,
    max_tokens 8000.
  - `intent-agent`, `design-agent`, `constraint-agent`,
    `review-agent`: `deepseek-ai/DeepSeek-V3.2`.
  - `code-agent`: `moonshotai/Kimi-K2.6` (TR_050 —
    DeepSeek wouldn't emit Aider's SEARCH/REPLACE blocks
    reliably).
  - `self-healing-agent`: `moonshotai/Kimi-K2.6` (short
    prompts).
  - `domain-architect-agent` / `data-architect-agent` /
    `app-architect-agent`: `deepseek-ai/DeepSeek-V3.2`,
    max_tokens 6000 (TR_051 crew).
  - `chief-architect-agent`: `deepseek-ai/DeepSeek-V3.2`,
    max_tokens 12000 (switched from Kimi in TR_053
    amendment verification — Kimi was timing out 50% of
    the time on the 12k chief call).
- **Gestalt `.env`** (workspace root): `LLM_BASE_URL=https://api.deepinfra.com/v1/openai`,
  `LLM_MODEL=moonshotai/Kimi-K2.6` (fallback — most agents
  override via `agents.yaml`).
- **LLM registry (platform_llms table)**:
  - `Platform default` (`chat-latest`, OpenAI) — present but
    NOT default.
  - `deepinfra-deepseek-v3` (`deepseek-ai/DeepSeek-V3.2`) — **`is_default = true`**.
  - `deepinfra-kimi-k2` (`moonshotai/Kimi-K2.6`).
  - `deepinfra-qwen-tiny` (`Qwen/Qwen3.5-0.8B`).
- **Template version**: `0.38.0` (gestalt-side; held until
  TR_054 B6 passes per the brief).
- **Migrations applied**: `030_intent_parent_context` (latest,
  added in TR_053 amendment).
- **Open PRs cleanup**: prior-cycle planning-test PRs still
  open under earlier blocked features. Leave until TR_054 B6
  completes — the verification cycle creates new clean PRs.
- **Open alerts**: TR_010 → TR_053 leftover alerts; dismiss
  via `gestalt alerts dismiss <id>` once TR_054 completes.
- **`master.key`** generated locally (workspace root, mode 600,
  gitignored) + mounted into the container via
  `docker-compose.yml`. Survives `docker compose up -d --build`.
  Back up out-of-band; losing it makes every vault-encrypted
  secret unreadable.

---

## CLI install

`@gestalt/cli` is private — not on npm.
```bash
pnpm --filter @gestalt/cli build && cd packages/cli && npm link
```

---

## First-boot sequence

1. `docker-compose up -d` — start platform.
2. `gestalt init-admin` — create admin user (TTY only, once
   per server).
3. `gestalt login` — authenticate CLI.
4. `mkdir my-project && cd my-project && git init && git remote
   add origin <url>`.
5. `gestalt init` — register project + server pushes harness.
6. `git pull` — receive harness files locally.
7. `gestalt run "<intent>"` — submit work to agents.
