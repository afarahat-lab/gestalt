/**
 * Agent configuration loader (Step 1 of agent externalisation).
 *
 * Reads `agents.yaml` from the cloned project repo and returns the
 * config for the requested agent role. Designed to be totally
 * non-fatal:
 *
 *   - Missing file → defaults
 *   - Malformed YAML → defaults (debug-logged)
 *   - Missing agent key → defaults
 *   - Partial agent config → fill the gaps with defaults
 *
 * Backward compatibility guarantee: every existing project repo
 * (which has NO agents.yaml today) behaves identically to before
 * this change.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { parse } from 'yaml';
import { createContextLogger } from '@gestalt/core';
import type { AgentConfig, AgentsYaml, CustomAgentDefinition, AgentLlmConfig, AgentToolConfig, McpServerConfig } from '../types';
import type { BuiltInToolName } from '@gestalt/core';

const log = createContextLogger({ module: 'agent-config-loader' });

/**
 * Generic fallback used when neither agents.yaml nor the per-role
 * default table has an entry for the requested role. Prevents a
 * misspelled key (e.g. agents.yaml referencing `coda-agent`) from
 * crashing — the agent still gets a working config.
 */
const GENERIC_FALLBACK: AgentConfig = {
  role: 'Specialist agent',
  goal: 'Complete the assigned task accurately',
  llm: { temperature: 0.2, maxTokens: 4096 },
  promptExtensions: [],
  tools: { builtin: [] },
};

/**
 * The full built-in file-tool set (ADR-038). Used by the per-role
 * defaults for code-agent and context-agent so those agents can
 * discover the existing codebase before generating output.
 */
const ALL_FILE_TOOLS: AgentToolConfig = {
  builtin: ['readFile', 'listDirectory', 'searchFiles', 'getFileTree'],
};

/**
 * Per-agent defaults that ship with the platform. Used when
 * `agents.yaml` is absent OR when it has no entry for the agent.
 * These mirror the seed values written by `gestalt init`
 * (`buildAgentsYaml()` in routes/projects.ts) so existing projects
 * without an agents.yaml committed get the same baseline behaviour
 * the file would supply.
 *
 * Operators tune these via agents.yaml — they shouldn't have to edit
 * this table.
 */
const PER_ROLE_DEFAULTS: Record<string, AgentConfig> = {
  'intent-agent': {
    role: 'Senior software architect',
    goal: 'Extract a precise, unambiguous specification from a natural language intent',
    llm: { temperature: 0.1, maxTokens: 2000 },
    promptExtensions: [],
    tools: { builtin: [] },
  },
  'design-agent': {
    role: 'Senior software architect',
    goal: 'Produce domain model changes, API contracts, and component specs',
    llm: { temperature: 0.2, maxTokens: 4000 },
    promptExtensions: [],
    tools: { builtin: [] },
  },
  'context-agent': {
    role: 'Technical writer',
    goal: 'Keep project context files accurate and up to date',
    llm: { temperature: 0.1, maxTokens: 8000 },
    promptExtensions: [],
    tools: { ...ALL_FILE_TOOLS },
  },
  'code-agent': {
    role: 'Senior TypeScript engineer',
    goal: 'Generate production-quality TypeScript code that follows the project harness',
    llm: { temperature: 0.2, maxTokens: 8000 },
    promptExtensions: [],
    tools: { ...ALL_FILE_TOOLS },
  },
  'test-agent': {
    role: 'Senior QA engineer',
    goal: 'Generate comprehensive Vitest tests mapped to success criteria',
    llm: { temperature: 0.1, maxTokens: 6000 },
    promptExtensions: [],
    tools: { builtin: [] },
  },
  'review-agent': {
    role: 'Senior engineer and code reviewer',
    goal: 'Assess generated code quality and architectural correctness',
    llm: { temperature: 0.1, maxTokens: 4000 },
    promptExtensions: [],
    tools: { builtin: [] },
  },
  'drift-agent': {
    role: 'Technical documentation specialist',
    goal: 'Detect when project documentation has fallen behind the codebase',
    llm: { temperature: 0.1, maxTokens: 2000 },
    promptExtensions: [],
    tools: { builtin: [] },
  },
  'alignment-agent': {
    role: 'Technical documentation specialist',
    goal: 'Ensure project context files are internally consistent',
    llm: { temperature: 0.1, maxTokens: 2000 },
    promptExtensions: [],
    tools: { builtin: [] },
  },
  'context-fixer': {
    role: 'Technical writer',
    goal: 'Apply additive context-file edits that resolve maintenance findings',
    llm: { temperature: 0.2, maxTokens: 8192 },
    promptExtensions: [],
    tools: { builtin: [] },
  },
};

