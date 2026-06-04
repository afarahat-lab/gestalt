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
  prompt, promptSecret, promptMultilineDescription,
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

  // ─── Token credential selection ─────────────────────────────────────────────
  //
  // Three modes (migration 022):
  //   1 — Select an existing vault secret (encrypted at rest)
  //   2 — Enter a new token (optionally save to vault)
  //
  // If the vault has no secrets yet, mode 2 is forced.

  let credentialBody: {
    gitToken?: string;
    gitSecretId?: string;
    newSecret?: { name: string; value: string };
  };
  let selectedSecretId: string | null = null;

  blank();
  console.log(c.info('Git access token'));
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
    selectedSecretId = availableSecrets[pick - 1].id;
    credentialBody = { gitSecretId: selectedSecretId };
  } else {
    const newToken = await promptSecret('Git personal access token (needs repo read/write)');
    if (!newToken) {
      console.log(c.error('Git token is required.'));
      process.exit(1);
    }
    const saveAnswer = (await prompt('Save this token to the vault? (y/N)')).trim().toLowerCase();
    if (saveAnswer === 'y' || saveAnswer === 'yes') {
      const defaultSecretName = `${name} Git PAT`;
      const secretNameRaw = await prompt(`Secret name [${defaultSecretName}]`);
      const secretName = secretNameRaw.trim() || defaultSecretName;
      credentialBody = { newSecret: { name: secretName, value: newToken } };
    } else {
      credentialBody = { gitToken: newToken };
    }
  }

  // ─── Optional repo browser (vault-mode only — needs the secret id) ────────
  //
  // Skipped when the operator entered a brand-new token they haven't saved
  // to the vault yet (we don't have a secret id to use). Could browse via
  // the in-flight token, but that would force a second backend round-trip
  // before the project even exists.

  let gitUrl = '';
  let defaultBranch = 'main';
  if (selectedSecretId) {
    blank();
    const browseAnswer = (await prompt('Try to browse repos with this secret? (y/N)')).trim().toLowerCase();
    if (browseAnswer === 'y' || browseAnswer === 'yes') {
      const browseSpinner = createSpinner('Fetching repositories...');
      browseSpinner.start();
      try {
        const { data: repos } = await client.listGitRepos(selectedSecretId, 'github');
        browseSpinner.stop();
        if (repos.length === 0) {
          console.log(c.dim('No repos returned. Enter the URL manually.'));
        } else {
          blank();
          repos.forEach((r, idx) => {
            const lock = r.private ? '🔒' : '📖';
            console.log(`  ${c.bold(String(idx + 1).padStart(2))}. ${lock} ${r.fullName}  ${c.dim(`(${r.defaultBranch})`)}`);
          });
          blank();
          const pickRaw = await prompt('Select repo (or press Enter to type URL manually)');
          if (pickRaw.trim()) {
            const idx = parseInt(pickRaw, 10);
            if (Number.isFinite(idx) && idx >= 1 && idx <= repos.length) {
              const repo = repos[idx - 1];
              gitUrl = repo.cloneUrl;
              defaultBranch = repo.defaultBranch || 'main';
              console.log(c.success(`✓ Using: ${gitUrl}`));
            } else {
              console.log(c.dim('Invalid selection — falling through to manual entry.'));
            }
          }
        }
      } catch (err) {
        browseSpinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        console.log(c.dim(`Could not list repos: ${msg}`));
        console.log(c.dim('Falling through to manual URL entry.'));
      }
    }
  }

  if (!gitUrl) {
    const inputUrl = await prompt('Git repository URL (the server will clone and push to this)');
    if (!inputUrl) {
      console.log(c.error('Git URL is required.'));
      process.exit(1);
    }
    gitUrl = inputUrl;
    const branchInput = await prompt('Default branch [main]');
    defaultBranch = branchInput || 'main';
  }

  blank();
  const registerSpinner = createSpinner('Registering project...');
  registerSpinner.start();

  let projectId: string;
  try {
    const { data: project } = await client.createProject({
      name, gitUrl, defaultBranch,
      ...credentialBody,
    });
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
  console.log("Describe your project's tech stack and purpose. Include:");
  console.log(c.dim('- What the application does'));
  console.log(c.dim('- Programming language and key frameworks'));
  console.log(c.dim('- Package manager preference (npm / pnpm / yarn / pip / poetry / ...)'));
  console.log(c.dim('- Test framework preference (if any)'));
  blank();
  console.log(
    c.dim(
      'Example: "A React Native mobile app with a Node.js/Express backend, ' +
      'PostgreSQL database, using npm and Jest"',
    ),
  );

  const description = await promptMultilineDescription(
    'Project description',
    'Pick an input mode — multi-line and editor modes preserve every line.',
  );
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
