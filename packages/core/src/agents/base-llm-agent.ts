/**
 * Abstract base class for every LLM-calling agent in the platform.
 *
 * Lives in `@gestalt/core` so the generate, gate, and maintenance
 * layers all extend the same implementation. Re-exported under the
 * same name from `@gestalt/agents-generate` for back-compat with
 * existing import paths.
 *
 * Type parameters:
 *   TTask    — subclass-specific task shape passed to `run()`. The
 *              base class doesn't introspect its fields; the only
 *              constraint is what `run` / `buildPrompt` /
 *              `parseResponse` need to read. Default is `unknown`
 *              so subclasses can declare their own typed shape via
 *              `extends BaseLLMAgent<MyTask, MyResult>` or via
 *              method overrides.
 *   TResult  — subclass-specific result shape returned by `run()`.
 *
 * Subclasses implement:
 *   buildPrompt(task)    — construct the prompt body. Persona +
 *                          project-specific instructions are applied
 *                          by `run()`; the subclass should NOT call
 *                          `applyAgentConfig` again — double-application
 *                          would duplicate the persona line.
 *   parseResponse(raw,
 *                 task)  — parse the LLM output into a result.
 *
 * The base provides:
 *   run(task)            — template method: build → callLLM → parse.
 *                          Subclasses that need internal retry loops
 *                          override `run` and call `this.callLLM` /
 *                          `this.callLLMWithTools` inside their own
 *                          loop.
 *   callLLM(prompt,
 *           agentConfig,
 *           correlationId)
 *                        — shared LLM call. Routes through
 *                          `getLLMClient(agentConfig.llm.model)` so
 *                          the per-agent model override picks the
 *                          right client.
 *   callLLMWithTools(prompt,
 *                    agentConfig,
 *                    projectRoot,
 *                    correlationId,
 *                    mcpClients?)
 *                        — function-calling loop (ADR-038 + ADR-039).
 *                          MCP clients optional; when absent the loop
 *                          uses built-in tools only.
 *   callLLMWithMessages(messages,
 *                       agentConfig,
 *                       correlationId,
 *                       promptForLog)
 *                        — messages-array variant for agents needing
 *                          a separate system message (e.g.
 *                          context-fixer).
 *   makeContextGapSignal(correlationId, message)
 *                        — helper for the common "I failed and can't
 *                          recover" path most subclasses use to mark
 *                          a result as `status: 'failed'`.
 *
 * Instance fields:
 *   lastPrompt           — prompt sent on the most recent call
 *   lastLlmResponse      — raw response text from the most recent call
 *   lastModelUsed        — resolved model name (after override lookup)
 *   lastToolCallLog      — tool-call audit history for the most recent
 *                          `callLLMWithTools` invocation
 *
 * The orchestrator reads these fields after `run()` returns and
 * persists them into `agent_execution_logs.{prompt, llm_response,
 * model_used, tool_calls}`. Generic so callers can either match the
 * generate layer's `AgentTask<ContextSnapshot>` shape OR a custom
 * task shape (review-agent's `GateTask`, context-fixer's intent +
 * project bundle).
 */

import {
  getLLMClientForModel,
} from '../llm/index';
import {
  FILE_TOOL_DEFINITIONS, executeFileTool,
} from '../tools/file-tools';
import type {
  ToolDefinition, ToolCall, ToolResult, ToolCallLogEntry,
  BuiltInToolName, AgentRole, FeedbackSignal,
} from '../types';
import type { ToolLoopMessage } from '../llm/index';
import type { McpClient } from '../tools/mcp-client';
import type { AgentConfig } from './agent-config';
import { applyAgentConfig } from './agent-config-helpers';

/**
 * Safety cap on tool calls per agent run (ADR-038). Prevents an
 * agent from chewing through provider quota on a runaway plan.
 */
const MAX_TOOL_CALLS = 10;

/** Tool-call output truncated to this many chars before storage in
 *  `agent_execution_logs.tool_calls`. Full results still go to the
 *  LLM via the live loop. */
const TOOL_OUTPUT_LOG_TRUNCATE = 500;

/**
 * TEST_REPORT_005 / TEST_REPORT_007 evolution — render the per-agent
 * rules section from `HARNESS.json.agentConfig[role].rules` as a
 * plain-text markdown block.
 *
 * Standalone (not on the class) because function-based prompt
 * builders (`code-prompt.ts`, etc.) need to call it without a
 * `this` context. The class wrapper `buildHarnessAgentSection`
 * delegates here.
 *
 * Returns the empty string when the project hasn't declared rules
 * for the given role — callers concatenate unconditionally.
 */
