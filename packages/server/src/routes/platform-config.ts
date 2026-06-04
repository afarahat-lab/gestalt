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
  getRepositories, createContextLogger, decryptSecret,
  type PlatformLLMRecord,
} from '@gestalt/core';
import {
  LastLLMError, CannotDeleteDefaultLLMError,
} from '@gestalt/adapter-postgres';
import { requireRole } from '../auth/middleware';
import { getMasterKey } from '../secrets/index';

const log = createContextLogger({ module: 'routes:platform-config' });

const VALID_PROVIDERS = ['openai', 'azure-openai', 'anthropic', 'ollama', 'custom'] as const;
type ValidProvider = typeof VALID_PROVIDERS[number];

const VALID_API_SHAPES = ['chat-completions', 'responses'] as const;
type ValidApiShape = typeof VALID_API_SHAPES[number];

interface CreateLLMBody {
  name?: unknown;
  provider?: unknown;
  modelString?: unknown;
  baseUrl?: unknown;
  /** Legacy env-var name. At least one of apiKeyEnv or secretId must be set. */
  apiKeyEnv?: unknown;
  /** Vault secret id (Session 4 — preferred). Takes precedence at call time. */
  secretId?: unknown;
  /** Wire shape (migration 023). Defaults to 'chat-completions'. */
  apiShape?: unknown;
  isDefault?: unknown;
  description?: unknown;
}

interface UpdateLLMBody {
  name?: unknown;
  provider?: unknown;
  modelString?: unknown;
  baseUrl?: unknown;
  apiKeyEnv?: unknown;
  secretId?: unknown;
  apiShape?: unknown;
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
            secretId: created.secretId,
            apiShape: created.apiShape,
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

      // Vault secret wins when set; otherwise fall back to env var.
      // Same resolution path as `resolveLlmApiKey` in server.ts so
      // the test result reflects what an agent call would actually
      // see at run time.
      const apiKey = await resolveTestApiKey(existing);
      if (!apiKey) {
        const errorMsg = existing.secretId
          ? `Vault secret unset or decrypt failed; apiKeyEnv ${existing.apiKeyEnv ? `'${existing.apiKeyEnv}' is empty` : 'is not configured'}`
          : existing.apiKeyEnv
            ? `Environment variable '${existing.apiKeyEnv}' is empty — set it in the server .env`
            : 'No API key source configured (neither secretId nor apiKeyEnv)';
        return reply.send({
          data: { ok: false, latencyMs: 0, error: errorMsg },
        });
      }

      // Per-shape body (migration 023): reasoning-class models
      // ('responses' shape) reject `max_tokens` + ignore `temperature`.
      // Build the body to match what an agent call would actually send
      // for this row so the test result reflects reality.
      const shape = existing.apiShape ?? 'chat-completions';
      const testBody: Record<string, unknown> = {
        model: existing.modelString,
        messages: [{ role: 'user', content: 'hello' }],
      };
      if (shape === 'responses') {
        testBody.max_completion_tokens = 5;
      } else {
        testBody.max_tokens = 5;
      }

