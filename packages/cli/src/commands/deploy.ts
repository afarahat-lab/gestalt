/**
 * gestalt deploy — list and inspect deploy-layer activity.
 *
 *   gestalt deploy list [--project <name>] [--limit 20]
 *     → GET /deployments?projectId=<id>&limit=<n>
 *     Table of recent deployments with status badge, branch, PR
 *     link, and timestamp.
 *
 *   gestalt deploy show <intentId> [--project <name>]
 *     → GET /deployments?projectId=<id>&correlationId=<corr>
 *     Renders the deployment timeline:
 *       Branch:  gestalt/4b7be433-...
 *       PR:      #26  https://github.com/.../pull/26
 *       Timeline
 *         HH:MM:SS  ✓ PR opened           PR #26
 *         HH:MM:SS  ✓ Pipeline triggered  run #...
 *         ...
 *       Total deployment time: 28s
 *
 *   Accepts 8-char correlationId prefix OR full UUID.
 */

import {
  GestaltApiClient,
  type DeploymentSummary, type DeploymentEvent, type DeploymentEventType,
  type IntentSummary,
} from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import {
  printConnectionError, isConnectivityError, handleMembershipForbidden,
} from '../ui/server-errors';
import {
  c, blank, divider, printTable, statusBadge,
} from '../ui/prompts';

export interface DeployListOptions {
  server?: string;
  project?: string;
  limit?: string;
}

export interface DeployShowOptions {
  server?: string;
  project?: string;
}

// ─── deploy list ─────────────────────────────────────────────────────────────

