/**
 * @gestalt/agents-generate — public exports.
 */

// Types
export type {
  IntentSpec, IntentScope, SuccessCriterion, Ambiguity,
  ContextSnapshot, GeneratedArtifact, AgentResult, AgentTask,
  ExecutionPlan, PlanStep, GateFeedback, OrchestratorState,
  FeedbackSignal, DesignArtifact, DomainChange, ApiContract, ComponentSpec,
  AgentConfig, AgentLlmConfig, AgentsYaml,
} from './types';

// Agent configuration (agents.yaml — Step 1 of agent externalisation)
export { loadAgentConfig, defaultAgentConfig } from './config/agent-config-loader';

// Orchestrator
export { buildExecutionPlan, getReadySteps, isPlanComplete, hasPlanFailed, getPriorArtifacts } from './orchestrator/plan-builder';
export { routeFeedback, requiresEscalation, isAutoResolvable } from './orchestrator/feedback-router';
export { transition, isTerminalState, isWaitingState } from './orchestrator/state-machine';
export { assembleContext } from './orchestrator/context-assembler';
export { startOrchestratorWorker } from './orchestrator/orchestrator';

// Specialist agents
export { runIntentAgent }      from './agents/intent-agent';
export { runDesignAgent }      from './agents/design-agent';
export { runContextAgent }     from './agents/context-agent';
export { runLintConfigAgent }  from './agents/lint-config-agent';
export { runCodeAgent }        from './agents/code-agent';
export { runTestAgent }        from './agents/test-agent';

// Prompts
export { buildIntentPrompt }     from './prompts/intent-prompt';
export { buildDesignPrompt }     from './prompts/design-prompt';
export { buildContextPrompt }    from './prompts/context-prompt';
export { buildCodePrompt }       from './prompts/code-prompt';
export { buildTestPrompt }       from './prompts/test-prompt';
export { buildLintConfigPrompt } from './prompts/lint-config-prompt';

// Validators
export { validateIntentSpec }   from './validators/intent-validator';
export { validateDesignArtifact } from './validators/design-validator';
export { validateArtifactSet }  from './validators/artifact-validator';
