/**
 * User repository — PostgreSQL implementation.
 *
 * Records are a shadow of whichever IdP (or local auth) issued the
 * identity. Two-level role model since migration 010:
 *   - `role` here is the platform role (`platform-admin` | `user`).
 *   - Per-project access lives in `project_memberships` (see memberships.ts).
 *
 * `deactivated_at` is the soft-delete column; auth middleware rejects
 * any request whose user has a non-null value.
 */

import type { UserRepository, UserRecord, UserRole } from '@gestalt/core';
import { getDb } from '../client';

// The postgres client transforms column names to camelCase
// (see client.ts `transform: { column: postgres.toCamel }`), so the
// returned rows already match the camelCased `UserRecord` shape. We
// keep this thin row → record helper for null-array coercion only.
function rowToRecord(row: UserRecord): UserRecord {
  return {
    ...row,
    idpGroups: row.idpGroups ?? [],
  };
}

export class PostgresUserRepository implements UserRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async upsert(
    user: Omit<UserRecord, 'id' | 'createdAt' | 'deactivatedAt'>,
  ): Promise<UserRecord> {
    const db = getDb();
    const [row] = await db<UserRecord[]>`
      INSERT INTO users (
        email, display_name, role, auth_provider,
        idp_subject, idp_groups, last_login_at
      ) VALUES (
        ${user.email},
        ${user.displayName},
        ${user.role},
        ${user.authProvider},
        ${user.idpSubject},
        ${user.idpGroups},
        ${user.lastLoginAt}
      )
      ON CONFLICT (idp_subject, auth_provider) DO UPDATE SET
        email          = EXCLUDED.email,
        display_name   = EXCLUDED.display_name,
        role           = EXCLUDED.role,
        idp_groups     = EXCLUDED.idp_groups,
        last_login_at  = EXCLUDED.last_login_at
      RETURNING *
    `;
    return rowToRecord(row);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const db = getDb();
    const [row] = await db<UserRecord[]>`
      SELECT * FROM users WHERE id = ${id}
    `;
    return row ? rowToRecord(row) : null;
  }

  async findByIdpSubject(subject: string, provider: string): Promise<UserRecord | null> {
    const db = getDb();
    const [row] = await db<UserRecord[]>`
      SELECT * FROM users
      WHERE idp_subject = ${subject} AND auth_provider = ${provider}
    `;
    return row ? rowToRecord(row) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const db = getDb();
    const [row] = await db<UserRecord[]>`
      SELECT * FROM users
      WHERE LOWER(email) = LOWER(${email})
      LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async list(params?: { search?: string; includeDeactivated?: boolean }): Promise<UserRecord[]> {
    const db = getDb();
    const search = params?.search?.trim();
    const includeDeactivated = params?.includeDeactivated ?? true;
    const pattern = search ? `%${search.toLowerCase()}%` : null;

    const rows = await db<UserRecord[]>`
      SELECT * FROM users
      WHERE
        (${includeDeactivated} OR deactivated_at IS NULL)
        AND (
          ${pattern}::text IS NULL
          OR LOWER(email) LIKE ${pattern}
          OR LOWER(display_name) LIKE ${pattern}
        )
      ORDER BY created_at DESC
    `;
    return rows.map(rowToRecord);
  }

  async count(): Promise<number> {
    const db = getDb();
    const [row] = await db<[{ count: string }]>`SELECT COUNT(*)::text AS count FROM users`;
    return parseInt(row.count, 10);
  }

  async updateRole(id: string, role: UserRole): Promise<UserRecord> {
    const db = getDb();
    const [row] = await db<UserRecord[]>`
      UPDATE users SET role = ${role}
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`User ${id} not found`);
    return rowToRecord(row);
  }

  async updateDisplayName(id: string, displayName: string): Promise<UserRecord> {
    const db = getDb();
    const [row] = await db<UserRecord[]>`
      UPDATE users SET display_name = ${displayName}
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`User ${id} not found`);
    return rowToRecord(row);
  }

  async deactivate(id: string): Promise<UserRecord> {
    const db = getDb();
    const [row] = await db<UserRecord[]>`
      UPDATE users SET deactivated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`User ${id} not found`);
    return rowToRecord(row);
  }
}
