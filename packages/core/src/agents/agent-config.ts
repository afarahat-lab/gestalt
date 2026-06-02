/**
 * Shared agent configuration types — used by `loadAgentConfig`,
 * `BaseLLMAgent`, and every orchestrator across the platform.
 *
 * Moved to `@gestalt/core` from `@gestalt/agents-generate` in
 * 2026-06-02 so the gate and maintenance orchestrators can load
 * configs and use the same base class without depending on
 * `agents-generate` for non-types.
 *
 * The generate package re-exports these names for back-compat with
 * the older import paths.
 */

import type { BuiltInToolName } from '../types';
import type { McpServerConfig } from '../tools/mcp-resolver';

export type { McpServerConfig };

/**
 * Per-call LLM tuning. Fields that overlap with the platform
 * default are optional — when present they override the default for
 * THIS agent's calls only. `model` is the explicit model name; null
 * (or omitted) means "use platform default from .env LLM_MODEL".
 */
export interface AgentLlmConfig {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

/**
 * Tool surface an agent can call during its run. `builtin` is the
 * ADR-038 file tool subset; `mcp` is the ADR-039 external MCP server
 * list. Empty / absent → the agent runs without the tool-use loop
 * (delegates to a plain LLM call).
 */
export interface AgentToolConfig {
  builtin?: BuiltInToolName[];
  mcp?: McpServerConfig[];
}

/**
 * One agent's resolved configuration after merging operator
 * overrides from `agents.yaml` with the platform's per-role
 * baseline. Always non-null at the call site; `loadAgentConfig`
 * returns a working config on every code path.
 */
export interface AgentConfig {
  role: string;
  goal: string;
  llm: AgentLlmConfig;
  promptExtensions: string[];
  tools?: AgentToolConfig;
}

/**
 * The full `agents.yaml` shape — top-level `agents:` map keyed by
 * agent role plus the optional `custom_agents:` array for
 * ADR-037 project-defined agents.
 */
export interface AgentsYaml {
  agents?: Record<string, AgentConfig>;
  custom_agents?: CustomAgentDefinition[];
  customAgents?: CustomAgentDefinition[];
}

/**
 * Project-defined LLM agent (ADR-037). Declared in `agents.yaml`
 * under the `custom_agents:` key. The orchestrator runs these
 * AFTER all framework generate agents complete and BEFORE the gate
 * dispatch. Their findings flow as typed signals; they can't emit
 * `GOLDEN_PRINCIPLE_BREACH`.
 */
export interface CustomAgentDefinition {
  name: string;
  role: string;
  goal: string;
  /** Framework agent name OR another custom agent. The orchestrator
   *  runs this custom agent immediately after the named agent
   *  completes. `null` (or omitted in YAML) defaults to `test-agent`
   *  — the last framework generate agent — so legacy configs that
   *  didn't declare `runs_after` behave identically. */
  runsAfter: string | null;
  llm: AgentLlmConfig;
  prompt: string;
  tools?: AgentToolConfig;
}

/**
 * Custom agent definition + its resolved dependency. Output of
 * `scheduleCustomAgents`. `dependsOn` is always concrete (the
 * scheduler coalesces `runsAfter: null` to `test-agent`).
 */
export interface CustomAgentNode {
  definition: CustomAgentDefinition;
  dependsOn: string;
}

/**
 * Shared LLM call function. The signature subclasses of
 * `BaseLLMAgent` use when they need to call the LLM directly with
 * agent-config tuning applied. Returned text is the raw response —
 * subclasses parse it.
 */
export type LlmCallFn = (
  prompt: string,
  overrides?: { temperature?: number; maxTokens?: number; model?: string },
) => Promise<string>;
