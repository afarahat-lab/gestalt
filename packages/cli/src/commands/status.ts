/**
 * gestalt status — shows current platform state and recent intents.
 *
 * Without args: shows active agents + 10 most recent intents.
 * With --id <correlationId>:
 *   - default: shows the summary table for one intent cycle
 *   - --graph: renders the full execution-flow graph (same renderer
 *     as `gestalt intent show`)
 *   - --watch: polls every 3 seconds and re-renders until the intent
 *     reaches a terminal status (deployed / failed / escalated)
 */

import {
  GestaltApiClient,
  type IntentDetail, type DeploymentEvent,
} from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import { printConnectionError, isConnectivityError } from '../ui/server-errors';
import {
  c, blank, divider, createSpinner,
  statusBadge, printTable,
} from '../ui/prompts';
import {
  renderExecutionGraph, clearScreen, isTerminalIntentStatus,
} from '../ui/execution-graph';
import { resolveIntentId } from '../ui/intent-resolver';
import type { StatusOptions } from '../types';

const WATCH_INTERVAL_MS = 3_000;

interface StatusCommandOptions extends StatusOptions {
  id?: string;
  server?: string;
  graph?: boolean;
}

export async function statusCommand(options: StatusCommandOptions): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);

  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });

  if (options.id) {
    // Translate UUID-or-correlationId-prefix to the intent's
    // internal UUID once up front. Every downstream branch
    // (--watch / --graph / summary) hits `/intents/:id` which keys
    // on the intent UUID, not the correlationId.
    const resolvedIntentId = await resolveIntentId(
      client, options.id, config.currentProjectId,
    );
    if (options.watch) {
      await watchIntent(client, resolvedIntentId, options.graph ?? false, serverUrl);
    } else if (options.graph) {
      await showIntentGraph(client, resolvedIntentId, serverUrl);
    } else {
      await showIntentDetail(client, resolvedIntentId, serverUrl);
    }
  } else {
    await showPlatformStatus(client, config.currentProjectId, serverUrl);
  }
}

