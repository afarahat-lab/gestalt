/**
 * @gestalt/agents-quality-gate
 * Public exports for the quality gate layer.
 */

export type {
  GateResult, GateVerdict, GateSignal, GateAgentResult,
  RetryRecommendation, GateTask, GateHarnessConfig,
  ConstraintRule, ConstraintViolation,
  GateAgentRole, SignalSeverity,
  ArtifactRef,
} from './types';

// Orchestrator (BullMQ worker) — call once at server startup.
export { startGateWorker } from './orchestrator/gate-orchestrator';

// Agents — constraint + review only since ADR-041 (gate runs post-CI).
// Pre-CI lint/security/test-runner stubs were removed; CI now owns
// those checks via the project's own tooling.
export { runConstraintAgent }   from './agents/constraint-agent';
export { ReviewAgent }          from './agents/llm-review-agent';
export type { LLMReviewAgentResult, LLMReviewArtifact } from './agents/llm-review-agent';
export { synthesiseGateResult, isDeployBlocked, summariseGateResult } from './agents/review-agent';
export { validateGateResult }   from './validators/gate-result-validator';