export function renderHarnessAgentRules(
  agentRole: string,
  harnessConfig: { agentConfig?: Record<string, { rules?: string[] }> } | null | undefined,
): string {
  const cfg = harnessConfig?.agentConfig?.[agentRole];
  if (!cfg?.rules || cfg.rules.length === 0) return '';
  return [
    '## Rules you must enforce (from HARNESS.json)',
    '',
    ...cfg.rules.map((r) => `- ${r}`),
    '',
  ].join('\n');
}

/**
 * TEST_REPORT_005 / TEST_REPORT_007 evolution — one-sentence
 * direction telling an LLM agent that it has `executeScript` and
 * should decide which commands fit the project's stack. Same text
 * for every agent.
 */
export function renderScriptToolInstruction(): string {
  return [
    '## Script execution',
    'You have access to the `executeScript` tool.',
    "Use it to verify the rules above by running whatever commands",
    "are appropriate for this project's language and stack. Decide",
    'what to run — do not wait to be told.',
    '',
  ].join('\n');
}

export abstract class BaseLLMAgent<TTask = unknown, TResult = unknown> {
  protected readonly agentRole: AgentRole;

  /** Prompt actually sent to the LLM on the most recent call. */
  lastPrompt: string | null = null;

  /** Raw response text returned by the LLM on the most recent call. */
  lastLlmResponse: string | null = null;

  /** Model the LLM call routed to after `agents.yaml` override
   *  resolution. Null on instances that never made an LLM call. */
  lastModelUsed: string | null = null;

  /** Tool-call history from the most recent `callLLMWithTools`
   *  invocation (ADR-038). Empty array when the agent didn't use
   *  tools. */
  lastToolCallLog: ToolCallLogEntry[] = [];

  /** Fix D — running total of `result.tokensUsed` reported by the
   *  LLM client across every `callLLM*` invocation in the current
   *  `run()`. Orchestrators read this after `run` returns and pass
   *  it to `completeAgentExecution` so `agent_executions.tokens_used`
   *  is no longer pinned to 0. Reset to 0 on every `run()` entry by
   *  the template method — subclasses that override `run` should
   *  reset it themselves at the top. */
  lastTokensUsed: number = 0;

  constructor(agentRole: AgentRole) {
    this.agentRole = agentRole;
  }

  /**
   * Template method: build → wrap with persona/extensions → call LLM
   * → parse. Subclasses that need an internal retry loop OR a
   * pre-flight skip check override `run()` directly and call
   * `this.callLLM(...)` themselves.
   *
   * The base implementation assumes `task` exposes
   * `contextSnapshot.agentConfig` and `correlationId` — generate's
   * `AgentTask` matches that shape. Gate / maintenance subclasses
   * use a different task shape and override `run()` to handle
   * config + correlation resolution themselves.
   */
  async run(task: TTask): Promise<TResult> {
    this.lastTokensUsed = 0;
    const t = task as unknown as {
      correlationId: string;
      contextSnapshot: { agentConfig: AgentConfig };
    };
    const { agentConfig } = t.contextSnapshot;
    const rawPrompt = this.buildPrompt(task);
    const prompt = applyAgentConfig(rawPrompt, agentConfig);
    const raw = await this.callLLM(prompt, agentConfig, t.correlationId);
    return this.parseResponse(raw, task);
  }

  /**
   * Construct the prompt body. Persona + project-specific
   * instructions (`applyAgentConfig`) are applied by `run()` — do
   * NOT call `applyAgentConfig` here.
   */
  protected abstract buildPrompt(task: TTask): string;

  /**
   * Parse the raw LLM response into a result.
   */
  protected abstract parseResponse(raw: string, task: TTask): TResult;

  /**
   * Shared LLM call. Routes through `getLLMClient(model)` so the
   * per-agent model override picks the right client. Captures
   * `lastPrompt`, `lastLlmResponse`, and `lastModelUsed` on the
   * instance so the caller can read them after `run()` returns.
   */
  protected async callLLM(
    prompt: string,
    agentConfig: AgentConfig,
    correlationId: string,
  ): Promise<string> {
    return this.callLLMWithMessages(
      [{ role: 'user', content: prompt }],
      agentConfig,
      correlationId,
      prompt,
    );
  }

