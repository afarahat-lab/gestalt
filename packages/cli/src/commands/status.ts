/**
 * gestalt status — shows current platform state and recent intents.
 *
 * Without args: shows active agents + 10 most recent intents.
 * With --id <correlationId>: shows full detail for one intent cycle.
 */

import { GestaltApiClient } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import { printConnectionError, isConnectivityError } from '../ui/server-errors';
import {
  c, blank, divider, createSpinner,
  statusBadge, printTable,
} from '../ui/prompts';
import type { StatusOptions } from '../types';

interface StatusCommandOptions extends StatusOptions {
  id?: string;
  server?: string;
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
    await showIntentDetail(client, options.id, serverUrl);
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
