/**
 * @gestalt/agents-quality-gate
 * All types for the quality gate layer.
 */

import type { AgentRole, SignalType } from '@gestalt/core';
import type { OrchestratorState } from '@gestalt/agents-generate';

// Gate agent roles (ADR-041 — lint / security / test-runner removed;
// CI owns those checks now). The gate runs after CI passes and
// focuses exclusively on architectural compliance + design spec
// adherence — constraint-agent + review-agent.
export type GateAgentRole =
  | 'constraint-agent'
  | 'review-agent';

// Verdict
export type GateVerdict = 'pass' | 'fail' | 'escalate';

// Signal severity
export type SignalSeverity = 'low' | 'medium' | 'high' | 'critical';

// Code location
export interface CodeLocation {
  file: string;
  line?: number;
  column?: number;
  rule?: string;
}

// Gate signal
export interface GateSignal {
  id: string;
  correlationId: string;
  type: SignalType;
  severity: SignalSeverity;
  agentRole: GateAgentRole;
  message: string;
  location: CodeLocation | null;
  autoResolvable: boolean;
}

// Per-agent result
export interface GateAgentResult {
  agentRole: GateAgentRole;
  status: 'passed' | 'failed' | 'errored';
  signals: GateSignal[];
  durationMs: number;
  /**
   * Populated by every LLM-backed gate agent (constraint-agent +
   * review-agent today). Persisted into `agent_execution_logs` by
   * the gate orchestrator.
   */
  lastPrompt?: string;
  llmResponse?: string;
  /**
   * The model the LLM call routed to. Captured by the gate
   * orchestrator from `client.getModel()` after the agent runs and
   * persisted into `agent_execution_logs.model_used` so the
   * dashboard's IntentDetail panel can show "Model: gpt-4o-mini"
   * for an agents.yaml-overridden review-agent. Undefined for
   * non-LLM gate agents.
   */
  modelUsed?: string;
}

// Retry recommendation returned to generate layer
export interface RetryRecommendation {
  targetAgents: AgentRole[];
  prioritySignals: GateSignal[];
  retryFrom: OrchestratorState;
}

// Final gate result
export interface GateResult {
  correlationId: string;
  verdict: GateVerdict;
  signals: GateSignal[];
  retryRecommendation: RetryRecommendation | null;
  agentResults: GateAgentResult[];
  durationMs: number;
  completedAt: Date;
}

// Constraint rule definition
export type ConstraintRuleLevel = 'eslint' | 'ast';

export interface ConstraintRule {
  id: string;
  description: string;
  level: ConstraintRuleLevel;
  severity: SignalSeverity;
  check: string;
}

export interface ConstraintViolation {
  ruleId: string;
  message: string;
  location: CodeLocation;
}

// Gate task received from queue
export interface GateTask {
  taskId: string;
  correlationId: string;
  artifacts: ArtifactRef[];
  harnessConfig: GateHarnessConfig;
  /**
   * The operator's original intent text. Optional because legacy
   * dispatchers may not thread it; the review-agent treats absence as
   * "no scaffolding hints available" and falls through to the normal
   * review path. Used by the review-agent to detect scaffolding /
   * setup intents and suppress "missing implementation" findings on
   * intentional stubs.
   */
  intentText?: string;
}

export interface ArtifactRef {
  id: string;
  type: string;
  path: string;
  content: string;
}

export interface GateHarnessConfig {
  projectRoot: string;
  constraintRules: ConstraintRule[];
  goldenPrinciples: string[];
  qualityGate: {
    maxRetries: number;
    blockingSignals: SignalType[];
  };
  /**
   * Project's declared stack (TEST_REPORT_002 Fix 3b). Sourced from
   * `HARNESS.json.stack` in the cloned project root. Optional because
   * legacy gate tasks predate the field; the constraint-agent treats
   * absence as "no framework constraints to enforce" and falls
   * through.
   */
  stack?: {
    testFramework?: string;
    language?: string;
    framework?: string;
    packageManager?: string;
  };
}
