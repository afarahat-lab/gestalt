/**
 * Self-healing config repository — PostgreSQL implementation (migration 020).
 *
 * One row per failure type. Rows are seeded by migration 020's INSERT
 * block (idempotent via ON CONFLICT DO NOTHING), so `findByType` and
 * `list` reliably return rows on a fresh install.
 *
 * `update` is partial — only the fields the operator supplied are
 * patched. `updatedBy` and `updatedAt` are always set so the audit
 * trail in `audit_log` can be cross-referenced against the row.
 */

import type {
  SelfHealingConfigRecord, SelfHealingConfigRepository,
} from '@gestalt/core';
import { getDb } from '../client';

interface Row {
  id: string;
  failureType: string;
  maxAttempts: number;
  confidenceThreshold: 'high' | 'medium' | 'low';
  autoResolveAlerts: boolean;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}

function rowToRecord(row: Row): SelfHealingConfigRecord {
  return {
    id: row.id,
    failureType: row.failureType,
    maxAttempts: row.maxAttempts,
    confidenceThreshold: row.confidenceThreshold,
    autoResolveAlerts: row.autoResolveAlerts,
    enabled: row.enabled,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export class PostgresSelfHealingConfigRepository
  implements SelfHealingConfigRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const rows = await db<Row[]>`
      SELECT 1 AS ok FROM platform_self_healing_config LIMIT 1
    `;
    return rows.length > 0;
  }

  async list(): Promise<SelfHealingConfigRecord[]> {
    const db = getDb();
    const rows = await db<Row[]>`
      SELECT id, failure_type, max_attempts, confidence_threshold,
             auto_resolve_alerts, enabled, updated_by, updated_at
      FROM platform_self_healing_config
      ORDER BY failure_type ASC
    `;
    return rows.map(rowToRecord);
  }

  async findByType(failureType: string): Promise<SelfHealingConfigRecord | null> {
    const db = getDb();
    const rows = await db<Row[]>`
      SELECT id, failure_type, max_attempts, confidence_threshold,
             auto_resolve_alerts, enabled, updated_by, updated_at
      FROM platform_self_healing_config
      WHERE failure_type = ${failureType}
      LIMIT 1
    `;
    return rows.length > 0 ? rowToRecord(rows[0]) : null;
  }

  async update(
    failureType: string,
    params: {
      maxAttempts?: number;
      confidenceThreshold?: 'high' | 'medium' | 'low';
      autoResolveAlerts?: boolean;
      enabled?: boolean;
      updatedBy: string;
    },
  ): Promise<SelfHealingConfigRecord> {
    const db = getDb();
    // Per-field conditional UPDATE. Coalescing with the existing
    // value means each field that wasn't supplied keeps its prior
    // setting — partial patches don't accidentally null-out fields.
    const rows = await db<Row[]>`
      UPDATE platform_self_healing_config
      SET
        max_attempts         = COALESCE(${params.maxAttempts ?? null}, max_attempts),
        confidence_threshold = COALESCE(${params.confidenceThreshold ?? null}, confidence_threshold),
        auto_resolve_alerts  = COALESCE(${params.autoResolveAlerts ?? null}, auto_resolve_alerts),
        enabled              = COALESCE(${params.enabled ?? null}, enabled),
        updated_by           = ${params.updatedBy},
        updated_at           = NOW()
      WHERE failure_type = ${failureType}
      RETURNING id, failure_type, max_attempts, confidence_threshold,
                auto_resolve_alerts, enabled, updated_by, updated_at
    `;
    if (rows.length === 0) {
      throw new Error(`No self-healing config for failure type '${failureType}'`);
    }
    return rowToRecord(rows[0]);
  }
}