export async function deployListCommand(options: DeployListOptions = {}): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });
  const limit = Math.min(Math.max(parseInt(options.limit ?? '20', 10) || 20, 1), 100);

  try {
    const projectId = await resolveProjectId(client, config.currentProjectId, options.project);
    if (!projectId) {
      console.log(c.error('No project context. Use `gestalt projects use <name>` or pass --project.'));
      process.exit(1);
    }
    const res = await client.listDeployments({ projectId, limit });
    renderDeployTable(res.data);
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

function renderDeployTable(deployments: DeploymentSummary[]): void {
  blank();
  console.log(c.bold(`Deployments (${deployments.length})`));
  divider();
  if (deployments.length === 0) {
    console.log(c.dim('No deployments yet.'));
    blank();
    return;
  }
  printTable(
    deployments.map((d) => ({
      id: d.correlationId.slice(0, 8),
      status: statusBadge(d.status),
      pr: d.prNumber ? `#${d.prNumber}` : '–',
      branch: d.branch ?? '–',
      when: new Date(d.startedAt).toLocaleString(),
    })),
    [
      { key: 'id',     header: 'ID',     width: 10 },
      { key: 'status', header: 'Status', width: 22 },
      { key: 'pr',     header: 'PR',     width: 8  },
      { key: 'branch', header: 'Branch', width: 40 },
      { key: 'when',   header: 'Started', width: 20 },
    ],
  );
  blank();
}

// ─── deploy show ─────────────────────────────────────────────────────────────

export async function deployShowCommand(
  id: string,
  options: DeployShowOptions = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }
  const client = new GestaltApiClient({ serverUrl, token: config.token });

  try {
    const projectId = await resolveProjectId(client, config.currentProjectId, options.project);
    if (!projectId) {
      console.log(c.error('No project context. Use `gestalt projects use <name>` or pass --project.'));
      process.exit(1);
    }
    const correlationId = await resolveCorrelationId(client, id, projectId);
    const res = await client.listDeployments({ projectId, correlationId });
    const deployment = res.data[0];
    if (!deployment) {
      console.log(c.error(`No deployment found for ${correlationId.slice(0, 8)}.`));
      console.log(c.dim('  The intent may still be in generate/gate — run: gestalt intent show'));
      process.exit(1);
    }
    renderDeployment(deployment);
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

function renderDeployment(d: DeploymentSummary): void {
  blank();
  console.log(c.bold(`Deployment — intent ${d.correlationId.slice(0, 8)}`));
  divider();

  if (d.branch) console.log(`${c.dim('Branch:'.padEnd(12))} ${d.branch}`);
  if (d.prUrl) {
    const num = d.prNumber ? `#${d.prNumber} ` : '';
    console.log(`${c.dim('PR:'.padEnd(12))} ${num}${c.info(d.prUrl)}`);
  }
  if (d.deploymentUrl) {
    console.log(`${c.dim('Deployment:'.padEnd(12))} ${c.info(d.deploymentUrl)}`);
  }
  console.log(`${c.dim('Status:'.padEnd(12))} ${statusBadge(d.status)}`);

  blank();
  console.log(c.bold('Timeline'));
  for (const ev of d.events) {
    console.log(formatEventRow(ev));
  }
  blank();

  // Total duration — first event to last (always populated since the
  // server only returns deployments with at least one event).
  if (d.events.length >= 2) {
    const first = new Date(d.events[0]!.createdAt).getTime();
    const last = new Date(d.events[d.events.length - 1]!.createdAt).getTime();
    const seconds = Math.max(0, Math.round((last - first) / 1000));
    console.log(`${c.dim('Total deployment time:')} ${seconds}s`);
  } else if (d.completedAt) {
    const startedAt = new Date(d.startedAt).getTime();
    const completedAt = new Date(d.completedAt).getTime();
    const seconds = Math.max(0, Math.round((completedAt - startedAt) / 1000));
    console.log(`${c.dim('Total deployment time:')} ${seconds}s`);
  }
  blank();
}

const EVENT_LABELS: Record<DeploymentEventType, string> = {
  'pr-opened':            'PR opened',
  'pipeline-triggered':   'Pipeline triggered',
  'pipeline-passed':      'Pipeline passed',
  'pipeline-failed':      'Pipeline failed',
  'promoted-staging':     'Staging promoted',
  'promoted-production':  'Production promoted',
  'auto-merged':          'Auto-merged',
};

function formatEventRow(ev: DeploymentEvent): string {
  const time = new Date(ev.createdAt).toLocaleTimeString([], { hour12: false });
  const glyph = ev.eventType === 'pipeline-failed' ? c.error('✗') : c.success('✓');
  const label = EVENT_LABELS[ev.eventType] ?? ev.eventType;
  let extra = '';
  if (ev.eventType === 'pr-opened' && ev.prNumber !== null) {
    extra = `   ${c.dim('PR')} ${c.info(`#${ev.prNumber}`)}`;
  } else if (ev.eventType === 'pipeline-triggered' && ev.runId) {
    extra = `   ${c.dim('run')} ${c.info(`#${ev.runId}`)}`;
  } else if (ev.eventType === 'auto-merged' && typeof ev.metadata['sha'] === 'string') {
    const sha = (ev.metadata['sha'] as string).slice(0, 8);
    extra = `   ${c.success(sha)}`;
  } else if (
    (ev.eventType === 'promoted-staging' || ev.eventType === 'promoted-production')
    && ev.deploymentUrl
  ) {
    extra = `   ${c.info(ev.deploymentUrl)}`;
  }
  return `  ${c.dim(time)}  ${glyph} ${label.padEnd(22)}${extra}`;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function resolveProjectId(
  client: GestaltApiClient,
  currentProjectId: string | null,
  projectName?: string,
): Promise<string | null> {
  if (projectName) {
    const { data: projects } = await client.listProjects();
    const match = projects.find((p) => p.name === projectName);
    if (!match) {
      console.log(c.error(`No project named '${projectName}'. Run \`gestalt projects list\`.`));
      process.exit(1);
    }
    return match.id;
  }
  return currentProjectId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveCorrelationId(
  client: GestaltApiClient,
  idOrPrefix: string,
  projectId: string,
): Promise<string> {
  const trimmed = idOrPrefix.trim();
  if (UUID_RE.test(trimmed)) return trimmed;
  const res = await client.listIntents({ projectId, limit: 100 });
  const matches: IntentSummary[] = res.data.filter(
    (i) => i.correlationId.startsWith(trimmed),
  );
  if (matches.length === 0) {
    console.log(c.error(`No intent matches '${trimmed}' in the current project.`));
    process.exit(1);
  }
  if (matches.length > 1) {
    console.log(c.error(`Ambiguous prefix '${trimmed}' — ${matches.length} matches.`));
    process.exit(1);
  }
  return matches[0]!.correlationId;
}
