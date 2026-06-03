/**
 * Project-config routes — config-as-code (Approach A, ADR-032).
 *
 *   GET    /projects/:id/config
 *   PATCH  /projects/:id/config/pipeline
 *   PATCH  /projects/:id/config/agents
 *   PATCH  /projects/:id/config/custom-agents
 *   PATCH  /projects/:id/config/tools
 *
 * Every write clones the repo to a temp dir, mutates `agents.yaml` or
 * `HARNESS.json`, commits with `chore: update <section>
 * [gestalt-admin]`, pushes to `defaultBranch`, and cleans up in
 * `finally`. The GET endpoint uses a shallow clone since it's
 * read-only.
 *
 * Authorization: `requireProjectMembership(..., 'project-admin')` on
 * every route — editors and readers cannot touch project config
 * (matches the dashboard's `Settings` link visibility rules).
 *
 * Backward compat: the existing `POST /projects/:id/config` in
 * `projects.ts` is preserved as a thin alias for `set-adapter`. It
 * delegates internally to the same pipeline-patch helper used here so
 * there's exactly one mutation path per file.
 *
 * Audit (GP-002): every successful patch writes a
 * `project.config-updated` row with the changed field names + the
 * commit sha. Values are excluded — they may contain tokens (MCP
 * `tokenFrom: 'env:VAR'` strings, future credential overrides).
 */

import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit, type SimpleGit } from 'simple-git';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  type ProjectRecord,
  type HarnessPipelineConfig, type BuiltInToolName,
  type AgentToolConfig, type McpServerConfig,
} from '@gestalt/core';
import {
  loadCustomAgents, scheduleCustomAgents,
  type AgentConfig, type AgentsYaml,
  type CustomAgentDefinition,
} from '@gestalt/agents-generate';
import { checkProjectMembership } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:project-config' });

const VALID_PIPELINE_ADAPTERS = ['noop', 'github-actions'] as const;
type ValidPipelineAdapter = typeof VALID_PIPELINE_ADAPTERS[number];

const VALID_MERGE_METHODS = ['merge', 'squash', 'rebase'] as const;
type ValidMergeMethod = typeof VALID_MERGE_METHODS[number];

const VALID_BUILTIN_TOOLS: ReadonlySet<BuiltInToolName> = new Set([
  'readFile', 'listDirectory', 'searchFiles', 'getFileTree',
]);

const VALID_MCP_TOKEN_SOURCES = ['harness', 'project_credential'] as const;

// Framework LLM agents that ARE editable from the agents tab. Excludes
// the deterministic infrastructure agents (constraint, test-runner,
// pr/pipeline/promotion, gc, evaluation) — those have no
// agents.yaml-driven config because they don't call the LLM.
const EDITABLE_FRAMEWORK_AGENTS: ReadonlySet<string> = new Set([
  'intent-agent', 'design-agent', 'context-agent', 'lint-config-agent',
  'code-agent', 'test-agent', 'review-agent', 'drift-agent',
  'alignment-agent', 'context-fixer',
]);

// ─── Route registration ──────────────────────────────────────────────────────

