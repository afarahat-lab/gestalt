/**
 * Platform secrets routes — encrypted credential vault (migration 015).
 *
 *   GET    /platform/secrets         — platform-admin only
 *   POST   /platform/secrets         — platform-admin only
 *   PATCH  /platform/secrets/:id     — platform-admin only
 *   DELETE /platform/secrets/:id     — platform-admin only
 *
 * Critical invariants:
 *   - Secret VALUES are NEVER returned by any route — not even to
 *     platform-admin. The list/detail responses use
 *     `PlatformSecretSummary` (no encrypted columns)
 *   - The ciphertext is encrypted under the server's master key
 *     (loaded once at boot — `getMasterKey()`). A fresh 96-bit IV
 *     is generated per encryption
 *   - Audit metadata records ONLY non-sensitive identifiers (name,
 *     description length, references count) — never the encrypted
 *     payload, IV, auth tag, or anything derived from them
 *   - DELETE refuses if any `platform_llms.secret_id` references the
 *     row (SECRET_IN_USE → 400 with the list of LLM names)
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  encryptSecret, type PlatformSecretRecord, type PlatformSecretSummary,
} from '@gestalt/core';
import { SecretInUseError } from '@gestalt/adapter-postgres';
import { requireRole } from '../auth/middleware';
import { getMasterKey } from '../secrets/index';

const log = createContextLogger({ module: 'routes:secrets' });

interface CreateBody {
  name?: unknown;
  value?: unknown;
  description?: unknown;
}

interface UpdateBody {
  name?: unknown;
  value?: unknown;
  description?: unknown;
}

export async function registerSecretsRoutes(app: FastifyInstance): Promise<void> {

  // GET /platform/secrets — public-safe summaries only
  app.get(
    '/platform/secrets',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const records = await getRepositories().platformSecrets.list();
      return reply.send({ data: records });
    },
  );

  // POST /platform/secrets — encrypt + store
  app.post<{ Body: CreateBody }>(
    '/platform/secrets',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const validation = validateCreate(body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }

      const { platformSecrets, audit } = getRepositories();
      const existing = await platformSecrets.findByName(validation.fields.name);
      if (existing) {
        return reply.code(409).send({
          error: `Secret with name '${validation.fields.name}' already exists`,
          code: 'NAME_TAKEN',
        });
      }

      const encrypted = encryptSecret(validation.fields.value, getMasterKey());
      try {
        const created = await platformSecrets.create({
          name: validation.fields.name,
          description: validation.fields.description ?? null,
          encrypted: encrypted.encrypted,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          createdBy: request.user.id,
        });
        // GP-006 — audit metadata carries name + description length
        // ONLY. Never the value, never the ciphertext.
        await audit.append({
          actor: request.user.id,
          action: 'secret.created',
          entityType: 'platform_secrets',
          entityId: created.id,
          correlationId: request.correlationId,
          metadata: {
            name: created.name,
            descriptionLength: (validation.fields.description ?? '').length,
            ip: request.ip,
          },
        });
        log.info({ id: created.id, name: created.name }, 'Platform secret created');
        return reply.code(201).send({ data: toPublic(created) });
      } catch (err) {
        log.error({ err, name: validation.fields.name }, 'Platform secret create failed');
        return reply.code(500).send({
          error: 'Failed to create secret',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // PATCH /platform/secrets/:id — rename / rotate / update description
  app.patch<{ Params: { id: string }; Body: UpdateBody }>(
    '/platform/secrets/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const validation = validateUpdate(body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }
      if (
        validation.fields.name === undefined
        && validation.fields.value === undefined
        && validation.fields.description === undefined
      ) {
        return reply.code(400).send({ error: 'No fields to update', code: 'EMPTY_PATCH' });
      }

      const { platformSecrets, audit } = getRepositories();
      const existing = await platformSecrets.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Secret not found' });

      // Rename collision → 409
      if (validation.fields.name && validation.fields.name !== existing.name) {
        const clash = await platformSecrets.findByName(validation.fields.name);
        if (clash) {
          return reply.code(409).send({
            error: `Secret with name '${validation.fields.name}' already exists`,
            code: 'NAME_TAKEN',
          });
        }
      }

      const changedFields: string[] = [];
      const updateArgs: Parameters<typeof platformSecrets.update>[1] = {};
      if (validation.fields.name !== undefined) {
        updateArgs.name = validation.fields.name;
        changedFields.push('name');
      }
      if (validation.fields.description !== undefined) {
        updateArgs.description = validation.fields.description;
        changedFields.push('description');
      }
      if (validation.fields.value !== undefined) {
        // Rotation — fresh IV, fresh ciphertext, fresh auth tag.
        const enc = encryptSecret(validation.fields.value, getMasterKey());
        updateArgs.encrypted = enc.encrypted;
        updateArgs.iv = enc.iv;
        updateArgs.authTag = enc.authTag;
        changedFields.push('value');
      }

      try {
        const updated = await platformSecrets.update(request.params.id, updateArgs);
        await audit.append({
          actor: request.user.id,
          action: 'secret.updated',
          entityType: 'platform_secrets',
          entityId: updated.id,
          correlationId: request.correlationId,
          metadata: {
            name: updated.name,
            changedFields,
            ip: request.ip,
          },
        });
        log.info({ id: updated.id, changedFields }, 'Platform secret updated');
        return reply.send({ data: toPublic(updated) });
      } catch (err) {
        log.error({ err, id: request.params.id }, 'Platform secret update failed');
        return reply.code(500).send({
          error: 'Failed to update secret',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // DELETE /platform/secrets/:id — SECRET_IN_USE guard inside the
  // repository's `delete`.
  app.delete<{ Params: { id: string } }>(
    '/platform/secrets/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformSecrets, audit } = getRepositories();
      const existing = await platformSecrets.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Secret not found' });

      try {
        await platformSecrets.delete(request.params.id);
        await audit.append({
          actor: request.user.id,
          action: 'secret.deleted',
          entityType: 'platform_secrets',
          entityId: existing.id,
          correlationId: request.correlationId,
          metadata: {
            name: existing.name,
            ip: request.ip,
          },
        });
        log.info({ id: existing.id, name: existing.name }, 'Platform secret deleted');
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof SecretInUseError) {
          return reply.code(400).send({
            error: `Secret is in use by ${err.llmNames.length} LLM(s): ${err.llmNames.join(', ')}`,
            code: 'SECRET_IN_USE',
            llmNames: err.llmNames,
          });
        }
        log.error({ err, id: request.params.id }, 'Platform secret delete failed');
        return reply.code(500).send({
          error: 'Failed to delete secret',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip the encrypted columns before sending a `PlatformSecretRecord`
 * to a client. Defensive — the public list endpoint already uses the
 * narrow projection, but POST/PATCH handlers return the freshly-saved
 * row and need to scrub it.
 */
