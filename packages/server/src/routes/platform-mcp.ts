/**
 * Platform MCP server routes (Session 3 — migration 017).
 *
 *   GET    /platform/mcp-servers           — any authenticated user
 *                                            (orchestrators need it
 *                                            on the hot path)
 *   POST   /platform/mcp-servers           — platform-admin only
 *   PATCH  /platform/mcp-servers/:id       — platform-admin only
 *   DELETE /platform/mcp-servers/:id       — platform-admin only
 *   POST   /platform/mcp-servers/:id/test  — platform-admin only
 *
 * `secret_id` references `platform_secrets`; the actual bearer token
 * is decrypted at orchestration time (BaseOrchestrator) or here for
 * the test endpoint. The secret VALUE is never returned.
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  decryptSecret, McpClient,
  type PlatformMcpServerRecord,
} from '@gestalt/core';
import { requireRole } from '../auth/middleware';
import { getMasterKey } from '../secrets/index';

const log = createContextLogger({ module: 'routes:platform-mcp' });

interface CreateBody {
  name?: unknown;
  url?: unknown;
  description?: unknown;
  secretId?: unknown;
  enabled?: unknown;
  agentRoles?: unknown;
}

interface UpdateBody {
  name?: unknown;
  url?: unknown;
  description?: unknown;
  secretId?: unknown;
  enabled?: unknown;
  agentRoles?: unknown;
}

export async function registerPlatformMcpRoutes(app: FastifyInstance): Promise<void> {

  app.get('/platform/mcp-servers', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
    const records = await getRepositories().platformMcpServers.list();
    return reply.send({ data: records });
  });

  app.post<{ Body: CreateBody }>(
    '/platform/mcp-servers',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const validation = validateCreate(body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }

      const { platformMcpServers, audit } = getRepositories();
      const clash = await platformMcpServers.findByName(validation.fields.name);
      if (clash) {
        return reply.code(409).send({
          error: `MCP server with name '${validation.fields.name}' already exists`,
          code: 'NAME_TAKEN',
        });
      }

      const created = await platformMcpServers.create({
        ...validation.fields,
        createdBy: request.user.id,
      });

      await audit.append({
        actor: request.user.id,
        action: 'platform.mcp-server-added',
        entityType: 'platform_mcp_servers',
        entityId: created.id,
        correlationId: request.correlationId,
        metadata: {
          name: created.name,
          url: created.url,
          enabled: created.enabled,
          agentRoles: created.agentRoles,
          hasSecret: Boolean(created.secretId),
          ip: request.ip,
        },
      });

      log.info({ name: created.name, url: created.url }, 'Platform MCP server created');
      return reply.code(201).send({ data: created });
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateBody }>(
    '/platform/mcp-servers/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const validation = validateUpdate(body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }
      if (Object.keys(validation.fields).length === 0) {
        return reply.code(400).send({ error: 'No fields to update', code: 'EMPTY_PATCH' });
      }

      const { platformMcpServers, audit } = getRepositories();
      const existing = await platformMcpServers.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'MCP server not found' });

      if (validation.fields.name && validation.fields.name !== existing.name) {
        const clash = await platformMcpServers.findByName(validation.fields.name);
        if (clash) {
          return reply.code(409).send({
            error: `MCP server with name '${validation.fields.name}' already exists`,
            code: 'NAME_TAKEN',
          });
        }
      }

      const updated = await platformMcpServers.update(request.params.id, validation.fields);

      await audit.append({
        actor: request.user.id,
        action: 'platform.mcp-server-updated',
        entityType: 'platform_mcp_servers',
        entityId: updated.id,
        correlationId: request.correlationId,
        metadata: {
          name: updated.name,
          changedFields: Object.keys(validation.fields),
          ip: request.ip,
        },
      });

      log.info({ id: updated.id, changedFields: Object.keys(validation.fields) }, 'Platform MCP server updated');
      return reply.send({ data: updated });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/platform/mcp-servers/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformMcpServers, audit } = getRepositories();
      const existing = await platformMcpServers.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'MCP server not found' });

      await platformMcpServers.delete(existing.id);

      await audit.append({
        actor: request.user.id,
        action: 'platform.mcp-server-deleted',
        entityType: 'platform_mcp_servers',
        entityId: existing.id,
        correlationId: request.correlationId,
        metadata: { name: existing.name, url: existing.url, ip: request.ip },
      });

      log.info({ id: existing.id, name: existing.name }, 'Platform MCP server deleted');
      return reply.code(204).send();
    },
  );

  // POST /platform/mcp-servers/:id/test — connect + listTools
  app.post<{ Params: { id: string } }>(
    '/platform/mcp-servers/:id/test',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformMcpServers } = getRepositories();
      const existing = await platformMcpServers.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'MCP server not found' });

      const token = await resolveMcpToken(existing);
      const client = new McpClient(existing.name, existing.url, token);
      const start = Date.now();
      try {
        const tools = await client.listTools();
        const latencyMs = Date.now() - start;
        await client.close().catch(() => undefined);
        return reply.send({
          data: { ok: true, toolCount: tools.length, latencyMs },
        });
      } catch (err) {
        const latencyMs = Date.now() - start;
        await client.close().catch(() => undefined);
        return reply.send({
          data: {
            ok: false,
            toolCount: 0,
            latencyMs,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
  );
}

async function resolveMcpToken(server: PlatformMcpServerRecord): Promise<string | undefined> {
  if (!server.secretId) return undefined;
  const secret = await getRepositories().platformSecrets.findById(server.secretId);
  if (!secret) return undefined;
  try {
    return decryptSecret(
      { encrypted: secret.encrypted, iv: secret.iv, authTag: secret.authTag },
      getMasterKey(),
    );
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err), serverName: server.name },
      'Vault decrypt failed for MCP server token');
    return undefined;
  }
}

type ValidationResult<T> = { ok: true; fields: T } | { ok: false; error: string; code: string };

interface CreateFields {
  name: string;
  url: string;
  description: string | null;
  secretId: string | null;
  enabled: boolean;
  agentRoles: string[];
}

function validateCreate(body: CreateBody): ValidationResult<CreateFields> {
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return { ok: false, code: 'INVALID_NAME', error: 'name is required' };
  }
  if (typeof body.url !== 'string' || !body.url.trim()) {
    return { ok: false, code: 'INVALID_URL', error: 'url is required' };
  }
  if (body.secretId !== undefined && body.secretId !== null && typeof body.secretId !== 'string') {
    return { ok: false, code: 'INVALID_SECRET_ID', error: 'secretId must be a string or null' };
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return { ok: false, code: 'INVALID_ENABLED', error: 'enabled must be a boolean' };
  }
  let agentRoles: string[] = [];
  if (body.agentRoles !== undefined) {
    if (!Array.isArray(body.agentRoles)) {
      return { ok: false, code: 'INVALID_AGENT_ROLES', error: 'agentRoles must be an array' };
    }
    for (const r of body.agentRoles) {
      if (typeof r !== 'string') {
        return { ok: false, code: 'INVALID_AGENT_ROLES', error: 'agentRoles entries must be strings' };
      }
    }
    agentRoles = body.agentRoles as string[];
  }
  return {
    ok: true,
    fields: {
      name: body.name.trim(),
      url: body.url.trim(),
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
      secretId: typeof body.secretId === 'string' ? body.secretId : null,
      enabled: body.enabled === undefined ? true : body.enabled as boolean,
      agentRoles,
    },
  };
}

function validateUpdate(body: UpdateBody): ValidationResult<Partial<CreateFields>> {
  const out: Partial<CreateFields> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return { ok: false, code: 'INVALID_NAME', error: 'name must be a non-empty string' };
    }
    out.name = body.name.trim();
  }
  if (body.url !== undefined) {
    if (typeof body.url !== 'string' || !body.url.trim()) {
      return { ok: false, code: 'INVALID_URL', error: 'url must be a non-empty string' };
    }
    out.url = body.url.trim();
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return { ok: false, code: 'INVALID_DESCRIPTION', error: 'description must be a string or null' };
    }
    out.description = body.description as string | null;
  }
  if (body.secretId !== undefined) {
    if (body.secretId !== null && typeof body.secretId !== 'string') {
      return { ok: false, code: 'INVALID_SECRET_ID', error: 'secretId must be a string or null' };
    }
    out.secretId = body.secretId as string | null;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return { ok: false, code: 'INVALID_ENABLED', error: 'enabled must be a boolean' };
    }
    out.enabled = body.enabled;
  }
  if (body.agentRoles !== undefined) {
    if (!Array.isArray(body.agentRoles)) {
      return { ok: false, code: 'INVALID_AGENT_ROLES', error: 'agentRoles must be an array' };
    }
    for (const r of body.agentRoles) {
      if (typeof r !== 'string') {
        return { ok: false, code: 'INVALID_AGENT_ROLES', error: 'agentRoles entries must be strings' };
      }
    }
    out.agentRoles = body.agentRoles as string[];
  }
  return { ok: true, fields: out };
}
