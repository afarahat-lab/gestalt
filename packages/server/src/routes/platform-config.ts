/**
 * Platform-config routes — LLM registry (migration 014).
 *
 *   GET    /platform/llms              — any authenticated user
 *   POST   /platform/llms              — platform-admin only
 *   PATCH  /platform/llms/:id          — platform-admin only
 *   DELETE /platform/llms/:id          — platform-admin only
 *   POST   /platform/llms/:id/test     — platform-admin only
 *
 * GET is intentionally accessible to ALL authenticated users:
 *   - Agents need to resolve LLMs by model string at run time
 *   - The dashboard's Project Settings dropdown needs the list for
 *     every project-admin (not just platform-admin)
 *
 * The API key VALUE is never returned by GET. The env-var NAME
 * (`apiKeyEnv`) is returned because operators need to see which env
 * var each LLM reads from to configure the server's .env correctly.
 *
 * Audit (GP-002): every mutation writes `action:
 * 'platform.llm-<verb>'` with the LLM id + changed-fields. Values
 * (model string, baseUrl) are included because they're operational
 * config, not secrets; `apiKeyEnv` is included because it's just an
 * env-var name. The KEY value never appears anywhere.
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  type PlatformLLMRecord,
} from '@gestalt/core';
import {
  LastLLMError, CannotDeleteDefaultLLMError,
} from '@gestalt/adapter-postgres';
import { requireRole } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:platform-config' });

const VALID_PROVIDERS = ['openai', 'azure-openai', 'anthropic', 'ollama', 'custom'] as const;
type ValidProvider = typeof VALID_PROVIDERS[number];

interface CreateLLMBody {
  name?: unknown;
  provider?: unknown;
  modelString?: unknown;
  baseUrl?: unknown;
  apiKeyEnv?: unknown;
  isDefault?: unknown;
  description?: unknown;
}

interface UpdateLLMBody {
  name?: unknown;
  provider?: unknown;
  modelString?: unknown;
  baseUrl?: unknown;
  apiKeyEnv?: unknown;
  isDefault?: unknown;
  description?: unknown;
}

export async function registerPlatformConfigRoutes(app: FastifyInstance): Promise<void> {

  // GET /platform/llms — read by every authenticated user
  app.get(
    '/platform/llms',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const records = await getRepositories().platformLlms.list();
      return reply.send({ data: records.map(toPublic) });
    },
  );

  // POST /platform/llms — register a new LLM
  app.post<{ Body: CreateLLMBody }>(
    '/platform/llms',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const validation = validateCreateBody(body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }

      const { platformLlms, audit } = getRepositories();
      const existing = await platformLlms.findByName(validation.fields.name);
      if (existing) {
        return reply.code(409).send({
          error: `LLM with name '${validation.fields.name}' already exists`,
          code: 'NAME_TAKEN',
        });
      }

      try {
        const created = await platformLlms.create({
          ...validation.fields,
        });
        await audit.append({
          actor: request.user.id,
          action: 'platform.llm-added',
          entityType: 'platform_llms',
          entityId: created.id,
          correlationId: request.correlationId,
          metadata: {
            name: created.name,
            provider: created.provider,
            modelString: created.modelString,
            isDefault: created.isDefault,
            apiKeyEnv: created.apiKeyEnv,
            ip: request.ip,
          },
        });
        log.info({ id: created.id, name: created.name, isDefault: created.isDefault }, 'Platform LLM created');
        return reply.code(201).send({ data: toPublic(created) });
      } catch (err) {
        log.error({ err }, 'Platform LLM create failed');
        return reply.code(500).send({
          error: 'Failed to create LLM',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // PATCH /platform/llms/:id — update one row
  app.patch<{ Params: { id: string }; Body: UpdateLLMBody }>(
    '/platform/llms/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const validation = validateUpdateBody(body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }
      if (Object.keys(validation.fields).length === 0) {
        return reply.code(400).send({ error: 'No fields to update', code: 'EMPTY_PATCH' });
      }

      const { platformLlms, audit } = getRepositories();
      const existing = await platformLlms.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'LLM not found' });

      // Renaming to an existing name → 409
      if (validation.fields.name && validation.fields.name !== existing.name) {
        const clash = await platformLlms.findByName(validation.fields.name);
        if (clash) {
          return reply.code(409).send({
            error: `LLM with name '${validation.fields.name}' already exists`,
            code: 'NAME_TAKEN',
          });
        }
      }

      try {
        const updated = await platformLlms.update(request.params.id, validation.fields);
        await audit.append({
          actor: request.user.id,
          action: 'platform.llm-updated',
          entityType: 'platform_llms',
          entityId: updated.id,
          correlationId: request.correlationId,
          metadata: {
            changedFields: Object.keys(validation.fields),
            previousValues: pickFields(existing, Object.keys(validation.fields)),
            newValues: pickFields(updated, Object.keys(validation.fields)),
            ip: request.ip,
          },
        });
        log.info({ id: updated.id, changedFields: Object.keys(validation.fields) }, 'Platform LLM updated');
        return reply.send({ data: toPublic(updated) });
      } catch (err) {
        log.error({ err, id: request.params.id }, 'Platform LLM update failed');
        return reply.code(500).send({
          error: 'Failed to update LLM',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // DELETE /platform/llms/:id — refuses on last row OR default row
  app.delete<{ Params: { id: string } }>(
    '/platform/llms/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformLlms, audit } = getRepositories();
      const existing = await platformLlms.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'LLM not found' });

      try {
        await platformLlms.delete(request.params.id);
        await audit.append({
          actor: request.user.id,
          action: 'platform.llm-deleted',
          entityType: 'platform_llms',
          entityId: existing.id,
          correlationId: request.correlationId,
          metadata: {
            name: existing.name,
            modelString: existing.modelString,
            apiKeyEnv: existing.apiKeyEnv,
            ip: request.ip,
          },
        });
        log.info({ id: existing.id, name: existing.name }, 'Platform LLM deleted');
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof LastLLMError) {
          return reply.code(400).send({
            error: 'Cannot delete the only LLM in the registry',
            code: 'LAST_LLM',
          });
        }
        if (err instanceof CannotDeleteDefaultLLMError) {
          return reply.code(400).send({
            error: 'Cannot delete the default LLM — set another LLM as default first',
            code: 'CANNOT_DELETE_DEFAULT_LLM',
          });
        }
        log.error({ err, id: request.params.id }, 'Platform LLM delete failed');
        return reply.code(500).send({
          error: 'Failed to delete LLM',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // POST /platform/llms/:id/test — minimal completion against the
  // registered endpoint. Returns latency + ok/error so the operator
  // can verify a registered LLM is reachable before any agent uses it.
  app.post<{ Params: { id: string } }>(
    '/platform/llms/:id/test',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformLlms } = getRepositories();
      const existing = await platformLlms.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'LLM not found' });

      const apiKey = process.env[existing.apiKeyEnv] ?? '';
      if (!apiKey) {
        return reply.send({
          data: {
            ok: false,
            latencyMs: 0,
            error: `Environment variable '${existing.apiKeyEnv}' is empty — set it in the server .env`,
          },
        });
      }

      const startedAt = Date.now();
      try {
        const res = await fetch(`${existing.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: existing.modelString,
            messages: [{ role: 'user', content: 'hello' }],
            max_tokens: 5,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const latencyMs = Date.now() - startedAt;
        if (!res.ok) {
          const text = await res.text();
          return reply.send({
            data: {
              ok: false,
              latencyMs,
              error: `Provider ${res.status}: ${text.slice(0, 200)}`,
            },
          });
        }
        return reply.send({ data: { ok: true, latencyMs } });
      } catch (err) {
        return reply.send({
          data: {
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The public shape returned to clients. Drops nothing today
 * (`apiKeyEnv` IS the env var NAME, not the value — keeping it lets
 * operators see which env var each LLM reads from). The KEY value
 * itself is read from `process.env` only at LLM call time and never
 * leaves the server.
 */
