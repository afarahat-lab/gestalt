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
  /**
   * How this intent came to exist. `human` = operator submission via
   * `POST /intents`; `maintenance-agent` = queued by the maintenance
   * scheduler. The remaining values (`self-healing`, `auto-resolved`,
   * `operator-resume`, `pipeline-feedback`) are payload-level
   * dispatch sources used by the BullMQ message — most existing
   * intents stay at their original `human` source on retry cycles
   * because the same row is reused. Brief 5 widens the type so
   * `GET /intents?source=` filtering can express the union; future
   * iterations may persist these on the intent row directly.
   */
  source: 'human' | 'maintenance-agent' | 'self-healing'
       | 'auto-resolved' | 'operator-resume' | 'pipeline-feedback'
       | 'self-healing-fix' | 'self-healing-resume';
  priority: 'critical' | 'high' | 'normal' | 'low';
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  /**
   * Branch / PR coordinates assigned by pr-agent after the first
   * push. Migration 019. Populated for cycles that reached deploy;
   * stays NULL forever on intents that failed at gate or never
   * dispatched to deploy. Used by the pipeline-feedback flow to
   * resume on the SAME branch + PR rather than opening a new one.
   */
  branchName: string | null;
  prNumber: number | null;
  prUrl: string | null;
  /**
   * Counter incremented each time the platform dispatches a retry
   * cycle for this intent — operator-feedback resume, self-healing
   * auto-retry, or auto-resolve from an escalated alert. Used by the
   * self-healing loop to enforce per-failure-type retry budgets
   * (`platform_self_healing_config.max_attempts`) and by the
   * dashboard's IntentDetail "Attempt history" panel. Migration 020.
   */
  attemptCount: number;
  /**
   * The most recent resume context for this intent — either the
   * operator's feedback text + diagnosis or the self-healing agent's
   * autonomous diagnosis. Read by `context-assembler` on every
   * dispatch so the prompt's resume section reflects the latest
   * attempt. JSONB on disk; null on intents that have never been
   * resumed. Migration 020.
   */
  lastResumeContext: ResumeContext | null;
  /**
   * TR_024 (migration 026) — self-healing fix-intent linkage.
   *
   *   - `parentIntentId`     null on regular intents. Populated on
   *     fix-intents the self-healing diagnostician spawned
   *     (`source: 'self-healing-fix'`) to point at the intent whose
   *     failure motivated the fix. The original intent is also
   *     pause-and-resume-able through this link — see
   *     `onSuccessDispatch`.
   *
   *   - `onSuccessDispatch`  null on regular intents. Populated on
   *     fix-intents that should automatically resume the parent
   *     after they deploy. Stored as the verbatim BullMQ task
   *     envelope; promotion-agent reads it after production
   *     promotion succeeds and dispatches it onto the queue.
   *     The dispatching layer treats unknown keys as forward-compat.
   *
   * Both columns are NULL on every existing intent — zero
   * behaviour change for intents that don't participate in the
   * fix-intent flow.
   */
  parentIntentId: string | null;
  onSuccessDispatch: Record<string, unknown> | null;
}

/**
 * Persisted on `intents.last_resume_context` (JSONB) every time the
 * platform dispatches a retry cycle. Two shapes share the same
 * column:
 *   - `autoHealed: true`  — the self-healing agent diagnosed and
 *     auto-routed. `diagnosis` / `rootCause` / `skipAgents` /
 *     `focusFiles` carry the agent's recommendation
 *   - `autoHealed: false` — operator supplied free-text feedback
 *     via `POST /alerts/:id/resume` or `POST /alerts/:id/pipeline-feedback`
 *
 * `operatorFeedback` is the prose the prompt reads: prefixed
 * `[Auto] <suggestedFix>` for auto-healed, the verbatim operator
 * text otherwise.
 */
export interface ResumeContext {
  operatorFeedback: string;
  failureType: string;
  failureSummary: string;
  priorSignals: Array<{ type: string; message: string; sourceAgent: string; severity: string }>;
  priorArtifactPaths: string[];
  attemptNumber: number;
  feedbackProvidedAt: string;
  autoHealed: boolean;
  diagnosis?: string;
  rootCause?: string;
  /**
   * Agent roles whose prior output is fine and may be skipped on the
   * retry leg. The orchestrator honours this list ONLY when the
   * diagnosis confidence was `high` — see `runSelfHealingLoop`.
   */
  skipAgents?: string[];
  /**
   * Files identified as the root cause. Surfaced in the code-prompt's
   * resume section to focus the LLM's attention.
   */
  focusFiles?: string[];
  /**
   * Reframed intent text the agent suggests. The orchestrator
   * dispatches this as the new `text` field; the original
   * `intents.text` column is preserved as the historical record.
   */
  updatedIntentText?: string;
  /**
   * The queue the most recent diagnosis chose to dispatch the
   * retry on. One of `generate:intent | deploy:pr | deploy:pipeline
   * | deploy:promote | none`. Persisted so the dashboard's attempt-
   * history view can show "the platform retried deploy:pr"
   * vs "the platform retried generate:intent". Optional — older
   * resume contexts (pre-Option-B) don't have this field.
   */
  retryTaskType?: string;
  /**
   * Hint object the loop forwarded on the retry dispatch. The
   * target agent reads these and adapts its behaviour (unshallow
   * before push, extend pipeline timeout, etc.). Optional —
   * agents handle absence the same as `{}`.
   */
  retryPayloadHints?: Record<string, unknown>;
  /**
   * TR_024 — set by the self-healing loop when the diagnostician's
   * action was `fix-intent`. The dashboard renders an "Awaiting auto-
   * fix" state and the orchestrator skips re-dispatching the parent
   * until the child fix intent's promotion-agent fires the parent's
   * `onSuccessDispatch`.
   */
  waitingForFix?: boolean;
}

