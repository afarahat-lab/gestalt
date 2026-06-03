/**
 * gestalt project — per-project administration (config-as-code).
 *
 *   gestalt project config show                — read all six sections
 *   gestalt project config set-agent <role>    — patch one framework agent
 *   gestalt project config add-custom-agent    — interactive add
 *   gestalt project config remove-custom-agent <name>
 *   gestalt project config set-tools <role>    — toggle built-ins + MCP
 *   gestalt project config set-pipeline        — adapter / auto-merge / method
 *   gestalt project members list / add / remove / role
 *
 * Every write goes through the new PATCH endpoints which clone the
 * project repo, edit `HARNESS.json` or `agents.yaml`, commit with
 * `chore: update <section> [gestalt-admin]`, and push to
 * `defaultBranch`. Audit row written server-side.
 *
 * The singular `project` parent is INTENTIONAL — it coexists with the
 * plural `projects` (which is for cross-project listing /
 * switching / set-adapter). Per the brief: per-project administration
 * lives here.
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  GestaltApiClient,
  type EditableAgentConfig, type ProjectConfigCustomAgent,
  type ProjectConfigAgentsYaml,
} from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import {
  printConnectionError, isConnectivityError, handleMembershipForbidden,
} from '../ui/server-errors';
import {
  c, blank, divider, printTable, prompt, confirm,
} from '../ui/prompts';

interface BaseOptions { server?: string; project?: string }

const VALID_AGENT_ROLES = new Set([
  'intent-agent', 'design-agent', 'context-agent', 'lint-config-agent',
  'code-agent', 'test-agent', 'review-agent', 'drift-agent',
  'alignment-agent', 'context-fixer',
]);

const VALID_BUILTIN_TOOLS = new Set([
  'readFile', 'listDirectory', 'searchFiles', 'getFileTree',
]);

const VALID_PROJECT_ROLES = new Set(['project-admin', 'editor', 'reader']);

// ─── config show ─────────────────────────────────────────────────────────────

export async function projectConfigShowCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, projectId, projectName, serverUrl } = ctx;
  try {
    const res = await client.getProjectConfig(projectId);
    renderConfigSummary(projectName, res.data.harness, res.data.agents);
    // Members live on a separate endpoint — fetch + render.
    const members = await client.listProjectMembers(projectId).catch(() => ({ data: [] }));
    blank();
    console.log(c.bold(`Members (${members.data.length})`));
    divider();
    for (const m of members.data) {
      const role = projectRoleBadge(m.projectRole);
      console.log(`  ${m.email.padEnd(36)} ${role}`);
    }
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to read project config');
  }
}

function renderConfigSummary(
  projectName: string,
  harness: Record<string, unknown>,
  agents: ProjectConfigAgentsYaml,
): void {
  blank();
  console.log(c.bold(`Project config — ${projectName}`));
  divider();

  // Pipeline
  const pipeline = (harness['pipeline'] as Record<string, unknown> | undefined) ?? {};
  console.log(c.bold('Pipeline'));
  console.log(`  ${c.dim('Adapter:'.padEnd(18))} ${pipeline['adapter'] ?? c.dim('(unset → noop)')}`);
  console.log(`  ${c.dim('Auto-merge:'.padEnd(18))} ${pipeline['autoMerge'] === true ? c.success('true') : c.dim('false')}`);
  console.log(`  ${c.dim('Merge method:'.padEnd(18))} ${pipeline['mergeMethod'] ?? c.dim('squash (default)')}`);
  blank();

  // Agents
  const frameworkAgents = Object.entries(agents.agents ?? {});
  console.log(c.bold(`Agents (${frameworkAgents.length} configured)`));
  if (frameworkAgents.length === 0) {
    console.log(c.dim('  No agents in agents.yaml — platform defaults apply.'));
  } else {
    for (const [name, cfg] of frameworkAgents) {
      const model = cfg.llm.model ?? c.dim('(default)');
      const temp = cfg.llm.temperature ?? c.dim('-');
      const tokens = (cfg.llm.maxTokens ?? cfg.llm.max_tokens) ?? c.dim('-');
      const toolCount = cfg.tools?.builtin?.length ?? 0;
      const ext = (cfg.promptExtensions ?? cfg.prompt_extensions ?? []).length;
      console.log(
        `  ${c.agent(name.padEnd(20))} ${c.dim('model:')} ${String(model).padEnd(18)} ` +
        `${c.dim('temp:')} ${String(temp).padEnd(6)} ${c.dim('tokens:')} ${String(tokens).padEnd(6)} ` +
        `${c.dim('tools:')} ${toolCount} ${c.dim('ext:')} ${ext}`,
      );
    }
  }
  blank();

  // Custom agents
  const customs = agents.custom_agents ?? agents.customAgents ?? [];
  console.log(c.bold(`Custom agents (${customs.length})`));
  if (customs.length === 0) {
    console.log(c.dim('  None declared. Add via: gestalt project config add-custom-agent'));
  } else {
    for (const ca of customs) {
      const runsAfter = ca.runsAfter ?? ca.runs_after ?? 'test-agent';
      console.log(`  ${c.agent(ca.name.padEnd(28))} ${c.dim('runs_after:')} ${runsAfter}`);
    }
  }
}

// ─── config set-agent ────────────────────────────────────────────────────────

export interface SetAgentOptions extends BaseOptions {
  model?: string;
  temperature?: string;
  maxTokens?: string;
  role?: string;
  goal?: string;
  addExtension?: string;
  removeExtension?: string;
  // Tools — merged into the agent's tools block. Session 3 absorbed
  // the standalone set-tools surface into set-agent because tool
  // assignment IS agent config.
  builtin?: string;          // comma-separated list of built-in tools
  addMcp?: string;            // MCP server name to add (pair with --mcp-url)
  mcpUrl?: string;            // URL for the MCP server being added
  tokenFrom?: string;         // tokenFrom source for the MCP entry
  removeMcp?: string;         // MCP server name to remove
}

export async function projectConfigSetAgentCommand(
  agentRole: string,
  options: SetAgentOptions = {},
): Promise<void> {
  if (!VALID_AGENT_ROLES.has(agentRole)) {
    console.log(c.error(`Unknown agent '${agentRole}'. Valid: ${[...VALID_AGENT_ROLES].join(', ')}`));
    process.exit(1);
  }
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, projectId, serverUrl } = ctx;

  // Read current config so we can merge prompt-extension changes
  // additively (the brief's --add-extension / --remove-extension
  // semantics).
  let current: EditableAgentConfig | undefined;
  try {
    const res = await client.getProjectConfig(projectId);
    current = res.data.agents.agents?.[agentRole];
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to read current agent config');
    return;
  }

  const patch: Partial<EditableAgentConfig> = {};
  if (options.role) patch.role = options.role;
  if (options.goal) patch.goal = options.goal;
  if (options.model || options.temperature || options.maxTokens) {
    patch.llm = {};
    if (options.model) patch.llm.model = options.model === '~' ? undefined : options.model;
    if (options.temperature) {
      const t = parseFloat(options.temperature);
      if (Number.isNaN(t) || t < 0 || t > 2) {
        console.log(c.error('--temperature must be a number between 0 and 2'));
        process.exit(1);
      }
      patch.llm.temperature = t;
    }
    if (options.maxTokens) {
      const m = parseInt(options.maxTokens, 10);
      if (Number.isNaN(m) || m <= 0) {
        console.log(c.error('--max-tokens must be a positive integer'));
        process.exit(1);
      }
      patch.llm.maxTokens = m;
    }
  }

  // Prompt extensions — add/remove by index against the current list.
  if (options.addExtension !== undefined || options.removeExtension !== undefined) {
    const existing = current?.promptExtensions ?? current?.prompt_extensions ?? [];
    const next = [...existing];
    if (options.addExtension !== undefined) {
      if (!options.addExtension.trim()) {
        console.log(c.error('--add-extension requires non-empty text'));
        process.exit(1);
      }
      next.push(options.addExtension);
    }
    if (options.removeExtension !== undefined) {
      const idx = parseInt(options.removeExtension, 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= next.length) {
        console.log(c.error(`--remove-extension index out of range (have ${next.length} extensions)`));
        process.exit(1);
      }
      next.splice(idx, 1);
    }
    patch.promptExtensions = next;
  }

  // Tools — built-in toggles + MCP add/remove. The server expects the
  // WHOLE tools block (any field omitted is "no change"), so we read
  // the current tools, apply incremental changes, then send the
  // result as a single patch.tools.
  if (
    options.builtin !== undefined
    || options.addMcp !== undefined
    || options.removeMcp !== undefined
  ) {
    const existingBuiltin = current?.tools?.builtin ?? [];
    const existingMcp = (current?.tools?.mcp ?? []).map((m) => ({
      name: m.name,
      url: m.url,
      tokenFrom: m.tokenFrom ?? m.token_from ?? 'project_credential',
    }));
    const nextTools: { builtin: string[]; mcp: Array<{ name: string; url: string; tokenFrom: string }> } = {
      builtin: [...existingBuiltin],
      mcp: [...existingMcp],
    };

    if (options.builtin !== undefined) {
      const tools = options.builtin.split(',').map((s) => s.trim()).filter(Boolean);
      for (const t of tools) {
        if (!VALID_BUILTIN_TOOLS.has(t)) {
          console.log(c.error(`Unknown built-in tool '${t}'. Valid: ${[...VALID_BUILTIN_TOOLS].join(', ')}`));
          process.exit(1);
        }
      }
      nextTools.builtin = tools;
    }

    if (options.addMcp) {
      if (!options.mcpUrl) {
        console.log(c.error('--add-mcp <name> requires --mcp-url <url>'));
        process.exit(1);
      }
      const tokenFrom = options.tokenFrom ?? 'project_credential';
      if (
        tokenFrom !== 'project_credential'
        && tokenFrom !== 'harness'
        && !tokenFrom.startsWith('env:')
      ) {
        console.log(c.error(`--token-from must be 'project_credential' | 'harness' | 'env:VAR_NAME'`));
        process.exit(1);
      }
      if (nextTools.mcp.some((m) => m.name === options.addMcp)) {
        console.log(c.error(`MCP server '${options.addMcp}' already configured for this agent`));
        process.exit(1);
      }
      nextTools.mcp.push({ name: options.addMcp, url: options.mcpUrl, tokenFrom });
    }
    if (options.removeMcp) {
      if (!nextTools.mcp.some((m) => m.name === options.removeMcp)) {
        console.log(c.error(`No MCP server named '${options.removeMcp}' on this agent`));
        process.exit(1);
      }
      nextTools.mcp = nextTools.mcp.filter((m) => m.name !== options.removeMcp);
    }

    patch.tools = nextTools;
  }

  if (Object.keys(patch).length === 0) {
    console.log(c.error(
      'No changes supplied. Use --model / --temperature / --max-tokens / --role / --goal / ' +
      '--add-extension / --remove-extension / --builtin / --add-mcp / --remove-mcp',
    ));
    process.exit(1);
  }

  try {
    await client.patchAgentsConfig(projectId, { [agentRole]: patch });
    blank();
    console.log(c.success(`✓ ${agentRole} updated and committed`));
    console.log(c.dim('  Run `git pull` to receive the agents.yaml update locally.'));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to update ${agentRole}`);
  }
}

// ─── config add-custom-agent ─────────────────────────────────────────────────

export async function projectConfigAddCustomAgentCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, projectId, serverUrl } = ctx;

  // Read current customs so we can validate name uniqueness + offer
  // an autocomplete list for runs_after.
  let existing: ProjectConfigCustomAgent[] = [];
  try {
    const res = await client.getProjectConfig(projectId);
    existing = res.data.agents.custom_agents ?? res.data.agents.customAgents ?? [];
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to read current custom agents');
    return;
  }

  blank();
  console.log(c.bold('Add a custom agent'));
  divider();
  const name = (await prompt('Agent name (kebab-case, ends with -agent):')).trim();
  if (!name) { console.log(c.error('Name required')); process.exit(1); }
  if (existing.some((d) => d.name === name)) {
    console.log(c.error(`A custom agent named '${name}' already exists`));
    process.exit(1);
  }
  const role = (await prompt('Role (e.g. "Senior code reviewer"):')).trim();
  if (!role) { console.log(c.error('Role required')); process.exit(1); }
  const goal = (await prompt('Goal (short description):')).trim();
  const runsAfterRaw = (await prompt(`Runs after (default: test-agent):`)).trim();
  const runsAfter = runsAfterRaw || 'test-agent';
  const model = (await prompt('LLM model (blank for platform default):')).trim();
  const temperatureRaw = (await prompt('Temperature (default 0.1):')).trim();
  const promptText = await openEditorForPrompt();

  const def: ProjectConfigCustomAgent = {
    name, role, goal,
    runsAfter,
    llm: {
      ...(model ? { model } : {}),
      ...(temperatureRaw ? { temperature: parseFloat(temperatureRaw) } : { temperature: 0.1 }),
    },
    prompt: promptText,
  };

  try {
    const next = [...existing, def];
    await client.patchCustomAgentsConfig(projectId, next);
    blank();
    console.log(c.success(`✓ ${name} added and committed`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to add ${name}`);
  }
}

export async function projectConfigRemoveCustomAgentCommand(
  name: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, projectId, serverUrl } = ctx;

  let existing: ProjectConfigCustomAgent[] = [];
  try {
    const res = await client.getProjectConfig(projectId);
    existing = res.data.agents.custom_agents ?? res.data.agents.customAgents ?? [];
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to read current custom agents');
    return;
  }
  if (!existing.some((d) => d.name === name)) {
    console.log(c.error(`No custom agent named '${name}' in this project.`));
    process.exit(1);
  }
  if (!await confirm(`Remove ${name} from the project repo?`)) {
    console.log(c.dim('Aborted.'));
    return;
  }
  try {
    const next = existing.filter((d) => d.name !== name);
    await client.patchCustomAgentsConfig(projectId, next);
    blank();
    console.log(c.success(`✓ ${name} removed and committed`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to remove ${name}`);
  }
}

// ─── config set-tools (deprecated — alias for set-agent) ────────────────────

export interface SetToolsOptions extends BaseOptions {
  builtin?: string;
  addMcp?: string;
  mcpUrl?: string;
  tokenFrom?: string;
  removeMcp?: string;
}

/**
 * Session 3 — `gestalt project config set-tools` is now a thin alias
 * over `set-agent`. Tool assignment IS agent config; the dashboard's
 * standalone Tools tab merged into the Agents tab and the server's
 * `/config/tools` endpoint was removed. The interface is preserved
 * so existing scripts keep working.
 */
