/**
 * @gestalt/dashboard
 * All types for the oversight dashboard.
 */

// ─── Projects ─────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  name: string;
  gitUrl: string;
  defaultBranch: string;
  createdBy: string;
  createdAt: string;
  /** Migration 022 — when set, the project's Git PAT lives in the
   *  vault under this secret id (precedence over plain token in
   *  `project_git_credentials`). Null = legacy plain-token mode.
   *  This is a reference UUID, not the secret value. */
  gitSecretId?: string | null;
  /** Platform-admin enrichment (Session — project management). Present
   *  on rows returned to a platform-admin user; omitted for regular
   *  users (whose `/projects` listing skips the cross-project stats). */
  memberCount?: number;
  intentCount?: number;
  /** ISO string of the most recent intent's `created_at`, or the
   *  project's `created_at` when no intents exist yet. */
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

// ─── Intent feed ──────────────────────────────────────────────────────────────

export type IntentStatus =
  | 'pending'
  | 'generating'
  | 'in-review'
  | 'approved'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'escalated'
  | 'waiting-for-clarification';

export interface IntentSummary {
  id: string;
  correlationId: string;
  text: string;
  status: IntentStatus;
  source: 'human' | 'maintenance-agent';
  priority: 'critical' | 'high' | 'normal' | 'low';
  createdAt: string;   // ISO string
  updatedAt: string;
  agentCount: number;
  signalCount: number;
}

// ─── Intent detail ────────────────────────────────────────────────────────────

export interface AgentExecutionSummary {
  id: string;
  correlationId: string;
  agentRole: string;
  status: 'queued' | 'running' | 'completed' | 'skipped' | 'failed';
  durationMs: number | null;
  signalCount: number;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * Active-agents enrichment (GET /status/agents only). Lets the
   * ActiveAgents card show which cycle the agent belongs to,
   * how far through the plan it is, and a running token total.
   * Other consumers of `AgentExecutionSummary` (the IntentDetail
   * timeline) ignore them — they don't need cycle-level aggregates.
   */
  intentText?: string | null;
  cycleProgress?: { completed: number; total: number };
  tokensSoFar?: number;
}

export interface IntentDetail extends IntentSummary {
  agentExecutions: AgentExecutionSummary[];
  signals: SignalSummary[];
  artifacts: ArtifactSummary[];
  gateResult: GateResultSummary | null;
  deploymentStatus: DeploymentStatus | null;
}

// ─── Signals ──────────────────────────────────────────────────────────────────

