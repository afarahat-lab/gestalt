/**
 * @gestalt/agents-deploy
 * Public exports for the deploy layer.
 *
 * The aspirational shapes from the initial Phase-1 design
 * (DeployTask, DeployHarnessConfig, the old PipelineAdapter with
 * `trigger` / `getStageResults` / `cancel`, the ScannerInterpreter
 * interface, Azure DevOps / GitLab / Jenkins adapters) are still
 * present under `src/types.ts` and `src/adapters/pipeline/` but are not
 * re-exported. They will be removed or rebuilt in a follow-up. The
 * surface below is the post-ADR-033/034 contract.
 */

// Orchestrator (BullMQ worker) — call once at server startup.
export { startDeployWorker } from './orchestrator/deploy-orchestrator';

// Agents
export { runPRAgent } from './agents/pr-agent';
export type { PRAgentInput, PRAgentResult } from './agents/pr-agent';
export { runPipelineAgent } from './agents/pipeline-agent';
export type { PipelineAgentInput, PipelineAgentResult, PipelineAgentOutcome } from './agents/pipeline-agent';
export { runPromotionAgent } from './agents/promotion-agent';
export type { PromotionAgentInput, PromotionAgentResult, PromotionAgentOutcome } from './agents/promotion-agent';

// Pipeline adapters (ADR-033)
export { GitHubActionsAdapter } from './adapters/github-actions-adapter';
export type { GitHubActionsAdapterOptions } from './adapters/github-actions-adapter';
export { NoOpPipelineAdapter } from './adapters/noop-pipeline-adapter';
export { resolvePipelineAdapter } from './adapters/resolver';
export type { PipelineAdapter, PipelineAdapterType, PipelineStatus } from './adapters/pipeline-adapter';
export { PipelineAdapterAuthError } from './adapters/pipeline-adapter';
