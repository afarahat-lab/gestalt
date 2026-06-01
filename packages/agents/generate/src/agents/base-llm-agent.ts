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

import { getLLMClient } from '@gestalt/core';
import type {
  AgentTask, AgentResult, AgentConfig, FeedbackSignal,
} from '../types';
import { applyAgentConfig } from '../prompts/agent-config-helpers';

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
