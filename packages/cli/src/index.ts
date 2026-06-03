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
 *   gestalt projects set-adapter <name> <adapter>
 *                                  [--auto-merge | --no-auto-merge]
 *                                  [--merge-method squash|merge|rebase]
 *                                  [--server <url>]
 *   gestalt project config show                              — read all six sections
 *   gestalt project config set-agent <role>                  — patch one agent
 *   gestalt project config add-custom-agent                  — interactive add
 *   gestalt project config remove-custom-agent <name>
 *   gestalt project config set-tools <role>
 *   gestalt project config set-pipeline                      — replaces set-adapter
 *   gestalt project members list / add / remove / role
 *   gestalt project members assign-group <project> <group> --role <role>
 *   gestalt project members remove-group <project> <group>
 *   gestalt platform llms list                              — registered LLMs
 *   gestalt platform llms add                               — interactive add
 *   gestalt platform llms set-default <name>
 *   gestalt platform llms remove <name>
 *   gestalt platform llms test <name>                       — reachability check
 *   gestalt platform secrets list                           — encrypted vault
 *   gestalt platform secrets add                            — interactive (hidden value)
 *   gestalt platform secrets rotate <name>                  — replace the value
 *   gestalt platform secrets remove <name>                  — delete (SECRET_IN_USE guard)
 *   gestalt platform projects list                          — cross-project, all stats
 *   gestalt platform projects create                        — interactive register + init-harness
 *   gestalt platform projects delete <name>                 — typed-name confirmation
 *   gestalt platform templates list/upload/set-default/delete   — harness templates
 *   gestalt platform mcp list/add/enable/disable/test/remove    — platform-wide MCP servers
 *   gestalt platform tools list                                 — built-in tool inspector
 *   gestalt platform identity show/configure/reload/...         — corporate identity
 *   gestalt platform groups list/create/delete/show             — bulk user mgmt (Brief 1)
 *   gestalt platform groups add-member/remove-member            — group membership
 *   gestalt platform groups assign/unassign --role <role>       — group → project
 *   gestalt run "<intent>" [--server <url>] [--priority critical|high|normal|low]
 *   gestalt intent list [--project <name>] [--status <s>] [--limit 20]
 *   gestalt intent show <id> [--watch]                — execution-flow graph
 *   gestalt intent submit "<text>" [--project <name>] — alias of `run`
 *   gestalt gate show <intentId>
 *   gestalt deploy list [--project <name>] [--limit 20]
 *   gestalt deploy show <intentId> [--project <name>]
 *   gestalt maintenance list [--project <name>] [--agent <role>]
 *   gestalt maintenance show <runId>
 *   gestalt maintenance trigger <agentRole> <projectName>
 *   gestalt maintenance reset-findings <projectName>
 *   gestalt agents list <projectName>
 *   gestalt agents validate <projectName>
 *   gestalt agents active [--project <name>]
 *   gestalt status [--server <url>] [--id <correlationId>] [--graph] [--watch]
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
  maintenanceListCommand, maintenanceShowCommand,
} from './commands/maintenance';
import {
  alertsListCommand, alertsShowCommand, alertsFixCommand, alertsDismissCommand,
  alertsResumeCommand, alertsAbortCommand, alertsAcknowledgeCommand,
} from './commands/alerts';
import {
  agentsListCommand, agentsValidateCommand, agentsActiveCommand,
} from './commands/agents';
import {
  intentListCommand, intentShowCommand, intentSubmitCommand,
} from './commands/intent';
import { gateShowCommand } from './commands/gate';
import { deployListCommand, deployShowCommand } from './commands/deploy';
import {
  projectConfigShowCommand, projectConfigSetAgentCommand,
  projectConfigAddCustomAgentCommand, projectConfigRemoveCustomAgentCommand,
  projectConfigSetToolsCommand, projectConfigSetPipelineCommand,
  projectMembersListCommand, projectMembersAddCommand,
  projectMembersRemoveCommand, projectMembersRoleCommand,
  projectMembersAssignGroupCommand, projectMembersRemoveGroupCommand,
} from './commands/project-config';
import {
  platformLlmsListCommand, platformLlmsAddCommand,
  platformLlmsSetDefaultCommand, platformLlmsRemoveCommand,
  platformLlmsTestCommand,
  platformSecretsListCommand, platformSecretsAddCommand,
  platformSecretsRotateCommand, platformSecretsRemoveCommand,
  platformProjectsListCommand, platformProjectsCreateCommand,
  platformProjectsDeleteCommand,
} from './commands/platform-config';
import {
  platformTemplatesListCommand, platformTemplatesUploadCommand,
  platformTemplatesSetDefaultCommand, platformTemplatesDeleteCommand,
  platformMcpListCommand, platformMcpAddCommand,
  platformMcpEnableCommand, platformMcpDisableCommand,
  platformMcpTestCommand, platformMcpRemoveCommand,
  platformToolsListCommand,
  platformIdentityShowCommand, platformIdentityConfigureCommand,
  platformIdentityEnableCommand, platformIdentityDisableCommand,
  platformIdentityReloadCommand,
  platformIdentityAddRoleMappingCommand,
  platformIdentityRemoveRoleMappingCommand,
  platformGroupsListCommand, platformGroupsCreateCommand,
  platformGroupsDeleteCommand, platformGroupsAddMemberCommand,
  platformGroupsRemoveMemberCommand,
  platformGroupsAssignCommand, platformGroupsUnassignCommand,
  platformGroupsShowCommand,
} from './commands/platform-extras';
import {
  usersListCommand, usersAddCommand, usersRoleCommand, usersDeactivateCommand,
  usersAssignCommand, usersUnassignCommand, usersMembersCommand,
} from './commands/users';

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
  .option(
    '--auto-merge',
    'Enable auto-merge of the PR after staging promotion succeeds.',
  )
  .option(
    '--no-auto-merge',
    'Explicitly disable auto-merge (overrides any --auto-merge in the same invocation).',
  )
  .option(
    '--merge-method <method>',
    'Merge method when auto-merge fires: squash (default) | merge | rebase.',
  )
  .action(async (
    name: string,
    adapter: string,
    opts: { server?: string; autoMerge?: boolean; mergeMethod?: string },
  ) => {
    await setAdapterCommand(name, adapter, {
      server: opts.server,
      autoMerge: opts.autoMerge,
      mergeMethod: opts.mergeMethod,
    }).catch(fatalError);
  });

