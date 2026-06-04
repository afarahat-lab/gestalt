/**
 * Key rotations repository — PostgreSQL implementation (migration 021).
 *
 * Records every successful master-key rotation. The actual rotation
 * (re-encrypting every row in `platform_secrets`) is driven by
 * `POST /platform/secrets/rotate-key` — this repository only stores
 * the audit metadata. The keys themselves NEVER touch the database.
 */

import type {
  KeyRotationRecord, KeyRotationRepository,
} from '@gestalt/core';
import { getDb } from '../client';

interface KeyRotationRow {
  id: string;
  rotatedBy: string | null;
  secretCount: number;
  rotatedAt: Date;
}

function rowToRecord(row: KeyRotationRow): KeyRotationRecord {
  return { ...row };
}

export class PostgresKeyRotationRepository implements KeyRotationRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async create(params: {
    rotatedBy: string;
    secretCount: number;
  }): Promise<KeyRotationRecord> {
    const db = getDb();
    const [row] = await db<KeyRotationRow[]>`
      INSERT INTO platform_key_rotations (rotated_by, secret_count)
      VALUES (${params.rotatedBy}, ${params.secretCount})
      RETURNING *
    `;
    return rowToRecord(row);
  }

  async findLatest(): Promise<KeyRotationRecord | null> {
    const db = getDb();
    const [row] = await db<KeyRotationRow[]>`
      SELECT * FROM platform_key_rotations
      ORDER BY rotated_at DESC
      LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }
}
