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
  projectId: string;
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
  correlationId?: string;
  intentId?: string;
  agentRole: string;
  taskType?: string;
  status: string;
  tokensUsed?: number;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  // Enrichment surfaced by GET /status/agents — intent text + cycle
  // progress + running token total. Optional because the same shape
  // is also returned by GET /intents/:id (where these fields are
  // absent — the caller already has the intent text in scope).
  intentText?: string;
  cycleProgress?: { completed: number; total: number };
  tokensSoFar?: number;
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
  /** Migration 022 — vault secret reference for the project's Git PAT.
   *  Null = legacy plain-token mode. UUID = reference (NOT the value). */
  gitSecretId?: string | null;
  /** Platform-admin enrichment — only present on rows returned to a
   *  platform-admin user. `gestalt platform projects list` consumes
   *  these; the regular `gestalt projects list` ignores them. */
  memberCount?: number;
  intentCount?: number;
  lastActivityAt?: string;
}

// ─── Git provider repo browser (migration 022) ───────────────────────────────

export interface GitRepoSummary {
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
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

// ─── Project config (config-as-code) ────────────────────────────────────────

export interface EditableAgentLlm {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Snake-case fallback emitted by `yaml.stringify` — readers should
   *  accept either shape since the server normalises before commit. */
  max_tokens?: number;
}

export interface EditableAgentTools {
  builtin?: string[];
  mcp?: Array<{ name: string; url: string; tokenFrom?: string; token_from?: string }>;
}

export interface EditableAgentConfig {
  role: string;
  goal: string;
  llm: EditableAgentLlm;
  promptExtensions?: string[];
  prompt_extensions?: string[];
  tools?: EditableAgentTools;
}

export interface ProjectConfigCustomAgent {
  name: string;
  role: string;
  goal: string;
  runsAfter?: string | null;
  runs_after?: string | null;
  llm: EditableAgentLlm;
  prompt: string;
}

export interface ProjectConfigAgentsYaml {
  agents?: Record<string, EditableAgentConfig>;
  custom_agents?: ProjectConfigCustomAgent[];
  customAgents?: ProjectConfigCustomAgent[];
}

// ─── Platform LLM registry (Session 3, migration 014) ────────────────────────

/**
 * Wire shape (migration 023). 'chat-completions' is the legacy
 * default (max_tokens + temperature). 'responses' is for OpenAI
 * reasoning models (gpt-5*, o1, o3) — uses max_completion_tokens
 * and omits temperature.
 */
export type LLMApiShape = 'chat-completions' | 'responses';

export interface PlatformLLM {
  id: string;
  name: string;
  provider: string;
  modelString: string;
  baseUrl: string;
  apiKeyEnv: string | null;
  secretId: string | null;
  /** Wire shape — defaults to 'chat-completions'. */
  apiShape: LLMApiShape;
  isDefault: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSecretSummary {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Master-key rotation log entry (migration 021). Returned by
 * `listPlatformSecrets` as `lastRotation`. Records WHO rotated WHEN
 * and HOW MANY secrets were re-encrypted; the keys themselves never
 * touch the database.
 */
export interface KeyRotationSummary {
  id: string;
  rotatedBy: string | null;
  secretCount: number;
  rotatedAt: string;
}

export interface KeyRotationResult {
  rotated: number;
  rotatedAt: string;
}

// ─── Self-healing config (migration 020) ──────────────────────────────────

export interface SelfHealingConfigSummary {
  id: string;
  failureType: string;
  maxAttempts: number;
  confidenceThreshold: 'high' | 'medium' | 'low';
  autoResolveAlerts: boolean;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

// ─── Platform templates / MCP / tools / identity (Session 3 — migration 017) ─

export interface PlatformTemplateSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: string;
  version: string;
  isDefault: boolean;
  isBuiltin: boolean;
  variables: unknown[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVariableUsage {
  name: string;
  usedInFiles: string[];
  defined: boolean;
  required: boolean;
  defaultValue: string | null;
  description: string | null;
  autoProvided: boolean;
}

export interface PlatformTemplateDetail extends PlatformTemplateSummary {
  files: Record<string, string>;
  variableUsage?: TemplateVariableUsage[];
}

export interface PlatformMcpServer {
  id: string;
  name: string;
  url: string;
  description: string | null;
  secretId: string | null;
  enabled: boolean;
  agentRoles: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformMcpTestResult {
  ok: boolean;
  toolCount: number;
  latencyMs: number;
  error?: string;
}

export interface PlatformToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  defaultAgents: string[];
}

export interface IdentityStateResponse {
  providers: Array<{
    id: string;
    provider: 'kerberos' | 'saml' | 'oidc';
    enabled: boolean;
    config: Record<string, unknown>;
    updatedBy: string | null;
    updatedAt: string;
  }>;
  roleMappings: RoleMappingSummary[];
  activeProviders: string[];
}

export interface RoleMappingSummary {
  id: string;
  groupName: string;
  platformRole: 'platform-admin' | 'user';
  createdBy: string | null;
  createdAt: string;
}

// ─── Platform groups (Brief 1 — bulk user management, migration 018) ────────

export interface PlatformGroupSummary {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface GroupMemberWithUser {
  groupId: string;
  userId: string;
  addedBy: string | null;
  addedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: 'platform-admin' | 'user';
    deactivatedAt: string | null;
  };
}

export interface GroupProjectWithProject {
  groupId: string;
  projectId: string;
  role: 'project-admin' | 'editor' | 'reader';
  assignedBy: string | null;
  assignedAt: string;
  project: {
    id: string;
    name: string;
    gitUrl: string;
    defaultBranch: string;
  };
}

// ─── Deployments (ADR-033 / ADR-034) ─────────────────────────────────────────

export type DeploymentEventType =
  | 'pr-opened'
  | 'pipeline-triggered'
  | 'pipeline-passed'
  | 'pipeline-failed'
  | 'promoted-staging'
  | 'promoted-production'
  | 'auto-merged';

export interface DeploymentEvent {
  id: string;
  correlationId: string;
  intentId: string;
  eventType: DeploymentEventType;
  environment: string | null;
  prUrl: string | null;
  prNumber: number | null;
  runId: string | null;
  deploymentUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DeploymentSummary {
  intentId: string;
  correlationId: string;
  intentText: string;
  status: string;
  events: DeploymentEvent[];
  prUrl: string | null;
  prNumber: number | null;
  branch: string | null;
  runId: string | null;
  deploymentUrl: string | null;
  startedAt: string;
  completedAt: string | null;
}

// ─── Maintenance runs (ADR-035) ──────────────────────────────────────────────

export interface MaintenanceFinding {
  type: string;
  description: string;
  affectedFiles: string[];
  severity: 'low' | 'medium' | 'high';
  suggestedAction: string;
}

export interface MaintenanceRunRecord {
  id: string;
  agentRole: string;
  projectId: string | null;
  status: 'running' | 'completed' | 'failed';
  intentsQueued: number;
  directFixes: number;
  findings: MaintenanceFinding[];
  durationMs: number | null;
  runAt: string;
  completedAt: string | null;
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

  /**
   * Register a project. Migration 022 — exactly one of the three
   * credential modes must be supplied:
   *   - `gitToken`     — legacy plain-text PAT
   *   - `gitSecretId`  — link to an existing vault secret
   *   - `newSecret`    — auto-save the token to the vault first
   */
  async createProject(params: {
    name: string;
    gitUrl: string;
    defaultBranch?: string;
    gitToken?: string;
    gitSecretId?: string;
    newSecret?: { name: string; value: string };
  }): Promise<{ data: ProjectRecord }> {
    return this.post('/projects', params);
  }

  /** Project-admin only — replace the project's Git PAT. Same three
   *  credential modes as `createProject`. */
  async updateProjectGitCredentials(
    projectId: string,
    body: {
      gitToken?: string;
      gitSecretId?: string;
      newSecret?: { name: string; value: string };
    },
  ): Promise<{ data: ProjectRecord }> {
    return this.patch(`/projects/${projectId}/git-credentials`, body);
  }

  /** GitHub repo browser (server-side proxy). Today only GitHub is
   *  wired; the `provider` arg is reserved for future GitLab / Azure
   *  DevOps support. */
  async listGitRepos(
    secretId: string,
    provider: 'github' = 'github',
  ): Promise<{ data: GitRepoSummary[] }> {
    const qs = `?secretId=${encodeURIComponent(secretId)}&provider=${encodeURIComponent(provider)}`;
    return this.get(`/platform/git/repos${qs}`);
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

  /** Platform-admin only — hard-deletes the project row + dependent
   *  rows. Refuses with HTTP 400 `PROJECT_HAS_ACTIVE_INTENTS` when a
   *  cycle is in flight. The remote Git repository is NOT deleted. */
  async deleteProject(projectId: string): Promise<void> {
    await this.delete(`/projects/${projectId}`);
  }

  // ─── Platform templates / MCP / tools / identity (Session 3) ─────────────

  async listPlatformTemplates(): Promise<{ data: PlatformTemplateSummary[] }> {
    return this.get('/platform/templates');
  }
  /**
   * Returns the full template record including `files` content and
   * `variableUsage` (Brief 3 — per-`{{variable}}` status panel).
   * Used by `gestalt platform templates inspect <slug>`.
   */
  async getPlatformTemplate(id: string): Promise<{ data: PlatformTemplateDetail }> {
    return this.get(`/platform/templates/${id}`);
  }
  async createPlatformTemplate(body: {
    slug: string; name: string; description?: string | null;
    tier?: string; version?: string;
    files: Record<string, string>;
  }): Promise<{ data: PlatformTemplateSummary; warnings?: string[] }> {
    return this.post('/platform/templates', body);
  }
  async setDefaultPlatformTemplate(id: string): Promise<{ data: PlatformTemplateSummary }> {
    return this.post(`/platform/templates/${id}/set-default`, {});
  }
  async deletePlatformTemplate(id: string): Promise<void> {
    await this.delete(`/platform/templates/${id}`);
  }
  /**
   * Stream the template ZIP as a Buffer so the CLI can write it to
   * disk. Returns the raw bytes; the caller wraps with `fs.writeFile`.
   */
  async downloadPlatformTemplate(id: string): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/platform/templates/${id}/download`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new ApiClientError(res.status, await res.text());
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
  async duplicatePlatformTemplate(
    id: string,
    body: { name: string; slug: string },
  ): Promise<{ data: PlatformTemplateSummary }> {
    return this.post(`/platform/templates/${id}/duplicate`, body);
  }
  /**
   * MERGE semantics: only the keys included in `files` are changed;
   * unsupplied files preserved. Pass a single `{[path]: content}` to
   * save one file.
   */
  async updatePlatformTemplateFiles(
    id: string,
    files: Record<string, string>,
  ): Promise<{ data: PlatformTemplateSummary }> {
    return this.patch(`/platform/templates/${id}/files`, { files });
  }
  async deletePlatformTemplateFile(id: string, filePath: string): Promise<void> {
    const encoded = filePath.split('/').map(encodeURIComponent).join('/');
    await this.delete(`/platform/templates/${id}/files/${encoded}`);
  }

  async listPlatformMcpServers(): Promise<{ data: PlatformMcpServer[] }> {
    return this.get('/platform/mcp-servers');
  }
  async createPlatformMcpServer(body: {
    name: string; url: string; description?: string | null;
    secretId?: string | null; enabled?: boolean; agentRoles?: string[];
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

  async listPlatformTools(): Promise<{ data: PlatformToolInfo[] }> {
    return this.get('/platform/tools');
  }

  async getPlatformIdentity(): Promise<{ data: IdentityStateResponse }> {
    return this.get('/platform/identity');
  }
  async patchIdentityProvider(
    provider: 'kerberos' | 'saml' | 'oidc',
    body: { enabled?: boolean; config?: Record<string, unknown> },
  ): Promise<{ data: unknown }> {
    return this.patch(`/platform/identity/${provider}`, body);
  }
  async reloadIdentity(): Promise<{ data: { providers: string[] } }> {
    return this.post('/platform/identity/reload', {});
  }
  async addRoleMapping(body: {
    groupName: string; platformRole: 'platform-admin' | 'user';
  }): Promise<{ data: RoleMappingSummary }> {
    return this.post('/platform/identity/role-mappings', body);
  }
  async removeRoleMapping(id: string): Promise<void> {
    await this.delete(`/platform/identity/role-mappings/${id}`);
  }

  // ─── Platform groups ──────────────────────────────────────────────────────

  async listPlatformGroups(): Promise<{ data: PlatformGroupSummary[] }> {
    return this.get('/platform/groups');
  }
  async createPlatformGroup(body: { name: string; description?: string | null }): Promise<{ data: PlatformGroupSummary }> {
    return this.post('/platform/groups', body);
  }
  async deletePlatformGroup(id: string): Promise<void> {
    await this.delete(`/platform/groups/${id}`);
  }
  async listGroupMembers(groupId: string): Promise<{ data: GroupMemberWithUser[] }> {
    return this.get(`/platform/groups/${groupId}/members`);
  }
  async addGroupMember(groupId: string, userId: string): Promise<unknown> {
    return this.post(`/platform/groups/${groupId}/members`, { userId });
  }
  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await this.delete(`/platform/groups/${groupId}/members/${userId}`);
  }
  async listGroupProjects(groupId: string): Promise<{ data: GroupProjectWithProject[] }> {
    return this.get(`/platform/groups/${groupId}/projects`);
  }

  /** Project-side view of group assignments. Drives the "Group
   *  assignments" section in `gestalt project members list`. */
  async listProjectGroups(projectId: string): Promise<{
    data: Array<{
      group: PlatformGroupSummary;
      role: 'project-admin' | 'editor' | 'reader';
      assignedAt: string;
      memberCount: number;
    }>
  }> {
    return this.get(`/projects/${projectId}/groups`);
  }
  async assignGroupToProject(
    groupId: string,
    projectId: string,
    role: 'project-admin' | 'editor' | 'reader',
  ): Promise<unknown> {
    return this.post(`/platform/groups/${groupId}/projects`, { projectId, role });
  }
  async unassignGroupFromProject(groupId: string, projectId: string): Promise<void> {
    await this.delete(`/platform/groups/${groupId}/projects/${projectId}`);
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
    /** Legacy env-var name. At least one of apiKeyEnv or secretId. */
    apiKeyEnv?: string;
    /** Vault secret id (Session 4 — preferred). */
    secretId?: string;
    /** Wire shape (migration 023). Defaults to 'chat-completions'. */
    apiShape?: LLMApiShape;
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
      apiShape: LLMApiShape;
      isDefault: boolean; description: string | null;
    }>,
  ): Promise<{ data: PlatformLLM }> {
    return this.patch(`/platform/llms/${id}`, body);
  }

  async deletePlatformLlm(id: string): Promise<void> {
    await this.delete(`/platform/llms/${id}`);
  }

  async testPlatformLlm(id: string): Promise<{ data: { ok: boolean; latencyMs: number; error?: string } }> {
    return this.post(`/platform/llms/${id}/test`, {});
  }

  // ─── Platform secrets vault (Session 4 — migration 015) ───────────────────

  async listPlatformSecrets(): Promise<{ data: PlatformSecretSummary[]; lastRotation: KeyRotationSummary | null }> {
    return this.get('/platform/secrets');
  }

  /**
   * Rotates the master key — re-encrypts every row in
   * `platform_secrets` atomically under a new 32-byte base64 key.
   * Server validates length, runs the rotation in a single transaction,
   * and on success persists the new key to file / warns about env var.
   */
  async rotatePlatformMasterKey(newKey: string): Promise<{ data: KeyRotationResult }> {
    return this.post('/platform/secrets/rotate-key', { newKey });
  }

  async createPlatformSecret(body: {
    name: string;
    value: string;
    description?: string | null;
  }): Promise<{ data: PlatformSecretSummary }> {
    return this.post('/platform/secrets', body);
  }

  async updatePlatformSecret(
    id: string,
    body: Partial<{ name: string; value: string; description: string | null }>,
  ): Promise<{ data: PlatformSecretSummary }> {
    return this.patch(`/platform/secrets/${id}`, body);
  }

  async deletePlatformSecret(id: string): Promise<void> {
    await this.delete(`/platform/secrets/${id}`);
  }

  // ─── Project config (config-as-code, Approach A) ──────────────────────────

  async getProjectConfig(projectId: string): Promise<{ data: {
    harness: Record<string, unknown>;
    agents: ProjectConfigAgentsYaml;
  } }> {
    return this.get(`/projects/${projectId}/config`);
  }

  async patchPipelineConfig(
    projectId: string,
    patch: { adapter?: string; autoMerge?: boolean; mergeMethod?: 'merge' | 'squash' | 'rebase' },
  ): Promise<{ data: Record<string, unknown> }> {
    return this.patch(`/projects/${projectId}/config/pipeline`, patch);
  }

  // ADR-051 / TR_027 — regenerate `.pr_agent.toml` from the
  // project's current HARNESS.json and push to the default branch.
  async pushPrAgentConfig(
    projectId: string,
  ): Promise<{ data: { changed: boolean; commitSha?: string } }> {
    return this.post(`/projects/${projectId}/push-pr-agent-config`, {});
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

  /**
   * Tools-only patch — REMOVED in Session 3 as a separate endpoint.
   * Tool assignment is now part of agent config. This helper rewraps
   * the legacy shape into the new agents endpoint so the deprecated
   * `gestalt project config set-tools` keeps working.
   */
  async patchToolsConfig(
    projectId: string,
    tools: Record<string, { builtin?: string[]; mcp?: Array<{ name: string; url: string; tokenFrom: string }> }>,
  ): Promise<{ data: { agents: Record<string, EditableAgentConfig>; custom_agents?: ProjectConfigCustomAgent[] } }> {
    const agentsPatch: Record<string, Partial<EditableAgentConfig>> = {};
    for (const [role, cfg] of Object.entries(tools)) {
      agentsPatch[role] = { tools: cfg };
    }
    return this.patch(`/projects/${projectId}/config/agents`, { agents: agentsPatch });
  }

  async updateProjectConfig(
    projectId: string,
    config: {
      pipeline?: {
        adapter?: string;
        autoMerge?: boolean;
        mergeMethod?: 'merge' | 'squash' | 'rebase';
      };
    },
  ): Promise<{
    data: {
      updated: boolean;
      adapter?: string | null;
      autoMerge?: boolean | null;
      mergeMethod?: string | null;
      commitSha?: string;
      reason?: string;
    };
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
    projectId?: string;
    status?: string;
    limit?: number;
    offset?: number;
    // Brief 5 — extended filter set. Server accepts all of these as
    // query params. Omitting projectId returns the union across every
    // project the user can access (direct + group memberships).
    source?: string;
    priority?: string;
    search?: string;
    from?: string;
    to?: string;
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

  async listMaintenanceRuns(params: {
    projectId?: string;
    agentRole?: string;
    limit?: number;
  } = {}): Promise<{ data: MaintenanceRunRecord[] }> {
    return this.get('/maintenance/runs', params as Record<string, unknown>);
  }

  async getMaintenanceRun(id: string): Promise<{ data: MaintenanceRunRecord }> {
    return this.get(`/maintenance/runs/${id}`);
  }

  // ─── Deployments ───────────────────────────────────────────────────────────

  async listDeployments(params: {
    projectId: string;
    limit?: number;
    correlationId?: string;
  }): Promise<{ data: DeploymentSummary[] }> {
    return this.get('/deployments', params as Record<string, unknown>);
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

  /**
   * Pipeline-failed / pipeline-timeout feedback — operator describes the
   * fix; server saves to intent.clarification, dispatches a fresh
   * generate cycle on the SAME branch (resumeOnBranch), and
   * acknowledges the alert atomically. See ADR / session log
   * 2026-06-03 (pipeline failure alerts).
   */
  async submitPipelineFeedback(
    id: string,
    feedback: string,
  ): Promise<{
    data: {
      intentId: string;
      status: string;
      branch: string | null;
      prNumber: number | null;
      prUrl: string | null;
    };
  }> {
    return this.post(`/alerts/${id}/pipeline-feedback`, { feedback });
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

  // ─── Features (planning layer, migration 024) ──────────────────────────────

  async submitFeature(params: {
    title: string;
    description: string;
    projectId: string;
  }): Promise<{ data: { id: string; title: string; status: string } }> {
    return this.post('/features', params);
  }

  async listFeatures(params: { projectId?: string }): Promise<{
    data: Array<{
      id: string;
      projectId: string;
      title: string;
      description: string;
      status: string;
      phaseCount: number;
      currentPhase: number;
      createdAt: string;
    }>;
    total: number;
  }> {
    return this.get('/features', params as Record<string, unknown>);
  }

  async getFeature(id: string): Promise<{
    data: {
      id: string;
      projectId: string;
      title: string;
      description: string;
      status: string;
      architecture: string | null;
      phaseCount: number;
      currentPhase: number;
      phases: Array<{
        id: string;
        phaseIndex: number;
        title: string;
        scope: string;
        status: string;
        intentId: string | null;
      }>;
      planLog: Array<{
        id: string;
        phaseIndex: number | null;
        eventType: string;
        summary: string;
        createdAt: string;
      }>;
    };
  }> {
    return this.get(`/features/${id}`);
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

  // ─── Self-healing config (migration 020) ──────────────────────────────────

  async listSelfHealingConfig(): Promise<{ data: SelfHealingConfigSummary[] }> {
    return this.get('/platform/self-healing');
  }

  async updateSelfHealingConfig(
    failureType: string,
    body: Partial<{
      maxAttempts: number;
      confidenceThreshold: 'high' | 'medium' | 'low';
      autoResolveAlerts: boolean;
      enabled: boolean;
    }>,
  ): Promise<{ data: SelfHealingConfigSummary }> {
    return this.patch(`/platform/self-healing/${failureType}`, body);
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