// gestalt project (singular) — per-project administration
//
// Coexists with `gestalt projects` (plural — for cross-project
// listing / switching / set-adapter). Every write under `project`
// goes through the config-as-code endpoints: clone → edit
// HARNESS.json or agents.yaml → commit `chore: update <section>
// [gestalt-admin]` → push. project-admin minimum (or platform-admin).
const project = program
  .command('project')
  .description('Per-project administration — config (HARNESS.json / agents.yaml) and members');

const projectConfig = project
  .command('config')
  .description('Read or patch the project\'s committed config (HARNESS.json + agents.yaml)');

projectConfig
  .command('show')
  .description('Show all six config sections (pipeline / agents / custom agents / tools / members)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .action(async (opts: { server?: string; project?: string }) => {
    await projectConfigShowCommand({ server: opts.server, project: opts.project }).catch(fatalError);
  });

projectConfig
  .command('set-agent <agentRole>')
  .description('Patch one framework agent in agents.yaml (persona, LLM tuning, prompt extensions, tools). Commits to the project repo.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .option('--model <model>', "LLM model override (accepts a registered platform LLM name or a raw model string; use '~' or omit to clear)")
  .option('--temperature <float>', 'LLM temperature (0..2)')
  .option('--max-tokens <int>', 'LLM max tokens (positive integer)')
  .option('--role <text>', 'Persona role line')
  .option('--goal <text>', 'Persona goal line')
  .option('--add-extension <text>', 'Append a prompt extension')
  .option('--remove-extension <index>', 'Remove the prompt extension at the given 0-based index')
  .option('--builtin <list>', 'Comma-separated list of built-in tools (readFile,listDirectory,searchFiles,getFileTree). Replaces the current set.')
  .option('--add-mcp <name>', 'Add an MCP server. Pair with --mcp-url and --token-from.')
  .option('--mcp-url <url>', 'URL for the MCP server being added')
  .option('--token-from <source>', 'project_credential | harness | env:VAR_NAME', 'project_credential')
  .option('--remove-mcp <name>', 'Remove an MCP server by name from this agent')
  .action(async (agentRole: string, opts: {
    server?: string; project?: string;
    model?: string; temperature?: string; maxTokens?: string;
    role?: string; goal?: string;
    addExtension?: string; removeExtension?: string;
    builtin?: string; addMcp?: string; mcpUrl?: string; tokenFrom?: string; removeMcp?: string;
  }) => {
    await projectConfigSetAgentCommand(agentRole, {
      server: opts.server, project: opts.project,
      model: opts.model, temperature: opts.temperature, maxTokens: opts.maxTokens,
      role: opts.role, goal: opts.goal,
      addExtension: opts.addExtension, removeExtension: opts.removeExtension,
      builtin: opts.builtin, addMcp: opts.addMcp, mcpUrl: opts.mcpUrl,
      tokenFrom: opts.tokenFrom, removeMcp: opts.removeMcp,
    }).catch(fatalError);
  });

projectConfig
  .command('add-custom-agent')
  .description('Interactively add a custom agent. Prompts for name / role / goal / runs_after / model; opens $EDITOR for the prompt body.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .action(async (opts: { server?: string; project?: string }) => {
    await projectConfigAddCustomAgentCommand({ server: opts.server, project: opts.project }).catch(fatalError);
  });

