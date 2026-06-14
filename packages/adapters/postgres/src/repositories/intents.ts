/**
 * Intent repository — PostgreSQL implementation.
 * Implements @gestalt/core IntentRepository interface.
 */

import type {
  IntentRepository, IntentRecord, IntentStatus, ResumeContext,
  IntentListFilters,
} from '@gestalt/core';
import { getDb } from '../client';
import { parseJsonb } from '../utils';

export class PostgresIntentRepository implements IntentRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const result = await db`SELECT 1 AS ok`;
    return result[0]?.ok === 1;
  }

  async create(
    intent: Omit<IntentRecord, 'createdAt' | 'updatedAt' | 'resolvedAt'> & { parentIntentId?: string | null },
  ): Promise<IntentRecord> {
    const db = getDb();
    // TR_024 (migration 026) — accept optional parentIntentId on
    // create so self-healing-fix children carry the link from the
    // first INSERT. Regular intents pass undefined and the column
    // stays NULL.
    //
    // TR_053 amendment (migration 030) — accept optional parentContext
    // envelope. PlanningGraph's `phaseDispatchNode` populates this
    // with `{kind:'planning-phase', featureId, phaseIndex}` so the
    // `intent.status-changed` event payload can carry the parent
    // featureId without a downstream JOIN.
    const parentIntentId = intent.parentIntentId ?? null;
    const parentContext = intent.parentContext ?? null;
    const [row] = await db<IntentRecord[]>`
      INSERT INTO intents (
        id, correlation_id, project_id, text, status, source, priority, parent_intent_id, parent_context
      ) VALUES (
        ${intent.id},
        ${intent.correlationId},
        ${intent.projectId},
        ${intent.text},
        ${intent.status},
        ${intent.source},
        ${intent.priority},
        ${parentIntentId},
        ${parentContext === null ? null : db.json(parentContext)}
      )
      RETURNING *
    `;
    return row;
  }

  async findById(id: string): Promise<IntentRecord | null> {
    const db = getDb();
    const [row] = await db<IntentRecord[]>`
      SELECT * FROM intents WHERE id = ${id}
    `;
    return row ?? null;
  }

  async findByCorrelationId(correlationId: string): Promise<IntentRecord | null> {
    const db = getDb();
    const [row] = await db<IntentRecord[]>`
      SELECT * FROM intents WHERE correlation_id = ${correlationId}
    `;
    return row ?? null;
  }

  async updateStatus(id: string, status: IntentStatus): Promise<IntentRecord> {
    const db = getDb();
    const [row] = await db<IntentRecord[]>`
      UPDATE intents
      SET
        status = ${status},
        updated_at = NOW(),
        resolved_at = CASE
          WHEN ${status} IN ('deployed', 'failed', 'escalated')
          THEN NOW()
          ELSE resolved_at
        END
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Intent ${id} not found`);
    return row;
  }

  /**
   * Persists the operator's clarification text. The text is intentionally
   * NOT echoed back into any audit metadata — only its length, per
   * GP-006 (no sensitive data in logs). Auditability is preserved via
   * direct DB query against this column.
   */
  async saveClarification(id: string, clarification: string): Promise<IntentRecord> {
    const db = getDb();
    const [row] = await db<IntentRecord[]>`
      UPDATE intents
      SET clarification = ${clarification}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Intent ${id} not found`);
    return row;
  }

  async saveBranchInfo(
    id: string,
    params: { branchName: string; prNumber?: number | null; prUrl?: string | null },
  ): Promise<IntentRecord> {
    const db = getDb();
    // We always set branchName; prNumber / prUrl are set when supplied
    // (they may not be known at the time of the call — e.g. a NoOp
    // adapter or a not-yet-completed PR open).
    const [row] = await db<IntentRecord[]>`
      UPDATE intents
      SET branch_name = ${params.branchName},
          pr_number   = ${params.prNumber ?? null},
          pr_url      = ${params.prUrl ?? null},
          updated_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Intent ${id} not found`);
    return row;
  }

  async list(
    params: IntentListFilters & { projectId: string },
  ): Promise<{ records: IntentRecord[]; total: number }> {
    const db = getDb();
    // Brief 5 — inline conditional filter fragments. Each
    // `${cond ? db\`AND ...\` : db\`\`}` block uses postgres.js's
    // nested-template handling to splice the fragment in (or skip it)
    // at prepared-statement build time
    const searchPattern = params.search ? `%${params.search}%` : null;
    const records = await db<IntentRecord[]>`
      SELECT * FROM intents
      WHERE project_id = ${params.projectId}
      ${params.status   ? db`AND status   = ${params.status}`                : db``}
      ${params.source   ? db`AND source   = ${params.source}`                : db``}
      ${params.priority ? db`AND priority = ${params.priority}`              : db``}
      ${searchPattern   ? db`AND text ILIKE ${searchPattern}`                : db``}
      ${params.from     ? db`AND created_at >= ${params.from}`               : db``}
      ${params.to       ? db`AND created_at <= ${params.to}`                 : db``}
      ORDER BY created_at DESC
      LIMIT ${params.limit}
      OFFSET ${params.offset}
    `;
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM intents
      WHERE project_id = ${params.projectId}
      ${params.status   ? db`AND status   = ${params.status}`                : db``}
      ${params.source   ? db`AND source   = ${params.source}`                : db``}
      ${params.priority ? db`AND priority = ${params.priority}`              : db``}
      ${searchPattern   ? db`AND text ILIKE ${searchPattern}`                : db``}
      ${params.from     ? db`AND created_at >= ${params.from}`               : db``}
      ${params.to       ? db`AND created_at <= ${params.to}`                 : db``}
    `;
    return { records, total: parseInt(count, 10) };
  }

  async listAll(
    params: IntentListFilters,
  ): Promise<{ records: IntentRecord[]; total: number }> {
    const db = getDb();
    const searchPattern = params.search ? `%${params.search}%` : null;
    // Anchor the WHERE on `1=1` (always-true) so the conditional
    // `AND <col> = …` fragments compose cleanly without needing to
    // swap the first AND for a WHERE.
    const records = await db<IntentRecord[]>`
      SELECT * FROM intents
      WHERE 1 = 1
      ${params.status   ? db`AND status   = ${params.status}`                : db``}
      ${params.source   ? db`AND source   = ${params.source}`                : db``}
      ${params.priority ? db`AND priority = ${params.priority}`              : db``}
      ${searchPattern   ? db`AND text ILIKE ${searchPattern}`                : db``}
      ${params.from     ? db`AND created_at >= ${params.from}`               : db``}
      ${params.to       ? db`AND created_at <= ${params.to}`                 : db``}
      ORDER BY created_at DESC
      LIMIT ${params.limit}
      OFFSET ${params.offset}
    `;
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM intents
      WHERE 1 = 1
      ${params.status   ? db`AND status   = ${params.status}`                : db``}
      ${params.source   ? db`AND source   = ${params.source}`                : db``}
      ${params.priority ? db`AND priority = ${params.priority}`              : db``}
      ${searchPattern   ? db`AND text ILIKE ${searchPattern}`                : db``}
      ${params.from     ? db`AND created_at >= ${params.from}`               : db``}
      ${params.to       ? db`AND created_at <= ${params.to}`                 : db``}
    `;
    return { records, total: parseInt(count, 10) };
  }

  /**
   * UNION-style listing across multiple projects. Used by GET /intents
   * when no projectId is supplied — the route resolves every project
   * the user can access via direct membership OR group assignment, and
   * passes the deduped union here. Single round-trip via `= ANY` —
   * no N+1 over per-project queries. Brief 5.
   */
  async listForProjects(
    projectIds: string[],
    filters: IntentListFilters,
  ): Promise<{ records: IntentRecord[]; total: number }> {
    if (projectIds.length === 0) {
      return { records: [], total: 0 };
    }
    const db = getDb();
    const searchPattern = filters.search ? `%${filters.search}%` : null;
    // `project_id` is TEXT on the 001_initial schema (not UUID), so the
    // cast is to text[] not uuid[]. = ANY is a single-pass index check.
    const records = await db<IntentRecord[]>`
      SELECT * FROM intents
      WHERE project_id = ANY(${projectIds}::text[])
      ${filters.status   ? db`AND status   = ${filters.status}`              : db``}
      ${filters.source   ? db`AND source   = ${filters.source}`              : db``}
      ${filters.priority ? db`AND priority = ${filters.priority}`            : db``}
      ${searchPattern    ? db`AND text ILIKE ${searchPattern}`               : db``}
      ${filters.from     ? db`AND created_at >= ${filters.from}`             : db``}
      ${filters.to       ? db`AND created_at <= ${filters.to}`               : db``}
      ORDER BY created_at DESC
      LIMIT ${filters.limit}
      OFFSET ${filters.offset}
    `;
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM intents
      WHERE project_id = ANY(${projectIds}::text[])
      ${filters.status   ? db`AND status   = ${filters.status}`              : db``}
      ${filters.source   ? db`AND source   = ${filters.source}`              : db``}
      ${filters.priority ? db`AND priority = ${filters.priority}`            : db``}
      ${searchPattern    ? db`AND text ILIKE ${searchPattern}`               : db``}
      ${filters.from     ? db`AND created_at >= ${filters.from}`             : db``}
      ${filters.to       ? db`AND created_at <= ${filters.to}`               : db``}
    `;
    return { records, total: parseInt(count, 10) };
  }

  async countByProject(projectId: string): Promise<number> {
    const db = getDb();
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM intents WHERE project_id = ${projectId}
    `;
    return parseInt(count, 10);
  }

  async countActiveByProject(projectId: string): Promise<number> {
    const db = getDb();
    // Non-terminal statuses — anything that could still mutate the
    // project's Git tree. `escalated` is intentionally NOT here: it's
    // a paused state awaiting operator intervention but the deploy
    // chain is not in flight.
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM intents
      WHERE project_id = ${projectId}
        AND status IN ('generating','in-review','deploying','waiting-for-clarification')
    `;
    return parseInt(count, 10);
  }

  async findLatestByProject(projectId: string): Promise<IntentRecord | null> {
    const db = getDb();
    const [row] = await db<IntentRecord[]>`
      SELECT * FROM intents WHERE project_id = ${projectId}
      ORDER BY created_at DESC LIMIT 1
    `;
    return row ?? null;
  }

  /**
   * Persists the resume context. Uses postgres.js's typed `db.json`
   * helper (NOT a stringify-with-cast) so the column stores as proper
   * JSONB rather than a string scalar. See the 2026-06-02 session log
   * for the full rationale and the read-path `parseJsonb` helper.
   *
   * The text content of the context (operator feedback OR
   * self-healing diagnosis) MAY include user-supplied prose. It is
   * NOT echoed into audit metadata — callers record `feedbackLength`
   * only per GP-006. Auditability is via this column.
   */
  async saveResumeContext(id: string, context: ResumeContext): Promise<void> {
    const db = getDb();
    const result = await db`
      UPDATE intents
      SET last_resume_context = ${db.json(
        context as unknown as Parameters<typeof db.json>[0],
      )},
          updated_at = NOW()
      WHERE id = ${id}
    `;
    if (result.count === 0) throw new Error(`Intent ${id} not found`);
  }

  async saveOnSuccessDispatch(
    id: string,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    const db = getDb();
    const jsonValue = payload === null
      ? null
      : db.json(payload as unknown as Parameters<typeof db.json>[0]);
    const result = await db`
      UPDATE intents
      SET on_success_dispatch = ${jsonValue},
          updated_at = NOW()
      WHERE id = ${id}
    `;
    if (result.count === 0) throw new Error(`Intent ${id} not found`);
  }

  /**
   * Atomically bumps the counter and returns the post-increment
   * value. The COALESCE handles legacy rows that pre-date migration
   * 020 (where the column is NULL despite the NOT NULL DEFAULT 0
   * declaration — would never happen on a clean install, but
   * belt-and-braces for upgrade safety).
   */
  async incrementAttemptCount(id: string): Promise<number> {
    const db = getDb();
    const [row] = await db<[{ attemptCount: number }]>`
      UPDATE intents
      SET attempt_count = COALESCE(attempt_count, 0) + 1,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING attempt_count
    `;
    if (!row) throw new Error(`Intent ${id} not found`);
    return row.attemptCount;
  }
}

/**
 * Defensive normaliser for `last_resume_context` column reads. The
 * shared `parseJsonb` helper handles postgres.js's object-vs-string
 * variance for JSONB columns. Used by callers that need the typed
 * `ResumeContext` shape (the server's read path); SELECT * into
 * `IntentRecord` casts directly so this is belt-and-braces. Exported
 * for future consumers.
 */
export function normaliseResumeContext(value: unknown): ResumeContext | null {
  if (value === null || value === undefined) return null;
  const parsed = parseJsonb<Record<string, unknown> | null>(value, null);
  return parsed as unknown as ResumeContext;
}
