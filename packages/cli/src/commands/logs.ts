/**
 * gestalt logs — tails the platform execution log via SSE stream.
 * gestalt dashboard — opens the oversight dashboard in the browser.
 */

import { GestaltApiClient } from '../api/client';
import { loadCliConfig, resolveServerUrl } from '../ui/config';
import { printConnectionError, isConnectivityError } from '../ui/server-errors';
import { c, blank, createSpinner } from '../ui/prompts';
import type { LogsOptions } from '../types';

interface LogsCommandOptions extends LogsOptions {
  server?: string;
}

export async function logsCommand(options: LogsCommandOptions): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);

  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });

  blank();
  console.log(c.dim('Streaming platform events (Ctrl+C to stop)...'));
  blank();

  try {
    for await (const event of client.streamEvents()) {
      const evType = (event as { type?: string }).type ?? 'unknown';
      const correlationId = (event as { correlationId?: string }).correlationId ?? '';
      const timestamp = new Date().toLocaleTimeString();

      const typeDisplay = formatEventType(evType);
      const idDisplay = correlationId ? c.dim(correlationId.slice(0, 8)) : '';

      console.log(`${c.dim(timestamp)}  ${typeDisplay}  ${idDisplay}`);

      // Filter by correlationId if specified
      if (options.correlationId && correlationId !== options.correlationId) continue;

      // Show payload detail for signals
      const payload = (event as { payload?: Record<string, unknown> }).payload;
      if (evType === 'signal.emitted' && payload) {
        console.log(
          `  ${c.dim('→')} ${c.signal(String(payload['type'] ?? ''), String(payload['severity'] ?? 'low'))} ` +
          `${String(payload['message'] ?? '').slice(0, 60)}`,
        );
      }
    }
  } catch (err) {
    blank();
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
      process.exit(1);
    }
    console.log(c.warn('Connection lost.'));
    process.exit(0);
  }
}

function formatEventType(type: string): string {
  const colours: Record<string, (s: string) => string> = {
    'intent.created':           c.success,
    'intent.status-changed':    c.info,
    'agent.started':            c.agent,
    'agent.completed':          c.agent,
    'signal.emitted':           c.warn,
    'gate.completed':           c.bold,
    'deployment.updated':       c.info,
    'alert.created':            c.error,
    'maintenance.run-completed': c.dim,
  };
  const fn = colours[type] ?? c.dim;
  return fn(type.padEnd(32));
}

export async function dashboardCommand(options: { server?: string } = {}): Promise<void> {
  const config = await loadCliConfig();
  // The SPA is served at /app/*. The bare server URL 302-redirects there,
  // but opening the canonical URL directly avoids a redirect hop and
  // shows operators the path their copied URLs will carry.
  const dashboardUrl = `${resolveServerUrl(options, config)}/app/`;

  const spinner = createSpinner('Opening dashboard...');
  spinner.start();

  try {
    const { exec } = await import('child_process');
    const command = process.platform === 'darwin'
      ? `open "${dashboardUrl}"`
      : process.platform === 'win32'
        ? `start "${dashboardUrl}"`
        : `xdg-open "${dashboardUrl}"`;

    exec(command);
    spinner.succeed(`Dashboard opened at ${c.info(dashboardUrl)}`);
  } catch {
    spinner.stop();
    console.log(`Open your browser and navigate to: ${c.info(dashboardUrl)}`);
  }
}