projectConfig
  .command('remove-custom-agent <name>')
  .description('Remove a custom agent by name (commits to the project repo)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .action(async (name: string, opts: { server?: string; project?: string }) => {
    await projectConfigRemoveCustomAgentCommand(name, { server: opts.server, project: opts.project }).catch(fatalError);
  });

projectConfig
  .command('set-tools <agentRole>')
  .description('DEPRECATED — alias for `set-agent` (Session 3). Tool assignment is now part of agent config; this command still works but consider using `gestalt project config set-agent` directly.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .option('--builtin <list>', 'Comma-separated list of built-in tools (readFile,listDirectory,searchFiles,getFileTree)')
  .option('--add-mcp <name>', 'Add an MCP server. Pair with --mcp-url and --token-from.')
  .option('--mcp-url <url>', 'URL for the MCP server being added')
  .option('--token-from <source>', 'project_credential | harness | env:VAR_NAME', 'project_credential')
  .option('--remove-mcp <name>', 'Remove an MCP server by name')
  .action(async (agentRole: string, opts: {
    server?: string; project?: string;
    builtin?: string; addMcp?: string; mcpUrl?: string; tokenFrom?: string; removeMcp?: string;
  }) => {
    await projectConfigSetToolsCommand(agentRole, {
      server: opts.server, project: opts.project,
      builtin: opts.builtin, addMcp: opts.addMcp, mcpUrl: opts.mcpUrl,
      tokenFrom: opts.tokenFrom, removeMcp: opts.removeMcp,
    }).catch(fatalError);
  });

projectConfig
  .command('set-pipeline')
  .description('Update the pipeline section of HARNESS.json (replaces gestalt projects set-adapter for new use)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .option('--adapter <adapter>', 'CI/CD adapter: noop | github-actions')
  .option('--auto-merge', 'Enable auto-merge of the PR after staging promotion')
  .option('--no-auto-merge', 'Explicitly disable auto-merge')
  .option('--merge-method <method>', 'Merge method: squash | merge | rebase')
  .action(async (opts: {
    server?: string; project?: string;
    adapter?: string; autoMerge?: boolean; mergeMethod?: string;
  }) => {
    await projectConfigSetPipelineCommand({
      server: opts.server, project: opts.project,
      adapter: opts.adapter, autoMerge: opts.autoMerge, mergeMethod: opts.mergeMethod,
    }).catch(fatalError);
  });

// gestalt project members
const projectMembers = project
  .command('members')
  .description('Manage members of the current project (project-admin or platform-admin only)');

projectMembers
  .command('list')
  .description('List members of the project with their roles')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .action(async (opts: { server?: string; project?: string }) => {
    await projectMembersListCommand({ server: opts.server, project: opts.project }).catch(fatalError);
  });

projectMembers
  .command('add <email>')
  .description('Add an existing platform user to the project with a role')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .option('--role <role>', 'project-admin | editor | reader')
  .action(async (email: string, opts: { server?: string; project?: string; role?: string }) => {
    await projectMembersAddCommand(email, { server: opts.server, project: opts.project, role: opts.role }).catch(fatalError);
  });

projectMembers
  .command('remove <email>')
  .description('Remove a member from the project (refuses if they are the last project-admin)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .action(async (email: string, opts: { server?: string; project?: string }) => {
    await projectMembersRemoveCommand(email, { server: opts.server, project: opts.project }).catch(fatalError);
  });

projectMembers
  .command('role <email> <role>')
  .description('Change a member\'s project role (project-admin | editor | reader)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Project name (defaults to current project)')
  .action(async (email: string, role: string, opts: { server?: string; project?: string }) => {
    await projectMembersRoleCommand(email, role, { server: opts.server, project: opts.project }).catch(fatalError);
  });

projectMembers
  .command('assign-group <projectName> <groupName>')
  .description('Assign a platform group to this project (UPSERT — re-runs update the role in place).')
  .option('--role <role>', 'Role for the group on this project (project-admin|editor|reader)', 'editor')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (projectName: string, groupName: string, opts: { role?: string; server?: string }) => {
    await projectMembersAssignGroupCommand(projectName, groupName, { role: opts.role, server: opts.server }).catch(fatalError);
  });

