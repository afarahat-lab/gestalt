/**
 * Platform templates routes (Session 3 — migration 017).
 *
 *   GET    /platform/templates           — any authenticated user
 *   GET    /platform/templates/:id       — any authenticated user
 *   POST   /platform/templates           — platform-admin only
 *   POST   /platform/templates/:id/set-default — platform-admin only
 *   DELETE /platform/templates/:id       — platform-admin only
 *
 * The list endpoint is open to every authenticated user because the
 * dashboard's project-creation flow needs to populate a template
 * picker even for project-admins (who may not be platform-admins).
 * The summary projection omits the `files` column so we don't ship
 * multi-KB content on the wire when only the chooser needs slug +
 * name + version.
 *
 * Built-in templates (`isBuiltin: true`) are read-only — they can't
 * be updated or deleted via the API. The default flag is the one
 * thing operators flip on a built-in.
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  type PlatformTemplateRecord, type PlatformTemplateSummary,
  type TemplateVariable,
} from '@gestalt/core';
import { requireRole } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:templates' });

const REQUIRED_FILES = ['AGENTS.md', 'HARNESS.json', 'agents.yaml'];

interface CreateBody {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  tier?: unknown;
  version?: unknown;
  files?: unknown;
  variables?: unknown;
  isDefault?: unknown;
}

export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {

  // GET /platform/templates — list summary (no files content)
  app.get('/platform/templates', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
    const records = await getRepositories().platformTemplates.list();
    return reply.send({ data: records });
  });

  // GET /platform/templates/:id — full record (includes files content)
  app.get<{ Params: { id: string } }>(
    '/platform/templates/:id',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const record = await getRepositories().platformTemplates.findById(request.params.id);
      if (!record) return reply.code(404).send({ error: 'Template not found' });
      return reply.send({ data: record });
    },
  );

  // POST /platform/templates — upload custom template
  app.post<{ Body: CreateBody }>(
    '/platform/templates',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const body = request.body ?? {};
      const validation = validateCreate(body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code, ...(validation.fields ?? {}) });
      }

      const { platformTemplates, audit } = getRepositories();
      const clash = await platformTemplates.findBySlug(validation.fields.slug);
      if (clash) {
        return reply.code(409).send({
          error: `Template with slug '${validation.fields.slug}' already exists`,
          code: 'SLUG_TAKEN',
        });
      }

      const created = await platformTemplates.create({
        slug:        validation.fields.slug,
        name:        validation.fields.name,
        description: validation.fields.description,
        tier:        validation.fields.tier,
        version:     validation.fields.version,
        isDefault:   validation.fields.isDefault,
        isBuiltin:   false, // only the boot-seed creates built-ins
        files:       validation.fields.files,
        variables:   validation.fields.variables,
        createdBy:   request.user.id,
      });

      await audit.append({
        actor: request.user.id,
        action: 'platform.template-added',
        entityType: 'platform_templates',
        entityId: created.id,
        correlationId: request.correlationId,
        metadata: {
          slug: created.slug,
          name: created.name,
          tier: created.tier,
          version: created.version,
          fileCount: Object.keys(created.files).length,
          isDefault: created.isDefault,
          ip: request.ip,
        },
      });

      log.info({ slug: created.slug, fileCount: Object.keys(created.files).length }, 'Platform template created');
      return reply.code(201).send({ data: toSummary(created) });
    },
  );

  // POST /platform/templates/:id/set-default — flip the default
  app.post<{ Params: { id: string } }>(
    '/platform/templates/:id/set-default',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformTemplates, audit } = getRepositories();
      const existing = await platformTemplates.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Template not found' });

      await platformTemplates.setDefault(existing.id);
      const updated = await platformTemplates.findById(existing.id);
      if (!updated) return reply.code(500).send({ error: 'Template vanished after setDefault' });

      await audit.append({
        actor: request.user.id,
        action: 'platform.template-set-default',
        entityType: 'platform_templates',
        entityId: existing.id,
        correlationId: request.correlationId,
        metadata: { slug: existing.slug, ip: request.ip },
      });

      log.info({ slug: existing.slug }, 'Platform template default set');
      return reply.send({ data: toSummary(updated) });
    },
  );

  // DELETE /platform/templates/:id — custom templates only
  app.delete<{ Params: { id: string } }>(
    '/platform/templates/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { platformTemplates, audit } = getRepositories();
      const existing = await platformTemplates.findById(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'Template not found' });

      if (existing.isBuiltin) {
        return reply.code(400).send({
          error: 'Cannot delete a built-in template',
          code: 'BUILTIN_TEMPLATE',
        });
      }
      if (existing.isDefault) {
        return reply.code(400).send({
          error: 'Cannot delete the default template — set another template as default first',
          code: 'CANNOT_DELETE_DEFAULT',
        });
      }

      await platformTemplates.delete(existing.id);

      await audit.append({
        actor: request.user.id,
        action: 'platform.template-deleted',
        entityType: 'platform_templates',
        entityId: existing.id,
        correlationId: request.correlationId,
        metadata: { slug: existing.slug, name: existing.name, ip: request.ip },
      });

      log.info({ slug: existing.slug }, 'Platform template deleted');
      return reply.code(204).send();
    },
  );
}

function toSummary(t: PlatformTemplateRecord): PlatformTemplateSummary {
  return {
    id: t.id, slug: t.slug, name: t.name, description: t.description,
    tier: t.tier, version: t.version,
    isDefault: t.isDefault, isBuiltin: t.isBuiltin,
    variables: t.variables,
    createdBy: t.createdBy, createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

type ValidationResult =
  | { ok: true; fields: {
        slug: string; name: string; description: string | null;
        tier: string; version: string; isDefault: boolean;
        files: Record<string, string>; variables: TemplateVariable[];
      };
    }
  | { ok: false; error: string; code: string; fields?: Record<string, unknown> };

function validateCreate(body: CreateBody): ValidationResult {
  if (typeof body.slug !== 'string' || !body.slug.trim()) {
    return { ok: false, code: 'INVALID_SLUG', error: 'slug is required (non-empty string)' };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(body.slug.trim())) {
    return { ok: false, code: 'INVALID_SLUG', error: 'slug must be kebab-case (letters/digits/hyphens; no leading or trailing hyphen)' };
  }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return { ok: false, code: 'INVALID_NAME', error: 'name is required (non-empty string)' };
  }
  if (body.files === undefined || typeof body.files !== 'object' || body.files === null || Array.isArray(body.files)) {
    return { ok: false, code: 'INVALID_FILES', error: 'files is required (object: { templatePath: content })' };
  }
  const filesMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.files as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      return { ok: false, code: 'INVALID_FILES', error: `files['${k}']: content must be a string` };
    }
    filesMap[k] = v;
  }

  // REQUIRED_FILES are checked against the path's LAST segment — the
  // dashboard uploads ZIPs that may include a parent directory like
  // `my-template/AGENTS.md`. The engine's repo-path mapper strips
  // those prefixes, but the validation needs to look at the basename
  // so an operator who uploaded `my-template/AGENTS.md` doesn't get
  // told AGENTS.md is missing.
  const basenames = new Set(Object.keys(filesMap).map((p) => p.split('/').pop() ?? p));
  const missing = REQUIRED_FILES.filter((f) => !basenames.has(f));
  if (missing.length > 0) {
    return {
      ok: false, code: 'MISSING_REQUIRED_FILES',
      error: `Template is missing required files: ${missing.join(', ')}`,
      fields: { missingFiles: missing },
    };
  }

  let variables: TemplateVariable[] = [];
  if (body.variables !== undefined) {
    if (!Array.isArray(body.variables)) {
      return { ok: false, code: 'INVALID_VARIABLES', error: 'variables must be an array' };
    }
    variables = body.variables as TemplateVariable[];
  }

  return {
    ok: true,
    fields: {
      slug: body.slug.trim(),
      name: body.name.trim(),
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
      tier: typeof body.tier === 'string' && body.tier.trim() ? body.tier.trim() : 'custom',
      version: typeof body.version === 'string' && body.version.trim() ? body.version.trim() : '0.1.0',
      isDefault: body.isDefault === true,
      files: filesMap,
      variables,
    },
  };
}
