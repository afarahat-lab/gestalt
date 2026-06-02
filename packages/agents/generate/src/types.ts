/**
 * @package @gestalt/agents-generate
 * All types for the generate layer.
 */

import type { AgentRole, ArtifactType, SignalType, McpClient } from '@gestalt/core';

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
 * One MCP server connection declared in `agents.yaml` (ADR-039).
 * Resolved at agent-run time by the generate orchestrator via
 * `resolveMcpClients(configs, harnessConfig, projectCredential)`.
 *
 * `tokenFrom` picks the credential source:
 *   - `'harness'`           → look up in `HarnessConfig.mcp.servers[]`
 *                            by matching `name`
 *   - `'project_credential'`→ use the project's Git PAT
 *   - `'env:VAR_NAME'`      → read `process.env.VAR_NAME` on the
 *                            server (the only way to keep tokens
 *                            out of the project repo)
 */
export interface McpServerConfig {
  name: string;
  url: string;
  tokenFrom: 'harness' | 'project_credential' | `env:${string}`;
}

/**
 * Per-agent tool configuration (ADR-038 + ADR-039).
 *
 * `builtin` lists the built-in file tools the agent may call —
 * `readFile`, `listDirectory`, `searchFiles`, `getFileTree`. Empty
 * array (the default for most roles) means "no built-in tools".
 *
 * `mcp` lists external MCP servers the agent connects to at run
 * time (ADR-039). Tool definitions fetched from each server are
 * merged with the built-in definitions; each tool is namespaced
 * `<serverName>__<toolName>` so collisions across servers don't
 * occur. MCP unavailability is non-fatal — the agent proceeds with
 * whatever subset of tools resolved successfully.
 */
export interface AgentToolConfig {
  builtin?: BuiltInToolName[];
  mcp?: McpServerConfig[];
}

import type { BuiltInToolName } from '@gestalt/core';

/**
 * One agent's configurable surface. `role` and `goal` become the LLM
 * persona; `promptExtensions` is a flat list of standing project rules
 * the prompt builder appends verbatim under "Project-specific
 * instructions" near the end of every prompt. `tools` (ADR-038)
 * controls whether `BaseLLMAgent.callLLMWithTools` is wired in.
 */
export interface AgentConfig {
  role: string;
  goal: string;
  llm: AgentLlmConfig;
  promptExtensions: string[];
  tools: AgentToolConfig;
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
  /** Framework agent name (e.g. `code-agent`) OR another custom agent
   *  name. The orchestrator runs this custom agent immediately after
   *  the named agent completes (ADR-037, runs_after enforcement
   *  shipped 2026-06-02). `null` (or omitted in YAML) defaults to
   *  `test-agent` — the last framework generate agent in the fixed
   *  graph — so legacy configs that didn't declare `runs_after`
   *  behave identically. Unknown targets and cycles in the
   *  custom-agent dependency graph throw at orchestrator startup
   *  and emit `CONTEXT_GAP`. */
  runsAfter: string | null;
  llm: AgentLlmConfig;
  /** Template with `{{role}}`, `{{goal}}`, `{{artifacts}}`,
   *  `{{goldenPrinciples}}`, `{{intentText}}`, `{{projectName}}`
   *  placeholders. Unknown placeholders are left in place
   *  (debuggable, matches the template-engine convention). */
  prompt: string;
  tools?: AgentToolConfig;
}

/**
 * Custom agent definition + its resolved dependency. Output of
 * `scheduleCustomAgents` — agents are sorted so each appears AFTER
 * its dependency in the array. `dependsOn` is the resolved target
 * name (framework agent or another custom agent); never null on
 * a scheduled node (the scheduler coalesces `runsAfter: null` to
 * the default).
 */
export interface CustomAgentNode {
  definition: CustomAgentDefinition;
  dependsOn: string;
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
