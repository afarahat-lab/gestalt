/**
 * Platform secrets repository — PostgreSQL implementation (migration 015).
 *
 * The ciphertext columns (`encrypted`, `iv`, `auth_tag`) are returned
 * ONLY by `findById` / `findByName` — the methods route handlers use
 * internally to resolve an LLM's API key at call time. `list()` runs
 * a narrow projection that omits those columns at the SQL layer so
 * the ciphertext never even leaves Postgres on the public path.
 *
 * `delete` runs the SECRET_IN_USE guard inside a single transaction:
 * if any `platform_llms.secret_id` references the row, throws a typed
 * `SecretInUseError`. The route handler catches and returns 400.
 */

import type {
  PlatformSecretRepository, PlatformSecretRecord, PlatformSecretSummary,
} from '@gestalt/core';
import { getDb } from '../client';

interface PlatformSecretRow {
  id: string;
  name: string;
  description: string | null;
  encrypted: string;
  iv: string;
  authTag: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PlatformSecretSummaryRow {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToRecord(row: PlatformSecretRow): PlatformSecretRecord {
  return { ...row };
}

function rowToSummary(row: PlatformSecretSummaryRow): PlatformSecretSummary {
  return { ...row };
}

export class PostgresPlatformSecretRepository implements PlatformSecretRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async create(params: {
    name: string;
    description?: string | null;
    encrypted: string;
    iv: string;
    authTag: string;
    createdBy: string;
  }): Promise<PlatformSecretRecord> {
    const db = getDb();
    const [row] = await db<PlatformSecretRow[]>`
      INSERT INTO platform_secrets (
        name, description, encrypted, iv, auth_tag, created_by
      ) VALUES (
        ${params.name},
        ${params.description ?? null},
        ${params.encrypted},
        ${params.iv},
        ${params.authTag},
        ${params.createdBy}
      )
      RETURNING *
    `;
    return rowToRecord(row);
  }

  async update(
    id: string,
    params: {
      name?: string;
      description?: string | null;
      encrypted?: string;
      iv?: string;
      authTag?: string;
    },
  ): Promise<PlatformSecretRecord> {
    const db = getDb();
    // Build a partial UPDATE by appending typed fragments. Same
    // pattern as `platform-llms.update`.
    const setParts: ReturnType<typeof db>[] = [];
    if (params.name !== undefined)        setParts.push(db`name = ${params.name}`);
    if (params.description !== undefined) setParts.push(db`description = ${params.description}`);
    if (params.encrypted !== undefined)   setParts.push(db`encrypted = ${params.encrypted}`);
    if (params.iv !== undefined)          setParts.push(db`iv = ${params.iv}`);
    if (params.authTag !== undefined)     setParts.push(db`auth_tag = ${params.authTag}`);
    setParts.push(db`updated_at = NOW()`);

    const [row] = await db<PlatformSecretRow[]>`
      UPDATE platform_secrets
      SET ${setParts.flatMap((p, i) => i === 0 ? [p] : [db`, `, p])}
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Platform secret ${id} not found`);
    return rowToRecord(row);
  }

  async findById(id: string): Promise<PlatformSecretRecord | null> {
    const db = getDb();
    const [row] = await db<PlatformSecretRow[]>`
      SELECT * FROM platform_secrets WHERE id = ${id} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async findByName(name: string): Promise<PlatformSecretRecord | null> {
    const db = getDb();
    const [row] = await db<PlatformSecretRow[]>`
      SELECT * FROM platform_secrets WHERE name = ${name} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async list(): Promise<PlatformSecretSummary[]> {
    const db = getDb();
    // Narrow projection — the encrypted/iv/auth_tag columns are
    // explicitly NOT selected so the ciphertext never leaves
    // Postgres on the public path. The brief calls this out as a
    // critical invariant.
    const rows = await db<PlatformSecretSummaryRow[]>`
      SELECT id, name, description, created_by, created_at, updated_at
      FROM platform_secrets
      ORDER BY created_at DESC
    `;
    return rows.map(rowToSummary);
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.begin(async (sql) => {
      // SECRET_IN_USE guard — refuse to delete if any platform_llms
      // row still references this secret. Returning the offending
      // LLM names + ids lets the route surface an actionable error.
      const refs = await sql<Array<{ id: string; name: string }>>`
        SELECT id, name FROM platform_llms WHERE secret_id = ${id}
      `;
      if (refs.length > 0) {
        throw new SecretInUseError(id, refs.map((r) => r.name));
      }
      const [row] = await sql<Array<{ id: string }>>`
        SELECT id FROM platform_secrets WHERE id = ${id}
      `;
      if (!row) throw new Error(`Platform secret ${id} not found`);
      await sql`DELETE FROM platform_secrets WHERE id = ${id}`;
    });
  }

  async findReferencingLlms(secretId: string): Promise<Array<{ id: string; name: string }>> {
    const db = getDb();
    return await db<Array<{ id: string; name: string }>>`
      SELECT id, name FROM platform_llms WHERE secret_id = ${secretId} ORDER BY name
    `;
  }

  /**
   * Returns every secret with full ciphertext columns. Used EXCLUSIVELY
   * by the master key rotation endpoint for diagnostic / inspection.
   * NEVER expose results in any API response.
   */
  async findAllRaw(): Promise<PlatformSecretRecord[]> {
    const db = getDb();
    const rows = await db<PlatformSecretRow[]>`
      SELECT * FROM platform_secrets ORDER BY created_at
    `;
    return rows.map(rowToRecord);
  }

  /**
   * Atomically re-encrypt every row under a new master key. The whole
   * SELECT + UPDATE loop runs inside `db.begin` so any thrown
   * `reencryptFn` (e.g. decryption failure on a corrupt row) rolls
   * back the entire rotation — leaves all rows encrypted under the
   * OLD key, master key in the server stays the old one.
   */
  async rotateMasterKey(
    reencryptFn: (record: PlatformSecretRecord) => {
      encrypted: string; iv: string; authTag: string;
    },
  ): Promise<number> {
    const db = getDb();
    let count = 0;
    await db.begin(async (sql) => {
      const rows = await sql<PlatformSecretRow[]>`
        SELECT * FROM platform_secrets ORDER BY created_at
      `;
      for (const row of rows) {
        const fresh = reencryptFn(rowToRecord(row));
        await sql`
          UPDATE platform_secrets
          SET encrypted  = ${fresh.encrypted},
              iv         = ${fresh.iv},
              auth_tag   = ${fresh.authTag},
              updated_at = NOW()
          WHERE id = ${row.id}
        `;
        count++;
      }
    });
    return count;
  }
}

/**
 * Thrown by `delete` when the secret is still referenced by at least
 * one `platform_llms.secret_id`. The route layer translates this to
 * HTTP 400 `SECRET_IN_USE` with the list of LLM names.
 */
export class SecretInUseError extends Error {
  constructor(
    public readonly id: string,
    public readonly llmNames: string[],
  ) {
    super(`Cannot delete secret ${id} — still referenced by ${llmNames.length} LLM(s)`);
    this.name = 'SecretInUseError';
  }
}
