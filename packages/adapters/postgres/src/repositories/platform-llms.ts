/**
 * Platform LLM repository — PostgreSQL implementation (migration 014).
 *
 * One row per registered LLM endpoint. `setDefault` and `update` (when
 * `isDefault: true`) flip the default atomically inside a single
 * transaction so the partial unique index never sees two `TRUE` rows.
 *
 * `delete` refuses to drop the last row OR the current default — the
 * server's seed contract guarantees at least one LLM exists at all
 * times so the LLM call path never has to handle "no LLMs configured".
 */

import type {
  PlatformLLMRepository, PlatformLLMRecord,
} from '@gestalt/core';
import { getDb } from '../client';

interface PlatformLLMRow {
  id: string;
  name: string;
  provider: string;
  modelString: string;
  baseUrl: string;
  apiKeyEnv: string;
  isDefault: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToRecord(row: PlatformLLMRow): PlatformLLMRecord {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    modelString: row.modelString,
    baseUrl: row.baseUrl,
    apiKeyEnv: row.apiKeyEnv,
    isDefault: row.isDefault,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PostgresPlatformLLMRepository implements PlatformLLMRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    const [{ ok }] = await db<[{ ok: number }]>`SELECT 1 AS ok`;
    return ok === 1;
  }

  async list(): Promise<PlatformLLMRecord[]> {
    const db = getDb();
    const rows = await db<PlatformLLMRow[]>`
      SELECT * FROM platform_llms ORDER BY is_default DESC, name ASC
    `;
    return rows.map(rowToRecord);
  }

  async findById(id: string): Promise<PlatformLLMRecord | null> {
    const db = getDb();
    const [row] = await db<PlatformLLMRow[]>`
      SELECT * FROM platform_llms WHERE id = ${id} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async findByName(name: string): Promise<PlatformLLMRecord | null> {
    const db = getDb();
    const [row] = await db<PlatformLLMRow[]>`
      SELECT * FROM platform_llms WHERE name = ${name} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async findDefault(): Promise<PlatformLLMRecord | null> {
    const db = getDb();
    const [row] = await db<PlatformLLMRow[]>`
      SELECT * FROM platform_llms WHERE is_default = TRUE LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async findByModelString(modelString: string): Promise<PlatformLLMRecord | null> {
    const db = getDb();
    // Prefer the default match when multiple rows share a model string
    // — operators usually want the OpenAI direct one over a vLLM
    // proxy when both are registered for `gpt-4o`.
    const [row] = await db<PlatformLLMRow[]>`
      SELECT * FROM platform_llms
      WHERE model_string = ${modelString}
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async create(
    llm: Omit<PlatformLLMRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PlatformLLMRecord> {
    const db = getDb();
    // If incoming row is the default, clear the existing default
    // inside the same transaction so the partial unique index never
    // sees two TRUE rows.
    return await db.begin(async (sql) => {
      if (llm.isDefault) {
        await sql`UPDATE platform_llms SET is_default = FALSE WHERE is_default = TRUE`;
      }
      const [row] = await sql<PlatformLLMRow[]>`
        INSERT INTO platform_llms (
          name, provider, model_string, base_url, api_key_env,
          is_default, description
        ) VALUES (
          ${llm.name},
          ${llm.provider},
          ${llm.modelString},
          ${llm.baseUrl},
          ${llm.apiKeyEnv},
          ${llm.isDefault},
          ${llm.description}
        )
        RETURNING *
      `;
      return rowToRecord(row);
    });
  }

  async update(
    id: string,
    updates: Partial<Omit<PlatformLLMRecord, 'id' | 'createdAt'>>,
  ): Promise<PlatformLLMRecord> {
    const db = getDb();
    return await db.begin(async (sql) => {
      // Atomically clear the existing default when promoting another
      // row.  Same idempotency story as `create` above.
      if (updates.isDefault === true) {
        await sql`
          UPDATE platform_llms
          SET is_default = FALSE
          WHERE is_default = TRUE AND id <> ${id}
        `;
      }
      // Build a partial UPDATE by destructuring known keys.
      const setParts: ReturnType<typeof sql>[] = [];
      if (updates.name !== undefined)        setParts.push(sql`name = ${updates.name}`);
      if (updates.provider !== undefined)    setParts.push(sql`provider = ${updates.provider}`);
      if (updates.modelString !== undefined) setParts.push(sql`model_string = ${updates.modelString}`);
      if (updates.baseUrl !== undefined)     setParts.push(sql`base_url = ${updates.baseUrl}`);
      if (updates.apiKeyEnv !== undefined)   setParts.push(sql`api_key_env = ${updates.apiKeyEnv}`);
      if (updates.isDefault !== undefined)   setParts.push(sql`is_default = ${updates.isDefault}`);
      if (updates.description !== undefined) setParts.push(sql`description = ${updates.description}`);
      setParts.push(sql`updated_at = NOW()`);

      // Compose the SET clause. postgres.js's `sql.unsafe` is the
      // documented way to join fragments. Each fragment is its own
      // typed value insert; joining preserves parameter binding.
      const [row] = await sql<PlatformLLMRow[]>`
        UPDATE platform_llms
        SET ${setParts.flatMap((p, i) => i === 0 ? [p] : [sql`, `, p])}
        WHERE id = ${id}
        RETURNING *
      `;
      if (!row) throw new Error(`Platform LLM ${id} not found`);
      return rowToRecord(row);
    });
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.begin(async (sql) => {
      const [{ count }] = await sql<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM platform_llms
      `;
      const total = parseInt(count, 10);
      if (total <= 1) {
        throw new LastLLMError(id);
      }
      const [row] = await sql<PlatformLLMRow[]>`
        SELECT * FROM platform_llms WHERE id = ${id} LIMIT 1
      `;
      if (!row) throw new Error(`Platform LLM ${id} not found`);
      if (row.isDefault) {
        throw new CannotDeleteDefaultLLMError(id);
      }
      await sql`DELETE FROM platform_llms WHERE id = ${id}`;
    });
  }

  async setDefault(id: string): Promise<PlatformLLMRecord> {
    const db = getDb();
    return await db.begin(async (sql) => {
      // Clear ALL existing defaults (typically one row) then promote
      // the requested id. Inside a single transaction so the partial
      // unique index never sees two TRUE rows.
      await sql`UPDATE platform_llms SET is_default = FALSE WHERE is_default = TRUE`;
      const [row] = await sql<PlatformLLMRow[]>`
        UPDATE platform_llms
        SET is_default = TRUE, updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;
      if (!row) throw new Error(`Platform LLM ${id} not found`);
      return rowToRecord(row);
    });
  }

  async count(): Promise<number> {
    const db = getDb();
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM platform_llms
    `;
    return parseInt(count, 10);
  }
}

// ─── Typed errors ───────────────────────────────────────────────────────────

/** Thrown by `delete` when only one LLM remains. */
export class LastLLMError extends Error {
  constructor(public readonly id: string) {
    super('Cannot delete the only LLM in the registry');
    this.name = 'LastLLMError';
  }
}

/** Thrown by `delete` when the row is the current default. */
export class CannotDeleteDefaultLLMError extends Error {
  constructor(public readonly id: string) {
    super('Cannot delete the default LLM — set another LLM as default first');
    this.name = 'CannotDeleteDefaultLLMError';
  }
}
