/**
 * gestalt agents — read + validate `agents.yaml` from the project repo.
 *
 *   gestalt agents list <projectName>
 *     Calls GET /projects/:id/agents and prints two sections:
 *     "Framework agents" (the 9 configurable LLM agents with their
 *     current model override or "(platform default)") and "Custom
 *     agents" (any custom_agents declared, or "None defined"). Helps
 *     operators verify their agents.yaml is being read correctly.
 *
 *   gestalt agents validate <projectName>
 *     Calls GET /projects/:id/agents/validate and prints
 *     "✓ agents.yaml valid (N custom agents defined)" or "✗ ..."
 *     plus any warnings the server surfaced.
 */

import { GestaltApiClient } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import { printConnectionError, isConnectivityError } from '../ui/server-errors';
import { c, blank, divider } from '../ui/prompts';

export async function agentsListCommand(
  projectName: string,
  options: { server?: string } = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const project = await resolveProjectByName(client, projectName);
    blank();
    console.log(c.dim(`Reading agents.yaml for ${project.name} ...`));
    const res = await client.listAgents(project.id);
    const { frameworkAgents, customAgents, layers } = res.data;

    // Amendment 2026-06 — render by layer when the server's new
    // `layers` field is present. Falls through to the flat list for
    // older server builds.
    const renderRow = (a: typeof frameworkAgents[0]) => {
      const overrideLabel = a.modelOverride
        ? c.dim(`model: `) + a.modelOverride
        : c.dim(`model: (platform default)`);
      const tempLabel = a.temperature !== null ? c.dim(` · temp: `) + String(a.temperature) : '';
      const extLabel = a.promptExtensionCount > 0
        ? c.dim(` · `) + c.warn(`${a.promptExtensionCount} prompt extension${a.promptExtensionCount === 1 ? '' : 's'}`)
        : '';
      const builtinTools = a.builtinTools?.length ?? 0;
      const toolsLabel = builtinTools > 0
        ? c.dim(` · `) + c.info(`tools: ${a.builtinTools!.join(', ')}`)
        : '';
      const mcpCount = a.mcpServers?.length ?? 0;
      const mcpLabel = mcpCount > 0
        ? c.dim(` · `) + c.info(`MCP: ${a.mcpServers!.join(', ')}`)
        : '';
      console.log(`  ${a.name.padEnd(18)} ${overrideLabel}${tempLabel}${extLabel}${toolsLabel}${mcpLabel}`);
    };

    if (layers) {
      blank();
      console.log(c.bold('Generate layer'));
      divider();
      for (const a of layers.generate.framework) renderRow(a);
      if (layers.generate.custom.length > 0) {
        blank();
        console.log(c.dim('  custom:'));
        for (const ca of layers.generate.custom) {
          const modelLabel = ca.llm.model
            ? c.dim(' · model: ') + ca.llm.model
            : c.dim(' · model: (platform default)');
          console.log(`    ${c.success('+')} ${ca.name.padEnd(26)} ${c.dim('— ' + (ca.role || 'no role'))}${modelLabel}`);
        }
      }
      blank();
      console.log(c.bold('Gate layer'));
      divider();
      for (const a of layers.gate.framework) renderRow(a);
      console.log(c.dim(`  infrastructure: ${layers.gate.infrastructure.join(', ')}`));
      blank();
      console.log(c.bold('Maintenance layer'));
      divider();
      for (const a of layers.maintenance.llm) renderRow(a);
      console.log(c.dim(`  infrastructure: ${layers.maintenance.infrastructure.join(', ')}`));
      blank();
    } else {
      // Back-compat fallback — older servers without `layers`.
      blank();
      console.log(c.bold('Framework agents'));
      divider();
      for (const a of frameworkAgents) renderRow(a);
      blank();
      console.log(c.bold('Custom agents'));
      divider();
      if (customAgents.length === 0) {
        console.log(c.dim('  None defined. Add a `custom_agents:` block to agents.yaml.'));
      } else {
        for (const ca of customAgents) {
          const modelLabel = ca.llm.model
            ? c.dim(' · model: ') + ca.llm.model
            : c.dim(' · model: (platform default)');
          console.log(`  ${c.success('+')} ${ca.name.padEnd(28)} ${c.dim('— ' + (ca.role || 'no role'))}${modelLabel}`);
        }
      }
      blank();
    }
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed to list agents: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

export async function agentsValidateCommand(
  projectName: string,
  options: { server?: string } = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const project = await resolveProjectByName(client, projectName);
    blank();
    console.log(c.dim(`Validating agents.yaml for ${project.name} ...`));
    const res = await client.validateAgents(project.id);
    const { valid, warnings, customAgents, executionOrder, error } = res.data;
    blank();
    if (valid) {
      const noun = customAgents === 1 ? 'agent' : 'agents';
      console.log(c.success(`✓ agents.yaml valid (${customAgents} custom ${noun} defined)`));
    } else {
      console.log(c.error('✗ agents.yaml invalid'));
      if (error) {
        console.log(`  ${c.error(error)}`);
      }
    }
    if (warnings.length > 0) {
      blank();
      console.log(c.dim('Warnings:'));
      for (const w of warnings) {
        console.log(`  ${c.warn('!')} ${w}`);
      }
    }
    // Show resolved execution order so operators see exactly which
    // framework agent each custom agent runs after — including the
    // default `test-agent` for customs that omitted `runs_after`.
    if (executionOrder && executionOrder.length > 0) {
      blank();
      console.log(c.dim('Custom agent execution order:'));
      const padTo = Math.max(...executionOrder.map((e) => e.runsAfter.length));
      for (const entry of executionOrder) {
        console.log(`  ${entry.runsAfter.padEnd(padTo)} → ${c.info(entry.name)}`);
      }
    }
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed to validate agents.yaml: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

async function resolveProjectByName(
  client: GestaltApiClient,
  projectName: string,
): Promise<{ id: string; name: string }> {
  const { data: projects } = await client.listProjects();
  const match = projects.find((p) => p.name === projectName);
  if (!match) {
    console.log(c.error(`No project named '${projectName}'. Run \`gestalt projects list\` to see what is registered.`));
    process.exit(1);
  }
  return match;
}