projectMembers
  .command('remove-group <projectName> <groupName>')
  .description('Remove a platform group from this project. Direct memberships are unaffected.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (projectName: string, groupName: string, opts: { server?: string }) => {
    await projectMembersRemoveGroupCommand(projectName, groupName, { server: opts.server }).catch(fatalError);
  });

// gestalt maintenance
const maintenance = program
  .command('maintenance')
  .description('Operator commands for the maintenance layer (drift / alignment / gc / evaluation)');

maintenance
  .command('list')
  .description('Table of recent maintenance runs (status, fixes, intents queued, duration)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Filter to a project by name (defaults to the current project)')
  .option('--agent <role>', 'Filter to a single agent role (drift-agent | alignment-agent | gc-agent | evaluation-agent)')
  .option('--limit <n>', 'Max rows to fetch (default 20, max 200)')
  .action(async (opts: { server?: string; project?: string; agent?: string; limit?: string }) => {
    await maintenanceListCommand({
      server: opts.server,
      project: opts.project,
      agent: opts.agent,
      limit: opts.limit,
    }).catch(fatalError);
  });

maintenance
  .command('show <runId>')
  .description('Show one maintenance run\'s detail with the full findings list (id or 8-char prefix)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (runId: string, opts: { server?: string }) => {
    await maintenanceShowCommand(runId, { server: opts.server }).catch(fatalError);
  });

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

// gestalt alerts — ADR-021 intervention subcommands (GP_BREACH only)
alerts
  .command('resume <alertId>')
  .description('Intervene RESUME on a GP_BREACH escalation — false positive, dispatch deploy chain (ADR-021)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (alertId: string, opts: { server?: string }) => {
    await alertsResumeCommand(alertId, { server: opts.server }).catch(fatalError);
  });

alerts
  .command('abort <alertId>')
  .description('Intervene ABORT on a GP_BREACH escalation — real breach, transition intent to failed (ADR-021)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (alertId: string, opts: { server?: string }) => {
    await alertsAbortCommand(alertId, { server: opts.server }).catch(fatalError);
  });