function toPublic(r: PlatformLLMRecord): PlatformLLMRecord {
  return r;
}

function pickFields(rec: PlatformLLMRecord, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = (rec as unknown as Record<string, unknown>)[k];
  }
  return out;
}

type ValidationResult<T> = { ok: true; fields: T } | { ok: false; error: string; code: string };

function validateCreateBody(body: CreateLLMBody): ValidationResult<{
  name: string;
  provider: string;
  modelString: string;
  baseUrl: string;
  apiKeyEnv: string;
  isDefault: boolean;
  description: string | null;
}> {
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return { ok: false, code: 'INVALID_NAME', error: 'name is required (non-empty string)' };
  }
  if (typeof body.provider !== 'string' || !VALID_PROVIDERS.includes(body.provider as ValidProvider)) {
    return { ok: false, code: 'INVALID_PROVIDER', error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` };
  }
  if (typeof body.modelString !== 'string' || !body.modelString.trim()) {
    return { ok: false, code: 'INVALID_MODEL_STRING', error: 'modelString is required (non-empty string)' };
  }
  if (typeof body.baseUrl !== 'string' || !body.baseUrl.trim()) {
    return { ok: false, code: 'INVALID_BASE_URL', error: 'baseUrl is required (non-empty string)' };
  }
  if (typeof body.apiKeyEnv !== 'string' || !body.apiKeyEnv.trim()) {
    return { ok: false, code: 'INVALID_API_KEY_ENV', error: 'apiKeyEnv is required (non-empty string, e.g. OPENAI_API_KEY)' };
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
    return { ok: false, code: 'INVALID_IS_DEFAULT', error: 'isDefault must be a boolean' };
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return { ok: false, code: 'INVALID_DESCRIPTION', error: 'description must be a string or null' };
  }
  return {
    ok: true,
    fields: {
      name: body.name.trim(),
      provider: body.provider,
      modelString: body.modelString.trim(),
      baseUrl: body.baseUrl.trim().replace(/\/$/, ''),
      apiKeyEnv: body.apiKeyEnv.trim(),
      isDefault: body.isDefault === true,
      description: typeof body.description === 'string' ? body.description : null,
    },
  };
}

function validateUpdateBody(body: UpdateLLMBody): ValidationResult<Partial<{
  name: string;
  provider: string;
  modelString: string;
  baseUrl: string;
  apiKeyEnv: string;
  isDefault: boolean;
  description: string | null;
}>> {
  const out: Partial<{
    name: string; provider: string; modelString: string;
    baseUrl: string; apiKeyEnv: string; isDefault: boolean; description: string | null;
  }> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { ok: false, code: 'INVALID_NAME', error: 'name must be a non-empty string' };
    out.name = body.name.trim();
  }
  if (body.provider !== undefined) {
    if (typeof body.provider !== 'string' || !VALID_PROVIDERS.includes(body.provider as ValidProvider)) {
      return { ok: false, code: 'INVALID_PROVIDER', error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` };
    }
    out.provider = body.provider;
  }
  if (body.modelString !== undefined) {
    if (typeof body.modelString !== 'string' || !body.modelString.trim()) return { ok: false, code: 'INVALID_MODEL_STRING', error: 'modelString must be a non-empty string' };
    out.modelString = body.modelString.trim();
  }
  if (body.baseUrl !== undefined) {
    if (typeof body.baseUrl !== 'string' || !body.baseUrl.trim()) return { ok: false, code: 'INVALID_BASE_URL', error: 'baseUrl must be a non-empty string' };
    out.baseUrl = body.baseUrl.trim().replace(/\/$/, '');
  }
  if (body.apiKeyEnv !== undefined) {
    if (typeof body.apiKeyEnv !== 'string' || !body.apiKeyEnv.trim()) return { ok: false, code: 'INVALID_API_KEY_ENV', error: 'apiKeyEnv must be a non-empty string' };
    out.apiKeyEnv = body.apiKeyEnv.trim();
  }
  if (body.isDefault !== undefined) {
    if (typeof body.isDefault !== 'boolean') return { ok: false, code: 'INVALID_IS_DEFAULT', error: 'isDefault must be a boolean' };
    out.isDefault = body.isDefault;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') return { ok: false, code: 'INVALID_DESCRIPTION', error: 'description must be a string or null' };
    out.description = body.description as string | null;
  }
  return { ok: true, fields: out };
}
