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
  CustomAgentDefinition, CustomAgentResult, CustomAgentFinding, CustomAgentNode,
} from './types';

// Agent configuration (agents.yaml — Step 1 + Step 2 of agent externalisation)
export { loadAgentConfig, defaultAgentConfig, loadCustomAgents } from './config/agent-config-loader';
export { runCustomAgent } from './agents/custom-agent-runner';
export { scheduleCustomAgents, FRAMEWORK_AGENT_NAMES } from './orchestrator/custom-agent-scheduler';

// Orchestrator
export { buildExecutionPlan, getReadySteps, isPlanComplete, hasPlanFailed, getPriorArtifacts } from './orchestrator/plan-builder';
export { routeFeedback, requiresEscalation, isAutoResolvable } from './orchestrator/feedback-router';
export { transition, isTerminalState, isWaitingState } from './orchestrator/state-machine';
export { assembleContext } from './orchestrator/context-assembler';
export { startOrchestratorWorker } from './orchestrator/orchestrator';

// Abstract base class for every LLM-calling agent (generate / gate / maintenance)
export { BaseLLMAgent } from './agents/base-llm-agent';

// Specialist agents — instantiate and call `.run(task)` (or the
// agent's own dedicated entry point for ones that don't follow the
// standard task shape).
export { IntentAgent }     from './agents/intent-agent';
export { DesignAgent }     from './agents/design-agent';
export { ContextAgent }    from './agents/context-agent';
export { LintConfigAgent } from './agents/lint-config-agent';
export { CodeAgent }       from './agents/code-agent';
export { TestAgent }       from './agents/test-agent';

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
