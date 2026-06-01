/**
 * Project routes (ADR-032 — Git is the project filesystem).
 *
 *   POST /projects                — register a project (name + git URL + token)
 *   GET  /projects                — list projects owned by the requester
 *   GET  /projects/:id            — project detail (token never returned)
 *   POST /projects/:id/init-harness
 *                                 — clone the repo, write harness files,
 *                                   commit, push to defaultBranch
 *
 * Constraints (enforced here):
 *   - All routes authenticated; mutating routes require operator+
 *   - Git tokens are accepted on input, stored via the repository, and NEVER
 *     reflected in responses or logs
 *   - All Git operations go through simple-git; no child_process.exec
 *   - The temp clone directory is removed in a finally block on every path
 *   - Audit records (GP-002) are written for create + init-harness
 */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  type ProjectRecord,
} from '@gestalt/core';
import {
  requireRole, requireProjectMembership, sendProjectMembershipError,
  ProjectMembershipError,
} from '../auth/middleware';
import { loadTemplate, resolveTemplatesDir } from '../templates/engine';

/** ADR-036 — every project today gets the Tier 1 template. Future
 *  templates can be selected via a `templateId` field on the
 *  init-harness body once the registry can list them. */
const DEFAULT_TEMPLATE_ID = 'corporate-ops-web-mobile';

/** Templates dir resolved once at module load; reused for every
 *  init-harness request. Throws if the directory can't be located —
 *  the server fails to start under that condition rather than 500ing
 *  the first registration attempt. */
const TEMPLATES_DIR = resolveTemplatesDir();

const log = createContextLogger({ module: 'routes:projects' });

interface CreateProjectBody {
  name: string;
  gitUrl: string;
  defaultBranch?: string;
  gitToken: string;
}

interface InitHarnessBody {
  projectDescription: string;
}

interface UpdateConfigBody {
  pipeline?: {
    adapter?: string;
  };
}

const VALID_PIPELINE_ADAPTERS = ['noop', 'github-actions'] as const;
type ValidPipelineAdapter = typeof VALID_PIPELINE_ADAPTERS[number];

/**
 * Returns a public view of a project record — strips anything that should
 * not leave the server. Today the ProjectRecord type already omits the
 * token (it lives in a separate table), but this helper documents the
 * "never include credentials" contract and is the only place we shape the
 * outgoing payload.
 */
function toPublic(project: ProjectRecord): ProjectRecord {
  return {
    id: project.id,
    name: project.name,
    gitUrl: project.gitUrl,
    defaultBranch: project.defaultBranch,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
  };
}

/**
 * Embeds a Git personal access token into an HTTPS clone URL.
 * Supports the GitHub / GitLab / generic HTTPS convention
 * (`https://x-access-token:<token>@host/...`).
 * SSH URLs are passed through unchanged — auth in that case is the
 * container's SSH key, which is out of scope today.
 */
