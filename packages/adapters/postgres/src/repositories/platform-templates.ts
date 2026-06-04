/**
 * Platform templates repository — PostgreSQL implementation
 * (Session 3 — migration 017).
 *
 * The server seeds the built-in `corporate-ops-web-mobile` template
 * from the on-disk `templates/` directory at boot. Operators upload
 * custom templates via the dashboard / `gestalt platform templates
 * upload`; both kinds land in this table.
 *
 * `setDefault` uses the same partial-unique-index + transaction trick
 * `platform_llms` uses — clear the existing default and set the new
 * one inside one `db.begin` block so the index never sees two TRUE
 * rows.
 */

import type {
  PlatformTemplateRepository, PlatformTemplateRecord, PlatformTemplateSummary,
  TemplateVariable,
} from '@gestalt/core';
import { getDb } from '../client';

interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: string;
  version: string;
  isDefault: boolean;
  isBuiltin: boolean;
  files: unknown;
  variables: unknown;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TemplateSummaryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: string;
  version: string;
  isDefault: boolean;
  isBuiltin: boolean;
  variables: unknown;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToRecord(row: TemplateRow): PlatformTemplateRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    tier: row.tier,
    version: row.version,
    isDefault: row.isDefault,
    isBuiltin: row.isBuiltin,
    files: parseJson<Record<string, string>>(row.files, {}),
    variables: parseJson<TemplateVariable[]>(row.variables, []),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function summaryToRecord(row: TemplateSummaryRow): PlatformTemplateSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    tier: row.tier,
    version: row.version,
    isDefault: row.isDefault,
    isBuiltin: row.isBuiltin,
    variables: parseJson<TemplateVariable[]>(row.variables, []),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** postgres.js may return JSONB as a string scalar or a parsed
 *  object; defend against both. Same pattern the alerts /
 *  maintenance_runs / tool_calls repos use. */
function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return fallback;
}

