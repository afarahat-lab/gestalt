/**
 * Deployment event repository — PostgreSQL implementation (ADR-033).
 *
 * Append-only log. The migration `004_deployments.sql` revokes UPDATE +
 * DELETE on this table at the DB layer; this repository exposes only
 * `append` + read queries so a stray call site cannot mutate history.
 *
 * `findStagingPromotion` enforces ADR-034 — promotion-agent uses it to
 * confirm a successful staging deployment exists for the same
 * correlationId before promoting to production. The check is
 * unconditional in the application layer and the DB-level revoke means
 * even a buggy override at the SQL layer would fail.
 */

import type {
  DeploymentEventRepository, DeploymentEventRecord,
} from '@gestalt/core';
import { getDb } from '../client';
import { parseJsonb } from '../utils';

interface DeploymentEventRow {
  id: string;
  correlationId: string;
  intentId: string;
  eventType: DeploymentEventRecord['eventType'];
  environment: string | null;
  prUrl: string | null;
  prNumber: number | null;
  runId: string | null;
  deploymentUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

function rowToRecord(row: DeploymentEventRow): DeploymentEventRecord {
  return {
    id: row.id,
    correlationId: row.correlationId,
    intentId: row.intentId,
    eventType: row.eventType,
    environment: row.environment,
    prUrl: row.prUrl,
    prNumber: row.prNumber,
    runId: row.runId,
    deploymentUrl: row.deploymentUrl,
    // postgres.js may return JSONB as either an object or a JSON-
    // encoded string. Shared `parseJsonb` (../utils) handles both,
    // falling back to {} on a parse failure so the dashboard's
    // `metadata['branch']` lookup is always safe.
    metadata: parseJsonb<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
  };
}

export class PostgresDeploymentEventRepository implements DeploymentEventRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async append(
    event: Omit<DeploymentEventRecord, 'id' | 'createdAt'>,
  ): Promise<DeploymentEventRecord> {
    const db = getDb();
    const [row] = await db<DeploymentEventRow[]>`
      INSERT INTO deployment_events (
        correlation_id, intent_id, event_type,
        environment, pr_url, pr_number, run_id, deployment_url, metadata
      ) VALUES (
        ${event.correlationId},
        ${event.intentId},
        ${event.eventType},
        ${event.environment},
        ${event.prUrl},
        ${event.prNumber},
        ${event.runId},
        ${event.deploymentUrl},
        ${db.json((event.metadata ?? {}) as unknown as Parameters<typeof db.json>[0])}
      )
      RETURNING *
    `;
    return rowToRecord(row);
  }

  async findByCorrelationId(correlationId: string): Promise<DeploymentEventRecord[]> {
    const db = getDb();
    const rows = await db<DeploymentEventRow[]>`
      SELECT * FROM deployment_events
      WHERE correlation_id = ${correlationId}
      ORDER BY created_at ASC
    `;
    return rows.map(rowToRecord);
  }

  async findStagingPromotion(correlationId: string): Promise<DeploymentEventRecord | null> {
    const db = getDb();
    const [row] = await db<DeploymentEventRow[]>`
      SELECT * FROM deployment_events
      WHERE correlation_id = ${correlationId}
        AND event_type = 'promoted-staging'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async gcOlderThan(cutoff: Date): Promise<number> {
    // gc-agent only — migration 005 GRANTs DELETE on this table back to
    // the application role (migration 004 had revoked it under the
    // audit_log analogy). UPDATE stays revoked.
    const db = getDb();
    const rows = await db<{ count: string }[]>`
      WITH deleted AS (
        DELETE FROM deployment_events
        WHERE created_at < ${cutoff}
        RETURNING 1
      )
      SELECT COUNT(*)::text AS count FROM deleted
    `;
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}