function fallbackFor(agentRole: string): AgentConfig {
  const seeded = PER_ROLE_DEFAULTS[agentRole];
  if (seeded) {
    return {
      ...seeded,
      llm: { ...seeded.llm },
      promptExtensions: [...seeded.promptExtensions],
      tools: { builtin: [...(seeded.tools.builtin ?? [])] },
    };
  }
  return {
    ...GENERIC_FALLBACK,
    llm: { ...GENERIC_FALLBACK.llm },
    promptExtensions: [],
    tools: { builtin: [] },
  };
}

/**
 * Loads agents.yaml from the project root and returns the config for
 * the given agent role. Never throws — falls back to defaults on any
 * failure.
 */
export async function loadAgentConfig(
  projectRoot: string,
  agentRole: string,
): Promise<AgentConfig> {
  const baseline = fallbackFor(agentRole);

  let raw: string;
  try {
    raw = await readFile(join(projectRoot, 'agents.yaml'), 'utf8');
  } catch {
    // Missing file is the common case for existing projects — keep
    // quiet so we don't fill logs with `ENOENT` noise.
    return baseline;
  }

  let parsed: AgentsYaml | undefined;
  try {
    parsed = parse(raw) as AgentsYaml;
  } catch (err) {
    log.debug(
      { agentRole, err: err instanceof Error ? err.message : String(err) },
      'agents.yaml present but failed to parse — using defaults',
    );
    return baseline;
  }

  const entry = parsed?.agents?.[agentRole];
  if (!entry) {
    // File exists and parsed cleanly but this agent isn't listed —
    // common for non-LLM agents (constraint-agent, pr-agent, …) and
    // for ops who only wired up a subset.
    return baseline;
  }

  // Merge with the per-role baseline so a partial entry (only `role`
  // set, no `llm.temperature`, etc.) still yields a sensible config.
  // We also normalise snake_case keys (`max_tokens`,
  // `prompt_extensions`) because the brief's YAML examples use them
  // and operators will copy that shape verbatim.
  const llmIn = (entry.llm ?? {}) as Record<string, unknown>;
  return {
    role: entry.role ?? baseline.role,
    goal: entry.goal ?? baseline.goal,
    llm: {
      ...baseline.llm,
      ...(typeof llmIn['temperature'] === 'number' ? { temperature: llmIn['temperature'] as number } : {}),
      ...(typeof llmIn['maxTokens'] === 'number' ? { maxTokens: llmIn['maxTokens'] as number } : {}),
      ...(typeof llmIn['max_tokens'] === 'number' ? { maxTokens: llmIn['max_tokens'] as number } : {}),
      ...(typeof llmIn['model'] === 'string' ? { model: llmIn['model'] as string } : {}),
    },
    promptExtensions: extractPromptExtensions(entry),
    tools: extractTools(entry, baseline.tools),
  };
}

/**
 * Reads `tools.builtin` from a YAML agent entry. Unknown tool names
 * are dropped (operator typos should not crash a cycle); missing key
 * falls back to the per-role baseline. The set of accepted built-in
 * names is the `BuiltInToolName` union — `@gestalt/core` owns the
 * canonical list.
 */
const VALID_BUILTIN_TOOLS = new Set<BuiltInToolName>([
  'readFile', 'listDirectory', 'searchFiles', 'getFileTree',
]);

function extractTools(entry: AgentConfig, baseline: AgentToolConfig): AgentToolConfig {
  const e = entry as unknown as Record<string, unknown>;
  const toolsKey = e['tools'];
  if (!toolsKey || typeof toolsKey !== 'object') {
    return { builtin: [...(baseline.builtin ?? [])] };
  }
  const toolsRec = toolsKey as Record<string, unknown>;

  const builtinIn = toolsRec['builtin'];
  const builtin = Array.isArray(builtinIn)
    ? builtinIn.filter(
        (s): s is BuiltInToolName => typeof s === 'string' && VALID_BUILTIN_TOOLS.has(s as BuiltInToolName),
      )
    : [...(baseline.builtin ?? [])];

  const mcp = extractMcpServers(toolsRec['mcp']);

  // Only include `mcp` when the operator actually defined something.
  // Empty array would be wire noise for the orchestrator's resolver.
  return mcp.length > 0 ? { builtin, mcp } : { builtin };
}

/**
 * Parses `tools.mcp[]` from YAML (ADR-039). Each entry must have
 * `name`, `url`, and `tokenFrom` (or `token_from` — snake_case is the
 * YAML house style). Invalid entries are dropped silently so an
 * operator typo doesn't crash the cycle — `gestalt agents validate`
 * surfaces parse warnings before any intent submission.
 */
function extractMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return [];
  const out: McpServerConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = rec['name'];
    const url = rec['url'];
    const tokenFromRaw = rec['tokenFrom'] ?? rec['token_from'];
    if (typeof name !== 'string' || !name) continue;
    if (typeof url !== 'string' || !url) continue;
    if (typeof tokenFromRaw !== 'string' || !tokenFromRaw) continue;
    if (
      tokenFromRaw !== 'harness' &&
      tokenFromRaw !== 'project_credential' &&
      !tokenFromRaw.startsWith('env:')
    ) continue;
    out.push({
      name,
      url,
      tokenFrom: tokenFromRaw as McpServerConfig['tokenFrom'],
    });
  }
  return out;
}

