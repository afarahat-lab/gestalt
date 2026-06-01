/**
 * Agents routes — read + validate `agents.yaml` from the project repo.
 *
 *   GET /projects/:id/agents
 *     Returns a list of all configured framework agents (with their
 *     model override, if any) plus any custom agents defined under
 *     `custom_agents:` (ADR-037).
 *
 *   GET /projects/:id/agents/validate
 *     Reads `agents.yaml` and returns `{ valid, warnings, customAgents }`.
 *     Validation never fails the response — bad YAML returns 200 with
 *     `valid: false` + a warning so the CLI can render it.
 *
 * Both endpoints do a SHALLOW clone (`--depth 1`) into a temp dir,
 * read `agents.yaml`, then clean the dir in `finally`. The PAT lookup
 * mirrors the init-harness handler.
 */

import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';
import { parse as parseYaml } from 'yaml';
import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger, type ProjectRecord,
} from '@gestalt/core';
import {
  loadCustomAgents, defaultAgentConfig,
} from '@gestalt/agents-generate';
import type {
  CustomAgentDefinition, AgentConfig, AgentsYaml,
} from '@gestalt/agents-generate';
import { requireRole } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:agents' });

const FRAMEWORK_LLM_AGENTS = [
  'intent-agent', 'design-agent', 'context-agent', 'code-agent',
  'test-agent', 'review-agent', 'drift-agent', 'alignment-agent',
  'context-fixer',
] as const;

interface AgentSummary {
  name: string;
  role: string;
  goal: string;
  modelOverride: string | null;
  temperature: number | null;
  maxTokens: number | null;
  promptExtensionCount: number;
  /**
   * ADR-038 — resolved built-in tool list. Empty array for agents
   * whose `agents.yaml` `tools.builtin` is empty or absent; the four
   * built-in file tool names when the agent has full access.
   */
  builtinTools: string[];
}

function authenticatedGitUrl(gitUrl: string, token: string): string {
  if (!gitUrl.startsWith('http://') && !gitUrl.startsWith('https://')) return gitUrl;
  const url = new URL(gitUrl);
  url.username = 'x-access-token';
  url.password = token;
  return url.toString();
}

