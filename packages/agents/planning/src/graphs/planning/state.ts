/**
 * PlanningGraph state (TR_053 / ADR-056 Phase 2).
 *
 * The planning loop becomes a LangGraph `StateGraph`:
 *
 *   architecture (subgraph) → planner → phase-dispatch
 *                                            ↓
 *                                       await-phase  ← interrupt()
 *                                            ↓
 *                                       phase-evaluator → conditional edges
 *                                            ↓
 *                                       (continue | adjust | complete | escalate)
 *
 * The graph runs inside the BullMQ planning worker. When the graph
 * hits `interrupt()` in `awaitPhaseNode`, the worker job completes
 * normally and the state is checkpointed to PostgreSQL keyed by
 * `thread_id = featureId`. The deploy promotion-agent fires a
 * `planning:graph-resume` BullMQ task after a phase intent
 * deploys; that task resumes the graph from the interrupt with
 * the phase result as the resume value.
 *
 * State is intentionally minimal — only what survives across the
 * checkpoint boundary needs to live here. Heavy objects (cloned
 * repository, HarnessConfig) are re-derived in each node from the
 * project ID. This keeps the LangGraph checkpoint payload small
 * and the graph deterministic on resume.
 */

import { Annotation } from '@langchain/langgraph';

export const PlanningGraphState = Annotation.Root({
  // ─── Inputs (set on graph entry) ─────────────────────────────────
  featureId: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  correlationId: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),

  // ─── Architecture (set by architectureNode) ──────────────────────
  // JSON-stringified FeatureArchitecture per the canonical shape.
  // Persisted to features.architecture after this node runs.
  featureArchitecture: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // ─── Plan (set by plannerNode) ───────────────────────────────────
  // JSON-stringified FeaturePlan. Phases also persisted to
  // feature_phases by the same node so other queries see them.
  phasesJson: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // ─── Phase execution ─────────────────────────────────────────────
  currentPhaseIndex: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  // The intent ID for the in-flight phase. Set by phaseDispatchNode,
  // consumed by awaitPhaseNode's interrupt() payload so the
  // promotion-agent can match the resume back to the right thread.
  currentIntentId: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  // JSON-stringified phase result envelope ({success, mergeCommitSha,
  // failureReason?}). Set by Command({resume}) when the graph resumes
  // after awaitPhaseNode.
  phaseResult: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  // Per-phase retry counter — separate from the structural
  // `feature_phases.retry_count` column because the graph's
  // `phase-dispatch → await → evaluate → adjust` loop is fully
  // distinct from the legacy `planning:phase → planning:evaluate`
  // retry path. Bumped when phase-evaluator returns `adjust`.
  currentPhaseRetries: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),

  // ─── Control flow ────────────────────────────────────────────────
  planningAction: Annotation<
    'continue' | 'adjust' | 'complete' | 'escalate' | null
  >({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // ─── Human in the loop ───────────────────────────────────────────
  humanFeedback: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // ─── Telemetry ───────────────────────────────────────────────────
  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  tokensUsed: Annotation<number>({
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
});

export type PlanningGraphStateType = typeof PlanningGraphState.State;
