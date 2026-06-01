/**
 * Intervention repository — PostgreSQL implementation.
 *
 * One row per operator response to an escalated intent (ADR-021).
 * postgres.js camelCases the column names at the client level
 * (`transform: { column: postgres.toCamel }` in client.ts), so the
 * returned rows already match `InterventionRecord` field-for-field.
 */

import type {
  InterventionRepository, InterventionRecord, InterventionAction,
} from '@gestalt/core';
import { getDb } from '../client';

export class PostgresInterventionRepository implements InterventionRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async create(
    intervention: Omit<InterventionRecord, 'id' | 'createdAt'>,
  ): Promise<InterventionRecord> {
    const db = getDb();
    const [row] = await db<InterventionRecord[]>`
      INSERT INTO interventions (
        correlation_id, intent_id, alert_id, action, actor_id, notes
      ) VALUES (
        ${intervention.correlationId},
        ${intervention.intentId},
        ${intervention.alertId},
        ${intervention.action as InterventionAction},
        ${intervention.actorId},
        ${intervention.notes}
      )
      RETURNING *
    `;
    return row;
  }

  async findByIntentId(intentId: string): Promise<InterventionRecord[]> {
    const db = getDb();
    const rows = await db<InterventionRecord[]>`
      SELECT * FROM interventions
      WHERE intent_id = ${intentId}
      ORDER BY created_at ASC
    `;
    return rows;
  }

  async findByCorrelationId(correlationId: string): Promise<InterventionRecord[]> {
    const db = getDb();
    const rows = await db<InterventionRecord[]>`
      SELECT * FROM interventions
      WHERE correlation_id = ${correlationId}
      ORDER BY created_at ASC
    `;
    return rows;
  }
}