alerts
  .command('acknowledge <alertId>')
  .description('Intervene ACKNOWLEDGE-BREACH on a GP_BREACH escalation — record notes + transition to failed (ADR-021)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--notes <text>', 'Notes describing why this breach occurred (required; prompts if omitted)')
  .action(async (alertId: string, opts: { server?: string; notes?: string }) => {
    await alertsAcknowledgeCommand(alertId, { server: opts.server, notes: opts.notes }).catch(fatalError);
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

agents
  .command('active')
  .description('Show currently-running agent executions (intent text, cycle progress, elapsed time, token total)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Filter to one project (intersects by correlationId)')
  .action(async (opts: { server?: string; project?: string }) => {
    await agentsActiveCommand({ server: opts.server, project: opts.project }).catch(fatalError);
  });

// gestalt users — platform user management (migration 010)
const users = program
  .command('users')
  .description('Manage platform users and project memberships (platform-admin)');

users
  .command('list')
  .description('List users registered on the platform')
  .option('--search <text>', 'Substring match on email or display name')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string; search?: string }) => {
    await usersListCommand({ server: opts.server, search: opts.search }).catch(fatalError);
  });

users
  .command('add <email>')
  .description('Create a user (prompts for display name, role, password)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (email: string, opts: { server?: string }) => {
    await usersAddCommand(email, { server: opts.server }).catch(fatalError);
  });

users
  .command('role <email> <role>')
  .description('Set platform role (platform-admin | user)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (email: string, role: string, opts: { server?: string }) => {
    await usersRoleCommand(email, role, { server: opts.server }).catch(fatalError);
  });

users
  .command('deactivate <email>')
  .description('Soft-delete a user (blocks all subsequent requests)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (email: string, opts: { server?: string }) => {
    await usersDeactivateCommand(email, { server: opts.server }).catch(fatalError);
  });

users
  .command('assign <email> <projectName>')
  .description('Assign a user to a project with a role (default: editor)')
  .option('--role <role>', 'Project role (project-admin | editor | reader)', 'editor')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (email: string, projectName: string, opts: { server?: string; role?: string }) => {
    await usersAssignCommand(email, projectName, { server: opts.server, role: opts.role }).catch(fatalError);
  });

users
  .command('unassign <email> <projectName>')
  .description('Remove a user from a project')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (email: string, projectName: string, opts: { server?: string }) => {
    await usersUnassignCommand(email, projectName, { server: opts.server }).catch(fatalError);
  });

users
  .command('members <projectName>')
  .description('List members of a project')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (projectName: string, opts: { server?: string }) => {
    await usersMembersCommand(projectName, { server: opts.server }).catch(fatalError);
  });

// gestalt platform — platform-admin only (LLM registry today; future
// home for other platform-level config).
const platform = program
  .command('platform')
  .description('Platform-admin commands — LLM registry, future platform-wide settings');

const platformLlms = platform
  .command('llms')
  .description('Manage the platform LLM registry (migration 014). The actual API key VALUE lives only in the server\'s env vars — never persisted.');

platformLlms
  .command('list')
  .description('Table of registered LLMs (name, provider, model, base URL, env var)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformLlmsListCommand({ server: opts.server }).catch(fatalError);
  });

platformLlms
  .command('add')
  .description('Interactively register a new platform LLM. Prompts for name, provider, model string, base URL, env var name, description, default toggle.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformLlmsAddCommand({ server: opts.server }).catch(fatalError);
  });

platformLlms
  .command('set-default <name>')
  .description('Promote a named LLM to the platform default (atomically clears the existing default)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformLlmsSetDefaultCommand(name, { server: opts.server }).catch(fatalError);
  });

platformLlms
  .command('remove <name>')
  .description('Remove a registered LLM. Refuses if it\'s the last LLM or the current default.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformLlmsRemoveCommand(name, { server: opts.server }).catch(fatalError);
  });

platformLlms
  .command('test <name>')
  .description('Send a one-token `hello` completion to verify the LLM is reachable. Reports latency.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformLlmsTestCommand(name, { server: opts.server }).catch(fatalError);
  });

// gestalt platform secrets — encrypted vault (Session 4 — migration 015)
const platformSecrets = platform
  .command('secrets')
  .description('Manage the encrypted secrets vault. Values are encrypted under a server master key and NEVER returned by any API.');

platformSecrets
  .command('list')
  .description('Table of stored secrets — names, descriptions, updated timestamps. Values are never displayed.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformSecretsListCommand({ server: opts.server }).catch(fatalError);
  });

