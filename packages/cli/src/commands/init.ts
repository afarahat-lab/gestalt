/**
 * gestalt init — four-phase project initialiser (ADR-032).
 *
 * Phase 0:   Verify server reachability and the operator is signed in
 * Phase 0.5: Register the project (name + Git URL + token)
 * Phase 1:   Capture the project description
 * Phase 2:   Server clones the repo, writes harness files, commits, pushes
 * Phase 3:   Confirm the project record from the server
 *
 * No files are written to the developer's local machine. The harness lands
 * in the Git repo; the developer pulls it down.
 */

import { GestaltApiClient, ApiClientError } from '../api/client';
import { loadCliConfig, resolveServerUrl, updateCliConfig } from '../ui/config';
import { printConnectionError, isConnectivityError } from '../ui/server-errors';
import {
  c, blank, divider, createSpinner,
  prompt, promptSecret,
} from '../ui/prompts';

export async function initCommand(options: { server?: string } = {}): Promise<void> {
  blank();
  console.log(c.title('Welcome to Gestalt.'));
  console.log(c.dim('We will register your project and seed its harness in Git.'));
  blank();

  const config = await loadCliConfig();
  const serverUrl = resolveServerUrl(options, config);

  if (!config.token) {
    console.log(c.error('Not signed in. Run `gestalt login` (or `gestalt init-admin` on a fresh platform) first.'));
    process.exit(1);
  }

  const client = new GestaltApiClient({ serverUrl, token: config.token });

  // ─── Phase 0 — Server health ───────────────────────────────────────────────

  console.log(c.info('Phase 0 — Server'));
  divider();

  const healthSpinner = createSpinner('Checking server...');
  healthSpinner.start();
  try {
    await client.health();
    healthSpinner.succeed(c.success(`Server reachable (${serverUrl})`));
  } catch {
    healthSpinner.stop();
    printConnectionError(serverUrl);
    process.exit(1);
  }
  blank();

  // ─── Phase 0.5 — Project registration ──────────────────────────────────────

  console.log(c.info('Phase 0.5 — Project Registration'));
  divider();
  console.log('The server will clone your Git repo, write the harness files,');
  console.log('commit, and push to the default branch. Make sure the repo exists');
  console.log('on the remote and the token has read+write access.');
  blank();

  const name = await prompt('Project name (short identifier, e.g. hr-portal)');
  if (!name) {
    console.log(c.error('Project name is required.'));
    process.exit(1);
  }

  const gitUrl = await prompt('Git repository URL (the server will clone and push to this)');
  if (!gitUrl) {
    console.log(c.error('Git URL is required.'));
    process.exit(1);
  }

  const branchInput = await prompt('Default branch [main]');
  const defaultBranch = branchInput || 'main';

  const gitToken = await promptSecret('Git personal access token (needs repo read/write)');
  if (!gitToken) {
    console.log(c.error('Git token is required.'));
    process.exit(1);
  }

  blank();
  const registerSpinner = createSpinner('Registering project...');
  registerSpinner.start();

  let projectId: string;
  try {
    const { data: project } = await client.createProject({ name, gitUrl, defaultBranch, gitToken });
    projectId = project.id;
    registerSpinner.succeed(c.success(`Project registered: ${project.name}`));
    await updateCliConfig({ currentProjectId: projectId });
  } catch (err) {
    registerSpinner.stop();
    if (err instanceof ApiClientError && err.status === 409) {
      console.log(c.error(`A project named '${name}' already exists. Pick a different name or run \`gestalt projects use ${name}\`.`));
    } else if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Registration failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }
  blank();

  // ─── Phase 1 — Project description ─────────────────────────────────────────

  console.log(c.info('Phase 1 — Project Description'));
  divider();
  console.log('Describe your project in your own words.');
  console.log(c.dim('What are you building, who will use it, what problem does it solve?'));
  blank();

  const description = await prompt('Your description');
  if (!description.trim()) {
    console.log(c.error('Description is required.'));
    process.exit(1);
  }
  blank();

  // ─── Phase 2 — Harness generation (server-side) ───────────────────────────

  console.log(c.info('Phase 2 — Harness Generation'));
  divider();

  const genSpinner = createSpinner('Server cloning repo and writing harness files...');
  genSpinner.start();

  let commitSha = '';
  try {
    const { data } = await client.initHarness(projectId, description);
    commitSha = data.commitSha;
    genSpinner.succeed(c.success(`Harness committed to ${gitUrl}`));
  } catch (err) {
    genSpinner.stop();
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Harness init failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }

  blank();
  console.log(c.dim(`Commit: ${commitSha}`));
  blank();
  console.log('Run the following in your local project folder:');
  blank();
  console.log(`  ${c.bold('git pull')}`);
  blank();
  console.log('This pulls the generated harness files to your local machine.');
  blank();

  // ─── Phase 3 — Validation ──────────────────────────────────────────────────

  console.log(c.info('Phase 3 — Validation'));
  divider();

  const validateSpinner = createSpinner('Confirming project record...');
  validateSpinner.start();
  try {
    await client.getProject(projectId);
    validateSpinner.stop();
  } catch (err) {
    validateSpinner.stop();
    if (isConnectivityError(err)) {
      printConnectionError(serverUrl);
    } else {
      console.log(c.error(`Validation failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exit(1);
  }

  const checks = [
    'Project registered on the server',
    'Harness committed to the project repo',
    `Default branch: ${defaultBranch}`,
    `Current project set: ${name}`,
  ];
  checks.forEach((check) => {
    console.log(`  ${c.success('✓')} ${check}`);
  });

  blank();
  divider();
  console.log(c.success('✓ Project ready.'));
  blank();
  console.log('Next steps:');
  console.log(`  ${c.bold('git pull')}                                        ${c.dim('# locally, in your project folder')}`);
  console.log(`  ${c.bold('gestalt run')} ${c.dim('"Set up the initial scaffold"')}`);
  blank();
}
