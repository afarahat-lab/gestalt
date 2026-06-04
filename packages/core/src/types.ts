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
  | 'context-fixer'
  /**
   * Autonomous self-healing diagnostician (migration 020). Diagnoses
   * failures and decides whether to auto-retry or escalate. Not part
   * of any plan — invoked directly from `runSelfHealingLoop` outside
   * the orchestrator's per-step iteration.
   */
  | 'self-healing-agent';

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

/**
 * Cross-layer agent signal — alias of `PlatformSignal` introduced
 * when BaseLLMAgent moved to `@gestalt/core` (2026-06-02). The
 * generate / quality-gate / maintenance packages re-export this as
 * `FeedbackSignal` so historical call sites keep working.
 */
export type FeedbackSignal = PlatformSignal;

/**
 * Lifecycle status of a single agent step. Used by all three layers
 * (generate, gate, maintenance) — moved to core alongside
 * BaseLLMAgent. `'clarification-needed'` is generate-specific (the
 * intent-agent's pause path); other layers only use the first five
 * values. `'skipped'` covers steps the plan declared but the runtime
 * decided not to execute (e.g. lint-config-agent on greenfield).
 */
export type AgentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'clarification-needed';

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

// ─── Pipeline config (ADR-033) ───────────────────────────────────────────────

/**
 * Project-level pipeline configuration. Lives under `pipeline` in
 * `HARNESS.json`. The `adapter` field is consumed by
 * `resolvePipelineAdapter()`; the `autoMerge` + `mergeMethod` fields
 * are consulted by the promotion-agent AFTER staging promotion
 * succeeds — never before CI passes.
 *
 * Defaults:
 *   - `autoMerge`   : false  (PR stays open for human review)
 *   - `mergeMethod` : 'squash' (one commit per intent cycle)
 *
 * `autoMerge: false` means existing projects are unaffected.
 * Operators opt in via `gestalt projects set-adapter ... --auto-merge`.
 */
export interface HarnessPipelineConfig {
  adapter: string;
  autoMerge?: boolean;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
}

// ─── Tool use (ADR-038) ──────────────────────────────────────────────────────
//
// `BaseLLMAgent.callLLMWithTools` drives the loop: LLM emits tool calls,
// the orchestrator dispatches each through `executeFileTool` (built-in
// file tools today; MCP integrations planned in ADR-039), results are
// fed back, the loop continues until the model stops calling tools or
// `MAX_TOOL_CALLS = 10` is reached. Each call lands one entry in
// `agent_execution_logs.tool_calls` (JSONB, migration 012).

/**
 * A tool the LLM can call. Sent verbatim as the OpenAI
 * `tools[{ type: 'function', function: {...} }]` request parameter
 * (with `inputSchema` mapping to `parameters`).
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * A single tool call emitted by the LLM. The orchestrator dispatches
 * `name` to the matching `executeFileTool` branch with `input` as the
 * arguments object.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * The result of executing one tool call. `content` is the textual
 * result fed back to the LLM as the next user turn; `isError: true`
 * sets `is_error` on the OpenAI tool result message so the model can
 * react to the failure rather than silently re-trying.
 */
export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export type BuiltInToolName =
  | 'readFile'
  | 'listDirectory'
  | 'searchFiles'
  | 'getFileTree'
  | 'executeScript';

/**
 * Persisted history of one tool call. `output` is truncated to 500
 * chars before storage. The full result has already been fed back to
 * the LLM in the live loop; the persisted entry is for operator
 * audit, not for re-execution.
 *
 * `toolSource` (ADR-039) distinguishes built-in file tools
 * (`'builtin'`) from MCP server tools (`'mcp:<serverName>'`).
 * Optional for forward compatibility — pre-ADR-039 rows return
 * `undefined`; the dashboard renders an empty source badge in that
 * case so the absence is visible without breaking the layout.
 */
export interface ToolCallLogEntry {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
  calledAt: Date;
  toolSource?: string;
}

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
