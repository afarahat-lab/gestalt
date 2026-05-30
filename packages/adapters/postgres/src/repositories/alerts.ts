/**
 * Alert repository — PostgreSQL implementation.
 *
 * Persists operator-facing notifications (clarification-needed,
 * GOLDEN_PRINCIPLE_BREACH escalation, etc.) into the `alerts` table
 * declared in `001_initial.sql`.
 *
 * The `alerts` table has no `intent_id` column today — the schema
 * predates the intent FK. Rather than introduce a migration just to
 * surface the link, the orchestrator stashes `intentId` (and any other
 * type-specific payload such as the clarification `suggestions` array)
 * inside the `context` JSONB column. Reading code lifts them back out.
 */

import type {
  AlertRepository, AlertRecord, AlertType, AlertRequiredAction,
} from '@gestalt/core';
import { getDb } from '../client';

interface AlertRow {
  id: string;
  correlationId: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  requiredAction: string;
  context: Record<string, unknown> | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  createdAt: Date;
}

/**
 * Defensive JSONB-array/object parser. postgres.js can return JSONB
 * columns as either a parsed object OR a raw JSON-encoded string,
 * depending on how the column was written and what types are
 * registered. The maintenance-runs repo had the same issue
 * (`parseFindings` — see ADR-035 session); we apply the same pattern
 * here so the dashboard's `alert.context['suggestions']` is always a
 * real array.
 */
function parseContext(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function rowToRecord(row: AlertRow): AlertRecord {
  const context = parseContext(row.context);
  const intentId = typeof context['intentId'] === 'string'
    ? (context['intentId'] as string)
    : null;
  return {
    id: row.id,
    correlationId: row.correlationId,
    intentId,
    type: row.type as AlertType,
    severity: row.severity as AlertRecord['severity'],
    title: row.title,
    description: row.description,
    requiredAction: row.requiredAction as AlertRequiredAction,
    context,
    createdAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedBy: row.acknowledgedBy,
  };
}

export class PostgresAlertRepository implements AlertRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async create(
    alert: Omit<AlertRecord, 'id' | 'createdAt' | 'acknowledgedAt' | 'acknowledgedBy'>,
  ): Promise<AlertRecord> {
    const db = getDb();
    // intentId lives in context, not as its own column — see file header.
    const contextWithIntentId = {
      ...alert.context,
      ...(alert.intentId ? { intentId: alert.intentId } : {}),
    };
    const [row] = await db<AlertRow[]>`
      INSERT INTO alerts (
        correlation_id, type, severity, title, description,
        required_action, context
      ) VALUES (
        ${alert.correlationId},
        ${alert.type},
        ${alert.severity},
        ${alert.title},
        ${alert.description},
        ${alert.requiredAction},
        ${JSON.stringify(contextWithIntentId)}::jsonb
      )
      RETURNING *
    `;
    return rowToRecord(row);
  }

  async findById(id: string): Promise<AlertRecord | null> {
    const db = getDb();
    const rows = await db<AlertRow[]>`SELECT * FROM alerts WHERE id = ${id}`;
    return rows.length ? rowToRecord(rows[0]!) : null;
  }

  async findUnacknowledged(): Promise<AlertRecord[]> {
    const db = getDb();
    const rows = await db<AlertRow[]>`
      SELECT * FROM alerts
       WHERE acknowledged_at IS NULL
       ORDER BY created_at DESC
    `;
    return rows.map(rowToRecord);
  }

  async findByCorrelationId(correlationId: string): Promise<AlertRecord[]> {
    const db = getDb();
    const rows = await db<AlertRow[]>`
      SELECT * FROM alerts
       WHERE correlation_id = ${correlationId}
       ORDER BY created_at DESC
    `;
    return rows.map(rowToRecord);
  }

  async acknowledge(id: string, userId: string): Promise<AlertRecord> {
    const db = getDb();
    const [row] = await db<AlertRow[]>`
      UPDATE alerts
         SET acknowledged_at = NOW(),
             acknowledged_by = ${userId}
       WHERE id = ${id}
       RETURNING *
    `;
    if (!row) throw new Error(`Alert ${id} not found`);
    return rowToRecord(row);
  }
}
