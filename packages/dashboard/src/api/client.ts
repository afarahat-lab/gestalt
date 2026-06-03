/**
 * Typed HTTP client for the Gestalt server API.
 * All dashboard data access goes through this client — never raw fetch.
 *
 * Uses Server-Sent Events for live updates.
 */

import type {
  IntentSummary, IntentDetail, Alert, InterventionRequest,
  InterventionRecord, InterventionResponse,
  MaintenanceRunSummary, LiveEvent, DashboardUser,
  AgentExecutionSummary, ProjectSummary, SignalSummary,
  DeploymentSummary,
  UserSummary, UserDetail, MembershipSummary, ProjectMember,
  CreateUserParams, UserRole, ProjectRole,
  ProjectConfigResponse, EditableAgentConfig, ProjectConfigCustomAgent,
  PlatformLLM, LlmTestResult, PlatformSecret,
  PlatformTemplateSummary, PlatformTemplate, TemplateVariable,
  PlatformMcpServer, PlatformMcpTestResult, PlatformToolInfo,
  IdentityProvider, IdentityState, RoleMapping,
  PlatformGroup, GroupMember, GroupProjectAssignment, ProjectGroupAssignment,
} from '../types';

export class DashboardApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string): void {
    this.token = token;
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<{ token: string; user: DashboardUser }> {
    return this.post('/auth/login', { email, password });
  }

  async getCurrentUser(): Promise<DashboardUser> {
    return this.get('/auth/me');
  }

  // ─── Intents ───────────────────────────────────────────────────────────────

