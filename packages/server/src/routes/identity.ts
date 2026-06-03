/**
 * Platform identity routes (Session 3 — migration 017).
 *
 *   GET    /platform/identity                          — platform-admin
 *   PATCH  /platform/identity/:provider                — platform-admin
 *   POST   /platform/identity/reload                   — platform-admin
 *   POST   /platform/identity/role-mappings            — platform-admin
 *   DELETE /platform/identity/role-mappings/:id        — platform-admin
 *
 * Sensitive fields (cert / clientSecret / keytabContent) live as
 * `*SecretId` references inside the persisted `config` JSONB.
 * `loadIdentityConfig` resolves them via the vault at AuthManager
 * construction; this route never returns the plaintext values.
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  type IdentityProvider,
} from '@gestalt/core';
import { requireRole } from '../auth/middleware';
import { reinitAuth, type AuthManager } from '../auth/auth-manager';
import { loadIdentityConfig } from '../auth/config-loader';

const log = createContextLogger({ module: 'routes:identity' });

const VALID_PROVIDERS = new Set<IdentityProvider>(['kerberos', 'saml', 'oidc']);
const VALID_ROLES = new Set(['platform-admin', 'user']);

// Field names that must never carry plaintext on the wire — the
// route strips them from PATCH bodies before persisting and replaces
// them with the `*SecretId` form.
const SENSITIVE_FIELDS = new Set(['cert', 'clientSecret', 'clientSecretValue', 'keytabContent']);

interface PatchBody {
  enabled?: unknown;
  config?: unknown;
}

interface RoleMappingBody {
  groupName?: unknown;
  platformRole?: unknown;
}

export async function registerIdentityRoutes(
  app: FastifyInstance,
  authManager: AuthManager,
): Promise<void> {

  // GET /platform/identity — list providers + role mappings
  app.get(
    '/platform/identity',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { identityConfig, roleMappings } = getRepositories();
      const providers = await identityConfig.list();
      const mappings = await roleMappings.list();
      // Strip sensitive plaintext on the way out — defensively, even
      // though the persistence layer should never have it inline.
      const sanitised = providers.map((p) => ({
        ...p,
        config: sanitiseConfig(p.config),
      }));
      return reply.send({
        data: {
          providers: sanitised,
          roleMappings: mappings,
          activeProviders: authManager.getActiveProviderTypes(),
        },
      });
    },
  );

  // PATCH /platform/identity/:provider — upsert one provider's config
  app.patch<{ Params: { provider: string }; Body: PatchBody }>(
    '/platform/identity/:provider',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const provider = request.params.provider;
      if (!VALID_PROVIDERS.has(provider as IdentityProvider)) {
        return reply.code(400).send({
          error: `Invalid provider '${provider}'. Must be one of: ${[...VALID_PROVIDERS].join(', ')}`,
          code: 'INVALID_PROVIDER',
        });
      }
      const body = request.body ?? {};
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
        return reply.code(400).send({ error: 'enabled must be a boolean', code: 'INVALID_ENABLED' });
      }
      if (body.config !== undefined && (typeof body.config !== 'object' || body.config === null)) {
        return reply.code(400).send({ error: 'config must be an object', code: 'INVALID_CONFIG' });
      }

      const { identityConfig, audit } = getRepositories();
      const existing = await identityConfig.findByProvider(provider as IdentityProvider);
      const mergedConfig = {
        ...(existing?.config ?? {}),
        ...((body.config as Record<string, unknown>) ?? {}),
      };

      // Strip any sensitive plaintext that snuck through — the
      // operator must use the *SecretId form. We don't silently
      // overwrite; we return a clear validation error.
      for (const k of Object.keys(mergedConfig)) {
        if (SENSITIVE_FIELDS.has(k)) {
          return reply.code(400).send({
            error: `Sensitive field '${k}' must be supplied as '${k}SecretId' (vault reference), never inline`,
            code: 'SENSITIVE_FIELD_INLINE',
          });
        }
      }

      const enabled = body.enabled !== undefined ? body.enabled as boolean : (existing?.enabled ?? false);
      const upserted = await identityConfig.upsert({
        provider: provider as IdentityProvider,
        enabled,
        config: mergedConfig,
        updatedBy: request.user.id,
      });

      await audit.append({
        actor: request.user.id,
        action: 'platform.identity-updated',
        entityType: 'platform_identity_config',
        entityId: upserted.id,
        correlationId: request.correlationId,
        metadata: {
          provider: upserted.provider,
          enabled: upserted.enabled,
          changedFields: Object.keys((body.config as Record<string, unknown>) ?? {}),
          ip: request.ip,
        },
      });

      log.info({ provider, enabled }, 'Platform identity config updated');
      return reply.send({ data: { ...upserted, config: sanitiseConfig(upserted.config) } });
    },
  );

  // POST /platform/identity/reload — hot-reload providers
  app.post(
    '/platform/identity/reload',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      try {
        const activeProviders = await reinitAuth(authManager, loadIdentityConfig);
        log.info({ activeProviders }, 'Auth providers reloaded');
        return reply.send({ data: { providers: activeProviders } });
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'Auth reload failed');
        return reply.code(500).send({
          error: 'Failed to reload auth providers',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // POST /platform/identity/role-mappings — add a group → role mapping
  app.post<{ Body: RoleMappingBody }>(
    '/platform/identity/role-mappings',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      if (typeof body.groupName !== 'string' || !body.groupName.trim()) {
        return reply.code(400).send({ error: 'groupName is required', code: 'INVALID_GROUP_NAME' });
      }
      if (typeof body.platformRole !== 'string' || !VALID_ROLES.has(body.platformRole)) {
        return reply.code(400).send({
          error: `platformRole must be one of: ${[...VALID_ROLES].join(', ')}`,
          code: 'INVALID_PLATFORM_ROLE',
        });
      }

      const { roleMappings, audit } = getRepositories();
      try {
        const created = await roleMappings.add({
          groupName: body.groupName.trim(),
          platformRole: body.platformRole as 'platform-admin' | 'user',
          createdBy: request.user.id,
        });
        await audit.append({
          actor: request.user.id,
          action: 'platform.role-mapping-added',
          entityType: 'platform_role_mappings',
          entityId: created.id,
          correlationId: request.correlationId,
          metadata: {
            groupName: created.groupName,
            platformRole: created.platformRole,
            ip: request.ip,
          },
        });
        log.info({ groupName: created.groupName, platformRole: created.platformRole }, 'Role mapping created');
        return reply.code(201).send({ data: created });
      } catch (err) {
        if (err instanceof Error && err.message.toLowerCase().includes('duplicate')) {
          return reply.code(409).send({
            error: `Mapping for group '${body.groupName}' already exists`,
            code: 'GROUP_TAKEN',
          });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/platform/identity/role-mappings/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { roleMappings, audit } = getRepositories();
      await roleMappings.remove(request.params.id);
      await audit.append({
        actor: request.user.id,
        action: 'platform.role-mapping-deleted',
        entityType: 'platform_role_mappings',
        entityId: request.params.id,
        correlationId: request.correlationId,
        metadata: { ip: request.ip },
      });
      return reply.code(204).send();
    },
  );
}

/**
 * Defensive scrub — if any sensitive plaintext somehow landed in
 * the persisted config, redact it before responding. The persistence
 * layer + the PATCH validator should both prevent this from
 * happening, but defense-in-depth means it never escapes.
 */
function sanitiseConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (SENSITIVE_FIELDS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

