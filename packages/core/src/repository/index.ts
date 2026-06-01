/**
 * @gestalt/core/repository
 *
 * Repository pattern interface definitions.
 * All database access goes through these interfaces.
 * Adapters (postgres, oracle, mssql) implement them.
 *
 * The active adapter is resolved at startup from config.
 * No other package imports adapter code directly.
 */

import type {
  Artifact, ArtifactType, PlatformSignal, AgentRole, ToolCallLogEntry,
} from '../types';

// ─── Base repository ──────────────────────────────────────────────────────────

export interface BaseRepository {
  healthCheck(): Promise<boolean>;
}

// ─── Intent repository ────────────────────────────────────────────────────────

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

export interface IntentRecord {
  id: string;
  correlationId: string;
  projectId: string;
  text: string;
  /**
   * Operator-supplied refinement, populated by `POST /intents/:id/clarify`
   * when the cycle paused with `waiting-for-clarification`. The
   * orchestrator reads this column on every dispatch (including gate
   * retries) so the intent-agent's prompt picks the clarification up
   * even when the BullMQ payload no longer carries it.
   */
  clarification: string | null;
  status: IntentStatus;
  source: 'human' | 'maintenance-agent';
  priority: 'critical' | 'high' | 'normal' | 'low';
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface IntentRepository extends BaseRepository {
  create(intent: Omit<IntentRecord, 'createdAt' | 'updatedAt' | 'resolvedAt' | 'clarification'>): Promise<IntentRecord>;
  findById(id: string): Promise<IntentRecord | null>;
  findByCorrelationId(correlationId: string): Promise<IntentRecord | null>;
  updateStatus(id: string, status: IntentStatus): Promise<IntentRecord>;
  /**
   * Persists the operator's clarification text on the intent row.
   * Called from `POST /intents/:id/clarify` before re-dispatching the
   * generate task so subsequent reads (including gate retries) see the
   * same text.
   */
  saveClarification(id: string, clarification: string): Promise<IntentRecord>;
  list(params: { projectId: string; status?: IntentStatus; limit: number; offset: number }): Promise<{ records: IntentRecord[]; total: number }>;
  /**
   * Server-wide intent list (no project filter). Used by the
   * platform-admin view of `GET /intents`. Regular users never reach
   * this path — they get a per-project list scoped by membership.
   */
  listAll(params: { status?: IntentStatus; limit: number; offset: number }): Promise<{ records: IntentRecord[]; total: number }>;
}

// ─── Agent execution repository ───────────────────────────────────────────────

export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'expired';

export interface AgentExecutionRecord {
  id: string;
  correlationId: string;
  intentId: string;
  agentRole: AgentRole;
  taskType: string;
  status: ExecutionStatus;
  tokensUsed: number;
  durationMs: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface AgentExecutionRepository extends BaseRepository {
  create(execution: Omit<AgentExecutionRecord, 'createdAt'>): Promise<AgentExecutionRecord>;
  updateStatus(id: string, status: ExecutionStatus, fields?: Partial<AgentExecutionRecord>): Promise<AgentExecutionRecord>;
  findByCorrelationId(correlationId: string): Promise<AgentExecutionRecord[]>;
  findActive(): Promise<AgentExecutionRecord[]>;
  findById(id: string): Promise<AgentExecutionRecord | null>;
}

// ─── Agent execution log repository ───────────────────────────────────────────

/**
 * Per-execution snapshot of the prompt + LLM response + result. One row
 * per `agent_executions` row (1:1). Populated by the layer
 * orchestrators (generate / quality-gate / deploy) right before they
 * update the execution status to a terminal state. Consumed by the
 * dashboard's IntentDetail view when an operator clicks an execution
 * row open.
 *
 * The prompt and response can be large (multi-KB); the dashboard
 * truncates them in the UI but always stores the full text in the DB.
 * Non-LLM agents (gate constraint-agent / deploy pr-agent /
 * pipeline-agent / promotion-agent) store `prompt = null` and
 * `llmResponse = null`.
 */
export interface AgentExecutionLogRecord {
  id: string;
  executionId: string;
  correlationId: string;
  agentRole: string;
  prompt: string | null;
  llmResponse: string | null;
  resultStatus: string;
  artifactPaths: string[];
  signalTypes: string[];
  errorMessage: string | null;
  /**
   * The LLM model that actually ran this agent step. Populated by the
   * orchestrator from `client.getModel()` after `LLMClient.complete()`
   * — so it reflects the per-agent `agents.yaml` override, not the
   * platform default. Null for non-LLM agents (constraint-agent,
   * pr-agent, pipeline-agent, promotion-agent) and for pre-migration-009
   * rows. Migration 009.
   */
  modelUsed: string | null;
  /**
   * History of tool calls the agent made during its run (ADR-038).
   * `[]` for agents that didn't use tools (the default for every
   * agent before migration 012, and for agents whose `agents.yaml`
   * `tools.builtin` is empty). Each entry carries the truncated
   * output (≤ 500 chars) — the full result was already fed back to
   * the LLM during the live tool loop; the persisted entry exists
   * for operator audit, not re-execution. Migration 012.
   */
  toolCalls: ToolCallLogEntry[];
  createdAt: Date;
}

export interface AgentExecutionLogRepository extends BaseRepository {
  save(log: Omit<AgentExecutionLogRecord, 'id' | 'createdAt'>): Promise<AgentExecutionLogRecord>;
  findByExecutionId(executionId: string): Promise<AgentExecutionLogRecord | null>;
  findByCorrelationId(correlationId: string): Promise<AgentExecutionLogRecord[]>;
}

// ─── Artifact repository ──────────────────────────────────────────────────────

export interface ArtifactRepository extends BaseRepository {
  save(artifact: Artifact): Promise<Artifact>;
  findByCorrelationId(correlationId: string, type?: ArtifactType): Promise<Artifact[]>;
  findById(id: string): Promise<Artifact | null>;
}

// ─── Signal repository ────────────────────────────────────────────────────────

export interface SignalRepository extends BaseRepository {
  save(signal: PlatformSignal): Promise<PlatformSignal>;
  findByCorrelationId(correlationId: string): Promise<PlatformSignal[]>;
  findUnresolved(): Promise<PlatformSignal[]>;
  markResolved(id: string, resolvedBy: AgentRole | 'human'): Promise<void>;
}

// ─── Audit log repository (GP-002 — immutable) ────────────────────────────────

export interface AuditRecord {
  id: string;
  actor: string;          // agent role or user ID
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface AuditRepository extends BaseRepository {
  append(record: Omit<AuditRecord, 'id' | 'timestamp'>): Promise<AuditRecord>;
  query(params: { entityId?: string; actor?: string; from?: Date; to?: Date; limit: number }): Promise<AuditRecord[]>;
}

// ─── User repository ──────────────────────────────────────────────────────────

import type { UserRole, ProjectRole } from '../types';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  authProvider: string;
  idpSubject: string;
  idpGroups: string[];
  lastLoginAt: Date;
  /**
   * Soft-delete marker. Migration 010 added this column; existing rows
   * have NULL meaning "active". The auth middleware rejects any request
   * whose user is deactivated (403 ACCOUNT_DEACTIVATED) so an existing
   * JWT cannot outlive an admin-driven deactivation.
   */
  deactivatedAt: Date | null;
  createdAt: Date;
}

export interface UserRepository extends BaseRepository {
  upsert(user: Omit<UserRecord, 'id' | 'createdAt' | 'deactivatedAt'>): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
  findByIdpSubject(subject: string, provider: string): Promise<UserRecord | null>;
  /**
   * Case-insensitive lookup. Returns null when the email is not on file.
   * Used by the CLI's `gestalt users role|deactivate|assign` flows so the
   * operator can name a user by email without first calling `list`.
   */
  findByEmail(email: string): Promise<UserRecord | null>;
  /** Search by displayName or email (case-insensitive substring). */
  list(params?: { search?: string; includeDeactivated?: boolean }): Promise<UserRecord[]>;
  count(): Promise<number>;
  updateRole(id: string, role: UserRole): Promise<UserRecord>;
  /** Updates `displayName` (and only `displayName`). */
  updateDisplayName(id: string, displayName: string): Promise<UserRecord>;
  /** Sets `deactivated_at = NOW()` so future requests are 403'd. */
  deactivate(id: string): Promise<UserRecord>;
}

// ─── Project membership repository ───────────────────────────────────────────

export interface ProjectMembershipRecord {
  id: string;
  userId: string;
  projectId: string;
  role: ProjectRole;
  assignedBy: string | null;
  createdAt: Date;
}

/**
 * Project-level access control (one row per (user, project) pair).
 * `platform-admin` users do NOT need a membership row — the auth
 * middleware bypasses every project check for them. Regular `user`
 * accounts must be explicitly assigned.
 *
 * `addMember` upserts: if the (user, project) row already exists it
 * updates the role + assigned_by rather than failing on the UNIQUE
 * constraint. Makes the `set-role` CLI flow idempotent.
 */
export interface ProjectMembershipRepository extends BaseRepository {
  addMember(params: {
    userId: string;
    projectId: string;
    role: ProjectRole;
    assignedBy: string;
  }): Promise<ProjectMembershipRecord>;
  updateRole(userId: string, projectId: string, role: ProjectRole): Promise<ProjectMembershipRecord>;
  removeMember(userId: string, projectId: string): Promise<void>;
  findByProject(projectId: string): Promise<ProjectMembershipRecord[]>;
  findByUser(userId: string): Promise<ProjectMembershipRecord[]>;
  findMembership(userId: string, projectId: string): Promise<ProjectMembershipRecord | null>;
  /** Used by the "cannot remove the last project-admin" guard in the route. */
  countAdmins(projectId: string): Promise<number>;
}

// ─── Local auth credentials repository ────────────────────────────────────────

export interface LocalAuthRecord {
  id: string;
  userId: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface LocalAuthRepository extends BaseRepository {
  create(record: Omit<LocalAuthRecord, 'id' | 'createdAt'>): Promise<LocalAuthRecord>;
  findByEmail(email: string): Promise<LocalAuthRecord | null>;
}

// ─── Project repository (ADR-032 — Git is the project filesystem) ─────────────

export interface ProjectRecord {
  id: string;
  name: string;            // short identifier, unique platform-wide
  gitUrl: string;          // clone URL the server uses for every intent cycle
  defaultBranch: string;   // typically 'main'
  createdBy: string;       // users.id
  createdAt: Date;
}

export interface ProjectRepository extends BaseRepository {
  create(project: Omit<ProjectRecord, 'id' | 'createdAt'>): Promise<ProjectRecord>;
  findById(id: string): Promise<ProjectRecord | null>;
  findByName(name: string): Promise<ProjectRecord | null>;
  list(userId: string): Promise<ProjectRecord[]>;
  /**
   * All registered projects, regardless of `created_by`. Used by the
   * maintenance scheduler — scheduled runs iterate every project, not
   * just one user's view of them.
   */
  listAll(): Promise<ProjectRecord[]>;

