/**
 * gestalt projects — list and switch between projects (ADR-032).
 *
 *   gestalt projects list           — table of name / gitUrl / createdAt
 *   gestalt projects use <name>     — set currentProjectId in ~/.gestalt/config.json
 *   gestalt projects set-adapter <name> <adapter>
 *                                   — flip pipeline.adapter in HARNESS.json
 *
 * Each subcommand accepts an optional `--server <url>` one-shot override.
 * Persisting a server URL is the job of `gestalt login` / `gestalt config
 * set-server`; everywhere else the flag only redirects THIS invocation.
 */

import { GestaltApiClient } from '../api/client';
import { loadCliConfig, resolveServerUrl, updateCliConfig } from '../ui/config';
import { printConnectionError, isConnectivityError } from '../ui/server-errors';
import { c, blank, divider, printTable } from '../ui/prompts';

export async function projectsListCommand(options: { server?: string } = {}): Promise<void> {
  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);
  if (!config.token) {
    console.log(c.error('Not authenticated. Run: gestalt login'));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });

  try {
    const { data: projects } = await client.listProjects();

    blank();
    if (projects.length === 0) {
      console.log(c.dim('No projects yet. Run: gestalt init'));
      blank();
      return;
    }

    console.log(c.bold(`Projects (${projects.length})`));
    divider();
    printTable(
      projects.map((p) => ({
        current: p.id === config.currentProjectId ? c.success('*') : ' ',
        name:    p.name,
        gitUrl:  p.gitUrl,
        branch:  p.defaultBranch,
        created: new Date(p.createdAt).toLocaleDateString(),
      })),
      [
        { key: 'current', header: '',         width: 3 },
        { key: 'name',    header: 'Name',     width: 24 },
        { key: 'gitUrl',  header: 'Git URL',  width: 48 },
        { key: 'branch',  header: 'Branch',   width: 10 },
        { key: 'created', header: 'Created',  width: 12 },
      ],
    );
    blank();
    if (config.currentProjectId) {
      console.log(c.dim('* current project'));
      blank();
    }
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed to list projects: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

const VALID_PIPELINE_ADAPTERS = ['noop', 'github-actions'] as const;

export async function setAdapterCommand(
  name: string,
  adapter: string,
  options: { server?: string } = {},
): Promise<void> {
  if (!VALID_PIPELINE_ADAPTERS.includes(adapter as typeof VALID_PIPELINE_ADAPTERS[number])) {
    console.log(c.error(
      `Unsupported pipeline adapter '${adapter}'. Valid values: ${VALID_PIPELINE_ADAPTERS.join(', ')}`,
    ));
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
    const { data: projects } = await client.listProjects();
    const match = projects.find((p) => p.name === name);
    if (!match) {
      console.log(c.error(`No project named '${name}'. Run \`gestalt projects list\` to see what is registered.`));
      process.exit(1);
    }

    blank();
    console.log(c.dim(`Updating ${match.name} pipeline.adapter → ${adapter} ...`));
    const result = await client.updateProjectConfig(match.id, { pipeline: { adapter } });
    blank();
    if (result.data.updated) {
      console.log(c.success(`✓ Pipeline adapter set to ${result.data.adapter}`));
      if (result.data.commitSha) {
        console.log(c.dim(`  commit: ${result.data.commitSha.slice(0, 8)}`));
      }
      console.log(c.dim('  Next intent cycle will use the new adapter.'));
      console.log(c.dim('  Run `git pull` in your local project to receive the HARNESS.json update.'));
    } else {
      console.log(c.dim(`No change — adapter already set to ${adapter}.`));
    }
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed to update adapter: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

export async function projectsUseCommand(
  name: string,
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
    const { data: projects } = await client.listProjects();
    const match = projects.find((p) => p.name === name);
    if (!match) {
      console.log(c.error(`No project named '${name}'. Run \`gestalt projects list\` to see what is registered.`));
      process.exit(1);
    }
    await updateCliConfig({ currentProjectId: match.id });
    blank();
    console.log(c.success(`✓ Current project set to ${match.name}`));
    console.log(c.dim(`  id:     ${match.id}`));
    console.log(c.dim(`  gitUrl: ${match.gitUrl}`));
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}
