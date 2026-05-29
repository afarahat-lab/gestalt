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
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  type ProjectRecord,
} from '@gestalt/core';
import { requireRole } from '../auth/middleware';

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

  // GET /projects — list projects owned by the requester
  app.get(
    '/projects',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      const { projects } = getRepositories();
      const rows = await projects.list(request.user.id);
      return reply.send({ data: rows.map(toPublic) });
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

        const harnessFiles = buildHarnessFiles({
          projectName: project.name,
          projectDescription: projectDescription.trim(),
        });

        for (const [relativePath, content] of Object.entries(harnessFiles)) {
          const fullPath = join(workDir, relativePath);
          await mkdir(join(fullPath, '..'), { recursive: true });
          await writeFile(fullPath, content, 'utf8');
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
}

// ─── Harness file content ─────────────────────────────────────────────────────
// Inlined rather than read from /app/templates so the server image doesn't
// need to ship the templates directory. When a richer template story exists
// (multiple tiers, branch-per-template), move this into a templates package
// the server depends on.

interface HarnessInputs {
  projectName: string;
  projectDescription: string;
}

function buildHarnessFiles(inputs: HarnessInputs): Record<string, string> {
  return {
    'AGENTS.md':                  buildAgentsMd(inputs),
    'HARNESS.json':               buildHarnessJson(inputs),
    'docs/ARCHITECTURE.md':       buildArchitectureMd(inputs),
    'docs/DOMAIN.md':             buildDomainMd(inputs),
    'docs/GOLDEN_PRINCIPLES.md':  buildGoldenPrinciplesMd(),
    'docs/DECISIONS.md':          buildDecisionsMd(inputs),
  };
}

function buildAgentsMd({ projectName, projectDescription }: HarnessInputs): string {
  return `# AGENTS.md — ${projectName}

This file is the primary agent orientation document for this project.
Read this file completely before taking any action.

## What this project is

${projectDescription}

## Architecture rules

1. Modules never import from each other's internals — only from index.ts
2. All database access through the repository pattern
3. Every state-changing operation produces an audit record (GP-001)
4. RBAC enforced at middleware, never inline (GP-002)

## When context is missing

Emit a \`CONTEXT_GAP\` signal with the specific missing information identified.
`;
}

function buildHarnessJson({ projectName, projectDescription }: HarnessInputs): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const config = {
    name: slug || projectName.toLowerCase(),
    version: '0.1.0',
    tier: 'tier1',
    templateId: 'corporate-ops-web-mobile',
    description: projectDescription,
    stack: {
      language: 'typescript',
      runtime: 'node20',
      packageManager: 'pnpm',
      frontend: 'react',
      backend: 'node-fastify',
      database: 'postgres',
      architectureStyle: 'modular-monolith',
    },
    adapters: {
      database: { type: 'postgres', configKey: 'DATABASE_URL' },
      queue:    { type: 'bullmq',   configKey: 'REDIS_URL' },
      llm:      { type: 'azure-openai', configKey: 'LLM_BASE_URL' },
    },
    qualityGate: {
      required: ['lint', 'typecheck', 'unit-tests', 'constraint-check', 'security-scan'],
      blockingSignals: ['GOLDEN_PRINCIPLE_BREACH', 'CONSTRAINT_VIOLATION'],
      autoResolvableSignals: ['LINT_FAILURE', 'TEST_FAILURE'],
      maxRetries: 3,
    },
    // Deploy layer — pipeline adapter (ADR-033). Defaults to `noop` so the
    // deploy chain runs end-to-end on a fresh project without real CI/CD.
    // Change to `github-actions` (or another future adapter) once a
    // pipeline workflow is in place in the repo.
    pipeline: {
      adapter: 'noop',
    },
    maintenance: {
      driftCheck:     { enabled: true, scheduleUtc: '0 2 * * *' },
      alignmentCheck: { enabled: true, scheduleUtc: '0 3 * * *' },
      gcCheck:        { enabled: true, scheduleUtc: '0 4 * * 5' },
    },
    identity: {
      providers: [{ type: 'local', enabled: true, warningBanner: true, allowedInProduction: false }],
      roleMapping: [],
      defaultRole: null,
      sessionTtlMinutes: 480,
    },
  };
  return JSON.stringify(config, null, 2) + '\n';
}

function buildArchitectureMd({ projectName }: HarnessInputs): string {
  return `# Architecture — ${projectName}

## Style: modular monolith

## Layer structure

\`\`\`
src/
├── modules/          # business domain modules — own their data and routes
├── shared/
│   ├── db/           # repository implementations
│   ├── auth/         # authentication + RBAC
│   └── utils/        # cross-cutting helpers
└── api/              # route registration
\`\`\`

## Dependency rules

- Modules may only import from each other's index.ts
- All database access through src/shared/db/ repositories
- No circular dependencies
- No direct DB calls outside repository classes
`;
}

function buildDomainMd({ projectName }: HarnessInputs): string {
  return `# Domain Model — ${projectName}

To be populated as the design-agent and context-agent learn the domain.
`;
}

function buildGoldenPrinciplesMd(): string {
  return `# Golden Principles

These invariants are non-negotiable. Violations produce
\`GOLDEN_PRINCIPLE_BREACH\` signals and require human review.

## GP-001 — Every state-changing operation produces an audit record

Any API endpoint that creates, updates, or deletes data must write an
\`AuditLog\` record before the operation completes.

## GP-002 — RBAC enforced at middleware, never inline

Role-based access control is enforced by middleware on every route.

## GP-003 — Input validated at the API boundary

All request bodies validated with Zod (or equivalent) before reaching
handlers.

## GP-004 — No sensitive data in logs

PII, tokens, passwords, and PCI/PHI data must never appear in log lines.
`;
}

function buildDecisionsMd({ projectName, projectDescription }: HarnessInputs): string {
  const date = new Date().toISOString().split('T')[0];
  return `# Architecture Decisions — ${projectName}

## ADR-001 — Project initialised

Date: ${date}
Status: Accepted

Decision: Project initialised via the Gestalt platform.
Description: ${projectDescription}
Stack: TypeScript / Node.js / React / PostgreSQL
Architecture: Modular monolith (corporate-ops-web-mobile template, tier 1)
`;
}