export async function projectConfigSetToolsCommand(
  agentRole: string,
  options: SetToolsOptions = {},
): Promise<void> {
  await projectConfigSetAgentCommand(agentRole, {
    server: options.server,
    project: options.project,
    builtin: options.builtin,
    addMcp: options.addMcp,
    mcpUrl: options.mcpUrl,
    tokenFrom: options.tokenFrom,
    removeMcp: options.removeMcp,
  });
}

// ─── config set-pipeline ─────────────────────────────────────────────────────

export interface SetPipelineOptions extends BaseOptions {
  adapter?: string;
  autoMerge?: boolean;     // Commander expands `--auto-merge`/`--no-auto-merge`
  mergeMethod?: string;
}

export async function projectConfigSetPipelineCommand(
  options: SetPipelineOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, projectId, serverUrl } = ctx;

  const patch: { adapter?: string; autoMerge?: boolean; mergeMethod?: 'merge' | 'squash' | 'rebase' } = {};
  if (options.adapter) {
    if (!['noop', 'github-actions'].includes(options.adapter)) {
      console.log(c.error(`Unsupported adapter '${options.adapter}'. Valid: noop | github-actions`));
      process.exit(1);
    }
    patch.adapter = options.adapter;
  }
  if (options.autoMerge !== undefined) patch.autoMerge = options.autoMerge;
  if (options.mergeMethod) {
    if (!['merge', 'squash', 'rebase'].includes(options.mergeMethod)) {
      console.log(c.error(`Unsupported merge method '${options.mergeMethod}'. Valid: merge | squash | rebase`));
      process.exit(1);
    }
    patch.mergeMethod = options.mergeMethod as 'merge' | 'squash' | 'rebase';
  }

  if (Object.keys(patch).length === 0) {
    console.log(c.error('No pipeline changes supplied. Use --adapter / --auto-merge / --no-auto-merge / --merge-method'));
    process.exit(1);
  }
  try {
    await client.patchPipelineConfig(projectId, patch);
    blank();
    console.log(c.success(`✓ pipeline config updated and committed`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to update pipeline config');
  }
}

// ─── members ─────────────────────────────────────────────────────────────────

export async function projectMembersListCommand(options: BaseOptions = {}): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, projectId, projectName, serverUrl } = ctx;
  try {
    // Both lookups in parallel — they're independent and operators
    // expect both surfaces in a single command.
    const [direct, groups] = await Promise.all([
      client.listProjectMembers(projectId),
      client.listProjectGroups(projectId).catch(() => ({ data: [] })),
    ]);
    blank();
    console.log(c.bold(`Direct members — ${projectName} (${direct.data.length})`));
    divider();
    if (direct.data.length === 0) {
      console.log(c.dim('No direct members — add one with: gestalt project members add <email> --role <role>'));
    } else {
      printTable(
        direct.data.map((m) => ({
          email: m.email,
          name: m.displayName || c.dim('(no name)'),
          role: projectRoleBadge(m.projectRole),
          added: new Date(m.createdAt).toLocaleDateString(),
        })),
        [
          { key: 'email', header: 'Email', width: 36 },
          { key: 'name',  header: 'Name',  width: 24 },
          { key: 'role',  header: 'Role',  width: 18 },
          { key: 'added', header: 'Added', width: 12 },
        ],
      );
    }
    blank();
    console.log(c.bold(`Group assignments — ${projectName} (${groups.data.length})`));
    divider();
    if (groups.data.length === 0) {
      console.log(c.dim('No groups assigned — assign one with: gestalt project members assign-group <projectName> <groupName> --role <role>'));
    } else {
      printTable(
        groups.data.map((g) => ({
          group: c.info(g.group.name),
          members: `${g.memberCount} member${g.memberCount === 1 ? '' : 's'}`,
          role: projectRoleBadge(g.role),
          description: g.group.description ? c.dim(g.group.description) : c.dim('—'),
        })),
        [
          { key: 'group',       header: 'Group',       width: 28 },
          { key: 'members',     header: 'Members',     width: 14 },
          { key: 'role',        header: 'Role',        width: 18 },
          { key: 'description', header: 'Description', width: 40 },
        ],
      );
    }
    blank();
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list members');
  }
}

