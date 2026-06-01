#!/usr/bin/env node
/**
 * gestalt CLI — entry point.
 *
 * Commands:
 *   gestalt config show
 *   gestalt config set-server <url>
 *   gestalt config reset
 *   gestalt login [--server <url>]
 *   gestalt init [--server <url>]
 *   gestalt init-admin [--server <url>]
 *   gestalt projects list [--server <url>]
 *   gestalt projects use <name> [--server <url>]
 *   gestalt projects set-adapter <name> <adapter> [--server <url>]
 *   gestalt run "<intent>" [--server <url>] [--priority critical|high|normal|low]
 *   gestalt status [--server <url>] [--id <correlationId>]
 *   gestalt logs [--server <url>] [--follow] [--id <correlationId>]
 *   gestalt dashboard [--server <url>]
 *
 * `--server` semantics:
 *   - On `gestalt login` and `gestalt init-admin`, the URL is PERSISTED to
 *     ~/.gestalt/config.json on success (bootstrap flow).
 *   - On every other command, `--server` is a one-shot override — the URL
 *     is used for this invocation only, never written to config. Use
 *     `gestalt config set-server` to persist.
 */

import { program } from 'commander';
import { loginCommand } from './commands/login';
import { initCommand } from './commands/init';
import { initAdminCommand } from './commands/init-admin';
import {
  projectsListCommand, projectsUseCommand, setAdapterCommand,
} from './commands/projects';
import { runCommand } from './commands/run';
import { statusCommand } from './commands/status';
import { logsCommand, dashboardCommand } from './commands/logs';
import {
  configShowCommand, configSetServerCommand, configResetCommand,
} from './commands/config';
import {
  maintenanceTriggerCommand, maintenanceResetFindingsCommand,
} from './commands/maintenance';
import {
  alertsListCommand, alertsShowCommand, alertsFixCommand, alertsDismissCommand,
} from './commands/alerts';
import {
  agentsListCommand, agentsValidateCommand,
} from './commands/agents';

const pkg = { version: '0.1.0' };  // replaced by package.json at build time

program
  .name('gestalt')
  .description('Agent-first software development platform')
  .version(pkg.version);

// gestalt config
const config = program
  .command('config')
  .description('View and edit the CLI configuration (~/.gestalt/config.json)');

config
  .command('show')
  .description('Print the current config. Token value is never displayed.')
  .action(async () => {
    await configShowCommand().catch(fatalError);
  });

config
  .command('set-server <url>')
  .description('Set the server URL (no auth required). Persists to ~/.gestalt/config.json.')
  .action(async (url: string) => {
    await configSetServerCommand(url).catch(fatalError);
  });

config
  .command('reset')
  .description('Sign out, clear current project, and reset the server URL to the local default.')
  .action(async () => {
    await configResetCommand().catch(fatalError);
  });

// gestalt login
program
  .command('login')
  .description('Sign in to the Gestalt server')
  .option('--server <url>', 'Server URL (persisted to config on success)')
  .action(async (opts: { server?: string }) => {
    await loginCommand(opts.server).catch(fatalError);
  });

// gestalt init
program
  .command('init')
  .description('Initialize a new project with a generated harness')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .allowExcessArguments(false)  // reject typos like `gestalt init local-admin`
  .action(async (opts: { server?: string }) => {
    await initCommand({ server: opts.server }).catch(fatalError);
  });

// gestalt init-admin
program
  .command('init-admin')
  .description('Create the first admin user (local auth, first-boot only)')
  .option('--server <url>', 'Server URL (persisted to config on success)')
  .action(async (opts: { server?: string }) => {
    await initAdminCommand(opts.server).catch(fatalError);
  });

// gestalt projects
const projects = program
  .command('projects')
  .description('Manage projects registered on the server');

projects
  .command('list')
  .description('List projects you own')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await projectsListCommand({ server: opts.server }).catch(fatalError);
  });

projects
  .command('use <name>')
  .description('Set the current project (by name)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await projectsUseCommand(name, { server: opts.server }).catch(fatalError);
  });

projects
  .command('set-adapter <name> <adapter>')
  .description('Switch a project\'s pipeline adapter (noop | github-actions). Commits HARNESS.json.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, adapter: string, opts: { server?: string }) => {
    await setAdapterCommand(name, adapter, { server: opts.server }).catch(fatalError);
  });

