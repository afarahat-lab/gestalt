/**
 * Abstract base class for every LLM-calling agent in the platform.
 *
 * Lives in `@gestalt/agents-generate` and is imported by
 * `@gestalt/agents-quality-gate` (review-agent) and
 * `@gestalt/agents-maintenance` (context-fixer). The build graph
 * already has those packages depending on agents-generate (for types
 * + `loadAgentConfig`), so no new workspace deps are needed.
 *
 * Subclasses implement:
 *   buildPrompt(task)    — construct the prompt body (persona +
 *                          extensions are applied by `run()`; the
 *                          subclass should NOT call `applyAgentConfig`
 *                          again — double-application would duplicate
 *                          the persona line)
 *   parseResponse(raw,
 *                 task)  — parse the LLM output into an AgentResult
 *
 * The base provides:
 *   run(task)            — template method: build → callLLM → parse.
 *                          Subclasses that need internal retry loops
 *                          override `run` and call `this.callLLM`
 *                          inside their own loop. Captures
 *                          `lastPrompt` + `lastLlmResponse` +
 *                          `lastModelUsed` on the instance for the
 *                          orchestrator to read after run completes.
 *   callLLM(prompt,
 *           agentConfig,
 *           correlationId) — shared LLM call. Resolves the right
 *                          client via `getLLMClient(agentConfig.llm.
 *                          model)` (Step 1 multi-client registry),
 *                          records the routed model on the instance,
 *                          forwards temperature + maxTokens. Throws
 *                          on LLM failure so subclass retry loops
 *                          can catch it.
 *   makeContextGapSignal(correlationId, message)
 *                        — helper for the common "I failed and can't
 *                          recover" path most subclasses use to mark
 *                          a result as `status: 'failed'`.
 */

import {
  getLLMClient, FILE_TOOL_DEFINITIONS, executeFileTool,
  type ToolDefinition, type ToolCall, type ToolResult, type ToolCallLogEntry,
  type BuiltInToolName,
  type ToolLoopMessage,
} from '@gestalt/core';
import type {
  AgentTask, AgentResult, AgentConfig, FeedbackSignal,
} from '../types';
import { applyAgentConfig } from '../prompts/agent-config-helpers';

/**
 * Safety cap on tool calls per agent run (ADR-038). Prevents an
 * agent from chewing through provider quota on a runaway plan.
 * Reached → the loop bails out with whatever text has already been
 * emitted.
 */
const MAX_TOOL_CALLS = 10;

/** Tool-call output truncated to this many chars before storage in
 *  `agent_execution_logs.tool_calls`. Full results still go to the LLM
 *  via the live loop. */
const TOOL_OUTPUT_LOG_TRUNCATE = 500;

export abstract class BaseLLMAgent {
  protected readonly agentRole: AgentTask['agentRole'];

  /** The prompt actually sent to the LLM on the most recent call.
   *  Captured by `callLLM`. The orchestrator reads this after
   *  `run()` returns and persists it into
   *  `agent_execution_logs.prompt`. */
  lastPrompt: string | null = null;

  /** The raw response text returned by the LLM on the most recent
   *  call. Captured by `callLLM`. Persisted into
   *  `agent_execution_logs.llm_response`. */
  lastLlmResponse: string | null = null;

  /** The model the LLM call routed to (after agents.yaml override
   *  resolution). Captured by `callLLM` from `client.getModel()`.
   *  Null on instances that never made an LLM call (e.g.
   *  lint-config-agent when it skips). Persisted into
   *  `agent_execution_logs.model_used`. */
  lastModelUsed: string | null = null;

  /**
   * Tool-call history from the most recent `callLLMWithTools`
   * invocation (ADR-038). Empty array when the agent didn't use
   * tools (default for `callLLM` callers and for tool-enabled
   * agents whose model decided not to call anything). The
   * orchestrator reads this after `run()` returns and persists it
   * into `agent_execution_logs.tool_calls`. Each entry's `output`
   * is truncated to 500 chars; the full result was already fed
   * back to the LLM during the live loop.
   */
  lastToolCallLog: ToolCallLogEntry[] = [];

  constructor(agentRole: AgentTask['agentRole']) {
    this.agentRole = agentRole;
  }

  /**
   * Template method: build → wrap with persona/extensions → call LLM
   * → parse. Subclasses that need an internal retry loop OR a
   * pre-flight skip check override `run()` directly and call
   * `this.callLLM(...)` themselves.
   */
  async run(task: AgentTask): Promise<AgentResult> {
    const { agentConfig } = task.contextSnapshot;
    const rawPrompt = this.buildPrompt(task);
    const prompt = applyAgentConfig(rawPrompt, agentConfig);
    const raw = await this.callLLM(prompt, agentConfig, task.correlationId);
    return this.parseResponse(raw, task);
  }

  /**
   * Construct the prompt body. Persona + project-specific
   * instructions (`applyAgentConfig`) are applied by `run()` — do
   * NOT call `applyAgentConfig` here, otherwise the persona line
   * would appear twice in the rendered prompt.
   */
  protected abstract buildPrompt(task: AgentTask): string;

