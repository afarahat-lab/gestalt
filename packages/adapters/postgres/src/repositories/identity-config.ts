/**
 * Identity config + role mapping repositories — PostgreSQL
 * implementations (Session 3 — migration 017).
 *
 * Replaces the file-based `auth.config.json` as the primary source of
 * identity config. Sensitive fields (cert / clientSecret /
 * keytabContent) live as `*SecretId` references inside the `config`
 * JSONB; the resolution to plaintext happens in `loadAuthConfig` via
 * the platform_secrets vault.
 */

import type {
  IdentityConfigRepository, IdentityConfigRecord, IdentityProvider,
  RoleMappingRepository, RoleMappingRecord,
} from '@gestalt/core';
import { getDb } from '../client';

interface IdentityConfigRow {
  id: string;
  provider: IdentityProvider;
  enabled: boolean;
  config: unknown;
  updatedBy: string | null;
  updatedAt: Date;
}

function configRowToRecord(row: IdentityConfigRow): IdentityConfigRecord {
  return {
    id: row.id,
    provider: row.provider,
    enabled: row.enabled,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return fallback;
}

export class PostgresIdentityConfigRepository implements IdentityConfigRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    try { await db`SELECT 1 FROM platform_identity_config LIMIT 1`; return true; }
    catch { return false; }
  }

  async list(): Promise<IdentityConfigRecord[]> {
    const db = getDb();
    const rows = await db<IdentityConfigRow[]>`
      SELECT * FROM platform_identity_config ORDER BY provider ASC
    `;
    return rows.map(configRowToRecord);
  }

  async findByProvider(provider: IdentityProvider): Promise<IdentityConfigRecord | null> {
    const db = getDb();
    const [row] = await db<IdentityConfigRow[]>`
      SELECT * FROM platform_identity_config WHERE provider = ${provider} LIMIT 1
    `;
    return row ? configRowToRecord(row) : null;
  }

  async upsert(params: {
    provider: IdentityProvider;
    enabled: boolean;
    config: Record<string, unknown>;
    updatedBy: string;
  }): Promise<IdentityConfigRecord> {
    const db = getDb();
    const configJson = db.json(params.config as unknown as Parameters<typeof db.json>[0]);
    const [row] = await db<IdentityConfigRow[]>`
      INSERT INTO platform_identity_config (provider, enabled, config, updated_by, updated_at)
      VALUES (${params.provider}, ${params.enabled}, ${configJson}, ${params.updatedBy}, NOW())
      ON CONFLICT (provider) DO UPDATE
        SET enabled    = EXCLUDED.enabled,
            config     = EXCLUDED.config,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
      RETURNING *
    `;
    return configRowToRecord(row);
  }
}

interface RoleMappingRow {
  id: string;
  groupName: string;
  platformRole: 'platform-admin' | 'user';
  createdBy: string | null;
  createdAt: Date;
}

export class PostgresRoleMappingRepository implements RoleMappingRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    try { await db`SELECT 1 FROM platform_role_mappings LIMIT 1`; return true; }
    catch { return false; }
  }

  async list(): Promise<RoleMappingRecord[]> {
    const db = getDb();
    const rows = await db<RoleMappingRow[]>`
      SELECT * FROM platform_role_mappings ORDER BY group_name ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      groupName: r.groupName,
      platformRole: r.platformRole,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));
  }

  async add(params: {
    groupName: string;
    platformRole: 'platform-admin' | 'user';
    createdBy: string;
  }): Promise<RoleMappingRecord> {
    const db = getDb();
    const [row] = await db<RoleMappingRow[]>`
      INSERT INTO platform_role_mappings (group_name, platform_role, created_by)
      VALUES (${params.groupName}, ${params.platformRole}, ${params.createdBy})
      RETURNING *
    `;
    return {
      id: row.id,
      groupName: row.groupName,
      platformRole: row.platformRole,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  async remove(id: string): Promise<void> {
    const db = getDb();
    await db`DELETE FROM platform_role_mappings WHERE id = ${id}`;
  }
}