/**
 * Filter set accepted by every intent list endpoint (Brief 5).
 *
 *   - `status` — exact match on `intents.status`
 *   - `source` — exact match on `intents.source` (the typed union
 *     above)
 *   - `priority` — exact match on `intents.priority`
 *   - `search` — case-insensitive `ILIKE '%search%'` on `intents.text`
 *   - `from` / `to` — `created_at` bounds (BOTH inclusive); pass `Date`
 *     objects so adapters can format per dialect
 *   - `limit` / `offset` — standard pagination
 *
 * All fields are optional except `limit` and `offset`. Adapters must
 * apply the filters in SQL — postgres uses `($N::text IS NULL OR …)`
 * conditional fragments so the prepared statement shape is constant.
 */
export interface IntentListFilters {
  status?: IntentStatus;
  source?: string;
  priority?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface IntentRepository extends BaseRepository {
  create(intent: Omit<IntentRecord, 'createdAt' | 'updatedAt' | 'resolvedAt' | 'clarification' | 'branchName' | 'prNumber' | 'prUrl' | 'attemptCount' | 'lastResumeContext' | 'parentIntentId' | 'onSuccessDispatch'> & { parentIntentId?: string | null }): Promise<IntentRecord>;
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
  /**
   * Persists the PR branch + (optional) PR number/URL after pr-agent
   * opens the PR (migration 019). Read back by the pipeline-feedback
   * flow so the orchestrator + pr-agent resume on the SAME branch.
   * Idempotent — passing the same values is a no-op.
   */
  saveBranchInfo(id: string, params: {
    branchName: string;
    prNumber?: number | null;
    prUrl?: string | null;
  }): Promise<IntentRecord>;
  /**
   * Persists the self-healing or operator-feedback resume context
   * on `intents.last_resume_context` (JSONB). Called by
   * `runSelfHealingLoop` (autonomous diagnosis path) and by
   * `POST /alerts/:id/resume` / `pipeline-feedback` (operator-feedback
   * path) before the retry dispatch. Migration 020.
   */
  saveResumeContext(id: string, context: ResumeContext): Promise<void>;
  /**
   * TR_024 (migration 026) — persist the BullMQ task envelope the
   * promotion-agent should dispatch after this intent's production
   * deploy succeeds. Used by the self-healing fix-intent flow to
   * resume the parent intent automatically once the fix lands.
   * Idempotent — last write wins. Pass `null` to clear.
   */
  saveOnSuccessDispatch(id: string, dispatch: Record<string, unknown> | null): Promise<void>;
  /**
   * Atomically bumps `intents.attempt_count` and returns the new
   * value. Read on the next dispatch by `runSelfHealingLoop` to
   * enforce the per-failure-type retry budget. Migration 020.
   */
  incrementAttemptCount(id: string): Promise<number>;
  /**
   * Per-project intent list. Now supports the full filter set:
   * `status`, `source`, `priority`, `search` (ILIKE on text), `from` /
   * `to` (created_at bounds, both inclusive). All filters are optional.
   * Brief 5.
   */
  list(params: IntentListFilters & { projectId: string }): Promise<{ records: IntentRecord[]; total: number }>;
  /**
   * Server-wide intent list (no project filter). Used by the
   * platform-admin view of `GET /intents`. Regular users never reach
   * this path — they get a per-project or per-group-membership list
   * via `listForProjects`. Brief 5: now accepts the same filter set.
   */
  listAll(params: IntentListFilters): Promise<{ records: IntentRecord[]; total: number }>;
  /**
   * Multi-project intent list — UNION across direct memberships AND
   * group-derived project access. Used by `GET /intents` when no
   * `projectId` query param is supplied; the route resolves every
   * project the user can access (direct + group), passes the union as
   * `projectIds`, and the SQL applies `= ANY($1::uuid[])`. Brief 5.
   */
  listForProjects(projectIds: string[], filters: IntentListFilters): Promise<{ records: IntentRecord[]; total: number }>;
  /**
   * Returns the total intent count for a project. Used by the
   * platform-admin GET /projects enrichment and by the project
   * delete confirmation modal.
   */
  countByProject(projectId: string): Promise<number>;
  /**
   * Returns the active intent count for a project — intents in
   * non-terminal status (generating / in-review / deploying /
   * waiting-for-clarification). Used by the DELETE /projects/:id
   * active-intents guard.
   */
  countActiveByProject(projectId: string): Promise<number>;
  /**
   * Most recent intent for a project, by `created_at DESC`. Used by
   * the platform-admin GET /projects enrichment to compute
   * `lastActivityAt`. Returns null when the project has no intents.
   */
  findLatestByProject(projectId: string): Promise<IntentRecord | null>;
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
  /**
   * TR_035 / ADR-057 — per-call token-management telemetry from
   * `BaseLLMAgent`'s five-layer pipeline. `null` for non-LLM agents,
   * pre-migration-029 rows, and tool-loop calls (only the final
   * turn's telemetry is captured). Migration 029.
   */
  tokenManagement: TokenManagementLogRecord | null;
  createdAt: Date;
}

/**
 * TR_035 / ADR-057 — JSONB-shape mirror of
 * `TokenManagementLog` in `@gestalt/core/agents/base-llm-agent`.
 * Defined here too so the repository layer doesn't depend on the
 * agents layer. Keep the two in sync.
 */
export interface TokenManagementLogRecord {
  originalPromptTokens: number;
  finalPromptTokens: number;
  reductionStrategy:
    | 'phase-history-summarisation'
    | 'rules-compression'
    | 'architecture-trim'
    | null;
  budgetExpansions: number;
  finalMaxTokens: number;
  truncationOccurred: boolean;
  /** GPT-5.5+ `reasoning_effort` sent on the wire for this call —
   *  observable per-agent thinking-mode telemetry. `null` when the
   *  agent's config didn't set one. */
  reasoningEffort:
    | 'xhigh'
    | 'high'
    | 'medium'
    | 'low'
    | 'non-reasoning'
    | null;
}

export interface AgentExecutionLogRepository extends BaseRepository {
  /**
   * `tokenManagement` is optional on insert so legacy call sites
   * (non-LLM agents, pre-TR_035 orchestrators) don't need updating;
   * `null` is persisted when absent. New LLM call sites populate
   * from `BaseLLMAgent.lastTokenManagement`.
   */
  save(log: Omit<AgentExecutionLogRecord, 'id' | 'createdAt' | 'tokenManagement'> & {
    tokenManagement?: TokenManagementLogRecord | null;
  }): Promise<AgentExecutionLogRecord>;
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
  /**
   * Returns the total membership count for a project. Used by the
   * platform-admin GET /projects enrichment.
   */
  countByProject(projectId: string): Promise<number>;
  /**
   * Deletes every membership row for a project. Called by
   * DELETE /projects/:id BEFORE the project row itself is removed
   * so the membership FK doesn't block the cascade.
   */
  deleteAllForProject(projectId: string): Promise<number>;
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
  /**
   * When set, the Git PAT for this project is resolved from
   * `platform_secrets` instead of the plain `project_git_credentials`
   * table. Takes precedence over the plain token in every credential
   * resolution path. Null = legacy plain-token mode.
   */
  gitSecretId: string | null;
}

export interface ProjectRepository extends BaseRepository {
  create(project: Omit<ProjectRecord, 'id' | 'createdAt' | 'gitSecretId'>): Promise<ProjectRecord>;
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

