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

import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  resolveProjectCredential, encryptSecret,
  type ProjectRecord,
} from '@gestalt/core';
import { requireRole, checkProjectMembership } from '../auth/middleware';
import { getMasterKey } from '../secrets/index';
import { loadTemplate, resolveTemplatesDir } from '../templates/engine';
import { generateStackConfig } from '../templates/stack-config';
import { applyPipelinePatch } from './project-config';
import { emitLiveEvent } from '../events';

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

/**
 * POST /projects body. Exactly ONE of the three credential modes must
 * be supplied (validated at handler level):
 *   - `gitToken` — legacy plain-text PAT, stored in
 *     `project_git_credentials`. Backward compat path.
 *   - `gitSecretId` — vault secret already registered via
 *     `POST /platform/secrets`. The project row links to it.
 *   - `newSecret` — auto-save the supplied token to the vault under
 *     the given name, then link the project to it. The plain-token
 *     table is NOT populated in this path.
 */
interface CreateProjectBody {
  name: string;
  gitUrl: string;
  defaultBranch?: string;
  gitToken?: string;
  gitSecretId?: string;
  newSecret?: {
    name: string;
    value: string;
  };
}

interface UpdateGitCredentialsBody {
  gitToken?: string;
  gitSecretId?: string;
  newSecret?: {
    name: string;
    value: string;
  };
}

interface InitHarnessBody {
  projectDescription: string;
}

interface UpdateConfigBody {
  pipeline?: {
    adapter?: string;
    autoMerge?: boolean;
    mergeMethod?: string;
  };
}

const VALID_PIPELINE_ADAPTERS = ['noop', 'github-actions'] as const;
type ValidPipelineAdapter = typeof VALID_PIPELINE_ADAPTERS[number];

const VALID_MERGE_METHODS = ['squash', 'merge', 'rebase'] as const;
type ValidMergeMethod = typeof VALID_MERGE_METHODS[number];

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
    // `gitSecretId` is a UUID reference, not the secret value — safe
    // to expose so the dashboard can render the credential mode
    // ("vault: <name>" vs "plain token stored") in the Pipeline tab.
    gitSecretId: project.gitSecretId ?? null,
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

/**
 * Persist a project Git PAT into the platform vault. Returns the new
 * secret's id (for `saveGitSecretRef`). Throws on duplicate name —
 * the caller catches and surfaces 409 NAME_TAKEN. Audit row is
 * written here (GP-006-compliant: metadata carries length only).
 */