platformSecrets
  .command('add')
  .description('Interactively register a secret. Hidden TTY input + confirmation; the value never appears on stdout.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformSecretsAddCommand({ server: opts.server }).catch(fatalError);
  });

platformSecrets
  .command('rotate <name>')
  .description('Replace a secret\'s value with a fresh one. The old value is unrecoverable after rotation.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformSecretsRotateCommand(name, { server: opts.server }).catch(fatalError);
  });

platformSecrets
  .command('remove <name>')
  .description('Delete a secret. Refuses if the secret is referenced by any LLM (SECRET_IN_USE).')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformSecretsRemoveCommand(name, { server: opts.server }).catch(fatalError);
  });

// gestalt platform projects — cross-project management (platform-admin only)
const platformProjects = platform
  .command('projects')
  .description('Manage projects across the platform. Unlike `gestalt projects list` (which shows your memberships), this shows every project with stats.');

platformProjects
  .command('list')
  .description('Table of every project with member count, intent count, and last activity timestamp.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformProjectsListCommand({ server: opts.server }).catch(fatalError);
  });

platformProjects
  .command('create')
  .description('Interactively register a new project. Auto-assigns you as project-admin and runs init-harness inline.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformProjectsCreateCommand({ server: opts.server }).catch(fatalError);
  });

platformProjects
  .command('delete <name>')
  .description('Permanently delete a project (memberships, credentials, maintenance runs). Refuses on active intents. The remote Git repo is NOT touched.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformProjectsDeleteCommand(name, { server: opts.server }).catch(fatalError);
  });

// gestalt platform templates — harness templates (Session 3 — migration 017)
const platformTemplates = platform
  .command('templates')
  .description('Manage harness templates (the file map used by `gestalt init`).');

platformTemplates
  .command('list')
  .description('List registered templates. Built-in templates ship with the platform.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformTemplatesListCommand({ server: opts.server }).catch(fatalError);
  });

platformTemplates
  .command('upload <zipPath>')
  .description('Upload a ZIP archive as a custom template. Prompts for name/slug/tier interactively.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (zipPath: string, opts: { server?: string }) => {
    await platformTemplatesUploadCommand(zipPath, { server: opts.server }).catch(fatalError);
  });

platformTemplates
  .command('set-default <slug>')
  .description('Atomically set the default template — used by `gestalt init` for every new project.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (slug: string, opts: { server?: string }) => {
    await platformTemplatesSetDefaultCommand(slug, { server: opts.server }).catch(fatalError);
  });

platformTemplates
  .command('delete <slug>')
  .description('Delete a custom template. Refuses on built-in or default templates.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (slug: string, opts: { server?: string }) => {
    await platformTemplatesDeleteCommand(slug, { server: opts.server }).catch(fatalError);
  });

// gestalt platform mcp — platform-wide MCP servers (Session 3 — migration 017)
const platformMcp = platform
  .command('mcp')
  .description('Manage platform-wide MCP servers (merged with project-level ones at orchestration time).');

platformMcp
  .command('list')
  .description('Table of registered MCP servers.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformMcpListCommand({ server: opts.server }).catch(fatalError);
  });

platformMcp
  .command('add')
  .description('Interactively register an MCP server (name, URL, optional vault token, agent role filter).')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformMcpAddCommand({ server: opts.server }).catch(fatalError);
  });

platformMcp
  .command('enable <name>')
  .description('Enable an MCP server.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformMcpEnableCommand(name, { server: opts.server }).catch(fatalError);
  });

platformMcp
  .command('disable <name>')
  .description('Disable an MCP server (keeps the config, agents stop seeing it on the next cycle).')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformMcpDisableCommand(name, { server: opts.server }).catch(fatalError);
  });

platformMcp
  .command('test <name>')
  .description('Connect to the server, call listTools, report tool count + latency.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformMcpTestCommand(name, { server: opts.server }).catch(fatalError);
  });

platformMcp
  .command('remove <name>')
  .description('Delete an MCP server.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformMcpRemoveCommand(name, { server: opts.server }).catch(fatalError);
  });

// gestalt platform tools — read-only informational view (Session 3)
const platformTools = platform
  .command('tools')
  .description('Inspect the built-in tools available to agents.');

