/**
 * @gestalt/agents-quality-gate
 * Public exports for the quality gate layer.
 */

export type {
  GateResult, GateVerdict, GateSignal, GateAgentResult,
  RetryRecommendation, GateTask, GateHarnessConfig,
  ConstraintRule, ConstraintViolation, SecurityFinding,
  TestRunResult, TestFailure, GateAgentRole, SignalSeverity,
  ArtifactRef,
} from './types';

// Orchestrator (BullMQ worker) — call once at server startup.
export { startGateWorker } from './orchestrator/gate-orchestrator';

// Agents
export { runConstraintAgent }   from './agents/constraint-agent';
export { ReviewAgent }          from './agents/llm-review-agent';
export type { LLMReviewAgentResult, LLMReviewArtifact } from './agents/llm-review-agent';
export { runSecurityAgent }     from './agents/security-agent';
export { runLintAgent }         from './agents/lint-agent';
export { runTestRunnerAgent }   from './agents/test-runner-agent';
export { synthesiseGateResult, isDeployBlocked, summariseGateResult } from './agents/review-agent';
export { validateGateResult }   from './validators/gate-result-validator';
