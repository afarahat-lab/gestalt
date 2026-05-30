/**
 * gestalt login — authenticates against the Gestalt server.
 * Stores the JWT token in ~/.gestalt/config.json.
 *
 * `--server <url>` persists the URL on success (login is the one command
 * where the server URL gets written through to config — every other command
 * treats `--server` as a one-shot override).
 */

import { GestaltApiClient } from '../api/client';
import { loadCliConfig, resolveServerUrl, updateCliConfig } from '../ui/config';
import { printConnectionError } from '../ui/server-errors';
import {
  c, blank, divider, createSpinner,
  prompt, promptSecret, printLocalAuthWarning,
} from '../ui/prompts';

export async function loginCommand(serverUrl?: string): Promise<void> {
  const config = await loadCliConfig();
  // login is the only command that persists --server. Everywhere else it is
  // a one-shot override. Treat an absent flag the same as everywhere else:
  // fall back to the persisted serverUrl.
  const url = resolveServerUrl({ server: serverUrl }, config);

  blank();
  console.log(c.bold('Sign in to Gestalt'));
  console.log(c.dim(`Server: ${url}`));
  divider();

  // Check server health first
  const healthSpinner = createSpinner('Connecting to server...');
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

  // Collect credentials
  const email = await prompt('Email');
  const password = await promptSecret('Password');

  blank();
  const loginSpinner = createSpinner('Signing in...');
  loginSpinner.start();

  try {
    const { token } = await client.login(email, password);
    client.setToken(token);

    const user = await client.getMe();
    loginSpinner.succeed(c.success(`Signed in as ${user.email} (${user.role})`));

    await updateCliConfig({ serverUrl: url, token });

    // Show warning if local auth is in use
    if ((user as { authProvider?: string }).authProvider === 'local') {
      printLocalAuthWarning();
    }

    blank();
    console.log(c.dim('Run `gestalt init` to set up your first project.'));
    blank();

  } catch (err) {
    loginSpinner.fail(c.error(`Sign in failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
