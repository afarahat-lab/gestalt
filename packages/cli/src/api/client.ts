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

export interface AlertSummary {
  id: string;
  correlationId: string;
  intentId: string | null;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  requiredAction: string;
  context: Record<string, unknown>;
  createdAt: string;
  acknowledgedAt: string | null;
  // Enrichment fields — present per alert type (see oversight/routes.ts)
  intentText?: string | null;
  intentStatus?: string | null;
  findingType?: string | null;
  affectedFiles?: string[] | null;
  evidence?: string | null;
  attemptCount?: number | null;
  suggestedAction?: string | null;
  breachMessage?: string | null;
  breachLocation?: { file: string; line?: number; column?: number; rule?: string } | null;
  breachAgent?: string | null;
}

export type AlertDetail = AlertSummary;

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

// ─── Agents (Step 2 — ADR-037) ───────────────────────────────────────────────

export interface AgentSummary {
  name: string;
  role: string;
  goal: string;
  modelOverride: string | null;
  temperature: number | null;
  maxTokens: number | null;
  promptExtensionCount: number;
  /** ADR-038 — resolved built-in tool names. */
  builtinTools?: string[];
  /** ADR-039 — declared MCP server names from `tools.mcp[]`. */
  mcpServers?: string[];
}

export interface CustomAgentDefinition {
  name: string;
  role: string;
  goal: string;
  runsAfter?: string;
  llm: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  prompt: string;
}

export interface AgentsListResponse {
  frameworkAgents: AgentSummary[];
  customAgents: CustomAgentDefinition[];
  /** Amendment 2026-06 — three-layer partition of the framework
   *  agents. Optional on the wire so older server builds without
   *  the field don't break the CLI's parse. */
  layers?: {
    generate: { framework: AgentSummary[]; custom: CustomAgentDefinition[] };
    gate: { framework: AgentSummary[]; infrastructure: string[] };
    maintenance: { llm: AgentSummary[]; infrastructure: string[] };
  };
}

export interface AgentsValidateResponse {
  valid: boolean;
  warnings: string[];
  customAgents: number;
  /** Resolved custom-agent execution order from the scheduler.
   *  Empty array when no customs are defined or when scheduling
   *  threw. ADR-037 / runs_after enforcement. */
  executionOrder?: Array<{ name: string; runsAfter: string }>;
  /** Scheduling error (unknown runs_after target, cycle, self-loop).
   *  When present, `valid` is `false` and `executionOrder` is empty. */
  error?: string;
}

// ─── Users + memberships (migration 010) ─────────────────────────────────────

export type UserRoleString = 'platform-admin' | 'user';
export type ProjectRoleString = 'project-admin' | 'editor' | 'reader';

// ─── Interventions (ADR-021, migration 011) ──────────────────────────────────

export type InterventionActionString =
  | 'resume' | 'abort' | 'acknowledge-breach' | 'request-clarification';

export interface InterventionResponse {
  action: InterventionActionString;
  intentId: string;
  status: string;
}

export interface InterventionRecordDto {
  id: string;
  correlationId: string;
  intentId: string;
  alertId: string | null;
  action: InterventionActionString;
  actorId: string;
  notes: string | null;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  role: UserRoleString;
  authProvider: string;
  deactivatedAt: string | null;
  lastLoginAt: string;
  createdAt: string;
}

export interface MembershipRecord {
  id: string;
  userId: string;
  projectId: string;
  role: ProjectRoleString;
  assignedBy: string | null;
  createdAt: string;
}

export interface UserDetail extends UserSummary {
  memberships: MembershipRecord[];
}

export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string;
  platformRole: UserRoleString;
  projectRole: ProjectRoleString;
  deactivatedAt: string | null;
  assignedBy: string | null;
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

  // ─── Maintenance ───────────────────────────────────────────────────────────

  async triggerMaintenance(
    agentRole: string,
    projectId: string,
  ): Promise<{ data: { id: string; agentRole: string; status: string; intentsQueued: number; directFixes: number; durationMs: number | null } }> {
    return this.post('/maintenance/trigger', { agentRole, projectId });
  }

  async resetMaintenanceFindings(projectId: string): Promise<{ data: { deleted: number } }> {
    return this.delete(`/maintenance/findings/${projectId}`);
  }

  // ─── Agents (agents.yaml inspection — ADR-037) ────────────────────────────

  async listAgents(projectId: string): Promise<{ data: AgentsListResponse }> {
    return this.get(`/projects/${projectId}/agents`);
  }

  async validateAgents(projectId: string): Promise<{ data: AgentsValidateResponse }> {
    return this.get(`/projects/${projectId}/agents/validate`);
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────

  async listAlerts(params?: {
    acknowledged?: boolean;
    severity?: string;
  }): Promise<{ data: AlertSummary[]; total: number }> {
    return this.get('/alerts', params);
  }

  async getAlert(id: string): Promise<{ data: AlertDetail }> {
    return this.get(`/alerts/${id}`);
  }

  async submitAlertFixIntent(
    id: string,
    additionalContext?: string,
  ): Promise<{ data: { intentId: string; correlationId: string; intentText: string } }> {
    return this.post(`/alerts/${id}/fix-intent`, { additionalContext: additionalContext ?? '' });
  }

  async acknowledgeAlert(
    id: string,
    notes?: string,
  ): Promise<{ data: AlertDetail }> {
    return this.post(`/alerts/${id}/acknowledge`, { notes: notes ?? '' });
  }

  // ─── Interventions (ADR-021) ──────────────────────────────────────────────

  async submitIntervention(params: {
    intentId: string;
    action: InterventionActionString;
    notes?: string;
  }): Promise<{ data: InterventionResponse }> {
    return this.post('/interventions', params);
  }

  async listInterventions(intentId: string): Promise<{ data: InterventionRecordDto[] }> {
    return this.get('/interventions', { intentId });
  }

  // ─── Users + memberships (migration 010) ──────────────────────────────────

  async listUsers(params?: { search?: string }): Promise<{ data: UserSummary[] }> {
    return this.get('/users', params);
  }

  async createUser(params: {
    email: string;
    displayName: string;
    role: 'platform-admin' | 'user';
    password?: string;
    projectAssignments?: Array<{ projectId: string; role: ProjectRoleString }>;
  }): Promise<{ data: UserSummary }> {
    return this.post('/users', params);
  }

  async getUserDetail(id: string): Promise<{ data: UserDetail }> {
    return this.get(`/users/${id}`);
  }

  async updateUser(
    id: string,
    params: { role?: 'platform-admin' | 'user'; displayName?: string },
  ): Promise<{ data: UserSummary }> {
    return this.patch(`/users/${id}`, params);
  }

  async deactivateUser(id: string): Promise<void> {
    await this.delete(`/users/${id}`);
  }

  async listProjectMembers(projectId: string): Promise<{ data: ProjectMember[] }> {
    return this.get(`/projects/${projectId}/members`);
  }

  async addProjectMember(
    projectId: string,
    params: { userId: string; role: ProjectRoleString },
  ): Promise<{ data: MembershipRecord }> {
    return this.post(`/projects/${projectId}/members`, params);
  }

  async updateProjectMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRoleString,
  ): Promise<{ data: MembershipRecord }> {
    return this.patch(`/projects/${projectId}/members/${userId}`, { role });
  }

  async removeProjectMember(projectId: string, userId: string): Promise<void> {
    await this.delete(`/projects/${projectId}/members/${userId}`);
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

  private async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiClientError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private async delete<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new ApiClientError(res.status, await res.text());
    if (res.status === 204) return undefined as unknown as T;
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
