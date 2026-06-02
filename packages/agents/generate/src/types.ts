/**
 * @package @gestalt/agents-generate
 * All types for the generate layer.
 *
 * Agent configuration types (`AgentConfig`, `AgentsYaml`,
 * `CustomAgentDefinition`, …) and the `AgentStatus` / `FeedbackSignal`
 * shapes moved to `@gestalt/core` in 2026-06 so every layer shares
 * one source of truth. Re-exported here for back-compat with the
 * older import paths.
 */

import type { AgentRole, ArtifactType, SignalType, McpClient } from '@gestalt/core';
// Local imports so types declared in this file can reference the
// moved shapes by name (re-exporting alone doesn't bring them into
// scope for use as type annotations within this module).
import type {
  AgentConfig as CoreAgentConfig,
  FeedbackSignal as CoreFeedbackSignal,
  AgentStatus as CoreAgentStatus,
} from '@gestalt/core';

type AgentConfig = CoreAgentConfig;
type FeedbackSignal = CoreFeedbackSignal;
type AgentStatus = CoreAgentStatus;

// ─── Shared LLM call shape (re-exports) ──────────────────────────────────────
export type {
  AgentLlmConfig, AgentToolConfig, AgentConfig, AgentsYaml,
  McpServerConfig, CustomAgentDefinition, CustomAgentNode,
  LlmCallFn,
  FeedbackSignal, AgentStatus,
} from '@gestalt/core';

export interface CustomAgentFinding {
  severity: 'high' | 'medium' | 'low';
  file: string;
  description: string;
}

export interface CustomAgentResult {
  agentName: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  passed: boolean;
  findings: CustomAgentFinding[];
  summary: string;
  rawResponse: string;
  tokensUsed: number;
  durationMs: number;
  /** Captured by the runner after `getLLMClient(def.llm.model)` so the
   *  orchestrator can persist it into `agent_execution_logs.model_used`. */
  modelUsed: string | null;
  /** Error message when `status === 'error'`. */
  errorMessage?: string;
}

// ─── Execution graph ─────────────────────────────────────────────────────────

export type ArchLayer = 'domain' | 'api' | 'ui' | 'infra' | 'test' | 'config';

export type Complexity = 'small' | 'medium' | 'large';

export type AmbiguityImpact = 'low' | 'medium' | 'high';

// AgentStatus moved to @gestalt/core (re-exported at the top of this file).

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

/**
 * Project-defined constraint rule (HARNESS.json `constraints.rules`).
 * Inlined verbatim in the code-agent and review-agent prompts. Kept
 * in sync with the `ConstraintRule` type in `@gestalt/core`.
 */