platformTools
  .command('list')
  .description('Print all four built-in tools with their description and the agents that have each enabled by default.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformToolsListCommand({ server: opts.server }).catch(fatalError);
  });

// gestalt platform identity — corporate identity config (Session 3 — migration 017)
const platformIdentity = platform
  .command('identity')
  .description('Manage corporate identity providers (Kerberos / SAML / OIDC) and IdP group → role mappings.');

platformIdentity
  .command('show')
  .description('Print provider status, active providers, and role mappings.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformIdentityShowCommand({ server: opts.server }).catch(fatalError);
  });

platformIdentity
  .command('configure <provider>')
  .description('Configure one provider (kerberos|saml|oidc). Prompts for a JSON config; sensitive fields use *SecretId references into the vault.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (provider: string, opts: { server?: string }) => {
    await platformIdentityConfigureCommand(provider, { server: opts.server }).catch(fatalError);
  });

platformIdentity
  .command('enable <provider>')
  .description('Enable a provider. Run `reload` afterwards to activate.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (provider: string, opts: { server?: string }) => {
    await platformIdentityEnableCommand(provider, { server: opts.server }).catch(fatalError);
  });

platformIdentity
  .command('disable <provider>')
  .description('Disable a provider. Run `reload` afterwards to deactivate.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (provider: string, opts: { server?: string }) => {
    await platformIdentityDisableCommand(provider, { server: opts.server }).catch(fatalError);
  });

platformIdentity
  .command('reload')
  .description('Hot-reload identity config from the database without restarting the server.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformIdentityReloadCommand({ server: opts.server }).catch(fatalError);
  });

platformIdentity
  .command('add-role-mapping <groupName> <platformRole>')
  .description('Map an IdP group name to a platform role (platform-admin|user).')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (groupName: string, platformRole: string, opts: { server?: string }) => {
    await platformIdentityAddRoleMappingCommand(groupName, platformRole, { server: opts.server }).catch(fatalError);
  });

platformIdentity
  .command('remove-role-mapping <groupName>')
  .description('Remove an IdP group → role mapping.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (groupName: string, opts: { server?: string }) => {
    await platformIdentityRemoveRoleMappingCommand(groupName, { server: opts.server }).catch(fatalError);
  });

// gestalt platform groups — bulk user management (Brief 1 — migration 018)
const platformGroups = platform
  .command('groups')
  .description('Manage platform-wide groups for bulk user / project access management.');

platformGroups
  .command('list')
  .description('Table of registered groups with member + project counts.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (opts: { server?: string }) => {
    await platformGroupsListCommand({ server: opts.server }).catch(fatalError);
  });

platformGroups
  .command('create <name>')
  .description('Create a new group. Members + project assignments are added separately.')
  .option('--description <text>', 'Group description')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { description?: string; server?: string }) => {
    await platformGroupsCreateCommand(name, { description: opts.description, server: opts.server }).catch(fatalError);
  });

platformGroups
  .command('delete <name>')
  .description('Delete a group (CASCADE removes members + assignments). Direct project memberships are NOT touched.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformGroupsDeleteCommand(name, { server: opts.server }).catch(fatalError);
  });

platformGroups
  .command('show <name>')
  .description('Print a group\'s members and project assignments.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (name: string, opts: { server?: string }) => {
    await platformGroupsShowCommand(name, { server: opts.server }).catch(fatalError);
  });

platformGroups
  .command('add-member <groupName> <userEmail>')
  .description('Add a user to a group. They get group-derived access to every project the group is assigned to.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (groupName: string, userEmail: string, opts: { server?: string }) => {
    await platformGroupsAddMemberCommand(groupName, userEmail, { server: opts.server }).catch(fatalError);
  });

platformGroups
  .command('remove-member <groupName> <userEmail>')
  .description('Remove a user from a group. Their direct project memberships are unaffected.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (groupName: string, userEmail: string, opts: { server?: string }) => {
    await platformGroupsRemoveMemberCommand(groupName, userEmail, { server: opts.server }).catch(fatalError);
  });