  async listIntents(params?: {
    projectId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: IntentSummary[]; total: number }> {
    return this.get('/intents', params);
  }

  async getIntent(id: string): Promise<{ data: IntentDetail }> {
    return this.get(`/intents/${id}`);
  }

  async clarifyIntent(
    id: string,
    body: { clarification: string; ambiguityId?: string },
  ): Promise<{ data: { resumed: true; acknowledgedAlerts: number } }> {
    return this.post(`/intents/${id}/clarify`, body);
  }

  // ─── Execution detail ──────────────────────────────────────────────────────

  /**
   * Per-execution snapshot used by the IntentDetail accordion when an
   * operator clicks a single agent run open. Returns null `log` for
   * pre-migration-007 executions; the UI renders a "log not available"
   * placeholder in that case.
   */
  async getExecutionLog(executionId: string): Promise<{
    data: {
      execution: AgentExecutionSummary;
      log: {
        prompt: string | null;
        llmResponse: string | null;
        resultStatus: string;
        artifactPaths: string[];
        signalTypes: string[];
        errorMessage: string | null;
        modelUsed: string | null;
      } | null;
      artifacts: Array<{ id: string; type: string; path: string; content: string }>;
      signals: SignalSummary[];
    };
  }> {
    return this.get(`/executions/${executionId}/log`);
  }

  // ─── Projects ──────────────────────────────────────────────────────────────

  async listProjects(): Promise<{ data: ProjectSummary[] }> {
    return this.get('/projects');
  }

  /** Platform-admin only — register a new project with its Git
   *  credentials. The server auto-assigns the creator as
   *  `project-admin` so they immediately survive the membership-aware
   *  GET /projects filter. */
  async createProject(body: {
    name: string;
    gitUrl: string;
    defaultBranch?: string;
    gitToken: string;
  }): Promise<{ data: ProjectSummary }> {
    return this.post('/projects', body);
  }

  /** Server clones the repo, writes harness files, commits, and
   *  pushes. Idempotent on the harness commit when the files already
   *  match the template. */
  async initProjectHarness(
    projectId: string,
    body: { projectDescription: string },
  ): Promise<{ data: { commitSha: string; pushedTo: string } }> {
    return this.post(`/projects/${projectId}/init-harness`, body);
  }

  /** Platform-admin only — hard-deletes the project row + dependent
   *  rows (memberships, git credentials, maintenance runs). Refuses
   *  with `PROJECT_HAS_ACTIVE_INTENTS` when any cycle is in flight.
   *  The remote Git repository is NOT touched. */
  async deleteProject(projectId: string): Promise<void> {
    await this.delete(`/projects/${projectId}`);
  }

  // ─── Alerts (additional) ───────────────────────────────────────────────────

  async acknowledgeAlert(id: string, notes?: string): Promise<{ data: Alert }> {
    return this.post(`/alerts/${id}/acknowledge`, { notes: notes ?? '' });
  }

  /**
   * Submit a fix intent built server-side from the alert's enriched
   * context. The alert is acknowledged as part of the same call, so the
   * card disappears from the unacknowledged list on the next refresh.
   * `additionalContext` is appended to the intent text (never replaces it).
   */
  async submitAlertFixIntent(
    alertId: string,
    additionalContext?: string,
  ): Promise<{ data: { intentId: string; correlationId: string; intentText: string } }> {
    return this.post(`/alerts/${alertId}/fix-intent`, {
      additionalContext: additionalContext ?? '',
    });
  }

  /**
   * Pipeline-feedback resume flow. The operator's feedback is
   * persisted to the same intent's clarification column and the cycle
   * re-dispatches on the SAME branch + PR. Distinct from
   * `submitAlertFixIntent` — that one creates a NEW intent + fresh
   * branch.
   */
  async submitPipelineFeedback(
    alertId: string,
    feedback: string,
  ): Promise<{ data: { intentId: string; status: string; branch: string | null; prNumber: number | null; prUrl: string | null } }> {
    return this.post(`/alerts/${alertId}/pipeline-feedback`, { feedback });
  }

  async dismissAlert(id: string, notes?: string): Promise<{ data: Alert }> {
    return this.post(`/alerts/${id}/acknowledge`, { notes: notes ?? '' });
  }

  // ─── Active agents ─────────────────────────────────────────────────────────

  async getActiveAgents(): Promise<{ data: AgentExecutionSummary[] }> {
    return this.get('/status/agents');
  }

  // ─── Deployments ───────────────────────────────────────────────────────────

  async listDeployments(params: {
    projectId: string;
    limit?: number;
  }): Promise<{ data: DeploymentSummary[] }> {
    return this.get('/deployments', params);
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────

  /**
   * Server returns `{ data: EnrichedAlert[] }` (same envelope as every
   * other list endpoint). Each row carries the per-type enrichment
   * fields lifted from JSONB so the dashboard doesn't re-parse.
   */
  async listAlerts(params?: {
    acknowledged?: boolean;
    severity?: string;
  }): Promise<{ data: Alert[]; total: number }> {
    return this.get('/alerts', params);
  }

  async getAlert(id: string): Promise<{ data: Alert }> {
    return this.get(`/alerts/${id}`);
  }

  // ─── Interventions (ADR-021) ───────────────────────────────────────────────

  async submitIntervention(
    request: InterventionRequest,
  ): Promise<{ data: InterventionResponse }> {
    return this.post('/interventions', request);
  }

  async listInterventions(intentId: string): Promise<{ data: InterventionRecord[] }> {
    return this.get('/interventions', { intentId });
  }

  // ─── Maintenance ───────────────────────────────────────────────────────────

  /**
   * GET /maintenance/runs returns the same `{ data: ... }` envelope
   * every other server route uses. Previously typed as
   * `{ runs, total }` which silently mapped to `undefined` and made
   * the Maintenance view's "Recent runs" list permanently empty.
   */
  async listMaintenanceRuns(params?: {
    projectId?: string;
    agentRole?: string;
    limit?: number;
  }): Promise<{ data: MaintenanceRunSummary[] }> {
    return this.get('/maintenance/runs', params);
  }

  /**
   * `projectId` is REQUIRED by the server (a maintenance trigger always
   * runs against a specific project). Returns the completed
   * `MaintenanceRunRecord` synchronously — the runner is in-process,
   * so by the time the HTTP response lands the row is already in the
   * DB and a subsequent `listMaintenanceRuns` will pick it up.
   */
  async triggerMaintenanceAgent(
    agentRole: string,
    projectId: string,
  ): Promise<{ data: MaintenanceRunSummary }> {
    return this.post('/maintenance/trigger', { agentRole, projectId });
  }

  // ─── Live events (SSE) ─────────────────────────────────────────────────────

  /**
   * Opens a Server-Sent Events connection for live updates.
   * Returns a cleanup function to close the connection.
   */
  subscribeLiveEvents(
    onEvent: (event: LiveEvent) => void,
    onError?: (error: Event) => void,
  ): () => void {
    const url = `${this.baseUrl}/events?token=${this.token ?? ''}`;
    const source = new EventSource(url);

    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as LiveEvent;
        onEvent(event);
      } catch {
        // Ignore malformed events
      }
    };

    if (onError) {
      source.onerror = onError;
    }

    return () => source.close();
  }