      const startedAt = Date.now();
      try {
        const res = await fetch(`${existing.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(testBody),
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

  // ─── Self-healing config (migration 020) ───────────────────────────

  // GET /platform/self-healing — list all failure-type configs
  app.get(
    '/platform/self-healing',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const records = await getRepositories().selfHealingConfig.list();
      return reply.send({ data: records });
    },
  );

  // PATCH /platform/self-healing/:failureType — update one row
  app.patch<{
    Params: { failureType: string };
    Body: {
      maxAttempts?: number;
      confidenceThreshold?: 'high' | 'medium' | 'low';
      autoResolveAlerts?: boolean;
      enabled?: boolean;
    };
  }>(
    '/platform/self-healing/:failureType',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const validation = validateSelfHealingUpdateBody(body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }

      const { selfHealingConfig, audit } = getRepositories();
      const existing = await selfHealingConfig.findByType(request.params.failureType);
      if (!existing) {
        return reply.code(404).send({
          error: `Self-healing config for failure type '${request.params.failureType}' not found`,
          code: 'NOT_FOUND',
        });
      }

      // Compute changed-fields BEFORE the update so the audit row
      // captures the delta.
      const changedFields: string[] = [];
      const previousValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const key of ['maxAttempts', 'confidenceThreshold', 'autoResolveAlerts', 'enabled'] as const) {
        const next = validation.fields[key];
        if (next !== undefined && next !== existing[key]) {
          changedFields.push(key);
          previousValues[key] = existing[key];
          newValues[key] = next;
        }
      }

      try {
        const updated = await selfHealingConfig.update(request.params.failureType, {
          ...validation.fields,
          updatedBy: request.user.id,
        });
        await audit.append({
          actor: request.user.id,
          action: 'self-healing.config-updated',
          entityType: 'platform_self_healing_config',
          entityId: updated.id,
          correlationId: request.correlationId,
          metadata: {
            failureType: updated.failureType,
            changedFields,
            previousValues,
            newValues,
            ip: request.ip,
          },
        });
        log.info(
          { failureType: updated.failureType, changedFields },
          'Self-healing config updated',
        );
        return reply.send({ data: updated });
      } catch (err) {
        log.error({ err }, 'Self-healing config update failed');
        return reply.code(500).send({
          error: 'Failed to update self-healing config',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}

/**
 * Validates a PATCH /platform/self-healing/:failureType body.
 * Pure function — returns { ok, fields } or { ok: false, code, error }.
 */
function validateSelfHealingUpdateBody(body: {
  maxAttempts?: unknown;
  confidenceThreshold?: unknown;
  autoResolveAlerts?: unknown;
  enabled?: unknown;
}): {
  ok: true;
  fields: {
    maxAttempts?: number;
    confidenceThreshold?: 'high' | 'medium' | 'low';
    autoResolveAlerts?: boolean;
    enabled?: boolean;
  };
} | { ok: false; code: string; error: string } {
  const fields: {
    maxAttempts?: number;
    confidenceThreshold?: 'high' | 'medium' | 'low';
    autoResolveAlerts?: boolean;
    enabled?: boolean;
  } = {};
  if (body.maxAttempts !== undefined) {
    if (typeof body.maxAttempts !== 'number' || !Number.isInteger(body.maxAttempts)) {
      return { ok: false, code: 'INVALID_MAX_ATTEMPTS', error: 'maxAttempts must be an integer' };
    }
    if (body.maxAttempts < 0 || body.maxAttempts > 10) {
      return { ok: false, code: 'INVALID_MAX_ATTEMPTS', error: 'maxAttempts must be between 0 and 10' };
    }
    fields.maxAttempts = body.maxAttempts;
  }
  if (body.confidenceThreshold !== undefined) {
    if (body.confidenceThreshold !== 'high' && body.confidenceThreshold !== 'medium' && body.confidenceThreshold !== 'low') {
      return {
        ok: false,
        code: 'INVALID_CONFIDENCE_THRESHOLD',
        error: 'confidenceThreshold must be one of: high, medium, low',
      };
    }
    fields.confidenceThreshold = body.confidenceThreshold;
  }
  if (body.autoResolveAlerts !== undefined) {
    if (typeof body.autoResolveAlerts !== 'boolean') {
      return { ok: false, code: 'INVALID_AUTO_RESOLVE_ALERTS', error: 'autoResolveAlerts must be a boolean' };
    }
    fields.autoResolveAlerts = body.autoResolveAlerts;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return { ok: false, code: 'INVALID_ENABLED', error: 'enabled must be a boolean' };
    }
    fields.enabled = body.enabled;
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, code: 'EMPTY_PATCH', error: 'At least one field must be supplied' };
  }
  return { ok: true, fields };
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
  apiKeyEnv: string | null;
  secretId: string | null;
  apiShape: ValidApiShape;
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
  // Either-or: apiKeyEnv OR secretId. Both are also acceptable
  // (secretId wins at call time); at least one must be supplied.
  const hasApiKeyEnv = typeof body.apiKeyEnv === 'string' && body.apiKeyEnv.trim() !== '';
  const hasSecretId = typeof body.secretId === 'string' && body.secretId.trim() !== '';
  if (!hasApiKeyEnv && !hasSecretId) {
    return { ok: false, code: 'INVALID_API_KEY_SOURCE', error: 'At least one of apiKeyEnv or secretId must be supplied (secretId is preferred)' };
  }
  if (body.apiKeyEnv !== undefined && body.apiKeyEnv !== null && typeof body.apiKeyEnv !== 'string') {
    return { ok: false, code: 'INVALID_API_KEY_ENV', error: 'apiKeyEnv must be a string or null' };
  }
  if (body.secretId !== undefined && body.secretId !== null && typeof body.secretId !== 'string') {
    return { ok: false, code: 'INVALID_SECRET_ID', error: 'secretId must be a string (UUID) or null' };
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
    return { ok: false, code: 'INVALID_IS_DEFAULT', error: 'isDefault must be a boolean' };
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return { ok: false, code: 'INVALID_DESCRIPTION', error: 'description must be a string or null' };
  }
  let apiShape: ValidApiShape = 'chat-completions';
  if (body.apiShape !== undefined && body.apiShape !== null) {
    if (typeof body.apiShape !== 'string' || !VALID_API_SHAPES.includes(body.apiShape as ValidApiShape)) {
      return { ok: false, code: 'INVALID_API_SHAPE', error: `apiShape must be one of: ${VALID_API_SHAPES.join(', ')}` };
    }
    apiShape = body.apiShape as ValidApiShape;
  }
  return {
    ok: true,
    fields: {
      name: body.name.trim(),
      provider: body.provider,
      modelString: body.modelString.trim(),
      baseUrl: body.baseUrl.trim().replace(/\/$/, ''),
      apiKeyEnv: hasApiKeyEnv ? (body.apiKeyEnv as string).trim() : null,
      secretId: hasSecretId ? (body.secretId as string).trim() : null,
      apiShape,
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
  apiKeyEnv: string | null;
  secretId: string | null;
  apiShape: ValidApiShape;
  isDefault: boolean;
  description: string | null;
}>> {
  const out: Partial<{
    name: string; provider: string; modelString: string;
    baseUrl: string; apiKeyEnv: string | null; secretId: string | null;
    apiShape: ValidApiShape;
    isDefault: boolean; description: string | null;
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
    if (body.apiKeyEnv === null) {
      out.apiKeyEnv = null;
    } else if (typeof body.apiKeyEnv !== 'string') {
      return { ok: false, code: 'INVALID_API_KEY_ENV', error: 'apiKeyEnv must be a string or null' };
    } else {
      const trimmed = body.apiKeyEnv.trim();
      out.apiKeyEnv = trimmed === '' ? null : trimmed;
    }
  }
  if (body.secretId !== undefined) {
    if (body.secretId === null) {
      out.secretId = null;
    } else if (typeof body.secretId !== 'string') {
      return { ok: false, code: 'INVALID_SECRET_ID', error: 'secretId must be a string or null' };
    } else {
      const trimmed = body.secretId.trim();
      out.secretId = trimmed === '' ? null : trimmed;
    }
  }
  if (body.apiShape !== undefined) {
    if (typeof body.apiShape !== 'string' || !VALID_API_SHAPES.includes(body.apiShape as ValidApiShape)) {
      return { ok: false, code: 'INVALID_API_SHAPE', error: `apiShape must be one of: ${VALID_API_SHAPES.join(', ')}` };
    }
    out.apiShape = body.apiShape as ValidApiShape;
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

/**
 * API key resolution for the `test` endpoint. Mirrors the
 * `resolveLlmApiKey` helper in server.ts (which feeds the live LLM
 * client). Vault wins when set; falls back to env var. Errors during
 * vault decrypt are caught and yield empty string so the test reports
 * an actionable error rather than 500ing.
 */
async function resolveTestApiKey(llm: PlatformLLMRecord): Promise<string> {
  if (llm.secretId) {
    const secret = await getRepositories().platformSecrets.findById(llm.secretId);
    if (secret) {
      try {
        return decryptSecret(
          { encrypted: secret.encrypted, iv: secret.iv, authTag: secret.authTag },
          getMasterKey(),
        );
      } catch {
        // Fall through to env var.
      }
    }
  }
  if (llm.apiKeyEnv) return process.env[llm.apiKeyEnv] ?? '';
  return '';
}
