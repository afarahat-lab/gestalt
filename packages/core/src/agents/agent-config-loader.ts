/**
 * Agent configuration loader.
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
 *
 * Moved to `@gestalt/core` from `@gestalt/agents-generate` in
 * 2026-06-02. The generate package re-exports for back-compat.
 * `PER_ROLE_DEFAULTS` was simultaneously expanded to cover the gate
 * (`review-agent`) and maintenance (`drift-agent`,
 * `alignment-agent`, `context-fixer`) layers — those agents now get
 * the file-tool subset by default so they can read the cloned tree
 * during reasoning (ADR-038 + Amendment 2026-06).
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { parse } from 'yaml';
import { createContextLogger } from '../logger/index';
import type {
  AgentConfig, AgentLlmConfig, AgentsYaml,
  AgentToolConfig, McpServerConfig,
  CustomAgentDefinition,
} from './agent-config';
import type { BuiltInToolName } from '../types';

const log = createContextLogger({ module: 'agent-config-loader' });

/**
 * Generic fallback used when neither agents.yaml nor the per-role
 * default table has an entry for the requested role.
 */
const GENERIC_FALLBACK: AgentConfig = {
  role: 'Specialist agent',
  goal: 'Complete the assigned task accurately',
  llm: { temperature: 0.2, maxTokens: 4096 },
  promptExtensions: [],
  tools: { builtin: [] },
};

/** Full file-tool set (ADR-038). */
const ALL_FILE_TOOLS: AgentToolConfig = {
  builtin: ['readFile', 'listDirectory', 'searchFiles', 'getFileTree'],
};

/** review-agent + context-fixer get a narrower subset because they
 *  work primarily off the artifact set in the LLM message — they
 *  use `readFile` for spot-checks but don't need to enumerate the
 *  tree. */
const READ_ONLY_TOOLS: AgentToolConfig = {
  builtin: ['readFile', 'searchFiles'],
};

/** context-fixer's pared-down set — just enough to verify the
 *  current state of the file it's about to edit. */
const CONTEXT_FIXER_TOOLS: AgentToolConfig = {
  builtin: ['readFile', 'listDirectory'],
};

/**
 * Per-agent defaults that ship with the platform. Used when
 * `agents.yaml` is absent OR when it has no entry for the agent.
 * Covers every LLM-using framework agent across generate, gate, and
 * maintenance layers (Amendment 2026-06).
 *
 * Operators tune these via agents.yaml — they shouldn't have to edit
 * this table.
 */
const PER_ROLE_DEFAULTS: Record<string, AgentConfig> = {
  // ─── Generate layer ───────────────────────────────────────────
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
  // ─── Gate layer (Amendment 2026-06: tools enabled) ────────────
  'review-agent': {
    role: 'Senior engineer and code reviewer',
    goal: 'Assess generated code quality and architectural correctness',
    llm: { temperature: 0.1, maxTokens: 4000 },
    promptExtensions: [],
    tools: { ...READ_ONLY_TOOLS },
  },
  // ─── Maintenance layer (Amendment 2026-06: tools enabled) ─────
  'drift-agent': {
    role: 'Technical documentation specialist',
    goal: 'Detect when project documentation has fallen behind the codebase',
    llm: { temperature: 0.1, maxTokens: 2000 },
    promptExtensions: [],
    tools: { ...ALL_FILE_TOOLS },
  },
  'alignment-agent': {
    role: 'Technical documentation specialist',
    goal: 'Ensure project context files are internally consistent',
    llm: { temperature: 0.1, maxTokens: 2000 },
    promptExtensions: [],
    tools: { ...ALL_FILE_TOOLS },
  },
  'context-fixer': {
    role: 'Technical writer',
    goal: 'Apply additive context-file edits that resolve maintenance findings',
    llm: { temperature: 0.2, maxTokens: 8192 },
    promptExtensions: [],
    tools: { ...CONTEXT_FIXER_TOOLS },
  },
};

function fallbackFor(agentRole: string): AgentConfig {
  const seeded = PER_ROLE_DEFAULTS[agentRole];
  if (seeded) {
    return {
      ...seeded,
      llm: { ...seeded.llm },
      promptExtensions: [...seeded.promptExtensions],
      tools: cloneTools(seeded.tools),
    };
  }
  return {
    ...GENERIC_FALLBACK,
    llm: { ...GENERIC_FALLBACK.llm },
    promptExtensions: [],
    tools: { builtin: [] },
  };
}

function cloneTools(tools: AgentToolConfig | undefined): AgentToolConfig {
  if (!tools) return { builtin: [] };
  return {
    builtin: [...(tools.builtin ?? [])],
    ...(tools.mcp ? { mcp: tools.mcp.map((m) => ({ ...m })) } : {}),
  };
}

/**
 * Loads agents.yaml from the project root and returns the config
 * for the given agent role. Never throws — falls back to defaults
 * on any failure.
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
    return baseline;
  }

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
    tools: extractTools(entry, baseline.tools ?? { builtin: [] }),
  };
}

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

  return mcp.length > 0 ? { builtin, mcp } : { builtin };
}

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
 * Per-role baseline lookup. Exposed for tests + advanced wiring.
 */
export const defaultAgentConfig = (agentRole?: string): AgentConfig =>
  agentRole ? fallbackFor(agentRole) : {
    ...GENERIC_FALLBACK,
    llm: { ...GENERIC_FALLBACK.llm },
    promptExtensions: [],
  };

// ─── Custom agents (ADR-037) ───────────────────────────────────

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
    runsAfter: runsAfter && runsAfter.trim() ? runsAfter.trim() : null,
    llm,
    prompt,
  };
}

function isValidCustomAgent(def: CustomAgentDefinition): boolean {
  return Boolean(def.name?.trim() && def.role?.trim() && def.prompt?.trim());
}
