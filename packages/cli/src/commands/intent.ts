/**
 * gestalt intent — list / show / submit subcommands.
 *
 *   gestalt intent list   [--project <name>] [--status <s>] [--limit 20]
 *     → GET /intents?projectId=<id>&status=<s>&limit=<n>
 *
 *   gestalt intent show <id> [--watch]
 *     → GET /intents/:id  +  GET /deployments?correlationId=<id>
 *     Renders the full execution-flow graph (Generate / Gate / Deploy
 *     + signals summary). `--watch` re-renders every 3 seconds until
 *     the intent reaches a terminal status (deployed, failed,
 *     escalated). Same renderer powers `gestalt status --id <id>
 *     --graph`.
 *
 *   gestalt intent submit "<text>" [--project <name>] [--priority ...]
 *     → alias for `gestalt run`. Same handler.
 *
 * Intent ID resolution: accepts either a full UUID or an 8-char
 * correlationId prefix (same form the list table prints).
 */

import { GestaltApiClient, type IntentSummary, type IntentDetail } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import {
  printConnectionError, isConnectivityError, handleMembershipForbidden,
} from '../ui/server-errors';
import {
  c, blank, divider, printTable, statusBadge, priorityBadge,
} from '../ui/prompts';
import {
  renderExecutionGraph, clearScreen, isTerminalIntentStatus,
} from '../ui/execution-graph';
import { resolveIntentId } from '../ui/intent-resolver';
import { resolveProjectId } from '../ui/resolve';
import { runCommand } from './run';
import type { RunOptions } from '../types';

const VALID_STATUSES = new Set([
  'pending', 'generating', 'in-review', 'approved', 'deploying',
  'deployed', 'failed', 'escalated', 'waiting-for-clarification',
]);

const VALID_SOURCES = new Set([
  'human', 'maintenance-agent', 'self-healing',
  'auto-resolved', 'operator-resume', 'pipeline-feedback',
]);

const VALID_PRIORITIES = new Set(['critical', 'high', 'normal', 'low']);

const WATCH_INTERVAL_MS = 3_000;

// ─── intent list ─────────────────────────────────────────────────────────────

export interface IntentListOptions {
  server?: string;
  project?: string;
  status?: string;
  limit?: string;
  // Brief 5 — extended filter flags
  source?: string;
  priority?: string;
  search?: string;
  from?: string;
  to?: string;
}

