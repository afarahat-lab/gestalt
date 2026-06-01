/**
 * @gestalt/core/llm
 *
 * LLM provider abstraction. All agent LLM calls go through this module.
 * Agents never import provider SDKs directly (GP-006).
 *
 * Supports any OpenAI-compatible endpoint:
 *   - Azure OpenAI
 *   - OpenAI
 *   - Ollama (v1-compatible endpoint)
 *   - vLLM
 *   - Any other OpenAI-compatible server
 *
 * Features:
 *   - Automatic retry with exponential backoff
 *   - Token usage tracking (logged per call)
 *   - Timeout enforcement
 *   - JSON response mode enforcement for structured outputs
 */

import type { LLMConfig } from '../config/index';
import type { Result } from '../types';
import { ok, err } from '../types';
import { createContextLogger } from '../logger/index';

const log = createContextLogger({ module: 'llm' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  responseFormat?: 'text' | 'json';   // 'json' enforces JSON output
  maxTokens?: number;
  temperature?: number;
  correlationId?: string;             // for log tracing
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
  model: string;
  durationMs: number;
}

// ─── Tool use (ADR-038) ──────────────────────────────────────────────────────

import type { ToolDefinition } from '../types';

/**
 * One assistant-turn tool call as received from the provider. The
 * OpenAI shape carries the argument list as a JSON-string; we parse
 * it once here so callers can dispatch on an already-typed
 * `Record<string, unknown>`.
 */
export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * One conversation turn. The user/assistant variants mirror the
 * normal chat-completions shape; the `tool` variant is the
 * provider-fed-back tool result message (OpenAI: `role: 'tool',
 * tool_call_id, content`).
 */
export type ToolLoopMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: LLMToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface CompleteWithToolsRequest {
  messages: ToolLoopMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  correlationId?: string;
}

export interface CompleteWithToolsResponse {
  /** Text content the assistant emitted on this turn — may be empty
   *  when the assistant only emitted tool calls. */
  text: string;
  /** Tool calls the assistant emitted on this turn. Empty array when
   *  the model decided not to call any tool. */
  toolCalls: LLMToolCall[];
  /** OpenAI finish_reason. The agent loop stops on `stop`; `tool_calls`
   *  means "execute these and call me again". */
  stopReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown';
  tokensUsed: number;
  model: string;
  durationMs: number;
}

export interface LLMError {
  type: 'timeout' | 'rate-limit' | 'provider-error' | 'parse-error';
  message: string;
  retryable: boolean;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class LLMClient {
  private readonly config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * The model name this client is bound to. Useful for the orchestrator
   * when it persists `agent_execution_logs.model_used` — the value here
   * is exactly what gets sent on the wire.
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * Sends a request to the LLM provider.
   * Retries on transient errors (rate limits, timeouts).
   * Returns a typed Result — never throws.
   */
  async complete(request: LLMRequest): Promise<Result<LLMResponse, LLMError>> {
    const childLog = createContextLogger({
      module: 'llm',
      correlationId: request.correlationId,
      model: this.config.model,
    });

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
        childLog.info({ attempt, backoffMs }, 'LLM retry after backoff');
        await sleep(backoffMs);
      }

      try {
        const response = await this.callProvider(request, childLog);
        childLog.info(
          { tokensUsed: response.tokensUsed, durationMs: response.durationMs },
          'LLM call completed',
        );
        return ok(response);
      } catch (error) {
        const llmError = classifyError(error);
        childLog.warn({ error: llmError, attempt }, 'LLM call failed');

        if (!llmError.retryable || attempt === this.config.maxRetries) {
          return err(llmError);
        }
      }
    }

    return err({ type: 'provider-error', message: 'Max retries exceeded', retryable: false });
  }

  /**
   * Single-turn tool-call completion (ADR-038).
   *
   * Sends the conversation + tool definitions in the OpenAI
   * `tools[{ type: 'function', function: { name, description,
   * parameters } }]` shape. Returns whatever the assistant emitted on
   * THIS turn — the agent loop (`BaseLLMAgent.callLLMWithTools`) calls
   * this method repeatedly, executing tool calls between turns, until
   * `stopReason === 'stop'` or the safety cap is reached.
   *
   * No retries today — the caller's loop is the retry boundary, and
   * the tool-use loop's own iteration cap (`MAX_TOOL_CALLS`) bounds
   * total provider calls per agent run.
   */
  async completeWithTools(
    request: CompleteWithToolsRequest,
  ): Promise<Result<CompleteWithToolsResponse, LLMError>> {
    const childLog = createContextLogger({
      module: 'llm',
      correlationId: request.correlationId,
      model: this.config.model,
    });
    try {
      const result = await this.callProviderWithTools(request);
      childLog.info(
        {
          tokensUsed: result.tokensUsed,
          stopReason: result.stopReason,
          toolCallCount: result.toolCalls.length,
        },
        'LLM tool-loop turn completed',
      );
      return ok(result);
    } catch (error) {
      const llmError = classifyError(error);
      childLog.warn({ error: llmError }, 'LLM tool-loop turn failed');
      return err(llmError);
    }
  }

  /**
   * Convenience method for JSON-structured responses.
   * Parses the response and strips markdown code fences.
   */
  async completeJson<T>(request: Omit<LLMRequest, 'responseFormat'>): Promise<Result<T, LLMError | SyntaxError>> {
    const result = await this.complete({ ...request, responseFormat: 'json' });
    if (!result.ok) return result;

    try {
      const clean = result.value.content
        .replace(/^```(?:json)?\n?/m, '')
        .replace(/\n?```$/m, '')
        .trim();
      return ok(JSON.parse(clean) as T);
    } catch (e) {
      return err(e instanceof SyntaxError ? e : new SyntaxError(String(e)));
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async callProvider(request: LLMRequest, _childLog: ReturnType<typeof createContextLogger>): Promise<LLMResponse> {
    const startedAt = Date.now();

    const body = {
      model: this.config.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.2,
      ...(request.responseFormat === 'json'
        ? { response_format: { type: 'json_object' } }
        : {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new ProviderError(response.status, text);
      }

      const data = await response.json() as OpenAIResponse;
      const content = data.choices[0]?.message?.content ?? '';
      const tokensUsed = data.usage?.total_tokens ?? 0;

      return {
        content,
        tokensUsed,
        model: data.model ?? this.config.model,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Tool-loop provider call ──────────────────────────────────────────────

  private async callProviderWithTools(
    request: CompleteWithToolsRequest,
  ): Promise<CompleteWithToolsResponse> {
    const startedAt = Date.now();

    // ToolDefinition → OpenAI function tool format. The wire shape
    // is `tools: [{ type: 'function', function: { name, description,
    // parameters } }]`. `inputSchema` IS the parameters JSON Schema.
    const tools = request.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const messages = request.messages.map(toolLoopMessageToOpenAI);

    const body = {
      model: this.config.model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.2,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new ProviderError(response.status, text);
      }

      const data = await response.json() as OpenAIResponse;
      const choice = data.choices[0];
      const message = choice?.message ?? {};
      const text = typeof message.content === 'string' ? message.content : '';
      const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

      const toolCalls: LLMToolCall[] = rawToolCalls.map((c) => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = c.function?.arguments ? JSON.parse(c.function.arguments) as Record<string, unknown> : {};
        } catch {
          // Provider returned non-JSON arguments — pass the raw string
          // through under `raw` so the agent loop's `executeFileTool`
          // call can produce a typed error result rather than throwing.
          parsed = { raw: c.function?.arguments ?? '' };
        }
        return {
          id: c.id,
          name: c.function?.name ?? '',
          input: parsed,
        };
      });

      const finishReason = choice?.finish_reason;
      const stopReason: CompleteWithToolsResponse['stopReason'] =
        finishReason === 'stop' || finishReason === 'tool_calls' ||
        finishReason === 'length' || finishReason === 'content_filter'
          ? finishReason
          : 'unknown';

      return {
        text,
        toolCalls,
        stopReason,
        tokensUsed: data.usage?.total_tokens ?? 0,
        model: data.model ?? this.config.model,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Maps the platform-facing tool-loop message shape to the OpenAI wire
 * shape. Keeps the wrapping logic local so callers (BaseLLMAgent) deal
 * with platform types only.
 */
function toolLoopMessageToOpenAI(m: ToolLoopMessage): Record<string, unknown> {
  switch (m.role) {
    case 'system':
    case 'user':
      return { role: m.role, content: m.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls && m.toolCalls.length > 0
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      };
    case 'tool':
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * One LLMClient instance per model name. The default model (set at
 * server startup via createLLMClient) is the first entry; per-agent
 * overrides land additional entries on first use and stay cached for
 * the lifetime of the process. Override clients reuse the default
 * config's baseUrl + apiKey and differ only in `model` — this matches
 * how Azure OpenAI deployments + every OpenAI-compatible provider
 * actually work today.
 */
const _clients = new Map<string, LLMClient>();
let _defaultConfig: LLMConfig | null = null;

/**
 * Returns an LLMClient for the given model name.
 *
 *   - `undefined` or the default model → the default client.
 *   - Any other model name → a cached override client (created on
 *     first use, reused thereafter).
 *
 * Throws if `createLLMClient(config)` has not yet been called.
 */
export function getLLMClient(model?: string): LLMClient {
  if (!_defaultConfig) {
    throw new Error('LLM client not initialised. Call createLLMClient(config) first.');
  }
  const targetModel = model ?? _defaultConfig.model;
  const cached = _clients.get(targetModel);
  if (cached) return cached;
  // First use of this model — create a derived client.
  const overrideConfig: LLMConfig = { ..._defaultConfig, model: targetModel };
  const client = new LLMClient(overrideConfig);
  _clients.set(targetModel, client);
  log.info({ model: targetModel }, 'LLM client created for model override');
  return client;
}

/**
 * Initialises the default LLM client at server startup with the
 * loaded platform config. Re-calling resets the registry (intended
 * for test setup; production calls once).
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  _defaultConfig = config;
  _clients.clear();
  const client = new LLMClient(config);
  _clients.set(config.model, client);
  log.info({ model: config.model, baseUrl: config.baseUrl }, 'LLM client initialised');
  return client;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface OpenAIResponse {
  model: string;
  choices: Array<{
    message: {
      content?: string | null;
      // OpenAI tool-call response shape (ADR-038). Present when the
      // model emitted tool calls on this turn; `arguments` is a
      // JSON-encoded string the caller parses.
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { total_tokens: number };
}

class ProviderError extends Error {
  constructor(public readonly status: number, body: string) {
    super(`Provider error ${status}: ${body}`);
  }
}

function classifyError(error: unknown): LLMError {
  if (error instanceof Error && error.name === 'AbortError') {
    return { type: 'timeout', message: 'LLM request timed out', retryable: true };
  }
  if (error instanceof ProviderError) {
    if (error.status === 429) {
      return { type: 'rate-limit', message: 'Rate limit exceeded', retryable: true };
    }
    if (error.status >= 500) {
      return { type: 'provider-error', message: error.message, retryable: true };
    }
    return { type: 'provider-error', message: error.message, retryable: false };
  }
  return { type: 'provider-error', message: String(error), retryable: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