async function showPlatformStatus(
  client: GestaltApiClient,
  projectId: string | null,
  serverUrl: string,
): Promise<void> {
  // Header — surfaces the server URL the operator is talking to so they
  // can spot a wrong-server config at a glance. Same idea as the prompt
  // in psql showing the current connection.
  blank();
  console.log(`${c.bold('Gestalt')} ${c.dim('—')} ${c.info(serverUrl)}`);
  divider();

  const spinner = createSpinner('Fetching status...');
  spinner.start();

  try {
    const [, agentsRes] = await Promise.all([
      client.getStatus(),
      client.getActiveAgents(),
    ]);

    spinner.stop();
    blank();

    // Active agents
    if (agentsRes.data.length === 0) {
      console.log(c.dim('No agents running — platform is idle'));
    } else {
      console.log(c.bold(`Active agents (${agentsRes.data.length})`));
      divider();
      agentsRes.data.forEach((agent) => {
        const elapsed = agent.startedAt
          ? `${Math.round((Date.now() - new Date(agent.startedAt).getTime()) / 1000)}s`
          : '—';
        console.log(
          `  ${c.info('◎')} ${c.agent(agent.agentRole.padEnd(28))} ${c.dim(elapsed)}`,
        );
      });
    }

    blank();

    // Recent intents
    if (projectId) {
      const intentsRes = await client.listIntents({ projectId, limit: 10 });

      if (intentsRes.data.length === 0) {
        console.log(c.dim('No intents yet. Run: gestalt run "<intent>"'));
      } else {
        console.log(c.bold('Recent intents'));
        divider();
        printTable(
          intentsRes.data.map((i) => ({
            status: statusBadge(i.status),
            text: i.text.slice(0, 42),
            time: new Date(i.updatedAt).toLocaleTimeString(),
          })),
          [
            { key: 'status', header: 'Status', width: 24 },
            { key: 'text', header: 'Intent', width: 44 },
            { key: 'time', header: 'Updated', width: 12 },
          ],
        );
      }
    }

    blank();

  } catch (err) {
    spinner.stop();
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

// ─── --graph: full execution-flow renderer ───────────────────────────────────

async function showIntentGraph(
  client: GestaltApiClient,
  id: string,
  serverUrl: string,
): Promise<void> {
  try {
    const intent = (await client.getIntent(id)).data;
    const events = await fetchDeploymentEventsBestEffort(
      client, intent.projectId, intent.correlationId,
    );
    blank();
    console.log(renderExecutionGraph({ intent, deploymentEvents: events }));
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

async function watchIntent(
  client: GestaltApiClient,
  id: string,
  asGraph: boolean,
  serverUrl: string,
): Promise<void> {
  // Polling-based watch — re-fetch + clear + re-render every
  // WATCH_INTERVAL_MS until the intent reaches a terminal status.
  // SSE is reserved for `gestalt logs`; --watch on status is a
  // simpler re-render loop per the brief.
  process.on('SIGINT', () => {
    blank();
    console.log(c.dim('Detached.'));
    process.exit(0);
  });

  while (true) {
    try {
      const intent = (await client.getIntent(id)).data;
      const events = asGraph
        ? await fetchDeploymentEventsBestEffort(client, intent.projectId, intent.correlationId)
        : [];
      clearScreen();
      if (asGraph) {
        console.log(renderExecutionGraph({ intent, deploymentEvents: events }));
      } else {
        renderIntentSummary(intent);
      }
      if (isTerminalIntentStatus(intent.status)) {
        console.log(c.success(`Reached terminal status: ${intent.status}`));
        return;
      }
      console.log(c.dim('Press Ctrl+C to detach. Re-rendering every 3s...'));
      await sleep(WATCH_INTERVAL_MS);
    } catch (err) {
      if (isConnectivityError(err)) {
        printConnectionError(serverUrl);
      } else {
        console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
      }
      process.exit(1);
    }
  }
}

function renderIntentSummary(intent: IntentDetail): void {
  blank();
  console.log(c.bold('Intent'));
  divider();
  console.log(`${c.dim('Text:'.padEnd(14))} ${intent.text}`);
  console.log(`${c.dim('Status:'.padEnd(14))} ${statusBadge(intent.status)}`);
  console.log(`${c.dim('Correlation:'.padEnd(14))} ${intent.correlationId}`);
  blank();
  if (intent.agentExecutions?.length > 0) {
    console.log(c.bold('Agent executions'));
    divider();
    const symbols: Record<string, string> = {
      completed: c.success('✓'),
      skipped:   c.dim('–'),
      failed:    c.error('✗'),
      running:   c.info('◎'),
      queued:    c.dim('○'),
    };
    for (const e of intent.agentExecutions) {
      const sym = symbols[e.status] ?? c.dim('?');
      const dur = e.durationMs ? c.dim(` (${e.durationMs}ms)`) : '';
      console.log(`  ${sym} ${c.agent(e.agentRole)}${dur}`);
    }
  }
  blank();
}

async function fetchDeploymentEventsBestEffort(
  client: GestaltApiClient,
  projectId: string,
  correlationId: string,
): Promise<DeploymentEvent[]> {
  try {
    const res = await client.listDeployments({ projectId, correlationId });
    return res.data[0]?.events ?? [];
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── --id (summary mode) ────────────────────────────────────────────────────

async function showIntentDetail(client: GestaltApiClient, id: string, serverUrl: string): Promise<void> {
  const spinner = createSpinner('Fetching intent...');
  spinner.start();

  try {
    const res = await client.getIntent(id);
    spinner.stop();

    const intent = res.data;
    blank();

    console.log(c.bold('Intent'));
    divider();
    console.log(`${c.dim('Text:'.padEnd(14))} ${intent.text}`);
    console.log(`${c.dim('Status:'.padEnd(14))} ${statusBadge(intent.status)}`);
    console.log(`${c.dim('Correlation:'.padEnd(14))} ${intent.correlationId}`);
    console.log(`${c.dim('Created:'.padEnd(14))} ${new Date(intent.createdAt).toLocaleString()}`);

    blank();

    // Agent executions
    if (intent.agentExecutions?.length > 0) {
      console.log(c.bold('Agent executions'));
      divider();

      const statusSymbols: Record<string, string> = {
        'completed': c.success('✓'),
        'skipped':   c.dim('–'),
        'failed':    c.error('✗'),
        'running':   c.info('◎'),
        'queued':    c.dim('○'),
      };

      intent.agentExecutions.forEach((exec) => {
        const sym = statusSymbols[exec.status] ?? c.dim('?');
        const dur = exec.durationMs ? c.dim(` (${exec.durationMs}ms)`) : '';
        console.log(`  ${sym} ${c.agent(exec.agentRole)}${dur}`);
      });
    }

    blank();

    // Signals
    if (intent.signals?.length > 0) {
      console.log(c.bold('Signals'));
      divider();
      intent.signals.forEach((sig) => {
        const severity = sig.severity;
        const label = c.signal(sig.type, severity);
        console.log(`  ${label} ${c.dim('←')} ${sig.sourceAgent}`);
        console.log(`    ${sig.message.slice(0, 70)}`);
      });
    }

    blank();

  } catch (err) {
    spinner.stop();
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}
