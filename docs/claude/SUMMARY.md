# SUMMARY.md — derived from STATE.md + BUILD.md + RECENT.md

_Auto-regenerated after every session by Claude Code. Do not edit by hand._

_Generated: 2026-06-14_

---


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

---


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
| Migrations applied | 030 (latest: `030_intent_parent_context`) — TR_053 amendment Refined Option 2 added `intents.parent_context JSONB` so the planning subscriber routes resume signals without a DB JOIN. No new migration in TR_054 / TR_055 / TR_056 (graphs use the existing LangGraph PostgresSaver tables). |
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

---


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
