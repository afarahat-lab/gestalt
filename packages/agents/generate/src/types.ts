/**
 * @package @gestalt/agents-generate
 * All types for the generate layer.
 */

import type { AgentRole, ArtifactType, SignalType } from '@gestalt/core';

// ─── Shared LLM call shape ───────────────────────────────────────────────────

/**
 * Function the orchestrator hands every LLM-using agent. Agents pass
 * their `agentConfig.llm` as the second argument so per-agent
 * temperature / maxTokens land on the wire.
 */
export type LlmCallFn = (
  prompt: string,
  overrides?: { temperature?: number; maxTokens?: number; model?: string },
) => Promise<string>;

// ─── Agent configuration (agents.yaml) ───────────────────────────────────────

/**
 * Per-agent LLM tuning. Each field is optional — anything absent falls
 * back to either the platform default (`loadConfig().llm.model`,
 * provider's defaults for temperature / max tokens) or the loader's
 * baseline value, depending on the field.
 */
export interface AgentLlmConfig {
  temperature?: number;
  maxTokens?: number;
  /** If absent, use the platform default from loadConfig().llm.model. */
  model?: string;
}

/**
 * One agent's configurable surface. `role` and `goal` become the LLM
 * persona; `promptExtensions` is a flat list of standing project rules
 * the prompt builder appends verbatim under "Project-specific
 * instructions" near the end of every prompt.
 */
export interface AgentConfig {
  role: string;
  goal: string;
  llm: AgentLlmConfig;
  promptExtensions: string[];
}

/**
 * Top-level shape of `agents.yaml`. The keys under `agents` map to the
 * platform's `AgentRole` values (intent-agent, design-agent, code-agent,
 * test-agent, review-agent, drift-agent, alignment-agent, context-fixer,
 * etc.) — only LLM-using agents are addressable here. Infrastructure
 * agents (constraint-agent, test-runner-agent, pipeline-agent,
 * promotion-agent, gc-agent) ignore the file.
 */
export interface AgentsYaml {
  agents: Record<string, AgentConfig>;
  /** Project-defined LLM agents that run after framework generate agents
   *  and before dispatch to the quality gate (ADR-037). Loaded via
   *  `loadCustomAgents(projectRoot)` and executed by
   *  `runCustomAgent(definition, ctx, correlationId)`. */
  customAgents?: CustomAgentDefinition[];
}

// ─── Custom agents (Step 2 — ADR-037) ────────────────────────────────────────

/**
 * Project-defined LLM agent declared in `agents.yaml` under
 * `custom_agents:`. Generic shape — no deterministic execution path.
 * The runner substitutes `{{role}} / {{goal}} / {{artifacts}} /
 * {{goldenPrinciples}} / {{intentText}} / {{projectName}}` placeholders
 * in `prompt` and sends the result to the configured LLM.
 *
 * Findings come back as a structured JSON response:
 *   { passed, findings: [{ severity, file, description }], summary }
 *
 * Severity routes to a signal type the gate evaluates:
 *   - high   → CONSTRAINT_VIOLATION
 *   - low/medium → LINT_FAILURE
 *   - error  → CONTEXT_GAP (so the gate sees the agent broke)
 *
 * Custom agents NEVER emit GOLDEN_PRINCIPLE_BREACH — that signal type
 * is reserved for framework infrastructure agents and the review-agent.
 */
export interface CustomAgentDefinition {
  name: string;
  role: string;
  goal: string;
  /** Framework agent name (e.g. `code-agent`) the custom agent should
   *  run after. Parsed but NOT enforced in Step 2 — all custom agents
   *  run after all framework agents regardless. Captured for forward
   *  compatibility. */
  runsAfter?: string;
  llm: AgentLlmConfig;
  /** Template with `{{role}}`, `{{goal}}`, `{{artifacts}}`,
   *  `{{goldenPrinciples}}`, `{{intentText}}`, `{{projectName}}`
   *  placeholders. Unknown placeholders are left in place
   *  (debuggable, matches the template-engine convention). */
  prompt: string;
}

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

export type AgentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed'
  /**
   * Distinct from `failed`. The agent ran successfully but discovered the
   * input is too vague to proceed (no success criteria, or a high-impact
   * ambiguity). The orchestrator translates this into an Alert + a
   * `waiting-for-clarification` intent status. The operator can resume
   * the cycle by POSTing to `/intents/:id/clarify`.
   */
  | 'clarification-needed';

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

export interface FeedbackSignal {
  id: string;
  correlationId: string;
  type: SignalType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  sourceAgent: AgentRole;
  message: string;
  location?: { file: string; line?: number };
  autoResolvable: boolean;
  createdAt: Date;
}

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