  // ─── Users + memberships (migration 010) ──────────────────────────────────

  async listUsers(params?: { search?: string }): Promise<{ data: UserSummary[] }> {
    return this.get('/users', params);
  }

  async createUser(params: CreateUserParams): Promise<{ data: UserSummary }> {
    return this.post('/users', params);
  }

  async getUser(id: string): Promise<{ data: UserDetail }> {
    return this.get(`/users/${id}`);
  }

  async updateUser(id: string, params: { role?: UserRole; displayName?: string }): Promise<{ data: UserSummary }> {
    return this.patch(`/users/${id}`, params);
  }

  async deactivateUser(id: string): Promise<void> {
    await this.delete(`/users/${id}`);
  }

  async listMembers(projectId: string): Promise<{ data: ProjectMember[] }> {
    return this.get(`/projects/${projectId}/members`);
  }

  async addMember(projectId: string, params: { userId: string; role: ProjectRole }): Promise<{ data: MembershipSummary }> {
    return this.post(`/projects/${projectId}/members`, params);
  }

  async updateMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<{ data: MembershipSummary }> {
    return this.patch(`/projects/${projectId}/members/${userId}`, { role });
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await this.delete(`/projects/${projectId}/members/${userId}`);
  }

  // ─── Platform LLM registry (Session 3) ────────────────────────────────────

  async listPlatformLlms(): Promise<{ data: PlatformLLM[] }> {
    return this.get('/platform/llms');
  }

  async createPlatformLlm(body: {
    name: string;
    provider: string;
    modelString: string;
    baseUrl: string;
    /** Legacy env-var name. At least one of apiKeyEnv or secretId must be set. */
    apiKeyEnv?: string;
    /** Vault secret id (Session 4 — migration 015). Preferred. */
    secretId?: string;
    isDefault?: boolean;
    description?: string | null;
  }): Promise<{ data: PlatformLLM }> {
    return this.post('/platform/llms', body);
  }

  async updatePlatformLlm(
    id: string,
    body: Partial<{
      name: string; provider: string; modelString: string;
      baseUrl: string; apiKeyEnv: string | null; secretId: string | null;
      isDefault: boolean; description: string | null;
    }>,
  ): Promise<{ data: PlatformLLM }> {
    return this.patch(`/platform/llms/${id}`, body);
  }

  async deletePlatformLlm(id: string): Promise<void> {
    await this.delete(`/platform/llms/${id}`);
  }

  async testPlatformLlm(id: string): Promise<{ data: LlmTestResult }> {
    return this.post(`/platform/llms/${id}/test`, {});
  }

  // ─── Platform secrets vault (Session 4 — migration 015) ───────────────────
  //
  // Note: secret VALUES are never returned by any API. The list/get/create/
  // update endpoints all return only the metadata fields in `PlatformSecret`.

  async listPlatformSecrets(): Promise<{ data: PlatformSecret[] }> {
    return this.get('/platform/secrets');
  }

