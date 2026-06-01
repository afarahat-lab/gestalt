/**
 * Intent repository — PostgreSQL implementation.
 * Implements @gestalt/core IntentRepository interface.
 */

import type { IntentRepository, IntentRecord, IntentStatus } from '@gestalt/core';
import { getDb } from '../client';

export class PostgresIntentRepository implements IntentRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const result = await db`SELECT 1 AS ok`;
    return result[0]?.ok === 1;
  }

  async create(
    intent: Omit<IntentRecord, 'createdAt' | 'updatedAt' | 'resolvedAt'>,
  ): Promise<IntentRecord> {
    const db = getDb();
    const [row] = await db<IntentRecord[]>`
      INSERT INTO intents (
        id, correlation_id, project_id, text, status, source, priority
      ) VALUES (
        ${intent.id},
        ${intent.correlationId},
        ${intent.projectId},
        ${intent.text},
        ${intent.status},
        ${intent.source},
        ${intent.priority}
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

  async list(params: {
    projectId: string;
    status?: IntentStatus;
    limit: number;
    offset: number;
  }): Promise<{ records: IntentRecord[]; total: number }> {
    const db = getDb();

    const records = await db<IntentRecord[]>`
      SELECT * FROM intents
      WHERE project_id = ${params.projectId}
      ${params.status ? db`AND status = ${params.status}` : db``}
      ORDER BY created_at DESC
      LIMIT ${params.limit}
      OFFSET ${params.offset}
    `;

    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM intents
      WHERE project_id = ${params.projectId}
      ${params.status ? db`AND status = ${params.status}` : db``}
    `;

    return { records, total: parseInt(count, 10) };
  }

  async listAll(params: {
    status?: IntentStatus;
    limit: number;
    offset: number;
  }): Promise<{ records: IntentRecord[]; total: number }> {
    const db = getDb();

    const records = await db<IntentRecord[]>`
      SELECT * FROM intents
      ${params.status ? db`WHERE status = ${params.status}` : db``}
      ORDER BY created_at DESC
      LIMIT ${params.limit}
      OFFSET ${params.offset}
    `;

    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM intents
      ${params.status ? db`WHERE status = ${params.status}` : db``}
    `;

    return { records, total: parseInt(count, 10) };
  }
}
