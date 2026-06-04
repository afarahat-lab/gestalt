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
 *   gestalt maintenance list [--project <name>] [--agent <role>] [--limit 20]
 *     → GET /maintenance/runs?projectId&agentRole&limit
 *     Table of recent runs with status, intents queued, fixes
 *     applied, duration, and time-since.
 *
 *   gestalt maintenance show <runId>
 *     → GET /maintenance/runs/:id
 *     Detail with the findings list (per-finding severity badge,
 *     affected files, suggested action).
 *
 * All commands accept an optional `--server <url>` one-shot override
 * (see the file header in commands/projects.ts for the convention).
 */

import {
  GestaltApiClient,
  type MaintenanceRunRecord, type MaintenanceFinding,
} from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import {
  printConnectionError, isConnectivityError, handleMembershipForbidden,
} from '../ui/server-errors';
import { c, blank, divider, printTable } from '../ui/prompts';
import { resolveProjectId } from '../ui/resolve';

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

// ─── maintenance list ────────────────────────────────────────────────────────

export interface MaintenanceListOptions {
  server?: string;
  project?: string;
  agent?: string;
  limit?: string;
}

export async function maintenanceListCommand(
  options: MaintenanceListOptions = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  if (options.agent && !VALID_AGENT_ROLES.has(options.agent)) {
    console.log(c.error(`Unknown agent role '${options.agent}'. Valid: ${[...VALID_AGENT_ROLES].join(', ')}`));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const projectId = await resolveProjectId(client, config.currentProjectId, options.project);
    const limit = Math.min(Math.max(parseInt(options.limit ?? '20', 10) || 20, 1), 200);
    const params: Parameters<GestaltApiClient['listMaintenanceRuns']>[0] = { limit };
    if (projectId) params.projectId = projectId;
    if (options.agent) params.agentRole = options.agent;
    const res = await client.listMaintenanceRuns(params);
    renderMaintenanceTable(res.data);
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed to list maintenance runs: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

function renderMaintenanceTable(runs: MaintenanceRunRecord[]): void {
  blank();
  console.log(c.bold(`Maintenance runs (${runs.length})`));
  divider();
  if (runs.length === 0) {
    console.log(c.dim('No runs match the filter. Use: gestalt maintenance trigger <agentRole> <project>'));
    blank();
    return;
  }
  printTable(
    runs.map((r) => ({
      id: r.id.slice(0, 8),
      agent: r.agentRole,
      status: runStatusBadge(r.status),
      fixes: r.directFixes > 0 ? c.success(String(r.directFixes)) : c.dim(String(r.directFixes)),
      intents: r.intentsQueued > 0 ? c.warn(String(r.intentsQueued)) : c.dim(String(r.intentsQueued)),
      duration: formatRunDuration(r.durationMs),
      when: formatAge(new Date(r.runAt)),
    })),
    [
      { key: 'id',       header: 'ID',        width: 10 },
      { key: 'agent',    header: 'Agent',     width: 20 },
      { key: 'status',   header: 'Status',    width: 14 },
      { key: 'fixes',    header: 'Fixes',     width: 8  },
      { key: 'intents',  header: 'Intents',   width: 8  },
      { key: 'duration', header: 'Duration',  width: 10 },
      { key: 'when',     header: 'When',      width: 12 },
    ],
  );
  blank();
}

// ─── maintenance show ────────────────────────────────────────────────────────

export interface MaintenanceShowOptions {
  server?: string;
}

export async function maintenanceShowCommand(
  runId: string,
  options: MaintenanceShowOptions = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });
  try {
    const id = await resolveRunId(client, runId, config.currentProjectId);
    const res = await client.getMaintenanceRun(id);
    renderMaintenanceRun(res.data);
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed to fetch maintenance run: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

function renderMaintenanceRun(run: MaintenanceRunRecord): void {
  blank();
  console.log(c.bold(`Maintenance run — ${run.agentRole}`));
  divider();
  console.log(`${c.dim('Status:'.padEnd(18))} ${runStatusBadge(run.status)}`);
  console.log(`${c.dim('Duration:'.padEnd(18))} ${formatRunDuration(run.durationMs)}`);
  console.log(`${c.dim('Direct fixes:'.padEnd(18))} ${run.directFixes}`);
  console.log(`${c.dim('Intents queued:'.padEnd(18))} ${run.intentsQueued}`);
  console.log(`${c.dim('Started:'.padEnd(18))} ${new Date(run.runAt).toLocaleString()}`);
  if (run.completedAt) {
    console.log(`${c.dim('Completed:'.padEnd(18))} ${new Date(run.completedAt).toLocaleString()}`);
  }
  blank();

  if (run.findings.length === 0) {
    console.log(c.bold('Findings (0)'));
    console.log(c.dim('  Agent ran cleanly — nothing to report.'));
    blank();
    return;
  }

  console.log(c.bold(`Findings (${run.findings.length})`));
  for (const f of run.findings) {
    blank();
    console.log(`  ${findingSeverityBadge(f.severity)}  ${c.bold(f.type)}`);
    if (f.affectedFiles.length > 0) {
      const shown = f.affectedFiles.slice(0, 3);
      for (const path of shown) {
        console.log(`    ${c.dim('•')} ${path}`);
      }
      if (f.affectedFiles.length > shown.length) {
        console.log(`    ${c.dim(`...and ${f.affectedFiles.length - shown.length} more`)}`);
      }
    }
    if (f.description) {
      console.log(`    ${f.description}`);
    }
    if (f.suggestedAction) {
      console.log(`    ${c.dim('→')} ${c.dim(f.suggestedAction)}`);
    }
  }
  blank();
}

// ─── shared helpers ──────────────────────────────────────────────────────────

function runStatusBadge(status: MaintenanceRunRecord['status']): string {
  if (status === 'completed') return c.success('✓ complete');
  if (status === 'failed') return c.error('✗ failed');
  if (status === 'running') return c.info('◎ running');
  return c.dim(status);
}

function findingSeverityBadge(severity: MaintenanceFinding['severity']): string {
  if (severity === 'high') return c.error(`⚠ ${severity}`);
  if (severity === 'medium') return c.warn(`⚠ ${severity}`);
  return c.dim(`⚠ ${severity}`);
}

function formatRunDuration(ms: number | null): string {
  if (ms === null) return '–';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatAge(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a run id from either a full UUID or 8-char prefix. The
 * prefix path lists the project's recent runs and matches; ambiguous
 * prefixes error with the match count.
 */
async function resolveRunId(
  client: GestaltApiClient,
  idOrPrefix: string,
  currentProjectId: string | null,
): Promise<string> {
  const trimmed = idOrPrefix.trim();
  if (UUID_RE.test(trimmed)) return trimmed;

  const params: Parameters<GestaltApiClient['listMaintenanceRuns']>[0] = { limit: 100 };
  if (currentProjectId) params.projectId = currentProjectId;
  const res = await client.listMaintenanceRuns(params);
  const matches = res.data.filter((r) => r.id.startsWith(trimmed));
  if (matches.length === 0) {
    console.log(c.error(`No maintenance run matches '${trimmed}'.`));
    console.log(c.dim('  Try: gestalt maintenance list'));
    process.exit(1);
  }
  if (matches.length > 1) {
    console.log(c.error(`Ambiguous prefix '${trimmed}' — ${matches.length} matches.`));
    process.exit(1);
  }
  return matches[0]!.id;
}