  async createPlatformSecret(body: {
    name: string;
    value: string;
    description?: string | null;
  }): Promise<{ data: PlatformSecret }> {
    return this.post('/platform/secrets', body);
  }

  async updatePlatformSecret(
    id: string,
    body: Partial<{ name: string; value: string; description: string | null }>,
  ): Promise<{ data: PlatformSecret }> {
    return this.patch(`/platform/secrets/${id}`, body);
  }

  async deletePlatformSecret(id: string): Promise<void> {
    await this.delete(`/platform/secrets/${id}`);
  }

  // ─── Platform templates (Session 3 — migration 017) ──────────────────────

  async listPlatformTemplates(): Promise<{ data: PlatformTemplateSummary[] }> {
    return this.get('/platform/templates');
  }

  async getPlatformTemplate(id: string): Promise<{ data: PlatformTemplate }> {
    return this.get(`/platform/templates/${id}`);
  }

  async createPlatformTemplate(body: {
    slug: string;
    name: string;
    description?: string | null;
    tier?: string;
    version?: string;
    files: Record<string, string>;
    variables?: TemplateVariable[];
    isDefault?: boolean;
  }): Promise<{ data: PlatformTemplateSummary }> {
    return this.post('/platform/templates', body);
  }

  async setDefaultPlatformTemplate(id: string): Promise<{ data: PlatformTemplateSummary }> {
    return this.post(`/platform/templates/${id}/set-default`, {});
  }

  async deletePlatformTemplate(id: string): Promise<void> {
    await this.delete(`/platform/templates/${id}`);
  }

  // ─── Platform MCP servers (Session 3 — migration 017) ────────────────────

  async listPlatformMcpServers(): Promise<{ data: PlatformMcpServer[] }> {
    return this.get('/platform/mcp-servers');
  }

  async createPlatformMcpServer(body: {
    name: string;
    url: string;
    description?: string | null;
    secretId?: string | null;
    enabled?: boolean;
    agentRoles?: string[];
  }): Promise<{ data: PlatformMcpServer }> {
    return this.post('/platform/mcp-servers', body);
  }

  async updatePlatformMcpServer(
    id: string,
    body: Partial<{
      name: string; url: string; description: string | null;
      secretId: string | null; enabled: boolean; agentRoles: string[];
    }>,
  ): Promise<{ data: PlatformMcpServer }> {
    return this.patch(`/platform/mcp-servers/${id}`, body);
  }

  async deletePlatformMcpServer(id: string): Promise<void> {
    await this.delete(`/platform/mcp-servers/${id}`);
  }

  async testPlatformMcpServer(id: string): Promise<{ data: PlatformMcpTestResult }> {
    return this.post(`/platform/mcp-servers/${id}/test`, {});
  }

  // ─── Platform tools (Session 3 — read-only) ──────────────────────────────

  async listPlatformTools(): Promise<{ data: PlatformToolInfo[] }> {
    return this.get('/platform/tools');
  }

  // ─── Platform identity (Session 3 — migration 017) ───────────────────────

  async getPlatformIdentity(): Promise<{ data: IdentityState }> {
    return this.get('/platform/identity');
  }

  async patchIdentityProvider(
    provider: IdentityProvider,
    body: { enabled?: boolean; config?: Record<string, unknown> },
  ): Promise<{ data: unknown }> {
    return this.patch(`/platform/identity/${provider}`, body);
  }

  async reloadIdentity(): Promise<{ data: { providers: string[] } }> {
    return this.post('/platform/identity/reload', {});
  }

  async addRoleMapping(body: {
    groupName: string;
    platformRole: 'platform-admin' | 'user';
  }): Promise<{ data: RoleMapping }> {
    return this.post('/platform/identity/role-mappings', body);
  }

  async removeRoleMapping(id: string): Promise<void> {
    await this.delete(`/platform/identity/role-mappings/${id}`);
  }

  // ─── Platform groups (Brief 1 — bulk user management) ────────────────────