export interface MembersAssignGroupOptions extends BaseOptions {
  role?: string;
}

export async function projectMembersAssignGroupCommand(
  projectName: string,
  groupName: string,
  options: MembersAssignGroupOptions = {},
): Promise<void> {
  const ctx = await openClient({ ...options, project: projectName });
  if (!ctx) return;
  const { client, projectId, serverUrl } = ctx;
  const role = options.role ?? 'editor';
  if (!['project-admin', 'editor', 'reader'].includes(role)) {
    console.log(c.error(`Invalid role '${role}'. Must be one of: project-admin, editor, reader`));
    process.exit(1);
  }
  try {
    const groupsRes = await client.listPlatformGroups();
    const group = groupsRes.data.find((g) => g.name === groupName);
    if (!group) {
      console.log(c.error(`No group named '${groupName}'. Run: gestalt platform groups list`));
      process.exit(1);
    }
    await client.assignGroupToProject(group.id, projectId, role as 'project-admin' | 'editor' | 'reader');
    blank();
    console.log(c.success(`✓ Assigned group '${groupName}' to project '${projectName}' as ${role}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to assign group ${groupName}`);
  }
}

export async function projectMembersRemoveGroupCommand(
  projectName: string,
  groupName: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient({ ...options, project: projectName });
  if (!ctx) return;
  const { client, projectId, serverUrl } = ctx;
  try {
    const groupsRes = await client.listPlatformGroups();
    const group = groupsRes.data.find((g) => g.name === groupName);
    if (!group) {
      console.log(c.error(`No group named '${groupName}'. Run: gestalt platform groups list`));
      process.exit(1);
    }
    await client.unassignGroupFromProject(group.id, projectId);
    blank();
    console.log(c.success(`✓ Removed group '${groupName}' from project '${projectName}'`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to remove group ${groupName}`);
  }
}

export interface MembersAddOptions extends BaseOptions {
  role?: string;
}

export async function projectMembersAddCommand(
  email: string,
  options: MembersAddOptions = {},
): Promise<void> {
  if (!options.role) {
    console.log(c.error('--role is required. Valid: project-admin | editor | reader'));
    process.exit(1);
  }
  if (!VALID_PROJECT_ROLES.has(options.role)) {
    console.log(c.error(`Invalid role '${options.role}'. Valid: ${[...VALID_PROJECT_ROLES].join(', ')}`));
    process.exit(1);
  }
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, projectId, projectName, serverUrl } = ctx;
  try {
    // Resolve user by email — same pattern the existing `gestalt
    // users assign` uses.
    const userRes = await client.listUsers({ search: email });
    const user = userRes.data.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      console.log(c.error(`No user with email '${email}'. Ask a platform-admin to run: gestalt users add ${email}`));
      process.exit(1);
    }
    await client.addProjectMember(projectId, { userId: user.id, role: options.role as 'project-admin' | 'editor' | 'reader' });
    blank();
    console.log(c.success(`✓ ${email} added to ${projectName} as ${options.role}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to add ${email} to ${projectName}`);
  }
}

export async function projectMembersRemoveCommand(
  email: string,
  options: BaseOptions = {},
): Promise<void> {
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, projectId, projectName, serverUrl } = ctx;
  try {
    const userRes = await client.listUsers({ search: email });
    const user = userRes.data.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      console.log(c.error(`No user with email '${email}'.`));
      process.exit(1);
    }
    if (!await confirm(`Remove ${email} from ${projectName}?`)) {
      console.log(c.dim('Aborted.'));
      return;
    }
    await client.removeProjectMember(projectId, user.id);
    blank();
    console.log(c.success(`✓ ${email} removed from ${projectName}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to remove ${email}`);
  }
}

export async function projectMembersRoleCommand(
  email: string,
  role: string,
  options: BaseOptions = {},
): Promise<void> {
  if (!VALID_PROJECT_ROLES.has(role)) {
    console.log(c.error(`Invalid role '${role}'. Valid: ${[...VALID_PROJECT_ROLES].join(', ')}`));
    process.exit(1);
  }
  const ctx = await openClient(options);
  if (!ctx) return;
  const { client, projectId, projectName, serverUrl } = ctx;
  try {
    const userRes = await client.listUsers({ search: email });
    const user = userRes.data.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      console.log(c.error(`No user with email '${email}'.`));
      process.exit(1);
    }
    await client.updateProjectMemberRole(projectId, user.id, role as 'project-admin' | 'editor' | 'reader');
    blank();
    console.log(c.success(`✓ ${email} role updated to ${role} on ${projectName}`));
    blank();
  } catch (err) {
    handleErr(err, serverUrl, `Failed to update role for ${email}`);
  }
}

// ─── shared helpers ──────────────────────────────────────────────────────────

interface CommandContext {
  client: GestaltApiClient;
  projectId: string;
  projectName: string;
  serverUrl: string;
}

async function openClient(options: BaseOptions): Promise<CommandContext | null> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const { data: projects } = await client.listProjects();
    let project = projects[0];
    if (options.project) {
      const match = projects.find((p) => p.name === options.project);
      if (!match) {
        console.log(c.error(`No project named '${options.project}'. Run \`gestalt projects list\`.`));
        process.exit(1);
      }
      project = match;
    } else if (config.currentProjectId) {
      project = projects.find((p) => p.id === config.currentProjectId) ?? project;
    }
    if (!project) {
      console.log(c.error('No projects registered. Run: gestalt init'));
      process.exit(1);
    }
    return { client, projectId: project.id, projectName: project.name, serverUrl };
  } catch (err) {
    handleErr(err, serverUrl, 'Failed to list projects');
    return null;
  }
}