platformGroups
  .command('assign <groupName> <projectName>')
  .description('Assign a group to a project with a given role.')
  .option('--role <role>', 'Role for the assignment (project-admin|editor|reader)', 'reader')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (groupName: string, projectName: string, opts: { role?: string; server?: string }) => {
    await platformGroupsAssignCommand(groupName, projectName, { role: opts.role, server: opts.server }).catch(fatalError);
  });

platformGroups
  .command('unassign <groupName> <projectName>')
  .description('Remove a group → project assignment.')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (groupName: string, projectName: string, opts: { server?: string }) => {
    await platformGroupsUnassignCommand(groupName, projectName, { server: opts.server }).catch(fatalError);
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

// gestalt intent
const intent = program
  .command('intent')
  .description('Inspect intents — list, show the execution graph, or submit a new one');

intent
  .command('list')
  .description('Table of intents for the current project (status / priority / age / text)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Filter to a project by name (defaults to the current project)')
  .option('--status <status>', 'Filter by intent status (generating | in-review | approved | deploying | deployed | failed | escalated | waiting-for-clarification)')
  .option('--limit <n>', 'Max rows to fetch (default 20, max 100)')
  .action(async (opts: { server?: string; project?: string; status?: string; limit?: string }) => {
    await intentListCommand({
      server: opts.server,
      project: opts.project,
      status: opts.status,
      limit: opts.limit,
    }).catch(fatalError);
  });

intent
  .command('show <id>')
  .description('Render the full execution-flow graph for one intent (accepts UUID or 8-char prefix)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--watch', 'Re-render every 3s until the intent reaches a terminal status')
  .action(async (id: string, opts: { server?: string; watch?: boolean }) => {
    await intentShowCommand(id, { server: opts.server, watch: opts.watch }).catch(fatalError);
  });

intent
  .command('submit <text>')
  .description('Submit a new intent (alias of `gestalt run` — same implementation)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <id>', 'Project ID (overrides current project)')
  .option('--priority <level>', 'Task priority: critical|high|normal|low', 'normal')
  .action(async (text: string, opts: { server?: string; project?: string; priority?: string }) => {
    await intentSubmitCommand(text, {
      server: opts.server,
      projectId: opts.project,
      priority: opts.priority as never,
    }).catch(fatalError);
  });

// gestalt gate
const gate = program
  .command('gate')
  .description('Inspect quality-gate runs (verdict, per-check status, signals)');

gate
  .command('show <intentId>')
  .description('Show gate-layer detail for an intent (UUID or 8-char prefix)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .action(async (id: string, opts: { server?: string }) => {
    await gateShowCommand(id, { server: opts.server }).catch(fatalError);
  });

// gestalt deploy
const deploy = program
  .command('deploy')
  .description('Inspect deploy-layer activity — list deployments or show one timeline');

deploy
  .command('list')
  .description('Table of recent deployments with status, branch, PR link, started timestamp')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Filter to a project by name (defaults to the current project)')
  .option('--limit <n>', 'Max rows to fetch (default 20, max 100)')
  .action(async (opts: { server?: string; project?: string; limit?: string }) => {
    await deployListCommand({
      server: opts.server,
      project: opts.project,
      limit: opts.limit,
    }).catch(fatalError);
  });

deploy
  .command('show <intentId>')
  .description('Show the deployment timeline for one intent (PR → pipeline → staging → production [→ merged])')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--project <name>', 'Filter to a project by name (defaults to the current project)')
  .action(async (id: string, opts: { server?: string; project?: string }) => {
    await deployShowCommand(id, {
      server: opts.server,
      project: opts.project,
    }).catch(fatalError);
  });

// gestalt status
program
  .command('status')
  .description('Show platform status and recent intents (with --graph: full execution-flow renderer)')
  .option('--server <url>', 'Server URL (one-shot override for this invocation)')
  .option('--id <correlationId>', 'Show detail for a specific intent cycle')
  .option('--graph', 'When used with --id, render the execution-flow graph instead of the summary table')
  .option('--watch', 'When used with --id, poll + re-render every 3s until terminal status')
  .action(async (opts: { server?: string; id?: string; watch?: boolean; graph?: boolean }) => {
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