  /**
   * Messages-array variant for agents that need a separate system
   * message. `promptForLog` is what gets stored in `this.lastPrompt`.
   */
  protected async callLLMWithMessages(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    agentConfig: AgentConfig,
    correlationId: string,
    promptForLog: string,
  ): Promise<string> {
    // Routes through the platform LLM registry (migration 014) so a
    // per-agent `model` override picks up the registered baseUrl +
    // apiKeyEnv. Falls back to the legacy `getLLMClient(model)` path
    // when the registry has no matching row.
    const client = await getLLMClientForModel(agentConfig.llm.model);
    this.lastModelUsed = client.getModel();
    this.lastPrompt = promptForLog;
    const result = await client.complete({
      messages,
      ...(agentConfig.llm.temperature !== undefined ? { temperature: agentConfig.llm.temperature } : {}),
      ...(agentConfig.llm.maxTokens !== undefined ? { maxTokens: agentConfig.llm.maxTokens } : {}),
      correlationId,
    });
    if (!result.ok) {
      throw new Error(`LLM call failed: ${result.error.message}`);
    }
    this.lastLlmResponse = result.value.content;
    this.lastTokensUsed += result.value.tokensUsed ?? 0;
    return result.value.content;
  }

  /**
   * Tool-loop LLM call (ADR-038 + ADR-039). When the agent's
   * resolved tool config is empty AND no MCP clients were supplied,
   * delegates to `callLLM` so callers can branch on `hasTools` at
   * the call site without writing two branches.
   *
   * MCP clients are NOT closed here — the orchestrator caches them
   * per-cycle and may share them across agent steps.
   */
  protected async callLLMWithTools(
    prompt: string,
    agentConfig: AgentConfig,
    projectRoot: string,
    correlationId: string,
    mcpClients?: McpClient[],
  ): Promise<{ response: string; toolCallLog: ToolCallLogEntry[] }> {
    return this.runToolLoop(
      [{ role: 'user', content: prompt }],
      prompt,
      agentConfig,
      projectRoot,
      correlationId,
      mcpClients,
    );
  }

  /**
   * Messages-array variant for agents that need a separate system
   * message AND want tool-use (context-fixer is the motivating case
   * — its ADR-018 "preserve all existing content" rule lives in the
   * system role, but it also benefits from `readFile` access during
   * reasoning).
   *
   * `promptForLog` is what gets persisted as `lastPrompt` — the
   * dashboard's prompt panel shows this string verbatim, so callers
   * typically pass the concatenated `${system}\n\n${user}` view of
   * the messages. Same tools resolution + dispatch + MCP cache
   * semantics as `callLLMWithTools`.
   */
  protected async callLLMWithToolsMessages(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    promptForLog: string,
    agentConfig: AgentConfig,
    projectRoot: string,
    correlationId: string,
    mcpClients?: McpClient[],
  ): Promise<{ response: string; toolCallLog: ToolCallLogEntry[] }> {
    const history: ToolLoopMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    return this.runToolLoop(
      history,
      promptForLog,
      agentConfig,
      projectRoot,
      correlationId,
      mcpClients,
    );
  }

  /**
   * Shared tool-use loop body. Resolves tools (built-in + MCP),
   * delegates to `callLLM` when the set is empty, otherwise drives
   * the OpenAI function-calling loop with the supplied seed history.
   */
  private async runToolLoop(
    history: ToolLoopMessage[],
    promptForLog: string,
    agentConfig: AgentConfig,
    projectRoot: string,
    correlationId: string,
    mcpClients?: McpClient[],
  ): Promise<{ response: string; toolCallLog: ToolCallLogEntry[] }> {
    const builtinDefs = this.resolveToolDefinitions(agentConfig.tools);

    const mcpDefs: ToolDefinition[] = [];
    if (mcpClients && mcpClients.length > 0) {
      const perServer = await Promise.all(
        mcpClients.map((c) => c.listTools()),
      );
      for (const list of perServer) mcpDefs.push(...list);
    }

    const tools: ToolDefinition[] = [...builtinDefs, ...mcpDefs];

    if (tools.length === 0) {
      // No tools → fall through to plain LLM call. For the
      // messages-array entry the underlying call needs the messages
      // shape; for the single-prompt entry the seed history is
      // exactly `[{ role: 'user', content: prompt }]` which is the
      // same as `callLLM` does internally.
      const response = await this.callLLMWithMessages(
        history.map((m) => ({
          role: m.role === 'tool' ? 'user' : m.role,
          content: typeof m.content === 'string' ? m.content : '',
        })),
        agentConfig,
        correlationId,
        promptForLog,
      );
      this.lastToolCallLog = [];
      return { response, toolCallLog: [] };
    }

    const mcpByPrefix = new Map<string, McpClient>();
    if (mcpClients) {
      for (const c of mcpClients) mcpByPrefix.set(`${c.serverName}__`, c);
    }

    // Registry-aware client resolution (Session 3).
    const client = await getLLMClientForModel(agentConfig.llm.model);
    this.lastModelUsed = client.getModel();
    this.lastPrompt = promptForLog;

    const toolCallLog: ToolCallLogEntry[] = [];
    let totalToolCalls = 0;
    let finalText = '';

    for (let turn = 0; turn < MAX_TOOL_CALLS + 1; turn++) {
      const result = await client.completeWithTools({
        messages: history,
        tools,
        ...(agentConfig.llm.temperature !== undefined ? { temperature: agentConfig.llm.temperature } : {}),
        ...(agentConfig.llm.maxTokens !== undefined ? { maxTokens: agentConfig.llm.maxTokens } : {}),
        correlationId,
      });
      if (!result.ok) {
        throw new Error(`LLM call failed: ${result.error.message}`);
      }

      this.lastTokensUsed += result.value.tokensUsed ?? 0;

      const { text, toolCalls, stopReason } = result.value;
      if (text.length > 0) finalText = text;

      if (stopReason === 'stop' || toolCalls.length === 0) {
        break;
      }

      history.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        toolCalls,
      });

