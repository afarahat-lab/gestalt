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
  Artifact, ArtifactType, PlatformSignal, AgentRole,
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
  status: IntentStatus;
  source: 'human' | 'maintenance-agent';
  priority: 'critical' | 'high' | 'normal' | 'low';
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface IntentRepository extends BaseRepository {
  create(intent: Omit<IntentRecord, 'createdAt' | 'updatedAt' | 'resolvedAt'>): Promise<IntentRecord>;
  findById(id: string): Promise<IntentRecord | null>;
  findByCorrelationId(correlationId: string): Promise<IntentRecord | null>;
  updateStatus(id: string, status: IntentStatus): Promise<IntentRecord>;
  list(params: { projectId: string; status?: IntentStatus; limit: number; offset: number }): Promise<{ records: IntentRecord[]; total: number }>;
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

import type { UserRole } from '../types';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  authProvider: string;
  idpSubject: string;
  idpGroups: string[];
  lastLoginAt: Date;
  createdAt: Date;
}

export interface UserRepository extends BaseRepository {
  upsert(user: Omit<UserRecord, 'id' | 'createdAt'>): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
  findByIdpSubject(subject: string, provider: string): Promise<UserRecord | null>;
  list(): Promise<UserRecord[]>;
  count(): Promise<number>;
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
  alerts: AlertRepository;
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
  | 'promotion-pending';

export type AlertRequiredAction =
  | 'provide-clarification'
  | 'acknowledge-breach'
  | 'approve-promotion'
  | 'reject-promotion';

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
