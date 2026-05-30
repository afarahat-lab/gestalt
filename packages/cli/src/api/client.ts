/**
 * Typed HTTP client for the Gestalt server API.
 * All CLI commands communicate with the server through this client.
 * Never calls the database or LLM providers directly.
 */

export interface ApiClientOptions {
  serverUrl: string;
  token?: string | null;
}

export interface IntentSummary {
  id: string;
  correlationId: string;
  text: string;
  status: string;
  source: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntentDetail extends IntentSummary {
  agentExecutions: AgentExecution[];
  signals: SignalSummary[];
}

export interface AgentExecution {
  id: string;
  agentRole: string;
  status: string;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SignalSummary {
  id: string;
  type: string;
  severity: string;
  sourceAgent: string;
  message: string;
  autoResolvable: boolean;
}

export interface PlatformStatus {
  activeAgents: number;
  timestamp: string;
}

export interface SubmitIntentResponse {
  data: IntentSummary;
}

export interface ProjectRecord {
  id: string;
  name: string;
  gitUrl: string;
  defaultBranch: string;
  createdBy: string;
  createdAt: string;
}

export class GestaltApiClient {
  private readonly baseUrl: string;
  private token: string | null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.serverUrl.replace(/\/$/, '');
    this.token = options.token ?? null;
  }

  setToken(token: string): void {
    this.token = token;
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<{ token: string }> {
    return this.post<{ token: string }>('/auth/login', { email, password });
  }

  async adminSetup(params: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{
    token: string;
    user: { id: string; email: string; displayName: string; role: string; authProvider: string };
  }> {
    return this.post('/auth/admin/setup', params);
  }

  async getMe(): Promise<{ id: string; email: string; role: string }> {
    return this.get('/auth/me');
  }

  // ─── Projects ──────────────────────────────────────────────────────────────

  async createProject(params: {
    name: string;
    gitUrl: string;
    defaultBranch?: string;
    gitToken: string;
  }): Promise<{ data: ProjectRecord }> {
    return this.post('/projects', params);
  }

  async listProjects(): Promise<{ data: ProjectRecord[] }> {
    return this.get('/projects');
  }

  async getProject(id: string): Promise<{ data: ProjectRecord }> {
    return this.get(`/projects/${id}`);
  }

  async initHarness(
    projectId: string,
    projectDescription: string,
  ): Promise<{ data: { committed: boolean; commitSha: string } }> {
    return this.post(`/projects/${projectId}/init-harness`, { projectDescription });
  }

  async updateProjectConfig(
    projectId: string,
    config: { pipeline?: { adapter?: string } },
  ): Promise<{
    data: { updated: boolean; adapter?: string; commitSha?: string; reason?: string };
  }> {
    return this.post(`/projects/${projectId}/config`, config);
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  async health(): Promise<{ status: string; version: string }> {
    return this.get('/health');
  }

  // ─── Intents ───────────────────────────────────────────────────────────────

  async submitIntent(params: {
    text: string;
    projectId: string;
    priority?: string;
  }): Promise<SubmitIntentResponse> {
    return this.post('/intents', params);
  }

  async getIntent(id: string): Promise<{ data: IntentDetail }> {
    return this.get(`/intents/${id}`);
  }

  async listIntents(params: {
    projectId: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: IntentSummary[]; total: number }> {
    return this.get('/intents', params as Record<string, unknown>);
  }

  async clarifyIntent(id: string, params: {
    clarification: string;
    ambiguityId: string;
  }): Promise<void> {
    await this.post(`/intents/${id}/clarify`, params);
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  async getStatus(): Promise<{ data: PlatformStatus }> {
    return this.get('/status');
  }

  async getActiveAgents(): Promise<{ data: AgentExecution[] }> {
    return this.get('/status/agents');
  }

  // ─── SSE stream ────────────────────────────────────────────────────────────

  /**
   * Opens a Server-Sent Events connection and yields events.
   * Returns an async generator — use for..await to consume.
   */
  async *streamEvents(): AsyncGenerator<Record<string, unknown>> {
    const url = `${this.baseUrl}/events?token=${encodeURIComponent(this.token ?? '')}`;
    const EventSourceMod = (await import('eventsource')) as unknown as {
      default: typeof import('eventsource');
    };
    const EventSourceCtor = (EventSourceMod.default ?? EventSourceMod) as unknown as new (url: string) => {
      onmessage: ((e: { data: string }) => void) | null;
      onerror: ((e: unknown) => void) | null;
      close: () => void;
    };
    const source = new EventSourceCtor(url);

    try {
      for await (const event of eventSourceToAsyncIterable(source)) {
        yield event;
      }
    } finally {
      source.close();
    }
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  private async get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, String(v));
      });
    }
    const res = await fetch(url.toString(), { headers: this.authHeaders() });
    if (!res.ok) throw new ApiClientError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiClientError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`API error ${status}: ${body}`);
    this.name = 'ApiClientError';
  }
}

// ─── SSE helper ───────────────────────────────────────────────────────────────

interface EventSourceLike {
  onmessage: ((e: { data: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  close: () => void;
}

function eventSourceToAsyncIterable(
  source: EventSourceLike,
): AsyncIterable<Record<string, unknown>> {
  return {
    [Symbol.asyncIterator]() {
      const queue: Record<string, unknown>[] = [];
      let resolve: (() => void) | null = null;
      let done = false;

      source.onmessage = (e: { data: string }) => {
        try {
          queue.push(JSON.parse(e.data) as Record<string, unknown>);
          resolve?.();
          resolve = null;
        } catch { /* ignore malformed */ }
      };

      source.onerror = () => {
        done = true;
        resolve?.();
        resolve = null;
      };

      return {
        async next() {
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          if (done) return { value: undefined as never, done: true };
          await new Promise<void>((r) => { resolve = r; });
          if (done) return { value: undefined as never, done: true };
          return { value: queue.shift()!, done: false };
        },
      };
    },
  };
}