      for (const call of toolCalls) {
        if (totalToolCalls >= MAX_TOOL_CALLS) break;
        totalToolCalls++;

        const mcpClient = findMcpForCall(call.name, mcpByPrefix);

        let toolResult: ToolResult;
        let toolSource: string;
        if (mcpClient) {
          toolResult = await mcpClient.executeTool(call.name, call.input, call.id);
          toolSource = `mcp:${mcpClient.serverName}`;
        } else {
          const platformCall: ToolCall = {
            id: call.id,
            name: call.name,
            input: call.input,
          };
          toolResult = await executeFileTool(platformCall, projectRoot);
          toolSource = 'builtin';
        }

        history.push({
          role: 'tool',
          toolCallId: call.id,
          content: toolResult.content,
        });

        toolCallLog.push({
          toolName: call.name,
          input: call.input,
          output: toolResult.content.slice(0, TOOL_OUTPUT_LOG_TRUNCATE),
          isError: toolResult.isError,
          calledAt: new Date(),
          toolSource,
        });
      }

      if (totalToolCalls >= MAX_TOOL_CALLS) {
        // Safety cap hit — let the model do one more synthesis turn.
      }
    }

    this.lastLlmResponse = finalText;
    this.lastToolCallLog = toolCallLog;
    return { response: finalText, toolCallLog };
  }

  private resolveToolDefinitions(tools: AgentConfig['tools']): ToolDefinition[] {
    const builtin = tools?.builtin ?? [];
    if (builtin.length === 0) return [];
    const allowed = new Set<BuiltInToolName>(builtin);
    return FILE_TOOL_DEFINITIONS.filter((d) => allowed.has(d.name as BuiltInToolName));
  }

  /**
   * TEST_REPORT_005 evolution — class wrapper for the standalone
   * `renderHarnessAgentRules` function. Subclasses call
   * `this.buildHarnessAgentSection(harnessConfig)`. Function-based
   * prompt builders (`code-prompt.ts`, etc.) call
   * `renderHarnessAgentRules(roleName, harnessConfig)` directly.
   */
  protected buildHarnessAgentSection(
    harnessConfig: { agentConfig?: Record<string, { rules?: string[] }> } | null | undefined,
  ): string {
    return renderHarnessAgentRules(this.agentRole, harnessConfig);
  }

  /**
   * TEST_REPORT_005 evolution — class wrapper for
   * `renderScriptToolInstruction()`. The text is identical for
   * every agent; the wrapper exists so subclasses can chain
   * `this.buildScriptToolInstruction()` next to
   * `this.buildHarnessAgentSection(...)`.
   */
  protected buildScriptToolInstruction(): string {
    return renderScriptToolInstruction();
  }

  /**
   * Helper for subclasses: build a `CONTEXT_GAP` feedback signal
   * tagged with this agent's role.
   */
  protected makeContextGapSignal(
    correlationId: string,
    message: string,
  ): FeedbackSignal {
    return {
      id: crypto.randomUUID(),
      correlationId,
      type: 'CONTEXT_GAP',
      severity: 'high',
      sourceAgent: this.agentRole,
      message,
      autoResolvable: false,
      createdAt: new Date(),
    };
  }
}

/**
 * Routes a tool call to the matching MCP client by namespace prefix
 * (ADR-039). Returns null when no prefix matches.
 */
function findMcpForCall(
  toolName: string,
  mcpByPrefix: Map<string, McpClient>,
): McpClient | null {
  for (const [prefix, client] of mcpByPrefix.entries()) {
    if (toolName.startsWith(prefix)) return client;
  }
  return null;
}
