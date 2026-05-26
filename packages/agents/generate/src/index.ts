/**
 * @agentforge-sdlc/agents-generate
 * Public exports for the generate layer.
 */

// Types
export type {
  IntentSpec,
  IntentScope,
  SuccessCriterion,
  Ambiguity,
  ContextSnapshot,
  GeneratedArtifact,
  AgentResult,
  AgentTask,
  ExecutionPlan,
  PlanStep,
  GateFeedback,
  OrchestratorState,
  FeedbackSignal,
} from './types';

// Orchestrator utilities
export {
  buildExecutionPlan,
  getReadySteps,
  isPlanComplete,
  hasPlanFailed,
  getPriorArtifacts,
} from './orchestrator/plan-builder';

export {
  routeFeedback,
  requiresEscalation,
  isAutoResolvable,
} from './orchestrator/feedback-router';

export {
  transition,
  isTerminalState,
  isWaitingState,
} from './orchestrator/state-machine';

// Specialist agents
export { runIntentAgent } from './agents/intent-agent';

// Prompts
export { buildIntentPrompt } from './prompts/intent-prompt';