export async function registerProjectConfigRoutes(app: FastifyInstance): Promise<void> {

  // GET /projects/:id/config — read both HARNESS.json + agents.yaml
  // via a shallow clone. Used by all six dashboard tabs on first
  // render. project-admin minimum.
  app.get<{ Params: { id: string } }>(
    '/projects/:id/config',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, request.params.id, 'project-admin')) return;

      const { projects } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const token = await projects.getCredential(project.id);
      if (!token) {
        return reply.code(400).send({
          error: 'Project has no Git credential on file; re-register the project',
          code: 'NO_CREDENTIAL',
        });
      }

      try {
        const { harness, agents } = await readProjectConfig(project, token);
        // Filter the framework-agent map to the editable subset so the
        // dashboard doesn't need to know the deterministic-agent list.
        // Custom agents pass through unchanged.
        const editable: AgentsYaml = {
          agents: filterEditableAgents(agents.agents ?? {}),
          ...(agents.custom_agents ? { custom_agents: agents.custom_agents } : {}),
        };
        return reply.send({ data: { harness, agents: editable } });
      } catch (err) {
        log.error({ err, projectId: project.id }, 'Failed to read project config');
        return reply.code(500).send({
          error: 'Failed to read project config from repo',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // PATCH /projects/:id/config/pipeline — update pipeline section in
  // HARNESS.json. Mirrors the existing `POST /projects/:id/config`
  // (which is kept as a backward-compat alias).
  app.patch<{
    Params: { id: string };
    Body: { adapter?: unknown; autoMerge?: unknown; mergeMethod?: unknown };
  }>(
    '/projects/:id/config/pipeline',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, request.params.id, 'project-admin')) return;

      const body = request.body ?? {};
      const validation = validatePipelinePatch(body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }

      const { projects, audit } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });
      const token = await projects.getCredential(project.id);
      if (!token) {
        return reply.code(400).send({ error: 'Project has no Git credential on file', code: 'NO_CREDENTIAL' });
      }

      try {
        const result = await applyPipelinePatch(project, token, validation.patch);
        await audit.append({
          actor: request.user.id,
          action: 'project.config-updated',
          entityType: 'projects',
          entityId: project.id,
          correlationId: request.correlationId,
          metadata: {
            section: 'pipeline',
            changedFields: result.changedFields,
            commitSha: result.commitSha,
            ip: request.ip,
          },
        });
        log.info(
          { projectId: project.id, changedFields: result.changedFields, commitSha: result.commitSha },
          'Pipeline config updated',
        );
        return reply.send({ data: result.harness });
      } catch (err) {
        log.error({ err, projectId: project.id }, 'Pipeline config update failed');
        return reply.code(500).send({
          error: 'Failed to update pipeline config',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // PATCH /projects/:id/config/agents — update framework agents in
  // agents.yaml. Partial per-agent: only the supplied fields change.
  app.patch<{
    Params: { id: string };
    Body: { agents?: Record<string, Partial<AgentConfig>> };
  }>(
    '/projects/:id/config/agents',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, request.params.id, 'project-admin')) return;

      const body = request.body ?? {};
      const validation = validateAgentsPatch(body.agents ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }

      const { projects, audit } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });
      const token = await projects.getCredential(project.id);
      if (!token) {
        return reply.code(400).send({ error: 'Project has no Git credential on file', code: 'NO_CREDENTIAL' });
      }

      try {
        const result = await applyAgentsPatch(project, token, validation.patch);
        await audit.append({
          actor: request.user.id,
          action: 'project.config-updated',
          entityType: 'projects',
          entityId: project.id,
          correlationId: request.correlationId,
          metadata: {
            section: 'agents',
            agentRoles: Object.keys(validation.patch),
            commitSha: result.commitSha,
            ip: request.ip,
          },
        });
        log.info(
          { projectId: project.id, roles: Object.keys(validation.patch), commitSha: result.commitSha },
          'Agents config updated',
        );
        return reply.send({ data: { agents: filterEditableAgents(result.agents.agents ?? {}), custom_agents: result.agents.custom_agents } });
      } catch (err) {
        log.error({ err, projectId: project.id }, 'Agents config update failed');
        return reply.code(500).send({
          error: 'Failed to update agents config',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // PATCH /projects/:id/config/custom-agents — full replace of the
  // `custom_agents:` section. Validates via `scheduleCustomAgents`
  // before the commit so cycles + unknown targets fail with 400.
  app.patch<{
    Params: { id: string };
    Body: { customAgents?: unknown; custom_agents?: unknown };
  }>(
    '/projects/:id/config/custom-agents',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Authentication required' });
      if (!await checkProjectMembership(reply, request.user.id, request.user.role, request.params.id, 'project-admin')) return;

      const body = request.body ?? {};
      const raw = body.customAgents ?? body.custom_agents;
      const validation = validateCustomAgentsPatch(raw);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.error, code: validation.code });
      }

      const { projects, audit } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });
      const token = await projects.getCredential(project.id);
      if (!token) {
        return reply.code(400).send({ error: 'Project has no Git credential on file', code: 'NO_CREDENTIAL' });
      }

      try {
        const result = await applyCustomAgentsPatch(project, token, validation.patch);
        await audit.append({
          actor: request.user.id,
          action: 'project.config-updated',
          entityType: 'projects',
          entityId: project.id,
          correlationId: request.correlationId,
          metadata: {
            section: 'custom-agents',
            customAgentNames: validation.patch.map((d) => d.name),
            commitSha: result.commitSha,
            ip: request.ip,
          },
        });
        log.info(
          {
            projectId: project.id,
            customAgentCount: validation.patch.length,
            commitSha: result.commitSha,
          },
          'Custom agents config updated',
        );
        return reply.send({ data: { agents: filterEditableAgents(result.agents.agents ?? {}), custom_agents: result.agents.custom_agents } });
      } catch (err) {
        log.error({ err, projectId: project.id }, 'Custom agents config update failed');
        // Scheduler errors thrown by applyCustomAgentsPatch (defensive
        // re-validation against the post-merge yaml) map to 400.
        if (err instanceof Error && /Cycle detected|runs_after/.test(err.message)) {
          return reply.code(400).send({ error: err.message, code: 'INVALID_CUSTOM_AGENT_SCHEDULE' });
        }
        return reply.code(500).send({
          error: 'Failed to update custom agents config',
          details: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // PATCH /projects/:id/config/tools — REMOVED (Session 3).
  //
  // Tool assignment is now part of agent config — the dashboard's
  // Tools tab merged into the Agents tab so a single Save call (one
  // commit) covers per-agent role/goal/llm/promptExtensions/tools.
  // Clients sending tool changes should now use:
  //
  //   PATCH /projects/:id/config/agents
  //     { agents: { '<role>': { tools: { builtin, mcp } } } }
  //
  // The legacy CLI `gestalt project config set-tools` is kept as a
  // thin alias that internally targets the agents endpoint.
}

// ─── Read helpers (shallow clone) ────────────────────────────────────────────

interface ProjectConfig {
  harness: Record<string, unknown>;
  agents: AgentsYaml;
}

async function readProjectConfig(project: ProjectRecord, token: string): Promise<ProjectConfig> {
  const workDir = await mkdtemp(join(tmpdir(), `gestalt-config-read-${project.id}-`));
  try {
    await simpleGit().clone(authenticatedGitUrl(project.gitUrl, token), workDir, ['--depth', '1']);
    const harness = await readHarnessJson(workDir);
    const agents = await readAgentsYamlParsed(workDir);
    return { harness, agents };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readHarnessJson(workDir: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(join(workDir, 'HARNESS.json'), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`HARNESS.json missing or unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function readAgentsYamlParsed(workDir: string): Promise<AgentsYaml> {
  try {
    const raw = await readFile(join(workDir, 'agents.yaml'), 'utf8');
    const parsed = parseYaml(raw) as AgentsYaml | null;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    // No agents.yaml committed yet — return an empty shape. The
    // dashboard's Agents tab will populate it on first save by
    // emitting a PATCH with the framework defaults filled in
    // client-side, OR `gestalt init` will seed the file alongside
    // HARNESS.json.
    return {};
  }
}

function filterEditableAgents(agents: Record<string, AgentConfig>): Record<string, AgentConfig> {
  const out: Record<string, AgentConfig> = {};
  for (const [name, cfg] of Object.entries(agents)) {
    if (EDITABLE_FRAMEWORK_AGENTS.has(name)) out[name] = cfg;
  }
  return out;
}

// ─── Write helpers (full clone + commit + push) ──────────────────────────────

interface WriteResult<T = void> {
  commitSha: string;
  /** Whichever shape (`harness` or `agents`) the mutation produced. */
  payload: T;
}

async function withWorkingClone<T>(
  project: ProjectRecord,
  token: string,
  commitSubject: string,
  mutate: (workDir: string) => Promise<{ touchedFiles: string[]; payload: T } | null>,
): Promise<WriteResult<T> | { commitSha: null; payload: T }> {
  const workDir = await mkdtemp(join(tmpdir(), `gestalt-config-write-${project.id}-`));
  try {
    const cloneUrl = authenticatedGitUrl(project.gitUrl, token);
    await simpleGit().clone(cloneUrl, workDir);
    const repo: SimpleGit = simpleGit(workDir);

    try { await repo.checkout(project.defaultBranch); }
    catch { await repo.checkoutLocalBranch(project.defaultBranch); }

    const result = await mutate(workDir);
    if (!result) {
      // Caller signalled "no change" — return null commit sha so the
      // outer layer can short-circuit.
      return { commitSha: null, payload: null as unknown as T };
    }

    await repo.addConfig('user.name', 'Gestalt Platform');
    await repo.addConfig('user.email', 'gestalt@noreply');
    for (const file of result.touchedFiles) {
      await repo.add(file);
    }

    const status = await repo.status();
    if (status.files.length === 0) {
      return { commitSha: null, payload: result.payload };
    }

    const commit = await repo.commit(commitSubject);
    await repo.push('origin', project.defaultBranch);
    return { commitSha: commit.commit, payload: result.payload };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function authenticatedGitUrl(gitUrl: string, token: string): string {
  if (!gitUrl.startsWith('http://') && !gitUrl.startsWith('https://')) return gitUrl;
  const url = new URL(gitUrl);
  url.username = 'x-access-token';
  url.password = token;
  return url.toString();
}

// ─── Validation ──────────────────────────────────────────────────────────────

type ValidationResult<T> = { ok: true; patch: T } | { ok: false; error: string; code: string };

function validatePipelinePatch(body: Record<string, unknown>): ValidationResult<Partial<HarnessPipelineConfig>> {
  const out: Partial<HarnessPipelineConfig> = {};
  if (body['adapter'] !== undefined) {
    const v = body['adapter'];
    if (typeof v !== 'string' || !VALID_PIPELINE_ADAPTERS.includes(v as ValidPipelineAdapter)) {
      return { ok: false, error: `Invalid adapter. Valid values: ${VALID_PIPELINE_ADAPTERS.join(', ')}`, code: 'INVALID_PIPELINE_ADAPTER' };
    }
    out.adapter = v;
  }
  if (body['autoMerge'] !== undefined) {
    if (typeof body['autoMerge'] !== 'boolean') {
      return { ok: false, error: '`autoMerge` must be a boolean', code: 'INVALID_AUTO_MERGE' };
    }
    out.autoMerge = body['autoMerge'];
  }
  if (body['mergeMethod'] !== undefined) {
    const v = body['mergeMethod'];
    if (typeof v !== 'string' || !VALID_MERGE_METHODS.includes(v as ValidMergeMethod)) {
      return { ok: false, error: `Invalid mergeMethod. Valid values: ${VALID_MERGE_METHODS.join(', ')}`, code: 'INVALID_MERGE_METHOD' };
    }
    out.mergeMethod = v as ValidMergeMethod;
  }
  if (Object.keys(out).length === 0) {
    return { ok: false, error: 'No supported pipeline fields supplied. Settable: adapter, autoMerge, mergeMethod', code: 'EMPTY_PATCH' };
  }
  return { ok: true, patch: out };
}

function validateAgentsPatch(
  input: Record<string, unknown>,
): ValidationResult<Record<string, Partial<AgentConfig>>> {
  const out: Record<string, Partial<AgentConfig>> = {};
  for (const [role, raw] of Object.entries(input)) {
    if (!EDITABLE_FRAMEWORK_AGENTS.has(role)) {
      return {
        ok: false,
        code: 'UNKNOWN_AGENT_ROLE',
        error: `Agent '${role}' is not editable. Infrastructure agents (constraint, lint, security, test-runner, pr, pipeline, promotion, gc, evaluation) run deterministic checks and have no agents.yaml-driven config.`,
      };
    }
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const patch: Partial<AgentConfig> = {};

    if (r['role'] !== undefined) {
      if (typeof r['role'] !== 'string') return { ok: false, code: 'INVALID_AGENT_ROLE_FIELD', error: `'role' must be a string for ${role}` };
      patch.role = r['role'];
    }
    if (r['goal'] !== undefined) {
      if (typeof r['goal'] !== 'string') return { ok: false, code: 'INVALID_AGENT_GOAL', error: `'goal' must be a string for ${role}` };
      patch.goal = r['goal'];
    }
    if (r['llm'] !== undefined) {
      if (!r['llm'] || typeof r['llm'] !== 'object') return { ok: false, code: 'INVALID_AGENT_LLM', error: `'llm' must be an object for ${role}` };
      const llm = r['llm'] as Record<string, unknown>;
      const out_llm: AgentConfig['llm'] = {};
      if (llm['model'] !== undefined) {
        if (llm['model'] !== null && typeof llm['model'] !== 'string') {
          return { ok: false, code: 'INVALID_AGENT_MODEL', error: `llm.model must be a string or null for ${role}` };
        }
        if (typeof llm['model'] === 'string' && llm['model'].trim()) out_llm.model = llm['model'].trim();
      }
      if (llm['temperature'] !== undefined) {
        if (typeof llm['temperature'] !== 'number' || llm['temperature'] < 0 || llm['temperature'] > 2) {
          return { ok: false, code: 'INVALID_TEMPERATURE', error: `llm.temperature must be a number between 0 and 2 for ${role}` };
        }
        out_llm.temperature = llm['temperature'];
      }
      if (llm['maxTokens'] !== undefined) {
        if (typeof llm['maxTokens'] !== 'number' || !Number.isFinite(llm['maxTokens']) || llm['maxTokens'] <= 0) {
          return { ok: false, code: 'INVALID_MAX_TOKENS', error: `llm.maxTokens must be a positive number for ${role}` };
        }
        out_llm.maxTokens = Math.floor(llm['maxTokens']);
      }
      patch.llm = out_llm;
    }
    if (r['promptExtensions'] !== undefined) {
      if (!Array.isArray(r['promptExtensions']) || !r['promptExtensions'].every((s) => typeof s === 'string')) {
        return { ok: false, code: 'INVALID_PROMPT_EXTENSIONS', error: `promptExtensions must be an array of strings for ${role}` };
      }
      patch.promptExtensions = r['promptExtensions'];
    }

    // Tools field — merged into the agent's `tools:` block in
    // agents.yaml. Validation mirrors the standalone `/tools` route
    // (which is now removed — tool assignment IS agent config).
    if (r['tools'] !== undefined) {
      if (!r['tools'] || typeof r['tools'] !== 'object') {
        return { ok: false, code: 'INVALID_TOOLS', error: `'tools' must be an object for ${role}` };
      }
      const toolsValidation = validateToolFields(r['tools'] as Record<string, unknown>, role);
      if (!toolsValidation.ok) return toolsValidation;
      patch.tools = toolsValidation.patch;
    }

    if (Object.keys(patch).length > 0) out[role] = patch;
  }
  if (Object.keys(out).length === 0) {
    return { ok: false, code: 'EMPTY_PATCH', error: 'No agent updates supplied' };
  }
  return { ok: true, patch: out };
}

function validateCustomAgentsPatch(raw: unknown): ValidationResult<CustomAgentDefinition[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, code: 'INVALID_CUSTOM_AGENTS', error: 'customAgents must be an array' };
  }
  const seen = new Set<string>();
  const out: CustomAgentDefinition[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, code: 'INVALID_CUSTOM_AGENT', error: 'Each custom agent must be an object' };
    }
    const e = entry as Record<string, unknown>;
    const name = typeof e['name'] === 'string' ? e['name'].trim() : '';
    const role = typeof e['role'] === 'string' ? e['role'].trim() : '';
    const goal = typeof e['goal'] === 'string' ? e['goal'].trim() : '';
    const prompt = typeof e['prompt'] === 'string' ? (e['prompt'] as string) : '';
    if (!name || !role || !prompt.trim()) {
      return { ok: false, code: 'INVALID_CUSTOM_AGENT', error: `Custom agent requires non-empty name, role, prompt (got name='${name}')` };
    }
    if (seen.has(name)) {
      return { ok: false, code: 'DUPLICATE_CUSTOM_AGENT', error: `Duplicate custom agent name '${name}'` };
    }
    seen.add(name);
    const runsAfter =
      typeof e['runsAfter'] === 'string' ? (e['runsAfter'] as string).trim()
      : typeof e['runs_after'] === 'string' ? (e['runs_after'] as string).trim()
      : '';
    const llmIn = (e['llm'] && typeof e['llm'] === 'object') ? e['llm'] as Record<string, unknown> : {};
    const llm: CustomAgentDefinition['llm'] = {};
    if (typeof llmIn['model'] === 'string' && llmIn['model'].trim()) llm.model = llmIn['model'].trim();
    if (typeof llmIn['temperature'] === 'number') {
      if (llmIn['temperature'] < 0 || llmIn['temperature'] > 2) {
        return { ok: false, code: 'INVALID_TEMPERATURE', error: `llm.temperature must be 0..2 for custom agent '${name}'` };
      }
      llm.temperature = llmIn['temperature'];
    }
    if (typeof llmIn['maxTokens'] === 'number' && llmIn['maxTokens'] > 0) {
      llm.maxTokens = Math.floor(llmIn['maxTokens']);
    }
    out.push({
      name, role, goal,
      runsAfter: runsAfter || null,
      llm, prompt,
    });
  }
  // Schedule + cycle check — surface up front so the operator sees a
  // 400 with the scheduler's typed error instead of finding out at
  // dispatch time.
  try {
    scheduleCustomAgents(out);
  } catch (err) {
    return {
      ok: false,
      code: 'INVALID_CUSTOM_AGENT_SCHEDULE',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, patch: out };
}

/**
 * Per-role tool validation. Shared between the agents-patch route
 * (where tools are merged into the same commit as the rest of the
 * agent config) and the deprecated tools-only route (kept for
 * legacy CLI/dashboard callers). The error codes / messages match
 * what the standalone `/tools` route used to return.
 */
function validateToolFields(r: Record<string, unknown>, role: string): ValidationResult<AgentToolConfig> {
  const cfg: AgentToolConfig = {};

  if (r['builtin'] !== undefined) {
    if (!Array.isArray(r['builtin'])) {
      return { ok: false, code: 'INVALID_BUILTIN_TOOLS', error: `tools.builtin must be an array for ${role}` };
    }
    const builtin: BuiltInToolName[] = [];
    for (const t of r['builtin']) {
      if (typeof t !== 'string') {
        return { ok: false, code: 'INVALID_BUILTIN_TOOLS', error: `tools.builtin entries must be strings for ${role}` };
      }
      if (!VALID_BUILTIN_TOOLS.has(t as BuiltInToolName)) {
        return { ok: false, code: 'INVALID_BUILTIN_TOOLS', error: `Unknown built-in tool '${t}' for ${role}. Valid: ${[...VALID_BUILTIN_TOOLS].join(', ')}` };
      }
      builtin.push(t as BuiltInToolName);
    }
    cfg.builtin = builtin;
  }

  if (r['mcp'] !== undefined) {
    if (!Array.isArray(r['mcp'])) {
      return { ok: false, code: 'INVALID_MCP', error: `tools.mcp must be an array for ${role}` };
    }
    const mcp: McpServerConfig[] = [];
    const seen = new Set<string>();
    for (const item of r['mcp']) {
      if (!item || typeof item !== 'object') {
        return { ok: false, code: 'INVALID_MCP', error: `tools.mcp entries must be objects for ${role}` };
      }
      const m = item as Record<string, unknown>;
      const name = typeof m['name'] === 'string' ? m['name'].trim() : '';
      const url = typeof m['url'] === 'string' ? m['url'].trim() : '';
      const tokenFromRaw =
        typeof m['tokenFrom'] === 'string' ? m['tokenFrom']
        : typeof m['token_from'] === 'string' ? m['token_from']
        : '';
      if (!name || !url || !tokenFromRaw) {
        return { ok: false, code: 'INVALID_MCP', error: `MCP entry requires name, url, tokenFrom for ${role}` };
      }
      if (seen.has(name)) {
        return { ok: false, code: 'INVALID_MCP', error: `Duplicate MCP server name '${name}' for ${role}` };
      }
      seen.add(name);
      if (
        !VALID_MCP_TOKEN_SOURCES.includes(tokenFromRaw as 'harness' | 'project_credential')
        && !tokenFromRaw.startsWith('env:')
      ) {
        return { ok: false, code: 'INVALID_MCP', error: `Invalid tokenFrom '${tokenFromRaw}' for ${role}. Valid: harness | project_credential | env:VAR_NAME` };
      }
      mcp.push({ name, url, tokenFrom: tokenFromRaw as McpServerConfig['tokenFrom'] });
    }
    cfg.mcp = mcp;
  }
  return { ok: true, patch: cfg };
}

// ─── Apply helpers — exported so projects.ts POST /:id/config can
// reuse the pipeline path. ──────────────────────────────────────────────────

export async function applyPipelinePatch(
  project: ProjectRecord,
  token: string,
  patch: Partial<HarnessPipelineConfig>,
): Promise<{ harness: Record<string, unknown>; changedFields: string[]; commitSha: string | null }> {
  let changedFields: string[] = [];
  let harnessOut: Record<string, unknown> = {};

  const subject = 'chore: update pipeline [gestalt-admin]';
  const result = await withWorkingClone<Record<string, unknown>>(
    project, token, subject,
    async (workDir) => {
      const harnessPath = join(workDir, 'HARNESS.json');
      const raw = await readFile(harnessPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const current = (parsed['pipeline'] as Record<string, unknown> | undefined) ?? {};
      const patched: Record<string, unknown> = { ...current };
      const changed: string[] = [];
      if (patch.adapter !== undefined && patch.adapter !== current['adapter']) {
        patched['adapter'] = patch.adapter;
        changed.push('adapter');
      }
      if (patch.autoMerge !== undefined && patch.autoMerge !== current['autoMerge']) {
        patched['autoMerge'] = patch.autoMerge;
        changed.push('autoMerge');
      }
      if (patch.mergeMethod !== undefined && patch.mergeMethod !== current['mergeMethod']) {
        patched['mergeMethod'] = patch.mergeMethod;
        changed.push('mergeMethod');
      }
      changedFields = changed;
      harnessOut = parsed;
      if (changed.length === 0) return null; // signal no-change to outer
      parsed['pipeline'] = patched;
      harnessOut = parsed;
      await writeFile(harnessPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      return { touchedFiles: ['HARNESS.json'], payload: parsed };
    },
  );

  return {
    harness: result.payload ?? harnessOut,
    changedFields,
    commitSha: result.commitSha,
  };
}

async function applyAgentsPatch(
  project: ProjectRecord,
  token: string,
  patch: Record<string, Partial<AgentConfig>>,
): Promise<{ agents: AgentsYaml; commitSha: string | null }> {
  let agentsOut: AgentsYaml = {};
  const subject = 'chore: update agents [gestalt-admin]';
  const result = await withWorkingClone<AgentsYaml>(
    project, token, subject,
    async (workDir) => {
      const merged = await mergeAgentsYaml(workDir, (current) => {
        const agents = { ...(current.agents ?? {}) };
        for (const [role, fields] of Object.entries(patch)) {
          const existing = agents[role] ?? {
            role: '',
            goal: '',
            llm: {},
            promptExtensions: [],
          } as AgentConfig;
          // Tools merge: a fields.tools FULLY REPLACES the existing
          // tools block (the dashboard sends the whole intended
          // toolset; partial-merge would be ambiguous about removed
          // entries). Omitting `tools` keeps the existing block
          // unchanged.
          const nextTools = fields.tools !== undefined ? fields.tools : existing.tools;
          agents[role] = {
            role: fields.role ?? existing.role,
            goal: fields.goal ?? existing.goal,
            llm: { ...existing.llm, ...(fields.llm ?? {}) },
            promptExtensions: fields.promptExtensions ?? existing.promptExtensions,
            ...(nextTools ? { tools: nextTools } : {}),
          };
        }
        return { ...current, agents };
      });
      agentsOut = merged;
      const yamlPath = join(workDir, 'agents.yaml');
      await writeFile(yamlPath, stringifyAgentsYaml(merged), 'utf8');
      return { touchedFiles: ['agents.yaml'], payload: merged };
    },
  );
  return { agents: result.payload ?? agentsOut, commitSha: result.commitSha };
}

async function applyCustomAgentsPatch(
  project: ProjectRecord,
  token: string,
  patch: CustomAgentDefinition[],
): Promise<{ agents: AgentsYaml; commitSha: string | null }> {
  let agentsOut: AgentsYaml = {};
  const subject = 'chore: update custom agents [gestalt-admin]';
  const result = await withWorkingClone<AgentsYaml>(
    project, token, subject,
    async (workDir) => {
      const merged = await mergeAgentsYaml(workDir, (current) => {
        const next: AgentsYaml = { ...current };
        // Full replace per the brief. Drop the camelCase variant so we
        // don't end up with two keys representing the same field.
        delete (next as Record<string, unknown>)['customAgents'];
        next.custom_agents = patch.length > 0 ? patch : undefined;
        return next;
      });
      agentsOut = merged;
      // Re-validate against the post-merge yaml as a defensive check
      // (the validator already ran on the patch but the merge could in
      // theory reintroduce something).
      try {
        const tmpAgentsDir = workDir;
        const re = await loadCustomAgents(tmpAgentsDir);
        scheduleCustomAgents(re);
      } catch (err) {
        // Bubble up as a regular error — the route catches and maps
        // to 400 INVALID_CUSTOM_AGENT_SCHEDULE.
        throw new Error(err instanceof Error ? err.message : String(err));
      }
      const yamlPath = join(workDir, 'agents.yaml');
      await writeFile(yamlPath, stringifyAgentsYaml(merged), 'utf8');
      return { touchedFiles: ['agents.yaml'], payload: merged };
    },
  );
  return { agents: result.payload ?? agentsOut, commitSha: result.commitSha };
}

// ─── YAML merge + emit ───────────────────────────────────────────────────────

async function mergeAgentsYaml(
  workDir: string,
  mutate: (current: AgentsYaml) => AgentsYaml,
): Promise<AgentsYaml> {
  let current: AgentsYaml = {};
  try {
    const raw = await readFile(join(workDir, 'agents.yaml'), 'utf8');
    const parsed = parseYaml(raw) as AgentsYaml | null;
    if (parsed && typeof parsed === 'object') current = parsed;
  } catch {
    // No agents.yaml yet — patch builds from an empty shape.
  }
  return mutate(current);
}

/**
 * Emits agents.yaml content. Uses the `yaml` package's default
 * stringify which produces a stable layout. Comments in the existing
 * file are NOT preserved — operators who heavily comment their
 * agents.yaml should be aware that a config-as-code write replaces
 * commentary with the canonical machine output. The file shape stays
 * deterministic: `agents:` first, then `custom_agents:` if present.
 */
function stringifyAgentsYaml(parsed: AgentsYaml): string {
  // Promote our typed fields into a key-ordered output shape.
  const out: Record<string, unknown> = {};
  if (parsed.agents) out['agents'] = serializeAgents(parsed.agents);
  if (parsed.custom_agents && parsed.custom_agents.length > 0) {
    out['custom_agents'] = parsed.custom_agents.map(serializeCustomAgent);
  }
  // 2-space indent matches the seeded template.
  return stringifyYaml(out, { indent: 2, lineWidth: 0 });
}

function serializeAgents(map: Record<string, AgentConfig>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(map)) {
    out[name] = serializeAgentConfig(cfg);
  }
  return out;
}

function serializeAgentConfig(cfg: AgentConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    role: cfg.role,
    goal: cfg.goal,
  };
  const llm: Record<string, unknown> = {};
  if (cfg.llm.model !== undefined) llm['model'] = cfg.llm.model;
  if (cfg.llm.temperature !== undefined) llm['temperature'] = cfg.llm.temperature;
  if (cfg.llm.maxTokens !== undefined) llm['max_tokens'] = cfg.llm.maxTokens;
  if (Object.keys(llm).length > 0) out['llm'] = llm;
  if (cfg.promptExtensions && cfg.promptExtensions.length > 0) {
    out['prompt_extensions'] = cfg.promptExtensions;
  }
  if (cfg.tools) {
    const tools: Record<string, unknown> = {};
    if (cfg.tools.builtin && cfg.tools.builtin.length > 0) tools['builtin'] = cfg.tools.builtin;
    if (cfg.tools.mcp && cfg.tools.mcp.length > 0) {
      tools['mcp'] = cfg.tools.mcp.map((m) => ({
        name: m.name,
        url: m.url,
        token_from: m.tokenFrom,
      }));
    }
    if (Object.keys(tools).length > 0) out['tools'] = tools;
  }
  return out;
}

function serializeCustomAgent(def: CustomAgentDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: def.name,
    role: def.role,
    goal: def.goal,
  };
  if (def.runsAfter) out['runs_after'] = def.runsAfter;
  const llm: Record<string, unknown> = {};
  if (def.llm.model !== undefined) llm['model'] = def.llm.model;
  if (def.llm.temperature !== undefined) llm['temperature'] = def.llm.temperature;
  if (def.llm.maxTokens !== undefined) llm['max_tokens'] = def.llm.maxTokens;
  if (Object.keys(llm).length > 0) out['llm'] = llm;
  out['prompt'] = def.prompt;
  return out;
}