async function shallowReadAgentsYaml(
  project: ProjectRecord,
  token: string,
): Promise<string | null> {
  const workDir = await mkdtemp(join(tmpdir(), `gestalt-agents-${project.id}-`));
  try {
    await simpleGit().clone(authenticatedGitUrl(project.gitUrl, token), workDir, ['--depth', '1']);
    try {
      return await readFile(join(workDir, 'agents.yaml'), 'utf8');
    } catch {
      // File absent — operator hasn't set up agents.yaml yet.
      return null;
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {

  app.get<{ Params: { id: string } }>(
    '/projects/:id/agents',
    { preHandler: requireRole('viewer') },
    async (request, reply) => {
      const { projects } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const token = await projects.getCredential(project.id);
      if (!token) return reply.code(400).send({ error: 'Project has no Git credential on file' });

      let yamlRaw: string | null = null;
      try {
        yamlRaw = await shallowReadAgentsYaml(project, token);
      } catch (err) {
        log.warn({ err, projectId: project.id }, 'agents.yaml shallow read failed');
        return reply.code(500).send({ error: 'Failed to read agents.yaml from repo' });
      }

      // Per-agent summaries always present — framework defaults
      // shipped with the platform mean every agent has something to
      // show, even when the project has no agents.yaml.
      const frameworkAgents: AgentSummary[] = FRAMEWORK_LLM_AGENTS.map((role) =>
        buildAgentSummary(role, yamlRaw),
      );

      // Custom agents only present when the project defined any.
      let customAgents: CustomAgentDefinition[] = [];
      if (yamlRaw !== null) {
        // Use the loader's filesystem-based shape via a temp dir round
        // trip. Avoids re-implementing the YAML normalisation surface
        // here — loadCustomAgents reads `<projectRoot>/agents.yaml`.
        const tmp = await mkdtemp(join(tmpdir(), `gestalt-agents-parse-`));
        try {
          await Promise.resolve(); // ensure tmp dir mkdtemp resolved
          const fs = await import('fs/promises');
          await fs.writeFile(join(tmp, 'agents.yaml'), yamlRaw, 'utf8');
          customAgents = await loadCustomAgents(tmp);
        } finally {
          await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        }
      }

      return reply.send({
        data: {
          frameworkAgents,
          customAgents,
        },
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/projects/:id/agents/validate',
    { preHandler: requireRole('viewer') },
    async (request, reply) => {
      const { projects } = getRepositories();
      const project = await projects.findById(request.params.id);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      const token = await projects.getCredential(project.id);
      if (!token) return reply.code(400).send({ error: 'Project has no Git credential on file' });

      const warnings: string[] = [];
      let yamlRaw: string | null = null;
      try {
        yamlRaw = await shallowReadAgentsYaml(project, token);
      } catch (err) {
        return reply.code(500).send({
          error: 'Failed to read agents.yaml from repo',
          details: err instanceof Error ? err.message : String(err),
        });
      }

      if (yamlRaw === null) {
        return reply.send({
          data: {
            valid: true,
            warnings: ['agents.yaml not present — platform defaults apply'],
            customAgents: 0,
          },
        });
      }

      let parsed: AgentsYaml | null = null;
      try {
        parsed = parseYaml(yamlRaw) as AgentsYaml;
      } catch (err) {
        return reply.send({
          data: {
            valid: false,
            warnings: [`agents.yaml parse error: ${err instanceof Error ? err.message : String(err)}`],
            customAgents: 0,
          },
        });
      }

      if (!parsed || typeof parsed !== 'object' || !parsed.agents) {
        warnings.push('agents.yaml present but has no "agents" key — defaults will be used');
      }

      // Count custom agents using the loader's validation contract.
      let customAgentsCount = 0;
      try {
        const tmp = await mkdtemp(join(tmpdir(), `gestalt-agents-parse-`));
        try {
          const fs = await import('fs/promises');
          await fs.writeFile(join(tmp, 'agents.yaml'), yamlRaw, 'utf8');
          const defs = await loadCustomAgents(tmp);
          customAgentsCount = defs.length;
        } finally {
          await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        }
      } catch {
        warnings.push('Could not parse custom_agents block');
      }

      // Raw count of custom agents in the YAML for diagnostic — if
      // some were dropped by the validator we surface the difference.
      const rawDefs = (parsed as unknown as Record<string, unknown>)['custom_agents']
        ?? (parsed as unknown as Record<string, unknown>)['customAgents'];
      const rawCount = Array.isArray(rawDefs) ? rawDefs.length : 0;
      if (rawCount > customAgentsCount) {
        warnings.push(
          `${rawCount - customAgentsCount} custom agent definition(s) skipped — ` +
          `missing required fields (name, role, prompt)`,
        );
      }

      return reply.send({
        data: {
          valid: warnings.length === 0,
          warnings,
          customAgents: customAgentsCount,
        },
      });
    },
  );
}

function buildAgentSummary(role: string, yamlRaw: string | null): AgentSummary {
  // Default values come from the loader's per-role baseline — the
  // same values an agent would get if agents.yaml were absent. When
  // the YAML is present we merge operator overrides on top using the
  // same normalisation the loader does (snake_case → camelCase).
  const baseline: AgentConfig = defaultAgentConfig(role);
  let merged: AgentConfig = baseline;
  if (yamlRaw !== null) {
    try {
      const parsed = parseYaml(yamlRaw) as AgentsYaml | null;
      const entry = (parsed?.agents ?? {})[role] as unknown;
      if (entry && typeof entry === 'object') {
        merged = mergeAgentEntry(baseline, entry as Record<string, unknown>);
      }
    } catch {
      // already accounted for by the validate endpoint; ignore here
    }
  }

  return {
    name: role,
    role: merged.role,
    goal: merged.goal,
    modelOverride: merged.llm.model ?? null,
    temperature: merged.llm.temperature ?? null,
    maxTokens: merged.llm.maxTokens ?? null,
    promptExtensionCount: merged.promptExtensions.length,
    builtinTools: merged.tools?.builtin ?? [],
  };
}

function mergeAgentEntry(baseline: AgentConfig, entry: Record<string, unknown>): AgentConfig {
  const llmIn = (entry['llm'] ?? {}) as Record<string, unknown>;
  const extIn =
    Array.isArray(entry['promptExtensions']) ? (entry['promptExtensions'] as unknown[])
    : Array.isArray(entry['prompt_extensions']) ? (entry['prompt_extensions'] as unknown[])
    : null;
  return {
    role: typeof entry['role'] === 'string' ? (entry['role'] as string) : baseline.role,
    goal: typeof entry['goal'] === 'string' ? (entry['goal'] as string) : baseline.goal,
    llm: {
      ...baseline.llm,
      ...(typeof llmIn['temperature'] === 'number' ? { temperature: llmIn['temperature'] as number } : {}),
      ...(typeof llmIn['maxTokens'] === 'number' ? { maxTokens: llmIn['maxTokens'] as number } : {}),
      ...(typeof llmIn['max_tokens'] === 'number' ? { maxTokens: llmIn['max_tokens'] as number } : {}),
      ...(typeof llmIn['model'] === 'string' ? { model: llmIn['model'] as string } : {}),
    },
    promptExtensions: extIn
      ? extIn.filter((s): s is string => typeof s === 'string')
      : baseline.promptExtensions,
    // ADR-038 — resolve `tools.builtin` from the YAML entry when
    // present (operator override), else fall through to the per-role
    // baseline. The summary endpoint surfaces this so `gestalt agents
    // list` shows the effective tool set.
    tools: extractToolsFromEntry(entry, baseline.tools),
  };
}

function extractToolsFromEntry(
  entry: Record<string, unknown>,
  baselineTools: AgentConfig['tools'],
): AgentConfig['tools'] {
  const toolsKey = entry['tools'];
  if (!toolsKey || typeof toolsKey !== 'object') {
    return { builtin: [...(baselineTools?.builtin ?? [])] };
  }
  const builtinIn = (toolsKey as Record<string, unknown>)['builtin'];
  if (!Array.isArray(builtinIn)) {
    return { builtin: [...(baselineTools?.builtin ?? [])] };
  }
  const validNames = new Set(['readFile', 'listDirectory', 'searchFiles', 'getFileTree']);
  return {
    builtin: builtinIn.filter(
      (s): s is 'readFile' | 'listDirectory' | 'searchFiles' | 'getFileTree' =>
        typeof s === 'string' && validNames.has(s),
    ),
  };
}