export async function intentListCommand(options: IntentListOptions = {}): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  if (options.status && !VALID_STATUSES.has(options.status)) {
    console.log(c.error(`Unknown status '${options.status}'. Valid values: ${[...VALID_STATUSES].join(', ')}`));
    process.exit(1);
  }
  if (options.source && !VALID_SOURCES.has(options.source)) {
    console.log(c.error(`Unknown source '${options.source}'. Valid values: ${[...VALID_SOURCES].join(', ')}`));
    process.exit(1);
  }
  if (options.priority && !VALID_PRIORITIES.has(options.priority)) {
    console.log(c.error(`Unknown priority '${options.priority}'. Valid values: ${[...VALID_PRIORITIES].join(', ')}`));
    process.exit(1);
  }

  const limit = Math.min(Math.max(parseInt(options.limit ?? '20', 10) || 20, 1), 100);
  const client = new GestaltApiClient({ serverUrl, token: config.token });

  try {
    const projectId = await resolveProjectId(client, config.currentProjectId, options.project);
    // Brief 5: when projectId is absent, the server returns intents
    // across every project the user can access via direct membership
    // OR group assignment. Platform-admin sees server-wide. Regular
    // users get the union of their group-accessible projects.
    const params: Parameters<GestaltApiClient['listIntents']>[0] = { limit };
    if (projectId) params.projectId = projectId;
    if (options.status)   params.status = options.status;
    if (options.source)   params.source = options.source;
    if (options.priority) params.priority = options.priority;
    if (options.search)   params.search = options.search;
    if (options.from)     params.from = options.from;
    if (options.to)       params.to = options.to;
    const res = await client.listIntents(params);
    renderIntentTable(res.data, projectId ? (options.project ?? '(current project)') : 'accessible projects');
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

function renderIntentTable(intents: IntentSummary[], projectLabel: string): void {
  blank();
  console.log(c.bold(`Intents (${intents.length}) · ${projectLabel}`));
  divider();
  if (intents.length === 0) {
    console.log(c.dim('No intents match the filter. Run: gestalt run "<intent>"'));
    blank();
    return;
  }
  printTable(
    intents.map((i) => ({
      id: i.correlationId.slice(0, 8),
      status: statusBadge(i.status),
      priority: priorityBadge(i.priority),
      age: formatAge(new Date(i.updatedAt)),
      text: i.text,
    })),
    [
      { key: 'id',       header: 'ID',       width: 10 },
      { key: 'status',   header: 'Status',   width: 22 },
      { key: 'priority', header: 'Priority', width: 12 },
      { key: 'age',      header: 'Age',      width: 10 },
      { key: 'text',     header: 'Intent',   width: 60 },
    ],
  );
  blank();
}

// ─── intent show ─────────────────────────────────────────────────────────────

export interface IntentShowOptions {
  server?: string;
  watch?: boolean;
}

export async function intentShowCommand(
  id: string,
  options: IntentShowOptions = {},
): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });
  const projectId = config.currentProjectId;

  try {
    const intent = await fetchIntent(client, id, projectId);

    if (options.watch) {
      await watchIntent(client, intent.id, intent.projectId);
      return;
    }

    await renderIntentDetail(client, intent);
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

async function fetchIntent(
  client: GestaltApiClient,
  idOrPrefix: string,
  currentProjectId: string | null,
): Promise<IntentDetail> {
  const intentId = await resolveIntentId(client, idOrPrefix, currentProjectId);
  const res = await client.getIntent(intentId);
  return res.data;
}

async function renderIntentDetail(
  client: GestaltApiClient,
  intent: IntentDetail,
): Promise<void> {
  // Fetch deployment events for the cycle if any deploy execution rows
  // exist — `GET /deployments?projectId&correlationId` returns 0 or 1
  // rows.
  const hasDeploy = (intent.agentExecutions ?? []).some(
    (e) => e.agentRole === 'pr-agent' || e.agentRole === 'pipeline-agent' || e.agentRole === 'promotion-agent',
  );
  let deploymentEvents: import('../api/client').DeploymentEvent[] = [];
  if (hasDeploy && intent.projectId) {
    try {
      const depRes = await client.listDeployments({
        projectId: intent.projectId,
        correlationId: intent.correlationId,
      });
      deploymentEvents = depRes.data[0]?.events ?? [];
    } catch {
      // Deployment event fetch is best-effort — the graph still renders
      // without the PR/run/sha extras.
    }
  }

  blank();
  console.log(renderExecutionGraph({ intent, deploymentEvents }));
}

async function watchIntent(
  client: GestaltApiClient,
  intentId: string,
  projectId: string,
): Promise<void> {
  // Render once immediately, then poll every WATCH_INTERVAL_MS. Stops
  // when the intent reaches a terminal status (deployed / failed /
  // escalated) or the user hits Ctrl+C.
  process.on('SIGINT', () => {
    blank();
    console.log(c.dim('Detached.'));
    process.exit(0);
  });

  while (true) {
    const detail = await client.getIntent(intentId);
    const intent = detail.data;
    const events = await fetchDeploymentEventsBestEffort(client, projectId, intent.correlationId);
    clearScreen();
    console.log(renderExecutionGraph({ intent, deploymentEvents: events }));
    if (isTerminalIntentStatus(intent.status)) {
      console.log(c.success(`Reached terminal status: ${intent.status}`));
      return;
    }
    console.log(c.dim('Press Ctrl+C to detach. Re-rendering every 3s...'));
    await sleep(WATCH_INTERVAL_MS);
  }
}

async function fetchDeploymentEventsBestEffort(
  client: GestaltApiClient,
  projectId: string,
  correlationId: string,
): Promise<import('../api/client').DeploymentEvent[]> {
  try {
    const res = await client.listDeployments({ projectId, correlationId });
    return res.data[0]?.events ?? [];
  } catch {
    return [];
  }
}

// ─── intent submit (alias for run) ───────────────────────────────────────────

export async function intentSubmitCommand(text: string, options: RunOptions): Promise<void> {
  // Discoverability alias. No new behaviour — `gestalt run` is the
  // canonical command; this just makes the noun-verb form available.
  await runCommand(text, options);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatAge(updated: Date): string {
  const seconds = Math.floor((Date.now() - updated.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
