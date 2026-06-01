/**
 * gestalt maintenance — operator commands for the maintenance layer.
 *
 *   gestalt maintenance trigger <agentRole> <projectName>
 *     → POST /maintenance/trigger { agentRole, projectId }
 *     CLI shortcut for the dashboard's "Run now" button.
 *
 *   gestalt maintenance reset-findings <projectName>
 *     → DELETE /maintenance/findings/:projectId
 *     Clears every `maintenance_finding_attempts` row for the project
 *     (escalated or not). Use after manual remediation so the runner's
 *     budget starts fresh.
 *
 * Both commands accept an optional `--server <url>` one-shot override
 * (see the file header in commands/projects.ts for the convention).
 */

import { GestaltApiClient } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import {
  printConnectionError, isConnectivityError, handleMembershipForbidden,
} from '../ui/server-errors';
import { c, blank } from '../ui/prompts';

const VALID_AGENT_ROLES = new Set([
  'drift-agent', 'alignment-agent', 'gc-agent', 'evaluation-agent',
]);

export async function maintenanceTriggerCommand(
  agentRole: string,
  projectName: string,
  options: { server?: string } = {},
): Promise<void> {
  if (!VALID_AGENT_ROLES.has(agentRole)) {
    console.log(
      c.error(`Unknown agent role '${agentRole}'. Valid: ${[...VALID_AGENT_ROLES].join(', ')}`),
    );
    process.exit(1);
  }

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
    console.log(c.dim(`Triggering ${agentRole} for ${project.name} ...`));
    const result = await client.triggerMaintenance(agentRole, project.id);
    const { id, status, intentsQueued, directFixes, durationMs } = result.data;
    blank();
    console.log(c.success(`✓ ${agentRole} completed — status: ${status}`));
    console.log(c.dim(`  runId:         ${id}`));
    console.log(c.dim(`  intentsQueued: ${intentsQueued}`));
    console.log(c.dim(`  directFixes:   ${directFixes}`));
    console.log(c.dim(`  durationMs:    ${durationMs ?? '-'}`));
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed to trigger ${agentRole}: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

export async function maintenanceResetFindingsCommand(
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
    console.log(c.dim(`Resetting maintenance finding attempts for ${project.name} ...`));
    const result = await client.resetMaintenanceFindings(project.id);
    const { deleted } = result.data;
    blank();
    console.log(c.success(`✓ Reset ${deleted} finding attempt record${deleted === 1 ? '' : 's'} for ${project.name}`));
    console.log(c.dim(`  Run: gestalt maintenance trigger alignment-agent ${project.name}`));
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed to reset findings: ${err instanceof Error ? err.message : String(err)}`));
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
    console.log(
      c.error(`No project named '${projectName}'. Run \`gestalt projects list\` to see what is registered.`),
    );
    process.exit(1);
  }
  return match;
}