function extractPromptExtensions(entry: AgentConfig): string[] {
  const e = entry as unknown as Record<string, unknown>;
  const camel = e['promptExtensions'];
  if (Array.isArray(camel)) return camel.filter((s): s is string => typeof s === 'string');
  const snake = e['prompt_extensions'];
  if (Array.isArray(snake)) return snake.filter((s): s is string => typeof s === 'string');
  return [];
}

/**
 * Exposed for tests + advanced wiring. Returns the per-role baseline
 * (matching what the seeded agents.yaml would specify) — falling
 * back to the generic config only for unknown roles. Most callers
 * should use `loadAgentConfig` and let the loader manage merging.
 */
export const defaultAgentConfig = (agentRole?: string): AgentConfig =>
  agentRole ? fallbackFor(agentRole) : { ...GENERIC_FALLBACK, llm: { ...GENERIC_FALLBACK.llm }, promptExtensions: [] };

// ─── Custom agents (Step 2 — ADR-037) ────────────────────────────────────────

/**
 * Loads project-defined custom agent definitions from
 * `<projectRoot>/agents.yaml` under the `custom_agents:` (or
 * `customAgents:`) key. Same non-fatal contract as `loadAgentConfig`
 * — missing / malformed file / missing key all return an empty list.
 *
 * Each entry is normalised (snake_case → camelCase, llm tuning merged
 * with sensible defaults) and validated (`name`, `role`, `prompt`
 * required). Invalid entries are dropped with a debug log.
 */
export async function loadCustomAgents(
  projectRoot: string,
): Promise<CustomAgentDefinition[]> {
  let raw: string;
  try {
    raw = await readFile(join(projectRoot, 'agents.yaml'), 'utf8');
  } catch {
    return [];
  }
  let parsed: AgentsYaml | undefined;
  try {
    parsed = parse(raw) as AgentsYaml;
  } catch (err) {
    log.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'agents.yaml present but failed to parse — no custom agents loaded',
    );
    return [];
  }

  // Accept both `custom_agents` (snake_case, brief's YAML examples)
  // and `customAgents` (camelCase). The runtime type uses camelCase.
  const raw_defs =
    (parsed as unknown as Record<string, unknown>)['custom_agents']
    ?? (parsed as unknown as Record<string, unknown>)['customAgents']
    ?? [];
  if (!Array.isArray(raw_defs)) {
    log.debug('agents.yaml custom_agents key is not an array — ignoring');
    return [];
  }

  const normalised: CustomAgentDefinition[] = [];
  for (const entry of raw_defs) {
    const def = normaliseCustomAgent(entry);
    if (!def) continue;
    if (!isValidCustomAgent(def)) {
      log.debug({ name: def.name }, 'custom agent definition invalid — skipping');
      continue;
    }
    normalised.push(def);
  }
  return normalised;
}

function normaliseCustomAgent(input: unknown): CustomAgentDefinition | null {
  if (!input || typeof input !== 'object') return null;
  const e = input as Record<string, unknown>;
  const name = typeof e['name'] === 'string' ? (e['name'] as string).trim() : '';
  const role = typeof e['role'] === 'string' ? (e['role'] as string).trim() : '';
  const goal = typeof e['goal'] === 'string' ? (e['goal'] as string).trim() : '';
  const prompt = typeof e['prompt'] === 'string' ? (e['prompt'] as string) : '';
  const runsAfter =
    typeof e['runsAfter'] === 'string' ? (e['runsAfter'] as string)
    : typeof e['runs_after'] === 'string' ? (e['runs_after'] as string)
    : undefined;
  const llmIn = (e['llm'] ?? {}) as Record<string, unknown>;
  const llm: AgentLlmConfig = {
    ...(typeof llmIn['temperature'] === 'number' ? { temperature: llmIn['temperature'] as number } : {}),
    ...(typeof llmIn['maxTokens'] === 'number' ? { maxTokens: llmIn['maxTokens'] as number } : {}),
    ...(typeof llmIn['max_tokens'] === 'number' ? { maxTokens: llmIn['max_tokens'] as number } : {}),
    ...(typeof llmIn['model'] === 'string' ? { model: llmIn['model'] as string } : {}),
  };
  return {
    name,
    role,
    goal,
    // null (not undefined) when absent — scheduler keys off this
    // to apply the `test-agent` default. Matches the brief's shape.
    runsAfter: runsAfter && runsAfter.trim() ? runsAfter.trim() : null,
    llm,
    prompt,
  };
}

function isValidCustomAgent(def: CustomAgentDefinition): boolean {
  return Boolean(def.name?.trim() && def.role?.trim() && def.prompt?.trim());
}
