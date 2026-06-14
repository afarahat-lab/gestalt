/**
 * @gestalt/agents-planning
 * Public exports — agents + orchestrator + types.
 */

export { ArchitectureAgent } from './agents/architecture-agent';
export { PlannerAgent } from './agents/planner-agent';
export { PhaseEvaluatorAgent } from './agents/phase-evaluator-agent';

export {
  buildFeatureArchitecturePrompt, buildPhaseArchitecturePrompt,
} from './prompts/architecture-prompt';
export { buildFeaturePlanPrompt } from './prompts/planner-prompt';
export { buildPhaseEvaluationPrompt } from './prompts/evaluator-prompt';

export type {
  FeatureArchitecture, PhaseArchitecture, FeaturePlan, PhaseEvaluation,
} from './types';

export { startPlanningWorker } from './orchestrator/planning-orchestrator';

// TR_051 / ADR-056 Phase 1 — architecture crew (LangGraph)
export {
  runArchitectureGraph,
  type RunArchitectureGraphInput,
  type RunArchitectureGraphResult,
} from './graphs/architecture/graph';
export {
  DomainArchitectAgent, DataArchitectAgent,
  AppArchitectAgent, ChiefArchitectAgent,
} from './graphs/architecture/agents';
export type { DomainDesign, DataDesign, AppDesign } from './graphs/architecture/types';
