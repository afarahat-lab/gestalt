/**
 * Platform MCP servers repository — PostgreSQL implementation
 * (Session 3 — migration 017).
 *
 * Platform-wide MCP servers configured by platform-admin. The
 * orchestrator merges these with project-level MCP servers (from
 * `agents.yaml`) at every cycle's `resolveAgentContext` call.
 *
 * `secret_id` references `platform_secrets` for the bearer token;
 * the decrypt + resolution happens at the orchestrator boundary so
 * this module never touches the master key.
 */

import type {
  PlatformMcpServerRepository, PlatformMcpServerRecord,
} from '@gestalt/core';
import { getDb } from '../client';

interface McpServerRow {
  id: string;
  name: string;
  url: string;
  description: string | null;
  secretId: string | null;
  enabled: boolean;
  agentRoles: string[] | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToRecord(row: McpServerRow): PlatformMcpServerRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    description: row.description,
    secretId: row.secretId,
    enabled: row.enabled,
    agentRoles: row.agentRoles ?? [],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PostgresPlatformMcpServerRepository implements PlatformMcpServerRepository {

  async healthCheck(): Promise<boolean> {
    const db = getDb();
    try { await db`SELECT 1 FROM platform_mcp_servers LIMIT 1`; return true; }
    catch { return false; }
  }

  async list(): Promise<PlatformMcpServerRecord[]> {
    const db = getDb();
    const rows = await db<McpServerRow[]>`
      SELECT * FROM platform_mcp_servers ORDER BY name ASC
    `;
    return rows.map(rowToRecord);
  }

  async listEnabled(): Promise<PlatformMcpServerRecord[]> {
    const db = getDb();
    const rows = await db<McpServerRow[]>`
      SELECT * FROM platform_mcp_servers WHERE enabled = TRUE ORDER BY name ASC
    `;
    return rows.map(rowToRecord);
  }

  async findById(id: string): Promise<PlatformMcpServerRecord | null> {
    const db = getDb();
    const [row] = await db<McpServerRow[]>`
      SELECT * FROM platform_mcp_servers WHERE id = ${id} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async findByName(name: string): Promise<PlatformMcpServerRecord | null> {
    const db = getDb();
    const [row] = await db<McpServerRow[]>`
      SELECT * FROM platform_mcp_servers WHERE name = ${name} LIMIT 1
    `;
    return row ? rowToRecord(row) : null;
  }

  async create(server: Omit<PlatformMcpServerRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlatformMcpServerRecord> {
    const db = getDb();
    // postgres.js binds `string[]` as TEXT[] natively when the column
    // type is text[]; no helper needed. Same as the
    // execution-logs.ts artifact_paths / signal_types write path.
    const [row] = await db<McpServerRow[]>`
      INSERT INTO platform_mcp_servers
        (name, url, description, secret_id, enabled, agent_roles, created_by)
      VALUES
        (${server.name}, ${server.url}, ${server.description},
         ${server.secretId}, ${server.enabled},
         ${server.agentRoles},
         ${server.createdBy})
      RETURNING *
    `;
    return rowToRecord(row);
  }

  async update(id: string, updates: Partial<Omit<PlatformMcpServerRecord, 'id' | 'createdAt'>>): Promise<PlatformMcpServerRecord> {
    const db = getDb();
    const setParts: ReturnType<typeof db>[] = [];
    if (updates.name !== undefined)        setParts.push(db`name = ${updates.name}`);
    if (updates.url !== undefined)         setParts.push(db`url = ${updates.url}`);
    if (updates.description !== undefined) setParts.push(db`description = ${updates.description}`);
    if (updates.secretId !== undefined)    setParts.push(db`secret_id = ${updates.secretId}`);
    if (updates.enabled !== undefined)     setParts.push(db`enabled = ${updates.enabled}`);
    if (updates.agentRoles !== undefined)  setParts.push(db`agent_roles = ${updates.agentRoles}`);
    setParts.push(db`updated_at = NOW()`);

    const [row] = await db<McpServerRow[]>`
      UPDATE platform_mcp_servers
      SET ${setParts.flatMap((p, i) => i === 0 ? [p] : [db`, `, p])}
      WHERE id = ${id}
      RETURNING *
    `;
    if (!row) throw new Error(`Platform MCP server ${id} not found`);
    return rowToRecord(row);
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db`DELETE FROM platform_mcp_servers WHERE id = ${id}`;
  }
}
