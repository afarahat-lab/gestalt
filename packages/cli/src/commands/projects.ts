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
import {
  printConnectionError, isConnectivityError, handleMembershipForbidden,
} from '../ui/server-errors';
import { c, blank, divider, printTable, prompt, promptSecret } from '../ui/prompts';

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
const VALID_MERGE_METHODS = ['squash', 'merge', 'rebase'] as const;

export interface SetAdapterOptions {
  server?: string;
  /**
   * `true` → opt the project into auto-merge after staging promotion.
   * `false` → explicitly disable (operator passed `--no-auto-merge`).
   * `undefined` → flag omitted, leave the current setting alone.
   * Commander expands `--auto-merge`/`--no-auto-merge` to this shape
   * when the option is registered as a boolean.
   */
  autoMerge?: boolean;
  mergeMethod?: string;
}

export async function setAdapterCommand(
  name: string,
  adapter: string,
  options: SetAdapterOptions = {},
): Promise<void> {
  if (!VALID_PIPELINE_ADAPTERS.includes(adapter as typeof VALID_PIPELINE_ADAPTERS[number])) {
    console.log(c.error(
      `Unsupported pipeline adapter '${adapter}'. Valid values: ${VALID_PIPELINE_ADAPTERS.join(', ')}`,
    ));
    process.exit(1);
  }
  if (options.mergeMethod !== undefined
      && !VALID_MERGE_METHODS.includes(options.mergeMethod as typeof VALID_MERGE_METHODS[number])) {
    console.log(c.error(
      `Unsupported merge method '${options.mergeMethod}'. Valid values: ${VALID_MERGE_METHODS.join(', ')}`,
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

    const pipelinePatch: {
      adapter: string;
      autoMerge?: boolean;
      mergeMethod?: 'merge' | 'squash' | 'rebase';
    } = { adapter };
    if (options.autoMerge !== undefined) pipelinePatch.autoMerge = options.autoMerge;
    if (options.mergeMethod !== undefined) {
      pipelinePatch.mergeMethod = options.mergeMethod as 'merge' | 'squash' | 'rebase';
    }

    const updateDescription = [
      `adapter → ${adapter}`,
      options.autoMerge !== undefined ? `autoMerge → ${options.autoMerge}` : null,
      options.mergeMethod !== undefined ? `mergeMethod → ${options.mergeMethod}` : null,
    ].filter(Boolean).join(', ');

    blank();
    console.log(c.dim(`Updating ${match.name} pipeline.${updateDescription} ...`));
    const result = await client.updateProjectConfig(match.id, { pipeline: pipelinePatch });
    blank();
    if (result.data.updated) {
      console.log(c.success(`✓ Pipeline adapter set to ${result.data.adapter}`));
      if (result.data.autoMerge !== undefined && result.data.autoMerge !== null) {
        console.log(c.dim(`  autoMerge: ${result.data.autoMerge}`));
      }
      if (result.data.mergeMethod) {
        console.log(c.dim(`  mergeMethod: ${result.data.mergeMethod}`));
      }
      if (result.data.commitSha) {
        console.log(c.dim(`  commit: ${result.data.commitSha.slice(0, 8)}`));
      }
      console.log(c.dim('  Next intent cycle will use the new pipeline config.'));
      console.log(c.dim('  Run `git pull` in your local project to receive the HARNESS.json update.'));
    } else {
      console.log(c.dim(`No change — pipeline config already matches request.`));
    }
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed to update adapter: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
}

/**
 * gestalt projects update-token <name>
 *
 * Replace the project's Git PAT. Same three credential modes as
 * `gestalt init`:
 *   1 — Select an existing vault secret
 *   2 — Enter a new token (optionally save to vault)
 *
 * Calls `PATCH /projects/:id/git-credentials` so the change lands
 * atomically (clears the prior source). project-admin minimum;
 * a non-member or editor sees the typed
 * `INSUFFICIENT_PROJECT_ROLE` error from `handleMembershipForbidden`.
 */
export async function projectsUpdateTokenCommand(
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

    blank();
    console.log(c.bold(`Update Git credentials for ${match.name}`));
    divider();
    if (match.gitSecretId) {
      console.log(c.dim(`Current: vault secret (${match.gitSecretId.slice(0, 8)}...)`));
    } else {
      console.log(c.dim('Current: plain token'));
    }
    blank();

    const secretsList = await client.listPlatformSecrets().catch(() => null);
    const availableSecrets = secretsList?.data ?? [];

    let mode: '1' | '2' = '2';
    if (availableSecrets.length > 0) {
      console.log(`  ${c.bold('(1)')} Select from vault (${availableSecrets.length} available)`);
      console.log(`  ${c.bold('(2)')} Enter a new token`);
      const choice = (await prompt('Choice [2]')).trim() || '2';
      if (choice === '1') mode = '1';
    } else {
      console.log(c.dim('No vault secrets available — entering a new token.'));
    }

    let body: {
      gitToken?: string;
      gitSecretId?: string;
      newSecret?: { name: string; value: string };
    };
    if (mode === '1') {
      availableSecrets.forEach((s, idx) => {
        console.log(`  ${c.bold(String(idx + 1))}. ${s.name}${s.description ? c.dim(` — ${s.description}`) : ''}`);
      });
      const pickRaw = await prompt('Pick secret by number');
      const pick = parseInt(pickRaw, 10);
      if (!Number.isFinite(pick) || pick < 1 || pick > availableSecrets.length) {
        console.log(c.error('Invalid selection.'));
        process.exit(1);
      }
      body = { gitSecretId: availableSecrets[pick - 1].id };
    } else {
      const newToken = await promptSecret('New Git personal access token');
      if (!newToken) {
        console.log(c.error('Git token is required.'));
        process.exit(1);
      }
      const saveAnswer = (await prompt('Save this token to the vault? (y/N)')).trim().toLowerCase();
      if (saveAnswer === 'y' || saveAnswer === 'yes') {
        const defaultSecretName = `${match.name} Git PAT`;
        const secretNameRaw = await prompt(`Secret name [${defaultSecretName}]`);
        const secretName = secretNameRaw.trim() || defaultSecretName;
        body = { newSecret: { name: secretName, value: newToken } };
      } else {
        body = { gitToken: newToken };
      }
    }

    blank();
    const { data: updated } = await client.updateProjectGitCredentials(match.id, body);
    console.log(c.success(`✓ Git credentials updated for ${updated.name}`));
    if (updated.gitSecretId) {
      console.log(c.dim(`  Now using vault secret ${updated.gitSecretId.slice(0, 8)}...`));
    } else {
      console.log(c.dim('  Now using plain token storage'));
    }
    blank();
  } catch (err) {
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else if (!handleMembershipForbidden(err)) {
      console.log(c.error(`Failed: ${err instanceof Error ? err.message : String(err)}`));
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