  // Credentials are stored alongside but exposed only by id —
  // the token never appears in API responses (see routes/projects.ts).
  saveCredential(projectId: string, token: string): Promise<void>;
  getCredential(projectId: string): Promise<string | null>;
}

// ─── Repository registry ──────────────────────────────────────────────────────

/**
 * The full set of repositories.
 * Adapters implement this interface.
 * The server resolves the active adapter at startup.
 */
export interface RepositoryRegistry {
  intents: IntentRepository;
  executions: AgentExecutionRepository;
  artifacts: ArtifactRepository;
  signals: SignalRepository;
  audit: AuditRepository;
  users: UserRepository;
  localAuth: LocalAuthRepository;
  projects: ProjectRepository;
  deploymentEvents: DeploymentEventRepository;
  maintenanceRuns: MaintenanceRunRepository;
  findingAttempts: FindingAttemptRepository;
  alerts: AlertRepository;
  executionLogs: AgentExecutionLogRepository;
  memberships: ProjectMembershipRepository;
  interventions: InterventionRepository;
}

// ─── Intervention repository (ADR-021) ───────────────────────────────────────

/**
 * Operator response to a paused intent — typically a
 * `GOLDEN_PRINCIPLE_BREACH` escalation. The four `action` values are
 * the only ones ADR-021 defines:
 *   - `resume`: false positive, dispatch to deploy chain
 *   - `abort`: real breach, transition to `failed`
 *   - `acknowledge-breach`: record + notes, transition to `failed`
 *   - `request-clarification`: need more info, pause as
 *     waiting-for-clarification
 *
 * Stored in the `interventions` table (migration 011). `notes` lives
 * here for forensic recall; the audit_log row records only the length.
 */
export type InterventionAction =
  | 'resume'
  | 'abort'
  | 'acknowledge-breach'
  | 'request-clarification';

export interface InterventionRecord {
  id: string;
  correlationId: string;
  intentId: string;
  alertId: string | null;
  action: InterventionAction;
  actorId: string;
  notes: string | null;
  createdAt: Date;
}

export interface InterventionRepository extends BaseRepository {
  create(intervention: Omit<InterventionRecord, 'id' | 'createdAt'>): Promise<InterventionRecord>;
  findByIntentId(intentId: string): Promise<InterventionRecord[]>;
  findByCorrelationId(correlationId: string): Promise<InterventionRecord[]>;
}

// ─── Alert repository ─────────────────────────────────────────────────────────

/**
 * Operator-facing notification of something the platform cannot decide
 * on its own. Today's producers:
 *   - clarification-needed: intent-agent paused the cycle (free-form
 *     intent too vague — see ADR-007 + the 2026-05-30 clarification
 *     session)
 *   - GOLDEN_PRINCIPLE_BREACH: gate / promotion-agent escalated
 *
 * Persisted in the `alerts` table (migration 001). The `intent_id` and
 * action-specific payload (e.g. `suggestions` for clarification alerts)
 * live in the `context` JSONB column so adding a new alert type does
 * not require a schema migration.
 */
export type AlertType =
  | 'clarification-needed'
  | 'GOLDEN_PRINCIPLE_BREACH'
  | 'promotion-pending'
  | 'maintenance-stuck';

export type AlertRequiredAction =
  | 'provide-clarification'
  | 'acknowledge-breach'
  | 'approve-promotion'
  | 'reject-promotion'
  | 'review-manually';

export interface AlertRecord {
  id: string;
  correlationId: string;
  intentId: string | null;
  type: AlertType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  requiredAction: AlertRequiredAction;
  context: Record<string, unknown>;
  createdAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

export interface AlertRepository extends BaseRepository {
  create(
    alert: Omit<AlertRecord, 'id' | 'createdAt' | 'acknowledgedAt' | 'acknowledgedBy'>,
  ): Promise<AlertRecord>;
  findById(id: string): Promise<AlertRecord | null>;
  findUnacknowledged(): Promise<AlertRecord[]>;
  findByCorrelationId(correlationId: string): Promise<AlertRecord[]>;
  acknowledge(id: string, userId: string): Promise<AlertRecord>;
}

// ─── Maintenance run repository (ADR-018, ADR-019, ADR-035) ───────────────────

export type MaintenanceRunStatus = 'running' | 'completed' | 'failed';

/**
 * A single observation produced by a maintenance agent during a run.
 * Persisted on the maintenance_runs row as a JSONB array so dashboards
 * can render the per-run report without joining other tables.
 */
export interface MaintenanceFinding {
  type: string;            // agent-specific kind, e.g. 'context-drift', 'gc-stale-branch'
  description: string;
  affectedFiles: string[];
  severity: 'low' | 'medium' | 'high';
  suggestedAction: string;
}

export interface MaintenanceRunRecord {
  id: string;
  agentRole: string;
  projectId: string | null;
  status: MaintenanceRunStatus;
  intentsQueued: number;
  directFixes: number;
  findings: MaintenanceFinding[];
  durationMs: number | null;
  runAt: Date;
  completedAt: Date | null;
}

export interface MaintenanceRunRepository extends BaseRepository {
  create(
    run: Omit<MaintenanceRunRecord, 'id' | 'runAt' | 'completedAt'>,
  ): Promise<MaintenanceRunRecord>;
  complete(
    id: string,
    result: {
      status: 'completed' | 'failed';
      intentsQueued: number;
      directFixes: number;
      findings: MaintenanceFinding[];
      durationMs: number;
    },
  ): Promise<MaintenanceRunRecord>;
  list(params: {
    projectId?: string;
    agentRole?: string;
    limit: number;
  }): Promise<MaintenanceRunRecord[]>;
}

// ─── Finding attempt repository (ADR-018 idempotency guard) ──────────────────

/**
 * Per-finding attempt counter for the maintenance layer. Persisted in
 * `maintenance_finding_attempts` (migration 008). Used by the runner to
 * avoid looping forever on a finding the context-fixer cannot resolve.
 *
 * `findingHash` is a SHA-256 of `${intent.type}:${affectedFiles[0]}:
 * ${evidence.slice(0,80)}` — see `computeFindingHash` in
 * packages/agents/maintenance/src/runner/index.ts.
 *
 * Workflow:
 *  - on each direct-fix attempt, the runner calls `upsertAttempt`
 *    (increments by 1 or inserts at 1)
 *  - on a real fix (`committed: true` from context-fixer), the runner
 *    calls `resetAttempts` so the next occurrence starts fresh
 *  - once `attemptCount >= MAX_ATTEMPTS`, the runner creates a
 *    `maintenance-stuck` alert and calls `markEscalated`; subsequent
 *    runs skip the finding silently until an operator resets it
 */
export interface FindingAttemptRecord {
  id: string;
  projectId: string;
  findingHash: string;
  attemptCount: number;
  lastAttempted: Date;
  escalated: boolean;
  createdAt: Date;
}

export interface FindingAttemptRepository extends BaseRepository {
  upsertAttempt(projectId: string, findingHash: string): Promise<FindingAttemptRecord>;
  getAttempts(projectId: string, findingHashes: string[]): Promise<FindingAttemptRecord[]>;
  markEscalated(projectId: string, findingHash: string): Promise<void>;
  resetAttempts(projectId: string, findingHash: string): Promise<void>;
  /**
   * Operator-triggered full reset for a project. Deletes EVERY attempt
   * row — escalated or not. Used after manual remediation (e.g., the
   * operator cleaned up the file and wants future runs to start fresh).
   * Returns the number of rows deleted.
   */
  resetAll(projectId: string): Promise<number>;
}

// ─── Deployment event repository (ADR-033) ────────────────────────────────────

export type DeploymentEventType =
  | 'pr-opened'
  | 'pipeline-triggered'
  | 'pipeline-passed'
  | 'pipeline-failed'
  | 'promoted-staging'
  | 'promoted-production';

export interface DeploymentEventRecord {
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
  createdAt: Date;
}

/**
 * Append-only log of every PR / pipeline / promotion event the deploy
 * layer produces. `findStagingPromotion` is the enforcement hook for
 * ADR-034 — the promotion-agent calls it to verify a successful staging
 * deployment exists before allowing production promotion.
 */
export interface DeploymentEventRepository extends BaseRepository {
  append(event: Omit<DeploymentEventRecord, 'id' | 'createdAt'>): Promise<DeploymentEventRecord>;
  findByCorrelationId(correlationId: string): Promise<DeploymentEventRecord[]>;
  /** Returns the most recent `promoted-staging` event for the cycle, or null. */
  findStagingPromotion(correlationId: string): Promise<DeploymentEventRecord | null>;
  /**
   * Deletes rows older than `cutoff`. Called only by gc-agent (ADR-018 /
   * ADR-035): deployment_events are operational logs, not audit records,
   * so periodic pruning is allowed. Returns the number of rows deleted.
   */
  gcOlderThan(cutoff: Date): Promise<number>;
}

let _registry: RepositoryRegistry | null = null;

/**
 * Returns the active repository registry.
 * Throws if not initialised.
 */
export function getRepositories(): RepositoryRegistry {
  if (!_registry) {
    throw new Error('Repository registry not initialised. Call setRepositories() first.');
  }
  return _registry;
}

/**
 * Registers the active adapter's repository implementations.
 * Called once at server startup after the adapter is loaded.
 */
export function setRepositories(registry: RepositoryRegistry): void {
  _registry = registry;
}