function authenticatedGitUrl(gitUrl: string, token: string): string {
  if (!gitUrl.startsWith('http://') && !gitUrl.startsWith('https://')) {
    return gitUrl;
  }
  const url = new URL(gitUrl);
  url.username = 'x-access-token';
  url.password = token;
  return url.toString();
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {

  // POST /projects — register a project
  app.post<{ Body: CreateProjectBody }>(
    '/projects',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Authentication required' });
      }
      const { name, gitUrl, defaultBranch, gitToken } = request.body ?? ({} as CreateProjectBody);

      if (!name?.trim() || !gitUrl?.trim() || !gitToken?.trim()) {
        return reply.code(400).send({
          error: 'name, gitUrl, and gitToken are required',
        });
      }

      const { projects, audit } = getRepositories();

      const existing = await projects.findByName(name.trim());
      if (existing) {
        return reply.code(409).send({
          error: `Project '${name}' already exists`,
          code: 'PROJECT_NAME_TAKEN',
        });
      }

      const project = await projects.create({
        name: name.trim(),
        gitUrl: gitUrl.trim(),
        defaultBranch: defaultBranch?.trim() || 'main',
        createdBy: request.user.id,
      });

      await projects.saveCredential(project.id, gitToken);

      // Auto-assign the creator as project-admin (migration 010 model).
      // Without this, a non-platform-admin user who registers a project
      // immediately loses access to it on the next `GET /projects` call.
      const { memberships } = getRepositories();
      await memberships.addMember({
        userId: request.user.id,
        projectId: project.id,
        role: 'project-admin',
        assignedBy: request.user.id,
      });

      await audit.append({
        actor: request.user.id,
        action: 'project.created',
        entityType: 'projects',
        entityId: project.id,
        correlationId: request.correlationId,
        metadata: {
          name: project.name,
          gitUrl: project.gitUrl,
          defaultBranch: project.defaultBranch,
          ip: request.ip,
        },
      });

      log.info({ projectId: project.id, name: project.name }, 'Project registered');
      return reply.code(201).send({ data: toPublic(project) });
    },
  );

  // GET /projects — list projects the caller can see.
  //
  // After migration 010 the rule is membership-based:
  //   - platform-admin → every registered project
  //   - user           → only projects they are a member of
  //
  // The previous "every authenticated user sees every project" rule
  // (which itself replaced an earlier owner-only filter) is now too
  // permissive: corporate operators expect to see only their own
  // workspace. platform-admin still sees everything for cross-cutting
  // administration.
  app.get(
    '/projects',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { projects, memberships } = getRepositories();

      if (request.user.role === 'platform-admin') {
        const rows = await projects.listAll();
        return reply.send({ data: rows.map(toPublic) });
      }

      const userMemberships = await memberships.findByUser(request.user.id);
      if (userMemberships.length === 0) return reply.send({ data: [] });

      const rows = await Promise.all(
        userMemberships.map((m) => projects.findById(m.projectId)),
      );
      const visible = rows.filter((r): r is ProjectRecord => r !== null);
      return reply.send({ data: visible.map(toPublic) });
    },
  );

  // GET /projects/:id — detail
  app.get<{ Params: { id: string } }>(
    '/projects/:id',
    async (request, reply) => {
      const { projects } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });
      return reply.send({ data: toPublic(project) });
    },
  );

  // POST /projects/:id/init-harness — clone, write harness, commit, push
  app.post<{ Params: { id: string }; Body: InitHarnessBody }>(
    '/projects/:id/init-harness',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });

      const { projectDescription } = request.body ?? ({} as InitHarnessBody);
      if (!projectDescription?.trim()) {
        return reply.code(400).send({ error: 'projectDescription is required' });
      }

      const { projects, audit } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const token = await projects.getCredential(project.id);
      if (!token) {
        return reply.code(400).send({
          error: 'Project has no Git credential on file; re-register the project',
          code: 'NO_CREDENTIAL',
        });
      }

      const workDir = await mkdtemp(join(tmpdir(), `gestalt-init-${crypto.randomUUID()}-`));

      try {
        const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
        const git: SimpleGit = simpleGit();

        log.info({ projectId: project.id, workDir }, 'Cloning project repo');
        await git.clone(cloneUrl, workDir);

        const repo: SimpleGit = simpleGit(workDir);
        // Ensure we are on the target branch (clone may have landed on a
        // different default).
        const branches = await repo.branch();
        if (branches.current !== project.defaultBranch) {
          try {
            await repo.checkout(project.defaultBranch);
          } catch {
            await repo.checkoutLocalBranch(project.defaultBranch);
          }
        }

        // ADR-036: harness content lives in `templates/<id>/`. The
        // engine walks the template, substitutes `{{variables}}`, and
        // returns the list of files-to-commit with their target
        // paths inside the project repo.
        const harnessFiles = await loadTemplate(TEMPLATES_DIR, DEFAULT_TEMPLATE_ID, {
          projectName: project.name,
          projectDescription: projectDescription.trim(),
          defaultBranch: project.defaultBranch,
        });

        for (const file of harnessFiles) {
          const fullPath = join(workDir, file.repoPath);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, file.content, 'utf8');
        }

        // Commit author identity — pinned so commits are clearly machine-made.
        await repo.addConfig('user.name', 'Gestalt Platform');
        await repo.addConfig('user.email', 'platform@gestalt.local');

        await repo.add('.');
        const commit = await repo.commit('chore: initialise project harness [gestalt]');
        await repo.push('origin', project.defaultBranch);

        log.info(
          { projectId: project.id, commitSha: commit.commit, branch: project.defaultBranch },
          'Harness committed and pushed',
        );

        await audit.append({
          actor: request.user.id,
          action: 'project.harness-initialised',
          entityType: 'projects',
          entityId: project.id,
          correlationId: request.correlationId,
          metadata: {
            name: project.name,
            commitSha: commit.commit,
            branch: project.defaultBranch,
            ip: request.ip,
          },
        });

        return reply.send({ data: { committed: true, commitSha: commit.commit } });
      } catch (err) {
        log.error({ err, projectId: project.id }, 'Harness init failed');
        return reply.code(500).send({
          error: 'Failed to initialise harness',
          // surface the underlying message so the operator can debug, but
          // never include the cloneUrl (it carries the token).
          details: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  );

  // POST /projects/:id/config — clone, edit HARNESS.json, commit, push
  //
  // The HARNESS.json file in the project repo is the source of truth for
  // adapter configuration (ADR-032 — Git is the project filesystem).
  // This route does not store any config in the DB; it only mutates the
  // committed HARNESS.json so the next deploy cycle's resolver picks it
  // up.
  //
  // Today only `pipeline.adapter` is settable; the body shape is generic
  // so other fields (monitoring, qualityGate) can be added without
  // changing the API surface.
  app.post<{ Params: { id: string }; Body: UpdateConfigBody }>(
    '/projects/:id/config',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });

      // Editing HARNESS.json shapes how the deploy chain runs for every
      // operator on this project. Editor isn't enough — must be a
      // project-admin (or platform-admin via the helper's bypass).
      try {
        await requireProjectMembership(
          request.user.id, request.user.role, request.params.id, 'project-admin',
        );
      } catch (err) {
        if (err instanceof ProjectMembershipError) return sendProjectMembershipError(reply, err);
        throw err;
      }

      const body = request.body ?? ({} as UpdateConfigBody);
      const requestedAdapter = body.pipeline?.adapter;
      if (!requestedAdapter) {
        return reply.code(400).send({
          error: 'No supported config field provided. Currently `pipeline.adapter` is the only field supported.',
        });
      }
      if (!VALID_PIPELINE_ADAPTERS.includes(requestedAdapter as ValidPipelineAdapter)) {
        return reply.code(400).send({
          error: `Unsupported pipeline adapter '${requestedAdapter}'. Valid values: ${VALID_PIPELINE_ADAPTERS.join(', ')}`,
          code: 'INVALID_PIPELINE_ADAPTER',
        });
      }
      const newAdapter = requestedAdapter as ValidPipelineAdapter;

      const { projects, audit } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const token = await projects.getCredential(project.id);
      if (!token) {
        return reply.code(400).send({
          error: 'Project has no Git credential on file; re-register the project',
          code: 'NO_CREDENTIAL',
        });
      }

      const workDir = await mkdtemp(join(tmpdir(), `gestalt-config-${crypto.randomUUID()}-`));
      try {
        const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
        await simpleGit().clone(cloneUrl, workDir);
        const repo: SimpleGit = simpleGit(workDir);

        try {
          await repo.checkout(project.defaultBranch);
        } catch {
          await repo.checkoutLocalBranch(project.defaultBranch);
        }

        const harnessPath = join(workDir, 'HARNESS.json');
        let parsed: Record<string, unknown>;
        try {
          const raw = await readFile(harnessPath, 'utf8');
          parsed = JSON.parse(raw) as Record<string, unknown>;
        } catch (err) {
          return reply.code(409).send({
            error: 'HARNESS.json missing or invalid in repo — run `gestalt init` first',
            details: err instanceof Error ? err.message : String(err),
          });
        }

        const currentPipeline = (parsed['pipeline'] as Record<string, unknown> | undefined) ?? {};
        const previousAdapter = currentPipeline['adapter'];
        if (previousAdapter === newAdapter) {
          return reply.send({
            data: { updated: false, reason: 'no-change', adapter: newAdapter },
          });
        }
        parsed['pipeline'] = { ...currentPipeline, adapter: newAdapter };

        await writeFile(harnessPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');

        await repo.addConfig('user.name', 'Gestalt Platform');
        await repo.addConfig('user.email', 'platform@gestalt.local');
        await repo.add('HARNESS.json');

        const status = await repo.status();
        if (status.files.length === 0) {
          // File-on-disk identical to working tree even after the
          // mutation — defensive guard, should be unreachable.
          return reply.send({
            data: { updated: false, reason: 'no-diff', adapter: newAdapter },
          });
        }

        const commit = await repo.commit(`chore: update pipeline adapter to ${newAdapter} [gestalt]`);
        await repo.push('origin', project.defaultBranch);

        await audit.append({
          actor: request.user.id,
          action: 'project.config-updated',
          entityType: 'projects',
          entityId: project.id,
          correlationId: request.correlationId,
          metadata: {
            field: 'pipeline.adapter',
            previousValue: previousAdapter ?? null,
            newValue: newAdapter,
            commitSha: commit.commit,
            ip: request.ip,
          },
        });

        log.info(
          { projectId: project.id, adapter: newAdapter, commitSha: commit.commit },
          'Project config updated',
        );

        return reply.send({
          data: { updated: true, adapter: newAdapter, commitSha: commit.commit },
        });
      } catch (err) {
        log.error({ err, projectId: project.id }, 'Project config update failed');
        return reply.code(500).send({
          error: 'Failed to update project config',
          details: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  );
}