function toPublic(r: PlatformSecretRecord): PlatformSecretSummary {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

type ValidationResult<T> = { ok: true; fields: T } | { ok: false; error: string; code: string };

function validateCreate(body: CreateBody): ValidationResult<{
  name: string;
  value: string;
  description: string | null;
}> {
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return { ok: false, code: 'INVALID_NAME', error: 'name is required (non-empty string)' };
  }
  if (typeof body.value !== 'string' || !body.value) {
    return { ok: false, code: 'INVALID_VALUE', error: 'value is required (non-empty string)' };
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return { ok: false, code: 'INVALID_DESCRIPTION', error: 'description must be a string or null' };
  }
  return {
    ok: true,
    fields: {
      name: body.name.trim(),
      value: body.value,
      description: typeof body.description === 'string' ? body.description : null,
    },
  };
}

function validateUpdate(body: UpdateBody): ValidationResult<Partial<{
  name: string;
  value: string;
  description: string | null;
}>> {
  const out: Partial<{ name: string; value: string; description: string | null }> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return { ok: false, code: 'INVALID_NAME', error: 'name must be a non-empty string' };
    }
    out.name = body.name.trim();
  }
  if (body.value !== undefined) {
    if (typeof body.value !== 'string' || !body.value) {
      return { ok: false, code: 'INVALID_VALUE', error: 'value must be a non-empty string' };
    }
    out.value = body.value;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return { ok: false, code: 'INVALID_DESCRIPTION', error: 'description must be a string or null' };
    }
    out.description = body.description as string | null;
  }
  return { ok: true, fields: out };
}