// gestalt maintenance
const maintenance = program
  .command('maintenance')
  .description('Operator commands for the maintenance layer (drift / alignment / gc / evaluation)');

maintenance
  .command('trigger <agentRole> <projectName>')
  .description('Run a maintenance agent now (CLI shortcut for the dashboard "run now" button)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (agentRole: string, projectName: string, opts: { server?: string }) => {
    await maintenanceTriggerCommand(agentRole, projectName, { server: opts.server }).catch(fatalError);
  });

maintenance
  .command('reset-findings <projectName>')
  .description('Clear maintenance_finding_attempts for a project — escalated rows included. Use after manual remediation.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (projectName: string, opts: { server?: string }) => {
    await maintenanceResetFindingsCommand(projectName, { server: opts.server }).catch(fatalError);
  });

// gestalt alerts
const alerts = program
  .command('alerts')
  .description('Read + act on the oversight alert feed');

alerts
  .command('list')
  .description('Show unacknowledged alerts for the current project')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await alertsListCommand({ server: opts.server }).catch(fatalError);
  });

alerts
  .command('show <alertId>')
  .description('Full detail for a single alert (id or 8-char prefix)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (alertId: string, opts: { server?: string }) => {
    await alertsShowCommand(alertId, { server: opts.server }).catch(fatalError);
  });

alerts
  .command('fix <alertId>')
  .description('Submit a fix intent built from the alert context. Acknowledges the alert.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--context <text>', 'Additional context to append to the auto-built intent text')
  .action(async (alertId: string, opts: { server?: string; context?: string }) => {
    await alertsFixCommand(alertId, { server: opts.server, context: opts.context }).catch(fatalError);
  });

alerts
  .command('dismiss <alertId>')
  .description('Acknowledge an alert without action. Optional notes are recorded in the audit trail.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--notes <text>', 'Free-form notes')
  .action(async (alertId: string, opts: { server?: string; notes?: string }) => {
    await alertsDismissCommand(alertId, { server: opts.server, notes: opts.notes }).catch(fatalError);
  });

// gestalt agents — read + validate agents.yaml from the project repo (ADR-037)
const agents = program
  .command('agents')
  .description('Read + validate agents.yaml for a project (framework + custom agents)');

agents
  .command('list <projectName>')
  .description('List framework + custom agents configured for a project. Reads agents.yaml from the repo (shallow clone).')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (projectName: string, opts: { server?: string }) => {
    await agentsListCommand(projectName, { server: opts.server }).catch(fatalError);
  });

agents
  .command('validate <projectName>')
  .description('Validate agents.yaml — checks YAML parse + per-custom-agent required fields. Surfaces warnings.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (projectName: string, opts: { server?: string }) => {
    await agentsValidateCommand(projectName, { server: opts.server }).catch(fatalError);
  });

// gestalt run
program
  .command('run <intent>')
  .description('Submit an intent to the generate layer')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <id>', 'Project ID (overrides current project)')
  .option('--priority <level>', 'Task priority: critical|high|normal|low', 'normal')
  .action(async (intent: string, opts: { server?: string; project?: string; priority?: string }) => {
    await runCommand(intent, {
      server: opts.server,
      projectId: opts.project,
      priority: opts.priority as never,
    }).catch(fatalError);
  });

// gestalt status
program
  .command('status')
  .description('Show platform status and recent intents')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--id <correlationId>', 'Show detail for a specific intent cycle')
  .option('--watch', 'Refresh every 5 seconds')
  .action(async (opts: { server?: string; id?: string; watch?: boolean }) => {
    await statusCommand(opts).catch(fatalError);
  });

// gestalt logs
program
  .command('logs')
  .description('Stream platform execution logs')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--follow', 'Keep streaming (default: true)', true)
  .option('--id <correlationId>', 'Filter to a specific intent cycle')
  .action(async (opts: { server?: string; follow?: boolean; id?: string }) => {
    await logsCommand({
      server: opts.server,
      follow: opts.follow,
      correlationId: opts.id,
    }).catch(fatalError);
  });

// gestalt dashboard
program
  .command('dashboard')
  .description('Open the oversight dashboard in your browser')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await dashboardCommand({ server: opts.server }).catch(fatalError);
  });

program.parse();

function fatalError(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