export interface ConstraintRule {
  id: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

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
  /**
   * Optional project-specific constraint rules. Mirrors
   * `HarnessConfig.constraints` in `@gestalt/core`. When present the
   * prompts read `harness.constraints.rules` and skip the inline
   * hardcoded fallback rules.
   */
  constraints?: {
    rules: ConstraintRule[];
  };
  /**
   * Project-level MCP server credentials (ADR-039). Mirrors
   * `HarnessConfig.mcp` in `@gestalt/core`. Read by the MCP token
   * resolver when an agent's `tools.mcp[].token_from` is `'harness'`.
   */
  mcp?: {
    servers: Array<{
      name: string;
      url: string;
      token?: string;
    }>;
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
  projectRoot: string;
  harness: HarnessConfig;
  architectureMd: string;          // raw markdown — used by prompts
  domainMd: string;                // raw markdown — used by prompts
  architecture: ArchitectureSpec;  // parsed — used by agents
  domain: DomainModel;             // parsed — used by agents
  goldenPrinciples: Principle[];
  relevantDecisions: ADR[];
  intentSpec: IntentSpec;
  priorArtifacts: GeneratedArtifact[];
  /**
   * Signals from a previous attempt that the orchestrator has routed
   * to the agent currently running. Empty array on the first attempt;
   * populated on gate-driven retries with the signal subset the
   * feedback-router determined this agent is responsible for fixing
   * (e.g. code-agent gets CONSTRAINT_VIOLATION + LINT_FAILURE +
   * TEST_FAILURE; context-agent gets CONTEXT_GAP). Surfaces to every
   * prompt via the shared `buildSignalFeedback` formatter.
   */
  priorSignals: FeedbackSignal[];
  /**
   * Agent-specific configuration loaded from `agents.yaml` in the
   * project repo. The assembler calls `loadAgentConfig(projectRoot,
   * forAgent)` and attaches the result; absent / malformed YAML
   * resolves to platform defaults so existing projects keep working.
   */
  agentConfig: AgentConfig;
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
// FeedbackSignal moved to @gestalt/core (re-exported at the top of this file).

export interface ClarificationNeeded {
  reason: string;
  suggestions: string[];
}

export interface AgentResult {
  agentRole: AgentRole;
  status: AgentStatus;
  skipReason?: string;
  /**
   * Populated only when `status === 'clarification-needed'`. The
   * orchestrator copies these fields into the Alert row so the operator
   * sees the same explanation in the dashboard.
   */
  clarificationNeeded?: ClarificationNeeded;
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
  /**
   * `Date.now()` captured by the orchestrator BEFORE calling
   * `agent.run(task)`. Available inside `parseResponse` so subclasses
   * compute `durationMs` without a second `Date.now()` call at the
   * top of every implementation. Optional so callers that build a
   * task elsewhere (older test helpers, the gate dispatch payload)
   * don't have to know about it; agents that need it fall back to
   * `Date.now()`.
   */
  startedAt?: number;
  /**
   * Signals carried over from a prior quality-gate `fail` verdict.
   * Empty (or undefined) on the first attempt; populated when the
   * gate orchestrator dispatches a retry. The prompt builder for the
   * routed specialist agent includes them so the model knows what to
   * fix.
   */
  priorSignals?: FeedbackSignal[];
  /**
   * Zero-based retry counter. 0 = first attempt, N = Nth retry cycle.
   * Caps at the harness's `qualityGate.maxRetries`.
   */
  retryCount?: number;
  /**
   * Source of the originating intent — human-submitted vs. queued by a
   * maintenance agent. Threaded so the intent-agent can skip the
   * clarification gate for `maintenance-agent` intents: those are typed
   * `MaintenanceIntent` objects with a structured prefix and never
   * vague enough to need operator input (ADR-035).
   */
  intentSource?: 'human' | 'maintenance-agent';
  /**
   * Optional operator-supplied clarification text. Populated only when
   * the orchestrator is resuming an intent that was previously paused
   * with `waiting-for-clarification`. The intent-agent prompt appends
   * this verbatim under an "Operator clarification" heading.
   */
  clarification?: string;
  /**
   * MCP clients (ADR-039) the orchestrator resolved once for this
   * cycle. Populated only on agents that declared `tools.mcp[]` in
   * `agents.yaml`. Lifecycle is owned by the orchestrator — agents
   * borrow these but must not close them (a later agent step may
   * reuse the same client).
   */
  mcpClients?: McpClient[];
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

// ─── Design artifact ──────────────────────────────────────────────────────────

export interface DomainChange {
  entityName: string;
  operation: 'create' | 'update';
  fields: Array<{ name: string; type: string; required: boolean }>;
  relationships: Array<{ entity: string; type: string }>;
}

export interface ApiContract {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  requestBody?: Record<string, string>;
  responseBody?: Record<string, string>;
  authRequired: boolean;
  roles: string[];
}

export interface ComponentSpec {
  name: string;
  type: 'page' | 'component' | 'hook' | 'service';
  description: string;
  props?: Record<string, string>;
}

export interface DesignArtifact {
  correlationId: string;
  domainChanges: DomainChange[];
  apiContracts: ApiContract[];
  componentSpecs: ComponentSpec[];
}