export class PostgresPlatformTemplateRepository implements PlatformTemplateRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    try { await db`SELECT 1 FROM platform_templates LIMIT 1`; return true; }
    catch { return false; }
  }

  async list(): Promise<PlatformTemplateSummary[]> {
    const db = getDb();
    // Narrow projection — `files` can be multi-KB per row × N rows;
    // dashboards never need it in the list view.
    const rows = await db<TemplateSummaryRow[]>`
      SELECT id, slug, name, description, tier, version, is_default,
             is_builtin, variables, created_by, created_at, updated_at
      FROM platform_templates
      ORDER BY is_default DESC, is_builtin DESC, name ASC
    `;
    return rows.map(summaryToRecord);
  }

  async findById(id: string): Promise<PlatformTemplateRecord | null> {
    const db = getDb();
    const [row] = await db<TemplateRow[]>`
      SELECT * FROM platform_templates WHERE id = ${id} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async findBySlug(slug: string): Promise<PlatformTemplateRecord | null> {
    const db = getDb();
    const [row] = await db<TemplateRow[]>`
      SELECT * FROM platform_templates WHERE slug = ${slug} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async findDefault(): Promise<PlatformTemplateRecord | null> {
    const db = getDb();
    const [row] = await db<TemplateRow[]>`
      SELECT * FROM platform_templates WHERE is_default = TRUE LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async create(template: Omit<PlatformTemplateRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlatformTemplateRecord> {
    const db = getDb();
    return db.begin(async (sql) => {
      // If isDefault is requested, clear the existing default first so
      // the partial unique index doesn't reject the INSERT.
      if (template.isDefault) {
        await sql`UPDATE platform_templates SET is_default = FALSE WHERE is_default = TRUE`;
      }
      const filesJson = db.json(template.files as unknown as Parameters<typeof db.json>[0]);
      const varsJson = db.json(template.variables as unknown as Parameters<typeof db.json>[0]);
      const [row] = await sql<TemplateRow[]>`
        INSERT INTO platform_templates
          (slug, name, description, tier, version, is_default, is_builtin,
           files, variables, created_by)
        VALUES
          (${template.slug}, ${template.name}, ${template.description},
           ${template.tier}, ${template.version},
           ${template.isDefault}, ${template.isBuiltin},
           ${filesJson}, ${varsJson},
           ${template.createdBy})
        RETURNING *
      `;
      return rowToRecord(row);
    });
  }

  async update(id: string, updates: Partial<Omit<PlatformTemplateRecord, 'id' | 'createdAt'>>): Promise<PlatformTemplateRecord> {
    const db = getDb();
    return db.begin(async (sql) => {
      if (updates.isDefault === true) {
        await sql`UPDATE platform_templates SET is_default = FALSE WHERE is_default = TRUE AND id != ${id}`;
      }
      const setParts: ReturnType<typeof sql>[] = [];
      if (updates.slug !== undefined)        setParts.push(sql`slug = ${updates.slug}`);
      if (updates.name !== undefined)        setParts.push(sql`name = ${updates.name}`);
      if (updates.description !== undefined) setParts.push(sql`description = ${updates.description}`);
      if (updates.tier !== undefined)        setParts.push(sql`tier = ${updates.tier}`);
      if (updates.version !== undefined)     setParts.push(sql`version = ${updates.version}`);
      if (updates.isDefault !== undefined)   setParts.push(sql`is_default = ${updates.isDefault}`);
      if (updates.isBuiltin !== undefined)   setParts.push(sql`is_builtin = ${updates.isBuiltin}`);
      if (updates.files !== undefined) {
        const filesJson = db.json(updates.files as unknown as Parameters<typeof db.json>[0]);
        setParts.push(sql`files = ${filesJson}`);
      }
      if (updates.variables !== undefined) {
        const varsJson = db.json(updates.variables as unknown as Parameters<typeof db.json>[0]);
        setParts.push(sql`variables = ${varsJson}`);
      }
      setParts.push(sql`updated_at = NOW()`);

      const [row] = await sql<TemplateRow[]>`
        UPDATE platform_templates
        SET ${setParts.flatMap((p, i) => i === 0 ? [p] : [sql`, `, p])}
        WHERE id = ${id}
        RETURNING *
      `;
      if (!row) throw new Error(`Platform template ${id} not found`);
      return rowToRecord(row);
    });
  }

  async setDefault(id: string): Promise<void> {
    const db = getDb();
    await db.begin(async (sql) => {
      await sql`UPDATE platform_templates SET is_default = FALSE WHERE is_default = TRUE`;
      const [row] = await sql<TemplateRow[]>`
        UPDATE platform_templates SET is_default = TRUE, updated_at = NOW()
        WHERE id = ${id} RETURNING id
      `;
      if (!row) throw new Error(`Platform template ${id} not found`);
    });
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db`DELETE FROM platform_templates WHERE id = ${id}`;
  }

  /**
   * Merge the supplied files map into the existing JSONB. `files || $1::jsonb`
   * keeps unsupplied keys untouched. `db.json(...)` ensures the binding lands
   * as proper JSONB (same trap the maintenance_runs / tool_calls repos avoid).
   */
  async updateFiles(id: string, files: Record<string, string>): Promise<PlatformTemplateRecord> {
    const db = getDb();
    const filesJson = db.json(files as unknown as Parameters<typeof db.json>[0]);
    const [row] = await db<TemplateRow[]>`
      UPDATE platform_templates
      SET files = files || ${filesJson}::jsonb,
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Platform template ${id} not found`);
    return rowToRecord(row);
  }

  /**
   * Remove one key from the `files` JSONB. The `-` operator on JSONB returns
   * a copy with the key removed; idempotent when the key is absent.
   */
  async deleteFile(id: string, filePath: string): Promise<PlatformTemplateRecord> {
    const db = getDb();
    const [row] = await db<TemplateRow[]>`
      UPDATE platform_templates
      SET files = files - ${filePath},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Platform template ${id} not found`);
    return rowToRecord(row);
  }

  /**
   * Read the source template and INSERT a copy with new name/slug/createdBy.
   * `isBuiltin: false, isDefault: false` regardless of source — operators flip
   * the default afterwards. Slug clash → unique constraint violation (caller
   * route translates to 409 SLUG_TAKEN).
   */
  async duplicate(
    sourceId: string,
    name: string,
    slug: string,
    createdBy: string | null,
  ): Promise<PlatformTemplateRecord> {
    const source = await this.findById(sourceId);
    if (!source) throw new Error(`Platform template ${sourceId} not found`);
    return this.create({
      slug,
      name,
      description: source.description,
      tier: source.tier === 'Tier 1' ? 'Custom' : source.tier,
      version: source.version,
      isDefault: false,
      isBuiltin: false,
      files: source.files,
      variables: source.variables,
      createdBy,
    });
  }
}
