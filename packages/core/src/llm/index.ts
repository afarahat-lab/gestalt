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
  /**
   * GPT-5.5+ "responses" API only — controls how much internal
   * thinking the model does before responding. Silently dropped on
   * `chat-completions` clients; no error. See
   * `AgentLlmConfig.reasoningEffort`.
   */
  reasoningEffort?: 'xhigh' | 'high' | 'medium' | 'low' | 'non-reasoning';
  correlationId?: string;             // for log tracing
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
  model: string;
  durationMs: number;
  /** TR_035 / ADR-057 — OpenAI `finish_reason` surfaced so the
   *  `BaseLLMAgent` truncation-retry layer can detect `'length'`
   *  responses and re-issue the call with a larger budget. Unknown
   *  values (custom providers without the field) collapse to
   *  `'unknown'`. */
  finishReason: 'stop' | 'length' | 'content_filter' | 'unknown';
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
  /** Same semantics as `LLMRequest.reasoningEffort` — only applied
   *  when the resolved client's `apiShape === 'responses'`. */
  reasoningEffort?: 'xhigh' | 'high' | 'medium' | 'low' | 'non-reasoning';
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
   * The provider base URL this client is bound to (TR_014). Exposed so
   * shell-out integrations (Aider) can pass `OPENAI_API_BASE` to the
   * child process and route through the same endpoint the rest of
   * the platform uses, without re-resolving the registry row.
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * The provider API key this client is bound to (TR_014). Resolved
   * via the same registry/vault precedence the LLM call path uses.
   * Exposed for shell-out integrations (Aider) that need to forward
   * the credential to a child process. Callers MUST treat the return
   * value as a secret — never log it, never include it in error
   * messages or telemetry.
   */
  getApiKey(): string {
    return this.config.apiKey;
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
      ...tokenLimitField(this.config.apiShape, request.maxTokens ?? 4096),
      ...temperatureField(this.config.apiShape, request.temperature ?? 0.2),
      ...reasoningEffortField(this.config.apiShape, request.reasoningEffort),
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
      const rawFinish = data.choices[0]?.finish_reason;
      const finishReason: LLMResponse['finishReason'] =
        rawFinish === 'stop' || rawFinish === 'length' || rawFinish === 'content_filter'
          ? rawFinish
          : 'unknown';

      return {
        content,
        tokensUsed,
        model: data.model ?? this.config.model,
        durationMs: Date.now() - startedAt,
        finishReason,
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

    // TEST_REPORT_010 — when callers pass an empty tools array
    // (cap-rejection synthesis turn), omit both `tools` and
    // `tool_choice` from the body so OpenAI returns a plain text
    // completion. Sending `tools: []` + `tool_choice: 'auto'`
    // returns HTTP 400 on chat-completions: *"tool_choice cannot
    // be specified without 'tools' parameter"*.
    const body = {
      model: this.config.model,
      messages,
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
      ...tokenLimitField(this.config.apiShape, request.maxTokens ?? 4096),
      ...temperatureField(this.config.apiShape, request.temperature ?? 0.2),
      ...reasoningEffortField(this.config.apiShape, request.reasoningEffort),
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
  _registryClients.clear();
  const client = new LLMClient(config);
  _clients.set(config.model, client);
  log.info({ model: config.model, baseUrl: config.baseUrl }, 'LLM client initialised');
  return client;
}

// ─── Registry-aware factory (Session 3 — platform LLM registry) ──────────────

/**
 * Per-(model, baseUrl) cache for registry-backed clients. Keyed
 * `${modelString}|${baseUrl}` because the same model name can be
 * registered against multiple endpoints (e.g. `gpt-4o` against OpenAI
 * direct vs. an Azure OpenAI deployment vs. a vLLM proxy) and each
 * needs its own client.
 */
const _registryClients = new Map<string, LLMClient>();

function registryCacheKey(model: string, baseUrl: string): string {
  return `${model}|${baseUrl}`;
}

/**
 * Returns the LLMClient for a model string, consulting the platform
 * LLM registry (migration 014) when one is available.
 *
 * Resolution order:
 *   1. `undefined` → platform default (delegates to `getLLMClient()`)
 *   2. Lookup `modelString` in the registry via the resolver injected
 *      by the server at boot. Match → fresh client using the
 *      registered `baseUrl` + `process.env[apiKeyEnv]`. Cached on
 *      `(model, baseUrl)` so the next call is fast
 *   3. No match → fall back to `getLLMClient(modelString)`, which
 *      reuses the platform-default endpoint with the override model
 *      name (the legacy behaviour before the registry shipped)
 *
 * The resolver is injected via `setLLMRegistryResolver` to avoid a
 * direct `getRepositories()` import here — keeps llm/index.ts free of
 * sibling-module dependencies and makes test setup trivial (the test
 * just passes its own resolver).
 */
export async function getLLMClientForModel(modelString?: string): Promise<LLMClient> {
  if (!_defaultConfig) {
    throw new Error('LLM client not initialised. Call createLLMClient(config) first.');
  }
  // TEST_REPORT_002 Fix 1 — when no per-agent override is supplied,
  // resolve to the env-default model AND let it flow through the
  // registry path below. The previous short-circuit
  // (`if (!modelString) return getLLMClient();`) skipped the
  // registry for the default model, so the operator's
  // `platform_llms` row's `apiShape` was silently ignored. Now the
  // env-default's model name is looked up just like any other,
  // picking up the registered apiShape when present and falling
  // through to the env-default client when no row matches.
  const targetModel = modelString ?? _defaultConfig.model;
  if (!_registryResolver) {
    // The resolver is wired at server boot. Tests that don't wire
    // it can still use `getLLMClient(model)` directly.
    return getLLMClient(targetModel);
  }

  let registered: RegistryEntry | null;
  try {
    registered = await _registryResolver(targetModel);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), modelString: targetModel },
      'LLM registry lookup failed — falling back to default endpoint',
    );
    return getLLMClient(targetModel);
  }

  if (!registered) {
    // Model not in the registry → operator wants an ad-hoc override
    // against the platform-default endpoint. Same as before.
    return getLLMClient(targetModel);
  }

  const cacheKey = registryCacheKey(registered.modelString, registered.baseUrl);
  const cached = _registryClients.get(cacheKey);
  if (cached) return cached;

  // The resolver returned the FULLY RESOLVED API key — the server's
  // injected resolver (Session 4 — vault precedence) does the
  // `secret_id → vault decrypt` OR `apiKeyEnv → process.env` lookup
  // before handing us the string. We never see which storage path
  // the operator chose.
  if (!registered.apiKey) {
    log.warn(
      { modelString },
      'Registered LLM apiKey resolved to empty string — vault secret unset, env var empty, or both — LLM calls will likely fail',
    );
  }
  const overrideConfig: LLMConfig = {
    ..._defaultConfig,
    model: registered.modelString,
    baseUrl: registered.baseUrl,
    apiKey: registered.apiKey,
    apiShape: registered.apiShape ?? 'chat-completions',
  };
  const client = new LLMClient(overrideConfig);
  _registryClients.set(cacheKey, client);
  log.info(
    { model: registered.modelString, baseUrl: registered.baseUrl },
    'LLM client created from registry entry',
  );
  return client;
}

