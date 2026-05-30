/**
 * gestalt init-admin — creates the first admin user for a fresh platform.
 *
 * The corresponding server endpoint (POST /auth/admin/setup) only works when
 * the platform has zero users. After the first admin is created, the endpoint
 * returns 403 and operators must use `gestalt login` instead.
 *
 * Like `gestalt login`, this command persists the server URL on success —
 * it is part of the bootstrap flow that wires the CLI to a specific server
 * for all subsequent commands.
 */

import { GestaltApiClient, ApiClientError } from '../api/client';
import { loadCliConfig, resolveServerUrl, updateCliConfig } from '../ui/config';
import { printConnectionError } from '../ui/server-errors';
import {
  c, blank, divider, createSpinner,
  prompt, promptSecret, printLocalAuthWarning,
} from '../ui/prompts';

const MIN_PASSWORD_LENGTH = 8;

export async function initAdminCommand(serverUrl?: string): Promise<void> {
  const config = await loadCliConfig();
  const url = resolveServerUrl({ server: serverUrl }, config);

  blank();
  console.log(c.bold('Create the first Gestalt admin'));
  console.log(c.dim(`Server: ${url}`));
  divider();

  // ─── Server reachability ──────────────────────────────────────────────────
  const healthSpinner = createSpinner('Checking server...');
  healthSpinner.start();

  const client = new GestaltApiClient({ serverUrl: url });
  try {
    await client.health();
    healthSpinner.succeed(c.success('Server reachable'));
  } catch {
    healthSpinner.stop();
    printConnectionError(url);
    process.exit(1);
  }

  blank();

  // ─── Collect admin details ────────────────────────────────────────────────
  const email = await prompt('Admin email').then((s) => s.trim());
  if (!email) {
    console.log(c.error('Email is required.'));
    process.exit(1);
  }

  const displayName = await prompt('Display name').then((s) => s.trim());
  if (!displayName) {
    console.log(c.error('Display name is required.'));
    process.exit(1);
  }

  const password = await promptSecret('Password (min 8 characters)');
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.log(c.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`));
    process.exit(1);
  }

  const confirmPassword = await promptSecret('Confirm password');
  if (password !== confirmPassword) {
    console.log(c.error('Passwords do not match.'));
    process.exit(1);
  }

  blank();

  // ─── Submit ───────────────────────────────────────────────────────────────
  const setupSpinner = createSpinner('Creating admin user...');
  setupSpinner.start();

  try {
    const { token, user } = await client.adminSetup({ email, password, displayName });
    setupSpinner.succeed(c.success(`Admin user created (${user.email})`));

    await updateCliConfig({ serverUrl: url, token });

    if (user.authProvider === 'local') {
      printLocalAuthWarning();
    }

    blank();
    console.log(c.success(`✓ Admin user created. You are now signed in as ${user.email}.`));
    blank();
    console.log(c.dim('Next: run `gestalt init` to create your first project.'));
    blank();
  } catch (err) {
    setupSpinner.stop();
    if (err instanceof ApiClientError && err.status === 403) {
      blank();
      console.log(c.warn('Admin setup is not available — a user already exists.'));
      console.log(c.dim('The /auth/admin/setup endpoint only runs on a fresh platform.'));
      console.log(c.dim('To sign in to the existing platform, run:'));
      console.log(`  ${c.bold('gestalt login')}`);
      blank();
      process.exit(1);
    }
    console.log(c.error(`Admin setup failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