function handleErr(err: unknown, serverUrl: string, label: string): never {
  if (isConnectivityError(err)) {
    printConnectionError(serverUrl);
  } else if (!handleMembershipForbidden(err)) {
    console.log(c.error(`${label}: ${err instanceof Error ? err.message : String(err)}`));
  }
  process.exit(1);
}

function projectRoleBadge(role: string): string {
  if (role === 'project-admin') return c.success('★ project-admin');
  if (role === 'editor') return c.info('● editor');
  if (role === 'reader') return c.dim('○ reader');
  return c.dim(role);
}

/**
 * Open the operator's $EDITOR (or vi as fallback) to compose the
 * multi-line prompt body for a new custom agent. Returns the saved
 * content. Same pattern git uses for commit messages.
 */
async function openEditorForPrompt(): Promise<string> {
  const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'vi';
  const dir = mkdtempSync(join(tmpdir(), 'gestalt-custom-agent-'));
  const file = join(dir, 'PROMPT.txt');
  writeFileSync(
    file,
    [
      '# Compose the prompt template for your custom agent.',
      '# Available placeholders (the server substitutes these at run time):',
      '#   {{role}} {{goal}} {{artifacts}} {{goldenPrinciples}}',
      '#   {{intentText}} {{projectName}}',
      '# Lines starting with `#` are stripped before saving.',
      '',
      '',
    ].join('\n'),
    'utf8',
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [file], { stdio: 'inherit' });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`editor exited ${code}`)));
    child.on('error', reject);
  });
  const raw = readFileSync(file, 'utf8');
  unlinkSync(file);
  const cleaned = raw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
  if (!cleaned) {
    console.log(c.error('Empty prompt — aborting.'));
    process.exit(1);
  }
  return cleaned;
}
