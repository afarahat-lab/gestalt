#!/usr/bin/env node
/**
 * gestalt CLI — entry point.
 *
 * Commands:
 *   gestalt login [--server <url>]
 *   gestalt init
 *   gestalt init-admin [--server <url>]
 *   gestalt projects list
 *   gestalt projects use <name>
 *   gestalt projects set-adapter <name> <adapter>
 *   gestalt run "<intent>" [--priority critical|high|normal|low]
 *   gestalt status [--id <correlationId>]
 *   gestalt logs [--follow] [--id <correlationId>]
 *   gestalt dashboard
 */

import { program } from 'commander';
import { loginCommand } from './commands/login';
import { initCommand } from './commands/init';
import { initAdminCommand } from './commands/init-admin';
import { projectsListCommand, projectsUseCommand, setAdapterCommand } from './commands/projects';
import { runCommand } from './commands/run';
import { statusCommand } from './commands/status';
import { logsCommand, dashboardCommand } from './commands/logs';

const pkg = { version: '0.1.0' };  // replaced by package.json at build time

program
  .name('gestalt')
  .description('Agent-first software development platform')
  .version(pkg.version);

// gestalt login
program
  .command('login')
  .description('Sign in to the Gestalt server')
  .option('--server <url>', 'Server URL', 'http://localhost:3000')
  .action(async (opts: { server: string }) => {
    await loginCommand(opts.server).catch(fatalError);
  });

// gestalt init
program
  .command('init')
  .description('Initialize a new project with a generated harness')
  .allowExcessArguments(false)  // reject typos like `gestalt init local-admin`
  .action(async () => {
    await initCommand().catch(fatalError);
  });

// gestalt init-admin
program
  .command('init-admin')
  .description('Create the first admin user (local auth, first-boot only)')
  .option('--server <url>', 'Server URL', 'http://localhost:3000')
  .action(async (opts: { server: string }) => {
    await initAdminCommand(opts.server).catch(fatalError);
  });

// gestalt projects
const projects = program
  .command('projects')
  .description('Manage projects registered on the server');

projects
  .command('list')
  .description('List projects you own')
  .action(async () => {
    await projectsListCommand().catch(fatalError);
  });

projects
  .command('use <name>')
  .description('Set the current project (by name)')
  .action(async (name: string) => {
    await projectsUseCommand(name).catch(fatalError);
  });

projects
  .command('set-adapter <name> <adapter>')
  .description('Switch a project\'s pipeline adapter (noop | github-actions). Commits HARNESS.json.')
  .action(async (name: string, adapter: string) => {
    await setAdapterCommand(name, adapter).catch(fatalError);
  });

// gestalt run
program
  .command('run <intent>')
  .description('Submit an intent to the generate layer')
  .option('--project <id>', 'Project ID (overrides current project)')
  .option('--priority <level>', 'Task priority: critical|high|normal|low', 'normal')
  .action(async (intent: string, opts: { project?: string; priority?: string }) => {
    await runCommand(intent, {
      projectId: opts.project,
      priority: opts.priority as never,
    }).catch(fatalError);
  });

// gestalt status
program
  .command('status')
  .description('Show platform status and recent intents')
  .option('--id <correlationId>', 'Show detail for a specific intent cycle')
  .option('--watch', 'Refresh every 5 seconds')
  .action(async (opts: { id?: string; watch?: boolean }) => {
    await statusCommand(opts).catch(fatalError);
  });

// gestalt logs
program
  .command('logs')
  .description('Stream platform execution logs')
  .option('--follow', 'Keep streaming (default: true)', true)
  .option('--id <correlationId>', 'Filter to a specific intent cycle')
  .action(async (opts: { follow?: boolean; id?: string }) => {
    await logsCommand({ follow: opts.follow, correlationId: opts.id }).catch(fatalError);
  });

// gestalt dashboard
program
  .command('dashboard')
  .description('Open the oversight dashboard in your browser')
  .action(async () => {
    await dashboardCommand().catch(fatalError);
  });

program.parse();

function fatalError(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