  /**
   * Parse the raw LLM response into an `AgentResult`. The agent's
   * `agentRole` field is on `this.agentRole` if a subclass wants to
   * read it back. `task.startedAt` (set by the orchestrator) is
   * available for computing `durationMs`.
   */
  protected abstract parseResponse(raw: string, task: AgentTask): AgentResult;

  /**
   * Shared LLM call. Routes through `getLLMClient(model)` so the
   * Step 1 per-agent model override picks the right client.
   * Captures `lastPrompt`, `lastLlmResponse`, and `lastModelUsed`
   * on the instance so the caller (orchestrator) can read them
   * after `run()` returns. Throws on failure; subclass retry loops
   * catch and decide whether to retry.
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
   * message (e.g. context-fixer — its ADR-018 rules belong in the
   * system role so the user content can't override them). Same
   * routing + capture semantics as `callLLM`; `promptForLog` is what
   * gets stored in `this.lastPrompt` (the dashboard's prompt panel
   * shows that string verbatim).
   */
  protected async callLLMWithMessages(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    agentConfig: AgentConfig,
    correlationId: string,
    promptForLog: string,
  ): Promise<string> {
    const client = getLLMClient(agentConfig.llm.model);
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
    return result.value.content;
  }

  /**
   * Tool-loop LLM call (ADR-038).
   *
   * Runs the OpenAI function-calling loop:
   *   1. Send prompt + tool definitions.
   *   2. Read the assistant turn — text + tool calls.
   *   3. If `stop_reason === 'stop'` or no tool calls → return text.
   *   4. Execute each tool call via `executeFileTool(call,
   *      projectRoot)`.
   *   5. Append assistant + tool result messages to the history.
   *   6. Repeat from (1) until the safety cap (`MAX_TOOL_CALLS`) is
   *      reached.
   *
   * `lastPrompt` / `lastLlmResponse` / `lastModelUsed` are captured
   * just like `callLLM` does — the orchestrator's existing
   * `agent_execution_logs` persistence still works without extra
   * plumbing. `lastToolCallLog` carries the per-call history (output
   * truncated to 500 chars per entry) for operator audit.
   *
   * When the agent's resolved tool config is empty, this method
   * delegates to `callLLM` so callers can branch on `hasTools` at the
   * call site without writing two branches.
   */
  protected async callLLMWithTools(
    prompt: string,
    agentConfig: AgentConfig,
    projectRoot: string,
    correlationId: string,
  ): Promise<{ response: string; toolCallLog: ToolCallLogEntry[] }> {
    const tools = this.resolveToolDefinitions(agentConfig.tools);
    if (tools.length === 0) {
      const response = await this.callLLM(prompt, agentConfig, correlationId);
      this.lastToolCallLog = [];
      return { response, toolCallLog: [] };
    }

    const client = getLLMClient(agentConfig.llm.model);
    this.lastModelUsed = client.getModel();
    this.lastPrompt = prompt;

    const history: ToolLoopMessage[] = [
      { role: 'user', content: prompt },
    ];
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

      const { text, toolCalls, stopReason } = result.value;
      if (text.length > 0) finalText = text;

      // No tool calls OR provider says we're done → exit.
      if (stopReason === 'stop' || toolCalls.length === 0) {
        break;
      }

      // Append the assistant turn carrying its tool_calls so the
      // provider can match the tool_result messages we add next.
      history.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        toolCalls,
      });

      // Execute each tool call and append the result messages.
      for (const call of toolCalls) {
        if (totalToolCalls >= MAX_TOOL_CALLS) break;
        totalToolCalls++;

        const platformCall: ToolCall = {
          id: call.id,
          name: call.name,
          input: call.input,
        };
        const toolResult: ToolResult = await executeFileTool(platformCall, projectRoot);

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
        });
      }

      if (totalToolCalls >= MAX_TOOL_CALLS) {
        // Safety cap hit — give the model one more turn with the
        // existing tool results so it can synthesise an answer rather
        // than getting cut off mid-thought. The break above prevented
        // any further calls; this iteration runs without appending new
        // tool requests, then the next stop_reason check exits.
        // Intentionally fall through.
      }
    }

    this.lastLlmResponse = finalText;
    this.lastToolCallLog = toolCallLog;
    return { response: finalText, toolCallLog };
  }

  /**
   * Resolves `tools.builtin` into the matching ToolDefinition list.
   * Unknown names are silently dropped — operator typos in
   * `agents.yaml` should not crash a cycle.
   */
  private resolveToolDefinitions(tools: AgentConfig['tools']): ToolDefinition[] {
    const builtin = tools?.builtin ?? [];
    if (builtin.length === 0) return [];
    const allowed = new Set<BuiltInToolName>(builtin);
    return FILE_TOOL_DEFINITIONS.filter((d) => allowed.has(d.name as BuiltInToolName));
  }

  /**
   * Helper for subclasses: build a `CONTEXT_GAP` feedback signal
   * tagged with this agent's role.
   *
   * Marked `autoResolvable: false` because a `CONTEXT_GAP` from a
   * generate agent means "I cannot produce a valid result" — the
   * gate-↔-generate retry loop can't satisfy it without operator
   * input.
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
