/**
 * GateGraph state (TR_056 / ADR-056 Phase 4).
 *
 * The gate orchestrator's per-task work becomes a LangGraph
 * `StateGraph`:
 *
 *   START → gateNode → conditional edges:
 *                       pass     → END(success)
 *                       fail     → selfHealingNode
 *                       escalate → selfHealingNode
 *           selfHealingNode → conditional edges:
 *                       retried     → END (BullMQ takes the next hop)
 *                       pendingFix  → END (fix child intent dispatched)
 *                       escalated   → END (alert is the human surface)
 *
 * The graph runs inside the existing BullMQ gate worker. One graph
 * thread per gate task, keyed by `thread_id = correlationId`.
 *
 * State is intentionally small. The cloned repo, GateTask, and agent
 * instances are all rebuilt inside `gateNode` from `intentId` —
 * neither survives the checkpoint boundary. What stays:
 *
 *   - intentId / correlationId / projectId — identity
 *   - artifacts JSON — the original payload (rehydrated to ArtifactRef)
 *   - branch / prNumber / prUrl / ciRunId — PR context
 *   - retryCount — bumped by selfHealingNode on retry edge
 *   - readFromBranch — ADR-041 post-CI mode flag
 *   - gate verdict + signals — set by gateNode for selfHealingNode
 *
 * TR_055b §5 invariant: the per-payload retryCount lives here, but
 * MAX_GATE_RETRIES enforcement also reads `agent_executions` rows
 * (the persisted attempt counter) so a checkpoint restore can never
 * silently reset the budget. Both counters must agree before a
 * retry is allowed.
 */

import { Annotation } from '@langchain/langgraph';
import type { FeedbackSignal } from '@gestalt/core';

/**
 * Stored artifact shape — mirrors `GateTaskPayload.artifacts[]` so
 * the gateNode can rehydrate `ArtifactRef`s on resume. Kept loose
 * because the on-wire shape carries `createdAt` as string|Date and
 * we don't want a Date instance in the checkpoint.
 */
export interface GateArtifactJson {
  id: string;
  correlationId?: string;
  type: string;
  path: string;
  content: string;
  producedBy?: string;
  createdAt?: string;
}

/**
 * The minimal gate verdict surface for downstream nodes. Mirrors
 * `GateResult` from `../types` but stringified to keep the
 * checkpoint payload deterministic across LangGraph serialization.
 */
export interface GateVerdictSummary {
  verdict: 'pass' | 'fail' | 'escalate';
  signalCount: number;
  signalsJson: string;       // JSON.stringify(GateSignal[])
  summary: string;
  durationMs: number;
}

/**
 * SelfHealingNode outcome — what the next graph step needs to know.
 * `retried` means a BullMQ dispatch fired (legacy transport,
 * TR_056 transition window); `pendingFix` means a child fix-intent
 * was submitted via the existing TR_024 mechanism (B-i path —
 * parent will resume on `onSuccessDispatch` in a NEW graph thread,
 * not via LangGraph interrupt — see TR_054-PENDING).
 */
export type SelfHealingOutcome =
  | 'retried'
  | 'pendingFix'
  | 'escalated'
  | 'autoResolved'
  | 'noop';

export const GateGraphState = Annotation.Root({
  // ─── Identity ────────────────────────────────────────────────────
  intentId: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  correlationId: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  projectId: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  intentText: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // ─── PR / CI context ─────────────────────────────────────────────
  branch: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  prNumber: Annotation<number | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  prUrl: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  ciRunId: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  readFromBranch: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),
  // TR_056 Part 2c — legacy pre-push field forwarded into the
  // deploy:pr dispatch so pr-agent's resume leg pushes the fix
  // commit to an existing branch + re-uses the open PR instead of
  // opening a second one. Only relevant on the legacy
  // `readFromBranch=false` pass-path.
  resumeOnBranch: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // ─── Artifacts (legacy pre-CI path) ──────────────────────────────
  artifacts: Annotation<GateArtifactJson[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),

  // ─── Retry budget (TR_055b §5 invariant) ─────────────────────────
  // Per-payload counter. The persisted-counter cross-check (DB read
  // of agent_executions.attempt_count for this intent) is performed
  // inside selfHealingNode and gateNode's retry-on-fail edge — both
  // counters must agree.
  retryCount: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),

  // ─── Gate verdict (set by gateNode) ──────────────────────────────
  gateVerdict: Annotation<GateVerdictSummary | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  // Signals available to selfHealingNode (rehydrated PlatformSignal
  // shape). Kept separate from gateVerdict.signalsJson so the loop
  // can pass them to the diagnostician without re-parsing.
  priorSignals: Annotation<FeedbackSignal[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),

  // ─── SelfHealing outcome (set by selfHealingNode) ────────────────
  selfHealingOutcome: Annotation<SelfHealingOutcome | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // ─── Telemetry ───────────────────────────────────────────────────
  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type GateGraphStateType = typeof GateGraphState.State;