  async listPlatformGroups(): Promise<{ data: PlatformGroup[] }> {
    return this.get('/platform/groups');
  }
  async createPlatformGroup(body: { name: string; description?: string | null }): Promise<{ data: PlatformGroup }> {
    return this.post('/platform/groups', body);
  }
  async updatePlatformGroup(id: string, body: Partial<{ name: string; description: string | null }>): Promise<{ data: PlatformGroup }> {
    return this.patch(`/platform/groups/${id}`, body);
  }
  async deletePlatformGroup(id: string): Promise<void> {
    await this.delete(`/platform/groups/${id}`);
  }

  async listGroupMembers(groupId: string): Promise<{ data: GroupMember[] }> {
    return this.get(`/platform/groups/${groupId}/members`);
  }
  async addGroupMember(groupId: string, userId: string): Promise<{ data: { groupId: string; userId: string } }> {
    return this.post(`/platform/groups/${groupId}/members`, { userId });
  }
  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await this.delete(`/platform/groups/${groupId}/members/${userId}`);
  }

  async listGroupProjectAssignments(groupId: string): Promise<{ data: GroupProjectAssignment[] }> {
    return this.get(`/platform/groups/${groupId}/projects`);
  }
  async assignGroupToProject(
    groupId: string,
    projectId: string,
    role: 'project-admin' | 'editor' | 'reader',
  ): Promise<{ data: { groupId: string; projectId: string; role: string } }> {
    return this.post(`/platform/groups/${groupId}/projects`, { projectId, role });
  }
  async unassignGroupFromProject(groupId: string, projectId: string): Promise<void> {
    await this.delete(`/platform/groups/${groupId}/projects/${projectId}`);
  }

  /** Project-side view of group assignments. Drives the "Group access"
   *  section in Admin → Projects detail and Project Settings →
   *  Members. Reader minimum at the route level. */
  async listProjectGroups(projectId: string): Promise<{ data: ProjectGroupAssignment[] }> {
    return this.get(`/projects/${projectId}/groups`);
  }

  // ─── Project config (Approach A — config-as-code) ──────────────────────────

  async getProjectConfig(projectId: string): Promise<{ data: ProjectConfigResponse }> {
    return this.get(`/projects/${projectId}/config`);
  }

  async patchPipelineConfig(
    projectId: string,
    patch: { adapter?: string; autoMerge?: boolean; mergeMethod?: 'merge' | 'squash' | 'rebase' },
  ): Promise<{ data: Record<string, unknown> }> {
    return this.patch(`/projects/${projectId}/config/pipeline`, patch);
  }

  async patchAgentsConfig(
    projectId: string,
    agents: Record<string, Partial<EditableAgentConfig>>,
  ): Promise<{ data: { agents: Record<string, EditableAgentConfig>; custom_agents?: ProjectConfigCustomAgent[] } }> {
    return this.patch(`/projects/${projectId}/config/agents`, { agents });
  }

  async patchCustomAgentsConfig(
    projectId: string,
    customAgents: ProjectConfigCustomAgent[],
  ): Promise<{ data: { agents: Record<string, EditableAgentConfig>; custom_agents?: ProjectConfigCustomAgent[] } }> {
    return this.patch(`/projects/${projectId}/config/custom-agents`, { customAgents });
  }

  async patchToolsConfig(
    projectId: string,
    tools: Record<string, { builtin?: string[]; mcp?: Array<{ name: string; url: string; tokenFrom: string }> }>,
  ): Promise<{ data: { agents: Record<string, EditableAgentConfig>; custom_agents?: ProjectConfigCustomAgent[] } }> {
    return this.patch(`/projects/${projectId}/config/tools`, { tools });
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, String(v));
      });
    }
    const res = await fetch(url.toString(), { headers: this.headers() });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private async delete<T>(path: string): Promise<T | void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    if (res.status === 204) return;
    return res.json() as Promise<T>;
  }

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`API error ${status}: ${body}`);
  }
}
