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
  choices: Array<{ message: { content: string } }>;
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