  /**
   * Wire the project's Git PAT to a vault-managed secret. Replaces
   * any prior reference. Pass `null` to disconnect (the orchestrator
   * will fall back to the plain-token path).
   */
  saveGitSecretRef(projectId: string, secretId: string | null): Promise<void>;

  /**
   * Hard-delete a project row. The route layer is responsible for
   * tearing down dependent tables (memberships / git credentials /
   * maintenance runs) BEFORE calling this so foreign-key constraints
   * succeed. Returns the number of rows deleted (0 or 1).
   */
  delete(projectId: string): Promise<number>;
  /**
   * Delete every git credential row for a project (PATs can rotate so
   * the table is not 1:1 with projects). Called by DELETE
   * /projects/:id before the project row is removed.
   */
  deleteAllCredentials(projectId: string): Promise<number>;
}

// ─── Feature repository (migration 024 — planning layer) ────────────────────

export type FeatureStatus = 'planning' | 'in-progress' | 'completed' | 'blocked' | 'cancelled';
export type PhaseStatus   = 'pending' | 'in-progress' | 'deployed' | 'failed' | 'skipped';

export interface FeatureRecord {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: FeatureStatus;
  /** High-level architecture markdown produced by architecture-agent. */
  architecture: string | null;
  phaseCount: number;
  /**
   * Zero-based index of the phase the planner is currently working
   * on. Bumped after each phase deploys. `phaseCount - 1` is the last
   * phase; `currentPhase === phaseCount` indicates "all phases done".
   */
  currentPhase: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeaturePhaseRecord {
  id: string;
  featureId: string;
  phaseIndex: number;
  title: string;
  /** Aider-ready scope description for this phase. */
  scope: string;
  /** Per-phase architecture markdown produced by architecture-agent. */
  architecture: string | null;
  /** Other phase titles this one depends on. Free-form strings. */
  dependencies: string[];
  status: PhaseStatus;
  /** The generate:intent dispatched for this phase. Null until submission. */
  intentId: string | null;
  /** Phase-evaluator-agent's verdict JSON. Null until evaluation. */
  result: unknown | null;
  /**
   * TR_022 — count of retries the planning orchestrator has already
   * dispatched for this phase. Capped at
   * `HARNESS.json.planner.maxPhaseRetries` (default 2). Migration 025
   * defaults the column to 0 so existing rows behave exactly as they
   * did pre-TR_022.
   */
  retryCount: number;
  /**
   * TR_035 / ADR-057 (Part B2) — squash-merge commit SHA recorded by
   * the deploy promotion-agent after the phase's auto-merged PR
   * closes. Lets the phase-evaluator-agent enumerate built files
   * via `git show --name-only --format= <sha>` instead of falling
   * back to a `git diff` against the default branch. `null` for
   * non-auto-merge adapters (NoOpPipelineAdapter), for phases that
   * pre-date migration 029, and during the window between
   * phase-deployed and merge-commit-write. Migration 029.
   */
  mergeCommitSha: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Append-only event log for operator visibility. Each row is one
 * transition during the feature's planning + execution loop:
 * architecture-designed, plan-built, phase-submitted, phase-deployed,
 * phase-evaluated, plan-adjusted, feature-completed, feature-failed.
 */
export interface FeaturePlanLogRecord {
  id: string;
  featureId: string;
  phaseIndex: number | null;
  eventType: string;
  summary: string;
  detail: unknown | null;
  createdAt: Date;
}

export interface FeatureRepository extends BaseRepository {
  create(feature: Omit<FeatureRecord, 'createdAt' | 'updatedAt' | 'architecture' | 'phaseCount' | 'currentPhase' | 'status'>): Promise<FeatureRecord>;
  findById(id: string): Promise<FeatureRecord | null>;
  listByProject(projectId: string): Promise<FeatureRecord[]>;
  updateStatus(id: string, status: FeatureStatus): Promise<FeatureRecord>;
  /**
   * Persists the high-level architecture markdown + phase count
   * after architecture-agent + planner-agent run. Called once per
   * feature, atomically.
   */
  saveArchitectureAndPlan(id: string, params: { architecture: string; phaseCount: number }): Promise<FeatureRecord>;
  /**
   * Bumps `current_phase` to the supplied value. Called after each
   * phase reaches a terminal status (deployed / failed / skipped).
   */
  setCurrentPhase(id: string, phaseIndex: number): Promise<FeatureRecord>;

  // ── feature_phases CRUD ─────────────────────────────────────────
  createPhase(phase: Omit<FeaturePhaseRecord, 'createdAt' | 'updatedAt' | 'status' | 'intentId' | 'result' | 'retryCount' | 'mergeCommitSha'>): Promise<FeaturePhaseRecord>;
  findPhaseByIndex(featureId: string, phaseIndex: number): Promise<FeaturePhaseRecord | null>;
  listPhases(featureId: string): Promise<FeaturePhaseRecord[]>;
  updatePhaseIntent(phaseId: string, intentId: string): Promise<FeaturePhaseRecord>;
  updatePhaseStatus(phaseId: string, status: PhaseStatus): Promise<FeaturePhaseRecord>;
  savePhaseResult(phaseId: string, result: unknown): Promise<FeaturePhaseRecord>;
  /**
   * TR_022 — atomically bumps `feature_phases.retry_count` and returns
   * the new value. Read by the planning orchestrator on phase failure
   * before deciding whether to re-dispatch `planning:phase` or block
   * the feature.
   */
  incrementPhaseRetry(phaseId: string): Promise<number>;
  /**
   * Reverse lookup — given an intent id, find the phase row that
   * dispatched it. Used by the deploy → planning callback to walk
   * back from a deployed intent to the feature loop. Returns null
   * for intents not driven by the planner.
   */
  findPhaseByIntent(intentId: string): Promise<FeaturePhaseRecord | null>;

  /**
   * TR_034 — persist the architecture-agent's per-phase design (the
   * scoped `PhaseArchitecture` JSON) onto `feature_phases.architecture`.
   * Called by the planning orchestrator when `architectureReviewPerPhase`
   * fires. Downstream `aider-code-agent` reads this back via
   * `findPhaseByIntent(intentId)` to render a scoped Aider message
   * (replacing the full `design-spec.json` that pre-TR_034 fed the
   * Aider message — and was the source of module-name hallucinations).
   * Passing `null` clears the column.
   */
  updatePhaseArchitecture(phaseId: string, architecture: string | null): Promise<FeaturePhaseRecord>;

  /**
   * TR_035 / ADR-057 (Part B2) — persist the squash-merge commit SHA
   * after the phase's PR auto-merges. Called by the deploy
   * promotion-agent. Read by the planning orchestrator when
   * dispatching `planning:evaluate` so phase-evaluator-agent receives
   * an exact handle (`git show --name-only --format= <sha>`) instead
   * of a coarse `git diff origin/<default>`. Migration 029.
   */
  updatePhaseMergeCommit(phaseId: string, mergeCommitSha: string): Promise<FeaturePhaseRecord>;

  // ── feature_plan_log append-only log ────────────────────────────
  appendLog(entry: Omit<FeaturePlanLogRecord, 'id' | 'createdAt'>): Promise<FeaturePlanLogRecord>;
  listLog(featureId: string): Promise<FeaturePlanLogRecord[]>;
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
  platformLlms: PlatformLLMRepository;
  platformSecrets: PlatformSecretRepository;
  /**
   * Master key rotation log (migration 021). Records each successful
   * rotation event; the keys themselves never touch the database.
   */
  keyRotations: KeyRotationRepository;
  platformTemplates: PlatformTemplateRepository;
  platformMcpServers: PlatformMcpServerRepository;
  identityConfig: IdentityConfigRepository;
  roleMappings: RoleMappingRepository;
  platformGroups: PlatformGroupRepository;
  /**
   * Platform-level defaults for the autonomous self-healing loop.
   * Migration 020.
   */
  selfHealingConfig: SelfHealingConfigRepository;
  /**
   * Features + phases + plan log (migration 024 — planning layer).
   * Operators submit features via `POST /features`; the planning
   * orchestrator drives the architecture → plan → phase loop.
   */
  features: FeatureRepository;
}

// ─── Platform LLM registry (migration 014) ───────────────────────────────────

/**
 * One LLM entry as managed by platform-admin. The API key VALUE is
 * never persisted in this table — it lives either as an env var
 * (legacy `apiKeyEnv` — the env var NAME, not its value) or as an
 * encrypted blob in `platform_secrets` referenced by `secretId`
 * (migration 015 — preferred).
 *
 * Single-default invariant: the partial unique index on `is_default`
 * enforces "at most one default" at the DB layer; the application is
 * responsible for ensuring "at least one default" (the server's
 * first-boot seed creates one from the .env config).
 *
 * API key resolution at LLM call time: `secretId` wins when both are
 * set; otherwise fall back to `process.env[apiKeyEnv]`. See
 * `resolveApiKey` in the LLM layer.
 */
/**
 * Wire shape the LLM client uses for this row's requests. Added in
 * migration 023 because OpenAI's reasoning-class models (o1/o3,
 * gpt-5*, …) reject the legacy `max_tokens` parameter and silently
 * ignore `temperature`.
 *
 *   - 'chat-completions' — legacy shape: `max_tokens` + `temperature`.
 *     Covers `gpt-4o*`, `gpt-4-turbo`, `gpt-3.5-turbo`, Azure
 *     OpenAI Chat Completions, Anthropic-proxy, Ollama, vLLM in
 *     OpenAI-compat mode.
 *   - 'responses' — reasoning shape: `max_completion_tokens`,
 *     temperature omitted. Covers OpenAI reasoning models hit via
 *     the Chat Completions endpoint (gpt-5*, o1*, o3*).
 *
 * Future migrations can extend the CHECK constraint to add
 * provider-specific shapes (e.g. `anthropic-messages`) when the
 * registry needs cross-provider variants.
 */
export type LLMApiShape = 'chat-completions' | 'responses';

export interface PlatformLLMRecord {
  id: string;
  name: string;
  provider: string;
  modelString: string;
  baseUrl: string;
  /** Legacy env-var-name path. Null when the row uses a vault secret. */
  apiKeyEnv: string | null;
  /**
   * Vault secret reference (migration 015). Null when the row uses
   * the legacy `apiKeyEnv` path. When BOTH are set, `secretId` wins
   * at LLM call time — operators migrating off env vars can flip
   * `secretId` without immediately clearing `apiKeyEnv`.
   */
  secretId: string | null;
  /** Wire shape — see `LLMApiShape` JSDoc. Defaults to
   *  'chat-completions' on rows created before migration 023. */
  apiShape: LLMApiShape;
  isDefault: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformLLMRepository extends BaseRepository {
  list(): Promise<PlatformLLMRecord[]>;
  findById(id: string): Promise<PlatformLLMRecord | null>;
  findByName(name: string): Promise<PlatformLLMRecord | null>;
  findDefault(): Promise<PlatformLLMRecord | null>;
  /**
   * Find by `modelString` — used by `getLLMClientForModel` to resolve
   * per-agent overrides. Returns the FIRST match; uniqueness on
   * model_string is NOT enforced at the DB layer because the same
   * model name (e.g. `gpt-4o`) can be registered against multiple
   * endpoints (OpenAI directly vs Azure OpenAI vs a vLLM proxy).
   */
  findByModelString(modelString: string): Promise<PlatformLLMRecord | null>;
  create(llm: Omit<PlatformLLMRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlatformLLMRecord>;
  update(id: string, updates: Partial<Omit<PlatformLLMRecord, 'id' | 'createdAt'>>): Promise<PlatformLLMRecord>;
  /** Throws if id is unknown OR if it is the last LLM in the table. */
  delete(id: string): Promise<void>;
  /** Atomically clears the existing default + flips the named id to default. */
  setDefault(id: string): Promise<PlatformLLMRecord>;
  count(): Promise<number>;
}

// ─── Platform secrets vault (migration 015) ──────────────────────────────────

/**
 * Internal repository shape — carries the encrypted ciphertext,
 * initialization vector, and GCM auth tag. This shape is read by the
 * server's vault-decrypt path ONLY (the route handlers that resolve
 * an LLM's API key at call time). It MUST NEVER be returned to a
 * client by any API route.
 *
 * The public-safe surface is `PlatformSecretSummary` below — `list()`
 * returns that shape; route handlers convert by stripping the
 * `encrypted`, `iv`, `authTag` fields before sending.
 */
export interface PlatformSecretRecord {
  id: string;
  name: string;
  description: string | null;
  encrypted: string;
  iv: string;
  authTag: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Public-safe summary — has NONE of the encrypted columns. The
 * `list()` query in the postgres impl selects only these columns
 * directly so the ciphertext never even leaves the database.
 */
export interface PlatformSecretSummary {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformSecretRepository extends BaseRepository {
  create(params: {
    name: string;
    description?: string | null;
    encrypted: string;
    iv: string;
    authTag: string;
    createdBy: string;
  }): Promise<PlatformSecretRecord>;
  update(id: string, params: {
    name?: string;
    description?: string | null;
    encrypted?: string;
    iv?: string;
    authTag?: string;
  }): Promise<PlatformSecretRecord>;
  /** Full record — DO NOT return to clients. Used internally only. */
  findById(id: string): Promise<PlatformSecretRecord | null>;
  /** Full record — DO NOT return to clients. Used by route validation. */
  findByName(name: string): Promise<PlatformSecretRecord | null>;
  /**
   * Public-safe list. The SQL projection MUST omit the encrypted
   * columns so the ciphertext never even leaves Postgres.
   */
  list(): Promise<PlatformSecretSummary[]>;
  /**
   * Throws if the secret is referenced by any `platform_llms` row.
   * The route handler catches `SecretInUseError` and translates to
   * 400 `SECRET_IN_USE` with the list of LLM names.
   */
  delete(id: string): Promise<void>;
  /**
   * List `platform_llms` rows that reference this secret via the
   * `secret_id` column. Used by `delete()` for the SECRET_IN_USE
   * guard and by the dashboard's delete-confirm panel.
   */
  findReferencingLlms(secretId: string): Promise<Array<{ id: string; name: string }>>;
  /**
   * Returns every secret with the full ciphertext columns
   * (`encrypted`, `iv`, `authTag`). Used EXCLUSIVELY by the master
   * key rotation endpoint (`POST /platform/secrets/rotate-key`) for
   * diagnostic / inspection paths. NEVER expose this in any API
   * response.
   */
  findAllRaw(): Promise<PlatformSecretRecord[]>;
  /**
   * Atomically re-encrypts every row in `platform_secrets` under a
   * new master key. The `reencryptFn` is called inside a single DB
   * transaction for each record — it MUST decrypt with the current
   * master key + re-encrypt with the new key + return the new
   * ciphertext. Throwing from `reencryptFn` rolls back the
   * transaction, leaving every row encrypted under the OLD key.
   * Returns the count of rotated secrets.
   */
  rotateMasterKey(
    reencryptFn: (record: PlatformSecretRecord) => {
      encrypted: string; iv: string; authTag: string;
    },
  ): Promise<number>;
}

// ─── Master key rotation log (migration 021) ─────────────────────────────────

/**
 * One row per successful master-key rotation. The rotation itself
 * happens via `POST /platform/secrets/rotate-key` — an atomic
 * transaction that re-encrypts every row in `platform_secrets`
 * under the new key. This table stores ONLY metadata of each
 * successful rotation; the keys themselves NEVER touch the database.
 */
export interface KeyRotationRecord {
  id: string;
  rotatedBy: string | null;
  secretCount: number;
  rotatedAt: Date;
}

export interface KeyRotationRepository extends BaseRepository {
  create(params: { rotatedBy: string; secretCount: number }): Promise<KeyRotationRecord>;
  /** Most recent rotation, or null if no key has ever been rotated. */
  findLatest(): Promise<KeyRotationRecord | null>;
}

// ─── Platform templates (Session 3 — migration 017) ──────────────────────────

/**
 * Variables a template declares for substitution. Documented in the
 * template's metadata so the operator UI can render input fields.
 * Today the engine only does `{{key}}` regex replacement — no
 * conditionals — so `type` is informational.
 */
export interface TemplateVariable {
  name: string;
  description?: string;
  type?: 'string' | 'number' | 'boolean';
  required?: boolean;
  defaultValue?: string;
}

export interface PlatformTemplateRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: string;
  version: string;
  isDefault: boolean;
  isBuiltin: boolean;
  /**
   * Repo-path → file content map. The template engine reads this
   * directly and runs `{{var}}` substitution per file. Built-in
   * templates seed this from the on-disk `templates/<slug>/` tree at
   * startup; custom templates land via the Upload flow.
   */
  files: Record<string, string>;
  variables: TemplateVariable[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Without `files` — used by list endpoints because file maps can be
 *  large (multi-KB per file × 8+ files per template). */
export type PlatformTemplateSummary = Omit<PlatformTemplateRecord, 'files'>;

export interface PlatformTemplateRepository extends BaseRepository {
  list(): Promise<PlatformTemplateSummary[]>;
  findById(id: string): Promise<PlatformTemplateRecord | null>;
  findBySlug(slug: string): Promise<PlatformTemplateRecord | null>;
  findDefault(): Promise<PlatformTemplateRecord | null>;
  create(template: Omit<PlatformTemplateRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlatformTemplateRecord>;
  update(id: string, updates: Partial<Omit<PlatformTemplateRecord, 'id' | 'createdAt'>>): Promise<PlatformTemplateRecord>;
  /** Atomically clears the existing default and sets the new one. */
  setDefault(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * Merge the supplied files map into the template's existing `files` JSONB.
   * MERGE semantics: only the keys included in `files` are changed; other
   * files are preserved unchanged (matches `files || $1::jsonb`).
   * `updatedAt` is set to NOW(). Caller is responsible for built-in guards.
   */
  updateFiles(id: string, files: Record<string, string>): Promise<PlatformTemplateRecord>;
  /**
   * Remove a single file from the template's `files` JSONB. Caller is
   * responsible for guards (built-in, required-file).
   */
  deleteFile(id: string, filePath: string): Promise<PlatformTemplateRecord>;
  /**
   * Copy an existing template's files + variables into a NEW row with the
   * supplied name/slug. The new row is always `isBuiltin: false` and
   * `isDefault: false` (operators set default separately).
   */
  duplicate(sourceId: string, name: string, slug: string, createdBy: string | null): Promise<PlatformTemplateRecord>;
}

// ─── Platform MCP servers (Session 3 — migration 017) ────────────────────────

export interface PlatformMcpServerRecord {
  id: string;
  name: string;
  url: string;
  description: string | null;
  /** Reference into `platform_secrets` for the bearer token; null = anonymous. */
  secretId: string | null;
  enabled: boolean;
  /** Empty array = applies to ALL agents; otherwise per-role allow-list. */
  agentRoles: string[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformMcpServerRepository extends BaseRepository {
  list(): Promise<PlatformMcpServerRecord[]>;
  /** Filtered to `enabled = TRUE`. Called by every cycle's
   *  BaseOrchestrator.resolveAgentContext on hot path. */
  listEnabled(): Promise<PlatformMcpServerRecord[]>;
  findById(id: string): Promise<PlatformMcpServerRecord | null>;
  findByName(name: string): Promise<PlatformMcpServerRecord | null>;
  create(server: Omit<PlatformMcpServerRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlatformMcpServerRecord>;
  update(id: string, updates: Partial<Omit<PlatformMcpServerRecord, 'id' | 'createdAt'>>): Promise<PlatformMcpServerRecord>;
  delete(id: string): Promise<void>;
}

// ─── Platform identity config (Session 3 — migration 017) ────────────────────

export type IdentityProvider = 'kerberos' | 'saml' | 'oidc';

export interface IdentityConfigRecord {
  id: string;
  provider: IdentityProvider;
  enabled: boolean;
  /**
   * Provider-specific configuration. Sensitive fields (cert,
   * clientSecret, keytabContent) are NEVER stored inline — only as
   * `*SecretId` references into `platform_secrets`. The route layer
   * enforces this on PATCH.
   */
  config: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface IdentityConfigRepository extends BaseRepository {
  list(): Promise<IdentityConfigRecord[]>;
  findByProvider(provider: IdentityProvider): Promise<IdentityConfigRecord | null>;
  /** Insert-or-update on `(provider)`. */
  upsert(params: {
    provider: IdentityProvider;
    enabled: boolean;
    config: Record<string, unknown>;
    updatedBy: string;
  }): Promise<IdentityConfigRecord>;
}

export interface RoleMappingRecord {
  id: string;
  groupName: string;
  platformRole: 'platform-admin' | 'user';
  createdBy: string | null;
  createdAt: Date;
}

export interface RoleMappingRepository extends BaseRepository {
  list(): Promise<RoleMappingRecord[]>;
  add(params: {
    groupName: string;
    platformRole: 'platform-admin' | 'user';
    createdBy: string;
  }): Promise<RoleMappingRecord>;
  remove(id: string): Promise<void>;
}

// ─── Platform groups (Brief 1 — bulk user management, migration 018) ────────

/**
 * A group is a named bucket of users plus a set of project-role
 * assignments. Membership in the group implies the union of those
 * project roles on top of any direct `project_memberships` rows the
 * user has. Effective role on a project is `max(direct, group-derived)`
 * — `requireProjectMembership` computes this.
 */
export interface PlatformGroupRecord {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface GroupMembershipRecord {
  groupId: string;
  userId: string;
  addedBy: string | null;
  addedAt: Date;
}

export interface GroupProjectAssignmentRecord {
  groupId: string;
  projectId: string;
  role: 'project-admin' | 'editor' | 'reader';
  assignedBy: string | null;
  assignedAt: Date;
}

/**
 * Joined views the routes consume directly — saves the caller from
 * a follow-up N+1 lookup against `users` / `projects`.
 */
export type GroupMemberWithUser = GroupMembershipRecord & { user: UserRecord };
export type GroupProjectWithProject = GroupProjectAssignmentRecord & { project: ProjectRecord };

/**
 * Effective per-project access for a single user computed from their
 * group memberships. The auth middleware merges this with the user's
 * direct `project_memberships` rows using a role-rank `max(...)`.
 */
export interface EffectiveProjectMembership {
  projectId: string;
  role: 'project-admin' | 'editor' | 'reader';
}

export interface PlatformGroupRepository extends BaseRepository {
  list(): Promise<PlatformGroupRecord[]>;
  findById(id: string): Promise<PlatformGroupRecord | null>;
  findByName(name: string): Promise<PlatformGroupRecord | null>;
  create(params: {
    name: string;
    description?: string | null;
    createdBy: string;
  }): Promise<PlatformGroupRecord>;
  update(id: string, params: {
    name?: string;
    description?: string | null;
  }): Promise<PlatformGroupRecord>;
  delete(id: string): Promise<void>;

  // Members
  addMember(groupId: string, userId: string, addedBy: string): Promise<void>;
  removeMember(groupId: string, userId: string): Promise<void>;
  listMembers(groupId: string): Promise<GroupMemberWithUser[]>;

  // Project assignments
  assignToProject(
    groupId: string,
    projectId: string,
    role: 'project-admin' | 'editor' | 'reader',
    assignedBy: string,
  ): Promise<void>;
  removeFromProject(groupId: string, projectId: string): Promise<void>;
  listProjectAssignments(groupId: string): Promise<GroupProjectWithProject[]>;

  /**
   * Aggregate per-project access for `userId` derived from every
   * group they're a member of. Returned at most once per project
   * (the highest role across all the user's groups). The auth
   * middleware merges this with direct memberships using
   * `max(roleRank(direct), roleRank(group))`.
   */
  getEffectiveMemberships(userId: string): Promise<EffectiveProjectMembership[]>;

  /**
   * Project-side view of group assignments. Returned for the
   * `GET /projects/:id/groups` endpoint — each row carries the
   * group record, the role it has on the project, and the current
   * member count so the dashboard can render "(8 members)" inline
   * without an N+1 lookup. One row per group assigned to the
   * project.
   */
  listAssignedToProject(projectId: string): Promise<Array<{
    group: PlatformGroupRecord;
    role: 'project-admin' | 'editor' | 'reader';
    assignedAt: Date;
    memberCount: number;
  }>>;
}

// ─── Self-healing config (migration 020) ─────────────────────────────────────

/**
 * Platform-level defaults for the autonomous self-healing loop. Seeded
 * with one row per failure type by migration 020. Platform-admins
 * tune the values from `Admin → Self-healing` tab; `runSelfHealingLoop`
 * reads `findByType` on every failure.
 */
export interface SelfHealingConfigRecord {
  id: string;
  failureType: string;
  /** Max self-healing retries per cycle (0–10). 0 disables auto-retry. */
  maxAttempts: number;
  /** Minimum confidence for `shouldRetry` to take effect. */
  confidenceThreshold: 'high' | 'medium' | 'low';
  /**
   * When escalation creates an alert, immediately attempt to resolve
   * it via the self-healing agent at high confidence. Independent of
   * `enabled` — an admin can disable auto-retry while keeping
   * auto-resolve, or vice versa.
   */
  autoResolveAlerts: boolean;
  /** Master kill-switch for this failure type. When false: escalate immediately. */
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface SelfHealingConfigRepository extends BaseRepository {
  list(): Promise<SelfHealingConfigRecord[]>;
  findByType(failureType: string): Promise<SelfHealingConfigRecord | null>;
  update(
    failureType: string,
    params: {
      maxAttempts?: number;
      confidenceThreshold?: 'high' | 'medium' | 'low';
      autoResolveAlerts?: boolean;
      enabled?: boolean;
      updatedBy: string;
    },
  ): Promise<SelfHealingConfigRecord>;
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
  | 'maintenance-stuck'
  /**
   * Pipeline run reported `failed` or `cancelled`. Pipeline-agent
   * creates this alert before transitioning the intent to `failed`
   * so operators see the CI failure in the Alerts view and can
   * submit feedback via `POST /alerts/:id/pipeline-feedback`.
   * Resume happens on the SAME branch + PR (intent.branchName is
   * read on the retry leg).
   */
  | 'pipeline-failed'
  /**
   * Pipeline did not complete within the polling window.
   * Distinct from `pipeline-failed` because the operator may want
   * to investigate the CI infrastructure itself rather than the
   * generated code.
   */
  | 'pipeline-timeout'
  /**
   * Generic error in the generate orchestrator's catch block —
   * e.g. an agent threw, the LLM provider hard-errored, the clone
   * step failed. Self-healing routes these through
   * `runSelfHealingLoop` with `failureType: 'generate-error'`.
   * Migration 020.
   */
  | 'generate-error'
  /**
   * Quality gate exhausted its retry budget without a `pass`
   * verdict. The cycle's prior signals are surfaced to the
   * self-healing agent for diagnosis. Migration 020.
   */
  | 'gate-max-retries'
  /**
   * Deploy chain (pr-agent / pipeline-agent / promotion-agent)
   * threw an unexpected error. Distinct from `pipeline-failed`
   * (which is the CI-system reporting failure). Migration 020.
   */
  | 'deploy-error'
  /**
   * Maintenance scheduler / runner threw an unexpected error.
   * Migration 020.
   */
  | 'maintenance-error'
  /**
   * A custom agent (declared in `agents.yaml custom_agents:`)
   * returned `status: error` or `failed`. The brief routes these
   * through self-healing so a misbehaving custom agent doesn't
   * silently block the cycle. Migration 020.
   */
  | 'custom-agent-failure'
  /**
   * TR_027 / ADR-051 — PR-Agent posted a `CHANGES_REQUESTED`
   * review on the PR. CI may have passed; the verdict comes
   * from PR-Agent's review comment, which is forwarded to the
   * self-healing diagnostician as `technicalDetail`.
   */
  | 'review-requested-changes'
  /**
   * TR_033 — a planner-driven phase intent reached a terminal
   * "stuck" status (`waiting-for-clarification` after self-healing
   * exhausted its cascade-depth budget). The planning orchestrator
   * marks the feature `blocked` and emits this alert so operators
   * see the situation immediately, without having to correlate
   * intent / phase / feature rows manually. No DB CHECK constraint
   * exists on `alerts.type`, so this addition needs no migration.
   */
  | 'feature-blocked';

export type AlertRequiredAction =
  | 'provide-clarification'
  | 'acknowledge-breach'
  | 'approve-promotion'
  | 'reject-promotion'
  | 'review-manually'
  /**
   * Operator submits free-text feedback describing what went
   * wrong and how to fix it. Currently used by pipeline-failed
   * and pipeline-timeout alerts; the feedback is persisted to
   * `intents.clarification` and routed back through the generate
   * cycle with `source: 'pipeline-feedback'`.
   */
  | 'provide-feedback';

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
  /**
   * Fetch a single maintenance run by id. Returns null when the row
   * does not exist (used by `GET /maintenance/runs/:id` so the route
   * can distinguish 404 from a parsed-but-empty result).
   */
  findById(id: string): Promise<MaintenanceRunRecord | null>;
  /**
   * Delete every maintenance_runs row for a project. Called by
   * DELETE /projects/:id so the project FK doesn't block the cascade.
   * Returns the number of rows deleted.
   */
  deleteAllForProject(projectId: string): Promise<number>;
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
  | 'promoted-production'
  // auto-merge support: written by promotion-agent AFTER staging
  // promotion succeeds when HARNESS.json has `pipeline.autoMerge:
  // true`. The DB enum gains this value via migration 013
  // (`ADD VALUE IF NOT EXISTS 'auto-merged'`).
  | 'auto-merged';

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
