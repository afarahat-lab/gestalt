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
import type { HarnessConfig, TokenManagementConfig } from '../harness/index';
import { createContextLogger } from '../logger/index';
import type { AgentConfig } from './agent-config';
import { applyAgentConfig } from './agent-config-helpers';

/**
 * TR_035 / ADR-057 — Per-call token-management telemetry. Captured
 * by `BaseLLMAgent` on every LLM invocation and read by the calling
 * orchestrator after `run()` returns so it can persist into
 * `agent_execution_logs.token_management` (JSONB; migration 029).
 *
 * `reductionStrategy` is the LAST strategy applied (null when no
 * scope reduction fired). `budgetExpansions` counts Layer 5 retries
 * (0 when the first attempt succeeded). `truncationOccurred` is true
 * iff the final accepted response still came back with
 * `finishReason === 'length'` after retries were exhausted.
 */
export interface TokenManagementLog {
  originalPromptTokens: number;
  finalPromptTokens: number;
  reductionStrategy:
    | 'phase-history-summarisation'
    | 'rules-compression'
    | 'architecture-trim'
    | null;
  budgetExpansions: number;
  finalMaxTokens: number;
  truncationOccurred: boolean;
  /**
   * `reasoning_effort` value sent on the wire for this call. Captured
   * from `agentConfig.llm.reasoningEffort` regardless of apiShape so
   * operators can observe drift between intended and effective
   * behaviour. `null` when the agent's config didn't set one.
   */
  reasoningEffort:
    | 'xhigh'
    | 'high'
    | 'medium'
    | 'low'
    | 'non-reasoning'
    | null;
}

/**
 * Safety cap on tool calls per agent run (ADR-038). Prevents an
 * agent from chewing through provider quota on a runaway plan.
 *
 * TEST_REPORT_010 Fix 2 — raised from 10 → 20. The code-agent's new
 * mandatory-pre-emit-verification block (TEST_REPORT_008) wants
 * headroom for ~1 getFileTree + ~3 readFile (existing deps) + 1
 * executeScript + 1 fix + 1 re-verify = ~7 purposeful calls. The old
 * cap of 10 sat right on top of that and ran out before the LLM
 * could reach `executeScript`.
 */
const MAX_TOOL_CALLS = 20;

/** Tool-call output truncated to this many chars before storage in
 *  `agent_execution_logs.tool_calls`. Full results still go to the
 *  LLM via the live loop. */
const TOOL_OUTPUT_LOG_TRUNCATE = 500;

/**
 * TEST_REPORT_005 / TEST_REPORT_007 evolution — render the per-agent
 * rules section from `HARNESS.json.agentConfig[role]` as a plain-text
 * markdown block. Includes two sub-sections:
 *
 *   - "Rules you must enforce" — from `.rules[]`
 *   - "Verification guidance for this project" — from
 *     `.verificationGuidance[]` (TR_021). Project-specific hints
 *     about HOW to verify findings before emitting them. Platform
 *     mechanics (evidence requirement, severity ceiling, JSON
 *     schema) stay in the agent .ts files.
 *
 * Standalone (not on the class) because function-based prompt
 * builders (`code-prompt.ts`, etc.) need to call it without a
 * `this` context. The class wrapper `buildHarnessAgentSection`
 * delegates here.
 *
 * Returns the empty string when the project hasn't declared rules
 * OR guidance for the given role — callers concatenate
 * unconditionally.
 */
/**
 * Per-agent prompt section, as rendered into the LLM prompt. Includes
 * everything declared under `HARNESS.json.agentConfig[role]`:
 *
 *   - `.rules[]`                → "### Rules you must enforce"
 *   - `.verificationGuidance[]` → "### Verification guidance for
 *                                  this project" (TR_021)
 *   - `.phaseScopingRules[]`    → "### Phase scoping rules"
 *                                  (migration 024 — planner-agent)
 *   - `.evaluationCriteria[]`   → "### Evaluation criteria"
 *                                  (migration 024 — phase-evaluator-agent)
 *   - `.architectureGuidance[]` → "### Architecture guidance"
 *                                  (migration 024 — architecture-agent)
 *
 * All sections are optional and rendered in this fixed order. Each
 * agent receives whatever subset the project declares — empty when
 * the project declares nothing, which is the legacy default. Empty
 * string when the role has no agentConfig entry at all.
 */
