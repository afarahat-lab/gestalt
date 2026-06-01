/**
 * @gestalt/agents-quality-gate
 * All types for the quality gate layer.
 */

import type { AgentRole, SignalType } from '@gestalt/core';
import type { OrchestratorState } from '@gestalt/agents-generate';

// Gate agent roles
export type GateAgentRole =
  | 'lint-agent'
  | 'security-agent'
  | 'constraint-agent'
  | 'test-runner-agent'
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
   * Populated by LLM-backed gate agents (review-agent today).
   * Non-LLM agents (constraint-agent regex sweeper, future
   * lint-agent / security-agent / test-runner-agent that shell out to
   * project tooling) leave these undefined. Persisted into
   * `agent_execution_logs` by the gate orchestrator.
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

// Security finding
export type OWASPSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface SecurityFinding {
  id: string;
  title: string;
  severity: OWASPSeverity;
  description: string;
  location: CodeLocation | null;
  cwe?: string;
}

// Test results
export interface TestFailure {
  testName: string;
  suiteName: string;
  expected: string;
  actual: string;
  stackTrace: string;
  location: CodeLocation | null;
}

export interface TestRunResult {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: TestFailure[];
}

// Gate task received from queue
export interface GateTask {
  taskId: string;
  correlationId: string;
  artifacts: ArtifactRef[];
  harnessConfig: GateHarnessConfig;
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
}