/**
 * Minimal shape the resolver returns — modelString + baseUrl from
 * the registry row, plus the RESOLVED API key (the server-side
 * resolver did either a vault decrypt or a `process.env[apiKeyEnv]`
 * lookup before constructing this object). Defined locally so
 * `llm/index.ts` does not import from `repository/index.ts` or
 * `secrets/vault.ts` — keeps dependency direction explicit.
 */
interface RegistryEntry {
  modelString: string;
  baseUrl: string;
  apiKey: string;
  /** Wire shape — see `tokenLimitField` / `temperatureField` below.
   *  Optional for back-compat with resolvers that pre-date migration 023. */
  apiShape?: 'chat-completions' | 'responses';
}

type RegistryResolver = (modelString: string) => Promise<RegistryEntry | null>;

let _registryResolver: RegistryResolver | null = null;

/**
 * Wires the platform-LLM lookup function. Called once at server boot
 * after the database adapter is ready. Passing `null` disables the
 * registry path (the function falls back to the legacy
 * `getLLMClient(model)` behaviour).
 */
export function setLLMRegistryResolver(resolver: RegistryResolver | null): void {
  _registryResolver = resolver;
  // Invalidate the (model, baseUrl) cache so the next call rebuilds
  // against the new resolver — important for test teardown and for
  // operators who hot-edit a registry entry's baseUrl.
  _registryClients.clear();
}

/**
 * Test/debug only — clears every cached client. Production never
 * calls this directly; `createLLMClient` already resets state when
 * the default config changes.
 */
export function _resetLLMRegistryCache(): void {
  _registryClients.clear();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Per-API-shape parameter spelling.
 *
 *   - 'chat-completions' (default) — classic Chat Completions body:
 *     `max_tokens` + `temperature`. Covers gpt-4o*, gpt-4-turbo,
 *     gpt-3.5-turbo, Anthropic-proxy, Ollama, vLLM-in-OpenAI-mode.
 *   - 'responses' — reasoning-model body still hitting
 *     /chat/completions: `max_completion_tokens` only, temperature
 *     omitted (reasoning models always run at temperature=1 and
 *     return HTTP 400 on `max_tokens`).
 *
 * Returning a spreadable object lets the caller compose without
 * a branching ladder around the body literal.
 */
function tokenLimitField(
  apiShape: 'chat-completions' | 'responses' | undefined,
  maxTokens: number,
): Record<string, number> {
  return apiShape === 'responses'
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

function temperatureField(
  apiShape: 'chat-completions' | 'responses' | undefined,
  temperature: number,
): Record<string, number> {
  // Reasoning models silently ignore temperature; omit it to avoid
  // log noise + future stricter validation on the provider side.
  return apiShape === 'responses' ? {} : { temperature };
}

/**
 * GPT-5.5+ "responses" body field. Only emitted when the client's
 * `apiShape === 'responses'` AND the caller supplied a value; the
 * field is invalid on classic chat-completions endpoints and on
 * non-reasoning models. Returning an empty object lets the caller
 * spread unconditionally.
 */
function reasoningEffortField(
  apiShape: 'chat-completions' | 'responses' | undefined,
  reasoningEffort: 'xhigh' | 'high' | 'medium' | 'low' | 'non-reasoning' | undefined,
): Record<string, string> {
  if (apiShape !== 'responses' || !reasoningEffort) return {};
  return { reasoning_effort: reasoningEffort };
}

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
  // TR_050 — transient network errors raised by the underlying
  // `fetch` (TypeError: fetch failed / ECONNRESET / ENOTFOUND /
  // socket hang up) are intermittent provider blips, not
  // permanent failures. Mark them retryable so the LLM call's
  // existing exponential-backoff retry loop covers them rather
  // than killing the whole cycle on a single hiccup. Closes the
  // TR_033 follow-up "transient fetch failed killed an attempt
  // because classifyError treats it as retryable: false".
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    return { type: 'provider-error', message: error.message, retryable: true };
  }
  if (
    error instanceof Error
    && /ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(error.message)
  ) {
    return { type: 'provider-error', message: error.message, retryable: true };
  }
  return { type: 'provider-error', message: String(error), retryable: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