export function renderHarnessAgentRules(
  agentRole: string,
  harnessConfig:
    | {
        agentConfig?: Record<string, {
          rules?: string[];
          verificationGuidance?: string[];
          phaseScopingRules?: string[];
          evaluationCriteria?: string[];
          architectureGuidance?: string[];
        }>;
      }
    | null
    | undefined,
): string {
  const cfg = harnessConfig?.agentConfig?.[agentRole];
  const hasRules     = !!cfg?.rules && cfg.rules.length > 0;
  const hasGuidance  = !!cfg?.verificationGuidance && cfg.verificationGuidance.length > 0;
  const hasScoping   = !!cfg?.phaseScopingRules && cfg.phaseScopingRules.length > 0;
  const hasEval      = !!cfg?.evaluationCriteria && cfg.evaluationCriteria.length > 0;
  const hasArch      = !!cfg?.architectureGuidance && cfg.architectureGuidance.length > 0;
  if (!hasRules && !hasGuidance && !hasScoping && !hasEval && !hasArch) return '';

  const parts: string[] = ['## Agent configuration (from HARNESS.json)', ''];

  if (hasRules) {
    parts.push('### Rules you must enforce');
    cfg!.rules!.forEach((r) => parts.push(`- ${r}`));
    parts.push('');
  }

  if (hasGuidance) {
    parts.push('### Verification guidance for this project');
    parts.push('When verifying findings, use these project-specific hints:');
    cfg!.verificationGuidance!.forEach((g) => parts.push(`- ${g}`));
    parts.push('');
  }

  if (hasScoping) {
    parts.push('### Phase scoping rules');
    parts.push('Use these examples and rules when shaping each phase:');
    cfg!.phaseScopingRules!.forEach((r) => parts.push(`- ${r}`));
    parts.push('');
  }

  if (hasEval) {
    parts.push('### Evaluation criteria');
    parts.push('When judging a completed phase, apply these criteria:');
    cfg!.evaluationCriteria!.forEach((c) => parts.push(`- ${c}`));
    parts.push('');
  }

  if (hasArch) {
    parts.push('### Architecture guidance');
    parts.push('Follow these project-specific architecture principles:');
    cfg!.architectureGuidance!.forEach((g) => parts.push(`- ${g}`));
    parts.push('');
  }

  return parts.join('\n');
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

  /** TR_035 / ADR-057 — per-call token-management telemetry from the
   *  most recent LLM invocation. `null` when no LLM call has been
   *  made this run, or for tool-loop calls (the loop has multiple
   *  LLM turns; only the final turn's telemetry is captured). The
   *  orchestrator persists this into
   *  `agent_execution_logs.token_management` (migration 029). */
  lastTokenManagement: TokenManagementLog | null = null;

  /** TR_035 / ADR-057 — harness config the current `run()` is
   *  operating under. Set by the template `run()` method from
   *  `task.contextSnapshot.harness` so the inner `callLLM*` helpers
   *  can read the `tokenManagement` knobs without threading the
   *  config through every signature. Subclasses that override
   *  `run()` set this themselves via `this.setHarnessConfig(...)`.
   *  `null` when the caller didn't supply a harness config (e.g.
   *  legacy gate / maintenance entry points). */
  protected harnessConfigForRun: HarnessConfig | null = null;

  private readonly tokenLog = createContextLogger({ module: 'token-management' });

  constructor(agentRole: AgentRole) {
    this.agentRole = agentRole;
  }

  /**
   * TR_035 / ADR-057 — subclasses that override `run()` should call
   * this at the top of their override so the inner `callLLM*` helpers
   * see the harness config the layers need. Public for the same
   * reason — the gate / maintenance orchestrators don't extend a
   * common template method, so they call this directly.
   */
  setHarnessConfigForRun(harnessConfig: HarnessConfig | null): void {
    this.harnessConfigForRun = harnessConfig;
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
    this.lastTokenManagement = null;
    const t = task as unknown as {
      correlationId: string;
      contextSnapshot: { agentConfig: AgentConfig; harness?: HarnessConfig };
    };
    const { agentConfig } = t.contextSnapshot;
    this.harnessConfigForRun = t.contextSnapshot.harness ?? null;
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
   *
   * TR_035 / ADR-057 — All five token-management layers fire from
   * inside this method so every code path that calls the LLM (via
   * `callLLM`, `callLLMWithMessages`, or the no-tools fallback from
   * `runToolLoop`) inherits the same behaviour automatically.
   *
   *   - Layer 1 (model-aware defaults) + Layer 2 (dynamic budget)
   *     happen during the budget calc each attempt.
   *   - Layer 3 (scope reduction) compresses the LAST user message
   *     when the rendered prompt exceeds the threshold.
   *   - Layer 4 (JSON guard) is applied by callers via
   *     `addJsonResponseGuard()` on the prompt they build; this is
   *     not invoked here because it is prompt-shape-specific.
   *   - Layer 5 (truncation retry) re-issues the call on
   *     `finish_reason === 'length'`, doubling the budget each
   *     pass up to 3 attempts.
   */
  protected async callLLMWithMessages(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    agentConfig: AgentConfig,
    correlationId: string,
    promptForLog: string,
  ): Promise<string> {
    const cfg = this.tokenManagementKnobs();

    // ─── Layer 3: scope reduction (operator-disable-able) ──────────
    // Compress only the LAST user message — system / assistant /
    // earlier turns are caller-shaped (e.g. context-fixer's preserve
    // rule lives in the system role; rewriting it would break the
    // contract). Token estimate is the WHOLE rendered prompt so the
    // threshold catches multi-message bloat too.
    const originalPromptTokens = estimateTokens(promptForLog);
    let reductionStrategy: TokenManagementLog['reductionStrategy'] = null;
    let reducedMessages = messages;
    let reducedPromptForLog = promptForLog;
    if (cfg.enableScopeReduction) {
      const { messages: m, promptForLog: p, strategy } =
        this.maybeReducePromptScope(messages, promptForLog, cfg.promptCompressionThreshold);
      reducedMessages = m;
      reducedPromptForLog = p;
      reductionStrategy = strategy;
    }

    // ─── Resolve client (after reduction so Layer 1 sees the same
    //                    model the wire call will use) ──────────────
    const client = await getLLMClientForModel(agentConfig.llm.model);
    this.lastModelUsed = client.getModel();
    this.lastPrompt = reducedPromptForLog;
    const model = client.getModel();

    // ─── Layer 1 + Layer 2: configured | reasoning-default → dynamic
    const configuredMaxTokens =
      agentConfig.llm.maxTokens ?? resolveDefaultMaxTokens(model);
    const dynamicMaxTokens = cfg.enableDynamicBudget
      ? calculateDynamicBudget(reducedPromptForLog, configuredMaxTokens, model)
      : Math.min(configuredMaxTokens, getModelHardLimit(model));

    // ─── Layer 5: truncation-retry loop ────────────────────────────
    const MAX_ATTEMPTS = 3;
    let effectiveMaxTokens = dynamicMaxTokens;
    let attempt = 1;
    let finalContent = '';
    let truncationOccurred = false;
    let finishReason: 'stop' | 'length' | 'content_filter' | 'unknown' = 'unknown';

    while (attempt <= MAX_ATTEMPTS) {
      const result = await client.complete({
        messages: reducedMessages,
        ...(agentConfig.llm.temperature !== undefined ? { temperature: agentConfig.llm.temperature } : {}),
        ...(agentConfig.llm.reasoningEffort ? { reasoningEffort: agentConfig.llm.reasoningEffort } : {}),
        maxTokens: effectiveMaxTokens,
        correlationId,
      });
      if (!result.ok) {
        throw new Error(`LLM call failed: ${result.error.message}`);
      }
      this.lastTokensUsed += result.value.tokensUsed ?? 0;
      finalContent = result.value.content;
      finishReason = result.value.finishReason;

      if (finishReason !== 'length' || attempt >= MAX_ATTEMPTS) {
        truncationOccurred = finishReason === 'length';
        if (truncationOccurred) {
          this.tokenLog.error({
            agentRole: this.agentRole, attempts: attempt,
            correlationId,
          }, 'LLM truncated after max retries — using partial response');
        }
        break;
      }

      // Expand for the next attempt.
      const nextMax = Math.min(
        Math.ceil(effectiveMaxTokens * cfg.maxRetryBudgetMultiplier),
        getModelHardLimit(model),
      );
      if (nextMax <= effectiveMaxTokens) {
        // Already at the hard limit — re-issuing won't help.
        truncationOccurred = true;
        break;
      }
      this.tokenLog.warn({
        agentRole: this.agentRole, correlationId, attempt,
        currentMax: effectiveMaxTokens, nextMax,
        tokensUsed: result.value.tokensUsed,
      }, 'LLM truncated — retrying with larger budget');
      effectiveMaxTokens = nextMax;
      attempt += 1;
    }

    this.lastLlmResponse = finalContent;
    this.lastTokenManagement = {
      originalPromptTokens,
      finalPromptTokens: estimateTokens(reducedPromptForLog),
      reductionStrategy,
      budgetExpansions: attempt - 1,
      finalMaxTokens: effectiveMaxTokens,
      truncationOccurred,
      reasoningEffort: agentConfig.llm.reasoningEffort ?? null,
    };
    return finalContent;
  }

  /**
   * TR_035 / ADR-057 — Layer 4 JSON response guard. Subclasses that
   * expect structured-JSON output call this on the built prompt
   * BEFORE handing it to `applyAgentConfig` / `callLLM`. Kept on the
   * base class so every agent uses the same wording.
   */
  protected addJsonResponseGuard(prompt: string): string {
    return (
      prompt +
      '\n\nCRITICAL: Your response MUST be valid, complete JSON.\n' +
      'Start with { and end with }.\n' +
      'If running low on tokens, produce a minimal valid JSON object ' +
      'rather than truncated output.\n' +
      'Never leave JSON arrays or objects unclosed.'
    );
  }

  /**
   * TR_035 / ADR-057 — resolve the `tokenManagement` knobs for the
   * current run. Reads `HarnessConfig.tokenManagement` when present,
   * falls back to baked-in defaults otherwise.
   */
  private tokenManagementKnobs(): Required<TokenManagementConfig> {
    const cfg = this.harnessConfigForRun?.tokenManagement;
    return {
      promptCompressionThreshold: cfg?.promptCompressionThreshold ?? 6000,
      maxRetryBudgetMultiplier: cfg?.maxRetryBudgetMultiplier ?? 2.0,
      enableDynamicBudget: cfg?.enableDynamicBudget ?? true,
      enableScopeReduction: cfg?.enableScopeReduction ?? true,
    };
  }

  /**
   * TR_035 / ADR-057 — Layer 3 scope reduction. Applies up to three
   * structural text-pattern rewrites to the LAST user message in the
   * caller's `messages` array, stopping as soon as the estimated
   * token count falls below `threshold`. Returns the (possibly
   * unchanged) messages, the corresponding `promptForLog` view, and
   * the name of the last strategy applied (null when no rewrite
   * fired).
   */
  private maybeReducePromptScope(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    promptForLog: string,
    threshold: number,
  ): {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    promptForLog: string;
    strategy: TokenManagementLog['reductionStrategy'];
  } {
    const initialTokens = estimateTokens(promptForLog);
    if (initialTokens <= threshold) {
      return { messages, promptForLog, strategy: null };
    }

    this.tokenLog.warn({
      agentRole: this.agentRole, estimatedTokens: initialTokens, threshold,
    }, 'Prompt exceeds threshold — applying scope reduction');

    // Find the last user-role message (closest to the model). The
    // bulk of every agent's prompt lives there (`buildPrompt` →
    // single user content). System messages are intentionally
    // preserved.
    const lastUserIdx = lastUserIndex(messages);
    if (lastUserIdx < 0) {
      // No user message to compress — bail out.
      return { messages, promptForLog, strategy: null };
    }

    let candidate = messages[lastUserIdx].content;
    let strategy: TokenManagementLog['reductionStrategy'] = null;

    // Strategy 1: summarise prior phase result blocks.
    candidate = summarisePriorPhaseHistory(candidate);
    if (estimateTokens(renderPromptForLog(messages, lastUserIdx, candidate)) <= threshold) {
      strategy = 'phase-history-summarisation';
      this.tokenLog.info({ agentRole: this.agentRole, strategy },
        'Scope reduction applied');
      return finalise(messages, lastUserIdx, candidate, strategy);
    }

    // Strategy 2: compress rule bullets to first sentence.
    candidate = compressRulesSection(candidate);
    if (estimateTokens(renderPromptForLog(messages, lastUserIdx, candidate)) <= threshold) {
      strategy = 'rules-compression';
      this.tokenLog.info({ agentRole: this.agentRole, strategy },
        'Scope reduction applied');
      return finalise(messages, lastUserIdx, candidate, strategy);
    }

    // Strategy 3: trim full architecture block.
    candidate = trimArchitectureContext(candidate);
    strategy = 'architecture-trim';
    const finalTokens = estimateTokens(renderPromptForLog(messages, lastUserIdx, candidate));
    if (finalTokens <= threshold) {
      this.tokenLog.info({ agentRole: this.agentRole, strategy },
        'Scope reduction applied');
    } else {
      this.tokenLog.warn({
        agentRole: this.agentRole, finalTokens,
      }, 'Scope reduction insufficient — truncation retry will handle');
    }
    return finalise(messages, lastUserIdx, candidate, strategy);
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

    // TR_035 / ADR-057 — Layer 1 + 2 also apply to the tool-loop
    // path. Each turn uses the same dynamic budget derived from the
    // initial prompt (the loop history grows, but `max_tokens` only
    // bounds the assistant's response; the request token count is
    // managed by the model's context window). Layer 5 truncation
    // retry is intentionally NOT applied per turn — the existing
    // `capStruck` mechanism already handles end-of-loop runaway.
    const model = client.getModel();
    const cfg = this.tokenManagementKnobs();
    const configuredMaxTokens =
      agentConfig.llm.maxTokens ?? resolveDefaultMaxTokens(model);
    const effectiveMaxTokens = cfg.enableDynamicBudget
      ? calculateDynamicBudget(promptForLog, configuredMaxTokens, model)
      : Math.min(configuredMaxTokens, getModelHardLimit(model));

    const toolCallLog: ToolCallLogEntry[] = [];
    let totalToolCalls = 0;
    let finalText = '';
    // TEST_REPORT_010 Fix 1 — set when the cap is struck on the
    // current turn. The next `completeWithTools` call is made with
    // an empty tools list so the LLM physically cannot request more
    // tool calls; it is forced to produce its final text answer.
    let capStruck = false;

    for (let turn = 0; turn < MAX_TOOL_CALLS + 1; turn++) {
      const result = await client.completeWithTools({
        messages: history,
        tools: capStruck ? [] : tools,
        ...(agentConfig.llm.temperature !== undefined ? { temperature: agentConfig.llm.temperature } : {}),
        ...(agentConfig.llm.reasoningEffort ? { reasoningEffort: agentConfig.llm.reasoningEffort } : {}),
        maxTokens: effectiveMaxTokens,
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

      // TEST_REPORT_010 Fix 1 — cap check is now BATCH-LEVEL, not
      // per-call. The previous per-call `if (totalToolCalls >=
      // MAX_TOOL_CALLS) break;` inside the loop could end the
      // batch mid-way, leaving an assistant message with N
      // tool_calls but only M < N tool responses. OpenAI's strict
      // validation then returns HTTP 400 *"tool_call_ids did not
      // have response messages"* on the next iteration
      // (TEST_REPORT_009 root cause).
      //
      // The fix preserves history consistency by synthesising a
      // rejection `tool` message for EVERY call in an over-cap
      // batch, marking the cap as struck, and continuing the outer
      // loop ONE more time so the LLM can produce its final answer
      // (stopReason === 'stop'). Without that synthesis turn,
      // `finalText` stays empty and the orchestrator fails on
      // "Unexpected end of JSON input".
      if (totalToolCalls + toolCalls.length > MAX_TOOL_CALLS) {
        for (const call of toolCalls) {
          const rejection =
            'Tool call limit reached — no further tool calls ' +
            'permitted. Return your best answer now based on what ' +
            'you have already gathered.';
          history.push({
            role: 'tool',
            toolCallId: call.id,
            content: rejection,
          });
          toolCallLog.push({
            toolName: call.name,
            input: call.input,
            output: rejection,
            isError: true,
            calledAt: new Date(),
            toolSource: 'cap-rejected',
          });
          this.lastToolCallLog = toolCallLog.slice();
        }
        // Drop the tools array for the synthesis turn so the LLM
        // physically cannot request more — it MUST produce text.
        // If it nevertheless requests tools again, the next pass
        // through this block will reject + the for-loop bound
        // (`MAX_TOOL_CALLS + 1` iterations) bails us out.
        capStruck = true;
        continue;
      }

      for (const call of toolCalls) {
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
        // TEST_REPORT_009 Fix 1 — incremental persistence. If the
        // next `completeWithTools` call throws (e.g. rate-limit),
        // the orchestrator can still read every tool call that
        // completed before the throw via `lastToolCallLog`. Without
        // this, the final assignment below was the only writer and
        // a mid-loop throw left the field empty.
        this.lastToolCallLog = toolCallLog.slice();
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
    harnessConfig:
      | {
          agentConfig?: Record<string, {
            rules?: string[];
            verificationGuidance?: string[];
            phaseScopingRules?: string[];
            evaluationCriteria?: string[];
            architectureGuidance?: string[];
          }>;
        }
      | null
      | undefined,
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

// ─── Token-management helpers (TR_035 / ADR-057) ───────────────────────

/**
 * Rough token estimate (4 chars ≈ 1 token). Cheap and good enough
 * for budget routing — every layer that calls this rounds up, so
 * over-estimation is the safe direction.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Reasoning models burn tokens on internal thought before emitting
 *  output. Detected by prefix so newly released gpt-5.x / o3.x
 *  variants pick up the higher default automatically. */
function isReasoningModel(model: string): boolean {
  const reasoningPrefixes = ['o1', 'o3', 'gpt-5'];
  const lower = model.toLowerCase();
  return reasoningPrefixes.some((p) => lower.startsWith(p));
}

/** Layer 1 — model-aware default `max_tokens` when the agent config
 *  did not declare one. Reasoning models get headroom for the
 *  reasoning trace. */
function resolveDefaultMaxTokens(model: string): number {
  return isReasoningModel(model) ? 8000 : 2000;
}

/** Hard cap per model. Used to clamp Layer 2 dynamic budgets and
 *  Layer 5 retry expansions so the platform never sends a `max_tokens`
 *  the provider will reject. Unknown models default to 16384, the
 *  legacy gpt-4 family ceiling. */
function getModelHardLimit(model: string): number {
  const limits: Record<string, number> = {
    'gpt-5.5': 32000,
    'gpt-5.5-pro': 32000,
    'gpt-5': 32000,
    'gpt-4o': 16384,
    'gpt-4o-mini': 16384,
    'o1': 32000,
    'o3': 32000,
  };
  return limits[model] ?? 16384;
}

/** Layer 2 — dynamic budget. `max_tokens` scales with the rendered
 *  prompt size so a small intent doesn't hold a 12k slot and a large
 *  one isn't starved. Reasoning models use a 1.5× input ratio (output
 *  + reasoning), standard models 0.5×. Bounded below by the
 *  configured value and above by the model hard limit. */
function calculateDynamicBudget(
  promptText: string,
  configuredMaxTokens: number,
  model: string,
): number {
  const estimatedInputTokens = estimateTokens(promptText);
  const outputRatio = isReasoningModel(model) ? 1.5 : 0.5;
  const dynamic = Math.ceil(estimatedInputTokens * outputRatio);
  return Math.min(
    Math.max(configuredMaxTokens, dynamic),
    getModelHardLimit(model),
  );
}

/** Index of the last user-role message; -1 if none. */
function lastUserIndex(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

/** Re-render a `promptForLog` view after compressing the message at
 *  `targetIdx`. Joined with double newlines to match how callers like
 *  `applyAgentConfig` produce the single-string log view. */
function renderPromptForLog(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  targetIdx: number,
  newContent: string,
): string {
  return messages
    .map((m, i) => (i === targetIdx ? newContent : m.content))
    .join('\n\n');
}

/** Produce the return triple from a scope-reduction strategy step. */
function finalise(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  targetIdx: number,
  newContent: string,
  strategy: TokenManagementLog['reductionStrategy'],
): {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  promptForLog: string;
  strategy: TokenManagementLog['reductionStrategy'];
} {
  const next = messages.slice();
  next[targetIdx] = { ...messages[targetIdx], content: newContent };
  return {
    messages: next,
    promptForLog: renderPromptForLog(messages, targetIdx, newContent),
    strategy,
  };
}

/** Strategy 1 — replace detailed per-phase result blocks with a
 *  one-line summary. Matches `### Phase N <title>` markdown headers
 *  followed by their body up to the next phase header or top-level
 *  section. */
function summarisePriorPhaseHistory(prompt: string): string {
  return prompt.replace(
    /### Phase \d+[^\n]*\n[\s\S]*?(?=### Phase |\n## |$)/g,
    (match) => {
      const title = match.match(/### (Phase \d+[^\n]*)/)?.[1];
      return title ? `### ${title} — deployed\n` : '';
    },
  );
}

/** Strategy 2 — keep only the first sentence of each rule bullet
 *  under `## Rules` / `## Project rules` headers. Bullets without a
 *  terminating period are truncated to 120 chars. */
function compressRulesSection(prompt: string): string {
  return prompt.replace(
    /(## (?:Rules|Project rules)[^\n]*\n)([\s\S]*?)(\n## |$)/,
    (_, header: string, body: string, end: string) => {
      const compressed = body
        .split('\n')
        .map((l) => {
          if (!l.startsWith('- ')) return l;
          const m = l.match(/^(- [^.]+\.)/);
          return m ? m[1] : l.slice(0, 120);
        })
        .join('\n');
      return `${header}${compressed}${end}`;
    },
  );
}

/** Strategy 3 — strip the full architecture block, leaving the
 *  scoped-per-phase block intact. Matches `## Architecture context`
 *  or `## Full architecture` up to the next top-level `## Scoped` /
 *  `## Task` header. */
function trimArchitectureContext(prompt: string): string {
  return prompt.replace(
    /## (?:Architecture context|Full architecture|Project architecture)[\s\S]*?(?=\n## Scoped|\n## Task|\n## Phase|$)/,
    '',
  );
}
