/**
 * @gestalt/core — shared platform types
 * Every other package imports types from here.
 * This file has zero imports from internal packages.
 */

// ─── Agent roles ──────────────────────────────────────────────────────────────

export type AgentRole =
  | 'orchestrator'
  | 'intent-agent'
  | 'design-agent'
  | 'context-agent'
  | 'lint-config-agent'
  | 'code-agent'
  | 'test-agent'
  | 'constraint-agent'
  | 'lint-agent'
  | 'security-agent'
  | 'test-runner-agent'
  | 'review-agent'
  | 'pr-agent'
  | 'pipeline-agent'
  | 'promotion-agent'
  | 'drift-agent'
  | 'alignment-agent'
  | 'gc-agent'
  | 'evaluation-agent'
  | 'context-fixer';

// ─── Signal types ─────────────────────────────────────────────────────────────

export type SignalType =
  | 'LINT_FAILURE'
  | 'TEST_FAILURE'
  | 'CONSTRAINT_VIOLATION'
  | 'CONTEXT_GAP'
  | 'GOLDEN_PRINCIPLE_BREACH';

export type SignalSeverity = 'low' | 'medium' | 'high' | 'critical';

// ─── Task types ───────────────────────────────────────────────────────────────

export type TaskType =
  | 'generate:intent'
  | 'generate:design'
  | 'generate:context'
  | 'generate:lint-config'
  | 'generate:code'
  | 'generate:test'
  | 'gate:lint'
  | 'gate:security'
  | 'gate:constraint'
  | 'gate:test-runner'
  | 'gate:review'
  | 'deploy:pr'
  | 'deploy:pipeline'
  | 'deploy:promotion'
  | 'maintenance:drift'
  | 'maintenance:alignment'
  | 'maintenance:gc'
  | 'maintenance:evaluation';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'background';

// ─── Task message ─────────────────────────────────────────────────────────────

export interface TaskMessage<TPayload = unknown> {
  id: string;
  correlationId: string;
  type: TaskType;
  sourceAgent: AgentRole;
  targetAgent: AgentRole | 'orchestrator';
  priority: TaskPriority;
  payload: TPayload;
  createdAt: Date;
  expiresAt: Date;
}

// ─── Task result ──────────────────────────────────────────────────────────────

export type TaskResultStatus = 'completed' | 'failed' | 'skipped';

export interface TaskResult<TOutput = unknown> {
  taskId: string;
  correlationId: string;
  agentRole: AgentRole;
  status: TaskResultStatus;
  output: TOutput | null;
  signals: PlatformSignal[];
  tokensUsed: number;
  durationMs: number;
  completedAt: Date;
}

// ─── Platform signal ──────────────────────────────────────────────────────────

export interface PlatformSignal {
  id: string;
  correlationId: string;
  type: SignalType;
  severity: SignalSeverity;
  sourceAgent: AgentRole;
  message: string;
  location?: CodeLocation;
  autoResolvable: boolean;
  createdAt: Date;
}

export interface CodeLocation {
  file: string;
  line?: number;
  column?: number;
  rule?: string;
}

// ─── Artifact ─────────────────────────────────────────────────────────────────

export type ArtifactType =
  | 'code'
  | 'test'
  | 'context-file'
  | 'design'
  | 'lint-config';

export interface Artifact {
  id: string;
  correlationId: string;
  type: ArtifactType;
  path: string;
  content: string;
  producedBy: AgentRole;
  createdAt: Date;
}

// ─── User roles ───────────────────────────────────────────────────────────────
//
// Platform-level roles, stored on the `users` table. `platform-admin`
// manages users and bypasses every project membership check; `user` only
// sees projects they are explicitly assigned to via `project_memberships`.
//
// The legacy values (`admin` / `operator` / `viewer`) were migrated to the
// new model in migration 010. Old call sites that read `user.role ===
// 'admin'` will not match `platform-admin` — search for those before
// landing changes.
export type UserRole = 'platform-admin' | 'user';

// Project-level role, stored on `project_memberships.role`. Ordered
// project-admin > editor > reader.
export type ProjectRole = 'project-admin' | 'editor' | 'reader';

// ─── Result type (typed error handling) ──────────────────────────────────────

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
