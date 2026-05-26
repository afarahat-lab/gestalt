/**
 * @package @agentforge-sdlc/agents-generate
 * All types for the generate layer.
 */

import type { AgentRole, ArtifactType, SignalType } from '@agentforge-sdlc/core';

// ─── Execution graph ─────────────────────────────────────────────────────────

export type ArchLayer = 'domain' | 'api' | 'ui' | 'infra' | 'test' | 'config';

export type Complexity = 'small' | 'medium' | 'large';

export type AmbiguityImpact = 'low' | 'medium' | 'high';

export type AgentStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export type OrchestratorState =
  | 'received'
  | 'analyzing'
  | 'waiting_for_clarification'
  | 'designing'
  | 'generating_context'
  | 'generating_lint_config'
  | 'coding'
  | 'testing'
  | 'awaiting_gate'
  | 'gate_failed'
  | 'approved'
  | 'escalated';

// ─── Intent spec ─────────────────────────────────────────────────────────────

export interface SuccessCriterion {
  id: string;
  description: string;
  testable: boolean;
  layer: 'unit' | 'integration' | 'e2e';
}

export interface Ambiguity {
  id: string;
  description: string;
  options: string[];
  impactIfWrong: AmbiguityImpact;
}

export interface IntentScope {
  affectedDomains: string[];
  affectedLayers: ArchLayer[];
  isBreakingChange: boolean;
  estimatedComplexity: Complexity;
}

export interface IntentSpec {
  id: string;
  correlationId: string;
  rawIntent: string;
  scope: IntentScope;
  successCriteria: SuccessCriterion[];
  constraints: string[];
  outOfScope: string[];
  ambiguities: Ambiguity[];
}

// ─── Context snapshot ─────────────────────────────────────────────────────────

export interface HarnessConfig {
  name: string;
  version: string;
  stack: Record<string, string>;
  adapters: Record<string, { type: string; configKey: string }>;
  qualityGate: {
    maxRetries: number;
    blockingSignals: SignalType[];
    autoResolvableSignals: SignalType[];
  };
}

export interface ArchitectureSpec {
  style: 'layered-monolith' | 'modular-monolith' | 'microservices';
  layers: string[];
  dependencyRules: Array<{ from: string; to: string; allowed: boolean }>;
  modules: string[];
}

export interface DomainEntity {
  name: string;
  fields: Array<{ name: string; type: string; required: boolean }>;
  relationships: Array<{ entity: string; type: 'one-to-one' | 'one-to-many' | 'many-to-many' }>;
}

export interface DomainModel {
  entities: DomainEntity[];
  boundedContexts: string[];
}

export interface Principle {
  id: string;
  title: string;
  description: string;
  enforcement: string;
}

export interface ADR {
  id: string;
  title: string;
  status: 'accepted' | 'superseded' | 'deprecated';
  decision: string;
  affectedDomains: string[];
}

export interface ContextSnapshot {
  harness: HarnessConfig;
  architecture: ArchitectureSpec;
  domain: DomainModel;
  goldenPrinciples: Principle[];
  relevantDecisions: ADR[];
  intentSpec: IntentSpec;
  priorArtifacts: GeneratedArtifact[];
}

// ─── Artifacts ────────────────────────────────────────────────────────────────

export interface GeneratedArtifact {
  id: string;
  correlationId: string;
  type: ArtifactType;
  path: string;
  content: string;
  producedBy: AgentRole;
  createdAt: Date;
}

// ─── Agent communication ─────────────────────────────────────────────────────

export interface FeedbackSignal {
  id: string;
  correlationId: string;
  type: SignalType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  sourceAgent: AgentRole;
  message: string;
  location?: { file: string; line?: number };
}

export interface AgentResult {
  agentRole: AgentRole;
  status: AgentStatus;
  skipReason?: string;
  artifacts: GeneratedArtifact[];
  signals: FeedbackSignal[];
  tokensUsed: number;
  durationMs: number;
}

export interface AgentTask {
  taskId: string;
  correlationId: string;
  agentRole: AgentRole;
  contextSnapshot: ContextSnapshot;
  maxRetries: number;
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

export interface PlanStep {
  order: number;
  agentRole: AgentRole;
  dependsOn: AgentRole[];
  parallel: boolean;
  status: AgentStatus;
  result?: AgentResult;
}

export interface ExecutionPlan {
  correlationId: string;
  intentId: string;
  steps: PlanStep[];
  state: OrchestratorState;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Quality gate feedback ────────────────────────────────────────────────────

export interface GateFeedback {
  correlationId: string;
  passed: boolean;
  signals: FeedbackSignal[];
  receivedAt: Date;
}
