/**
 * @gestalt/agents-deploy — internal types.
 *
 * The post-ADR-033/034 contract for the deploy layer lives in:
 *   - `adapters/pipeline-adapter.ts` (PipelineAdapter, PipelineStatus)
 *   - `agents/{pr,pipeline,promotion}-agent.ts` (per-agent input/output)
 *
 * The shapes below are auxiliary types used inside this package (PR
 * status, promotion strategy as it will appear in HARNESS.json). They
 * are not the deploy-orchestrator's wire contract — see the agents and
 * the pipeline adapter for that.
 */

import type { PipelineAdapterType } from './adapters/pipeline-adapter';

// ─── PR types ────────────────────────────────────────────────────────────────

export type PRStatus = 'open' | 'merged' | 'closed' | 'draft';

export interface PullRequest {
  id: string;
  externalPrId: string;
  title: string;
  body: string;
  branch: string;
  targetBranch: string;
  status: PRStatus;
  url: string;
  createdAt: Date;
  mergedAt: Date | null;
}

// ─── Promotion types ─────────────────────────────────────────────────────────

export type Environment = 'dev' | 'staging' | 'production';

export type PromotionTrigger = 'auto' | 'manual';

export interface EnvironmentStrategy {
  trigger: PromotionTrigger;
  approvals: number;          // 0 = no approval required
  approvers?: string[];       // user IDs required to approve
}

export interface PromotionConfig {
  environments: Environment[];
  strategy: Record<Environment, EnvironmentStrategy>;
}

// ─── Deploy harness config (HARNESS.json `pipeline` field) ───────────────────

export interface DeployHarnessConfig {
  pipeline: {
    adapter: PipelineAdapterType;
    // Adapter-specific connection config; values reference env vars,
    // resolved at runtime by the adapter itself.
    connectionConfig?: Record<string, string>;
  };
  promotion?: PromotionConfig;
}