async function createVaultSecret(params: {
  name: string;
  value: string;
  createdBy: string;
  correlationId: string;
  ip: string;
}): Promise<string> {
  const { platformSecrets, audit } = getRepositories();
  const trimmed = params.name.trim();
  if (!trimmed) throw new Error('Secret name is required');
  if (!params.value) throw new Error('Secret value is required');
  const existing = await platformSecrets.findByName(trimmed);
  if (existing) {
    const err = new Error(`Secret with name '${trimmed}' already exists`) as Error & { code?: string };
    err.code = 'NAME_TAKEN';
    throw err;
  }
  const enc = encryptSecret(params.value, getMasterKey());
  const created = await platformSecrets.create({
    name: trimmed,
    description: `Git PAT auto-saved during project setup`,
    encrypted: enc.encrypted,
    iv: enc.iv,
    authTag: enc.authTag,
    createdBy: params.createdBy,
  });
  await audit.append({
    actor: params.createdBy,
    action: 'secret.created',
    entityType: 'platform_secrets',
    entityId: created.id,
    correlationId: params.correlationId,
    metadata: {
      name: created.name,
      descriptionLength: (created.description ?? '').length,
      origin: 'project-init',
      ip: params.ip,
    },
  });
  return created.id;
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
      const body = request.body ?? ({} as CreateProjectBody);
      const { name, gitUrl, defaultBranch, gitToken, gitSecretId, newSecret } = body;

      if (!name?.trim() || !gitUrl?.trim()) {
        return reply.code(400).send({
          error: 'name and gitUrl are required',
        });
      }

      // Exactly one credential mode must be supplied. The check is
      // mutually-exclusive — providing more than one means the
      // operator ambiguous about which credential should win.
      const modesProvided = [
        gitToken?.trim() ? 'gitToken' : null,
        gitSecretId?.trim() ? 'gitSecretId' : null,
        newSecret?.value?.trim() ? 'newSecret' : null,
      ].filter(Boolean);
      if (modesProvided.length === 0) {
        return reply.code(400).send({
          error: 'One of gitToken, gitSecretId, or newSecret is required',
          code: 'CREDENTIAL_REQUIRED',
        });
      }
      if (modesProvided.length > 1) {
        return reply.code(400).send({
          error: `Provide only one credential mode (received: ${modesProvided.join(', ')})`,
          code: 'CREDENTIAL_AMBIGUOUS',
        });
      }
      // newSecret-mode validation: name + value both required
      if (newSecret && (!newSecret.name?.trim() || !newSecret.value?.trim())) {
        return reply.code(400).send({
          error: 'newSecret requires both name and value',
          code: 'NEW_SECRET_INVALID',
        });
      }

      const { projects, audit, platformSecrets } = getRepositories();

      const existing = await projects.findByName(name.trim());
      if (existing) {
        return reply.code(409).send({
          error: `Project '${name}' already exists`,
          code: 'PROJECT_NAME_TAKEN',
        });
      }

      // For gitSecretId: validate the secret actually exists BEFORE
      // creating the project (no half-state on a bad UUID).
      if (gitSecretId) {
        const secret = await platformSecrets.findById(gitSecretId);
        if (!secret) {
          return reply.code(400).send({
            error: `Vault secret '${gitSecretId}' not found`,
            code: 'SECRET_NOT_FOUND',
          });
        }
      }

      const project = await projects.create({
        name: name.trim(),
        gitUrl: gitUrl.trim(),
        defaultBranch: defaultBranch?.trim() || 'main',
        createdBy: request.user.id,
      });

      let credentialType: 'plain' | 'vault-existing' | 'vault-new' = 'plain';
      let linkedSecretId: string | null = null;
      try {
        if (newSecret) {
          linkedSecretId = await createVaultSecret({
            name: newSecret.name,
            value: newSecret.value,
            createdBy: request.user.id,
            correlationId: request.correlationId,
            ip: request.ip,
          });
          await projects.saveGitSecretRef(project.id, linkedSecretId);
          credentialType = 'vault-new';
        } else if (gitSecretId) {
          await projects.saveGitSecretRef(project.id, gitSecretId);
          linkedSecretId = gitSecretId;
          credentialType = 'vault-existing';
        } else if (gitToken) {
          await projects.saveCredential(project.id, gitToken);
          credentialType = 'plain';
        }
      } catch (err) {
        // Cleanup: roll back the project row so the operator can retry
        // with a different secret name.
        await projects.delete(project.id).catch(() => undefined);
        const errCode = err instanceof Error && 'code' in err && (err as { code?: string }).code === 'NAME_TAKEN'
          ? 'NAME_TAKEN' : undefined;
        return reply.code(errCode ? 409 : 500).send({
          error: err instanceof Error ? err.message : String(err),
          code: errCode ?? 'CREDENTIAL_SAVE_FAILED',
        });
      }

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
          credentialType,
          // gitSecretId is a reference UUID — safe to log per GP-006.
          gitSecretId: linkedSecretId,
          ip: request.ip,
        },
      });

      // Re-load to pick up gitSecretId set above.
      const refreshed = await projects.findById(project.id);
      const finalProject = refreshed ?? project;
      log.info({ projectId: finalProject.id, name: finalProject.name, credentialType }, 'Project registered');
      return reply.code(201).send({ data: toPublic(finalProject) });
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
      const { projects, memberships, intents } = getRepositories();

      if (request.user.role === 'platform-admin') {
        // Platform-admin sees every project AND gets per-row enrichment
        // for the management surface: member count, intent count, and
        // the timestamp of the most recent intent. The dashboard's
        // Admin → Projects tab consumes these fields directly; regular
        // users never see them (their listing is per-membership and
        // doesn't need the cross-project stats).
        const rows = await projects.listAll();
        const enriched = await Promise.all(
          rows.map(async (p) => {
            const [memberCount, intentCount, lastIntent] = await Promise.all([
              memberships.countByProject(p.id),
              intents.countByProject(p.id),
              intents.findLatestByProject(p.id),
            ]);
            return {
              ...toPublic(p),
              memberCount,
              intentCount,
              lastActivityAt: (lastIntent?.createdAt ?? p.createdAt).toISOString(),
            };
          }),
        );
        return reply.send({ data: enriched });
      }

      // Brief 1 — Bulk user management. A regular user's visible
      // project list is the UNION of their direct memberships AND any
      // projects they reach via a platform group. The two lookups run
      // in parallel and then we dedupe by project id.
      const { platformGroups } = getRepositories();
      const [userMemberships, groupAccess] = await Promise.all([
        memberships.findByUser(request.user.id),
        platformGroups.getEffectiveMemberships(request.user.id),
      ]);
      const allProjectIds = new Set<string>([
        ...userMemberships.map((m) => m.projectId),
        ...groupAccess.map((g) => g.projectId),
      ]);
      if (allProjectIds.size === 0) return reply.send({ data: [] });

      const rows = await Promise.all(
        [...allProjectIds].map((id) => projects.findById(id)),
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

  // PATCH /projects/:id/git-credentials — replace the project's PAT.
  //
  // Three credential modes (same as POST /projects):
  //   - `gitToken`    → write plain token to project_git_credentials
  //                     and clear `git_secret_id` so the vault
  //                     reference doesn't shadow the new plain token
  //   - `gitSecretId` → link to an existing vault secret (and clear
  //                     any plain token so it doesn't linger)
  //   - `newSecret`   → auto-save the supplied token to the vault,
  //                     link the project to it, clear plain token
  //
  // project-admin minimum (HARNESS.json shapes deploy/maintenance for
  // every operator on the project — credentials are the same trust
  // level). GP-006: audit metadata never carries the token value.
  app.patch<{ Params: { id: string }; Body: UpdateGitCredentialsBody }>(
    '/projects/:id/git-credentials',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, request.params.id, 'project-admin')) return;

      const body = request.body ?? ({} as UpdateGitCredentialsBody);
      const { gitToken, gitSecretId, newSecret } = body;
      const modesProvided = [
        gitToken?.trim() ? 'gitToken' : null,
        gitSecretId?.trim() ? 'gitSecretId' : null,
        newSecret?.value?.trim() ? 'newSecret' : null,
      ].filter(Boolean);
      if (modesProvided.length === 0) {
        return reply.code(400).send({
          error: 'One of gitToken, gitSecretId, or newSecret is required',
          code: 'CREDENTIAL_REQUIRED',
        });
      }
      if (modesProvided.length > 1) {
        return reply.code(400).send({
          error: `Provide only one credential mode (received: ${modesProvided.join(', ')})`,
          code: 'CREDENTIAL_AMBIGUOUS',
        });
      }
      if (newSecret && (!newSecret.name?.trim() || !newSecret.value?.trim())) {
        return reply.code(400).send({
          error: 'newSecret requires both name and value',
          code: 'NEW_SECRET_INVALID',
        });
      }

      const { projects, audit, platformSecrets } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      if (gitSecretId) {
        const secret = await platformSecrets.findById(gitSecretId);
        if (!secret) {
          return reply.code(400).send({
            error: `Vault secret '${gitSecretId}' not found`,
            code: 'SECRET_NOT_FOUND',
          });
        }
      }

      let credentialType: 'plain' | 'vault-existing' | 'vault-new' = 'plain';
      let linkedSecretId: string | null = null;
      try {
        if (newSecret) {
          linkedSecretId = await createVaultSecret({
            name: newSecret.name,
            value: newSecret.value,
            createdBy: request.user.id,
            correlationId: request.correlationId,
            ip: request.ip,
          });
          // Clear any prior plain token AND link the new secret.
          await projects.deleteAllCredentials(project.id);
          await projects.saveGitSecretRef(project.id, linkedSecretId);
          credentialType = 'vault-new';
        } else if (gitSecretId) {
          await projects.deleteAllCredentials(project.id);
          await projects.saveGitSecretRef(project.id, gitSecretId);
          linkedSecretId = gitSecretId;
          credentialType = 'vault-existing';
        } else if (gitToken) {
          // Clear vault ref so the plain token wins the precedence
          // check in resolveProjectCredential.
          await projects.saveGitSecretRef(project.id, null);
          await projects.deleteAllCredentials(project.id);
          await projects.saveCredential(project.id, gitToken);
          credentialType = 'plain';
        }
      } catch (err) {
        const errCode = err instanceof Error && 'code' in err && (err as { code?: string }).code === 'NAME_TAKEN'
          ? 'NAME_TAKEN' : undefined;
        return reply.code(errCode ? 409 : 500).send({
          error: err instanceof Error ? err.message : String(err),
          code: errCode ?? 'CREDENTIAL_SAVE_FAILED',
        });
      }

      await audit.append({
        actor: request.user.id,
        action: 'project.git-credentials-updated',
        entityType: 'projects',
        entityId: project.id,
        correlationId: request.correlationId,
        metadata: {
          projectId: project.id,
          credentialType,
          gitSecretId: linkedSecretId,
          ip: request.ip,
        },
      });

      const refreshed = await projects.findById(project.id);
      log.info({ projectId: project.id, credentialType }, 'Project git credentials updated');
      return reply.send({ data: refreshed ? toPublic(refreshed) : toPublic(project) });
    },
  );

  // DELETE /projects/:id — platform-admin only.
  //
  // Tears down dependent tables in FK-safe order, then deletes the
  // project row. Refuses on active intents — anything in
  // `generating | in-review | deploying | waiting-for-clarification`
  // could mutate the project's Git tree or queue more work, so we
  // require the operator to wait for those to settle first.
  // `escalated` and `failed` cycles are fair game (they're paused or
  // terminal).
  //
  // **The remote Git repository is NOT deleted** — the platform only
  // owns the platform-side data. Audit metadata records the
  // git url so a future investigator can find the source of truth.
  app.delete<{ Params: { id: string } }>(
    '/projects/:id',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });

      const { projects, intents, memberships, maintenanceRuns, audit } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      // Active intents guard — refuse with a typed code so the
      // dashboard's confirm modal can surface the explanation.
      const activeCount = await intents.countActiveByProject(project.id);
      if (activeCount > 0) {
        return reply.code(400).send({
          error: 'Cannot delete — this project has active intents. Wait for them to complete or fail first.',
          code: 'PROJECT_HAS_ACTIVE_INTENTS',
          activeIntents: activeCount,
        });
      }

      const intentCount = await intents.countByProject(project.id);

      try {
        // Order matters: FK rows go first, then the project row.
        // intents themselves are NOT cascaded — they remain as
        // historical data attached by id; the project_id column on
        // intents already has ON DELETE CASCADE via the schema, so
        // the projects.delete() at the end takes care of them.
        // We still tear down rows whose FK constraints would block
        // the delete OR whose ON DELETE behaviour we don't want to
        // depend on:
        await memberships.deleteAllForProject(project.id);
        await projects.deleteAllCredentials(project.id);
        await maintenanceRuns.deleteAllForProject(project.id);
        const deleted = await projects.delete(project.id);
        if (deleted !== 1) {
          log.warn({ projectId: project.id, deleted }, 'projects.delete returned 0 — row vanished mid-cleanup');
        }

        await audit.append({
          actor: request.user.id,
          action: 'project.deleted',
          entityType: 'projects',
          entityId: project.id,
          correlationId: request.correlationId,
          metadata: {
            name: project.name,
            gitUrl: project.gitUrl,
            intentCount,
            ip: request.ip,
          },
        });

        emitLiveEvent('project.deleted', project.id, { projectId: project.id, name: project.name });
        log.info({ projectId: project.id, name: project.name, intentCount }, 'Project deleted');
        return reply.code(204).send();
      } catch (err) {
        log.error({ err, projectId: project.id }, 'Project deletion failed');
        return reply.code(500).send({
          error: 'Failed to delete project',
          details: err instanceof Error ? err.message : String(err),
        });
      }
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

      const token = await resolveProjectCredential(project);
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

        // Dynamic-harness (2026-06-04 session) — ask the LLM to
        // analyse the project description and produce a tailored
        // stack config. NEVER throws: on LLM-call failure or parse
        // failure `generateStackConfig` returns a copy of
        // `DEFAULT_STACK_CONFIG` so `init-harness` always completes.
        // The result drives the template's stack-aware placeholders
        // ({{language}}, {{nodeVersion}}, {{ciSetupSteps}}, …).
        const stackConfig = await generateStackConfig(
          projectDescription.trim(),
          project.name,
        );
        log.info(
          {
            projectId: project.id,
            language: stackConfig.language,
            packageManager: stackConfig.packageManager,
            nodeVersion: stackConfig.nodeVersion,
            testFramework: stackConfig.testFramework,
          },
          'Stack config generated for project',
        );

        // ADR-036: harness content lives in `templates/<id>/`. The
        // engine walks the template, substitutes `{{variables}}`, and
        // returns the list of files-to-commit with their target
        // paths inside the project repo.
        // Resolve which template to apply: the platform default (set
        // via the dashboard's Templates tab) wins; if no default is
        // set, fall back to the built-in slug so existing deployments
        // continue to work.
        const defaultTemplate = await getRepositories().platformTemplates.findDefault();
        const templateId = defaultTemplate?.slug ?? DEFAULT_TEMPLATE_ID;
        const harnessFiles = await loadTemplate(TEMPLATES_DIR, templateId, {
          projectName: project.name,
          projectDescription: projectDescription.trim(),
          defaultBranch: project.defaultBranch,
          // Stack-driven variables. nodeVersion / buildCmd /
          // framework / frontend / database may be null — the
          // template renders the placeholder as the empty string
          // (or 'N/A' for nodeVersion) so non-Node projects don't
          // produce a literal `null` in their HARNESS.json.
          language:                  stackConfig.language,
          nodeVersion:               stackConfig.nodeVersion ?? 'N/A',
          packageManager:            stackConfig.packageManager,
          installCmd:                stackConfig.installCmd,
          testCmd:                   stackConfig.testCmd,
          buildCmd:                  stackConfig.buildCmd ?? '',
          testFramework:             stackConfig.testFramework,
          framework:                 stackConfig.framework ?? '',
          frontend:                  stackConfig.frontend ?? '',
          database:                  stackConfig.database ?? '',
          moduleStructure:           stackConfig.moduleStructure,
          architectureNotes:         stackConfig.architectureNotes,
          stackSection:              stackConfig.stackSection,
          agentPromptExtensionsYaml: stackConfig.agentPromptExtensionsYaml,
          ciSetupSteps:              stackConfig.ciSetupSteps,
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
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, request.params.id, 'project-admin')) return;

      const body = request.body ?? ({} as UpdateConfigBody);
      const requestedAdapter = body.pipeline?.adapter;
      const requestedAutoMerge = body.pipeline?.autoMerge;
      const requestedMergeMethod = body.pipeline?.mergeMethod;
      if (
        requestedAdapter === undefined
        && requestedAutoMerge === undefined
        && requestedMergeMethod === undefined
      ) {
        return reply.code(400).send({
          error:
            'No supported config field provided. Settable fields: ' +
            '`pipeline.adapter`, `pipeline.autoMerge`, `pipeline.mergeMethod`.',
        });
      }
      if (requestedAdapter !== undefined
          && !VALID_PIPELINE_ADAPTERS.includes(requestedAdapter as ValidPipelineAdapter)) {
        return reply.code(400).send({
          error: `Unsupported pipeline adapter '${requestedAdapter}'. Valid values: ${VALID_PIPELINE_ADAPTERS.join(', ')}`,
          code: 'INVALID_PIPELINE_ADAPTER',
        });
      }
      if (requestedAutoMerge !== undefined && typeof requestedAutoMerge !== 'boolean') {
        return reply.code(400).send({
          error: '`pipeline.autoMerge` must be a boolean',
          code: 'INVALID_AUTO_MERGE',
        });
      }
      if (requestedMergeMethod !== undefined
          && !VALID_MERGE_METHODS.includes(requestedMergeMethod as ValidMergeMethod)) {
        return reply.code(400).send({
          error: `Unsupported merge method '${requestedMergeMethod}'. Valid values: ${VALID_MERGE_METHODS.join(', ')}`,
          code: 'INVALID_MERGE_METHOD',
        });
      }
      const newAdapter = requestedAdapter as ValidPipelineAdapter | undefined;
      const newAutoMerge = requestedAutoMerge;
      const newMergeMethod = requestedMergeMethod as ValidMergeMethod | undefined;

      const { projects, audit } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const token = await resolveProjectCredential(project);
      if (!token) {
        return reply.code(400).send({
          error: 'Project has no Git credential on file; re-register the project',
          code: 'NO_CREDENTIAL',
        });
      }

      // Delegate to the shared `applyPipelinePatch` helper so the
      // legacy CLI path and the new `PATCH /:id/config/pipeline` go
      // through one mutation surface. The response shape preserved
      // below is the LEGACY shape (`updated`, `adapter`,
      // `autoMerge?`, `mergeMethod?`, `commitSha?`, `reason?`) that
      // `gestalt projects set-adapter` already consumes.
      try {
        const patch = {
          ...(newAdapter !== undefined ? { adapter: newAdapter } : {}),
          ...(newAutoMerge !== undefined ? { autoMerge: newAutoMerge } : {}),
          ...(newMergeMethod !== undefined ? { mergeMethod: newMergeMethod } : {}),
        };
        const result = await applyPipelinePatch(project, token, patch);
        const finalPipeline = (result.harness['pipeline'] as Record<string, unknown> | undefined) ?? {};
        if (result.changedFields.length === 0) {
          return reply.send({
            data: {
              updated: false,
              reason: 'no-change',
              adapter: (finalPipeline['adapter'] as string | undefined) ?? null,
            },
          });
        }
        await audit.append({
          actor: request.user.id,
          action: 'project.config-updated',
          entityType: 'projects',
          entityId: project.id,
          correlationId: request.correlationId,
          metadata: {
            field: 'pipeline',
            section: 'pipeline',
            changedFields: result.changedFields,
            newValues: {
              adapter: (finalPipeline['adapter'] as string | undefined) ?? null,
              autoMerge: (finalPipeline['autoMerge'] as boolean | undefined) ?? null,
              mergeMethod: (finalPipeline['mergeMethod'] as string | undefined) ?? null,
            },
            commitSha: result.commitSha,
            ip: request.ip,
          },
        });
        log.info(
          { projectId: project.id, changedFields: result.changedFields, commitSha: result.commitSha },
          'Project config updated (legacy POST → applyPipelinePatch)',
        );
        return reply.send({
          data: {
            updated: true,
            adapter: (finalPipeline['adapter'] as string | undefined) ?? null,
            autoMerge: (finalPipeline['autoMerge'] as boolean | undefined) ?? null,
            mergeMethod: (finalPipeline['mergeMethod'] as string | undefined) ?? null,
            commitSha: result.commitSha,
          },
        });
      } catch (err) {
        log.error({ err, projectId: project.id }, 'Project config update failed');
        return reply.code(500).send({
          error: 'Failed to update project config',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
