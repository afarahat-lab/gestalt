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
