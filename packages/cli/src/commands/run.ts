/**
 * gestalt run "<intent>" — submits an intent to the generate layer.
 *
 * Shows live agent progress via SSE stream.
 * Exits when the intent reaches a terminal state or the user presses Ctrl+C.
 */

import { GestaltApiClient } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import { printConnectionError, isConnectivityError } from '../ui/server-errors';
import {
  c, blank, divider, createSpinner,
  statusBadge,
} from '../ui/prompts';
import type { RunOptions } from '../types';

export async function runCommand(intentText: string, options: RunOptions): Promise<void> {
  if (!intentText?.trim()) {
    console.log(c.error('Intent text is required.'));
    console.log(c.dim('Usage: gestalt run "<describe what you want to build>"'));
    process.exit(1);
  }

  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);

  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  const projectId = options.projectId ?? config.currentProjectId;
  if (!projectId) {
    console.log(c.error('No project set. Run: gestalt init'));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });

  // ─── Submit ────────────────────────────────────────────────────────────────

  blank();
  const submitSpinner = createSpinner('Submitting intent...');
  submitSpinner.start();

  let intentId: string;
  let correlationId: string;

  try {
    const response = await client.submitIntent({
      text: intentText.trim(),
      projectId,
      priority: options.priority ?? 'normal',
    });
    intentId = response.data.id;
    correlationId = response.data.correlationId;
    submitSpinner.succeed(c.success('Intent submitted'));
  } catch (err) {
    submitSpinner.stop();
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }

  blank();
  divider();
  console.log(`${c.bold('Intent:')} ${intentText}`);
  console.log(`${c.dim('ID:')}     ${correlationId}`);
  console.log(`${c.dim('Status:')} ${statusBadge('generating')}`);
  divider();
  blank();

  // ─── Stream live updates ───────────────────────────────────────────────────

  console.log(c.dim('Watching agent activity (Ctrl+C to detach)...'));
  blank();

  const terminalStatuses = new Set([
    'deployed', 'failed', 'escalated',
  ]);

  const agentStatusSymbols: Record<string, string> = {
    'queued':    c.dim('○'),
    'running':   c.info('◎'),
    'completed': c.success('●'),
    'skipped':   c.dim('–'),
    'failed':    c.error('✗'),
  };

  try {
    for await (const event of client.streamEvents()) {
      const evCorrelationId = (event as { correlationId?: string }).correlationId;
      if (evCorrelationId !== correlationId) continue;

      const evType = (event as { type?: string }).type as string;
      const payload = (event as { payload?: Record<string, unknown> }).payload ?? {};

      switch (evType) {
        case 'agent.started': {
          const role = String(payload['agentRole'] ?? '');
          console.log(`  ${agentStatusSymbols['running']} ${c.agent(role)} started`);
          break;
        }
        case 'agent.completed': {
          const role = String(payload['agentRole'] ?? '');
          const status = String(payload['status'] ?? 'completed');
          const sym = agentStatusSymbols[status] ?? agentStatusSymbols['completed'];
          const duration = payload['durationMs'] ? ` ${c.dim(`${payload['durationMs']}ms`)}` : '';
          console.log(`  ${sym} ${c.agent(role)} ${status}${duration}`);
          break;
        }
        case 'signal.emitted': {
          const sigType = String(payload['type'] ?? '');
          const severity = String(payload['severity'] ?? 'medium');
          const message = String(payload['message'] ?? '');
          console.log(`  ${c.signal(sigType, severity)} ${c.dim(message.slice(0, 60))}`);
          break;
        }
        case 'intent.status-changed': {
          const status = String(payload['status'] ?? '');
          blank();
          console.log(`${c.bold('Status:')} ${statusBadge(status)}`);

          if (terminalStatuses.has(status)) {
            blank();
            if (status === 'deployed') {
              console.log(c.success('✓ Intent completed and deployed.'));
              console.log(c.dim(`View details: gestalt status --id ${intentId}`));
            } else if (status === 'escalated') {
              console.log(c.warn('⚠ Intent escalated — human action required.'));
              console.log(c.dim(`Open dashboard: gestalt dashboard`));
            } else {
              console.log(c.error(`✗ Intent ${status}.`));
              console.log(c.dim(`View details: gestalt status --id ${intentId}`));
            }
            blank();
            process.exit(0);
          }
          break;
        }
        case 'gate.completed': {
          const verdict = String(payload['verdict'] ?? '');
          const verdictDisplay = verdict === 'pass'
            ? c.success('pass')
            : verdict === 'escalate'
              ? c.error('escalate')
              : c.warn('fail');
          console.log(`  ${c.bold('Gate:')} ${verdictDisplay}`);
          break;
        }
      }
    }
  } catch {
    blank();
    console.log(c.warn('Connection to server lost. Run `gestalt status` to check progress.'));
    process.exit(0);
  }
}