export interface SignalSummary {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  sourceAgent: string;
  message: string;
  autoResolvable: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

// ─── Gate results ─────────────────────────────────────────────────────────────

export interface GateResultSummary {
  verdict: 'pass' | 'fail' | 'escalate';
  signalCount: number;
  durationMs: number;
  completedAt: string;
}

// ─── Artifacts ────────────────────────────────────────────────────────────────

export interface ArtifactSummary {
  id: string;
  type: string;
  path: string;
  producedBy: string;
  createdAt: string;
}

// ─── Deployments ──────────────────────────────────────────────────────────────

export type DeploymentEventType =
  | 'pr-opened'
  | 'pipeline-triggered'
  | 'pipeline-passed'
  | 'pipeline-failed'
  | 'promoted-staging'
  | 'promoted-production'
  // Written by promotion-agent after staging when HARNESS.json has
  // `pipeline.autoMerge: true`. Drives the 5th timeline node.
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

/**
 * One row per intent that has at least one `deployment_events` row,
 * enriched with the full timeline. Powers the Deployments view's
 * four-node pipeline timeline (PR → Pipeline → Staging → Production).
 */
export interface DeploymentSummary {
  intentId: string;
  correlationId: string;
  intentText: string;
  status: string;                  // intent status (deploying / deployed / failed)
  events: DeploymentEvent[];       // ordered ASC by createdAt
  prUrl: string | null;
  prNumber: number | null;
  branch: string | null;
  runId: string | null;
  deploymentUrl: string | null;
  startedAt: string;               // ISO timestamp of first event
  completedAt: string | null;      // ISO timestamp of last event when status === 'deployed'
}

/**
 * Old (Phase-2 aspirational) deployment surface — kept as types for
 * back-compat with IntentDetail's `IntentDetail.deploymentStatus`
 * field; not produced by any current API path. Delete when
 * IntentDetail stops referencing it.
 */
export interface DeploymentStatus {
  currentEnvironment: string;
  pendingPromotion: PendingPromotion | null;
  history: PromotionHistoryItem[];
}

export interface PendingPromotion {
  id: string;
  to: string;
  requiresApproval: boolean;
  triggeredAt: string;
}

export interface PromotionHistoryItem {
  id: string;
  from: string | null;
  to: string;
  status: string;
  triggeredBy: string;
  completedAt: string | null;
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AlertAction =
  | 'approve-promotion'
  | 'reject-promotion'
  | 'provide-clarification'
  | 'acknowledge-breach';

export interface CodeLocation {
  file: string;
  line?: number;
  column?: number;
  rule?: string;
}

/**
 * Server enriches each alert with type-specific fields lifted out of
 * the JSONB `context` column so the dashboard can render without
 * re-parsing. Only the keys relevant to the alert's `type` are
 * populated; the rest are absent (not present as `null`).
 *
 *   clarification-needed →
 *     intentText, intentStatus
 *   maintenance-stuck →
 *     findingType, affectedFiles, evidence, attemptCount, suggestedAction
 *   GOLDEN_PRINCIPLE_BREACH →
 *     breachMessage, breachLocation, breachAgent
 */
export interface Alert {
  id: string;
  correlationId: string;
  intentId: string | null;
  type: string;          // signal type that triggered this alert
  severity: AlertSeverity;
  title: string;
  description: string;
  requiredAction: AlertAction;
  context: Record<string, unknown>;   // action-specific context
  createdAt: string;
  acknowledgedAt: string | null;
  // Enrichment — present per alert type (see JSDoc above).
  intentText?: string | null;
  intentStatus?: string | null;
  findingType?: string | null;
  affectedFiles?: string[] | null;
  evidence?: string | null;
  attemptCount?: number | null;
  suggestedAction?: string | null;
  breachMessage?: string | null;
  breachLocation?: CodeLocation | null;
  breachAgent?: string | null;
}

// ─── Interventions ────────────────────────────────────────────────────────────

// ─── Interventions (ADR-021, migration 011) ──────────────────────────────────

export type InterventionAction =
  | 'resume'
  | 'abort'
  | 'acknowledge-breach'
  | 'request-clarification';

export interface InterventionRequest {
  intentId: string;
  action: InterventionAction;
  notes?: string;
}

export interface InterventionRecord {
  id: string;
  correlationId: string;
  intentId: string;
  alertId: string | null;
  action: InterventionAction;
  actorId: string;
  notes: string | null;
  createdAt: string;
}

export interface InterventionResponse {
  action: InterventionAction;
  intentId: string;
  status: string;
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

/**
 * Single observation produced by a maintenance agent during a run.
 * Mirrors `MaintenanceFinding` in @gestalt/core. Persisted on the
 * maintenance_runs row as a JSONB array; the read path (server →
 * dashboard) does no parsing — `parseJsonb` in the postgres adapter
 * already normalises object-vs-string return shapes.
 */
export interface MaintenanceFinding {
  type: string;
  description: string;
  affectedFiles: string[];
  severity: 'low' | 'medium' | 'high';
  suggestedAction: string;
}

export interface MaintenanceRunSummary {
  id: string;
  agentRole: string;
  projectId: string | null;
  status: 'running' | 'completed' | 'failed' | 'nothing-to-do';
  intentsQueued: number;
  directFixes: number;
  findings: MaintenanceFinding[];
  durationMs: number | null;
  runAt: string;
  completedAt: string | null;
}

// ─── Live events (SSE) ────────────────────────────────────────────────────────

export type LiveEventType =
  | 'intent.created'
  | 'intent.status-changed'
  | 'agent.started'
  | 'agent.completed'
  | 'signal.emitted'
  | 'gate.completed'
  | 'deployment.updated'
  | 'alert.created'
  | 'alert.acknowledged'
  | 'maintenance.run-completed';

export interface LiveEvent {
  type: LiveEventType;
  correlationId: string;
  payload: unknown;
  timestamp: string;
}

// ─── Dashboard user ───────────────────────────────────────────────────────────

export type UserRole = 'platform-admin' | 'user';
export type ProjectRole = 'project-admin' | 'editor' | 'reader';

export interface DashboardUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  authProvider: string;
  deactivatedAt: string | null;
  lastLoginAt: string;
  createdAt: string;
}

export interface MembershipSummary {
  id: string;
  userId: string;
  projectId: string;
  role: ProjectRole;
  assignedBy: string | null;
  createdAt: string;
}

export interface UserDetail extends UserSummary {
  memberships: MembershipSummary[];
}

export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string;
  platformRole: UserRole;
  projectRole: ProjectRole;
  deactivatedAt: string | null;
  assignedBy: string | null;
  createdAt: string;
}

export interface CreateUserParams {
  email: string;
  displayName: string;
  role: UserRole;
  password?: string;
  projectAssignments?: Array<{ projectId: string; role: ProjectRole }>;
}

// ─── Project config (config-as-code, Approach A) ──────────────────────────

export interface EditableAgentLlm {
  model?: string;
  temperature?: number;
  maxTokens?: number;
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

export interface ProjectConfigResponse {
  harness: Record<string, unknown>;
  agents: {
    agents?: Record<string, EditableAgentConfig>;
    custom_agents?: ProjectConfigCustomAgent[];
    customAgents?: ProjectConfigCustomAgent[];
  };
}

// ─── Platform LLM registry (Session 3, migration 014) ────────────────────────

/**
 * Wire shape (migration 023). 'chat-completions' is the default
 * legacy shape (max_tokens + temperature). 'responses' is for
 * OpenAI reasoning models (gpt-5*, o1, o3) — uses
 * max_completion_tokens + omits temperature.
 */
export type LLMApiShape = 'chat-completions' | 'responses';

export interface PlatformLLM {
  id: string;
  name: string;
  provider: string;
  modelString: string;
  baseUrl: string;
  /** Legacy env-var name. Null when the LLM uses a vault secret. */
  apiKeyEnv: string | null;
  /** Vault secret reference (Session 4 — migration 015). */
  secretId: string | null;
  /** Wire shape — see `LLMApiShape`. Defaults to 'chat-completions'. */
  apiShape: LLMApiShape;
  isDefault: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LlmTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

// ─── Platform secrets vault (Session 4, migration 015) ───────────────────────
//
// Secret VALUES are never returned by any API — `PlatformSecret` carries
// only the metadata the dashboard needs to render the management surface.
// To rotate, POST a new value via PATCH; to view, you can't.

export interface PlatformSecret {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Master-key rotation log entry (migration 021). Returned by
 * `listPlatformSecrets` as `lastRotation` so the Secrets tab can
 * render "Last rotated: 2h ago by amr@co.com" without a separate
 * round-trip.
 */
export interface KeyRotation {
  id: string;
  rotatedBy: string | null;
  secretCount: number;
  rotatedAt: string;
}

export interface KeyRotationResult {
  rotated: number;
  rotatedAt: string;
}

// ─── Templates / MCP / Tools / Identity (Session 3 — migration 017) ─────────

export interface TemplateVariable {
  name: string;
  description?: string;
  type?: 'string' | 'number' | 'boolean';
  required?: boolean;
  defaultValue?: string;
}

export interface PlatformTemplateSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: string;
  version: string;
  isDefault: boolean;
  isBuiltin: boolean;
  variables: TemplateVariable[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformTemplate extends PlatformTemplateSummary {
  files: Record<string, string>;
  /**
   * Per-`{{variable}}` usage scanned by the server at read time
   * (Brief 3). Computed every GET — never persisted — so the
   * dashboard's detail panel + CLI inspector can render the
   * documented / auto-provided / undocumented status at a glance.
   */
  variableUsage?: TemplateVariableUsage[];
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

export type IdentityProvider = 'kerberos' | 'saml' | 'oidc';

export interface IdentityProviderConfig {
  id: string;
  provider: IdentityProvider;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: string;
}

export interface RoleMapping {
  id: string;
  groupName: string;
  platformRole: 'platform-admin' | 'user';
  createdBy: string | null;
  createdAt: string;
}

export interface IdentityState {
  providers: IdentityProviderConfig[];
  roleMappings: RoleMapping[];
  activeProviders: string[];
}

// ─── Platform groups (Brief 1 — bulk user management, migration 018) ────────

export interface PlatformGroup {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  addedBy: string | null;
  addedAt: string;
  user: UserSummary;
}

export interface GroupProjectAssignment {
  groupId: string;
  projectId: string;
  role: 'project-admin' | 'editor' | 'reader';
  assignedBy: string | null;
  assignedAt: string;
  project: ProjectSummary;
}

/** Project-side view returned by `GET /projects/:id/groups`. Each
 *  row carries the group record, the role the group has on the
 *  project, and the group's current member count so the dashboard
 *  can show "(N members)" without an N+1 lookup. */
export interface ProjectGroupAssignment {
  group: PlatformGroup;
  role: 'project-admin' | 'editor' | 'reader';
  assignedAt: string;
  memberCount: number;
}

// ─── Self-healing config (migration 020) ────────────────────────────────────

/**
 * One row of `platform_self_healing_config` as returned by
 * `GET /platform/self-healing`. Edited in-place by the dashboard's
 * Admin → Self-healing tab; each row saves on change (no global
 * Save button).
 */
export interface SelfHealingConfig {
  id: string;
  failureType: string;
  maxAttempts: number;
  confidenceThreshold: 'high' | 'medium' | 'low';
  autoResolveAlerts: boolean;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
}
