/**
 * gestalt config — view and edit ~/.gestalt/config.json without logging in.
 *
 *   gestalt config show              — print the current config (token never shown)
 *   gestalt config set-server <url>  — persist a new server URL (no auth required)
 *   gestalt config reset             — clear token + project, restore default URL
 *
 * Designed for the most common misconfiguration in production: the server
 * runs on a remote host (e.g. https://gestalt.company.com) but the CLI is
 * still pointing at http://localhost:3000. `config show` reveals the
 * mismatch; `config set-server` fixes it without forcing the user through
 * the `gestalt login` flow.
 */

import { c, blank, divider, confirm } from '../ui/prompts';
import {
  loadCliConfig, updateCliConfig, saveCliConfig, normaliseServerUrl,
} from '../ui/config';
import { DEFAULT_CLI_CONFIG } from '../types';

export async function configShowCommand(): Promise<void> {
  const config = await loadCliConfig();
  blank();
  console.log(c.bold('Gestalt CLI config'));
  divider();
  console.log(`  ${c.dim('serverUrl:')}        ${config.serverUrl}`);
  console.log(`  ${c.dim('currentProjectId:')} ${config.currentProjectId ?? c.dim('(none)')}`);
  // Never print the token itself — only whether one is on file. The token is
  // a JWT bearer credential; leaking it via `config show` would defeat the
  // whole point of the secret-input prompt at login time.
  console.log(`  ${c.dim('token:')}            ${config.token ? c.success('set') : c.dim('not set')}`);
  blank();
  console.log(c.dim(`  Config file: ~/.gestalt/config.json`));
  blank();
}

export async function configSetServerCommand(rawUrl: string): Promise<void> {
  let url: string;
  try {
    url = normaliseServerUrl(rawUrl);
  } catch (err) {
    console.log(c.error(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  await updateCliConfig({ serverUrl: url });

  blank();
  console.log(c.success(`✓ Server URL set to ${url}`));
  console.log(c.dim('  Run: gestalt login  to authenticate'));
  blank();
}

export async function configResetCommand(): Promise<void> {
  const confirmed = await confirm(
    'This will sign you out and clear your project. Continue?',
    false,
  );
  if (!confirmed) {
    blank();
    console.log(c.dim('Aborted.'));
    blank();
    process.exit(0);
  }

  // Reset to the same shape as a brand-new install. `saveCliConfig` writes
  // the full struct (rather than merging) so previously persisted fields
  // are dropped, not just nulled-out.
  await saveCliConfig({ ...DEFAULT_CLI_CONFIG });

  blank();
  console.log(c.success('✓ Config reset.'));
  blank();
}
